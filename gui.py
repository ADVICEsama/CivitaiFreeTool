# -*- coding: utf-8 -*-
"""CivitaiFreeTool GUI —— 免费的全功能 Civitai 模型下载/管理/反向解析工具
五个标签页：批量下载 / 下载管理 / 模型管理 / 反向解析 / 设置
全部功能免费开放，无任何付费墙。"""
import json
import os
import queue
import shutil
import threading
import time
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

import civitai_api
import config
import downloader
import frameless
import model_manager
import reverse_parse
import theme
import translator
import ui

ST_TEXT = {
    downloader.ST_PENDING: "等待中",
    downloader.ST_DOWNLOADING: "下载中",
    downloader.ST_DONE: "已完成",
    downloader.ST_PAUSED: "已暂停",
    downloader.ST_ERROR: "失败",
    downloader.ST_CANCELED: "已取消",
}


class Worker:
    """轻量后台线程：运行 fn，把回调 post 到 GUI 队列"""

    def __init__(self, gui, fn, done_cb=None):
        self.gui = gui
        self.fn = fn
        self.done_cb = done_cb
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self):
        try:
            result = self.fn()
        except Exception:
            import traceback
            result = ("__error__", traceback.format_exc())
        if self.done_cb:
            self.gui.post(lambda: self.done_cb(result))


