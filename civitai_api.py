# -*- coding: utf-8 -*-
"""Civitai 官方 API 封装（纯标准库，无需第三方依赖）"""
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

API_BASE = "https://civitai.com/api/v1"
MODEL_URL_RE = re.compile(
    r"civitai\.(?:com|red)/models/(\d+)(?:\?modelVersionId=(\d+))?", re.IGNORECASE
)
DOWNLOAD_URL_RE = re.compile(
    r"civitai\.(?:com|red)/api/download/models/(\d+)", re.IGNORECASE
)


class CivitaiError(Exception):
    pass


class _NoAuthRedirect(urllib.request.HTTPRedirectHandler):
    """跟随重定向时剥离 Authorization 头：307 会原样转发请求头到预签名 URL（如 R2/S3），
    携带 Bearer 会触发 AWS 签名校验错误（Missing x-amz-content-sha256）"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None:
            new.headers = {k: v for k, v in new.header_items()
                           if k.lower() != "authorization"}
        return new


def build_opener(proxy=None, verify=True):
    """构造 opener；verify=False 时跳过 TLS 证书验证（代理 MITM 场景兜底）"""
    import ssl as _ssl
    ctx = None
    if not verify:
        ctx = _ssl._create_unverified_context()
    if proxy:
        return urllib.request.build_opener(
            _NoAuthRedirect(),
            urllib.request.ProxyHandler({"http": proxy, "https": proxy}),
            urllib.request.HTTPSHandler(context=ctx) if ctx else urllib.request.HTTPSHandler(),
        )
    if ctx:
        return urllib.request.build_opener(_NoAuthRedirect(), urllib.request.HTTPSHandler(context=ctx))
    return urllib.request.build_opener(_NoAuthRedirect())


class CivitaiAPI:
    def __init__(self, api_key="", timeout=30, proxy=None, verify=True):
        self.api_key = (api_key or "").strip()
        self.timeout = timeout
        self.verify = verify
        self.opener = build_opener(proxy, verify)
        self._lock = threading.Lock()

    def _get(self, path, params=None, raw=False, retries=3):
        url = API_BASE + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        headers = {"User-Agent": "Mozilla/5.0 (CivitaiFreeTool; +local)"}
        if self.api_key:
            headers["Authorization"] = "Bearer " + self.api_key
        req = urllib.request.Request(url, headers=headers)
        for attempt in range(retries):
            err = None  # 每次尝试独立，避免上次失败残留导致重试成功仍报错
            with self._lock:
                try:
                    with self.opener.open(req, timeout=self.timeout) as resp:
                        body = resp.read()
                except urllib.error.HTTPError as e:
                    raise CivitaiError("HTTP %d: %s" % (e.code, e.reason)) from e
                except Exception as e:
                    err = e
            if err is None:
                if raw:
                    return body
                try:
                    return json.loads(body.decode("utf-8"))
                except Exception as e:
                    raise CivitaiError("响应解析失败: %s" % e) from e
            # 网络错误：锁外退避后重试
            if attempt < retries - 1:
                time.sleep(1.0 * (attempt + 1))
            else:
                raise CivitaiError(str(err))

    # ---- 业务接口 ----
    def get_model(self, model_id):
        """按模型 ID 获取完整模型信息"""
        return self._get("/models/%s" % model_id)

    def get_model_version(self, version_id):
        """按版本 ID 获取版本信息（含 files/downloadUrl）"""
        return self._get("/model-versions/%s" % version_id)

    def get_model_version_by_hash(self, sha256):
        """按文件 SHA256 反查模型版本（反向解析核心）"""
        return self._get("/model-versions/by-hash/%s" % sha256)

    def get_model_by_version_id(self, version_id):
        """通过版本 ID 查模型：先拿版本（含 modelId），再取模型详情"""
        v = self.get_model_version(version_id)
        if v.get("modelId"):
            try:
                m = self.get_model(v["modelId"])
                return m, v
            except CivitaiError:
                return None, v
        return None, v

    def resolve_url(self, url):
        """解析支持的三类 URL，返回 (model_id, version_id) 或抛错"""
        url = url.strip()
        m = DOWNLOAD_URL_RE.search(url)
        if m:
            return None, m.group(1)
        m = MODEL_URL_RE.search(url)
        if m:
            return m.group(1), m.group(2)
        raise CivitaiError("无法解析 URL: %s" % url)

    def pick_file(self, version):
        """从版本信息中挑选主模型文件：优先主文件且非负面嵌入，返回 (file, file_index)"""
        files = version.get("files") or []
        if not files:
            raise CivitaiError("该版本没有文件")
        primary = [f for f in files if f.get("primary")]
        if not primary:
            primary = files
        for f in primary:
            if f.get("type") != "Negative":
                return f, files.index(f)
        return primary[0], files.index(primary[0])

    def build_download_url(self, version_id, file_id=None):
        # Civitai 无文件级下载端点；版本级下载会 307 到预签名 URL，返回主文件
        return "https://civitai.com/api/download/models/%s" % version_id


def normalize_sha256(s):
    s = (s or "").strip().lower()
    return s if re.fullmatch(r"[0-9a-f]{64}", s) else None
