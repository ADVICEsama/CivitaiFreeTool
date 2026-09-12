# -*- coding: utf-8 -*-
"""浏览器桥：本地 HTTP 服务（127.0.0.1），供 Chrome 扩展一键下载 + **浏览器模式的前端界面与 RPC**。

设计要点
- 仅绑定 127.0.0.1，外部网络不可达；
- CORS 白名单：只允许 chrome-extension://* 与本机页面（file://、null、127.0.0.1/localhost）；
- POST /api/download：校验 URL 后调用注册的下载 handler（webui.Api.dl_enqueue_url，
  解析并入队下载均为后台线程，handler 同步快速返回）；
- POST /api/rpc：浏览器模式下的通用方法调用（前端 shim 把 window.pywebview.api.xxx 映射到这里）；
- GET /、/app.js 等：浏览器模式下直接由本服务提供 web/ 目录里的界面文件；
- GET /api/heartbeat：页面心跳（用于「关页面即退出」）；
- 端口冲突/启动失败静默（不影响主程序）。
"""
import json
import mimetypes
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

DEFAULT_PORT = 47531

# 合法来源（C 站模型页 / API 下载链接）
_URL_HOST_RE = re.compile(r"^(www\.)?civitai\.(red|com)$", re.I)
_URL_PATH_RE = re.compile(r"^/(api/download/)?models/", re.I)
_EXT_ORIGIN_RE = re.compile(r"^chrome-extension://", re.I)
_LOCAL_ORIGIN_RE = re.compile(r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$", re.I)

_lock = threading.Lock()
_server = None
_version = ""
_handler = None        # def download_url(url) -> dict（同步返回，如 {"started": True}）
_api = None            # webui.Api 实例：浏览器模式 RPC 用
_web_root = ""         # 界面文件根目录（浏览器模式）
_last_seen = 0.0       # 页面最后一次请求时间（心跳）


def set_download_handler(fn):
    """注册下载入口：webui.Api 启动时把 dl_enqueue_url 注册进来"""
    global _handler
    _handler = fn


def set_api(obj, web_root=""):
    """注册 RPC 目标（webui.Api 实例）与界面文件目录（浏览器模式）"""
    global _api, _web_root
    _api = obj
    if web_root:
        _web_root = web_root


def page_alive(max_silence=8.0):
    """页面是否还活着（浏览器模式「关页面即退出」用）：最近 max_silence 秒内有过请求"""
    return (time.time() - _last_seen) < max_silence


def port():
    """桥服务端口（未启动返回 0）"""
    return _server.server_port if _server is not None else 0


def touch():
    global _last_seen
    _last_seen = time.time()


def is_model_url(url):
    """校验是否为 Civitai 模型页/下载链接（hostname + path 双重校验）"""
    url = (url or "").strip()
    if not url.startswith(("http://", "https://")):
        return False
    m = re.match(r"^https?://([^/]+)(/.*)?$", url)
    if not m:
        return False
    if not _URL_HOST_RE.match(m.group(1)):
        return False
    path = m.group(2) or "/"
    return bool(_URL_PATH_RE.match(path))


def origin_allowed(origin):
    """CORS 来源白名单：无 Origin（curl/本地工具）、chrome-extension、本机页面允许"""
    if not origin or origin == "null" or origin.startswith("file:"):
        return True
    if _EXT_ORIGIN_RE.match(origin):
        return True
    if _LOCAL_ORIGIN_RE.match(origin):
        return True
    return False


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass  # 静默日志，避免刷控制台

    def _cors(self, origin):
        if origin and origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
        else:
            self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")

    def _json(self, code, obj, origin):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors(origin)
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def _origin(self):
        return self.headers.get("Origin") or ""

    def _check_origin(self, origin):
        if origin and not origin_allowed(origin):
            self._json(403, {"ok": False, "msg": "来源被拒绝"}, origin)
            return False
        return True

    def do_OPTIONS(self):
        origin = self._origin()
        if origin and not origin_allowed(origin):
            return self._json(403, {"ok": False, "msg": "来源被拒绝"}, origin)
        self.send_response(204)
        self._cors(origin)
        self.end_headers()

    def do_GET(self):
        origin = self._origin()
        if not self._check_origin(origin):
            return
        path = urlsplit(self.path).path
        touch()
        if path == "/api/health":
            return self._json(200, {"ok": True, "app": "CivitaiFreeTool", "version": _version}, origin)
        if path == "/api/heartbeat":
            return self._json(200, {"ok": True}, origin)
        # 浏览器模式：直接由本服务提供界面文件（只在注册了 web 根目录时启用）
        if _web_root and not path.startswith("/api/"):
            return self._serve_static(path)
        return self._json(404, {"ok": False, "msg": "Not Found"}, origin)

    def _serve_static(self, path):
        """提供 web/ 目录里的界面文件（防目录穿越；只服务界面自身，不外泄其他路径）"""
        rel = unquote(path).lstrip("/") or "index.html"
        root = os.path.normpath(_web_root)
        full = os.path.normpath(os.path.join(root, rel))
        if not (full == root or full.startswith(root + os.sep)):
            return self._json(403, {"ok": False, "msg": "禁止访问"}, "")
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not os.path.isfile(full):
            return self._json(404, {"ok": False, "msg": "文件不存在"}, "")
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        try:
            with open(full, "rb") as f:
                body = f.read()
        except Exception as e:
            return self._json(500, {"ok": False, "msg": str(e)[:120]}, "")
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def _rpc(self, origin):
        """浏览器模式通用方法调用：{method, args:[...]} → {result} / {error}"""
        if _api is None:
            return self._json(500, {"error": "RPC 未就绪"}, origin)
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(min(length, 16 * 1024 * 1024)) if length else b"{}"
            data = json.loads(raw.decode("utf-8", "replace") or "{}")
            method = str(data.get("method") or "")
            args = data.get("args") or []
            if not isinstance(args, list):
                args = [args]
        except Exception:
            return self._json(400, {"error": "请求格式错误"}, origin)
        if (not method) or method.startswith("_") or method in ("pick_dir", "pick_file", "pick_files"):
            return self._json(400, {"error": "不允许的方法: %s" % method[:40]}, origin)
        fn = getattr(_api, method, None)
        if not callable(fn):
            return self._json(400, {"error": "方法不存在: %s" % method[:40]}, origin)
        try:
            result = fn(*args)
        except Exception as e:
            return self._json(500, {"error": "%s: %s" % (type(e).__name__, str(e)[:200])}, origin)
        return self._json(200, {"result": result}, origin)

    def do_POST(self):
        origin = self._origin()
        if not self._check_origin(origin):
            return
        path = urlsplit(self.path).path
        touch()
        if path == "/api/rpc":
            return self._rpc(origin)
        if path != "/api/download":
            return self._json(404, {"ok": False, "msg": "Not Found"}, origin)
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(min(length, 65536)) if length else b""
            data = json.loads(raw.decode("utf-8", "replace") or "{}")
            url = data.get("url") or ""
        except Exception:
            return self._json(400, {"ok": False, "msg": "请求格式错误"}, origin)
        url = (url or "").strip()
        if not url:
            return self._json(400, {"ok": False, "msg": "链接不能为空"}, origin)
        if not is_model_url(url):
            return self._json(400, {"ok": False, "msg": "仅支持 Civitai 模型页链接"}, origin)
        fn = _handler
        if fn is None:
            return self._json(500, {"ok": False, "msg": "下载服务未就绪"}, origin)
        try:
            result = fn(url) or {}
        except Exception as e:
            return self._json(500, {"ok": False, "msg": "下载启动失败: %s" % str(e)[:120]}, origin)
        if isinstance(result, dict) and result.get("ok") is False:
            return self._json(400, result, origin)
        return self._json(200, {"ok": True, "msg": "已开始下载", **result}, origin)


def start(version="", port=None):
    """启动桥服务（幂等，端口冲突/异常静默）。返回端口号或 0。"""
    global _server, _version
    if _server is not None:
        return _server.server_port
    _version = version or _version
    port = int(port or DEFAULT_PORT)
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", port), _Handler)
    except OSError:
        return 0
    srv.daemon_threads = True
    _server = srv
    threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.5}, daemon=True).start()
    return srv.server_port


def stop():
    global _server
    if _server is not None:
        try:
            _server.shutdown()
        except Exception:
            pass
        try:
            _server.server_close()
        except Exception:
            pass
        _server = None
