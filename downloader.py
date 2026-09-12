# -*- coding: utf-8 -*-
"""并发下载器：队列、断点续传、进度、SHA256 校验、任务持久化"""
import hashlib
import json
import os
import queue
import threading
import time
import urllib.error
import urllib.request

import civitai_api
import config

CHUNK = 256 * 1024

ST_PENDING = "pending"
ST_DOWNLOADING = "downloading"
ST_DONE = "done"
ST_PAUSED = "paused"
ST_ERROR = "error"
ST_CANCELED = "canceled"


class DownloadTask:
    def __init__(self, url, dest_dir, filename, expected_sha256="", info=None):
        self.url = url
        self.dest_dir = dest_dir
        self.filename = filename
        self.expected_sha256 = expected_sha256 or ""
        self.info = info or {}
        self.status = ST_PENDING
        self.progress = 0.0          # 0-100
        self.downloaded = 0
        self.total = 0
        self.speed = 0.0
        self.error = ""
        self.id = "%d_%s" % (time.time_ns(), abs(hash(filename)))

    def to_dict(self):
        return {
            "url": self.url, "dest_dir": self.dest_dir, "filename": self.filename,
            "expected_sha256": self.expected_sha256, "info": self.info,
            "status": self.status, "downloaded": self.downloaded, "total": self.total,
        }

    @classmethod
    def from_dict(cls, d):
        t = cls(d.get("url", ""), d.get("dest_dir", ""), d.get("filename", ""),
                d.get("expected_sha256", ""), d.get("info", {}))
        t.status = d.get("status", ST_PENDING)
        t.downloaded = d.get("downloaded", 0)
        t.total = d.get("total", 0)
        return t


