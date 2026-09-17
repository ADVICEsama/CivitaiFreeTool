# -*- coding: utf-8 -*-
"""CivitaiFreeTool Web 版后端：pywebview js_api bridge
前端（web/index.html）通过 window.pywebview.api 调用；耗时任务后台线程 + 前端轮询进度。
业务逻辑复用 civitai_api / downloader / model_manager / reverse_parse / translator / config。"""
import json
import os
import re
import shutil
import threading
import time

import webview

APP_VERSION = "2.1.73"

import civitai_api
import config
import downloader
import model_manager
import posix_compat
import reverse_parse
import translator
import browser_bridge
from gui import (_download_image, _recycle_to_trash, _text_to_rules, _rules_to_text,
                 _folder_visible, _friendly_api_error)


def _todo_label(url):
    """从模型链接里取个可读名字（没存 label 的老条目用）：优先 slug，退化为「模型 ID」"""
    m = re.search(r"/models/(\d+)(?:/([^/?#]+))?", url or "")
    if not m:
        return (url or "")[:60]
    slug = (m.group(2) or "").strip()
    if slug:
        return slug.replace("-", " ").replace("_", " ").strip()
    return "模型 %s" % m.group(1)


def _vkey(name):
    """语义化版本排序键：v1 < v1.1 < v1.2 < v1.10 < v2（数字段按数值比，字母段按字典序）

    用于「同底模可用版本」下拉的排序 —— 绝不能用字符串排序（v1.10 会排到 v1.2 前面）。
    """
    parts = re.findall(r"\d+|[A-Za-z]+", str(name or ""))
    out = []
    for p in parts[:10]:
        out.append((0, int(p), "") if p.isdigit() else (1, 0, p.lower()))
    return out


