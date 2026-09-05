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

_mutex_handle = None  # 单实例互斥体句柄（保持存活至进程结束）


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


def _rm_lock(lock_dir):
    try:
        os.rmdir(lock_dir)
    except Exception:
        pass


def _single_instance():
    """单实例保护：已有实例运行时，激活其主窗口并让新进程退出。
    防止多实例抢占本地桥端口（47531）导致插件连不上。
    返回 True 表示当前进程是唯一实例，可继续启动。"""
    MUTEX_NAME = "Global\\CivitaiFreeToolWeb_SingleInstance"
    global _mutex_handle
    if posix_compat.IS_WINDOWS:
        import ctypes
        from ctypes import wintypes
        u = ctypes.windll.user32
        k = ctypes.windll.kernel32
        # 打开已有互斥体：存在 = 已有实例在运行
        h = k.OpenMutexW(wintypes.DWORD(0x001F0001), False, MUTEX_NAME)  # MUTEX_ALL_ACCESS
        if h:
            # 激活已有实例的主窗口
            try:
                w = u.FindWindowW(None, "CivitaiFreeTool")
                if w:
                    u.ShowWindow(w, 9)  # SW_RESTORE
                    u.SetForegroundWindow(w)
            except Exception:
                pass
            k.CloseHandle(h)
            return False
        # 句柄必须保持存活至进程结束，互斥体才会持续存在
        _mutex_handle = k.CreateMutexW(None, False, MUTEX_NAME)
        return True
    # Linux/macOS：锁文件（fcntl 不可用时用原子目录锁 + PID 过期检测）
    import tempfile
    lock_dir = os.path.join(tempfile.gettempdir(), "civitai_free_tool_web.lock")
    try:
        os.mkdir(lock_dir)
        try:
            with open(os.path.join(lock_dir, "pid"), "w", encoding="utf-8") as f:
                f.write(str(os.getpid()))
        except Exception:
            pass
        # 正常退出时清理锁目录（崩溃残留由 PID 检测接管）
        import atexit
        atexit.register(lambda: _rm_lock(lock_dir))
        return True
    except FileExistsError:
        # 已有锁：检查 PID 是否还活着（残留锁则接管）
        try:
            with open(os.path.join(lock_dir, "pid"), "r", encoding="utf-8") as f:
                old = int(f.read().strip() or "0")
            import subprocess
            if old and subprocess.run(["kill", "-0", str(old)],
                                      stdout=subprocess.DEVNULL,
                                      stderr=subprocess.DEVNULL).returncode != 0:
                try:
                    os.rmdir(lock_dir)
                except Exception:
                    pass
                return True
        except Exception:
            pass
        return False


def main():
    if not _single_instance():
        print("CivitaiFreeTool 已在运行，本次启动自动退出（已激活已有窗口）", file=sys.stderr)
        sys.exit(0)
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
