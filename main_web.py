# -*- coding: utf-8 -*-
"""CivitaiFreeTool Web 版入口（pywebview / Chromium 壳）
用法: python main_web.py  （或打包后 CivitaiFreeToolWeb.exe）"""
import os
import sys
import time

import webview

import posix_compat
import webui

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if getattr(sys, "frozen", False):
    # PyInstaller：web 资源在 _MEIPASS 中
    BASE_DIR = sys._MEIPASS
INDEX = os.path.join(BASE_DIR, "web", "index.html")


def apply_mica():
    """给窗口启用 Win11 Mica 背景（失败静默回退）"""
    try:
        import ctypes
        from ctypes import wintypes
        u = ctypes.windll.user32
        pid = ctypes.windll.kernel32.GetCurrentProcessId()
        found = []

        def cb(h, _):
            p = wintypes.DWORD()
            u.GetWindowThreadProcessId(h, ctypes.byref(p))
            if p.value == pid and u.IsWindowVisible(h):
                found.append(h)
            return True

        WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        u.EnumWindows(WNDENUMPROC(cb), 0)
        if found:
            hwnd = ctypes.c_void_p(found[0])
            # DWMWA_SYSTEMBACKDROP_TYPE=38, DWMSBT_MAINWINDOW=2 (Mica)
            ctypes.windll.dwmapi.DwmSetWindowAttribute(
                hwnd, 38, ctypes.byref(ctypes.c_int(2)), ctypes.sizeof(ctypes.c_int))
    except Exception:
        pass


def _check_qt_backend():
    """非 Windows：pywebview Qt 后端需要 qtpy + QtWebEngine 绑定。
    缺失时提前给出安装指引，而不是让 pywebview 抛裸 traceback。"""
    if posix_compat.IS_WINDOWS:
        return
    try:
        from qtpy import QtWebEngineWidgets  # noqa: F401
    except Exception as e:
        print("=" * 60, file=sys.stderr)
        print("Qt 后端不可用：pywebview gui='qt' 需要 qtpy + QtWebEngine", file=sys.stderr)
        print("当前错误: %r" % (e,), file=sys.stderr)
        print("安装方法（任选其一）:", file=sys.stderr)
        print("  Arch:   sudo pacman -S pyside6 qt6-webengine python-qtpy", file=sys.stderr)
        print("  pip:    pip install PySide6 qtpy   (PySide6 自带 WebEngine)", file=sys.stderr)
        print("  其他发行版: 安装 PySide6/PyQt6 及其 WebEngine 组件 + qtpy", file=sys.stderr)
        print("=" * 60, file=sys.stderr)
        sys.exit(1)


def main():
    api = webui.Api()
    window = webview.create_window(
        "CivitaiFreeTool",
        url=INDEX,
        js_api=api,
        width=1280,
        height=820,
        min_size=(980, 640),
        background_color="#1c1c1e",
    )
    # Linux: force the Qt backend (QWebEngineView + QWebChannel, PySide6/PyQt6
    # bindings via qtpy). Best fit for KDE Plasma; GTK stack not needed.
    # Windows keeps the default EdgeChromium (WebView2) backend.
    start_kwargs = {}
    if not posix_compat.IS_WINDOWS:
        start_kwargs["gui"] = "qt"
        _check_qt_backend()
    webview.start(
        lambda: (time.sleep(0.8), apply_mica(), set_window_icon()),
        debug=False,
        **start_kwargs,
    )


def set_window_icon():
    """设置窗口标题栏图标（WinForms 原生方式，失败静默）"""
    try:
        icon_path = os.path.join(BASE_DIR, "web", "favicon.ico")
        if not os.path.exists(icon_path):
            return
        import clr
        from System.Drawing import Icon
        for w in webview.windows:
            form = getattr(w, "native", None)
            if form is None:
                continue
            f = form.FindForm() if hasattr(form, "FindForm") else form
            if f is not None:
                f.Icon = Icon(icon_path)
    except Exception:
        pass


if __name__ == "__main__":
    main()