class Api:
    def __init__(self):
        self.cfg = config.load()
        self.api = self._new_api()
        self.dl = downloader.Downloader(self.cfg, on_update=self._on_dl_update)
        # 浏览器桥：Chrome 扩展一键下载当前页面（127.0.0.1 本地 HTTP，静默失败）
        browser_bridge.set_download_handler(self.dl_enqueue_url_sync)
        browser_bridge.set_api(self)     # 浏览器模式：/api/rpc 的方法调用目标
        browser_bridge.start(version=APP_VERSION)
        self._dl_asked_move = set()   # 本次会话已询问过移动的任务 id
        self.lock = threading.Lock()
        # 模型管理
        self.model_rows = []
        self.mm_checked_paths = []
        self.mm_progress = {"running": False, "total": 0, "done": 0, "msg": "", "result": None}
        self._mm_cancel = False          # 长任务的中断标志（检查更新/查重/扫描共用）
        # 更新检测状态 + 缓存（model_updates.json：{path: {...}}）
        self._mm_upd_state = {"running": False, "total": 0, "done": 0, "newer": 0, "other_base": 0,
                              "msg": "", "checked_at": 0, "items": {}}
        self._updates = self._load_updates()
        self.mm_scan_state = {"running": False, "rows": [], "msg": ""}
        self.rp_rows = []
        self._rp_state = {"running": False, "paused": False, "done": 0, "total": 0}
        self._rp_pause_ev = threading.Event()
        self._rp_stop_ev = threading.Event()

    def _new_api(self):
        return civitai_api.CivitaiAPI(
            self.cfg.get("api_key", ""), 20,
            self.cfg.get("proxy_address") if self.cfg.get("proxy_enabled") else None,
            self.cfg.get("ssl_verify", True))

    # ---------------- 下载完成回调 ----------------
    def _on_dl_update(self, task):
        """Downloader 状态回调：任务完成时后台生成 metadata + 下载封面"""
        if task.status != downloader.ST_DONE:
            return
        threading.Thread(target=self._handle_dl_done, args=(task,), daemon=True).start()

    def _handle_dl_done(self, task):
        try:
            dest = os.path.join(task.dest_dir, task.filename)
            if not os.path.exists(dest):
                return
            base = os.path.splitext(dest)[0]
            meta = (task.info or {}).get("meta") or {}
            # 1) metadata 文件（按配置）
            if self.cfg.get("gen_metadata", True):
                fmt = self.cfg.get("metadata_format", "sd")
                m = meta.get("info")
                sd = meta.get("sd")
                try:
                    if fmt in ("civitai", "both") and m:
                        with open(base + ".civitai.info", "w", encoding="utf-8") as f:
                            json.dump(m, f, ensure_ascii=False, indent=2)
                    if fmt in ("sd", "both") and sd:
                        with open(base + ".json", "w", encoding="utf-8") as f:
                            json.dump(sd, f, ensure_ascii=False, indent=2)
                except Exception:
                    pass
            # 2) 封面下载（后台，已存在则跳过；走代理，直连 C 站图片 CDN 会被墙）
            if self.cfg.get("download_cover", True):
                imgs = (meta.get("info") or {}).get("images") or []
                if imgs and imgs[0].get("url"):
                    try:
                        _download_image(imgs[0]["url"], base + ".preview.png",
                                        proxy=self.cfg.get("proxy_address") if self.cfg.get("proxy_enabled") else None,
                                        verify=self.cfg.get("ssl_verify", True))
                    except Exception:
                        pass
            # 3) 「当前目标」与任务实际落地目录不一致时自动归位（不再弹窗询问）：
            #    - 没被单独指定过的任务：跟当前全局目标（HF 任务带相对子目录，不丢结构）
            #    - 单独指定过的任务：以其指定目录为准，这里不动它
            try:
                want = self._task_intended_dir(task)
                if want and os.path.abspath(os.path.dirname(dest)) != os.path.abspath(want):
                    os.makedirs(want, exist_ok=True)
                    self.move_file_to(dest, want)
            except Exception:
                pass
            # 4) 「更新下载」完成：按设置处理旧版本（默认保留；删除走回收站，可还原）
            try:
                old = str((task.info or {}).get("replace_old") or "")
                keep = str(self.cfg.get("update_keep_old", "keep") or "keep").strip().lower() != "delete"
                if old and (not keep) and os.path.exists(old) and os.path.abspath(old) != os.path.abspath(dest):
                    if posix_compat.IS_WINDOWS:
                        from gui import _recycle_to_trash
                        _recycle_to_trash([old])
                    else:
                        posix_compat.trash([old])
                    # 旧版的附属文件一并回收（预览图/元数据）
                    try:
                        od = os.path.dirname(old)
                        ob = os.path.splitext(os.path.basename(old))[0]
                        side = [os.path.join(od, ob + s) for s in
                                (".preview.png", ".preview.jpg", ".preview.webp", ".txt", ".json", ".civitai.info")
                                if os.path.exists(os.path.join(od, ob + s))]
                        if side:
                            if posix_compat.IS_WINDOWS:
                                _recycle_to_trash(side)
                            else:
                                posix_compat.trash(side)
                    except Exception:
                        pass
                    task.info["replace_old"] = ""
                    try:
                        self.dl.save_tasks()
                    except Exception:
                        pass
            except Exception:
                pass

        except Exception:
            pass

    def move_file_to(self, path, dest_dir):
        """把模型（含 json/预览图等附属）移动到目标文件夹，并更新任务持久化"""
        path = (path or "").strip()
        dest_dir = (dest_dir or "").strip()
        if not path or not os.path.exists(path):
            return {"ok": False, "msg": "文件不存在"}
        if not os.path.isdir(dest_dir):
            return {"ok": False, "msg": "目标目录无效"}
        if os.path.abspath(os.path.dirname(path)) == os.path.abspath(dest_dir):
            return {"ok": True, "msg": "文件已在目标目录"}
        base = os.path.splitext(os.path.basename(path))[0]
        src_dir = os.path.dirname(path)
        moved = []
        try:
            for f in [path] + [os.path.join(src_dir, base + s) for s in
                               (".preview.png", ".preview.jpg", ".preview.webp", ".preview.gif",
                                ".txt", ".json", ".civitai.info")]:
                if os.path.exists(f):
                    shutil.move(f, os.path.join(dest_dir, os.path.basename(f)))
                    moved.append(os.path.basename(f))
        except Exception as e:
            return {"ok": False, "msg": "移动失败: %s" % e}
        # 更新任务持久化路径
        try:
            for t in self.dl.tasks:
                if t.dest_dir and os.path.abspath(t.dest_dir) == os.path.abspath(src_dir) \
                        and t.filename == os.path.basename(path):
                    t.dest_dir = dest_dir
            self.dl.save_tasks()
        except Exception:
            pass
        return {"ok": True, "msg": "已移动 %d 个文件到 %s" % (len(moved), dest_dir)}

    # ---------------- 下载目标文件夹（下载页选择 / 设置里预设） ----------------
    def _dest_dir(self):
        """下载落地目录：优先「下载目标文件夹」，否则默认下载目录"""
        t = (self.cfg.get("download_target_dir") or "").strip()
        if t and os.path.isdir(t):
            return t
        return (self.cfg.get("download_dir") or "").strip()

    def open_in_browser(self):
        """用系统浏览器打开同一套界面（浏览器模式/窗口模式都可用；窗口模式可当备用显示器）"""
        try:
            import webbrowser
            port = browser_bridge.port() or browser_bridge.DEFAULT_PORT
            url = "http://127.0.0.1:%d/" % port
            webbrowser.open(url)
            return {"ok": True, "msg": "已在浏览器打开：%s" % url}
        except Exception as e:
            return {"ok": False, "msg": str(e)[:120]}

    def get_download_target(self):
        """当前下载目标文件夹（空 = 默认下载目录）"""
        t = (self.cfg.get("download_target_dir") or "").strip()
        return json.dumps({
            "ok": True,
            "target": t if (t and os.path.isdir(t)) else "",
            "default": self.cfg.get("download_dir") or "",
            "models_root": self.cfg.get("models_dir") or "",
        }, ensure_ascii=False)

    def set_download_target(self, path):
        """设置下载落地文件夹（必须位于模型管理目录内；传空 = 恢复默认下载目录）"""
        p = (path or "").strip()
        if p:
            if not os.path.isdir(p):
                return json.dumps({"ok": False, "msg": "文件夹不存在: %s" % p}, ensure_ascii=False)
            if not self._target_allowed(p):
                return json.dumps({"ok": False, "msg": "请选择模型目录内的文件夹"}, ensure_ascii=False)
        self.cfg["download_target_dir"] = p
        try:
            config.save(self.cfg)
        except Exception:
            pass
        # 顺带把「已完成但落在别处」的任务文件搬过去：用户选文件夹的预期就是文件到那儿去
        moved = 0
        if p:
            for t in list(self.dl.tasks):
                if t.status != downloader.ST_DONE:
                    continue
                if os.path.abspath(t.dest_dir or "") == os.path.abspath(p):
                    continue
                src = os.path.join(t.dest_dir or "", t.filename)
                if os.path.exists(src):
                    try:
                        if self.move_file_to(src, p).get("ok"):
                            moved += 1
                    except Exception:
                        pass
        msg = "下载目标已设为：%s" % (p or "默认下载目录")
        if moved:
            msg += "（顺带移动了 %d 个已完成的文件）" % moved
        return json.dumps({"ok": True, "target": p, "msg": msg, "moved": moved}, ensure_ascii=False)

    def _task_intended_dir(self, task):
        """任务「应该」落在哪：单独指定过的以指定为准；否则按当前全局目标（HF 任务带相对子目录）"""
        if (task.info or {}).get("dest_explicit"):
            return task.dest_dir or ""
        t = (self.cfg.get("download_target_dir") or "").strip()
        base = t if (t and os.path.isdir(t)) else (self.cfg.get("download_dir") or "").strip()
        rel = ((task.info or {}).get("hf_rel") or "").strip().strip("/\\")
        if rel and base:
            return os.path.join(base, rel.replace("/", os.sep))
        return base

    def _target_allowed(self, p):
        """目标文件夹是否允许（必须在模型管理目录或默认下载目录内，防误设到别处）"""
        if not p:
            return False
        ap = os.path.abspath(p)
        roots = [os.path.abspath(r) for r in (self._models_roots() or [])]
        dl = (self.cfg.get("download_dir") or "").strip()
        if dl:
            roots.append(os.path.abspath(dl))
        return any(ap == r or ap.startswith(r + os.sep) for r in roots if r)

    def set_task_target(self, task_id, path):
        """给**单个**下载任务指定保存文件夹（下载管理列表「保存到」列点选）。

        - 等待中/暂停/失败/已取消：改目标；已有 .part 半成品一并搬过去（断点续传进度不丢）
        - 已完成：把文件（含 json/封面等附属）移动到新文件夹
        - 下载中：先暂停再改（避免下载半途换目录）
        """
        p = (path or "").strip()
        if not p or not os.path.isdir(p):
            return {"ok": False, "msg": "目标文件夹无效"}
        if not self._target_allowed(p):
            return {"ok": False, "msg": "请选择模型目录内的文件夹"}
        t = next((x for x in self.dl.tasks if x.id == task_id), None)
        if t is None:
            return {"ok": False, "msg": "任务不存在（可能已被移除）"}
        was_downloading = False
        if t.status == downloader.ST_DOWNLOADING:
            # 正在下载就自动暂停 → 等下载线程真正停下（_active_ids 清空，避免边写边搬）→ 再改
            # 注意：改完必须自动继续，否则用户会看到「只是换个文件夹，下载却停了」
            was_downloading = True
            try:
                self.dl.pause_task(t)
            except Exception:
                ev = self.dl._pause_events.get(t.id)
                if ev:
                    ev.set()
            for _ in range(60):
                if t.id not in self.dl._active_ids:
                    break
                time.sleep(0.2)
        if os.path.abspath(t.dest_dir or "") == os.path.abspath(p):
            return {"ok": True, "msg": "已在该文件夹"}
        # 标记为「单独指定」：完成时的自动归位不再把它搬回全局目标
        if not isinstance(t.info, dict):
            t.info = {}
        t.info["dest_explicit"] = True
        if t.status == downloader.ST_DONE:
            src = os.path.join(t.dest_dir or "", t.filename)
            if os.path.exists(src):
                r = self.move_file_to(src, p)
                if r.get("ok"):
                    return {"ok": True, "msg": "已移动到 %s" % p}
                return r
            t.dest_dir = p
            try:
                self.dl.save_tasks()
            except Exception:
                pass
            return {"ok": True, "msg": "已更新保存位置（原位置找不到文件，未移动）"}
        # pending / paused / error / canceled：改目标，半成品搬家保证续传
        old = t.dest_dir or ""
        if old:
            part = os.path.join(old, t.filename + ".part")
            if os.path.exists(part):
                try:
                    os.makedirs(p, exist_ok=True)
                    dest_part = os.path.join(p, t.filename + ".part")
                    if not os.path.exists(dest_part):
                        shutil.move(part, dest_part)
                except Exception as e:
                    return {"ok": False, "msg": "半成品搬移失败: %s" % e}
        t.dest_dir = p
        try:
            self.dl.save_tasks()
        except Exception:
            pass
        if was_downloading:
            # 自动继续：整个换目录过程只中断约 1 秒（等下载线程停 → 搬半成品 → 立即续传），用户基本无感
            try:
                self.dl.resume_task(t)
                return {"ok": True, "msg": "已改为 %s，下载已自动继续（断点续传）" % p}
            except Exception as e:
                return {"ok": True, "msg": "已改为 %s（自动继续失败，请手动点继续：%s）" % (p, str(e)[:60])}
        return {"ok": True, "msg": "保存位置已改为 %s" % p}

    # ---------------- 配置 ----------------
    def _models_roots(self):
        """有效的模型管理目录列表（多目录支持：models_dirs + 兼容 models_dir）"""
        dirs = self.cfg.get("models_dirs") or []
        if not isinstance(dirs, list):
            dirs = [dirs] if dirs else []
        dirs = [str(d).strip().rstrip("/\\") for d in dirs if str(d) and str(d).strip()]
        legacy = (self.cfg.get("models_dir") or "").strip().rstrip("/\\")
        if legacy and legacy not in dirs:
            dirs.insert(0, legacy)
        # 去重保序 + 只留存在的目录
        seen, out = set(), []
        for d in dirs:
            if d not in seen:
                seen.add(d)
                if os.path.isdir(d):
                    out.append(d)
        return out

    def _root_of(self, path):
        """返回包含该文件的模型目录根（多目录时定位归属）"""
        roots = self._models_roots() or [(self.cfg.get("models_dir") or "").strip().rstrip("/\\")]
        p = (path or "").replace("\\", "/").lower()
        for r in roots:
            rn = r.replace("\\", "/").lower().rstrip("/")
            if p == rn or p.startswith(rn + "/"):
                return r
        return roots[0] if roots else ""

    def get_config(self):
        return self.cfg

    def save_config(self, new_cfg):
        # 真 merge：只更新传入字段，绝不回退未传入的已保存设置
        for k, v in (new_cfg or {}).items():
            self.cfg[k] = v
        # 多目录规范化：去空、去重、保序；空列表时兼容回退 models_dir
        dirs = self.cfg.get("models_dirs") or []
        if not isinstance(dirs, list):
            dirs = [dirs] if dirs else []
        seen, out = set(), []
        for d in dirs:
            d = str(d).strip()
            if d and d not in seen:
                seen.add(d)
                out.append(d)
        self.cfg["models_dirs"] = out
        if not out:
            self.cfg["models_dirs"] = []
        elif self.cfg.get("models_dir") not in out:
            self.cfg["models_dir"] = out[0]
        self.cfg["api_key"] = str(self.cfg.get("api_key") or "").strip()
        ok = config.save(self.cfg)
        self.api = self._new_api()
        self.dl.cfg = self.cfg
        return ok

    # ---------------- 对话框 ----------------
    def pick_dir(self):
        try:
            return webview.windows[0].create_file_dialog(webview.FOLDER_DIALOG)
        except Exception:
            return None

    def pick_files(self):
        try:
            r = webview.windows[0].create_file_dialog(
                webview.OPEN_DIALOG,
                file_types=("模型文件 (*.safetensors;*.ckpt;*.pt;*.pth;*.bin;*.gguf;*.onnx)", "所有文件 (*.*)"))
            return list(r) if r else []
        except Exception:
            return []

    # ---------------- 批量下载 ----------------
    def parse_urls(self, urls):
        """解析 URL 并加入下载队列（后台线程），返回任务 id 用于轮询进度"""
        urls = [u for u in (urls or []) if u and u.strip()]
        if not urls:
            return {"started": False, "msg": "没有链接"}
        state = {"running": True, "total": len(urls), "done": 0, "items": [], "finished": False}
        self._parse_state = state

        def work():
            api = self.api
            for u in urls:
                try:
                    model_id, version_id = api.resolve_url(u)
                    if not version_id:
                        m = api.get_model(model_id)
                        vs = m.get("modelVersions") or []
                        if not vs:
                            state["items"].append({"url": u, "ok": False, "msg": "模型没有可用版本"})
                            state["done"] += 1
                            continue
                        version_id = vs[0]["id"]
                    version = api.get_model_version(version_id)
                    # Early Access / 不可用（付费）→ 不入队，标记 paid 供前端选择
                    model_obj = None
                    try:
                        if model_id:
                            model_obj = api.get_model(model_id)
                    except civitai_api.CivitaiError:
                        pass
                    avail = version.get("availability") or (model_obj or {}).get("availability") or ""
                    if avail in ("EarlyAccess", "Unavailable"):
                        state["items"].append({"url": u, "ok": False, "paid": True,
                                               "deadline": version.get("earlyAccessDeadline") or 0,
                                               "msg": "需付费（Early Access）"})
                        state["done"] += 1
                        continue
                    f, _ = api.pick_file(version)
                    hashes = f.get("hashes") or {}
                    model_obj = None
                    model_name = ""
                    if model_id:
                        try:
                            model_obj = api.get_model(model_id)
                            model_name = model_obj.get("name") or ""
                        except civitai_api.CivitaiError:
                            pass
                    src_ext = os.path.splitext(f.get("name") or "")[1] or ".safetensors"
                    base_name = os.path.splitext(f.get("name") or "")[0]
                    base_name = model_manager.sanitize_filename(base_name) or model_name
                    if self.cfg.get("translate_filename", False) and model_name:
                        if translator._is_cjk(model_name):
                            base_name = model_manager.sanitize_filename(model_name)
                        else:
                            try:
                                zh = translator.translate(
                                    model_name,
                                    appid=(self.cfg.get("baidu_appid") or "").strip(),
                                    key=(self.cfg.get("baidu_key") or "").strip())
                                if zh and zh != model_name:
                                    base_name = model_manager.sanitize_filename(zh) or base_name
                            except Exception:
                                pass
                    ver = (version.get("name") or "").strip()
                    if ver:
                        base_name = "%s %s" % (base_name, model_manager.sanitize_filename(ver))
                    # 按设置清理逗号/括号等符号（防 ComfyUI 提示词解析把逗号当分隔导致找不到 lora）
                    base_name = model_manager.clean_model_name(
                        base_name, self.cfg.get("rename_clean_rules")) or base_name
                    fname = base_name + src_ext
                    sd_d = (self.cfg.get("site_domain", "civitai.red") or "civitai.red").strip("/")
                    site_base = sd_d if "://" in sd_d else "https://" + sd_d
                    meta = {}
                    try:
                        meta = {
                            "info": reverse_parse.build_info(model_obj, version, site_base),
                            "sd": reverse_parse.build_sd_metadata(model_obj, version, site_base),
                        }
                    except Exception:
                        pass
                    task = downloader.DownloadTask(
                        url=api.build_download_url(version_id, f.get("id")),
                        dest_dir="",   # 下载开始时才解析落地目录（入队后再换文件夹也生效）
                        filename=fname,
                        expected_sha256=hashes.get("SHA256") or "",
                        info={"modelName": model_name,
                              "versionName": version.get("name", ""), "url": u, "meta": meta})
                    self.dl.add_task(task)
                    state["items"].append({"url": u, "ok": True, "msg": "已加入: %s" % fname})
                except Exception as e:
                    state["items"].append({"url": u, "ok": False, "msg": str(e)[:120]})
                state["done"] += 1
            state["running"] = False
            state["finished"] = True

        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

    def get_parse_state(self):
        return getattr(self, "_parse_state", {"running": False, "items": [], "finished": False})

    # ---------------- 下载管理 ----------------
    def get_tasks(self):
        """精简任务列表（不含 meta/info 大对象）"""
        with self.lock:
            out = []
            for t in self.dl.tasks:
                out.append({
                    "id": t.id, "filename": t.filename, "status": t.status,
                    "progress": t.progress, "speed": t.speed,
                    "downloaded": t.downloaded, "total": t.total,
                    "error": t.error, "dest_dir": t.dest_dir,
                    "url": (t.info or {}).get("url", ""),
                    "modelName": (t.info or {}).get("modelName", ""),
                    "versionName": (t.info or {}).get("versionName", ""),
                })
            return out

    def copy_text(self, text):
        """写入系统剪贴板（Windows: Win32，64 位安全 argtypes；其他: wl-copy/xclip）"""
        if not posix_compat.IS_WINDOWS:
            return posix_compat.copy_clipboard_text(text)
        import ctypes
        try:
            u = ctypes.windll.user32
            k = ctypes.windll.kernel32
            u.OpenClipboard.argtypes = [ctypes.c_void_p]
            u.OpenClipboard.restype = ctypes.c_bool
            u.EmptyClipboard.restype = ctypes.c_bool
            u.SetClipboardData.argtypes = [ctypes.c_uint, ctypes.c_void_p]
            u.SetClipboardData.restype = ctypes.c_void_p
            u.CloseClipboard.restype = ctypes.c_bool
            k.GlobalAlloc.argtypes = [ctypes.c_uint, ctypes.c_size_t]
            k.GlobalAlloc.restype = ctypes.c_void_p
            k.GlobalLock.argtypes = [ctypes.c_void_p]
            k.GlobalLock.restype = ctypes.c_void_p
            k.GlobalUnlock.argtypes = [ctypes.c_void_p]
            k.GlobalUnlock.restype = ctypes.c_bool
            text = str(text or "")
            if not u.OpenClipboard(None):
                return False
            try:
                u.EmptyClipboard()
                buf = ctypes.create_unicode_buffer(text)
                size = (len(text) + 1) * 2
                h = k.GlobalAlloc(0x42, size)  # GMEM_MOVEABLE | GMEM_ZEROINIT
                if not h:
                    return False
                p = k.GlobalLock(h)
                if not p:
                    return False
                ctypes.memmove(p, buf, size)
                k.GlobalUnlock(h)
                u.SetClipboardData(13, h)  # CF_UNICODETEXT（此后 h 归剪贴板所有，不再释放）
                return True
            finally:
                u.CloseClipboard()
        except Exception:
            return False

    def get_clipboard(self):
        """读取系统剪贴板文本（Windows: Win32；其他: wl-paste/xclip）"""
        if not posix_compat.IS_WINDOWS:
            return posix_compat.get_clipboard_text()
        import ctypes
        try:
            u = ctypes.windll.user32
            k = ctypes.windll.kernel32
            u.OpenClipboard.argtypes = [ctypes.c_void_p]
            u.OpenClipboard.restype = ctypes.c_bool
            u.IsClipboardFormatAvailable.argtypes = [ctypes.c_uint]
            u.IsClipboardFormatAvailable.restype = ctypes.c_bool
            u.GetClipboardData.argtypes = [ctypes.c_uint]
            u.GetClipboardData.restype = ctypes.c_void_p
            k.GlobalLock.argtypes = [ctypes.c_void_p]
            k.GlobalLock.restype = ctypes.c_void_p
            k.GlobalUnlock.argtypes = [ctypes.c_void_p]
            k.GlobalUnlock.restype = ctypes.c_bool
            u.CloseClipboard.restype = ctypes.c_bool
            if not u.OpenClipboard(None):
                return ""
            try:
                if not u.IsClipboardFormatAvailable(13):  # CF_UNICODETEXT
                    return ""
                h = u.GetClipboardData(13)
                if not h:
                    return ""
                p = k.GlobalLock(h)
                if not p:
                    return ""
                try:
                    buf = ctypes.c_wchar_p(p)
                    return buf.value or ""
                finally:
                    k.GlobalUnlock(h)
            finally:
                u.CloseClipboard()
        except Exception:
            return ""

    def open_in_folder(self, path):
        """在资源管理器中打开并选中文件/文件夹。
        用 Windows Shell API（SHOpenFolderAndSelectItems）——这是资源管理器
        「在文件夹中显示」的底层实现：无命令行解析、不闪黑窗、路径带空格也可靠。
        之前 explorer /select 命令行方式会被桌面进程接管导致乱开桌面/我的文档。"""
        import os
        if not path or not os.path.exists(path):
            return {"ok": False, "msg": "路径不存在"}
        if not posix_compat.IS_WINDOWS:
            return posix_compat.open_in_folder(path)
        try:
            import ctypes
            from ctypes import wintypes
            path = os.path.abspath(path)
            target = path if os.path.isfile(path) else None
            folder = os.path.dirname(path) if target else path
            ctypes.windll.ole32.CoInitialize(None)
            try:
                folder_pidl = ctypes.c_void_p()
                hr = ctypes.windll.shell32.SHParseDisplayName(
                    wintypes.LPCWSTR(folder), None, ctypes.byref(folder_pidl), 0, None)
                if hr != 0 or not folder_pidl.value:
                    return {"ok": False, "msg": "无法解析目录"}
                try:
                    if target:
                        file_pidl = ctypes.c_void_p()
                        hr2 = ctypes.windll.shell32.SHParseDisplayName(
                            wintypes.LPCWSTR(target), None, ctypes.byref(file_pidl), 0, None)
                        if hr2 == 0 and file_pidl.value:
                            pidls = (ctypes.c_void_p * 1)(file_pidl)
                            ctypes.windll.shell32.SHOpenFolderAndSelectItems(
                                folder_pidl, 1, pidls, 0)
                            ctypes.windll.ole32.CoTaskMemFree(file_pidl)
                        else:
                            ctypes.windll.shell32.SHOpenFolderAndSelectItems(
                                folder_pidl, 0, None, 0)
                    else:
                        ctypes.windll.shell32.SHOpenFolderAndSelectItems(
                            folder_pidl, 0, None, 0)
                finally:
                    ctypes.windll.ole32.CoTaskMemFree(folder_pidl)
                return {"ok": True}
            finally:
                ctypes.windll.ole32.CoUninitialize()
        except Exception:
            # 兜底：ShellExecute 打开所在目录
            try:
                import os as _os
                _os.startfile(folder if not target else _os.path.dirname(path))
                return {"ok": True}
            except Exception:
                return {"ok": False, "msg": "无法打开"}

    def dl_action(self, action, filenames=None):
        tasks = [t for t in self.dl.tasks if t.filename in (filenames or [])]
        if action == "start_all":
            for t in list(self.dl.tasks):
                if t.status in (downloader.ST_PENDING, downloader.ST_PAUSED, downloader.ST_ERROR):
                    if t.status == downloader.ST_ERROR:
                        self.dl.retry_task(t)
                    else:
                        self.dl.resume_task(t)
        elif action == "pause":
            for t in tasks:
                self.dl.pause_task(t)
        elif action == "retry":
            for t in tasks:
                self.dl.retry_task(t)
        elif action == "remove":
            for t in tasks:
                self.dl.remove_task(t)
        elif action == "clear_done":
            self.dl.clear_finished()
        elif action == "save":
            self.dl.save_tasks()
        return True

    # ---------------- 模型管理 ----------------
    def scan_models(self):
        """后台扫描；返回立即，进度/结果轮询 get_scan_state"""
        if self.mm_scan_state["running"]:
            return {"started": False}
        self.mm_scan_state = {"running": True, "rows": [], "msg": ""}

        def work():
            try:
                roots = self._models_roots()
                files = []
                for root in roots:
                    files.extend(model_manager.scan_models(root))
                hidden = set(self.cfg.get("hidden_model_folders", []))
                show_root = self.cfg.get("show_root_models", True)
                files = [f for f in files if _folder_visible(f["rel"], hidden, show_root)]
                rows = []
                for f in files:
                    info_path = model_manager.find_info_file(f["path"])
                    meta = {}
                    if info_path:
                        try:
                            with open(info_path, "r", encoding="utf-8") as fh:
                                meta = json.load(fh)
                        except Exception:
                            meta = {}
                    v = meta.get("version")
                    ver = v.get("name", "") if isinstance(v, dict) else (v or "")
                    tw = meta.get("trainedWords") or meta.get("trained_words") \
                        or meta.get("trigger_words") or []
                    rows.append({
                        "path": f["path"], "name": f["name"], "size": f["size"],
                        "mtime": f.get("mtime") or 0,
                        "type": meta.get("type", ""),
                        "base": meta.get("baseModel") or meta.get("base_model", ""),
                        "ver": ver,
                        "verId": meta.get("versionId") or meta.get("version_id", ""),
                        "modelId": meta.get("modelId") or meta.get("model_id", ""),
                        "url": meta.get("url", ""),
                        "trainedWords": tw,
                        "civitai_name": meta.get("name", ""),
                        "info": meta,
                    })
                self.mm_scan_state["rows"] = rows
                self.model_rows = rows
                self.mm_scan_state["msg"] = "扫描完成：%d 个模型" % len(rows)
            except Exception as e:
                self.mm_scan_state["msg"] = "扫描失败: %s" % e
            finally:
                self.mm_scan_state["running"] = False

        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

    def get_scan_state(self):
        """轻量轮询状态（不含行数据，避免桥接传输大对象卡死）"""
        return {"running": self.mm_scan_state["running"],
                "msg": self.mm_scan_state["msg"],
                "total": len(self.mm_scan_state["rows"])}

    def get_scan_rows(self):
        """精简行数据，以 JSON 字符串返回（规避 js_api 大 list 转换问题）"""
        rows = []
        for r in self.model_rows:
            rows.append({
                "path": r.get("path", ""), "name": r.get("name", ""),
                "size": r.get("size", 0), "mtime": r.get("mtime") or 0,
                "type": r.get("type", ""), "base": r.get("base", ""),
                "ver": r.get("ver", ""), "verId": r.get("verId", ""),
                "modelId": r.get("modelId", ""), "url": r.get("url", ""),
                "trainedWords": r.get("trainedWords", []),
                "civitai_name": r.get("civitai_name", ""),
                "update": r.get("update", ""), "hash": r.get("hash", ""),
            })
        return json.dumps(rows, ensure_ascii=False)

    def get_model_detail(self, path):
        """模型详情（C 站风格二级界面）：完整 info + 封面画廊"""
        info = {}
        info_path = model_manager.find_info_file(path)
        if info_path:
            try:
                with open(info_path, "r", encoding="utf-8") as f:
                    info = json.load(f)
            except Exception:
                info = {}
        # 字段归一化：扁平 json（trained_words/trigger_words）→ 全结构 trainedWords
        if info and not info.get("trainedWords"):
            info["trainedWords"] = info.get("trained_words") or info.get("trigger_words") or []
        images = info.get("images") or []

        def _img_prompt(idx):
            """按 C 站 images 序号取 (正面, 负面) 提示词（下载图按 image_%02d 命名，一一对应）"""
            try:
                if 0 <= idx < len(images):
                    meta = images[idx].get("meta") or {}
                    return meta.get("prompt") or "", meta.get("negativePrompt") or ""
            except Exception:
                pass
            return "", ""

        def _local_img_prompt(fp):
            """从本地图片文件读元数据（PNG tEXt 的 parameters / A1111 格式）。
            返回 (正面, 负面)，无元数据返回 (None, None)"""
            try:
                from PIL import Image
                im = Image.open(fp)
                params = (im.info or {}).get("parameters") or (im.info or {}).get("prompt") or ""
                if not params:
                    return None, None
                neg = ""
                p = params
                if "\nNegative prompt:" in p:
                    head, rest = p.split("\nNegative prompt:", 1)
                    p = head
                    neg = rest.split("\n")[0].strip() if rest else ""
                return p.strip(), neg
            except Exception:
                return None, None

        covers = []
        # 本地封面：优先 <base>.images/ 目录全部图片
        base = os.path.splitext(path)[0]
        imgs_dir = base + ".images"
        img_files = []
        if os.path.isdir(imgs_dir):
            for fn in sorted(os.listdir(imgs_dir)):
                if fn.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                    img_files.append(os.path.join(imgs_dir, fn))
        cover = model_manager.find_cover(path)
        if img_files:
            cover = img_files[0]
        # 本地封面占用 C 站前 N 张（下载图按 image_%02d 顺序），URL 图从 N 开始避免重复
        url_start = len(img_files) if img_files else (1 if (cover and os.path.exists(cover)) else 0)
        if cover and os.path.exists(cover):
            try:
                from PIL import Image
                import io
                import base64 as _b64
                im = Image.open(cover).convert("RGB")
                im.thumbnail((512, 512))
                buf = io.BytesIO()
                im.save(buf, "JPEG", quality=85)
                _p, _n = _local_img_prompt(cover)
                if _p is None:
                    _p, _n = _img_prompt(0)
                covers.append({"b64": _b64.b64encode(buf.getvalue()).decode(),
                               "local": True, "local_path": cover,
                               "prompt": _p, "negative": _n})
            except Exception:
                pass
        # 追加 C 站 URL 图（跳过本地封面已占的序号 + url 去重）
        for i, img in enumerate(images[:8]):
            if i < url_start:
                continue
            u = img.get("url")
            if u and not any(c.get("url") == u for c in covers):
                covers.append({"url": u,
                               "prompt": (img.get("meta") or {}).get("prompt") or "",
                               "negative": (img.get("meta") or {}).get("negativePrompt") or "",
                               "orig_url": img.get("url") or ""})
        # 本地 images 目录其余图补入（文件名 image_%02d → 序号匹配 prompt）
        for fp in img_files[1:]:
            try:
                from PIL import Image
                import io as _io
                import base64 as _b64
                im = Image.open(fp).convert("RGB")
                im.thumbnail((512, 512))
                buf = _io.BytesIO()
                im.save(buf, "JPEG", quality=82)
                idx = -1
                fn = os.path.basename(fp)
                if fn.lower().startswith("image_") and fn[6:8].isdigit():
                    idx = int(fn[6:8]) - 1
                _p, _n = _local_img_prompt(fp)
                if _p is None:
                    _p, _n = _img_prompt(idx)
                covers.append({"b64": _b64.b64encode(buf.getvalue()).decode(),
                               "local": True, "local_path": fp,
                               "prompt": _p, "negative": _n})
            except Exception:
                pass
        return json.dumps({
            "ok": True,
            "path": path,
            "name": os.path.basename(path),
            "info": info,
            "covers": covers,
        }, ensure_ascii=False)

    def get_local_img_b64(self, path):
        """读取本地图片原图 → base64（用于复制图片到剪贴板）。超大图限制 4096px"""
        try:
            if not path or not os.path.exists(path):
                return json.dumps({"ok": False, "msg": "图片不存在"})
            from PIL import Image
            import io
            import base64 as _b64
            im = Image.open(path)
            if max(im.size) > 4096:
                im.thumbnail((4096, 4096), Image.LANCZOS)
            buf = io.BytesIO()
            if im.mode in ("RGBA", "LA"):
                im.save(buf, "PNG")
            else:
                im = im.convert("RGB")
                im.save(buf, "JPEG", quality=95)
            return json.dumps({"ok": True,
                               "b64": _b64.b64encode(buf.getvalue()).decode(),
                               "mime": "image/png" if im.mode in ("RGBA", "LA") else "image/jpeg"})
        except Exception as e:
            return json.dumps({"ok": False, "msg": str(e)})

    def get_version(self):
        """当前软件版本号（关于弹窗/更新说明用）"""
        return json.dumps({"ok": True, "version": APP_VERSION}, ensure_ascii=False)

    def cleanup_img_cache(self, preview=True):
        """清理伪 C 站图片缓存：删除所有 <模型名>.images/ 目录（下载全部图片的产物）。
        preview=True 只统计；False 执行删除。封面缩略图（preview.png）不受影响。"""
        import shutil
        roots = self._models_roots() or []
        dirs = []
        total_size = 0
        for root in roots:
            if not root or not os.path.isdir(root):
                continue
            for dirpath, dirnames, filenames in os.walk(root):
                for d in list(dirnames):
                    if d.lower().endswith(".images"):
                        fp = os.path.join(dirpath, d)
                        try:
                            sz = sum(os.path.getsize(os.path.join(r, f))
                                     for r, _, fs in os.walk(fp) for f in fs)
                        except Exception:
                            sz = 0
                        dirs.append({"path": fp, "size": sz})
                        total_size += sz
                        dirnames.remove(d)  # 不深入该缓存目录
        if preview:
            return json.dumps({"ok": True, "count": len(dirs), "size": total_size, "dirs": dirs},
                              ensure_ascii=False)
        removed = 0
        for d in dirs:
            try:
                shutil.rmtree(d["path"], ignore_errors=True)
                removed += 1
            except Exception:
                pass
        return json.dumps({"ok": True, "removed": removed}, ensure_ascii=False)

    def download_all_images(self, path):
        """download all C-site images to <base>.images/"""
        import urllib.request
        path = (path or "").strip()
        if not path or not os.path.exists(path):
            return json.dumps({"ok": False, "msg": "file not exists"})
        info = {}
        info_path = model_manager.find_info_file(path)
        if info_path:
            try:
                with open(info_path, "r", encoding="utf-8") as f:
                    info = json.load(f)
            except Exception:
                info = {}
        images = info.get("images") or []
        if not images:
            return json.dumps({"ok": False, "msg": "no images in info"})
        base = os.path.splitext(path)[0]
        out_dir = base + ".images"
        try:
            os.makedirs(out_dir, exist_ok=True)
        except Exception:
            pass
        n = 0
        total = len(images)
        self._img_dl_state = {"total": total, "done": 0}
        for i, im in enumerate(images):
            u = im.get("url") or ""
            if not u:
                self._img_dl_state["done"] = self._img_dl_state.get("done", 0) + 1
                continue
            low = u.lower()
            if ".webp" in low.split("?")[0]:
                ext = ".webp"
            elif ".png" in low.split("?")[0]:
                ext = ".png"
            else:
                ext = ".jpg"
            dest = os.path.join(out_dir, "image_%02d%s" % (i + 1, ext))
            if os.path.exists(dest):
                n += 1
                continue
            try:
                req = urllib.request.Request(u, headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CivitaiFreeTool/1.4",
                    "Referer": "https://civitai.com/",
                })
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = resp.read()
                with open(dest, "wb") as f:
                    f.write(data)
                n += 1
            except Exception:
                pass
            self._img_dl_state["done"] = self._img_dl_state.get("done", 0) + 1
        self._img_dl_state["done"] = total
        return json.dumps({"ok": True, "downloaded": n, "dir": out_dir})

    def wf_analyze_data(self, name, b64data):
        """drag-drop file: write base64 to temp then analyze"""
        import base64 as _b64
        import tempfile
        try:
            raw = _b64.b64decode(b64data or "")
            tmp = os.path.join(tempfile.gettempdir(), "cft_wf")
            os.makedirs(tmp, exist_ok=True)
            safe = os.path.basename((name or "wf_upload").replace("/", "_"))
            fp = os.path.join(tmp, safe)
            with open(fp, "wb") as f:
                f.write(raw)
            return self.analyze_workflow(fp)
        except Exception as e:
            return json.dumps({"ok": False, "msg": "write fail: %s" % e})

    def get_img_dl_state(self):
        """图片批量下载进度（前端轮询）"""
        st = getattr(self, "_img_dl_state", None)
        return json.dumps(st or {"total": 0, "done": 0})

    def _enqueue_one(self, url, dest_dir=None, skip_if_exists=False):
        """同步解析单条 URL 并入队（忽略付费状态）。返回 item dict：{url, ok, msg, task_id?}

        dest_dir 非空时表示「指定落点」（更新下载：新版直接下到旧版所在文件夹，且不被全局目标搬走）。
        skip_if_exists=True 时做防重复：目标文件已存在、或该版本已在队列里 → 直接跳过不重复下载。
        """
        api = self.api
        u = (url or "").strip()
        item = {"url": u, "ok": False, "msg": ""}
        try:
            model_id, version_id = api.resolve_url(u)
            if not version_id:
                m = api.get_model(model_id)
                vs = m.get("modelVersions") or []
                if not vs:
                    item["msg"] = "模型没有可用版本"
                    return item
                version_id = vs[0]["id"]
            version = api.get_model_version(version_id)
            f, _ = api.pick_file(version)
            hashes = f.get("hashes") or {}
            model_obj = None
            model_name = ""
            if model_id:
                try:
                    model_obj = api.get_model(model_id)
                    model_name = model_obj.get("name") or ""
                except civitai_api.CivitaiError:
                    pass
            src_ext = os.path.splitext(f.get("name") or "")[1] or ".safetensors"
            base_name = os.path.splitext(f.get("name") or "")[0]
            base_name = model_manager.sanitize_filename(base_name) or model_name
            ver = (version.get("name") or "").strip()
            if ver:
                base_name = "%s %s" % (base_name, ver)
            # 按设置清理逗号/括号等符号（防 ComfyUI 提示词解析把逗号当分隔导致找不到 lora）
            base_name = model_manager.clean_model_name(
                base_name, self.cfg.get("rename_clean_rules")) or base_name
            info = {"source": "civitai", "model_name": model_name or base_name,
                    "modelName": model_name, "versionName": version.get("name", "")}
            if model_id:
                info["model_id"] = model_id
                info["url"] = "https://%s/models/%s" % ((self.cfg.get("site_domain") or "civitai.red"), model_id)
            if version_id:
                info["version_id"] = version_id
            # 构建 meta（info + sd 元数据）→ 下载完成后自动生成 json 与封面缩略图
            sd_d = (self.cfg.get("site_domain", "civitai.red") or "civitai.red").strip("/")
            site_base = sd_d if "://" in sd_d else "https://" + sd_d
            meta = {}
            try:
                meta = {
                    "info": reverse_parse.build_info(model_obj, version, site_base),
                    "sd": reverse_parse.build_sd_metadata(model_obj, version, site_base),
                }
            except Exception:
                pass
            info["meta"] = meta
            dest_dir = (dest_dir or "").strip()   # 空 = 下载开始时才解析落地目录（入队后再换文件夹也生效）
            if dest_dir:
                info["dest_explicit"] = True      # 指定落点的（更新下载）不被全局目标/自动归位搬走
                try:
                    os.makedirs(dest_dir, exist_ok=True)
                except Exception:
                    pass
            dl_url = api.build_download_url(version_id, f.get("id")) if version_id else (f.get("downloadUrl") or "")
            if not dl_url:
                item["msg"] = "无下载链接"
                return item
            # ★ 防重复（更新下载专用）：同一版反复点「更新」不再重复入队/重复下载
            if skip_if_exists:
                tdir = (dest_dir or "").strip()
                fname = base_name + src_ext
                if tdir and os.path.exists(os.path.join(tdir, fname)):
                    item.update({"msg": "已经在目标文件夹里了：%s（要重新下载请先删掉它）" % fname, "skipped": True})
                    return item
                dup = self._dup_in_queue(version_id, hashes.get("SHA256"), fname, tdir)
                if dup:
                    item.update({"msg": "这个版本已经在下载队列里了（状态 %s），没有重复添加" % dup.status, "skipped": True})
                    return item
            task = downloader.DownloadTask(
                url=dl_url, dest_dir=dest_dir, filename=base_name + src_ext,
                expected_sha256=hashes.get("SHA256") or "", info=info)
            self.dl.add_task(task)
            item.update({"ok": True, "msg": "已加入队列: %s" % (base_name + src_ext), "task_id": task.id})
        except civitai_api.CivitaiError as e:
            item["msg"] = _friendly_api_error(str(e))[:300]
        except Exception as e:
            item["msg"] = str(e)[:200]
        return item

    def dl_enqueue_url(self, url):
        """强制解析单条 URL 并入队（忽略付费状态，用于「仍要下载」，后台执行）"""
        state = {"running": True, "total": 1, "done": 0, "items": [], "finished": False}
        self._parse_state = state

        def work():
            item = self._enqueue_one(url)
            state["items"].append(item)
            state["done"] += 1
            state["finished"] = True
            state["running"] = False

        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

    def dl_enqueue_url_sync(self, url):
        """同步解析并入队（Chrome 扩展桥用）：返回 {ok, msg, task_id?}，失败立即返回具体原因"""
        item = self._enqueue_one(url)
        if item.get("ok"):
            self._notify_ext_download_started()
        return {"ok": item.get("ok"), "msg": item.get("msg"), "task_id": item.get("task_id")}

    @staticmethod
    def _notify_ext_download_started():
        """入队成功后通知前端自动切到「下载管理」页（pywebview evaluate_js，失败静默）"""
        try:
            import webview as _wv
            for w in _wv.windows:
                try:
                    w.evaluate_js("window.__extDownloadStarted && window.__extDownloadStarted()")
                except Exception:
                    pass
        except Exception:
            pass

    def parse_image_models(self, url):
        """C 站图片链接 → 图片页用到的模型列表（__NEXT_DATA__ 提取 resources）"""
        import re
        m = re.match(r"https?://(?:civitai\.red|civitai\.com)/images/(\d+)", (url or "").strip())
        if not m:
            return json.dumps({"ok": False, "msg": "不是 C 站图片链接（需 civitai.red/com/images/{id}）"})
        iid = m.group(1)
        html = None
        for host in ("civitai.com", "civitai.red"):
            try:
                import requests
                r = requests.get("https://%s/images/%s" % (host, iid),
                                 headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
                                          "Accept-Language": "zh-CN,zh;q=0.9"},
                                 timeout=20)
                if r.status_code == 200:
                    html = r.text
                    break
            except Exception:
                continue
        if not html:
            return json.dumps({"ok": False, "msg": "图片页获取失败（可能被反爬拦截）"})
        mm = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
        if not mm:
            return json.dumps({"ok": False, "msg": "页面解析失败"})
        try:
            data = json.loads(mm.group(1))
        except Exception as e:
            return json.dumps({"ok": False, "msg": "页面数据解析失败: %s" % e})
        resources = self._find_image_resources(data) or []
        out = []
        for r in resources:
            out.append({
                "modelId": r.get("modelId"),
                "versionId": r.get("modelVersionId") or r.get("versionId"),
                "name": r.get("modelName") or r.get("name") or "",
                "type": r.get("modelType") or r.get("type") or "",
                "versionName": r.get("versionName") or "",
            })
        return json.dumps({"ok": True, "imageId": iid, "resources": out}, ensure_ascii=False)

    def _find_image_resources(self, obj):
        """递归查找 resources 数组（元素含 modelVersionId）"""
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k == "resources" and isinstance(v, list) and v and isinstance(v[0], dict) and v[0].get("modelVersionId"):
                    return v
                r = self._find_image_resources(v)
                if r:
                    return r
        elif isinstance(obj, list):
            for v in obj:
                r = self._find_image_resources(v)
                if r:
                    return r
        return None

    def download_image_models(self, url):
        """图片页全部模型批量入队：本地已存在同名文件则跳过"""
        import downloader
        res = json.loads(self.parse_image_models(url))
        if not res.get("ok"):
            return json.dumps(res)
        base = self.cfg.get("download_dir") or ""
        existing = set()
        if base and os.path.isdir(base):
            for dp, dn, fns in os.walk(base):
                dn[:] = [d for d in dn if not d.lower().endswith(".images")]
                for fn in fns:
                    if fn.lower().endswith((".safetensors", ".ckpt", ".pt", ".pth", ".gguf", ".bin")):
                        existing.add(fn.lower())
        added, skipped = 0, 0
        detail = []
        for r in res.get("resources") or []:
            mid, vid = r.get("modelId"), r.get("versionId")
            if not mid and not vid:
                continue
            try:
                if mid:
                    model = self.api.get_model(mid)
                    vs = model.get("modelVersions") or []
                    version = self.api.get_model_version(vs[0]["id"]) if vs else None
                else:
                    version = self.api.get_model_version(vid)
                if not version:
                    continue
                f = self.api.pick_file(version)
                if not f:
                    continue
                fname = f["name"]
                if fname.lower() in existing:
                    skipped += 1
                    detail.append({"name": r.get("name") or fname, "type": r.get("type") or "",
                                   "status": "skip"})
                    continue
                dl_url = self.api.build_download_url(version["id"], f.get("id"))
                task = downloader.DownloadTask(
                    url=dl_url,
                    dest_dir=base or "",
                    filename=fname,
                    info={"modelName": r.get("name") or fname, "versionName": r.get("versionName") or ""},
                )
                self.dl.add_task(task)
                added += 1
                existing.add(fname.lower())
                detail.append({"name": r.get("name") or fname, "type": r.get("type") or "",
                               "status": "add"})
            except Exception:
                continue
        return json.dumps({"ok": True, "added": added, "skipped": skipped,
                           "total": len(res.get("resources") or []), "detail": detail},
                          ensure_ascii=False)

    def rename_file(self, path, new_name):
        """右键自定义重命名：主文件 + 附属（preview/json/info/txt）同步改名"""
        import model_manager as mm
        path = (path or "").strip()
        new_name = (new_name or "").strip()
        if not path or not os.path.isfile(path):
            return {"ok": False, "msg": "文件不存在"}
        d = os.path.dirname(path)
        old_base = os.path.splitext(os.path.basename(path))[0]
        ext = os.path.splitext(os.path.basename(path))[1] or ".safetensors"
        # 只有用户输入以真实模型扩展名结尾时才视为自带扩展名，否则一律追加原扩展名
        # （避免输入含点（如 "v1.8 xxx"、"2026.8.15 xxx"）被 splitext 误判吃掉扩展名）
        _KNOWN_EXT = (".safetensors", ".ckpt", ".pt", ".pth", ".sft", ".safetensors", ".bin",
                      ".onnx", ".gguf", ".patch")
        if new_name.lower().endswith(_KNOWN_EXT):
            new_base = new_name
            new_name = os.path.splitext(new_name)[0]
        else:
            new_base = new_name + ext
        new_name = mm.sanitize_filename(new_name) or old_base
        new_base = mm.sanitize_filename(new_base) or (old_base + ext)
        new_path = os.path.join(d, new_base)
        if os.path.abspath(new_path).lower() == os.path.abspath(path).lower():
            return {"ok": False, "msg": "文件名未变化"}
        if os.path.exists(new_path):
            return {"ok": False, "msg": "目标文件已存在"}
        try:
            os.rename(path, new_path)
        except Exception as e:
            return {"ok": False, "msg": "重命名失败: %s" % e}
        for side in (".preview.png", ".preview.jpg", ".preview.webp", ".preview.gif",
                     ".txt", ".json", ".civitai.info"):
            old_side = os.path.join(d, old_base + side)
            if os.path.exists(old_side):
                try:
                    os.rename(old_side, os.path.join(d, new_name + side))
                except Exception:
                    pass
        return {"ok": True, "msg": "已重命名为 " + new_base}

    def rm_file(self, path):
        """右键删除：移入回收站（含附属文件）"""
        if posix_compat.IS_WINDOWS:
            from gui import _recycle_to_trash
        path = (path or "").strip()
        if not path or not os.path.exists(path):
            return {"ok": False, "msg": "文件不存在"}
        try:
            if posix_compat.IS_WINDOWS:
                ok = _recycle_to_trash([path])
            else:
                ok = posix_compat.trash([path])
        except Exception as e:
            return {"ok": False, "msg": "删除失败: %s" % e}
        if not ok:
            return {"ok": False, "msg": "删除失败"}
        d = os.path.dirname(path)
        base = os.path.splitext(os.path.basename(path))[0]
        try:
            sidecars = [os.path.join(d, base + s) for s in
                        (".preview.png", ".preview.jpg", ".preview.webp",
                         ".txt", ".json", ".civitai.info")
                        if os.path.exists(os.path.join(d, base + s))]
            if posix_compat.IS_WINDOWS:
                _recycle_to_trash(sidecars)
            else:
                posix_compat.trash(sidecars)
        except Exception:
            pass
        return {"ok": True, "msg": "已移入回收站"}

    def get_cover_b64(self, url, size=512):
        """按 URL 下载图片返回 base64（详情画廊多图用）"""
        import io
        import base64 as _b64
        import urllib.request
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) CivitaiFreeTool/1.4",
                "Referer": "https://civitai.com/",
                "Accept": "image/webp,image/*,*/*;q=0.8",
            })
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
            from PIL import Image
            im = Image.open(io.BytesIO(data)).convert("RGB")
            im.thumbnail((size, size))
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=85)
            return _b64.b64encode(buf.getvalue()).decode()
        except Exception:
            return ""

    def workflow_model_matches(self, refs):
        """工作流引用的模型名 → 本地模型库匹配（返回路径 + SHA256 前缀）"""
        refs = refs or []
        root = self.cfg.get("models_dir") or self.cfg.get("download_dir") or ""
        out = []
        if not root or not os.path.isdir(root) or not refs:
            return json.dumps(out, ensure_ascii=False)
        # 本地模型文件索引（名字 → 路径）
        index = {}
        for dp, dn, fns in os.walk(root):
            dn[:] = [d for d in dn if not d.lower().endswith(".images")]
            for fn in fns:
                if fn.lower().endswith((".safetensors", ".ckpt", ".pt", ".pth", ".gguf", ".bin", ".onnx")):
                    index[fn.lower()] = os.path.join(dp, fn)
        import model_manager as _mm
        for ref in refs:
            base = os.path.basename(str(ref)).lower()
            hit = index.get(base)
            item = {"ref": str(ref), "local": bool(hit), "path": hit or ""}
            if hit:
                try:
                    sha = _mm.compute_sha256(hit, cancel_ev=None) or ""
                    item["sha256"] = sha[:16]
                except Exception:
                    item["sha256"] = ""
            out.append(item)
        return json.dumps(out, ensure_ascii=False)

    def analyze_workflow(self, path):
        """解析 ComfyUI 工作流文件（.json / .png 内嵌），返回节点与提示词信息"""
        import re
        path = (path or "").strip()
        if not path or not os.path.exists(path):
            return json.dumps({"ok": False, "msg": "文件不存在"})
        ext = os.path.splitext(path)[1].lower()
        wf = None
        prompt = None
        if ext in (".png", ".webp"):
            # PNG tEXt / WebP 内嵌 chunk 提取 workflow / prompt
            try:
                data = open(path, "rb").read()
                if ext == ".png":
                    import struct
                    i = 8
                    while i < len(data):
                        ln = struct.unpack(">I", data[i:i + 4])[0]
                        typ = data[i + 4:i + 8].decode("ascii", "replace")
                        if typ == "tEXt":
                            payload = data[i + 8:i + 8 + ln].decode("latin-1")
                            key, _, val = payload.partition("\x00")
                            if key in ("workflow", "prompt"):
                                if key == "workflow":
                                    wf = val
                                else:
                                    prompt = val
                        elif typ == "IEND":
                            break
                        i += 12 + ln
                else:
                    # WebP：EXIF/ICCP 中可能含，简单尝试整文件文本查找
                    txt = data.decode("utf-8", "ignore")
                    m = re.search(r'"(workflow|prompt)"\s*:\s*(\{.*)', txt)
                    if m:
                        start = txt.find("{", m.start())
                        wf = txt[start:]
            except Exception as e:
                return json.dumps({"ok": False, "msg": "解析失败: %s" % e})
        elif ext in (".json",):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict) and "nodes" in data:
                    wf = json.dumps(data, ensure_ascii=False)
                elif isinstance(data, dict) and ("3" in data or "6" in data or "prompt" in data):
                    # API 格式 prompt：{"节点id": {...}} 或 {"prompt": {...}}
                    prompt = json.dumps(data, ensure_ascii=False)
            except Exception as e:
                return json.dumps({"ok": False, "msg": "JSON 解析失败: %s" % e})
        if not wf and not prompt:
            return json.dumps({"ok": False, "msg": "未找到工作流或提示词信息"})
        nodes = []
        models = set()
        pos_prompt = ""
        neg_prompt = ""
        try:
            if wf:
                wobj = json.loads(wf)
                for n in wobj.get("nodes", []) or []:
                    ntype = n.get("type", "")
                    title = n.get("title", "") or n.get("properties", {}).get("Node name for S&R", "")
                    widgets = n.get("widgets_values") or []
                    nodes.append({"type": ntype, "title": title,
                                  "widgets": [str(w) for w in widgets if isinstance(w, (str, int, float))][:6]})
                    # 引用的模型文件
                    for wv in widgets:
                        if isinstance(wv, str) and wv.lower().endswith((".safetensors", ".ckpt", ".pt", ".pth", ".gguf", ".bin", ".onnx")):
                            models.add(wv)
                # CLIPTextEncode 的提示词（ConnectTo 前的 inputs）
                for n in wobj.get("nodes", []) or []:
                    if n.get("type") == "CLIPTextEncode":
                        ws = n.get("widgets_values") or []
                        for wv in ws:
                            if isinstance(wv, str) and len(wv) > 2:
                                if not pos_prompt:
                                    pos_prompt = wv
                                elif "negative" in str(n.get("title", "")).lower() or not neg_prompt:
                                    neg_prompt = wv
            if prompt:
                pobj = json.loads(prompt)
                for k, v in (pobj.items() if isinstance(pobj, dict) else []):
                    cls = (v or {}).get("class_type", "")
                    if cls:
                        nodes.append({"type": cls, "title": "", "widgets": []})
                    if cls == "CLIPTextEncode":
                        t = ((v or {}).get("inputs") or {}).get("text", "")
                        if isinstance(t, str) and t.strip():
                            if not pos_prompt:
                                pos_prompt = t
                            elif not neg_prompt:
                                neg_prompt = t
        except Exception:
            pass
        return json.dumps({
            "ok": True,
            "file": os.path.basename(path),
            "has_workflow": bool(wf),
            "nodes": nodes[:40],
            "node_count": len(nodes),
            "models": sorted(models)[:20],
            "pos_prompt": pos_prompt[:800],
            "neg_prompt": neg_prompt[:400],
        }, ensure_ascii=False)

    def get_covers(self, paths, size=64):
        """批量返回封面（JSON 字符串：{path: base64}），size 为缩略边长（列表 64 / 瀑布流 320）"""
        out = {}
        for p in (paths or [])[:80]:
            cover = model_manager.find_cover(p)
            if not cover or not os.path.exists(cover):
                continue
            try:
                from PIL import Image
                import io
                import base64
                im = Image.open(cover).convert("RGB")
                im.thumbnail((size, size))
                buf = io.BytesIO()
                im.save(buf, "JPEG", quality=82)
                out[p] = base64.b64encode(buf.getvalue()).decode()
            except Exception:
                continue
        return json.dumps(out, ensure_ascii=False)

    def open_url(self, url):
        if not posix_compat.IS_WINDOWS:
            return posix_compat.open_url(url)
        try:
            os.startfile(url)
            return True
        except Exception:
            return False

    def pick_dir(self):
        """弹出文件夹选择对话框（新手引导/设置用），返回路径或空"""
        try:
            import webview as _wv
            w = _wv.windows[0] if _wv.windows else None
            if w is None:
                return ""
            result = w.create_file_dialog(_wv.FOLDER_DIALOG)
            if isinstance(result, (list, tuple)) and result:
                return str(result[0])
            return str(result) if result else ""
        except Exception:
            return ""

    def pick_file(self):
        """弹出文件选择对话框（工作流分析用），返回路径或空"""
        try:
            import webview as _wv
            w = _wv.windows[0] if _wv.windows else None
            if w is None:
                return ""
            result = w.create_file_dialog(
                _wv.OPEN_DIALOG,
                file_types=("ComfyUI 工作流 (*.json;*.png;*.webp)",),
            )
            if isinstance(result, (list, tuple)) and result:
                return str(result[0])
            return str(result) if result else ""
        except Exception:
            return ""

    def _collect_tree(self, root, rel_prefix=""):
        """递归收集目录树（含多级子文件夹）"""
        tree = []
        try:
            entries = sorted(os.listdir(root))
        except Exception:
            return tree
        for d in entries:
            p = os.path.join(root, d)
            if os.path.isdir(p) and not d.startswith(".") and not d.lower().endswith(".images"):
                rel = rel_prefix + d
                tree.append({
                    "name": d,
                    "path": rel,
                    "children": self._collect_tree(p, rel + "/"),
                })
        return tree

    def get_folders(self):
        root = self.cfg.get("models_dir") or self.cfg.get("download_dir") or ""
        tree = self._collect_tree(root) if root and os.path.isdir(root) else []
        hidden = list(self.cfg.get("hidden_model_folders") or [])
        return json.dumps({
            "root": root,
            "tree": tree,
            "hidden": hidden,
            "show_root": bool(self.cfg.get("show_root_models", True)),
        }, ensure_ascii=False)

    def hf_list_files(self, url):
        """解析 HuggingFace 链接，返回文件列表 JSON 字符串：
        {ok, repo, rev, files:[{path, size}]}；单文件链接直接返回该文件"""
        import re
        import urllib.request
        m = re.match(r"https?://huggingface\.co/([^/]+/[^/]+)(.*)$", (url or "").strip())
        if not m:
            return json.dumps({"ok": False, "msg": "不是 HuggingFace 链接"})
        repo = m.group(1)
        rest = m.group(2) or ""
        # 单文件：resolve / blob
        fm = re.match(r"/(resolve|blob)/([^/]+)/(.+)$", rest)
        if fm:
            rev, path = fm.group(2), fm.group(3)
            return json.dumps({"ok": True, "repo": repo, "rev": rev,
                               "files": [{"path": path, "size": 0, "type": "file"}]})
        # 仓库 / tree → 递归列文件（expand=true 带 size）
        tm = re.match(r"/tree/([^/]+)", rest)
        rev = tm.group(1) if tm else "main"
        api_url = "https://huggingface.co/api/models/%s/tree/%s?recursive=true&expand=true" % (repo, rev)
        try:
            req = urllib.request.Request(api_url, headers={"User-Agent": "CivitaiFreeTool/1.3"})
            with urllib.request.urlopen(req, timeout=25) as resp:
                data = json.loads(resp.read().decode("utf-8", "replace"))
        except Exception as e:
            return json.dumps({"ok": False, "msg": "列文件失败: %s" % e})
        files = []
        for it in data or []:
            if it.get("type") != "file":
                continue
            p = it.get("path", "")
            if p.endswith("/") or p.endswith(".gitattributes"):
                continue
            files.append({"path": p, "size": it.get("size") or 0, "type": "file"})
        files.sort(key=lambda x: -x["size"])
        return json.dumps({"ok": True, "repo": repo, "rev": rev, "files": files})

    def hf_enqueue(self, repo, rev, paths):
        """把 HuggingFace 文件加入下载队列（保留相对子目录结构）"""
        import downloader
        n = 0
        for p in (paths or []):
            rel = p.replace("\\", "/")
            dl_url = "https://huggingface.co/%s/resolve/%s/%s" % (repo, rev, rel)
            sub = os.path.dirname(rel)
            task = downloader.DownloadTask(
                url=dl_url,
                dest_dir="",   # 落地目录到下载开始时按「当前目标 + hf_rel」解析
                filename=os.path.basename(rel),
                info={"source": "hf", "repo": repo, "rel_path": rel, "hf_rel": sub},
            )
            try:
                self.dl.add_task(task)
                n += 1
            except Exception:
                pass
        return {"ok": True, "added": n}

    def save_folders(self, hidden, show_root):
        """保存文件夹显示设置并更新当前扫描结果"""
        self.cfg["hidden_model_folders"] = list(hidden or [])
        self.cfg["show_root_models"] = bool(show_root)
        try:
            config.save(self.cfg)
        except Exception:
            pass
        # 立即应用：重算显示行（_folder_visible 需要相对路径，多目录按各自根计算）
        if self.model_rows:
            hidden_set = set(self.cfg["hidden_model_folders"])
            def _rel(p):
                root = self._root_of(p).replace("\\", "/").rstrip("/")
                p2 = p.replace("\\", "/")
                return p2[len(root) + 1:] if root and p2.startswith(root + "/") else p2
            rows = [r for r in self.model_rows
                    if _folder_visible(_rel(r.get("path", "")), hidden_set,
                                       self.cfg["show_root_models"])]
            self.mm_scan_state["rows"] = rows
        return True

    def mm_verify(self, paths=None):
        """校验哈希 + 补全元数据（后台线程）"""
        paths = paths or []
        rows = [r for r in self.model_rows if r["path"] in paths] if paths else list(self.model_rows)
        if not rows:
            return {"started": False, "msg": "请先扫描模型"}
        self.mm_progress = {"running": True, "total": len(rows), "done": 0, "msg": "", "result": None}

        def work():
            api = self._new_api()
            for r in rows:
                try:
                    sha = model_manager.compute_sha256(r["path"])
                    if sha:
                        v = api.get_model_version_by_hash(sha)
                        r["sha256"] = sha
                        r["hash"] = "一致"
                        if not r.get("modelId") and v.get("modelId"):
                            r["modelId"] = v["modelId"]
                            r["url"] = self._site_url(v["modelId"])
                        if not r.get("verId") and v.get("id"):
                            r["verId"] = v["id"]
                        if not r.get("type") and v.get("type"):
                            r["type"] = v["type"]
                        if not r.get("base") and v.get("baseModel"):
                            r["base"] = v["baseModel"]
                        if not r.get("trainedWords") and v.get("trainedWords"):
                            r["trainedWords"] = v["trainedWords"]
                        # 补全完整元数据（详情页实际读取的 info 文件 + .json）
                        try:
                            if r.get("modelId"):
                                m = api.get_model(r["modelId"])
                                sd_d = (self.cfg.get("site_domain", "civitai.red") or "civitai.red").strip("/")
                                site_base = sd_d if "://" in sd_d else "https://" + sd_d
                                fi = reverse_parse.build_info(m, v, site_base)
                                fs = reverse_parse.build_sd_metadata(m, v, site_base)
                                b, _ = os.path.splitext(r["path"])
                                info_target = model_manager.find_info_file(r["path"]) or (b + ".civitai.info")
                                with open(info_target, "w", encoding="utf-8") as f:
                                    json.dump(fi, f, ensure_ascii=False, indent=2)
                                with open(b + ".json", "w", encoding="utf-8") as f:
                                    json.dump(fs, f, ensure_ascii=False, indent=2)
                        except Exception:
                            pass
                    else:
                        r["hash"] = "计算失败"
                except civitai_api.CivitaiError as e:
                    r["hash"] = "未收录" if "404" in str(e) else "失败"
                except Exception:
                    r["hash"] = "失败"
                self.mm_progress["done"] += 1
            self.mm_progress["running"] = False
            self.mm_progress["msg"] = "校验完成"

        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

    def get_mm_progress(self):
        return self.mm_progress

    def mm_dedupe(self, paths=None):
        """SHA256 查重（后台线程）：同哈希且多于 1 个文件的为一组。

        结果放 self.mm_progress["result"]：每组的 keep（建议保留，路径层级最浅的）与 dups（可清理）。
        删除走前端调用 rm_file（移入回收站），本方法只算不删。"""
        rows = [r for r in self.model_rows if (not paths or r["path"] in paths)]
        if not rows:
            return {"started": False, "msg": "请先在模型管理页扫描模型"}
        self._mm_cancel = False
        self.mm_progress = {"running": True, "total": len(rows), "done": 0, "msg": "计算哈希…", "result": None}

        def work():
            import collections
            import concurrent.futures as cf
            try:
                threads = max(1, int(self.cfg.get("hash_threads", 4) or 4))
            except Exception:
                threads = 4
            roots = [os.path.abspath(r) for r in (self._models_roots() or [])]
            by_hash = collections.defaultdict(list)
            lock = threading.Lock()
            done = 0

            def one(r):
                try:
                    return r, (model_manager.compute_sha256(r["path"]) or "")
                except Exception:
                    return r, ""

            with cf.ThreadPoolExecutor(max_workers=threads) as ex:
                for r, sha in ex.map(one, rows):
                    if self._mm_cancel:                 # ★ 用户点了「停止」：取消排队中的任务并退出
                        self.mm_progress["cancelled"] = True
                        ex.shutdown(wait=False, cancel_futures=True)
                        break
                    with lock:
                        done += 1
                        self.mm_progress["done"] = done
                    if sha:
                        by_hash[sha].append(r)

            def rank(it):
                p = os.path.abspath(it["path"])
                rel = p
                for root in roots:
                    if p == root or p.startswith(root + os.sep):
                        rel = os.path.relpath(p, root)
                        break
                try:
                    size = os.path.getsize(p)
                except Exception:
                    size = 0
                # 优先保留：层级最浅（直接放在类型目录下）→ 体积大 → 路径短
                return (rel.count(os.sep), -size, len(p))

            groups = []
            for sha, items in by_hash.items():
                if len(items) < 2:
                    continue
                items = sorted(items, key=rank)
                keep = items[0]
                dups = []
                for it in items[1:]:
                    try:
                        size = os.path.getsize(it["path"])
                    except Exception:
                        size = 0
                    dups.append({"path": it["path"], "name": it.get("name") or os.path.basename(it["path"]),
                                 "dir": os.path.dirname(it["path"]), "size": size})
                try:
                    total_size = os.path.getsize(keep["path"])
                except Exception:
                    total_size = 0
                groups.append({"sha256": sha[:16], "keep": keep["path"],
                               "keep_name": keep.get("name") or os.path.basename(keep["path"]),
                               "keep_dir": os.path.dirname(keep["path"]), "size": total_size,
                               "dups": dups})
            groups.sort(key=lambda g: -sum(d["size"] for d in g["dups"]))
            waste = sum(d["size"] for g in groups for d in g["dups"])

            def fmt(n):
                for u in ("B", "KB", "MB", "GB", "TB"):
                    if n < 1024 or u == "TB":
                        return ("%d %s" % (n, u)) if u == "B" else ("%.1f %s" % (n, u))
                    n /= 1024.0

            # ---- 第二类：同模型多版本（同一 modelId 下的不同版本；不是字节重复，但旧版通常是冗余的）----
            self.mm_progress["msg"] = "整理同模型新旧版本…"
            model_groups = []
            api = getattr(self, "api", None)
            api_calls = 0
            try:
                by_model = collections.defaultdict(dict)      # modelId -> {versionId: [rows]}
                for r in rows:
                    mid = str(r.get("modelId") or "").strip()
                    if not mid:
                        continue                                  # 没有 C 站身份的（如 HF 下载）跳过
                    vid = str(r.get("verId") or "").strip() or ("file:" + r["path"])
                    by_model[mid].setdefault(vid, []).append(r)
                for mid, vers in by_model.items():
                    if len(vers) < 2:                             # 只有「同模型、多个版本」才处理
                        continue
                    items = []
                    for vid, rs in vers.items():
                        rs = sorted(rs, key=rank)                 # 每版取一份代表（层级最浅）
                        rep = rs[0]
                        try:
                            size = os.path.getsize(rep["path"])
                        except Exception:
                            size = 0
                        real_vid = "" if vid.startswith("file:") else vid
                        items.append({"version_id": vid, "path": rep["path"],
                                      "name": rep.get("name") or os.path.basename(rep["path"]),
                                      "dir": os.path.dirname(rep["path"]), "size": size,
                                      "ver": rep.get("ver") or "", "base": rep.get("base") or "",
                                      "mtime": rep.get("mtime") or 0, "copies": len(rs),
                                      "url": self._site_url(mid, real_vid)})
                    # 版本新旧排序：优先 C 站版本列表顺序（最新在前），拿不到就用文件时间
                    order = {}
                    m = None
                    if api is not None and api_calls < 60:
                        api_calls += 1
                        try:
                            m = api.get_model(mid)
                            for i, v in enumerate((m or {}).get("modelVersions") or []):
                                order[str(v.get("id"))] = i
                        except Exception:
                            m = None
                    if order:
                        items.sort(key=lambda it: order.get(it["version_id"], 10 ** 6))
                    else:
                        items.sort(key=lambda it: -(it["mtime"] or 0))
                    keep, olds = items[0], items[1:]
                    mname = keep.get("name") or ""
                    if m:
                        mname = m.get("name") or mname
                    model_groups.append({"model_id": mid, "model_name": mname,
                                         "url": self._site_url(mid),
                                         "keep": keep, "olds": olds, "count": len(items)})
                model_groups.sort(key=lambda g: -sum(o["size"] for o in g["olds"]))
            except Exception:
                model_groups = []

            self.mm_progress["result"] = groups
            self.mm_progress["model_groups"] = model_groups
            self.mm_progress["running"] = False
            waste_all = waste + sum(o["size"] for g in model_groups for o in g["olds"])
            parts = []
            if groups:
                parts.append("%d 组完全相同" % len(groups))
            if model_groups:
                parts.append("%d 组同模型多版本" % len(model_groups))
            self.mm_progress["msg"] = (("查重完成：%s（可清理约 %s）" % ("、".join(parts), fmt(waste_all)))
                                       if parts else "查重完成：没有发现重复或冗余的模型 ✅")

        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

    # ---------------- 更新检测（只提示，绝不自动下载）----------------
    def _wl_path(self):
        return os.path.join(config.APP_DIR, "update_whitelist.json")

    def _load_wl(self):
        """更新白名单：{model_id: 模型名}，名单里的模型不再提示更新"""
        try:
            with open(self._wl_path(), "r", encoding="utf-8") as f:
                d = json.load(f)
            if isinstance(d, dict):
                return {str(k): str(v or "") for k, v in (d.get("model_ids") or {}).items()}
        except Exception:
            pass
        return {}

    def _save_wl(self, d):
        try:
            with open(self._wl_path(), "w", encoding="utf-8", newline="") as f:
                json.dump({"model_ids": d}, f, ensure_ascii=False, indent=1)
        except Exception:
            pass

    def _wl(self):
        if getattr(self, "_wl_cache", None) is None:
            self._wl_cache = self._load_wl()
        return self._wl_cache

    def get_system_accent(self):
        """读取 Windows 个性化主题色（AccentColorMenu / ColorizationColor，ABGR）→ #RRGGBB；失败回默认蓝"""
        import winreg
        def _conv(v):
            r, g, b = v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF
            if r + g + b < 30:      # 无效/全黑 → 视为未设置
                return None
            return "#%02X%02X%02X" % (r, g, b)
        try:
            k = winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Software" + chr(92) + "Microsoft" + chr(92) + "Windows" + chr(92) + "CurrentVersion" + chr(92) + "Explorer" + chr(92) + "Accent")
            try:
                v, _ = winreg.QueryValueEx(k, "AccentColorMenu")
            finally:
                winreg.CloseKey(k)
            c = _conv(int(v))
            if c:
                return c
        except Exception:
            pass
        try:
            k = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\DWM")
            try:
                v, _ = winreg.QueryValueEx(k, "ColorizationColor")
            finally:
                winreg.CloseKey(k)
            c = _conv(int(v))
            if c:
                return c
        except Exception:
            pass
        return "#0078D4"

    def get_update_whitelist(self):
        wl = self._wl()
        return {"count": len(wl), "items": [{"model_id": k, "name": v} for k, v in wl.items()]}

    def add_update_whitelist(self, model_id, name=""):
        mid = str(model_id or "").strip()
        if not mid:
            return {"ok": False, "msg": "缺少 modelId"}
        wl = self._wl()
        wl[mid] = str(name or "").strip()
        self._save_wl(wl)
        # 立刻从最近一次结果里剔除（不用重查）
        items = self._updates.get("items") or {}
        for p in list(items.keys()):
            if str((items.get(p) or {}).get("model_id") or "") == mid:
                items.pop(p, None)
        self._save_updates(self._updates)
        return {"ok": True, "msg": "已加入更新白名单，以后不再提醒这个模型"}

    def remove_update_whitelist(self, model_id):
        mid = str(model_id or "").strip()
        wl = self._wl()
        wl.pop(mid, None)
        self._save_wl(wl)
        return {"ok": True, "msg": "已移出白名单：下次检查会重新提示"}

    def _dup_in_queue(self, version_id, sha256, filename, dest_dir):
        """该版本是否已经在下载队列里（等待中/下载中/已暂停）——防重复点击下好几遍。

        注意不能用 URL 判：task.url 是带签名的 CDN 链接，每次解析都不一样。
        用三个稳定标识任一命中即算重复：C 站版本 id、文件 SHA256、目标文件名+目录。
        """
        try:
            dest = os.path.abspath(dest_dir) if dest_dir else ""
            for t in self.dl.tasks:
                if t.status not in ("pending", "downloading", "paused"):
                    continue
                info = t.info or {}
                meta = (info.get("meta") or {}).get("info") or {}
                if version_id and str(meta.get("id") or "") == str(version_id):
                    return t
                if sha256 and getattr(t, "expected_sha256", "") and t.expected_sha256 == sha256:
                    return t
                if filename and t.filename == filename:
                    if (not dest) or os.path.abspath(t.dest_dir or "") == dest:
                        return t
        except Exception:
            pass
        return None

    def _mark_replace_old(self, task_id, old_path):
        """记下「这次下载是某文件的更新」：下载完成时按设置决定旧版保留还是移入回收站"""
        if not task_id or not old_path:
            return
        try:
            for t in self.dl.tasks:
                if t.id == task_id:
                    t.info = t.info or {}
                    t.info["replace_old"] = old_path
                    try:
                        self.dl.save_tasks()
                    except Exception:
                        pass
                    return
        except Exception:
            pass

    def mm_download_version(self, path, version_id):
        """下载指定模型文件的某一具体版本（更新页面里点某一版）"""
        p = (path or "").strip()
        vid = str(version_id or "").strip()
        if not (p and vid):
            return {"ok": False, "msg": "参数不完整"}
        it = (self._updates.get("items") or {}).get(p) or {}
        mid = str(it.get("model_id") or "")
        if not mid:      # 兜底：从侧车文件里读 modelId
            try:
                info_path = model_manager.find_info_file(p)
                if info_path:
                    with open(info_path, "r", encoding="utf-8") as f:
                        d = json.load(f)
                    mid = str(d.get("modelId") or d.get("model_id") or "")
            except Exception:
                mid = ""
        if not mid:
            return {"ok": False, "msg": "找不到该文件对应的 C 站模型（可先跑一次反向解析）"}
        try:
            item = self._enqueue_one(self._site_url(mid, vid), dest_dir=os.path.dirname(p), skip_if_exists=True)
        except Exception as e:
            return {"ok": False, "msg": str(e)[:150]}
        if not item.get("ok"):
            return {"ok": False, "msg": item.get("msg") or "入队失败", "skipped": bool(item.get("skipped"))}
        self._mark_replace_old(item.get("task_id"), p)
        return {"ok": True, "msg": "已加入下载队列：%s" % (item.get("msg") or "")}

    def mm_dedupe_delete(self, paths):
        """把勾选的文件移入回收站（后台执行 + 逐个进度 + 单文件超时保护）。

        为什么不在前端逐个 await rm_file：SHFileOperation 在个别文件上会死锁（实测 15 个文件
        删到最后一个卡死，CPU 却空闲），前端的 await 永远不回 → 整个弹窗"卡住"。
        这里改成后台线程 + 每文件 join(25s)：卡住的那个只算失败，流程照常走完并报告。
        """
        ps = [p for p in (paths or []) if p]
        if not ps:
            return {"ok": False, "msg": "没有要清理的文件"}
        if self.mm_progress.get("running"):
            return {"ok": False, "msg": "有其它任务在执行中（扫描/查重/更新），稍后再试"}
        self.mm_progress = {"running": True, "total": len(ps), "done": 0,
                            "msg": "准备移入回收站…", "result": []}
        st = self.mm_progress

        def _trash_paths(paths_list, timeout):
            """在受控线程里做回收操作：返回 (是否成功, 是否超时)。超时的线程留它去，流程继续。"""
            res = {"v": False}

            def _do():
                try:
                    if posix_compat.IS_WINDOWS:
                        from gui import _recycle_to_trash
                        res["v"] = bool(_recycle_to_trash(paths_list))
                    else:
                        res["v"] = bool(posix_compat.trash(paths_list))
                except Exception:
                    res["v"] = False

            th = threading.Thread(target=_do, daemon=True)
            th.start()
            th.join(timeout=timeout)
            return res["v"], th.is_alive()

        def work():
            okn, fails = 0, []
            for i, p in enumerate(ps):
                st["msg"] = "移入回收站 %d/%d：%s" % (i + 1, len(ps), os.path.basename(p)[:44])
                if not os.path.exists(p):          # 已被删掉（重复点击/手动删过）→ 主文件视为成功，顺手清孤儿附属文件
                    okn += 1
                    try:
                        d = os.path.dirname(p)
                        b = os.path.splitext(os.path.basename(p))[0]
                        orphan = [os.path.join(d, b + s) for s in
                                  (".preview.png", ".preview.jpg", ".preview.webp", ".txt", ".json", ".civitai.info")
                                  if os.path.exists(os.path.join(d, b + s))]
                        if orphan:
                            _trash_paths(orphan, 15)
                    except Exception:
                        pass
                    st["done"] = i + 1
                    continue
                try:
                    good, timed_out = _trash_paths([p], 25)
                except Exception:
                    good, timed_out = False, False
                if timed_out:
                    fails.append({"file": os.path.basename(p),
                                  "msg": "系统回收操作超时被跳过（文件可能被占用，或被网盘等外壳扩展挂住；可在资源管理器里手动删除）"})
                elif good:
                    okn += 1
                    # 附属文件（预览图/元数据）一并回收
                    try:
                        d = os.path.dirname(p)
                        b = os.path.splitext(os.path.basename(p))[0]
                        side = [os.path.join(d, b + s) for s in
                                (".preview.png", ".preview.jpg", ".preview.webp", ".txt", ".json", ".civitai.info")
                                if os.path.exists(os.path.join(d, b + s))]
                        if side:
                            _trash_paths(side, 15)
                    except Exception:
                        pass
                else:
                    fails.append({"file": os.path.basename(p), "msg": "移入回收站失败"})
                st["done"] = i + 1
            st["running"] = False
            st["result"] = fails
            st["msg"] = ("已移入回收站 %d/%d 个%s" % (okn, len(ps), ("，%d 个失败" % len(fails)) if fails else ""))

        threading.Thread(target=work, daemon=True).start()
        return {"ok": True, "started": True, "total": len(ps), "msg": "开始清理 %d 个文件" % len(ps)}

    def error_log_path(self):
        return os.path.join(config.APP_DIR, "error.log")

    def log_error(self, where, detail):
        """把错误写进 error.log（带时间戳；超过 2MB 自动滚成 .1）。前端也能通过 log_ui_error 写。"""
        try:
            p = self.error_log_path()
            try:
                if os.path.exists(p) and os.path.getsize(p) > 2 * 1024 * 1024:
                    bak = p + ".1"
                    if os.path.exists(bak):
                        os.remove(bak)
                    os.rename(p, bak)
            except Exception:
                pass
            with open(p, "a", encoding="utf-8") as f:
                f.write("\n===== %s [%s] =====\n%s\n" % (
                    time.strftime("%Y-%m-%d %H:%M:%S"), where, str(detail)[:8000]))
            return {"ok": True}
        except Exception:
            return {"ok": False}

    def log_ui_error(self, msg, source="", line="", stack=""):
        """前端 JS 错误（window.onerror / unhandledrejection）转发到这里"""
        return self.log_error("ui", "%s\n  来源: %s:%s\n  堆栈: %s" % (msg, source, line, str(stack)[:3000]))

    def open_logs_dir(self):
        """打开日志所在文件夹（设置页按钮）"""
        try:
            d = config.APP_DIR
            os.makedirs(d, exist_ok=True)
            if posix_compat.IS_WINDOWS:
                os.startfile(d)                       # noqa: S606
            else:
                import subprocess
                subprocess.Popen(["xdg-open", d])
            return {"ok": True, "msg": "已打开日志文件夹：%s" % d}
        except Exception as e:
            return {"ok": False, "msg": str(e)[:150]}

    def cancel_mm_op(self):
        """中断当前的长任务（检查更新 / 查重 / 扫描）：置位后各循环在下一次迭代退出，已算出的结果会保存"""
        self._mm_cancel = True
        return {"ok": True, "msg": "已请求停止（正在收尾，已完成的进度会保留）"}

    def _updates_path(self):
        return os.path.join(config.APP_DIR, "model_updates.json")

    def _load_updates(self):
        try:
            with open(self._updates_path(), "r", encoding="utf-8") as f:
                d = json.load(f)
            if isinstance(d, dict) and isinstance(d.get("items"), dict):
                return d
        except Exception:
            pass
        return {"checked_at": 0, "items": {}}

    def _save_updates(self, data):
        try:
            with open(self._updates_path(), "w", encoding="utf-8", newline="") as f:
                json.dump(data, f, ensure_ascii=False, indent=1)
        except Exception:
            pass

    def _sidecar_brief(self, path):
        """从侧车文件读出「模型名 / 版本名 / 底模 / 版本日期」（纯本地，不发网络）。

        侧车（.info.json）结构实测：{"name": 模型名, "modelId": ..., "version": {"id","name","baseModel","publishedAt"}}
        """
        out = {}
        try:
            info_path = model_manager.find_info_file(path)
        except Exception:
            info_path = None
        if not info_path:
            return out
        try:
            with open(info_path, "r", encoding="utf-8") as f:
                d = json.load(f)
        except Exception:
            return out
        if not isinstance(d, dict):
            return out
        ver = d.get("version") if isinstance(d.get("version"), dict) else {}
        out["model_name"] = str(d.get("name") or d.get("modelName") or "").strip()
        cre = d.get("creator")
        if isinstance(cre, dict):
            cre = cre.get("username") or cre.get("name") or ""
        out["author"] = str(cre or "").strip()
        out["version_name"] = str(ver.get("name") or d.get("versionName") or "").strip()
        out["base"] = str(ver.get("baseModel") or d.get("baseModel") or "").strip()
        dt = str(ver.get("publishedAt") or ver.get("createdAt") or "").strip()
        out["date"] = dt[:10] if dt else ""
        return out

    def _enrich_upd_records(self):
        """给旧缓存（缺版本名/模型名）就地补齐——只读侧车，不发网络请求。

        旧版检查结果里只有版本 ID（界面显示「当前版本：2910935」看不懂），这里补成可读的版本名。
        试过的条目标 _enr=1，避免每次打开都重复读盘。
        """
        items = self._updates.get("items") or {}
        changed = 0
        for p, it in items.items():
            if not isinstance(it, dict) or it.get("_enr"):
                continue
            sc = self._sidecar_brief(p)
            if not sc:
                it["_enr"] = 1        # 没侧车：标记过，别反复读
                changed += 1
                continue
            if not it.get("local_name") and sc.get("version_name"):
                it["local_name"] = sc["version_name"]; changed += 1
            if not it.get("model_name") and sc.get("model_name"):
                it["model_name"] = sc["model_name"]; changed += 1
            if not it.get("local_base") and sc.get("base"):
                it["local_base"] = sc["base"]; changed += 1
            if not it.get("local_date") and sc.get("date"):
                it["local_date"] = sc["date"]; changed += 1
            if not it.get("author") and sc.get("author"):
                it["author"] = sc["author"]; changed += 1
            it["_enr"] = 1
        if changed:
            self._save_updates(self._updates)
        return changed

    def get_model_updates(self):
        """缓存的更新检查结果（模型列表挂 ❗ 用）+ 上次检查时间

        旧缓存会被就地补上「版本名/模型名」（从侧车读，不联网），所以界面直接显示可读的版本名。
        """
        try:
            self._enrich_upd_records()
        except Exception:
            pass
        return {"checked_at": int(self._updates.get("checked_at") or 0),
                "v": int(self._updates.get("v") or 1),
                "items": self._updates.get("items") or {}}

    def get_mm_update_state(self):
        return self._mm_upd_state

    def mm_check_updates(self, force=False, paths=None):
        """检查更新（后台，不会自动下载）。

        规则：以本地版本所在底模为准 —— **同底模有更新**才算「有新版」；
        最新版换了底模（如 Anima→Krea）只记为「其它底模版本」，不算更新、不打扰。
        结果写 model_updates.json 缓存，默认 24 小时内不重复查（force=True 强制）。

        paths 非空时**只检查勾选的这几个**（显式选择 → 忽略 24h 缓存与更新白名单，立即查）。
        """
        if self._mm_upd_state.get("running"):
            return {"started": False, "msg": "正在检查中…"}
        only = [p for p in (paths or []) if p]
        if only:
            want = set(only)
            rows = [r for r in self.model_rows if r.get("path") in want and r.get("modelId") and r.get("verId")]
            if not rows:
                return {"started": False,
                        "msg": "勾选的条目里没有可检查的（需要 C 站信息；缺的可先跑一次「🔍 反向解析」）"}
            force = True                       # 显式勾选 = 直接重查
        else:
            rows = [r for r in self.model_rows if r.get("modelId") and r.get("verId")]
            if not rows:
                return {"started": False, "msg": "没有可检查的模型（需要先扫描；缺侧车信息的可先跑反向解析）"}
        now = int(time.time())
        fresh = int(self._updates.get("checked_at") or 0)
        if (not only) and (not force) and self._updates.get("items") and (now - fresh) < 24 * 3600:
            return {"started": False, "recent": True,
                    "msg": "24 小时内已检查过（%s）；要重查请点「强制刷新」" % time.strftime("%m-%d %H:%M", time.localtime(fresh))}
        wl = self._wl()
        groups = {}
        for r in rows:
            mid = str(r.get("modelId") or "")
            if (not only) and mid in wl:
                continue                      # 更新白名单：这个模型不再提醒（勾选手动检查时除外）
            groups.setdefault(mid, []).append(r)
        if not groups:
            return {"started": False, "msg": "所有模型都在更新白名单里（可在更新页面「📋 白名单」里移除）"}
        self._mm_cancel = False
        self._mm_upd_state = {"running": True, "total": len(groups), "done": 0,
                              "msg": ("检查勾选的 %d 个…" % len(groups)) if only else "检查更新…",
                              "newer": 0, "other_base": 0, "checked_at": now, "items": {},
                              "wl_skipped": len(wl)}

        def work():
            api = getattr(self, "api", None)
            items, newer, other = {}, 0, 0
            fails = 0
            for i, (mid, rs) in enumerate(groups.items()):
                if self._mm_cancel:                      # ★ 用户点了「停止」：保存已完成的，立刻收尾
                    try:
                        cur = self._updates.get("items") or {}
                        cur.update(items)
                        self._updates["items"] = cur
                        self._save_updates(self._updates)
                    except Exception:
                        pass
                    self._mm_upd_state["cancelled"] = True
                    self._mm_upd_state["running"] = False
                    self._mm_upd_state["msg"] = "已停止（已检查 %d/%d，结果已保存）" % (i, len(groups))
                    return
                if self._mm_upd_state.get("_stop"):
                    break
                m = None
                try:
                    m = api.get_model(mid) if api else None
                except Exception:
                    fails += 1
                    if fails >= 5:
                        self._mm_upd_state["msg"] = "连续请求失败，已中止（网络或接口问题）"
                        break
                    time.sleep(0.5)
                    continue
                vs = (m or {}).get("modelVersions") or []
                if vs:
                    for r in rs:
                        lv = str(r.get("verId") or "")
                        lb = (r.get("base") or "").strip()
                        idx = -1
                        for k, v in enumerate(vs):
                            if str(v.get("id")) == lv:
                                idx = k
                                break
                        rec = {"model_id": mid, "local_version": lv, "local_base": lb,
                               "model_name": (m.get("name") or "").strip(),
                               "model_type": (m.get("type") or "").strip(),
                               "checked_at": now, "has_update": False, "other_base": False}
                        if idx < 0:
                            sc0 = self._sidecar_brief(r["path"])
                            if sc0.get("version_name"):
                                rec["local_name"] = sc0["version_name"]
                            if sc0.get("base"):
                                rec["local_base"] = sc0["base"]
                            if sc0.get("date"):
                                rec["local_date"] = sc0["date"]
                            if not rec.get("model_name") and sc0.get("model_name"):
                                rec["model_name"] = sc0["model_name"]
                            rec["unknown"] = True
                            rec["msg"] = "本地版本不在 C 站列表（无法判定；版本信息取自本地文件）"
                            rec["url"] = self._site_url(mid)
                            # 本地版本已下架时最需要「降级/换版」：把 C 站现存的全部版本都给出来（不限底模）
                            try:
                                def _vd0(v):
                                    return str(v.get("publishedAt") or v.get("createdAt") or "")
                                vl0 = [{"id": str(v.get("id")), "name": (v.get("name") or "").strip(),
                                        "date": _vd0(v)[:10], "url": self._site_url(mid, v.get("id")),
                                        "current": False, "base": (v.get("baseModel") or "").strip()}
                                       for v in vs[:30]]
                                vl0.sort(key=lambda x: x.get("date") or "", reverse=True)
                                rec["ver_list"] = vl0
                            except Exception:
                                pass
                            items[r["path"]] = rec
                            continue
                        if not lb:
                            lb = (vs[idx].get("baseModel") or "").strip()
                            rec["local_base"] = lb

                        def _vd(v):
                            return str(v.get("publishedAt") or v.get("createdAt") or "")

                        local_v = vs[idx]
                        local_date = _vd(local_v)
                        rec["local_name"] = (local_v.get("name") or "").strip()
                        rec["local_date"] = local_date[:10]
                        same_all = [v for v in vs if (v.get("baseModel") or "").strip() == lb]
                        if local_date:
                            # 按发布时间判断"比你新"（C 站列表顺序未必等于时间顺序，实测有反例）
                            newer_same = [v for v in same_all if _vd(v) > local_date]
                        else:
                            k = len([v for v in vs[:idx] if (v.get("baseModel") or "").strip() == lb])
                            newer_same = same_all[:k]
                        newer_same.sort(key=lambda v: _vd(v), reverse=True)
                        # 同底模可用版本清单（给「更新页面」的下拉：全部同底模版本，标出当前与推荐）
                        def _vl_entry(v, is_cur):
                            return {"id": str(v.get("id")), "name": (v.get("name") or "").strip(),
                                    "date": _vd(v)[:10], "url": self._site_url(mid, v.get("id")),
                                    "current": bool(is_cur)}
                        try:
                            vl = []
                            for v in same_all:
                                vl.append(_vl_entry(v, str(v.get("id")) == lv))
                            vl.sort(key=lambda x: _vkey(x.get("name")), reverse=True)   # 语义化版本倒序
                            rec["ver_list"] = vl[:30]
                        except Exception:
                            rec["ver_list"] = []
                        if newer_same:
                            nv = newer_same[0]
                            rec.update({"has_update": True, "latest_version": str(nv.get("id")),
                                        "latest_name": nv.get("name") or "", "latest_base": (nv.get("baseModel") or lb),
                                        "latest_date": _vd(nv), "behind": len(newer_same),
                                        "url": self._site_url(mid, nv.get("id")),
                                        # 所有"比你新"的同底模版本（版本名 + 日期 + 单独下载入口）
                                        "newer_list": [{"id": str(v.get("id")), "name": (v.get("name") or "").strip(),
                                                        "date": _vd(v)[:10], "url": self._site_url(mid, v.get("id"))}
                                                       for v in newer_same[:12]]})
                            newer += 1
                        else:
                            top = max(vs, key=_vd) if local_date else vs[0]   # 按时间取最新（C 站数组顺序未必是时间序）
                            if str(top.get("id")) != lv:
                                rec.update({"other_base": True, "latest_version": str(top.get("id")),
                                            "latest_name": top.get("name") or "",
                                            "latest_base": (top.get("baseModel") or ""),
                                            "latest_date": top.get("publishedAt") or top.get("createdAt") or "",
                                            "url": self._site_url(mid, top.get("id"))})
                                other += 1
                            else:
                                rec["url"] = self._site_url(mid, lv)   # 已是最新
                        items[r["path"]] = rec
                self._mm_upd_state["done"] = i + 1
                self._mm_upd_state["newer"] = newer
                self._mm_upd_state["other_base"] = other
                time.sleep(0.35)
            # ★ 合并而不是替换：勾选检查只查了一部分模型，绝不能把其他模型的更新记录冲掉
            #（旧实现在这里直接 self._updates = {...}，于是"只查勾选"会把整份缓存清成只有那几条）
            try:
                cur = self._updates.get("items") or {}
                cur.update(items)
                try:
                    cur = {p: v for p, v in cur.items() if os.path.exists(p)}   # 顺手剔掉文件已不存在的记录
                except Exception:
                    pass
                self._updates["items"] = cur
                if not only:
                    self._updates["checked_at"] = now      # 只有"全量检查"才更新上次全量时间
                self._save_updates(self._updates)
            except Exception:
                pass
            self._mm_upd_state.update({"running": False, "items": items, "newer": newer, "other_base": other})
            if newer or other:
                self._mm_upd_state["msg"] = ("检查完成：%d 个模型有同底模更新%s"
                                             % (newer, ("；另有 %d 个只换了底模（不算更新）" % other) if other else ""))
            else:
                self._mm_upd_state["msg"] = "检查完成：没有发现有更新的模型 ✅"

        threading.Thread(target=work, daemon=True).start()
        return {"started": True, "total": len(groups)}

    def mm_update_models(self, paths=None):
        """把「有新版」的模型加入下载队列（下载新版；默认落在旧版所在文件夹，不被全局目标搬走）。

        paths=None 表示全部有更新的；传入 paths 则只处理勾选的。进 mm_progress 供 UI 显示进度。
        """
        items = self._updates.get("items") or {}
        picked = []
        for r in self.model_rows:
            p = r.get("path") or ""
            if paths and p not in paths:
                continue
            it = items.get(p) or {}
            if it.get("has_update"):
                picked.append((p, it))
        if not picked:
            return {"ok": False, "msg": "没有可更新的模型：先点「⏫ 检查更新」，再勾选带 ❗ 的条目（或在结果窗里点「全部更新」）"}
        if self.mm_progress.get("running"):
            return {"ok": False, "msg": "有其它任务正在执行，稍后再试"}
        self.mm_progress = {"running": True, "total": len(picked), "done": 0, "msg": "开始更新…", "result": None}
        st = self.mm_progress

        def work():
            okn, fail, skipped, fails = 0, 0, 0, []
            for i, (p, it) in enumerate(picked):
                url = it.get("url") or self._site_url(it.get("model_id"), it.get("latest_version"))
                try:
                    item = self._enqueue_one(url, dest_dir=os.path.dirname(p), skip_if_exists=True)
                    if item.get("ok"):
                        okn += 1
                        self._mark_replace_old(item.get("task_id"), p)
                    elif item.get("skipped"):
                        skipped += 1
                    else:
                        fail += 1
                        fails.append({"file": os.path.basename(p), "msg": item.get("msg") or "入队失败"})
                except Exception as e:
                    fail += 1
                    fails.append({"file": os.path.basename(p), "msg": str(e)[:120]})
                st["done"] = i + 1
                st["msg"] = "更新中 %d/%d（已入队 %d）" % (i + 1, len(picked), okn)
            st["result"] = fails
            st["running"] = False
            st["msg"] = ("更新完成：%d 个新版已加入下载队列%s%s（默认下到旧版所在文件夹，进度看「下载管理」）"
                         % (okn,
                            ("，跳过 %d 个（已在队列或已存在）" % skipped) if skipped else "",
                            ("，%d 个失败" % fail) if fail else ""))

        threading.Thread(target=work, daemon=True).start()
        return {"ok": True, "started": True, "total": len(picked),
                "msg": "开始更新 %d 个模型（下载新版到旧版所在文件夹）" % len(picked)}

    def _site_url(self, model_id, version_id=None):
        d = (self.cfg.get("site_domain", "civitai.red") or "civitai.red").strip("/")
        base = d if "://" in d else "https://" + d
        u = "%s/models/%s" % (base, model_id)
        if version_id:
            u += "?modelVersionId=%s" % version_id
        return u

    def mm_rename_preview(self, act="rename_c", paths=None):
        """批量改名「只读试算」：算出新旧文件名给用户预览，绝不修改任何文件。
        act: rename_c（文件名→C站名） / localize（文件名→中文，需要翻译时走百度翻译，不落盘）"""
        rows = [r for r in self.model_rows if r["path"] in (paths or [])] or list(self.model_rows)
        out = []
        appid = self.cfg.get("baidu_appid", "").strip()
        key = self.cfg.get("baidu_key", "").strip()
        for r in rows:
            old = os.path.basename(r["path"])
            try:
                info = dict(r.get("info") or {})
                if act == "localize":
                    nm = (info.get("name") or "").strip()
                    if nm and not translator._is_cjk(nm):
                        info["name"] = translator.translate(nm, appid, key) or nm
                newp, msgs = model_manager.rename_to_civitai(
                    r["path"], info, dry_run=True, clean_rules=self.cfg.get("rename_clean_rules") or "")
                out.append({"path": r["path"], "old": old,
                            "new": os.path.basename(newp) if newp else "",
                            "same": os.path.normpath(newp or "") == os.path.normpath(r["path"]),
                            "msg": "; ".join(msgs or [])[:140]})
            except Exception as e:
                out.append({"path": r["path"], "old": old, "new": "", "same": False, "msg": str(e)[:140]})
        return {"ok": True, "items": out}

    def mm_rename(self, paths=None):
        """重命名为 C 站模型名（后台线程）；按设置里的清理规则去掉逗号/括号等符号"""
        rows = [r for r in self.model_rows if r["path"] in (paths or [])] or list(self.model_rows)
        if not rows:
            return {"started": False, "msg": "没有可重命名的模型"}
        self.mm_progress = {"running": True, "total": len(rows), "done": 0, "msg": "", "result": []}
        _clean = self.cfg.get("rename_clean_rules") or ""

        def work():
            for r in rows:
                try:
                    _, msgs = model_manager.rename_to_civitai(
                        r["path"], r.get("info") or {}, clean_rules=_clean)
                    self.mm_progress["result"].append({"path": r["path"], "msgs": msgs})
                except Exception as e:
                    self.mm_progress["result"].append({"path": r["path"], "msgs": [str(e)]})
                self.mm_progress["done"] += 1
            self.mm_progress["running"] = False
            self.mm_progress["msg"] = "重命名完成"

        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

    def mm_localize(self, paths=None):
        """汉化文件名（后台线程）"""
        appid = self.cfg.get("baidu_appid", "").strip()
        key = self.cfg.get("baidu_key", "").strip()
        rows = [r for r in self.model_rows if r["path"] in (paths or [])] or list(self.model_rows)
        self.mm_progress = {"running": True, "total": len(rows), "done": 0, "msg": "", "result": []}

        def work():
            for r in rows:
                info = r.get("info") or {}
                name = (info.get("name") or "").strip()
                try:
                    zh = name
                    if name and not translator._is_cjk(name):
                        zh = translator.translate(name, appid, key) or name
                    if zh and zh != name:
                        meta2 = dict(info)
                        meta2["name"] = zh
                        model_manager.rename_to_civitai(
                            r["path"], meta2, clean_rules=self.cfg.get("rename_clean_rules") or "")
                        self.mm_progress["result"].append({"path": r["path"], "ok": True})
                except Exception:
                    pass
                self.mm_progress["done"] += 1
            self.mm_progress["running"] = False
            self.mm_progress["msg"] = "汉化完成"

        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

    def mm_gen_json(self, paths=None, overwrite=False):
        """生成 SD json（后台线程）"""
        rows = [r for r in self.model_rows if r["path"] in (paths or [])] or list(self.model_rows)
        self.mm_progress = {"running": True, "total": len(rows), "done": 0, "msg": "", "result": []}

        def work():
            ok = skip = 0
            for r in rows:
                try:
                    info_path = model_manager.find_info_file(r["path"])
                    if not info_path:
                        continue
                    with open(info_path, "r", encoding="utf-8") as f:
                        info = json.load(f)
                    sd = reverse_parse.info_to_sd_metadata(info)
                    if sd:
                        b, _ = os.path.splitext(r["path"])
                        dst = b + ".json"
                        if os.path.exists(dst) and not overwrite:
                            skip += 1
                        else:
                            with open(dst, "w", encoding="utf-8") as f:
                                json.dump(sd, f, ensure_ascii=False, indent=2)
                            ok += 1
                except Exception:
                    pass
                self.mm_progress["done"] += 1
            self.mm_progress["running"] = False
            self.mm_progress["result"] = {"ok": ok, "skip": skip}
            self.mm_progress["msg"] = "SD json 生成完成"

        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

    def mm_download_covers(self, paths=None):
        rows = [r for r in self.model_rows if r["path"] in (paths or [])] or list(self.model_rows)
        self.mm_progress = {"running": True, "total": len(rows), "done": 0, "msg": "", "result": 0}

        def work():
            api = self._new_api()
            ok = 0
            for r in rows:
                imgs = []
                try:
                    if r.get("verId"):
                        imgs = (api.get_model_version(r["verId"]).get("images") or [])
                    elif r.get("modelId"):
                        m = api.get_model(r["modelId"])
                        vs = m.get("modelVersions") or []
                        if vs:
                            imgs = (api.get_model_version(vs[0]["id"]).get("images") or [])
                except Exception:
                    imgs = []
                b, _ = os.path.splitext(r["path"])
                dest = b + ".preview.png"
                if not os.path.exists(dest):
                    for img in imgs:
                        u = img.get("url") or ""
                        if not u:
                            continue
                        for _ in range(3):
                            if _download_image(u, dest,
                                               proxy=self.cfg.get("proxy_address") if self.cfg.get("proxy_enabled") else None,
                                               verify=self.cfg.get("ssl_verify", True)):
                                ok += 1
                                break
                        if os.path.exists(dest):
                            break
                self.mm_progress["done"] += 1
            self.mm_progress["running"] = False
            self.mm_progress["result"] = ok
            self.mm_progress["msg"] = "封面下载完成"

        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

    def mm_translate_descs(self, paths=None):
        """把模型简介翻译成中文，写回详情页实际读取的元数据文件（find_info_file 同源）
        与 .json（保留英文原文，新增 description_zh 字段）。
        只翻译简介，不翻译触发词——触发词需保持英文原文用于提示词。"""
        appid = self.cfg.get("baidu_appid", "").strip()
        key = self.cfg.get("baidu_key", "").strip()
        rows = [r for r in self.model_rows if r["path"] in (paths or [])] or list(self.model_rows)
        self.mm_progress = {"running": True, "total": len(rows), "done": 0, "msg": "", "result": 0}

        def work():
            ok = 0
            no_desc = 0
            already = 0
            for r in rows:
                b, _ = os.path.splitext(r["path"])
                try:
                    info_path = model_manager.find_info_file(r["path"])
                    json_path = b + ".json"
                    info = {}
                    sd = {}
                    if info_path:
                        with open(info_path, "r", encoding="utf-8") as f:
                            info = json.load(f)
                    if os.path.exists(json_path):
                        with open(json_path, "r", encoding="utf-8") as f:
                            sd = json.load(f)
                    changed = False
                    desc = (info.get("description") or sd.get("description") or "").strip()
                    zh_in_info = info.get("description_zh")
                    zh_in_sd = sd.get("description_zh")
                    if not desc:
                        no_desc += 1
                    elif zh_in_info:
                        already += 1
                    elif zh_in_sd:
                        # 详情页同源文件缺中文但 .json 已有（旧版翻译只写了 .json）→ 同步过来
                        info["description_zh"] = zh_in_sd
                        changed = True
                    elif not translator._is_cjk(desc):
                        zh = translator.translate(desc, appid, key)
                        if zh and zh != desc:
                            info["description_zh"] = zh
                            sd["description_zh"] = zh
                            changed = True
                    else:
                        already += 1
                    if changed:
                        if info_path:
                            with open(info_path, "w", encoding="utf-8") as f:
                                json.dump(info, f, ensure_ascii=False, indent=2)
                        if os.path.exists(json_path):
                            with open(json_path, "w", encoding="utf-8") as f:
                                json.dump(sd, f, ensure_ascii=False, indent=2)
                        ok += 1
                except Exception:
                    pass
                self.mm_progress["done"] += 1
            self.mm_progress["running"] = False
            self.mm_progress["result"] = ok
            if ok:
                msg = "简介已翻译成中文（触发词保持英文原文，不参与翻译）"
            elif no_desc == len(rows):
                msg = "该模型暂无简介可翻译（触发词保持英文原文，不参与翻译）"
            elif already == len(rows):
                msg = "简介已经是中文（已翻译过）"
            else:
                msg = "没有可翻译的内容（或翻译服务不可用，请检查设置 → 百度翻译配置）"
            self.mm_progress["msg"] = msg

        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

    def mm_open_site(self, path):
        r = next((x for x in self.model_rows if x["path"] == path), None)
        if not r:
            return False
        url = r.get("url") or ""
        if url:
            if posix_compat.IS_WINDOWS:
                os.startfile(url)
            else:
                posix_compat.open_url(url)
            return True
        return False

    def mm_check_update(self, paths=None):
        rows = [r for r in self.model_rows if r["path"] in (paths or [])] or list(self.model_rows)
        rows = [r for r in rows if r.get("modelId")]
        self.mm_progress = {"running": True, "total": len(rows), "done": 0, "msg": "", "result": None}

        def work():
            api = self._new_api()
            for r in rows:
                try:
                    m = api.get_model(r["modelId"])
                    vs = m.get("modelVersions") or []
                    latest = vs[0] if vs else None
                    if latest:
                        if r.get("verId") and str(r["verId"]) != str(latest["id"]):
                            r["update"] = "有新版本"
                        else:
                            r["update"] = "已是最新"
                    else:
                        r["update"] = "未知"
                except Exception:
                    r["update"] = "查询失败"
                self.mm_progress["done"] += 1
            self.mm_progress["running"] = False
            self.mm_progress["msg"] = "更新检查完成"

        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

    def mm_organize(self, paths=None):
        rows = [r for r in self.model_rows if r["path"] in (paths or [])] or list(self.model_rows)
        rules = self.cfg.get("organize_rules") or None
        env = self.cfg.get("target_env") or ""
        mode = self.cfg.get("organize_mode") or "manual"
        if not env:
            return {"started": False, "msg": "请先在 设置 → 📂 分类规则 选择 🎯 目标环境"}
        self.mm_progress = {"running": True, "total": len(rows), "done": 0, "msg": "", "result": []}

        def work():
            for r in rows:
                try:
                    root = self._root_of(r["path"])
                    _, msgs = model_manager.organize_model(
                        r["path"], root, dry_run=False, rules=rules, env=env, mode=mode)
                    self.mm_progress["result"].append(msgs)
                except Exception as e:
                    self.mm_progress["result"].append([str(e)])
                self.mm_progress["done"] += 1
            self.mm_progress["running"] = False
            self.mm_progress["msg"] = "整理完成"

        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

    def save_model_info(self, path, fields=None):
        """编辑模型信息并写回 .civitai.info / .json（SD 格式同步）。
        fields: {name, trained_words, description, type, base_model, version}（均为可选）"""
        import model_manager as mm
        if not path:
            return {"ok": False, "msg": "缺少模型路径"}
        info_path = mm.find_info_file(path)
        if not info_path:
            return {"ok": False, "msg": "未找到该模型的 info 文件（可先在反向解析/下载生成）"}
        fields = fields or {}
        try:
            with open(info_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except Exception:
            meta = {}
        changed = []
        if "name" in fields and fields["name"] is not None:
            meta["name"] = str(fields["name"]).strip()
            changed.append("模型名")
        if "trained_words" in fields and fields["trained_words"] is not None:
            raw = fields["trained_words"]
            if isinstance(raw, list):
                # 多套触发词：数组直接存（每套含逗号，不能被拆开）
                tw = [str(t).strip() for t in raw if str(t).strip()]
            else:
                tw = [t.strip() for t in str(raw).split(",") if t.strip()]
            meta["trainedWords"] = tw
            meta["trained_words"] = tw
            changed.append("触发词")
        if "description" in fields and fields["description"] is not None:
            meta["description"] = str(fields["description"])
            changed.append("简介")
        if "type" in fields and fields["type"] is not None:
            meta["type"] = str(fields["type"]).strip()
            changed.append("类型")
        if "base_model" in fields and fields["base_model"] is not None:
            meta["baseModel"] = str(fields["base_model"]).strip()
            meta["base_model"] = str(fields["base_model"]).strip()
            changed.append("基础模型")
        if "version" in fields and fields["version"] is not None:
            meta["version"] = str(fields["version"]).strip()
            changed.append("版本")
        with open(info_path, "w", encoding="utf-8", newline="") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        # 同步 SD 格式 json（若存在）
        base, _ = os.path.splitext(path)
        sd_path = base + ".json"
        if os.path.exists(sd_path):
            try:
                with open(sd_path, "r", encoding="utf-8") as f:
                    sd = json.load(f)
            except Exception:
                sd = {}
            if "name" in meta:
                sd["name"] = meta["name"]
            if "trainedWords" in meta:
                sd["trainedWords"] = meta["trainedWords"]
                sd["trigger_words"] = meta["trainedWords"]
            if "description" in meta:
                sd["description"] = meta["description"]
            if "baseModel" in meta:
                sd["base_model"] = meta["baseModel"]
            with open(sd_path, "w", encoding="utf-8", newline="") as f:
                json.dump(sd, f, ensure_ascii=False, indent=2)
        return {"ok": True, "msg": "已更新: " + "、".join(changed) if changed else "无修改"}

    # ---------------- 待办下载清单 ----------------
    def _todo_path(self):
        import config
        return os.path.join(config.APP_DIR, "todo_downloads.json")

    def todo_add(self, url, days=None, deadline=None):
        """添加待办。时间自动选择：Early Access deadline 优先；无则默认 7 天。
        days/deadline 可显式传入（前端不再让用户选时间）。同时记下模型名，清单里好认。"""
        url = (url or "").strip()
        if not url:
            return {"ok": False, "msg": "链接不能为空"}
        label = ""
        # 自动检测：解析模型版本拿 earlyAccessDeadline + 顺手取模型名
        if days is None and not deadline:
            try:
                model_id, version_id = self.api.resolve_url(url)
                mv = None
                if version_id:
                    mv = self.api.get_model_version(version_id)
                else:
                    m = self.api.get_model(model_id)
                    vs = m.get("modelVersions") or []
                    mv = vs[0] if vs else None
                if mv:
                    label = (mv.get("name") or "").strip()
                    dl = mv.get("earlyAccessDeadline") or 0
                    if dl:
                        deadline = int(dl)
            except Exception:
                pass
        if deadline:
            unlock_at = int(deadline)
        else:
            days = 7 if days is None else max(0, int(days))
            unlock_at = int(time.time()) + days * 86400
        path = self._todo_path()
        todos = []
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    todos = json.load(f)
            except Exception:
                todos = []
        todos = [t for t in todos if t.get("url") != url]
        todos.append({"url": url, "unlock_at": unlock_at, "added_at": int(time.time()),
                      "label": label or _todo_label(url)})
        with open(path, "w", encoding="utf-8", newline="") as f:
            json.dump(todos, f, ensure_ascii=False, indent=1)
        left = max(0, int((unlock_at - time.time()) / 86400))
        if unlock_at <= time.time():
            msg = "已加入待办（现在就可以下载）"
        else:
            msg = "已加入待办（约 %d 天后到期）" % left
        return {"ok": True, "msg": msg, "label": label or _todo_label(url)}

    def todo_download(self, url):
        """清单里一键下载：走「解析并入队」链路（与浏览器扩展一键下载一致），成功后从清单移除"""
        url = (url or "").strip()
        if not url:
            return {"ok": False, "msg": "链接为空"}
        try:
            r = self.dl_enqueue_url(url) or {}
        except Exception as e:
            return {"ok": False, "msg": "%s: %s" % (type(e).__name__, str(e)[:120])}
        if not r.get("started"):
            return {"ok": False, "msg": r.get("msg") or "未能开始下载"}
        try:
            self.todo_remove(url)
        except Exception:
            pass
        return {"ok": True, "msg": "已开始解析并加入下载队列（已从清单移除）"}

    def todo_download_all(self):
        """把「已到期」的待办全部一键下载（清单里「全部下载」按钮）"""
        try:
            r = self.todo_list() or {}
        except Exception:
            r = {}
        due = [t for t in (r.get("todos") or []) if t.get("due")]
        if not due:
            return {"ok": False, "msg": "没有已到期的待办"}
        started, failed = 0, 0
        for t in due:
            res = self.todo_download(t.get("url") or "")
            if res.get("ok"):
                started += 1
            else:
                failed += 1
        msg = "已开始下载 %d 个" % started
        if failed:
            msg += "，%d 个失败" % failed
        return {"ok": started > 0, "msg": msg, "started": started, "failed": failed}

    def todo_remove(self, url):
        path = self._todo_path()
        todos = []
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    todos = json.load(f)
            except Exception:
                todos = []
        todos = [t for t in todos if t.get("url") != url]
        with open(path, "w", encoding="utf-8", newline="") as f:
            json.dump(todos, f, ensure_ascii=False, indent=1)
        return True

    def todo_list(self):
        path = self._todo_path()
        todos = []
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    todos = json.load(f)
            except Exception:
                todos = []
        now = int(time.time())
        for t in todos:
            t["due"] = bool(t.get("unlock_at", 0) <= now)
            t["remain_days"] = max(0, int((t.get("unlock_at", 0) - now) / 86400))
            if not t.get("label"):          # 老条目没有名字：从链接里补一个
                t["label"] = _todo_label(t.get("url") or "")
        return {"todos": todos}

    def todo_due(self):
        """启动检查：返回已到期条目（不删除，提醒后由用户处理）"""
        r = self.todo_list()
        return {"due": [t for t in r["todos"] if t.get("due")]}

    # ---------------- 自定义封面 ----------------
    def set_custom_cover(self, path, b64):
        """上传本地图片覆盖为模型封面（<模型名>.preview.png）"""
        import base64
        if not path or not b64:
            return {"ok": False, "msg": "缺少参数"}
        try:
            raw = base64.b64decode(str(b64))
        except Exception:
            return {"ok": False, "msg": "图片数据无效"}
        if len(raw) > 20 * 1048576:
            return {"ok": False, "msg": "图片过大（>20MB）"}
        base, _ = os.path.splitext(path)
        dest = base + ".preview.png"
        try:
            from PIL import Image
            import io as _io
            im = Image.open(_io.BytesIO(raw))
            im = im.convert("RGB")
            im.thumbnail((1024, 1024), Image.LANCZOS)
            im.save(dest, "PNG")
        except Exception as e:
            return {"ok": False, "msg": "图片处理失败: %s" % e}
        return {"ok": True, "msg": "封面已更新: %s" % os.path.basename(dest)}

    def mm_restore_organize(self, preview=True):
        """恢复误整理：日志反向 + 非标准目录扫描。preview=True 只列不执行。
        返回 {ok, count, items:[{src, dest, why}], msg}"""
        import model_manager as mm
        root = (self.cfg.get("models_dir") or "").strip()
        env = self.cfg.get("target_env") or ""
        if not root or not env:
            return {"ok": False, "count": 0, "items": [], "msg": "请先在设置选择 🎯 目标环境"}
        env_map = mm.ENV_DIRS.get(env) or {}
        std_dirs = set(env_map.values())

        items = []
        seen = set()

        def add_item(src, dest, why):
            if src in seen:
                return
            seen.add(src)
            items.append({"src": src, "dest": dest, "why": why})

        # 1) 日志反向恢复（organize_log.json）
        log_path = os.path.join(self._app_dir(), "organize_log.json")
        if os.path.exists(log_path):
            try:
                with open(log_path, "r", encoding="utf-8") as f:
                    logs = json.load(f)
                for entry in reversed(logs or []):
                    src = entry.get("src")
                    dest = entry.get("dest")
                    if not src or not dest:
                        continue
                    if os.path.exists(dest):
                        add_item(dest, src, "日志回退（曾从 %s 移走）" % os.path.basename(src))
            except Exception:
                pass

        # 2) 扫描非标准目录：有 info 的已知类型模型不在标准目录下（多目录各扫一遍）
        known_exts = (".safetensors", ".ckpt", ".pt", ".pth", ".bin", ".onnx", ".gguf", ".sft")
        for root in self._models_roots() or [(self.cfg.get("models_dir") or "").strip()]:
            if not root or not os.path.isdir(root):
                continue
            for dirpath, dirnames, filenames in os.walk(root):
                rel = os.path.relpath(dirpath, root)
                top = rel.split(os.sep)[0] if rel != "." else ""
                if top in std_dirs:
                    dirnames[:] = []
                    continue
                for fn in filenames:
                    if not fn.lower().endswith(known_exts):
                        continue
                    fp = os.path.join(dirpath, fn)
                    info_path = mm.find_info_file(fp)
                    if not info_path:
                        continue
                    try:
                        with open(info_path, "r", encoding="utf-8") as f:
                            meta = json.load(f)
                    except Exception:
                        continue
                    mtype = (meta.get("type") or meta.get("model_type") or "").strip()
                    tdir = env_map.get(mtype)
                    if not tdir:
                        continue
                    std_dir = os.path.join(root, tdir)
                    if os.path.normpath(dirpath).startswith(os.path.normpath(std_dir)):
                        continue
                    dest = os.path.join(std_dir, fn)
                    if os.path.exists(dest):
                        continue
                    add_item(fp, dest, "类型「%s」不在标准目录 %s/" % (mtype or "?", tdir))

        if preview:
            return {"ok": True, "count": len(items), "items": items, "msg": "预览完成"}

        # 执行：只移动，不删除
        moved = 0
        fails = []
        for it in items:
            try:
                dest_dir = os.path.dirname(it["dest"])
                os.makedirs(dest_dir, exist_ok=True)
                if os.path.exists(it["dest"]):
                    continue
                shutil.move(it["src"], it["dest"])
                base_src, _ = os.path.splitext(it["src"])
                base_dst, _ = os.path.splitext(it["dest"])
                for ext in mm._SIDE_EXTS:
                    side = base_src + ext
                    if os.path.exists(side):
                        try:
                            shutil.move(side, base_dst + ext)
                        except Exception:
                            pass
                moved += 1
            except Exception as e:
                fails.append("%s (%s)" % (os.path.basename(it["src"]), e))
        return {"ok": True, "count": moved, "items": items,
                "msg": "已恢复 %d 个" % moved + ("；失败: " + "; ".join(fails[:5]) if fails else "")}

    def _app_dir(self):
        import config
        return config.APP_DIR

    def mm_cleanup(self, paths=None):
        rows = [r for r in self.model_rows if r["path"] in (paths or [])] or list(self.model_rows)
        self.mm_progress = {"running": True, "total": len(rows), "done": 0, "msg": "", "result": 0}

        def work():
            removed = 0
            for r in rows:
                try:
                    removed += model_manager.cleanup_model(r["path"])
                except Exception:
                    pass
                self.mm_progress["done"] += 1
            self.mm_progress["running"] = False
            self.mm_progress["result"] = removed
            self.mm_progress["msg"] = "清理完成（共 %d 项）" % removed

        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

    # ---------------- 反向解析 ----------------
    def rp_add_paths(self, paths):
        for p in paths or []:
            if not any(r["path"] == p for r in self.rp_rows):
                self.rp_rows.append({"path": p, "sha": "", "status": "等待", "model": "", "version": ""})
        return True

    def rp_add_dir(self, d):
        files = model_manager.scan_models(d)
        self.rp_add_paths([f["path"] for f in files])
        return True

    def rp_state(self):
        return self._rp_state

    def rp_remove(self, paths):
        self.rp_rows = [r for r in self.rp_rows if r["path"] not in (paths or [])]
        return True

    def rp_clear(self):
        self.rp_rows = []
        self._rp_state = {"running": False, "paused": False, "done": 0, "total": 0}
        return True

    def rp_get_rows(self):
        return self.rp_rows

    def rp_start(self):
        if self._rp_state["running"]:
            return False
        if not self.rp_rows:
            return False
        self._rp_pause_ev.clear()
        self._rp_stop_ev.clear()
        self._rp_state = {"running": True, "paused": False, "done": 0, "total": len(self.rp_rows)}
        n = max(1, int(self.cfg.get("hash_threads", 4)))
        lock = threading.Lock()
        idx = [0]

        def worker():
            api = self._new_api()
            while True:
                if self._rp_stop_ev.is_set():
                    return
                if self._rp_pause_ev.is_set():
                    self._rp_state["paused"] = True
                    while self._rp_pause_ev.is_set() and not self._rp_stop_ev.is_set():
                        time.sleep(0.2)
                    self._rp_state["paused"] = False
                    if self._rp_stop_ev.is_set():
                        return
                with lock:
                    i = idx[0]
                    idx[0] += 1
                if i >= len(self.rp_rows):
                    return
                r = self.rp_rows[i]
                r["status"] = "反查中"
                try:
                    res = reverse_parse.reverse_by_hash(
                        r["path"], api, self.cfg,
                        translate_desc=bool(self.cfg.get("auto_translate", True)),
                        cancel_ev=self._rp_stop_ev)
                    if self._rp_stop_ev.is_set() and res.get("error") == "已取消":
                        r["status"] = "已取消"
                    else:
                        r["sha"] = (res["sha256"] or "")[:16] + "…" if res["sha256"] else ""
                        if res["found"]:
                            r["status"] = "成功"
                            r["model"] = (res["model"] or {}).get("name", "")
                            r["version"] = (res["version"] or {}).get("name", "")
                        else:
                            r["status"] = "未收录" if "404" in res.get("error", "") else "失败"
                            r["model"] = res.get("error", "")
                except Exception as e:
                    r["status"] = "失败"
                    r["model"] = str(e)[:80]
                with lock:
                    self._rp_state["done"] += 1

        def run_all():
            pool = [threading.Thread(target=worker, daemon=True) for _ in range(n)]
            for t in pool:
                t.start()
            for t in pool:
                t.join()
            self._rp_state["running"] = False

        threading.Thread(target=run_all, daemon=True).start()
        return True

    def rp_pause(self):
        if self._rp_pause_ev.is_set():
            self._rp_pause_ev.clear()
        else:
            self._rp_pause_ev.set()
        return self._rp_pause_ev.is_set()

    def rp_stop(self):
        self._rp_stop_ev.set()
        return True

    # ---------------- 测试 ----------------
    def test_api(self):
        try:
            d = self.api._get("/models", {"limit": 1})
            return {"ok": True, "msg": "API 正常，返回模型数: %d" % len(d.get("items", []))}
        except Exception as e:
            return {"ok": False, "msg": _friendly_api_error(e)}

    def test_baidu(self):
        appid = self.cfg.get("baidu_appid", "").strip()
        key = self.cfg.get("baidu_key", "").strip()
        try:
            out = translator.baidu_translate("Hello, this is a test.", appid, key)
            return {"ok": True, "msg": "翻译结果: %s" % out}
        except Exception as e:
            return {"ok": False, "msg": str(e)}
