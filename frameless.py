# -*- coding: utf-8 -*-
"""无边框窗口 + 自绘标题栏（Win32 辅助：最小化/最大化/任务栏）
默认由设置控制；任何异常回退到系统边框。"""
import ctypes
import tkinter as tk

import ui

SW_MINIMIZE = 6
SW_RESTORE = 9
SW_MAXIMIZE = 3

_user32 = None


def _win32():
    global _user32
    if _user32 is None:
        _user32 = ctypes.windll.user32
    return _user32


GA_ROOT = 2
GWL_EXSTYLE = -20
WS_EX_APPWINDOW = 0x00040000
SWP_FRAMECHANGED = 0x0020
SWP_NOMOVE = 0x0002
SWP_NOSIZE = 0x0001
SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010


def top_hwnd(hwnd):
    """Tk 顶层窗口可能是 child HWND，取真正顶层（GA_ROOT）"""
    try:
        return _win32().GetAncestor(hwnd, GA_ROOT)
    except Exception:
        return hwnd


class FramelessTitlebar:
    """自绘标题栏：标题 + 最小化/最大化/关闭按钮；支持拖动、双击最大化"""

    def __init__(self, root, on_close=None):
        self.root = root
        self.on_close = on_close or root.destroy
        self._maximized = False
        self._norm_geom = None
        self.bar = tk.Frame(root, height=36, bg=ui.CURRENT["surface2"])
        self.bar.pack(fill="x")
        self.bar.pack_propagate(False)
        # 拖动区域 + 标题
        self.title_lbl = tk.Label(self.bar, text=root.title(), bg=ui.CURRENT["surface2"],
                                  fg=ui.CURRENT["text_dim"], font=ui.main_font(10),
                                  anchor="w")
        self.title_lbl.pack(side="left", fill="x", expand=True, padx=(14, 4))
        self._make_btn("─", self._minimize)
        self._make_btn("□", self._toggle_maximize)
        self._make_btn("✕", self.on_close, danger=True)
        # 拖动绑定（标题栏 + 自身）
        for w in (self.bar, self.title_lbl):
            w.bind("<Button-1>", self._start_drag)
            w.bind("<B1-Motion>", self._on_drag)
            w.bind("<Double-Button-1>", lambda e: self._toggle_maximize())
        root.bind("<Alt-F4>", lambda e: self.on_close())

    def _make_btn(self, text, cmd, danger=False):
        b = tk.Label(self.bar, text=text, width=3, bg=ui.CURRENT["surface2"],
                     fg=ui.CURRENT["text_dim"], font=ui.main_font(10))
        b.pack(side="right", fill="y")
        b.bind("<Enter>", lambda e, b=b, d=danger: b.configure(
            bg=ui.CURRENT["danger"] if d else ui.CURRENT["hover"],
            fg="#ffffff" if d else ui.CURRENT["text"]))
        b.bind("<Leave>", lambda e, b=b, d=danger: b.configure(
            bg=ui.CURRENT["surface2"],
            fg=ui.CURRENT["text_dim"]))
        b.bind("<Button-1>", lambda e, c=cmd: c())

    # ---- 拖动 ----
    def _start_drag(self, e):
        if self._maximized:
            return
        self._dx, self._dy = e.x_root - self.root.winfo_x(), e.y_root - self.root.winfo_y()

    def _on_drag(self, e):
        if self._maximized:
            return
        try:
            self.root.geometry("+%d+%d" % (e.x_root - self._dx, e.y_root - self._dy))
        except Exception:
            pass

    # ---- 窗口操作 ----
    def _hwnd(self):
        return top_hwnd(self.root.winfo_id())

    def _minimize(self):
        try:
            _win32().ShowWindow(self._hwnd(), SW_MINIMIZE)
        except Exception:
            self.root.iconify()

    def _toggle_maximize(self):
        try:
            hwnd = self._hwnd()
            if self._maximized:
                _win32().ShowWindow(hwnd, SW_RESTORE)
                self._maximized = False
                if self._norm_geom:
                    self.root.geometry(self._norm_geom)
            else:
                self._norm_geom = self.root.geometry()
                # 最大化到工作区
                import ctypes.wintypes
                mi = ctypes.wintypes.MONITORINFO()
                mi.cbSize = ctypes.sizeof(mi)
                monitor = _win32().MonitorFromWindow(hwnd, 2)  # MONITOR_DEFAULTTONEAREST
                if monitor and _win32().GetMonitorInfoW(monitor, ctypes.byref(mi)):
                    r = mi.rcWork
                    self.root.geometry("%dx%d+%d+%d" % (r.right - r.left, r.bottom - r.top,
                                                        r.left, r.top))
                _win32().ShowWindow(hwnd, SW_MAXIMIZE)
                self._maximized = True
        except Exception:
            pass

    def refresh(self):
        """主题/标题变化后刷新配色"""
        self.bar.configure(bg=ui.CURRENT["surface2"])
        self.title_lbl.configure(bg=ui.CURRENT["surface2"], fg=ui.CURRENT["text_dim"],
                                 text=self.root.title())
        for ch in self.bar.winfo_children():
            if isinstance(ch, tk.Label) and ch is not self.title_lbl:
                ch.configure(bg=ui.CURRENT["surface2"], fg=ui.CURRENT["text_dim"])


def enable_frameless(root, on_close=None):
    """启用无边框：overrideredirect + 自绘标题栏 + 任务栏。失败返回 None"""
    try:
        hwnd = top_hwnd(root.winfo_id())
        # 保持出现在任务栏：读旧 ex-style 再合并 WS_EX_APPWINDOW
        u = _win32()
        ex = u.GetWindowLongW(hwnd, GWL_EXSTYLE)
        u.SetWindowLongW(hwnd, GWL_EXSTYLE, ex | WS_EX_APPWINDOW)
        u.SetWindowPos(hwnd, 0, 0, 0, 0, 0,
                       SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE)
        root.overrideredirect(True)
        bar = FramelessTitlebar(root, on_close=on_close)
        return bar
    except Exception:
        try:
            root.overrideredirect(False)
        except Exception:
            pass
        return None