class CivitaiFreeGUI(tk.Tk):
    # API 查询类请求的超时（秒）：网络抖动时快速失败，不阻塞 UI；下载超时另用 download_timeout
    API_TIMEOUT = 20

    def __init__(self):
        super().__init__()
        self._setup_fonts()
        self.title("CivitaiFreeTool — Civitai 模型下载/管理/反向解析（免费全功能）")
        self.geometry("1180x720")
        self.minsize(980, 620)
        self.cfg = config.load()
        # 主题（深/浅色，默认深色配合 Mica）
        self.style = ttk.Style(self)
        self.theme = self.cfg.get("theme", "dark")
        ui.apply_theme(self, self.style, self.theme)
        self.api = civitai_api.CivitaiAPI(
            self.cfg.get("api_key", ""), self.API_TIMEOUT,
            self.cfg.get("proxy_address") if self.cfg.get("proxy_enabled") else None,
        )
        self.ui_q = queue.Queue()
        self.dl = downloader.Downloader(self.cfg, on_update=self._on_dl_update)
        self.model_rows = []          # 模型管理列表数据
        self.rp_rows = []             # 反向解析列表数据
        self._thumbs = {}             # iid -> PhotoImage（缩略图引用，防 GC）
        self._last_poll_error = None  # 诊断：UI 队列回调异常记录
        self._row_hovers = []         # RowHover 实例（主题切换时刷新）
        self._build_ui()
        self.after(60, self._poll_ui)
        self.dl.load_tasks()
        self._refresh_dl_table()
        # 无边框模式（自绘标题栏；失败自动回退系统边框）
        self.frameless_bar = None
        if self.cfg.get("frameless", False):
            self.frameless_bar = frameless.enable_frameless(self)
        # 应用窗口背景风格（Mica/亚克力）
        self.update_idletasks()
        theme.apply_backdrop(self.winfo_id(), self.cfg.get("window_style", "mica"))

    def _site_url(self, model_id, version_id=None):
        """按配置的站点域名生成模型页链接（默认 civitai.red）"""
        d = (self.cfg.get("site_domain", "civitai.red") or "civitai.red").strip("/")
        base = d if "://" in d else "https://" + d
        u = "%s/models/%s" % (base, model_id)
        if version_id:
            u += "?modelVersionId=%s" % version_id
        return u

    def _new_api(self):
        """按当前配置新建 API 实例（每个工作线程独立实例，避免共享锁串行）"""
        return civitai_api.CivitaiAPI(
            self.cfg.get("api_key", ""), self.API_TIMEOUT,
            self.cfg.get("proxy_address") if self.cfg.get("proxy_enabled") else None,
        )

    def _setup_fonts(self):
        """全局指定中文字体，避免打包 exe 中 Tk 默认字体把中文渲染成方框"""
        try:
            import tkinter.font as tkfont
            fams = set(tkfont.families())
            for fam in ("Microsoft YaHei UI", "Microsoft YaHei", "SimHei", "SimSun"):
                if fam in fams:
                    self.option_add("*Font", (fam, 10))
                    return
        except Exception:
            pass

    # ---------------- UI 工具 ----------------
    def post(self, fn):
        self.ui_q.put(fn)

    def _poll_ui(self):
        try:
            while True:
                fn = self.ui_q.get_nowait()
                try:
                    fn()
                except Exception:
                    import traceback
                    self._last_poll_error = traceback.format_exc()
        except queue.Empty:
            pass
        self.after(60, self._poll_ui)

    def _log(self, widget, text):
        widget.insert("end", text + "\n")
        widget.see("end")

    # ---------------- 界面构建 ----------------
    def _build_ui(self):
        # 顶部装饰线（页面切换 spring 动效）
        self.tab_motion_cv = tk.Canvas(self, height=3, bg=ui.CURRENT["bg"], highlightthickness=0)
        self.tab_motion_cv.pack(fill="x")
        self.tab_motion = ui.TabMotion(self.tab_motion_cv)
        # 氛围动态背景带（可关闭；主题色光晕流动）
        self.ambient_cv = tk.Canvas(self, height=22, bg=ui.CURRENT["bg"], highlightthickness=0)
        self.ambient_cv.pack(fill="x")
        self.ambient = ui.AmbientBackground(self.ambient_cv)
        if self.cfg.get("ambient_bg", True):
            self.ambient.start()
        self.nb = ttk.Notebook(self)
        self.nb.pack(fill="both", expand=True)
        self._build_download_page(self.nb)
        self._build_dl_manager_page(self.nb)
        self._build_model_manager_page(self.nb)
        self._build_reverse_page(self.nb)
        self._build_settings_page(self.nb)
        self.nb.bind("<<NotebookTabChanged>>", self._on_tab_changed)
        self.status_var = tk.StringVar(value="就绪")
        ttk.Label(self, textvariable=self.status_var, anchor="w").pack(fill="x", padx=8, pady=(2, 6))

    def _on_tab_changed(self, _e=None):
        """切页动效 + 打开模型管理页时若尚未扫描则自动扫描"""
        self.tab_motion.play()
        try:
            if self.nb.index("current") == 2 and not self.model_rows:
                root = (self.cfg.get("models_dir") or "").strip()
                if root and os.path.isdir(root):
                    self._mm_scan()
        except Exception:
            pass

    # ============ 页面1：批量下载 ============
    def _build_download_page(self, nb):
        page = ttk.Frame(nb)
        nb.add(page, text="批量下载")
        ttk.Label(page, text="Civitai 链接（每行一个，回车新建一条；支持三种格式）：").pack(anchor="w", padx=8, pady=(8, 2))
        ttk.Label(page, text="  https://civitai.red/models/12345\n"
                             "  https://civitai.red/models/12345?modelVersionId=678\n"
                             "  https://civitai.com/api/download/models/678",
                  foreground="#888").pack(anchor="w", padx=16)
        # 逐条 URL 行（可滚动）
        self.url_rows = []  # list[dict(entry, frame, iid)]
        url_canvas = tk.Canvas(page, highlightthickness=0, height=150)
        url_vsb = ttk.Scrollbar(page, orient="vertical", command=url_canvas.yview)
        url_inner = ttk.Frame(url_canvas)
        url_inner.bind("<Configure>", lambda e: url_canvas.configure(scrollregion=url_canvas.bbox("all")))
        url_win = url_canvas.create_window((0, 0), window=url_inner, anchor="nw")
        url_canvas.configure(yscrollcommand=url_vsb.set)
        # 内容宽度跟随画布，避免窄窗口裁剪行内按钮
        url_canvas.bind("<Configure>", lambda e: url_canvas.itemconfigure(url_win, width=e.width))
        url_vsb.pack(side="right", fill="y")
        url_canvas.pack(fill="x", padx=(8, 0), pady=4)
        self.url_canvas = url_canvas
        self.url_inner = url_inner
        self._add_url_row()

        bar = ttk.Frame(page)
        bar.pack(fill="x", padx=8)
        ui.GlowButton(bar, text="解析并加入下载队列", command=self._parse_urls, kind="primary").pack(side="left")
        ui.GlowButton(bar, text="清空全部", command=self._clear_url_rows).pack(side="left", padx=6)
        ui.GlowButton(bar, text="添加一条", command=self._add_url_row).pack(side="left", padx=2)
        # 解析结果（改小 + 滚动条）
        log_frame = ttk.Frame(page)
        log_frame.pack(fill="x", padx=8, pady=(4, 8))
        log_ys = ttk.Scrollbar(log_frame, orient="vertical")
        self.parse_log = tk.Text(log_frame, height=5, state="disabled")
        log_ys.configure(command=self.parse_log.yview)
        self.parse_log.configure(yscrollcommand=log_ys.set)
        log_ys.pack(side="right", fill="y")
        self.parse_log.pack(side="left", fill="x")

    def _add_url_row(self, url=""):
        """新建一条 URL 行，返回其记录"""
        row = {}
        f = ttk.Frame(self.url_inner)
        f.pack(fill="x", pady=1, padx=4)
        entry = ttk.Entry(f, width=80)
        entry.insert(0, url)
        entry.pack(side="left", fill="x", expand=True)
        entry.bind("<Return>", lambda e: (self._add_url_row(), "break"))
        row["entry"] = entry
        row["frame"] = f
        for text, tip, cmd in (("＋", "在下方新建一条", lambda: self._add_url_row()),
                               ("↑", "上移", lambda: self._move_url_row(row, -1)),
                               ("↓", "下移", lambda: self._move_url_row(row, 1)),
                               ("×", "删除此行", lambda: self._remove_url_row(row))):
            b = tk.Label(f, text=text, width=2, cursor="hand2",
                         bg=ui.CURRENT["surface2"], fg=ui.CURRENT["text_dim"])
            b.pack(side="right", padx=1)
            b.bind("<Enter>", lambda e, b=b: b.configure(bg=ui.CURRENT["hover"], fg=ui.CURRENT["text"]))
            b.bind("<Leave>", lambda e, b=b: b.configure(bg=ui.CURRENT["surface2"], fg=ui.CURRENT["text_dim"]))
            b.bind("<Button-1>", lambda e, c=cmd: c())
        self.url_rows.append(row)
        self._url_rows_reflow()
        entry.focus_set()
        return row

    def _remove_url_row(self, row):
        if row in self.url_rows:
            self.url_rows.remove(row)
            row["frame"].destroy()
        if not self.url_rows:
            self._add_url_row()

    def _move_url_row(self, row, delta):
        i = self.url_rows.index(row)
        j = i + delta
        if 0 <= j < len(self.url_rows):
            self.url_rows[i], self.url_rows[j] = self.url_rows[j], self.url_rows[i]
            self._url_rows_reflow()

    def _url_rows_reflow(self):
        for row in self.url_rows:
            row["frame"].pack_forget()
        for row in self.url_rows:
            row["frame"].pack(fill="x", pady=1, padx=4)
        # 让滚动区高度随内容自适应（上限）
        self.url_inner.update_idletasks()

    def _clear_url_rows(self):
        for row in self.url_rows:
            row["frame"].destroy()
        self.url_rows = []
        self._add_url_row()

    def _collect_urls(self):
        return [e.get().strip() for row in self.url_rows for e in [row["entry"]] if e.get().strip()]

    def _parse_urls(self):
        urls = self._collect_urls()
        if not urls:
            messagebox.showinfo("提示", "请先粘贴链接")
            return
        api = self.api
        dl = self.dl

        def work():
            added = 0
            for u in urls:
                try:
                    model_id, version_id = api.resolve_url(u)
                    if not version_id:
                        m = api.get_model(model_id)
                        vs = m.get("modelVersions") or []
                        if not vs:
                            yield ("fail", u, "模型没有可用版本")
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
                    # 命名：文件名 + 版本号 + 后缀；可选把模型名翻译成中文
                    src_ext = os.path.splitext(f.get("name") or "")[1] or ".safetensors"
                    base_name = os.path.splitext(f.get("name") or "")[0]
                    base_name = model_manager.sanitize_filename(base_name) or model_name
                    if self.cfg.get("translate_filename", False) and model_name:
                        if translator._is_cjk(model_name):
                            base_name = model_manager.sanitize_filename(model_name)  # 已是中文直接用
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
                    # 预存元数据：下载完成后生成 SD 可理解的 metadata.json / civitai.info
                    meta = {}
                    try:
                        sd_d = (self.cfg.get("site_domain", "civitai.red") or "civitai.red").strip("/")
                        site_base = sd_d if "://" in sd_d else "https://" + sd_d
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
                              "versionName": version.get("name", ""), "url": u,
                              "meta": meta},
                    )
                    dl.add_task(task)
                    added += 1
                    yield ("ok", u, "已加入: %s" % fname)
                except civitai_api.CivitaiError as e:
                    yield ("fail", u, str(e))
                except Exception as e:
                    yield ("fail", u, str(e))
            yield ("done", added)

        def done(res):
            self.parse_log.configure(state="normal")
            if isinstance(res, tuple) and res and res[0] == "__error__":
                self._log(self.parse_log, "[错误] %s" % res[1])
                self.parse_log.configure(state="disabled")
                self._refresh_dl_table()
                return
            for item in res:
                if item[0] == "done":
                    self._log(self.parse_log, "—— 完成，共加入 %s 个任务 ——" % item[1])
                elif item[0] == "ok":
                    self._log(self.parse_log, "[OK] %s" % item[2])
                else:
                    self._log(self.parse_log, "[失败] %s -> %s" % (item[1], item[2]))
            self.parse_log.configure(state="disabled")
            self._refresh_dl_table()

        # 生成器包一层，在线程里跑
        def runner():
            return list(work())

        Worker(self, runner, done)

    # ============ 页面2：下载管理 ============
    def _build_dl_manager_page(self, nb):
        page = ttk.Frame(nb)
        nb.add(page, text="下载管理")
        bar = ttk.Frame(page)
        bar.pack(fill="x", padx=8, pady=6)
        ui.GlowButton(bar, text="全部开始", command=self._dl_start_all).pack(side="left")
        ui.GlowButton(bar, text="暂停选中", command=self._dl_pause_sel).pack(side="left", padx=4)
        ui.GlowButton(bar, text="重试选中", command=self._dl_retry_sel).pack(side="left", padx=4)
        ui.GlowButton(bar, text="移除选中", command=self._dl_remove_sel).pack(side="left", padx=4)
        ui.GlowButton(bar, text="清空已完成", command=self._dl_clear_done).pack(side="left", padx=4)
        ui.GlowButton(bar, text="保存任务列表", command=lambda: self.dl.save_tasks()).pack(side="left", padx=4)
        cols = ("status", "progress", "speed", "size", "error")
        self.dl_tree = ttk.Treeview(page, columns=cols, show="tree headings", height=14)
        self.dl_tree.heading("#0", text="文件名（封面 + 文件名）")
        self.dl_tree.column("#0", width=330, anchor="w")
        heads = {"status": ("状态", 80), "progress": ("进度", 90),
                 "speed": ("速度", 80), "size": ("大小", 90), "error": ("错误信息", 220)}
        for c, (t, w) in heads.items():
            self.dl_tree.heading(c, text=t)
            self.dl_tree.column(c, width=w, anchor="w")
        self.dl_tree.pack(fill="both", expand=True, padx=8)
        self._row_hovers.append(ui.RowHover(self.dl_tree))
        self._dl_thumbs = {}  # iid -> PhotoImage
        ttk.Label(page, text="任务信息：").pack(anchor="w", padx=8, pady=(6, 0))
        self.dl_info = tk.Text(page, height=5, state="disabled")
        self.dl_info.pack(fill="x", padx=8, pady=(0, 8))
        self.dl_tree.bind("<<TreeviewSelect>>", self._dl_show_info)
        # 行标签映射
        self.dl_id_map = {}  # iid -> task

    def _on_dl_update(self, task):
        self.post(self._refresh_dl_table)
        if task.status == downloader.ST_DONE:
            self.post(lambda: self._handle_dl_done(task))

    def _handle_dl_done(self, task):
        """下载完成：生成 metadata.json + 询问移动位置"""
        if getattr(task, "_handled", False):
            return
        task._handled = True
        src = os.path.join(task.dest_dir, task.filename)
        base, _ = os.path.splitext(src)
        # 1. 生成 SD 可理解的 metadata（按设置格式）
        meta = task.info.get("meta") or {}
        fmt = self.cfg.get("metadata_format", "sd")
        try:
            if meta.get("info"):
                # SD WebUI（civitai 助手）读取 <名>.civitai.info —— 始终生成，确保 SD 能显示模型信息
                with open(base + ".civitai.info", "w", encoding="utf-8") as f:
                    json.dump(meta["info"], f, ensure_ascii=False, indent=2)
            if fmt in ("sd", "both") and meta.get("sd"):
                with open(base + ".json", "w", encoding="utf-8") as f:
                    json.dump(meta["sd"], f, ensure_ascii=False, indent=2)
        except Exception as e:
            self.status_var.set("metadata 写入失败: %s" % e)
        # 2. 下载 C 站封面为 <名>.preview.png（SD WebUI 可识别；后台线程，不阻塞 UI）
        if not os.path.exists(base + ".preview.png"):
            images = (meta.get("info") or {}).get("images") or []
            cover_url = images[0].get("url") if images else ""
            if cover_url:
                threading.Thread(target=_download_image,
                                 args=(cover_url, base + ".preview.png"), daemon=True).start()
        # 2. 询问移动位置
        if not self.cfg.get("ask_move_after_download", True):
            return
        if not os.path.exists(src):
            return
        if not messagebox.askyesno("移动文件", "「%s」下载完成。\n是否选择文件夹移动？" % task.filename):
            return
        d = filedialog.askdirectory(title="选择目标文件夹（取消则留在原下载目录）")
        if not d:
            return
        try:
            # 模型文件 + 附属文件（json/预览图/封面等）一起移动
            moved = []
            for ext in model_manager._SIDE_EXTS:
                side = base + ext
                if os.path.exists(side):
                    shutil.move(side, os.path.join(d, os.path.basename(side)))
                    moved.append(side)
            try:
                shutil.move(src, os.path.join(d, task.filename))
            except Exception as e:
                # 主文件失败：回滚已移动的附属文件，避免文件分散
                for s in moved:
                    try:
                        shutil.move(os.path.join(d, os.path.basename(s)), s)
                    except Exception:
                        pass
                raise
            task.dest_dir = d
            self.dl.save_tasks()  # 持久化新位置，重启后重试不会回旧目录
            messagebox.showinfo("完成", "已移动 %d 个文件到：\n%s\n\n%s" % (
                len(moved) + 1, d,
                "、".join([task.filename] + [os.path.basename(m) for m in moved[:5]])))
        except Exception as e:
            messagebox.showerror("移动失败", str(e))
        self._refresh_dl_table()

    def _refresh_dl_table(self, full=False):
        """刷新下载列表。默认增量更新（只更新变化行，避免整表重建打断点选/滚动）；
        任务增删/首次加载时 full=True 全量重建。"""
        if full or not self.dl_id_map:
            # 停止上一轮缩略图线程
            stop = getattr(self, "_dl_thumb_stop", None)
            if stop:
                stop[0] = True
            self.dl_tree.delete(*self.dl_tree.get_children())
            self.dl_id_map.clear()
            self._dl_thumbs.clear()
            for t in self.dl.tasks:
                iid = "t%d" % id(t)
                self.dl_id_map[iid] = t
                self._dl_insert_row(iid, t)
            self._dl_load_thumbs()
            return
        # 增量：更新已有行、补新任务、删已移除任务
        current = {}
        for t in self.dl.tasks:
            iid = "t%d" % id(t)
            current[iid] = t
            if iid in self.dl_id_map:
                self._dl_update_row(iid, t)
            else:
                self.dl_id_map[iid] = t
                self._dl_insert_row(iid, t)
        for iid in [i for i in self.dl_id_map if i not in current]:
            self.dl_tree.delete(iid)
            self.dl_id_map.pop(iid, None)
            self._dl_thumbs.pop(iid, None)

    def _dl_row_values(self, t):
        speed = ("%.1f MB/s" % (t.speed / 1048576)) if t.speed else ""
        size = "%s / %s" % (fmt_size(t.downloaded), fmt_size(t.total)) if t.total else fmt_size(t.downloaded)
        return (ST_TEXT.get(t.status, t.status),
                ("%.1f%%" % t.progress) if t.status == downloader.ST_DOWNLOADING else ST_TEXT.get(t.status, t.status),
                speed, size, t.error)

    def _dl_insert_row(self, iid, t):
        self.dl_tree.insert("", "end", iid=iid, text=t.filename, values=self._dl_row_values(t))

    def _dl_update_row(self, iid, t):
        self.dl_tree.item(iid, text=t.filename, values=self._dl_row_values(t))

    def _dl_load_thumbs(self):
        """异步加载已完成任务的封面缩略图（本地 preview/cover）"""
        try:
            from PIL import Image, ImageTk
        except ImportError:
            return
        stop = [False]
        self._dl_thumb_stop = stop
        tasks = [t for t in self.dl.tasks if t.status == downloader.ST_DONE]
        if not tasks:
            return

        def worker():
            for t in tasks:
                if stop[0]:
                    return
                src = os.path.join(t.dest_dir, t.filename)
                cover = model_manager.find_cover(src)
                if not cover:
                    continue
                try:
                    img = Image.open(cover).convert("RGB")
                    img.thumbnail((36, 36))
                    self.post(lambda t=t, img=img, stop=stop: self._dl_apply_thumb(t, img, stop))
                except Exception:
                    continue

        threading.Thread(target=worker, daemon=True).start()

    def _dl_apply_thumb(self, t, img, stop=None):
        if stop is not None and stop[0]:
            return
        for iid, task in self.dl_id_map.items():
            if task is t:
                try:
                    from PIL import ImageTk
                    photo = ImageTk.PhotoImage(img)
                    self._dl_thumbs[iid] = photo
                    self.dl_tree.item(iid, image=photo)
                except Exception:
                    pass
                return

    def _dl_start_all(self):
        for t in list(self.dl.tasks):
            if t.status in (downloader.ST_PENDING, downloader.ST_PAUSED, downloader.ST_ERROR):
                if t.status == downloader.ST_ERROR:
                    self.dl.retry_task(t)
                elif t.status == downloader.ST_PAUSED:
                    self.dl.resume_task(t)
                else:
                    self.dl.resume_task(t)

    def _dl_selected_tasks(self):
        sel = self.dl_tree.selection()
        return [self.dl_id_map[i] for i in sel if i in self.dl_id_map]

    def _dl_pause_sel(self):
        for t in self._dl_selected_tasks():
            self.dl.pause_task(t)

    def _dl_retry_sel(self):
        for t in self._dl_selected_tasks():
            self.dl.retry_task(t)

    def _dl_remove_sel(self):
        for t in self._dl_selected_tasks():
            self.dl.remove_task(t)
        self._refresh_dl_table()

    def _dl_clear_done(self):
        self.dl.clear_finished()
        self._refresh_dl_table()

    def _dl_show_info(self, _e=None):
        self.dl_info.configure(state="normal")
        self.dl_info.delete("1.0", "end")
        for t in self._dl_selected_tasks():
            info = t.info or {}
            self._log(self.dl_info, "模型: %s   版本: %s" % (info.get("modelName", "-"), info.get("versionName", "-")))
            self._log(self.dl_info, "URL: %s" % info.get("url", t.url))
        self.dl_info.configure(state="disabled")

    # ============ 页面3：模型管理 ============
    def _build_model_manager_page(self, nb):
        page = ttk.Frame(nb)
        nb.add(page, text="模型管理")
        bar = ttk.Frame(page)
        bar.pack(fill="x", padx=8, pady=6)
        for text, cmd, kind in [("扫描模型", self._mm_scan, "primary"), ("校验哈希", self._mm_verify_hash, "ghost"),
                          ("检查更新", self._mm_check_update, "ghost"), ("重命名C站名", self._mm_rename, "ghost"),
                          ("汉化文件名", self._mm_localize_filenames, "ghost"),
                          ("生成SD json", self._mm_gen_sd_json, "ghost"), ("打开C站", self._mm_open_civitai, "ghost"),
                          ("下载C站封面", self._mm_download_covers, "ghost"), ("翻译简介", self._mm_translate_descs, "ghost"),
                          ("发送到反向解析", self._mm_send_to_rp, "ghost"),
                          ("整理模型", self._mm_organize, "ghost"), ("一键清理", self._mm_cleanup, "danger"),
                          ("生成HTML图例", self._mm_html, "ghost"), ("文件夹显示", self._mm_folders, "ghost"),
                          ("打开模型目录", self._mm_open_dir, "ghost")]:
            ui.GlowButton(bar, text=text, command=cmd, kind=kind).pack(side="left", padx=2)
        # 搜索 / 筛选 / 勾选 工具行
        fbar = ttk.Frame(page)
        fbar.pack(fill="x", padx=8, pady=(0, 4))
        ttk.Label(fbar, text="筛选：").pack(side="left")
        self.mm_filter_var = tk.StringVar()
        self.mm_filter_var.trace_add("write", lambda *a: self._mm_apply_filter())
        self.mm_filter_entry = ttk.Entry(fbar, textvariable=self.mm_filter_var, width=24)
        self.mm_filter_entry.pack(side="left", padx=4)
        ui.GlowButton(fbar, text="清除", command=lambda: (self.mm_filter_var.set(""), self.mm_filter_entry.focus_set())).pack(side="left")
        ui.GlowButton(fbar, text="全选", command=lambda: self._mm_check_visible(True)).pack(side="left", padx=(14, 2))
        ui.GlowButton(fbar, text="清除勾选", command=lambda: self._mm_check_visible(False)).pack(side="left", padx=2)
        ui.GlowButton(fbar, text="反选", command=self._mm_invert_checked).pack(side="left", padx=2)
        self.mm_check_label = ttk.Label(fbar, text="已勾选 0 个")
        self.mm_check_label.pack(side="left", padx=10)
        ttk.Label(fbar, text="（点击列头可排序；点击 ☑ 列勾选）", foreground="#888").pack(side="left")
        self.mm_progress = ttk.Progressbar(page, mode="determinate")
        self.mm_progress.pack(fill="x", padx=8)
        # #0 列显示封面缩略图 + 文件名；sel 列是复选框；其余列含 C 站名称/路径/下载时间
        cols = ("sel", "cname", "type", "base", "ver", "update", "hash", "size", "mtime", "path")
        self.mm_tree = ttk.Treeview(page, columns=cols, show="tree headings", height=12)
        self.mm_tree.heading("#0", text="模型文件（封面 + 文件名）",
                             command=lambda: self._mm_sort_by("name"))
        self.mm_tree.column("#0", width=260, anchor="w")
        self._mm_head_titles = {"sel": "☑", "cname": "C站模型名", "type": "类型",
                                "base": "基础模型", "ver": "当前版本", "update": "更新状态",
                                "hash": "哈希状态", "size": "大小",
                                "mtime": "下载时间", "path": "路径"}
        self.mm_tree.heading("sel", text="☑", command=lambda: self._mm_sort_by("sel"))
        self.mm_tree.column("sel", width=36, anchor="center", stretch=False)
        heads = {"cname": ("C站模型名", 160), "type": ("类型", 70), "base": ("基础模型", 85),
                 "ver": ("当前版本", 80), "update": ("更新状态", 75), "hash": ("哈希状态", 75),
                 "size": ("大小", 70), "mtime": ("下载时间", 115), "path": ("路径", 150)}
        for c, (t, w) in heads.items():
            self.mm_tree.heading(c, text=t, command=lambda c=c: self._mm_sort_by(c))
            self.mm_tree.column(c, width=w, anchor="w")
        # 斑马纹分割线（可选）
        self.mm_tree.tag_configure("zebra", background=ui.CURRENT["surface2"])
        # 垂直滚动条 + 列表（经典布局：滚动条先占右侧，列表占剩余；避免 pack in_ 绘制异常）
        mm_ys = ttk.Scrollbar(page, orient="vertical", command=self.mm_tree.yview)
        self.mm_tree.configure(yscrollcommand=mm_ys.set)
        mm_ys.pack(side="right", fill="y")
        self.mm_tree.pack(side="left", fill="both", expand=True, padx=(8, 0))
        self._row_hovers.append(ui.RowHover(self.mm_tree))
        self.mm_tree.bind("<<TreeviewSelect>>", self._mm_show_detail)
        self.mm_tree.bind("<Button-1>", self._mm_on_tree_click)
        # ctrl+a 全选（Treeview 无内置全选）
        self.mm_tree.bind("<Control-a>", self._mm_select_all)
        self.mm_tree.bind("<Control-A>", self._mm_select_all)
        # 右键菜单
        self._mm_menu = tk.Menu(self, tearoff=0)
        self._mm_menu.add_command(label="删除（移入回收站）", command=self._mm_delete_selected)
        self._mm_menu.add_separator()
        self._mm_menu.add_command(label="打开所在目录", command=self._mm_open_dir_of_sel)
        self._mm_menu.add_command(label="打开 C 站页面", command=self._mm_open_civitai)
        self._mm_menu.add_command(label="复制文件路径", command=self._mm_copy_path)
        self._mm_menu.add_command(label="复制 C 站链接", command=self._mm_copy_civitai_url)
        self.mm_tree.bind("<Button-3>", self._mm_show_menu)
        ttk.Label(page, text="详情（本地 civitai.info / 反向解析结果）：").pack(anchor="w", padx=8, pady=(6, 0))
        self.mm_detail = tk.Text(page, height=6, state="disabled")
        self.mm_detail.pack(fill="x", padx=8, pady=(0, 8))
        self.mm_id_map = {}
        # 勾选/排序/筛选状态
        self._mm_checked = set()          # 勾选的 path 集合
        self._mm_sort_col = None
        self._mm_sort_rev = False
        self._mm_display_rows = []        # 当前筛选+排序后显示的行

    def _mm_sort_by(self, col):
        """列头点击排序：再次点击同列切换升降序"""
        if self._mm_sort_col == col:
            self._mm_sort_rev = not self._mm_sort_rev
        else:
            self._mm_sort_col = col
            self._mm_sort_rev = False
        self._mm_apply_filter()

    def _mm_sort_key(self, r):
        col = self._mm_sort_col
        if col == "sel":
            return r["path"] in self._mm_checked
        if col == "size":
            return r.get("size") or 0
        if col == "mtime":
            return r.get("mtime") or 0
        if col == "path":
            return (r.get("path") or "").lower()
        if col == "name":
            return (r.get("name") or "").lower()
        return (r.get({
            "cname": "civitai_name", "type": "type", "base": "base",
            "ver": "ver", "update": "update", "hash": "hash",
        }.get(col, "")) or "").lower()

    def _mm_apply_filter(self):
        """按筛选关键字 + 排序状态重建表格显示"""
        if not self.model_rows:
            return
        kw = (self.mm_filter_var.get() or "").strip().lower()
        rows = self.model_rows
        if kw:
            rows = [r for r in rows
                    if kw in (r.get("name") or "").lower()
                    or kw in (r.get("civitai_name") or "").lower()
                    or kw in (r.get("path") or "").lower()]
        self._mm_display_rows = rows
        if self._mm_sort_col:
            rows = sorted(rows, key=self._mm_sort_key, reverse=self._mm_sort_rev)
            self._mm_display_rows = rows
        self._mm_fill_rows(rows)
        self._update_mm_head_arrows()
        self._mm_update_check_label()
        self._mm_load_thumbs()
        # 诊断提示：有模型但列表为空 → 说明被筛选/文件夹设置过滤，明确告知
        if not rows and self.model_rows:
            self.status_var.set("列表为空：%d 个模型被筛选或文件夹设置过滤（点筛选框「清除」查看全部）" % len(self.model_rows))
        elif rows:
            self.status_var.set("显示 %d 个模型" % len(rows))

    def _mm_fill_rows(self, rows):
        # 表格重建：停止上一轮缩略图线程，避免 iid 复用贴错图
        stop = getattr(self, "_thumb_stop", None)
        if stop:
            stop[0] = True
        self.mm_tree.delete(*self.mm_tree.get_children())
        self.mm_id_map.clear()
        self._thumbs.clear()
        zebra = bool(self.cfg.get("zebra_rows", True))
        for i, r in enumerate(rows):
            iid = "m%d" % i
            self.mm_id_map[iid] = r
            checked = "☑" if r["path"] in self._mm_checked else "☐"
            tags = ("zebra",) if (zebra and i % 2 == 1) else ()
            mt = time.strftime("%Y-%m-%d %H:%M", time.localtime(r.get("mtime") or 0)) if r.get("mtime") else "-"
            rel = r.get("path", "")
            rootp = (self.cfg.get("models_dir") or "").strip()
            if rootp:
                try:
                    rel = os.path.relpath(rel, rootp)
                except Exception:
                    pass
            self.mm_tree.insert("", "end", iid=iid, text=r["name"], values=(
                checked, r.get("civitai_name") or "-", r["type"] or "-", r["base"] or "-",
                r["ver"] or "-", r.get("update") or "-", r.get("hash") or "-",
                fmt_size(r["size"]), mt, rel), tags=tags)

    def _update_mm_head_arrows(self):
        for c, t in self._mm_head_titles.items():
            self.mm_tree.heading(c, text=t + (" ▲" if self._mm_sort_col == c and not self._mm_sort_rev else
                                              " ▼" if self._mm_sort_col == c else ""))
        # #0 文件名列箭头（tree 列不在 columns 里）
        arrow = " ▲" if self._mm_sort_col == "name" and not self._mm_sort_rev else \
                " ▼" if self._mm_sort_col == "name" else ""
        self.mm_tree.heading("#0", text="模型文件（封面 + 文件名）" + arrow)

    def _mm_update_check_label(self):
        n = len(self._mm_checked)
        visible = len(self._mm_display_rows)
        self.mm_check_label.configure(text="已勾选 %d 个（当前可见 %d 行）" % (n, visible))

    def _mm_on_tree_click(self, event):
        """点击 ☑ 列切换勾选：若有多个选中行（shift/ctrl 多选）则批量勾选整组"""
        region = self.mm_tree.identify("region", event.x, event.y)
        if region != "cell":
            return
        col_id = self.mm_tree.identify_column(event.x)
        if not col_id.startswith("#"):
            return
        try:
            idx = int(col_id[1:]) - 1
            col = self.mm_tree["columns"][idx]
        except (ValueError, IndexError):
            return
        if col != "sel":  # 仅复选框列
            return
        iid = self.mm_tree.identify_row(event.y)
        if not iid or iid not in self.mm_id_map:
            return
        # 计算点击后将生效的选择集（widget 绑定先于类绑定，需自行模拟 shift/ctrl 语义）
        sel = list(self.mm_tree.selection())
        state = event.state
        shift = bool(state & 0x0001)
        ctrl = bool(state & 0x0004)
        kids = self.mm_tree.get_children()
        idx = self.mm_tree.index(iid)
        if shift and sel:
            a = self.mm_tree.index(sel[0])  # 范围起点（近似 Tk anchor）
            lo, hi = min(a, idx), max(a, idx)
            rows = [self.mm_id_map[kids[k]] for k in range(lo, hi + 1) if kids[k] in self.mm_id_map]
        elif ctrl:
            rows = [self.mm_id_map[i2] for i2 in sel if i2 in self.mm_id_map]
            if self.mm_id_map[iid] not in rows:
                rows.append(self.mm_id_map[iid])
        else:
            rows = [self.mm_id_map[iid]]
        if not rows:
            return
        all_checked = all(r["path"] in self._mm_checked for r in rows)
        for r in rows:
            if all_checked:
                self._mm_checked.discard(r["path"])
            else:
                self._mm_checked.add(r["path"])
        # 刷新显示行勾选状态
        for i2, r2 in self.mm_id_map.items():
            self.mm_tree.set(i2, "sel", "☑" if r2["path"] in self._mm_checked else "☐")
        self._mm_update_check_label()

    def _mm_check_visible(self, state):
        """全选/清除：作用于当前筛选显示的可见行（清除也可清全部）"""
        if state:
            for r in self._mm_display_rows:
                self._mm_checked.add(r["path"])
        else:
            self._mm_checked.clear()  # 清除勾选 = 全部清除，避免残留不可见勾选
        self._mm_apply_filter()

    def _mm_invert_checked(self):
        for r in self._mm_display_rows:
            if r["path"] in self._mm_checked:
                self._mm_checked.discard(r["path"])
            else:
                self._mm_checked.add(r["path"])
        self._mm_apply_filter()

    def _mm_target_rows(self):
        """批量操作目标行：勾选 > Treeview 选中 > 全部"""
        checked = [r for r in self.model_rows if r["path"] in self._mm_checked]
        if checked:
            return checked
        sel = self._mm_selected()
        if sel:
            return sel
        return list(self.model_rows)

    def _mm_scan(self):
        root = (self.cfg.get("models_dir") or self.cfg.get("download_dir") or "").strip()
        if not root:
            messagebox.showinfo("提示", "请先在设置页配置模型目录")
            return
        if not os.path.isdir(root):
            messagebox.showerror("模型目录不存在",
                                 "配置的模型目录不存在：\n%s\n\n请在 设置 页重新选择正确的模型管理目录。" % root)
            return
        self.status_var.set("正在扫描 %s ..." % root)
        self.mm_progress.configure(mode="indeterminate")
        self.mm_progress.start(12)

        def work():
            files = model_manager.scan_models(root)
            # 按“文件夹显示”设置过滤
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
                rows.append({
                    "path": f["path"], "name": f["name"], "size": f["size"],
                    "mtime": f.get("mtime", 0),
                    "type": meta.get("type", ""),
                    "base": meta.get("baseModel") or meta.get("base_model", ""),
                    "ver": _version_name(meta),
                    "verId": meta.get("versionId") or meta.get("version_id", ""),
                    "modelId": meta.get("modelId") or meta.get("model_id", ""),
                    "url": meta.get("url", ""), "trainedWords": meta.get("trainedWords", []),
                    "cover": meta.get("cover", ""), "info": meta,
                    "civitai_name": meta.get("name", ""),
                    "update": "", "hash": "",
                })
            return rows

        def done(rows):
            self.mm_progress.stop()
            self.mm_progress.configure(mode="determinate", value=0)
            if isinstance(rows, tuple) and rows and rows[0] == "__error__":
                messagebox.showerror("错误", rows[1])
                self.status_var.set("扫描失败")
                return
            self.model_rows = rows
            self._mm_checked.clear()
            self._mm_sort_col = None
            self._mm_sort_rev = False
            self.mm_filter_var.set("")  # 清空筛选关键字，避免残留过滤导致列表为空
            self._mm_apply_filter()
            self.status_var.set("扫描完成：%d 个模型" % len(rows))

        Worker(self, work, done)

    def _mm_fill_table(self):
        """旧接口兼容：重新应用筛选/排序填充表格（缩略图由调用方另行触发）"""
        self._mm_apply_filter()

    def _mm_load_thumbs(self):
        """后台加载封面缩略图（PIL 缩放，主线程创建 PhotoImage 并更新行）"""
        try:
            from PIL import Image, ImageTk
        except ImportError:
            return
        rows = list(self._mm_display_rows)
        stop = [False]
        self._thumb_stop = stop

        def worker():
            for i, r in enumerate(rows):
                if stop[0]:
                    return
                cover = model_manager.find_cover(r["path"])
                if not cover:
                    continue
                try:
                    img = Image.open(cover).convert("RGB")
                    img.thumbnail((48, 48))
                    self.post(lambda i=i, img=img, stop=stop: self._apply_thumb(i, img, stop))
                except Exception:
                    continue

        threading.Thread(target=worker, daemon=True).start()

    def _apply_thumb(self, i, img, stop=None):
        # 旧线程残留的 post：若已被新一轮扫描停止，直接丢弃
        if stop is not None and stop[0]:
            return
        iid = "m%d" % i
        if iid not in self.mm_id_map:
            return
        try:
            from PIL import ImageTk
            photo = ImageTk.PhotoImage(img)
            self._thumbs[iid] = photo  # 保持引用防 GC
            self.mm_tree.item(iid, image=photo)
        except Exception:
            pass

    def _mm_send_to_rp(self):
        """把选中（或无选中时全部）未识别的模型发送到反向解析页"""
        if self._rp_running:
            messagebox.showinfo("提示", "反向解析正在进行中，请先 停止 或等它完成")
            return
        if not self.model_rows:
            messagebox.showinfo("提示", "请先扫描模型")
            return
        target = self._mm_target_rows()
        rows = [r for r in target
                if not r.get("modelId") and not r.get("civitai_name")]
        if not rows:
            messagebox.showinfo("提示", "所选模型都有元数据（已识别），无需反查")
            return
        label = "%d 个未识别模型" % len(rows)
        if not messagebox.askyesno("发送到反向解析",
                                   "将 %s发送到 反向解析 页？\n（会在该页计算 SHA256 并反查 C 站，自动生成 civitai.info）" % label):
            return
        self._rp_add_paths([r["path"] for r in rows])
        self.nb.select(3)  # 切到反向解析页
        self.status_var.set("已发送 %d 个模型到反向解析，点击 开始反查" % len(rows))

    def _mm_gen_sd_json(self):
        """把选中/勾选/全部模型已有的 civitai.info 批量生成 SD 扁平 <名>.json"""
        rows = self._mm_target_rows()
        with_info = [r for r in rows if model_manager.find_info_file(r["path"])]
        if not with_info:
            messagebox.showinfo("提示", "所选模型没有 civitai.info，无法生成 SD json。\n可先 校验哈希 / 反向解析 生成 info。")
            return
        if not messagebox.askyesno("生成SD json",
                                   "将为 %d 个模型读取 civitai.info 并生成 SD 扁平结构 <模型名>.json（供 SD 生态读取）。\n继续？" % len(with_info)):
            return
        # 询问是否覆盖已存在（旧格式 json 缺触发词/带 HTML，建议覆盖更新）
        existing = sum(1 for r in with_info if os.path.exists(os.path.splitext(r["path"])[0] + ".json"))
        overwrite = False
        if existing:
            overwrite = messagebox.askyesno(
                "覆盖已有 json",
                "检测到 %d 个模型已有 <名>.json。\n\n「是」= 用新格式覆盖（补触发词字段、清理 HTML 描述）\n「否」= 跳过已存在的\n\n是否覆盖？" % existing)
        self.mm_progress.configure(mode="determinate", maximum=len(with_info), value=0)
        self.status_var.set("正在生成 SD json ...")

        def work():
            ok, skip, fail = 0, 0, []
            for i, r in enumerate(with_info):
                try:
                    info_path = model_manager.find_info_file(r["path"])
                    with open(info_path, "r", encoding="utf-8") as f:
                        info = json.load(f)
                    sd = reverse_parse.info_to_sd_metadata(info)
                    if sd is None:
                        fail.append(os.path.basename(r["path"]))
                    else:
                        base, _ = os.path.splitext(r["path"])
                        dst = base + ".json"
                        if os.path.exists(dst) and not overwrite:
                            skip += 1
                        else:
                            with open(dst, "w", encoding="utf-8") as f:
                                json.dump(sd, f, ensure_ascii=False, indent=2)
                            ok += 1
                except Exception as e:
                    fail.append("%s (%s)" % (os.path.basename(r["path"]), e))
                self.post(lambda i=i: self.mm_progress.configure(value=i + 1))
            return ok, skip, fail

        def done(res):
            if isinstance(res, tuple) and res and res[0] == "__error__":
                messagebox.showerror("错误", res[1])
                return
            ok, skip, fail = res
            msg = "已生成 %d 个 SD json" % ok
            if skip:
                msg += "（%d 个已存在跳过）" % skip
            if fail:
                msg += "\n失败 %d 个：\n%s" % (len(fail), "\n".join(fail[:10]))
            messagebox.showinfo("完成", msg)
            self.status_var.set("SD json 生成完成")

        Worker(self, work, done)

    def _mm_open_civitai(self):
        """打开选中模型的 C 站页面（有新版本时优先打开新版本）"""
        rows = self._mm_selected()
        if not rows:
            messagebox.showinfo("提示", "请先在列表中选中一行")
            return
        r = rows[0]
        url = ""
        nv = r.get("new_version") or {}
        if nv.get("url"):
            url = nv["url"]
        elif r.get("url"):
            url = r["url"]
        if not url:
            messagebox.showinfo("提示", "该模型没有 C 站链接（无元数据，可先 校验哈希/反向解析）")
            return
        try:
            os.startfile(url)
        except Exception as e:
            messagebox.showerror("打开失败", str(e))

    def _mm_rename(self):
        """一键把选中模型重命名为 C 站文件名（不移动目录）"""
        rows = self._mm_target_rows()
        if not rows:
            messagebox.showinfo("提示", "请先扫描模型")
            return
        with_meta = [r for r in rows if r.get("info") and
                     (r["info"].get("files") or r["info"].get("name"))]
        if not with_meta:
            messagebox.showinfo("提示",
                                "选中模型没有元数据（无 civitai.info），无法确定 C 站文件名。\n"
                                "可先运行 校验哈希 / 反向解析 补全信息。")
            return
        if not messagebox.askyesno("确认改名",
                                   "将 %d 个模型重命名为 C 站文件名（仅同目录改名，不移动位置）。\n"
                                   "同名附属文件（json/预览图/封面）会一起改名。\n是否继续？" % len(with_meta)):
            return
        self.mm_progress.configure(mode="determinate", maximum=len(with_meta), value=0)
        self.status_var.set("正在重命名 ...")

        def work():
            msgs = []
            for i, r in enumerate(with_meta):
                try:
                    _, m = model_manager.rename_to_civitai(r["path"], r["info"])
                    msgs.extend(m)
                except Exception as e:
                    msgs.append("%s: %s" % (r["name"], e))
                self.post(lambda i=i: self.mm_progress.configure(value=i + 1))
            return msgs

        def done(msgs):
            if isinstance(msgs, tuple) and msgs and msgs[0] == "__error__":
                messagebox.showerror("错误", msgs[1])
                return
            messagebox.showinfo("改名完成", "\n".join(msgs[:40]) + ("\n..." if len(msgs) > 40 else ""))
            self.status_var.set("改名完成")
            self._mm_scan()

        Worker(self, work, done)

    def _mm_folders(self):
        """管理模型目录子文件夹的显示/隐藏（递归多级，勾选自动保存）"""
        root = (self.cfg.get("models_dir") or "").strip()
        if not root or not os.path.isdir(root):
            messagebox.showinfo("提示", "请先在设置页配置模型管理目录")
            return
        # 递归收集所有子目录（相对 slash 路径）
        subdirs = []
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            rel = os.path.relpath(dirpath, root).replace("\\", "/")
            for d in sorted(dirnames):
                subdirs.append((rel + "/" + d) if rel != "." else d)
        subdirs.sort()
        hidden = set(self.cfg.get("hidden_model_folders", []))
        win = tk.Toplevel(self)
        win.title("文件夹显示设置 — %s" % root)
        win.geometry("420x560")
        win.transient(self)
        ttk.Label(win, text="勾选 = 在模型管理中显示（含子文件夹）。\n未勾选的文件夹及其下所有内容会被扫描过滤掉：").pack(anchor="w", padx=10, pady=(10, 4))
        # 滚动容器
        canvas = tk.Canvas(win, highlightthickness=0)
        vsb = ttk.Scrollbar(win, orient="vertical", command=canvas.yview)
        inner = ttk.Frame(canvas)
        inner.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=inner, anchor="nw")
        canvas.configure(yscrollcommand=vsb.set)
        vsb.pack(side="right", fill="y")
        canvas.pack(side="left", fill="both", expand=True, padx=(10, 0))

        def save_folders_data():
            """立即保存当前勾选（供关闭/确定/Escape 调用，绕过节流）"""
            try:
                hidden_now = [p for p, v in vars_map.items() if not v.get()]
                self._apply_folders_settings(hidden_now, self._root_var.get())
            except Exception:
                pass

        def persist():
            """勾选变化自动保存（节流：400ms 内合并为一次写盘，避免全选时 O(N²) 写放大）"""
            if getattr(self, "_folders_save_pending", False):
                return
            self._folders_save_pending = True

            def do_save():
                self._folders_save_pending = False
                save_folders_data()
            win.after(400, do_save)

        vars_map = {}
        for s in subdirs:
            v = tk.BooleanVar(value=s not in hidden)
            v.trace_add("write", lambda *a: persist())
            vars_map[s] = v
            cb = ttk.Checkbutton(inner, text=s, variable=v)
            cb.pack(anchor="w", padx=6)
        self._root_var = tk.BooleanVar(value=bool(self.cfg.get("show_root_models", True)))
        self._root_var.trace_add("write", lambda *a: persist())
        ttk.Checkbutton(inner, text="（模型目录根目录下的文件）", variable=self._root_var).pack(anchor="w", padx=6, pady=(6, 0))
        bar = ttk.Frame(win)
        bar.pack(fill="x", padx=10, pady=10)
        ttk.Button(bar, text="全选", command=lambda: [v.set(True) for v in vars_map.values()]).pack(side="left")
        ttk.Button(bar, text="全不选", command=lambda: [v.set(False) for v in vars_map.values()]).pack(side="left", padx=6)
        ttk.Button(bar, text="确定", command=lambda: (save_folders_data(), win.destroy(),
                                                      messagebox.showinfo("完成", "设置已保存，点击 扫描模型 生效"))).pack(side="right")
        win.protocol("WM_DELETE_WINDOW", lambda: (save_folders_data(), win.destroy()))
        win.bind("<Escape>", lambda e: (save_folders_data(), win.destroy()))

    def _apply_folders_settings(self, hidden, show_root):
        """保存文件夹显示设置到配置（立即写盘）"""
        self.cfg["hidden_model_folders"] = hidden
        self.cfg["show_root_models"] = show_root
        config.save(self.cfg)

    def _save_folders(self, vars_map, win):
        hidden = [s for s, v in vars_map.items() if not v.get()]
        self.cfg["hidden_model_folders"] = hidden
        self.cfg["show_root_models"] = self._root_var.get()
        config.save(self.cfg)
        win.destroy()
        messagebox.showinfo("完成", "设置已保存，点击 扫描模型 生效")

    def _mm_selected(self):
        sel = self.mm_tree.selection()
        return [self.mm_id_map[i] for i in sel if i in self.mm_id_map]

    def _mm_select_all(self, _e=None):
        """ctrl+a 全选（返回 "break" 阻止事件继续传播）"""
        self.mm_tree.selection_set(*self.mm_tree.get_children())
        return "break"

    def _mm_show_menu(self, event):
        try:
            iid = self.mm_tree.identify_row(event.y)
            if iid:
                self.mm_tree.selection_set(iid)
            self._mm_menu.tk_popup(event.x_root, event.y_root)
        finally:
            self._mm_menu.grab_release()

    def _mm_delete_selected(self):
        """把选中模型移入回收站（可恢复）"""
        rows = self._mm_selected()
        if not rows:
            messagebox.showinfo("提示", "请先选中要删除的模型")
            return
        names = "\n".join(os.path.basename(r["path"]) for r in rows[:8])
        if not messagebox.askyesno("确认删除",
                                   "将以下 %d 个模型文件移入回收站（可恢复）：\n%s\n\n是否继续？" % (len(rows), names)):
            return
        try:
            ok = _recycle_to_trash([r["path"] for r in rows])
        except Exception:
            ok = False
        # SHFileOperation 返回非 0 可能只代表部分失败：按磁盘实际存在逐个复核
        removed = {r["path"] for r in rows if not os.path.exists(r["path"])}
        if ok:
            removed = {r["path"] for r in rows}
        if removed:
            self.model_rows = [r for r in self.model_rows if r["path"] not in removed]
            self._mm_checked.difference_update(removed)
            self._mm_apply_filter()
        if len(removed) < len(rows):
            messagebox.showwarning("部分失败",
                                   "%d 个文件已移入回收站，%d 个未能删除（可能被占用）。\n列表已按实际状态刷新，可重新扫描。" % (
                                       len(removed), len(rows) - len(removed)))
        else:
            self.status_var.set("已删除 %d 个模型" % len(rows))

    def _mm_open_dir_of_sel(self):
        rows = self._mm_selected()
        if not rows:
            messagebox.showinfo("提示", "请先选中一行")
            return
        os.startfile(os.path.dirname(rows[0]["path"]))

    def _mm_copy_path(self):
        rows = self._mm_selected()
        if not rows:
            return
        self.clipboard_clear()
        self.clipboard_append("\n".join(r["path"] for r in rows))
        self.status_var.set("已复制 %d 个路径" % len(rows))

    def _mm_copy_civitai_url(self):
        rows = self._mm_selected()
        if not rows:
            return
        urls = []
        for r in rows:
            nv = r.get("new_version") or {}
            u = nv.get("url") or r.get("url") or ""
            if u:
                urls.append(u)
        if not urls:
            messagebox.showinfo("提示", "所选模型没有 C 站链接（可先 校验哈希/反向解析）")
            return
        self.clipboard_clear()
        self.clipboard_append("\n".join(urls))
        self.status_var.set("已复制 %d 个 C 站链接" % len(urls))

    def _mm_show_detail(self, _e=None):
        self.mm_detail.configure(state="normal")
        self.mm_detail.delete("1.0", "end")
        for r in self._mm_selected():
            self._log(self.mm_detail, "文件: %s" % r["path"])
            self._log(self.mm_detail, "类型: %s   基础模型: %s   版本: %s" % (r["type"] or "-", r["base"] or "-", r["ver"] or "-"))
            if r.get("trainedWords"):
                self._log(self.mm_detail, "触发词: %s" % "，".join(r["trainedWords"][:20]))
            nv = r.get("new_version") or {}
            if nv:
                self._log(self.mm_detail, "────────── 有新版本 ──────────")
                self._log(self.mm_detail, "新版本: %s" % (nv.get("name") or "-"))
                if nv.get("publishedAt"):
                    self._log(self.mm_detail, "发布时间: %s" % nv["publishedAt"][:10])
                if nv.get("file_size"):
                    self._log(self.mm_detail, "新文件大小: %s" % nv["file_size"])
                if nv.get("baseModel"):
                    self._log(self.mm_detail, "基础模型: %s" % nv["baseModel"])
                if nv.get("trainedWords"):
                    self._log(self.mm_detail, "新触发词: %s" % "，".join(nv["trainedWords"][:20]))
                if nv.get("url"):
                    self._log(self.mm_detail, "链接(可点工具栏 打开C站): %s" % nv["url"])
            if r.get("url") and not nv:
                self._log(self.mm_detail, "C站链接: %s" % r["url"])
        self.mm_detail.configure(state="disabled")

    def _mm_verify_hash(self):
        rows = self._mm_target_rows()
        if not rows:
            messagebox.showinfo("提示", "请先扫描模型")
            return
        n = max(1, int(self.cfg.get("hash_threads", 4)))
        self.mm_progress.configure(mode="determinate", maximum=len(rows), value=0)
        self.status_var.set("正在校验 %d 个模型的哈希 ..." % len(rows))
        lock = threading.Lock()
        done_count = [0]

        def check_one(r):
            api = self._new_api()
            try:
                sha = model_manager.compute_sha256(r["path"])
            except Exception:
                sha = None
            if not sha:
                r["hash"] = "计算失败"
                return
            r["sha256"] = sha
            try:
                v = api.get_model_version_by_hash(sha)
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
                # 补 C 站模型名（校验成功即有 modelId）
                if not r.get("civitai_name") and r.get("modelId"):
                    try:
                        mm = api.get_model(r["modelId"])
                        r["civitai_name"] = mm.get("name", "")
                    except Exception:
                        pass
                # 把补全的元数据写回 info 文件，下次扫描不再丢（C站链接持久化）
                self._persist_model_info(r)
                # 生成 SD 可识别的完整元数据：<名>.civitai.info（civitai 助手读取）+ 完整 <名>.json
                try:
                    model_obj = None
                    if r.get("modelId"):
                        model_obj = api.get_model(r["modelId"])
                    if model_obj:
                        sd_d = (self.cfg.get("site_domain", "civitai.red") or "civitai.red").strip("/")
                        site_base = sd_d if "://" in sd_d else "https://" + sd_d
                        full_info = reverse_parse.build_info(model_obj, v, site_base)
                        full_sd = reverse_parse.build_sd_metadata(model_obj, v, site_base)
                        base, _ = os.path.splitext(r["path"])
                        with _info_write_lock:
                            with open(base + ".civitai.info", "w", encoding="utf-8") as f:
                                json.dump(full_info, f, ensure_ascii=False, indent=2)
                            with open(base + ".json", "w", encoding="utf-8") as f:
                                json.dump(full_sd, f, ensure_ascii=False, indent=2)
                except Exception:
                    pass
            except civitai_api.CivitaiError as e:
                r["hash"] = "未收录" if "404" in str(e) else "失败"
            finally:
                with lock:
                    done_count[0] += 1
                    self.post(lambda: (self.mm_progress.configure(value=done_count[0]),
                                       self.status_var.set("哈希校验 %d/%d" % (done_count[0], len(rows)))))

        def work():
            pool = [threading.Thread(target=check_one, args=(r,), daemon=True) for r in rows]
            for t in pool:
                t.start()
            for t in pool:
                t.join()
            return True

        def done(_res):
            self._mm_fill_table()
            self.status_var.set("哈希校验完成")

        Worker(self, work, done)

    def _persist_model_info(self, r):
        """把校验哈希补全的元数据（C站链接/名称/类型等）写回 info 文件，下次扫描仍在。
        线程安全：全局写锁 + 写前重读合并 + 临时文件原子替换。"""
        if not r.get("modelId"):
            return
        base, _ = os.path.splitext(r["path"])
        info_path = model_manager.find_info_file(r["path"]) or (base + ".info.json")
        with _info_write_lock:
            try:
                # 写前重读磁盘当前内容，合并新字段（避免并发覆盖丢失）
                with open(info_path, "r", encoding="utf-8") as f:
                    info = json.load(f)
                if not isinstance(info, dict):
                    info = {}
            except Exception:
                info = {}
            changed = False
            pairs = [("modelId", "modelId", r.get("modelId")),
                     ("url", "url", r.get("url")),
                     ("name", "civitai_name", r.get("civitai_name")),
                     ("type", "type", r.get("type")),
                     ("baseModel", "base", r.get("base")),
                     ("versionId", "verId", r.get("verId")),
                     ("trainedWords", "trainedWords", r.get("trainedWords"))]
            for key, rkey, val in pairs:
                if val and info.get(key) != val:
                    info[key] = val
                    changed = True
            if not changed:
                return
            try:
                tmp = info_path + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(info, f, ensure_ascii=False, indent=2)
                os.replace(tmp, info_path)  # 原子替换，避免读到半截文件
                r["info"] = info
            except Exception:
                pass

    def _mm_check_update(self):
        rows = self._mm_target_rows()
        rows = [r for r in rows if r.get("modelId")]
        if not rows:
            messagebox.showinfo("提示", "没有可检查的模型（需先有 modelId，可先运行 校验哈希/反向解析）")
            return
        self.status_var.set("正在检查更新 ...")
        lock = threading.Lock()
        done_count = [0]

        def check_one(r):
            api = self._new_api()
            try:
                m = api.get_model(r["modelId"])
                vs = m.get("modelVersions") or []
                latest = vs[0] if vs else None
                r["new_version"] = None
                if latest:
                    if r.get("verId") and str(r["verId"]) != str(latest["id"]):
                        r["update"] = "有新版本"
                        # 收集新版本详情（名称/日期/大小/触发词），供判断是否值得更新
                        size_kb = None
                        for f in (latest.get("files") or []):
                            if f.get("primary") or f.get("type") != "Negative":
                                size_kb = f.get("sizeKB")
                                break
                        if size_kb is None and (latest.get("files") or []):
                            size_kb = latest["files"][0].get("sizeKB")
                        r["new_version"] = {
                            "name": latest.get("name") or "",
                            "publishedAt": latest.get("publishedAt") or "",
                            "baseModel": latest.get("baseModel") or "",
                            "trainedWords": latest.get("trainedWords") or [],
                            "file_size": ("%.1f MB" % (size_kb / 1024.0)) if size_kb else "",
                            "url": self._site_url(r["modelId"], latest["id"]),
                        }
                    else:
                        r["update"] = "已是最新"
                else:
                    r["update"] = "未知"
            except Exception:
                r["update"] = "查询失败"
            finally:
                with lock:
                    done_count[0] += 1
                    self.post(lambda: (self.mm_progress.configure(value=done_count[0]),
                                       self.status_var.set("更新检查 %d/%d" % (done_count[0], len(rows)))))

        def work():
            pool = [threading.Thread(target=check_one, args=(r,), daemon=True) for r in rows]
            for t in pool:
                t.start()
            for t in pool:
                t.join()
            return True

        def done(_res):
            self._mm_fill_table()
            self.status_var.set("更新检查完成")

        Worker(self, work, done)

    def _mm_organize(self):
        rows = self._mm_target_rows()
        if not rows:
            messagebox.showinfo("提示", "请先扫描模型")
            return
        if not messagebox.askyesno("确认整理",
                                   "将按照 C 站文件名改名，并按 类型/基础模型 分类移动到子目录。\n共 %d 个模型，是否继续？" % len(rows)):
            return
        root = self.cfg.get("models_dir") or self.cfg.get("download_dir")
        self.mm_progress.configure(mode="determinate", maximum=len(rows), value=0)
        self.status_var.set("正在整理模型 ...")

        def work():
            msgs = []
            for i, r in enumerate(rows):
                try:
                    _, m = model_manager.organize_model(r["path"], root, dry_run=False,
                                                        rules=self.cfg.get("organize_rules") or None)
                    msgs.extend(m)
                except Exception as e:
                    msgs.append("%s: %s" % (r["name"], e))
                self.post(lambda i=i: self.mm_progress.configure(value=i + 1))
            return msgs

        def done(msgs):
            if isinstance(msgs, tuple) and msgs and msgs[0] == "__error__":
                messagebox.showerror("错误", msgs[1])
                return
            messagebox.showinfo("整理完成", "\n".join(msgs[:40]) + ("\n..." if len(msgs) > 40 else ""))
            self.status_var.set("整理完成")
            self._mm_scan()

        Worker(self, work, done)

    def _mm_cleanup(self):
        rows = self._mm_target_rows()
        if not rows:
            messagebox.showinfo("提示", "请先扫描模型")
            return
        if not messagebox.askyesno("确认清理", "将删除选中模型的 info/封面/示例图/HTML 等附属文件（模型本体保留）。\n共 %d 个模型，是否继续？" % len(rows)):
            return
        self.status_var.set("正在清理 ...")

        def work():
            removed = 0
            for r in rows:
                removed += model_manager.cleanup_model(r["path"])
            return removed

        def done(n):
            if isinstance(n, tuple) and n and n[0] == "__error__":
                messagebox.showerror("错误", n[1])
                return
            messagebox.showinfo("清理完成", "共清理 %d 项附属文件" % n)
            self.status_var.set("清理完成")
            self._mm_scan()

        Worker(self, work, done)

    def _mm_html(self):
        rows = self.model_rows
        if not rows:
            messagebox.showinfo("提示", "请先扫描模型")
            return
        out = filedialog.asksaveasfilename(title="保存图例HTML", defaultextension=".html",
                                           initialfile="模型图例.html",
                                           filetypes=[("HTML", "*.html")])
        if not out:
            return
        self.mm_progress.configure(mode="determinate", maximum=len(rows), value=0)
        self.status_var.set("正在生成 HTML 图例 ...")

        def work():
            model_manager.generate_html(rows, out, progress_cb=lambda i, t: self.post(
                lambda: (self.mm_progress.configure(value=i), self.status_var.set("生成HTML %d/%d" % (i, t)))))
            return out

        def done(p):
            if isinstance(p, tuple) and p and p[0] == "__error__":
                messagebox.showerror("错误", p[1])
                return
            self.status_var.set("图例已生成: %s" % p)
            if messagebox.askyesno("完成", "图例已生成：\n%s\n是否打开？" % p):
                os.startfile(p)

        Worker(self, work, done)

    def _mm_download_covers(self):
        """从 C 站下载选中模型的封面图保存为 <名>.preview.png（本地缓存，SD 可识别）"""
        rows = self._mm_target_rows()
        rows = [r for r in rows if r.get("verId") or r.get("modelId")]
        if not rows:
            messagebox.showinfo("提示", "所选模型没有版本/模型 ID（可先 校验哈希/反向解析）")
            return
        if not messagebox.askyesno("下载C站封面",
                                   "将从 C 站下载 %d 个模型的封面图，保存为 <模型名>.preview.png（已存在的跳过）。\n继续？" % len(rows)):
            return
        self.mm_progress.configure(mode="determinate", maximum=len(rows), value=0)
        self.status_var.set("正在下载 C 站封面 ...")
        lock = threading.Lock()
        done_count = [0]
        ok_count = [0]

        def work_one(r):
            api = self._new_api()
            url = ""
            try:
                if r.get("verId"):
                    v = api.get_model_version(r["verId"])
                    imgs = v.get("images") or []
                elif r.get("modelId"):
                    m = api.get_model(r["modelId"])
                    vs = m.get("modelVersions") or []
                    v = api.get_model_version(vs[0]["id"]) if vs else None
                    imgs = (v or {}).get("images") or []
                else:
                    imgs = []
                for img in imgs:
                    if img.get("url") and not img.get("nsfw"):
                        url = img["url"]
                        break
                if not url and imgs:
                    url = imgs[0].get("url", "")  # 全部 NSFW 也兜底下载（用户需要封面）
            except Exception:
                url = ""
            if url:
                base, _ = os.path.splitext(r["path"])
                dest = base + ".preview.png"
                if not os.path.exists(dest):
                    # 逐张尝试所有图片（跳过失效的 404），每张失败重试 2 次
                    for img in imgs:
                        u = img.get("url") or ""
                        if not u:
                            continue
                        for attempt in range(3):
                            if _download_image(u, dest, timeout=60):
                                with lock:
                                    ok_count[0] += 1
                                break
                        if os.path.exists(dest):
                            break
            with lock:
                done_count[0] += 1
                self.post(lambda: (self.mm_progress.configure(value=done_count[0]),
                                   self.status_var.set("下载封面 %d/%d（成功 %d）" % (done_count[0], len(rows), ok_count[0]))))

        def work():
            pool = [threading.Thread(target=work_one, args=(r,), daemon=True) for r in rows]
            for t in pool:
                t.start()
            for t in pool:
                t.join()
            return ok_count[0]

        def done(ok):
            if isinstance(ok, tuple) and ok and ok[0] == "__error__":
                messagebox.showerror("错误", ok[1])
                return
            self._mm_apply_filter()
            self.status_var.set("封面下载完成：%d/%d 成功" % (ok, len(rows)))
            messagebox.showinfo("完成", "%d/%d 个封面已下载。\n（若仍无缩略图，可能是 C 站图片访问受限，可稍后重试或使用代理）" % (ok, len(rows)))

        Worker(self, work, done)

    def _mm_translate_descs(self):
        """批量把模型简介翻译成中文（百度翻译，需先在设置页配置 APP ID/密钥）"""
        appid = self.cfg.get("baidu_appid", "").strip()
        key = self.cfg.get("baidu_key", "").strip()
        if not appid or not key:
            messagebox.showinfo("提示", "请先在 设置 页填写 百度翻译 APP ID 和密钥，并点「测试翻译」确认可用")
            return
        import translator
        rows = self._mm_target_rows()
        with_info = [r for r in rows if model_manager.find_info_file(r["path"])]
        if not with_info:
            messagebox.showinfo("提示", "所选模型没有 info 元数据，无法翻译")
            return
        if not messagebox.askyesno("翻译简介",
                                   "将读取 %d 个模型的简介，用百度翻译为中文并写入 json 的 description（SD 卡片显示中文）。\n"
                                   "已含中文的简介自动跳过；免费版有限速，约需数分钟。\n继续？" % len(with_info)):
            return
        self.mm_progress.configure(mode="determinate", maximum=len(with_info), value=0)
        self.status_var.set("正在翻译简介 ...")
        lock = threading.Lock()
        done_count = [0]
        ok_count = [0]

        def work_one(r):
            base, _ = os.path.splitext(r["path"])
            json_path = base + ".json"
            try:
                # 读取现有描述（优先 json，其次 info）
                with open(json_path, "r", encoding="utf-8") as f:
                    d = json.load(f)
                desc = (d.get("description") or "").strip()
                if not desc:
                    return
                if translator._is_cjk(desc):
                    return  # 已中文
                translated = translator.translate(desc, appid, key)
                if translated and translated != desc:
                    d["description"] = translated
                    d["description_zh"] = translated
                    with open(json_path, "w", encoding="utf-8") as f:
                        json.dump(d, f, ensure_ascii=False, indent=2)
                    with lock:
                        ok_count[0] += 1
            except Exception:
                pass
            finally:
                with lock:
                    done_count[0] += 1
                    self.post(lambda: (self.mm_progress.configure(value=done_count[0]),
                                       self.status_var.set("翻译简介 %d/%d（成功 %d）" % (done_count[0], len(with_info), ok_count[0]))))

        def work():
            # 串行 + 限速（百度免费版 QPS 低），避免限流
            for r in with_info:
                work_one(r)
            return ok_count[0]

        def done(ok):
            if isinstance(ok, tuple) and ok and ok[0] == "__error__":
                messagebox.showerror("错误", ok[1])
                return
            messagebox.showinfo("完成", "%d/%d 个简介已翻译为中文（已中文或空的自动跳过）。\n重启 Forge 后卡片显示中文简介。" % (ok, len(with_info)))
            self.status_var.set("简介翻译完成：%d 个" % ok)

        Worker(self, work, done)

    def _mm_localize_filenames(self):
        """把选中/勾选/全部模型的文件名汉化（模型名翻译成中文，附属文件同步改名）"""
        appid = self.cfg.get("baidu_appid", "").strip()
        key = self.cfg.get("baidu_key", "").strip()
        if not appid or not key:
            messagebox.showinfo("提示", "请先在 设置 页填写 百度翻译 APP ID 和密钥")
            return
        import translator
        rows = self._mm_target_rows()
        targets = []
        for r in rows:
            info = r.get("info") or {}
            name = (info.get("name") or "").strip()
            if not name:
                continue
            cur = os.path.splitext(os.path.basename(r["path"]))[0]
            if translator._is_cjk(name) and cur == name:
                continue  # 已是中文且文件名一致
            targets.append(r)
        if not targets:
            messagebox.showinfo("提示", "所选模型没有可汉化的（无元数据或已是中文名）")
            return
        if not messagebox.askyesno("汉化文件名",
                                   "将把 %d 个模型的文件名汉化（C 站模型名翻译成中文）。\n"
                                   "⚠️ 改名后 SD 中已保存的引用可能失效，请先备份 workflow。\n"
                                   "附带的 .civitai.info / .json / preview.png 会同步改名。\n继续？" % len(targets)):
            return
        self.mm_progress.configure(mode="determinate", maximum=len(targets), value=0)
        self.status_var.set("正在汉化文件名 ...")
        lock = threading.Lock()
        done_count = [0]
        ok_count = [0]

        def work_one(r):
            info = r.get("info") or {}
            name = (info.get("name") or "").strip()
            zh_name = name
            if not translator._is_cjk(name):
                zh_name = translator.translate(name, appid, key) or name
            try:
                if zh_name != name or zh_name != os.path.splitext(os.path.basename(r["path"]))[0]:
                    meta2 = dict(info)
                    meta2["name"] = zh_name
                    model_manager.rename_to_civitai(r["path"], meta2)
                    with lock:
                        ok_count[0] += 1
            except Exception:
                pass
            finally:
                with lock:
                    done_count[0] += 1
                    self.post(lambda: (self.mm_progress.configure(value=done_count[0]),
                                       self.status_var.set("汉化 %d/%d（成功 %d）" % (done_count[0], len(targets), ok_count[0]))))

        def work():
            for r in targets:
                work_one(r)
            return ok_count[0]

        def done(ok):
            if isinstance(ok, tuple) and ok and ok[0] == "__error__":
                messagebox.showerror("错误", ok[1])
                return
            messagebox.showinfo("完成", "%d/%d 个文件名已汉化。\n重启 Forge 后生效。" % (ok, len(targets)))
            self.status_var.set("汉化完成：%d 个" % ok)
            self._mm_scan()

        Worker(self, work, done)

    def _mm_open_dir(self):
        d = self.cfg.get("models_dir") or self.cfg.get("download_dir")
        if d and os.path.isdir(d):
            os.startfile(d)
        else:
            messagebox.showinfo("提示", "模型目录不存在: %s" % d)

    # ============ 页面4：反向解析 ============
    def _build_reverse_page(self, nb):
        page = ttk.Frame(nb)
        nb.add(page, text="反向解析")
        bar = ttk.Frame(page)
        bar.pack(fill="x", padx=8, pady=6)
        self.rp_btn_add_file = ui.GlowButton(bar, text="添加文件", command=self._rp_add_files)
        self.rp_btn_add_file.pack(side="left")
        self.rp_btn_add_dir = ui.GlowButton(bar, text="添加文件夹", command=self._rp_add_dir)
        self.rp_btn_add_dir.pack(side="left", padx=4)
        self.rp_btn_remove = ui.GlowButton(bar, text="移除选中", command=self._rp_remove_sel)
        self.rp_btn_remove.pack(side="left", padx=4)
        self.rp_btn_start = ui.GlowButton(bar, text="开始反查", command=self._rp_start, kind="primary")
        self.rp_btn_start.pack(side="left", padx=4)
        self.rp_btn_pause = ui.GlowButton(bar, text="暂停", command=self._rp_pause, state="disabled")
        self.rp_btn_pause.pack(side="left", padx=4)
        self.rp_btn_stop = ui.GlowButton(bar, text="停止", command=self._rp_stop, state="disabled")
        self.rp_btn_stop.pack(side="left", padx=4)
        ui.GlowButton(bar, text="打开所在目录", command=self._rp_open_dir).pack(side="left", padx=4)
        ttk.Label(bar, text="（SHA256 反查 C 站，自动生成 civitai.info.json）").pack(side="left", padx=12)
        # 筛选行
        fbar = ttk.Frame(page)
        fbar.pack(fill="x", padx=8, pady=(0, 4))
        ttk.Label(fbar, text="筛选：").pack(side="left")
        self.rp_filter_var = tk.StringVar()
        self.rp_filter_var.trace_add("write", lambda *a: self._rp_apply_filter())
        self.rp_filter_entry = ttk.Entry(fbar, textvariable=self.rp_filter_var, width=24)
        self.rp_filter_entry.pack(side="left", padx=4)
        ui.GlowButton(fbar, text="清除", command=lambda: self.rp_filter_var.set("")).pack(side="left")
        ttk.Label(fbar, text="（点击列头排序：文件/SHA256/状态/模型/版本）", foreground="#888").pack(side="left", padx=10)
        cols = ("file", "sha", "status", "model", "version")
        self.rp_tree = ttk.Treeview(page, columns=cols, show="headings", height=14)
        heads = {"file": ("文件", 340), "sha": ("SHA256", 200), "status": ("状态", 90),
                 "model": ("模型", 200), "version": ("版本", 120)}
        for c, (t, w) in heads.items():
            self.rp_tree.heading(c, text=t, command=lambda c=c: self._rp_sort_by(c))
            self.rp_tree.column(c, width=w, anchor="w")
        # 垂直滚动条 + 列表（经典布局：滚动条先占右侧，列表占剩余）
        rp_ys = ttk.Scrollbar(page, orient="vertical", command=self.rp_tree.yview)
        self.rp_tree.configure(yscrollcommand=rp_ys.set)
        rp_ys.pack(side="right", fill="y")
        self.rp_tree.pack(side="left", fill="both", expand=True, padx=(8, 0))
        self._row_hovers.append(ui.RowHover(self.rp_tree))
        self.rp_id_map = {}
        # 反向解析运行控制 + 筛选/排序状态
        self._rp_pause_ev = threading.Event()
        self._rp_stop_ev = threading.Event()
        self._rp_running = False
        self._rp_sort_col = None
        self._rp_sort_rev = False
        self._rp_display_rows = []

    def _rp_sort_by(self, col):
        if self._rp_sort_col == col:
            self._rp_sort_rev = not self._rp_sort_rev
        else:
            self._rp_sort_col = col
            self._rp_sort_rev = False
        self._rp_apply_filter()

    def _rp_sort_key(self, r):
        col = self._rp_sort_col
        if col == "file":
            return (os.path.basename(r.get("path") or "") or "").lower()
        if col == "status":
            return r.get("status") or ""
        if col == "sha":
            return r.get("sha") or ""
        return (r.get({"model": "model", "version": "version"}.get(col, "")) or "").lower()

    def _rp_apply_filter(self):
        """按筛选 + 排序重建反向解析表格"""
        kw = (self.rp_filter_var.get() or "").strip().lower()
        rows = self.rp_rows
        if kw:
            rows = [r for r in rows
                    if kw in os.path.basename(r.get("path") or "").lower()
                    or kw in (r.get("path") or "").lower()
                    or kw in (r.get("status") or "").lower()
                    or kw in (r.get("model") or "").lower()
                    or kw in (r.get("version") or "").lower()]
        self._rp_display_rows = rows
        if self._rp_sort_col:
            rows = sorted(rows, key=self._rp_sort_key, reverse=self._rp_sort_rev)
            self._rp_display_rows = rows
        self.rp_tree.delete(*self.rp_tree.get_children())
        self.rp_id_map.clear()
        for i, r in enumerate(rows):
            iid = "r%d" % i
            self.rp_id_map[iid] = r
            self.rp_tree.insert("", "end", iid=iid, values=(
                r["path"], r["sha"] or "", r["status"], r["model"], r["version"]))

    def _rp_add_paths(self, paths):
        """外部（如模型管理页）批量加入待反查文件，去重"""
        existing = {r["path"] for r in self.rp_rows}
        for p in paths:
            if p not in existing:
                self.rp_rows.append({"path": p, "sha": "", "status": "等待", "model": "", "version": ""})
                existing.add(p)
        self._rp_fill()

    def _rp_add_files(self):
        files = filedialog.askopenfilenames(
            title="选择模型文件",
            filetypes=[("模型文件", "*.safetensors *.ckpt *.pt *.pth *.bin *.gguf *.onnx"), ("所有文件", "*.*")])
        self._rp_add_paths(list(files))
        self.rp_filter_var.set("")  # 添加文件后清空筛选，避免旧关键字隐藏新文件

    def _rp_add_dir(self):
        d = filedialog.askdirectory(title="选择模型目录")
        if not d:
            return
        files = model_manager.scan_models(d)
        self._rp_add_paths([f["path"] for f in files])
        self.rp_filter_var.set("")  # 添加文件夹后清空筛选，避免旧关键字隐藏新文件

    def _rp_remove_sel(self):
        sel = self.rp_tree.selection()
        for i in sel:
            r = self.rp_id_map.get(i)
            if r is not None and r in self.rp_rows:
                self.rp_rows.remove(r)  # 按行对象删除，不受筛选/排序索引影响
        self._rp_apply_filter()

    def _rp_fill(self):
        """重建表格（走筛选+排序管线，兼容旧调用点）"""
        self._rp_apply_filter()

    def _rp_start(self):
        if self._rp_running:
            return
        if not self.rp_rows:
            messagebox.showinfo("提示", "请先添加文件")
            return
        self._rp_running = True
        self._rp_pause_ev.clear()
        self._rp_stop_ev.clear()
        self.rp_btn_start.configure(state="disabled")
        self.rp_btn_pause.configure(state="normal", text="暂停")
        self.rp_btn_stop.configure(state="normal")
        # 运行期间禁用增删，避免 worker 取任务期间列表变动
        self.rp_btn_add_file.configure(state="disabled")
        self.rp_btn_add_dir.configure(state="disabled")
        self.rp_btn_remove.configure(state="disabled")
        for r in self.rp_rows:
            if r["status"] not in ("成功", "未收录"):
                r["status"] = "等待"
                r["sha"] = ""
                r["model"] = ""
                r["version"] = ""
        self._rp_fill()
        n = max(1, int(self.cfg.get("hash_threads", 4)))
        lock = threading.Lock()
        idx = [0]
        done_count = [0]

        def _cancel_rest():
            with lock:
                for j in range(idx[0], len(self.rp_rows)):
                    if self.rp_rows[j]["status"] in ("等待",):
                        self.rp_rows[j]["status"] = "已取消"
            self.post(self._rp_fill)

        def worker_one():
            api = self._new_api()
            while True:
                if self._rp_stop_ev.is_set():
                    _cancel_rest()
                    return
                if self._rp_pause_ev.is_set():
                    self.post(lambda: self.status_var.set("反向解析已暂停（当前任务完成后暂停）"))
                    while self._rp_pause_ev.is_set() and not self._rp_stop_ev.is_set():
                        time.sleep(0.2)
                    if self._rp_stop_ev.is_set():
                        _cancel_rest()
                        return
                with lock:
                    i = idx[0]
                    idx[0] += 1
                if i >= len(self.rp_rows):
                    return
                r = self.rp_rows[i]
                r["status"] = "反查中"
                self.post(self._rp_fill)
                try:
                    res = reverse_parse.reverse_by_hash(
                        r["path"], api, self.cfg,
                        translate_desc=bool(self.cfg.get("auto_translate", True)),
                        cancel_ev=self._rp_stop_ev)
                    if self._rp_stop_ev.is_set() and res.get("error") == "已取消":
                        r["status"] = "已取消"
                        r["model"] = ""
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
                finally:
                    with lock:
                        done_count[0] += 1
                    self.post(self._rp_fill)
                    self.post(lambda: self.status_var.set("反向解析 %d/%d" % (done_count[0], len(self.rp_rows))))

        def work():
            pool = [threading.Thread(target=worker_one, daemon=True) for _ in range(n)]
            for t in pool:
                t.start()
            for t in pool:
                t.join()
            return self._rp_stop_ev.is_set()

        def done(stopped):
            if isinstance(stopped, tuple) and stopped and stopped[0] == "__error__":
                messagebox.showerror("错误", stopped[1])
                stopped = False
            self._rp_running = False
            self.rp_btn_start.configure(state="normal")
            self.rp_btn_pause.configure(state="disabled", text="暂停")
            self.rp_btn_stop.configure(state="disabled")
            self.rp_btn_add_file.configure(state="normal")
            self.rp_btn_add_dir.configure(state="normal")
            self.rp_btn_remove.configure(state="normal")
            self._rp_pause_ev.clear()
            self._rp_stop_ev.clear()
            self._rp_fill()
            self.status_var.set("反向解析已停止" if stopped else "反向解析完成")

        self.status_var.set("开始反向解析 ...")
        Worker(self, work, done)

    def _rp_pause(self):
        """暂停/继续：当前正在计算的任务会跑完，之后不再启动新任务"""
        if self._rp_pause_ev.is_set():
            self._rp_pause_ev.clear()
            self.rp_btn_pause.configure(text="暂停")
            self.status_var.set("反向解析继续")
        else:
            self._rp_pause_ev.set()
            self.rp_btn_pause.configure(text="继续")

    def _rp_stop(self):
        """停止：中断进行中的哈希计算，未开始的标记为已取消"""
        self._rp_stop_ev.set()
        self.rp_btn_pause.configure(state="disabled")
        self.rp_btn_stop.configure(state="disabled")
        self.status_var.set("正在停止 ...")

    def _rp_open_dir(self):
        sel = self.rp_tree.selection()
        if sel:
            r = self.rp_id_map.get(sel[0])
            if r:
                os.startfile(os.path.dirname(r["path"]))
                return
        messagebox.showinfo("提示", "请先在列表中选择一项")

    # ============ 页面5：设置 ============
    def _build_settings_page(self, nb):
        page = ttk.Frame(nb)
        nb.add(page, text="设置")
        frm = ttk.LabelFrame(page, text="基本设置")
        frm.pack(fill="x", padx=8, pady=8)
        self.vars = {}
        rows = [
            ("api_key", "Civitai API Key（可在 civitai.com 个人中心获取）", 60),
            ("download_dir", "下载目录", 50),
            ("models_dir", "模型管理目录", 50),
            ("proxy_address", "代理地址（如 127.0.0.1:7897）", 40),
        ]
        self.var_api_key = tk.StringVar(value=self.cfg.get("api_key", ""))
        self.var_download_dir = tk.StringVar(value=self.cfg.get("download_dir", ""))
        self.var_models_dir = tk.StringVar(value=self.cfg.get("models_dir", ""))
        self.var_proxy = tk.StringVar(value=self.cfg.get("proxy_address", ""))
        ttk.Label(frm, text="Civitai API Key（civitai.com 个人中心获取，用于下载/查询）").grid(row=0, column=0, sticky="w", padx=6, pady=3)
        ttk.Entry(frm, textvariable=self.var_api_key, width=60).grid(row=0, column=1, sticky="we", padx=6)
        ttk.Label(frm, text="下载目录").grid(row=1, column=0, sticky="w", padx=6, pady=3)
        ttk.Entry(frm, textvariable=self.var_download_dir, width=50).grid(row=1, column=1, sticky="we", padx=6)
        ttk.Button(frm, text="浏览", command=lambda: self.var_download_dir.set(
            filedialog.askdirectory())).grid(row=1, column=2, padx=4)
        ttk.Label(frm, text="模型管理目录").grid(row=2, column=0, sticky="w", padx=6, pady=3)
        ttk.Entry(frm, textvariable=self.var_models_dir, width=50).grid(row=2, column=1, sticky="we", padx=6)
        ttk.Button(frm, text="浏览", command=lambda: self.var_models_dir.set(
            filedialog.askdirectory())).grid(row=2, column=2, padx=4)
        self.var_concurrent = tk.IntVar(value=int(self.cfg.get("max_concurrent_downloads", 3)))
        ttk.Spinbox(frm, from_=1, to=20, textvariable=self.var_concurrent, width=8).grid(row=3, column=1, sticky="w", padx=6)
        ttk.Label(frm, text="哈希线程数").grid(row=4, column=0, sticky="w", padx=6, pady=3)
        self.var_hash_threads = tk.IntVar(value=int(self.cfg.get("hash_threads", 4)))
        ttk.Spinbox(frm, from_=1, to=16, textvariable=self.var_hash_threads, width=8).grid(row=4, column=1, sticky="w", padx=6)
        ttk.Label(frm, text="下载超时(秒)").grid(row=5, column=0, sticky="w", padx=6, pady=3)
        self.var_timeout = tk.IntVar(value=int(self.cfg.get("download_timeout", 300)))
        ttk.Spinbox(frm, from_=30, to=3600, textvariable=self.var_timeout, width=8).grid(row=5, column=1, sticky="w", padx=6)
        self.var_proxy_enabled = tk.BooleanVar(value=bool(self.cfg.get("proxy_enabled", False)))
        ttk.Checkbutton(frm, text="启用代理", variable=self.var_proxy_enabled).grid(row=6, column=0, sticky="w", padx=6, pady=3)
        ttk.Entry(frm, textvariable=self.var_proxy, width=40).grid(row=6, column=1, sticky="w", padx=6)
        self.var_auto_translate = tk.BooleanVar(value=bool(self.cfg.get("auto_translate", True)))
        ttk.Checkbutton(frm, text="反向解析时自动翻译描述为中文", variable=self.var_auto_translate).grid(row=7, column=0, columnspan=2, sticky="w", padx=6, pady=3)
        ttk.Label(frm, text="窗口风格").grid(row=8, column=0, sticky="w", padx=6, pady=3)
        self.var_window_style = tk.StringVar(value=self.cfg.get("window_style", "mica"))
        style_cb = ttk.Combobox(frm, textvariable=self.var_window_style, state="readonly", width=12)
        style_cb["values"] = ["mica", "acrylic", "none"]
        style_cb.grid(row=8, column=1, sticky="w", padx=6)
        ttk.Label(frm, text="(mica=云母, acrylic=亚克力, none=经典; Win11 生效，Win10 自动忽略)",
                  foreground="#888").grid(row=8, column=2, columnspan=2, sticky="w")
        self.var_ask_move = tk.BooleanVar(value=bool(self.cfg.get("ask_move_after_download", True)))
        ttk.Checkbutton(frm, text="下载完成后询问移动位置", variable=self.var_ask_move).grid(row=9, column=0, columnspan=2, sticky="w", padx=6, pady=3)
        ttk.Label(frm, text="metadata 格式").grid(row=10, column=0, sticky="w", padx=6, pady=3)
        self.var_meta_fmt = tk.StringVar(value=self.cfg.get("metadata_format", "sd"))
        meta_cb = ttk.Combobox(frm, textvariable=self.var_meta_fmt, state="readonly", width=12)
        meta_cb["values"] = ["sd", "civitai", "both"]
        meta_cb.grid(row=10, column=1, sticky="w", padx=6)
        ttk.Label(frm, text="(sd=扁平结构<模型名>.json, civitai=C站结构.civitai.info, both=两者都生成)",
                  foreground="#888").grid(row=10, column=2, columnspan=2, sticky="w")
        ttk.Label(frm, text="界面主题").grid(row=11, column=0, sticky="w", padx=6, pady=3)
        ttk.Label(frm, text="界面主题").grid(row=11, column=0, sticky="w", padx=6, pady=3)
        self.var_theme = tk.StringVar(value=ui.THEME_LABELS.get(self.cfg.get("theme", "dark"), "深色"))
        theme_cb = ttk.Combobox(frm, textvariable=self.var_theme, state="readonly", width=10)
        theme_cb["values"] = list(ui.THEME_LABELS.values())
        theme_cb.grid(row=11, column=1, sticky="w", padx=6)
        ttk.Label(frm, text="(深色 / 浅色 / 现代浅色：Axion 风格浅灰底+橙)",
                  foreground="#888").grid(row=11, column=2, columnspan=2, sticky="w")
        ttk.Label(frm, text="无边框窗口").grid(row=12, column=0, sticky="w", padx=6, pady=3)
        self.var_frameless = tk.BooleanVar(value=bool(self.cfg.get("frameless", False)))
        ttk.Checkbutton(frm, text="启用（自绘标题栏，需重启生效）", variable=self.var_frameless).grid(row=12, column=1, sticky="w", padx=6)
        ttk.Label(frm, text="站点域名").grid(row=13, column=0, sticky="w", padx=6, pady=3)
        self.var_site_domain = tk.StringVar(value=self.cfg.get("site_domain", "civitai.red"))
        sd_cb = ttk.Combobox(frm, textvariable=self.var_site_domain, state="readonly", width=12)
        sd_cb["values"] = ["civitai.red", "civitai.com"]
        sd_cb.grid(row=13, column=1, sticky="w", padx=6)
        ttk.Label(frm, text="(打开 C 站/复制的链接使用的域名；下载与 API 仍走 civitai.com)",
                  foreground="#888").grid(row=13, column=2, columnspan=2, sticky="w")
        ttk.Label(frm, text="百度翻译 APP ID").grid(row=14, column=0, sticky="w", padx=6, pady=3)
        self.var_baidu_appid = tk.StringVar(value=self.cfg.get("baidu_appid", ""))
        ttk.Entry(frm, textvariable=self.var_baidu_appid, width=30).grid(row=14, column=1, sticky="w", padx=6)
        ttk.Label(frm, text="百度翻译密钥").grid(row=15, column=0, sticky="w", padx=6, pady=3)
        self.var_baidu_key = tk.StringVar(value=self.cfg.get("baidu_key", ""))
        ttk.Entry(frm, textvariable=self.var_baidu_key, width=40, show="*").grid(row=15, column=1, sticky="w", padx=6)
        ttk.Button(frm, text="测试翻译", command=self._test_baidu).grid(row=15, column=2, padx=4)
        ttk.Label(frm, text="(在 fanyi-api.baidu.com 开通通用翻译；用于「翻译简介」与反向解析描述翻译)",
                  foreground="#888").grid(row=16, column=1, columnspan=3, sticky="w")
        self.var_translate_filename = tk.BooleanVar(value=bool(self.cfg.get("translate_filename", False)))
        ttk.Checkbutton(frm, text="下载文件名为中文（用百度翻译模型名）", variable=self.var_translate_filename).grid(row=17, column=0, columnspan=3, sticky="w", padx=6, pady=3)
        self.var_zebra_rows = tk.BooleanVar(value=bool(self.cfg.get("zebra_rows", True)))
        ttk.Checkbutton(frm, text="模型列表斑马纹（行间视觉分隔）", variable=self.var_zebra_rows).grid(row=18, column=0, columnspan=3, sticky="w", padx=6, pady=3)
        self.var_ambient = tk.BooleanVar(value=bool(self.cfg.get("ambient_bg", True)))
        ttk.Checkbutton(frm, text="顶部氛围动态背景（流动光晕）", variable=self.var_ambient).grid(row=18, column=1, columnspan=3, sticky="w", padx=6, pady=3)
        ttk.Label(frm, text="整理分类规则").grid(row=19, column=0, sticky="nw", padx=6, pady=3)
        rules_frm = ttk.Frame(frm)
        rules_frm.grid(row=19, column=1, columnspan=3, sticky="we", padx=6)
        self.var_organize_rules = tk.Text(rules_frm, height=6, width=60)
        self.var_organize_rules.insert("1.0", _rules_to_text(self.cfg.get("organize_rules") or []))
        rules_ys = ttk.Scrollbar(rules_frm, orient="vertical", command=self.var_organize_rules.yview)
        self.var_organize_rules.configure(yscrollcommand=rules_ys.set)
        rules_ys.pack(side="right", fill="y")
        self.var_organize_rules.pack(side="left", fill="x", expand=True)
        ttk.Label(frm, text="每行一条：`关键词1,关键词2 -> 文件夹名`（模型名/标签/文件名含任一关键词即归入该文件夹；\n未匹配的按 类型/基础模型 分类）",
                  foreground="#888").grid(row=20, column=1, columnspan=3, sticky="w", padx=6)
        bar = ttk.Frame(page)
        bar.pack(fill="x", padx=8, pady=6)
        ui.GlowButton(bar, text="保存设置", command=self._save_settings, kind="primary").pack(side="left")
        ui.GlowButton(bar, text="测试 API 连接", command=self._test_api).pack(side="left", padx=6)
        ttk.Label(page, text="CivitaiFreeTool v1.0 —— 独立实现的免费替代工具，全部功能开放。\n"
                             "数据来自 Civitai 官方公开 API；请遵守 Civitai 服务条款与模型作者许可。",
                  foreground="#666", justify="left").pack(anchor="w", padx=10, pady=10)

    def _save_settings(self):
        self.cfg["api_key"] = self.var_api_key.get().strip()
        self.cfg["download_dir"] = self.var_download_dir.get().strip()
        self.cfg["models_dir"] = self.var_models_dir.get().strip()
        self.cfg["max_concurrent_downloads"] = self.var_concurrent.get()
        self.cfg["hash_threads"] = self.var_hash_threads.get()
        self.cfg["download_timeout"] = self.var_timeout.get()
        self.cfg["proxy_enabled"] = self.var_proxy_enabled.get()
        self.cfg["proxy_address"] = self.var_proxy.get().strip()
        self.cfg["auto_translate"] = self.var_auto_translate.get()
        self.cfg["window_style"] = self.var_window_style.get()
        self.cfg["ask_move_after_download"] = self.var_ask_move.get()
        self.cfg["metadata_format"] = self.var_meta_fmt.get()
        label2key = {v: k for k, v in ui.THEME_LABELS.items()}
        self.cfg["theme"] = label2key.get(self.var_theme.get(), "dark")
        self.cfg["frameless"] = self.var_frameless.get()
        self.cfg["site_domain"] = self.var_site_domain.get()
        self.cfg["baidu_appid"] = self.var_baidu_appid.get().strip()
        self.cfg["baidu_key"] = self.var_baidu_key.get().strip()
        self.cfg["translate_filename"] = self.var_translate_filename.get()
        self.cfg["zebra_rows"] = self.var_zebra_rows.get()
        self.cfg["organize_rules"] = _text_to_rules(self.var_organize_rules.get("1.0", "end"))
        ambient = self.var_ambient.get()
        self.cfg["ambient_bg"] = ambient
        if config.save(self.cfg):
            # 重建 API（应用新配置）
            self.api = civitai_api.CivitaiAPI(
                self.cfg.get("api_key", ""), self.API_TIMEOUT,
                self.cfg.get("proxy_address") if self.cfg.get("proxy_enabled") else None)
            self.dl.cfg = self.cfg
            # 应用窗口风格
            theme.apply_backdrop(self.winfo_id(), self.cfg.get("window_style", "mica"))
            # 应用主题（深/浅/现代浅色）并刷新动效组件
            theme_key = self.cfg.get("theme", "dark")
            if theme_key != self.theme:
                self.theme = theme_key
                ui.apply_theme(self, self.style, theme_key)
                for h in self._row_hovers:
                    h.refresh()
                if self.frameless_bar:
                    self.frameless_bar.refresh()
            # 氛围背景即时启停
            if self.cfg.get("ambient_bg", True):
                self.ambient.start()
            else:
                self.ambient.stop()
            msg = "设置已保存"
            if self.cfg.get("frameless") != bool(self.frameless_bar):
                msg += "\n\n无边框窗口设置将在下次启动时生效。"
            messagebox.showinfo("设置", msg)
        else:
            messagebox.showerror("设置", "保存失败")

    def _test_baidu(self):
        """测试百度翻译连通性"""
        appid = self.var_baidu_appid.get().strip()
        key = self.var_baidu_key.get().strip()
        if not appid or not key:
            messagebox.showinfo("提示", "请先填写百度翻译 APP ID 和密钥")
            return
        self.status_var.set("正在测试百度翻译 ...")

        def work():
            try:
                import translator
                out = translator.baidu_translate("Hello, this is a test.", appid, key)
                return ("__ok__", out)
            except Exception as e:
                return ("__error__", str(e))

        def done(res):
            if res[0] == "__ok__":
                messagebox.showinfo("测试成功", "翻译结果：%s" % res[1])
                self.status_var.set("百度翻译正常")
            else:
                messagebox.showerror("测试失败", res[1])

        Worker(self, work, done)

    def _test_api(self):
        self.status_var.set("正在测试 API ...")

        def work():
            proxy = self.cfg.get("proxy_address") if self.cfg.get("proxy_enabled") else None
            a = civitai_api.CivitaiAPI(self.var_api_key.get().strip(), 15, proxy)
            d = a._get("/models", {"limit": 1})
            return ("__ok__", "API 连接正常，返回模型数: %d" % len(d.get("items", [])))

        def done(res):
            if res[0] == "__ok__":
                messagebox.showinfo("测试", res[1])
                self.status_var.set("就绪")
            else:
                messagebox.showerror("测试失败", _friendly_api_error(res[1]))
                self.status_var.set("API 测试失败")

        Worker(self, work, done)


