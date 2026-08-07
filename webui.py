# -*- coding: utf-8 -*-
"""CivitaiFreeTool Web 版后端：pywebview js_api bridge
前端（web/index.html）通过 window.pywebview.api 调用；耗时任务后台线程 + 前端轮询进度。
业务逻辑复用 civitai_api / downloader / model_manager / reverse_parse / translator / config。"""
import json
import os
import threading
import time

import webview

import civitai_api
import config
import downloader
import model_manager
import reverse_parse
import translator
from gui import (_download_image, _recycle_to_trash, _text_to_rules, _rules_to_text,
                 _folder_visible, _friendly_api_error)


class Api:
    def __init__(self):
        self.cfg = config.load()
        self.api = self._new_api()
        self.dl = downloader.Downloader(self.cfg)
        self.lock = threading.Lock()
        # 模型管理
        self.model_rows = []
        self.mm_checked_paths = []
        self.mm_progress = {"running": False, "total": 0, "done": 0, "msg": "", "result": None}
        self.mm_scan_state = {"running": False, "rows": [], "msg": ""}
        self.rp_rows = []
        self.rp_state = {"running": False, "paused": False, "done": 0, "total": 0}
        self._rp_pause_ev = threading.Event()
        self._rp_stop_ev = threading.Event()

    def _new_api(self):
        return civitai_api.CivitaiAPI(
            self.cfg.get("api_key", ""), 20,
            self.cfg.get("proxy_address") if self.cfg.get("proxy_enabled") else None)

    # ---------------- 配置 ----------------
    def get_config(self):
        return self.cfg

    def save_config(self, new_cfg):
        self.cfg = config.DEFAULTS.copy()
        for k, v in (new_cfg or {}).items():
            if k in config.DEFAULTS or True:
                self.cfg[k] = v
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
                        dest_dir=self.cfg.get("download_dir") or "downloads/models",
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
                    "filename": t.filename, "status": t.status,
                    "progress": t.progress, "speed": t.speed,
                    "downloaded": t.downloaded, "total": t.total,
                    "error": t.error, "dest_dir": t.dest_dir,
                    "modelName": (t.info or {}).get("modelName", ""),
                    "versionName": (t.info or {}).get("versionName", ""),
                })
            return out

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
        root = (self.cfg.get("models_dir") or "").strip()
        if self.mm_scan_state["running"]:
            return {"started": False}
        self.mm_scan_state = {"running": True, "rows": [], "msg": ""}

        def work():
            try:
                files = model_manager.scan_models(root) if root and os.path.isdir(root) else []
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
                    rows.append({
                        "path": f["path"], "name": f["name"], "size": f["size"],
                        "mtime": f.get("mtime") or 0,
                        "type": meta.get("type", ""),
                        "base": meta.get("baseModel") or meta.get("base_model", ""),
                        "ver": ver,
                        "verId": meta.get("versionId") or meta.get("version_id", ""),
                        "modelId": meta.get("modelId") or meta.get("model_id", ""),
                        "url": meta.get("url", ""),
                        "trainedWords": meta.get("trainedWords", []),
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

    def _collect_tree(self, root, rel_prefix=""):
        """递归收集目录树（含多级子文件夹）"""
        tree = []
        try:
            entries = sorted(os.listdir(root))
        except Exception:
            return tree
        for d in entries:
            p = os.path.join(root, d)
            if os.path.isdir(p) and not d.startswith("."):
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
        base = self.cfg.get("download_dir") or ""
        n = 0
        for p in (paths or []):
            rel = p.replace("\\", "/")
            dl_url = "https://huggingface.co/%s/resolve/%s/%s" % (repo, rev, rel)
            dest_dir = os.path.dirname(os.path.join(base, rel)) if base else ""
            try:
                os.makedirs(dest_dir, exist_ok=True)
            except Exception:
                pass
            task = downloader.DownloadTask(
                url=dl_url,
                dest_dir=dest_dir,
                filename=os.path.basename(rel),
                info={"source": "hf", "repo": repo, "rel_path": rel},
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
        # 立即应用：重算显示行（_folder_visible 需要相对路径）
        if self.model_rows:
            root = (self.cfg.get("models_dir") or "").replace("\\", "/").rstrip("/")
            hidden_set = set(self.cfg["hidden_model_folders"])
            def _rel(p):
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
                        # 补全完整元数据（.civitai.info + .json）
                        try:
                            if r.get("modelId"):
                                m = api.get_model(r["modelId"])
                                sd_d = (self.cfg.get("site_domain", "civitai.red") or "civitai.red").strip("/")
                                site_base = sd_d if "://" in sd_d else "https://" + sd_d
                                fi = reverse_parse.build_info(m, v, site_base)
                                fs = reverse_parse.build_sd_metadata(m, v, site_base)
                                b, _ = os.path.splitext(r["path"])
                                with open(b + ".civitai.info", "w", encoding="utf-8") as f:
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

    def _site_url(self, model_id, version_id=None):
        d = (self.cfg.get("site_domain", "civitai.red") or "civitai.red").strip("/")
        base = d if "://" in d else "https://" + d
        u = "%s/models/%s" % (base, model_id)
        if version_id:
            u += "?modelVersionId=%s" % version_id
        return u

    def mm_rename(self, paths=None):
        """重命名为 C 站模型名（后台线程）"""
        rows = [r for r in self.model_rows if r["path"] in (paths or [])] or list(self.model_rows)
        if not rows:
            return {"started": False, "msg": "没有可重命名的模型"}
        self.mm_progress = {"running": True, "total": len(rows), "done": 0, "msg": "", "result": []}

        def work():
            for r in rows:
                try:
                    _, msgs = model_manager.rename_to_civitai(r["path"], r.get("info") or {})
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
                        model_manager.rename_to_civitai(r["path"], meta2)
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
                            if _download_image(u, dest):
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
        appid = self.cfg.get("baidu_appid", "").strip()
        key = self.cfg.get("baidu_key", "").strip()
        rows = [r for r in self.model_rows if r["path"] in (paths or [])] or list(self.model_rows)
        self.mm_progress = {"running": True, "total": len(rows), "done": 0, "msg": "", "result": 0}

        def work():
            ok = 0
            for r in rows:
                b, _ = os.path.splitext(r["path"])
                try:
                    with open(b + ".json", "r", encoding="utf-8") as f:
                        d = json.load(f)
                    desc = (d.get("description") or "").strip()
                    if desc and not translator._is_cjk(desc):
                        zh = translator.translate(desc, appid, key)
                        if zh and zh != desc:
                            d["description"] = zh
                            d["description_zh"] = zh
                            with open(b + ".json", "w", encoding="utf-8") as f:
                                json.dump(d, f, ensure_ascii=False, indent=2)
                            ok += 1
                except Exception:
                    pass
                self.mm_progress["done"] += 1
            self.mm_progress["running"] = False
            self.mm_progress["result"] = ok
            self.mm_progress["msg"] = "简介翻译完成"

        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

    def mm_open_site(self, path):
        r = next((x for x in self.model_rows if x["path"] == path), None)
        if not r:
            return False
        url = r.get("url") or ""
        if url:
            os.startfile(url)
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
        root = (self.cfg.get("models_dir") or "").strip()
        rules = self.cfg.get("organize_rules") or None
        self.mm_progress = {"running": True, "total": len(rows), "done": 0, "msg": "", "result": []}

        def work():
            for r in rows:
                try:
                    _, msgs = model_manager.organize_model(r["path"], root, dry_run=False, rules=rules)
                    self.mm_progress["result"].append(msgs)
                except Exception as e:
                    self.mm_progress["result"].append([str(e)])
                self.mm_progress["done"] += 1
            self.mm_progress["running"] = False
            self.mm_progress["msg"] = "整理完成"

        threading.Thread(target=work, daemon=True).start()
        return {"started": True}

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
        return self.rp_state

    def rp_remove(self, paths):
        self.rp_rows = [r for r in self.rp_rows if r["path"] not in (paths or [])]
        return True

    def rp_get_rows(self):
        return self.rp_rows

    def rp_start(self):
        if self.rp_state["running"]:
            return False
        if not self.rp_rows:
            return False
        self._rp_pause_ev.clear()
        self._rp_stop_ev.clear()
        self.rp_state = {"running": True, "paused": False, "done": 0, "total": len(self.rp_rows)}
        n = max(1, int(self.cfg.get("hash_threads", 4)))
        lock = threading.Lock()
        idx = [0]

        def worker():
            api = self._new_api()
            while True:
                if self._rp_stop_ev.is_set():
                    return
                if self._rp_pause_ev.is_set():
                    self.rp_state["paused"] = True
                    while self._rp_pause_ev.is_set() and not self._rp_stop_ev.is_set():
                        time.sleep(0.2)
                    self.rp_state["paused"] = False
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
                    self.rp_state["done"] += 1

        def run_all():
            pool = [threading.Thread(target=worker, daemon=True) for _ in range(n)]
            for t in pool:
                t.start()
            for t in pool:
                t.join()
            self.rp_state["running"] = False

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
