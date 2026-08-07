# -*- coding: utf-8 -*-
"""CivitaiFreeTool 入口（支持 --diag 诊断模式：自动扫描并检查列表填充，结果写 diag.txt）"""
import os
import sys

import gui


def run_diag():
    """诊断模式：不弹窗交互，自动扫描模型目录，检查列表填充，写 diag.txt"""
    import io
    import time
    out = io.StringIO()

    def P(*a):
        print(*a, file=out)

    P("diag start:", time.strftime("%Y-%m-%d %H:%M:%S"))
    P("python:", sys.version)
    P("frozen:", getattr(sys, "frozen", False))
    app = gui.CivitaiFreeGUI()
    # 窗口正常显示（不 withdraw），固定位置便于截图分析
    app.geometry("1180x720+100+100")
    app.deiconify()
    app.update_idletasks()
    P("models_dir:", app.cfg.get("models_dir"))
    P("hidden:", app.cfg.get("hidden_model_folders"))
    P("show_root:", app.cfg.get("show_root_models"))
    root = app.cfg.get("models_dir") or app.cfg.get("download_dir")
    P("root exists:", os.path.isdir(str(root)) if root else False)
    app.nb.select(2)
    app.update_idletasks()
    app.update()

    state = {}
    diag_err = []

    # 屏蔽弹窗，异常记录到 diag_err
    import tkinter.messagebox as mb
    mb.showinfo = lambda *a, **k: diag_err.append(("info", a))
    mb.showwarning = lambda *a, **k: diag_err.append(("warn", a))
    mb.showerror = lambda *a, **k: diag_err.append(("error", a[1] if len(a) > 1 else a))
    mb.askyesno = lambda *a, **k: True

    orig_report = app.report_callback_exception
    app.report_callback_exception = lambda exc, val, tb: diag_err.append(("callback", "%s: %s" % (exc.__name__, val)))

    def check():
        state["rows"] = len(app.model_rows)
        state["disp"] = len(app._mm_display_rows)
        state["tree"] = len(app.mm_tree.get_children())
        state["tree_h"] = app.mm_tree.winfo_height()
        state["tree_w"] = app.mm_tree.winfo_width()
        kids = app.mm_tree.get_children()
        state["first_bbox"] = app.mm_tree.bbox(kids[0]) if kids else None
        state["last_bbox"] = app.mm_tree.bbox(kids[-1]) if kids else None
        state["filter"] = app.mm_filter_var.get()
        state["sample"] = [app.mm_tree.item(k, "values")[:3] for k in kids[:3]]

    def diag_screenshot():
        """截屏保存 diag_screen.png（PIL.ImageGrab，Windows）"""
        try:
            from PIL import ImageGrab
            img = ImageGrab.grab()
            base_dir = os.path.dirname(os.path.abspath(sys.executable if getattr(sys, "frozen", False) else __file__))
            img.save(os.path.join(base_dir, "diag_screen.png"))
            P("screenshot saved")
        except Exception as e:
            P("screenshot FAIL:", repr(e))

    # 触发扫描（模拟用户点击扫描模型）
    app._mm_scan()
    app.after(6000, check)
    app.after(7000, lambda: diag_screenshot())
    app.after(12000, app.destroy)
    app.mainloop()

    P("model_rows:", state.get("rows"))
    P("display_rows:", state.get("disp"))
    P("tree_items:", state.get("tree"))
    P("tree_h:", state.get("tree_h"), "tree_w:", state.get("tree_w"))
    P("first_bbox:", state.get("first_bbox"))
    P("last_bbox:", state.get("last_bbox"))
    P("filter:", repr(state.get("filter")))
    P("sample rows:", state.get("sample"))
    P("diag errors:", diag_err)
    P("last_poll_error:", (app._last_poll_error or "none")[:800])
    # ---- 同步扫描定位卡点（不走 worker 线程） ----
    import time as _t
    import model_manager
    t0 = _t.monotonic()
    try:
        files = model_manager.scan_models(str(root))
        P("sync scan_models OK: %d files in %.2fs" % (len(files), _t.monotonic() - t0))
    except Exception as e:
        P("sync scan_models FAIL: %r in %.2fs" % (e, _t.monotonic() - t0))
    P("diag done")
    try:
        diag_path = os.path.join(os.path.dirname(os.path.abspath(sys.executable if getattr(sys, "frozen", False) else __file__)), "diag.txt")
        with open(diag_path, "w", encoding="utf-8") as f:
            f.write(out.getvalue())
    except Exception as e:
        with open("diag.txt", "w", encoding="utf-8") as f:
            f.write(out.getvalue())
            f.write("\nwrite err: %s" % e)
    return out.getvalue()


if __name__ == "__main__":
    if "--diag" in sys.argv:
        run_diag()
    else:
        app = gui.CivitaiFreeGUI()
        app.mainloop()