def _friendly_api_error(s):
    """把底层异常翻译成可操作的中文提示（超时/代理/权限等）"""
    s = str(s)
    low = s.lower()
    if "10060" in s or "10061" in s or "timed out" in low or "超时" in s:
        return ("连接 Civitai 超时。\n"
                "可能原因：\n"
                "· 网络不稳定（可稍后重试）\n"
                "· 需要代理：在 设置 页勾选「启用代理」并确认地址（如 127.0.0.1:7897），保存后再测试\n\n"
                "详细信息：\n%s" % s)
    if "11001" in s or "name or service not known" in low or "getaddrinfo" in low:
        return ("无法解析 civitai.com 域名（DNS 问题）。\n"
                "可能需要启用代理，或检查网络连接。\n\n详细信息：\n%s" % s)
    if "403" in s:
        return ("被 Civitai 拒绝访问（403）。\n可能需要代理，或请求过于频繁稍后再试。\n\n详细信息：\n%s" % s)
    if "401" in s:
        return ("API Key 无效（401）。\n请在 设置 页检查 API Key 是否正确。\n\n详细信息：\n%s" % s)
    return s


def _is_image_bytes(data):
    """校验下载内容是否为有效图片格式（PNG/JPEG/WebP/GIF），排除 MP4 等伪装文件"""
    return (data.startswith(b"\x89PNG") or data.startswith(b"\xff\xd8")
            or data.startswith(b"RIFF") or data.startswith(b"GIF8")
            or data.startswith(b"II*\x00"))


