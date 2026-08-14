# -*- coding: utf-8 -*-
"""浏览器桥：本地 HTTP 服务（127.0.0.1），供 Chrome 扩展把当前页面添加到工具。

设计要点
- 仅绑定 127.0.0.1，外部网络不可达；
- CORS 白名单：只允许 chrome-extension://* 与本机页面（file://、null、127.0.0.1/localhost）；
- 添加的 URL 持久化到 <APP_DIR>/browser_queue.json，前端（批量下载页）通过
  webui.Api.browser_pending() 取走并合并进 URL 行；
- 端口冲突/启动失败静默（不影响主程序）。
"""
import json
import os
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_PORT = 47531
QUEUE_NAME = "browser_queue.json"
MAX_QUEUE = 500

# 合法来源（C 站模型页 / API 下载链接）
_URL_HOST_RE = re.compile(r"^(www\.)?civitai\.(red|com)$", re.I)
_URL_PATH_RE = re.compile(r"^/(api/download/)?models/", re.I)
_EXT_ORIGIN_RE = re.compile(r"^chrome-extension://", re.I)
_LOCAL_ORIGIN_RE = re.compile(r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$", re.I)

_lock = threading.Lock()
_server = None
_queue_path = None        # 测试时可替换
_version = ""


def _norm_url(url):
    """规范化 URL：去空白、去尾部斜杠、去空白 query 参数（保留 modelVersionId）"""
    url = (url or "").strip()
    if not url:
        return ""
    url = url.rstrip("/")
    if "?" in url:
        base, _, qs = url.partition("?")
        keep = []
        for part in qs.split("&"):
            k = part.split("=", 1)[0].strip()
            if k in ("modelVersionId", "modelversionid"):
                keep.append(part)
        url = base + ("?" + "&".join(keep) if keep else "")
    return url


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


def _read_queue():
    try:
        if os.path.exists(_queue_path):
            with open(_queue_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    return data
    except Exception:
        pass
    return []


def _write_queue(items):
    try:
        with open(_queue_path, "w", encoding="utf-8", newline="") as f:
            json.dump(items, f, ensure_ascii=False, indent=1)
        return True
    except Exception:
        return False


def add_url(url):
    """添加 URL 到浏览器队列（去重）。返回 (ok, msg, already)"""
    url = _norm_url(url)
    if not url:
        return (False, "链接不能为空", False)
    if not is_model_url(url):
        return (False, "仅支持 Civitai 模型页链接", False)
    with _lock:
        items = _read_queue()
        if any(t.get("url") == url for t in items):
            return (True, "已在队列中", True)
        items.append({"url": url, "added_at": int(time.time())})
        if len(items) > MAX_QUEUE:
            items = items[-MAX_QUEUE:]
        if not _write_queue(items):
            return (False, "队列写入失败（目录不可写）", False)
    return (True, "已添加", False)


def take_pending():
    """取走全部队列 URL（前端合并后清空）。返回 {"urls": [...]}"""
    with _lock:
        items = _read_queue()
        urls = [t.get("url") for t in items if t.get("url")]
        if urls:
            _write_queue([])
    return {"urls": urls}


def queue_list():
    with _lock:
        return [t.get("url") for t in _read_queue() if t.get("url")]


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

    def do_OPTIONS(self):
        origin = self._origin()
        if origin and not origin_allowed(origin):
            return self._json(403, {"ok": False, "msg": "来源被拒绝"}, origin)
        self.send_response(204)
        self._cors(origin)
        self.end_headers()

    def do_GET(self):
        origin = self._origin()
        if origin and not origin_allowed(origin):
            return self._json(403, {"ok": False, "msg": "来源被拒绝"}, origin)
        if self.path.split("?")[0] == "/api/health":
            return self._json(200, {"ok": True, "app": "CivitaiFreeTool", "version": _version}, origin)
        if self.path.split("?")[0] == "/api/queue":
            return self._json(200, {"ok": True, "urls": queue_list()}, origin)
        return self._json(404, {"ok": False, "msg": "Not Found"}, origin)

    def do_POST(self):
        origin = self._origin()
        if origin and not origin_allowed(origin):
            return self._json(403, {"ok": False, "msg": "来源被拒绝"}, origin)
        if self.path.split("?")[0] != "/api/add":
            return self._json(404, {"ok": False, "msg": "Not Found"}, origin)
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(min(length, 65536)) if length else b""
            data = json.loads(raw.decode("utf-8", "replace") or "{}")
            url = data.get("url") or ""
        except Exception:
            return self._json(400, {"ok": False, "msg": "请求格式错误"}, origin)
        ok, msg, already = add_url(url)
        return self._json(200 if ok else 400, {"ok": ok, "msg": msg, "already": already}, origin)


def start(version="", port=None, queue_path=None):
    """启动桥服务（幂等，端口冲突/异常静默）。返回端口号或 0。"""
    global _server, _queue_path, _version
    if _server is not None:
        return _server.server_port
    _version = version or _version
    if queue_path is not None:
        _queue_path = queue_path
    if _queue_path is None:
        import config
        _queue_path = os.path.join(config.APP_DIR, QUEUE_NAME)
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