class Downloader:
    def __init__(self, cfg, on_update=None):
        self.cfg = cfg
        self.on_update = on_update          # callable(task)
        self.tasks = []                     # list[DownloadTask]
        self._lock = threading.Lock()
        self._queue = queue.Queue()
        self._pause_events = {}             # task.id -> threading.Event
        self._cancel_events = {}            # task.id -> threading.Event
        self._workers = []
        self._stop = False
        self._active = 0
        self._active_ids = set()        # 正在下载的任务 id（防止 resume/retry 双写）

    # ---------- 任务管理 ----------
    def add_task(self, task):
        with self._lock:
            self.tasks.append(task)
            self._pause_events[task.id] = threading.Event()
            self._cancel_events[task.id] = threading.Event()
            self._queue.put(task)
        self._notify(task)
        self._ensure_workers()

    def remove_task(self, task):
        ev = self._cancel_events.get(task.id)
        if ev:
            ev.set()
        with self._lock:
            if task in self.tasks:
                self.tasks.remove(task)
            self._pause_events.pop(task.id, None)
            self._cancel_events.pop(task.id, None)
        self._notify(task)

    def pause_task(self, task):
        ev = self._pause_events.get(task.id)
        if ev:
            ev.set()
        if task.status in (ST_PENDING, ST_DOWNLOADING):
            task.status = ST_PAUSED
            self._notify(task)

    def resume_task(self, task):
        # 仅当没有 worker 正在写该文件时恢复，避免双写 .part
        if task.id in self._active_ids:
            return
        ev = self._pause_events.get(task.id)
        if ev:
            ev.clear()
        if task.status == ST_PAUSED:
            task.status = ST_PENDING
            self._queue.put(task)
            self._ensure_workers()
            self._notify(task)

    def retry_task(self, task):
        if task.id in self._active_ids:
            return
        task.status = ST_PENDING
        task.error = ""
        task.progress = 0.0
        task.downloaded = 0
        ev = self._cancel_events.get(task.id)
        if ev:
            ev.clear()
        ev = self._pause_events.get(task.id)
        if ev:
            ev.clear()
        self._queue.put(task)
        self._ensure_workers()
        self._notify(task)

    def clear_finished(self):
        with self._lock:
            keep = [t for t in self.tasks if t.status in (ST_PENDING, ST_DOWNLOADING, ST_PAUSED)]
            for t in self.tasks:
                if t not in keep:
                    self._pause_events.pop(t.id, None)
                    self._cancel_events.pop(t.id, None)
            self.tasks = keep

    def save_tasks(self):
        with self._lock:
            data = [t.to_dict() for t in self.tasks]
        config.save_tasks(data)

    def load_tasks(self):
        for d in config.load_tasks():
            t = DownloadTask.from_dict(d)
            if t.status in (ST_DOWNLOADING,):
                t.status = ST_PENDING
            with self._lock:
                self.tasks.append(t)
                self._pause_events[t.id] = threading.Event()
                self._cancel_events[t.id] = threading.Event()
            if t.status == ST_PENDING:
                self._queue.put(t)
        self._ensure_workers()

    # ---------- 内部 ----------
    def _ensure_workers(self):
        n = max(1, int(self.cfg.get("max_concurrent_downloads", 3)))
        with self._lock:
            need = n - len([w for w in self._workers if w.is_alive()])
        for _ in range(max(0, need)):
            w = threading.Thread(target=self._worker, daemon=True)
            w.start()
            self._workers.append(w)

    def _notify(self, task):
        if self.on_update:
            try:
                self.on_update(task)
            except Exception:
                pass

    def _resolve_dest(self, task):
        """决定任务落地目录：单独指定过的最优先；否则「当前」全局目标（含 HF 相对子目录）；
        再退回任务自带目录 → 默认下载目录。

        注意：老任务（v2.1.18 及以前）的 dest_dir 是入队时烤进去的旧全局目标，
        没有 dest_explicit 标记，所以按「当前全局目标」走 —— 用户改了目标就跟着改。"""
        info = task.info or {}
        if info.get("dest_explicit") and task.dest_dir:
            return task.dest_dir
        t = (self.cfg.get("download_target_dir") or "").strip()
        base = t if (t and os.path.isdir(t)) else ""
        if not base:
            base = (task.dest_dir or "").strip() or (self.cfg.get("download_dir") or "").strip()
        rel = (info.get("hf_rel") or "").strip().strip("/\\")
        if rel and base:
            return os.path.join(base, rel.replace("/", os.sep))
        return base or os.getcwd()

    def _worker(self):
        while not self._stop:
            try:
                task = self._queue.get(timeout=1)
            except queue.Empty:
                return
            # 任务可能已被移除/取消/重复入队：原子检查并切换状态，防止双写
            with self._lock:
                if task.status != ST_PENDING or task.id in self._active_ids:
                    continue
                if task not in self.tasks:
                    continue
                if self._cancel_events.get(task.id, threading.Event()).is_set():
                    continue
                task.status = ST_DOWNLOADING
                self._active_ids.add(task.id)
            try:
                self._download_impl(task)
            finally:
                with self._lock:
                    self._active_ids.discard(task.id)

    def _download_impl(self, task):
        """带退避自动重试的下载包装。

        为什么需要：C 站文件要经代理节点下载，节点/线路抽风会随时掐断 TLS 连接
        （SSL EOF / 连接超时），单次失败就报错会白扔掉已经下好的几百 MB。
        每次重试都由 _download_once 从 .part 现有大小续传（Range），不重下。
        """
        # 落地目录在「下载开始这一刻」决定：任务没显式指定时用当前全局目标，
        # 而不是入队时的旧值 —— 否则用户入队后再选文件夹就不生效（实测踩过）。
        task.dest_dir = self._resolve_dest(task)
        try:
            attempts = max(0, int(self.cfg.get("download_retry", 5) or 5))
        except Exception:
            attempts = 5
        for attempt in range(attempts + 1):
            self._download_once(task)
            if task.status in (ST_DONE, ST_CANCELED, ST_PAUSED):
                return
            err = task.error or ""
            # 重试无意义的错误：HTTP 状态错误（403/404/416…）、C 站限制、证书错误、哈希不符
            if (err.startswith("HTTP ") or "暂不可下载" in err
                    or "SHA256 校验失败" in err or "CERTIFICATE" in err.upper()
                    or "certificate" in err):
                return
            if attempt >= attempts:
                break
            delay = min(30, 2 ** (attempt + 1))  # 2,4,8,16,30 秒
            task.status = ST_PENDING
            task.error = "网络中断，%d 秒后自动重试(%d/%d)。原始错误：%s" % (
                delay, attempt + 1, attempts, err[:100])
            self._notify(task)
            waited = 0.0
            while waited < delay:
                if self._cancel_events.get(task.id, threading.Event()).is_set():
                    task.status = ST_CANCELED
                    self._notify(task)
                    return
                if self._pause_events.get(task.id, threading.Event()).is_set():
                    task.status = ST_PAUSED
                    self._notify(task)
                    return
                time.sleep(0.25)
                waited += 0.25
        # 重试耗尽
        task.status = ST_ERROR
        task.error = ("网络中断（连接被掐断/超时，常见于代理节点不稳定）：已自动重试 %d 次仍失败。"
                      "已下载部分保留，点「重试/开始」可从断点续传。原始错误：%s"
                      % (attempts, (task.error or "")[:120]))
        self._notify(task)

    def _download_once(self, task):
        """单次下载尝试（从 .part 断点续传；失败交给 _download_impl 的重试包装）。"""
        task.error = ""
        self._notify(task)
        dest = os.path.join(task.dest_dir, task.filename)
        tmp = dest + ".part"
        os.makedirs(task.dest_dir, exist_ok=True)
        pause_ev = self._pause_events.get(task.id, threading.Event())
        cancel_ev = self._cancel_events.get(task.id, threading.Event())

        start_byte = 0
        if os.path.exists(tmp):
            start_byte = os.path.getsize(tmp)
        task.downloaded = start_byte
        # 收尾被掐断（数据其实已收全：字节数已达 Content-Length）→ 不重试也不发 416 请求，直接收尾
        if start_byte and task.total and start_byte >= task.total:
            if task.expected_sha256:
                try:
                    h = hashlib.sha256()
                    with open(tmp, "rb") as f:
                        for b in iter(lambda: f.read(CHUNK), b""):
                            h.update(b)
                    if h.hexdigest().lower() != task.expected_sha256.lower():
                        task.status = ST_ERROR
                        task.error = "SHA256 校验失败（文件已保留；可能为 C 站哈希不匹配或下载不完整）"
                        self._notify(task)
                        return
                except OSError:
                    pass
            try:
                os.replace(tmp, dest)
            except OSError:
                pass
            task.status = ST_DONE
            task.progress = 100.0
            task.speed = 0.0
            self._notify(task)
            return

        headers = {"User-Agent": "Mozilla/5.0 (CivitaiFreeTool)"}
        if self.cfg.get("api_key"):
            headers["Authorization"] = "Bearer " + self.cfg["api_key"]
        if start_byte:
            headers["Range"] = "bytes=%d-" % start_byte

        t0 = time.time()
        try:
            req = urllib.request.Request(task.url, headers=headers)
            opener = civitai_api.build_opener(
                self.cfg.get("proxy_address") if self.cfg.get("proxy_enabled") else None,
                self.cfg.get("ssl_verify", True),
            )
            with opener.open(req, timeout=int(self.cfg.get("download_timeout", 300))) as resp:
                # C 站限制（Early Access/付费/需登录）会把下载重定向到模型网页 → 提前失败
                _ct = (resp.headers.get("Content-Type") or "").lower()
                if "text/html" in _ct or "application/json" in _ct:
                    task.status = ST_ERROR
                    task.error = "暂不可下载（C 站限制 / Early Access，可能需购买或等待免费，可加入待办）"
                    self._notify(task)
                    return
                total = task.total or 0
                try:
                    total = int(resp.headers.get("Content-Length", 0)) + (start_byte if resp.status == 206 else 0)
                except Exception:
                    pass
                # 服务器忽略 Range 返回 200：从头下载
                if resp.status != 206 and start_byte:
                    start_byte = 0
                    task.downloaded = 0
                    task.total = total
                task.total = total
                mode = "ab" if (resp.status == 206 and start_byte) else "wb"
                with open(tmp, mode) as f:
                    last = time.time()
                    last_bytes = start_byte
                    while True:
                        if cancel_ev.is_set():
                            task.status = ST_CANCELED
                            self._notify(task)
                            return
                        if pause_ev.is_set():
                            task.status = ST_PAUSED
                            self._notify(task)
                            return
                        chunk = resp.read(CHUNK)
                        if not chunk:
                            break
                        f.write(chunk)
                        task.downloaded += len(chunk)
                        now = time.time()
                        if now - last >= 0.5:
                            task.speed = (task.downloaded - last_bytes) / (now - last)
                            last, last_bytes = now, task.downloaded
                        if total:
                            task.progress = min(100.0, task.downloaded * 100.0 / total)
                        self._notify(task)
                # 静默断流检测：有 Content-Length 但实际字节数不足 = 连接被掐断（不是下载完成）
                # ——不补这一刀的话，截断文件会被当作「下载完成」直接去校验，报「SHA256 校验失败」且不重试
                if total and task.downloaded < total:
                    raise IOError("连接提前结束（%d / %d 字节），网络中断"
                                  % (task.downloaded, total))
            # 下载完成：校验哈希（期间响应暂停/取消）
            if task.expected_sha256:
                h = hashlib.sha256()
                with open(tmp, "rb") as f:
                    while True:
                        if cancel_ev.is_set():
                            task.status = ST_CANCELED
                            self._notify(task)
                            return
                        if pause_ev.is_set():
                            task.status = ST_PAUSED
                            self._notify(task)
                            return
                        b = f.read(CHUNK)
                        if not b:
                            break
                        h.update(b)
                if h.hexdigest().lower() != task.expected_sha256.lower():
                    # 校验失败：保留文件（可能是 C 站 CDN 哈希不匹配而非损坏），重命名为最终名
                    try:
                        os.replace(tmp, dest)
                    except OSError:
                        pass
                    task.status = ST_ERROR
                    task.error = "SHA256 校验失败（文件已保留；可能为 C 站哈希不匹配或下载不完整）"
                    self._notify(task)
                    return
            os.replace(tmp, dest)
            task.status = ST_DONE
            task.progress = 100.0
            task.speed = 0.0
            self._notify(task)
        except urllib.error.HTTPError as e:
            task.status = ST_ERROR
            task.error = "HTTP %d: %s" % (e.code, e.reason)
        except Exception as e:
            task.status = ST_ERROR
            task.error = str(e)[:200]
        finally:
            self._notify(task)