def _download_image(url, dest, timeout=60):
    """下载图片到本地文件（先验证内容为图片格式再写 .tmp + 原子替换；非图片/失败返回 False）"""
    try:
        import urllib.request
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
        if data and len(data) > 100 and _is_image_bytes(data):
            tmp = dest + ".tmp"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, dest)
            return True
    except Exception:
        pass
    return False


def _rules_to_text(rules):
    """规则列表 -> 多行文本（每行：关键词1,关键词2 -> 文件夹名）"""
    lines = []
    for r in rules or []:
        kws = ", ".join(r.get("keywords") or [])
        if kws and r.get("folder"):
            lines.append("%s -> %s" % (kws, r["folder"]))
    return "\n".join(lines)


def _text_to_rules(text):
    """多行文本 -> 规则列表。每行 `关键词1,关键词2 -> 文件夹名`（-> 或 => 分隔）"""
    rules = []
    for line in (text or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        for sep in ("->", "=>", "→"):
            if sep in line:
                left, right = line.split(sep, 1)
                kws = [k.strip() for k in left.split(",") if k.strip()]
                folder = right.strip()
                if kws and folder:
                    rules.append({"folder": folder, "keywords": kws})
                break
    return rules


def _recycle_to_trash(paths):
    """通过 Win32 SHFileOperation 把文件移入回收站（可恢复）。返回是否成功。"""
    import ctypes
    from ctypes import wintypes
    FO_DELETE = 3
    FOF_ALLOWUNDO = 0x40
    FOF_NOCONFIRMATION = 0x10
    FOF_SILENT = 0x4
    FOF_NOERRORUI = 0x80

    class SHFILEOPSTRUCTW(ctypes.Structure):
        _fields_ = [("hwnd", wintypes.HWND), ("wFunc", ctypes.c_uint),
                    ("pFrom", wintypes.LPCWSTR), ("pTo", wintypes.LPCWSTR),
                    ("fFlags", ctypes.c_ushort), ("fAnyOperationsAborted", wintypes.BOOL),
                    ("hNameMappings", ctypes.c_void_p), ("lpszProgressTitle", wintypes.LPCWSTR)]

    op = SHFILEOPSTRUCTW()
    op.wFunc = FO_DELETE
    op.pFrom = "\0".join(paths) + "\0\0"
    op.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI
    return ctypes.windll.shell32.SHFileOperationW(ctypes.byref(op)) == 0


# info 写回全局锁（共享 civitai.info 的并发写保护）
_info_write_lock = threading.Lock()


def fmt_size(n):
    try:
        n = float(n or 0)
    except Exception:
        return "-"
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return "%.1f %s" % (n, unit) if unit != "B" else "%d B" % n
        n /= 1024
    return "-"


def _folder_visible(rel, hidden, show_root):
    """按文件夹显示设置判断扫描结果是否可见。rel 为相对路径。
    hidden 存相对目录路径（如 "Lora/Pony"），匹配该目录及其下所有内容。"""
    d = os.path.dirname(rel).replace("\\", "/")
    if not d:
        return show_root
    for h in hidden:
        h = (h or "").replace("\\", "/").strip("/")
        if h and (d == h or d.startswith(h + "/")):
            return False
    return True


def _version_name(meta):
    """兼容 civitai 结构（version 为 dict）与 sd 扁平结构（version 为字符串）"""
    v = meta.get("version")
    if isinstance(v, dict):
        return v.get("name", "")
    return v or ""
