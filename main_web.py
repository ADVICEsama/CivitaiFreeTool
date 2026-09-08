# -*- coding: utf-8 -*-
"""CivitaiFreeTool Web 版入口（pywebview / Chromium 壳）
用法: python main_web.py  （或打包后 CivitaiFreeToolWeb.exe）"""
import os
import sys
import time

import posix_compat

_mutex_handle = None  # 单实例互斥体句柄（保持存活至进程结束）


def _startup_log(msg):
    """启动里程碑日志（%LOCALAPPDATA%\\CivitaiFreeToolWeb\\startup.log）。
    用于定位「有后台无前台」类启动卡死：写出每个启动步骤，卡在哪一目了然。"""
    try:
        d = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"),
                         "CivitaiFreeToolWeb")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "startup.log"), "a", encoding="utf-8") as f:
            f.write("%s [%d] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), os.getpid(), msg))
    except Exception:
        pass


def _app_dir():
    """PyInstaller 打包后 web 资源在 _MEIPASS；源码运行用脚本所在目录"""
    if getattr(sys, "frozen", False):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


def _rm_lock(lock_dir):
    try:
        os.rmdir(lock_dir)
    except Exception:
        pass


def _single_instance():
    """单实例保护：已有实例运行时，激活其主窗口并让新进程退出。

    必须在任何重量级导入（pywebview/pythonnet/WebView2）之前调用：
    若启动中途卡住，后续双击也会先走到这里并直接退出，
    从而彻底杜绝「打开很多后台进程却没有前端窗口」的叠加问题。
    返回 True 表示当前进程是唯一实例，可继续启动。"""
    MUTEX_NAME = "CivitaiFreeToolWeb_SingleInstance"
    global _mutex_handle
    if posix_compat.IS_WINDOWS:
        import ctypes
        from ctypes import wintypes
        u = ctypes.windll.user32
        k = ctypes.windll.kernel32
        # 打开已有互斥体：存在 = 已有实例在运行（Global 优先，回退 Local）
        for scope in ("Global\\", "Local\\"):
            h = k.OpenMutexW(wintypes.DWORD(0x001F0001), False, scope + MUTEX_NAME)  # MUTEX_ALL_ACCESS
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
        for scope in ("Global\\", "Local\\"):
            h = k.CreateMutexW(None, False, scope + MUTEX_NAME)
            if h:
                _mutex_handle = h
                return True
        # 两个命名空间都创建失败时放行（尽力而为，不再阻塞启动）
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


def _webview_storage_path():
    """WebView2 用户数据目录：每次启动用独立目录（%LOCALAPPDATA%\\CivitaiFreeToolWeb\\wv2\\<pid>）。

    为什么不用固定目录：
    - pywebview 默认 private_mode=True，退出时会把数据目录整目录删除——固定目录没有持久化收益；
    - 固定目录会被残留/并发的浏览器进程锁住（WebView2 单例锁），环境初始化直接卡死，
      这正是「有后台无前台」间歇性出现的元凶之一；
    - 按 PID 独立目录彻底消除跨实例/跨会话锁争用，退出由 webview 自动清理。
    顺带清理 7 天前的过期残留目录。失败返回 None → 回退 pywebview 默认（临时目录）。"""
    try:
        base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
        root = os.path.join(base, "CivitaiFreeToolWeb", "wv2")
        os.makedirs(root, exist_ok=True)
        # 清理过期残留（异常退出遗留的目录，正常退出由 pywebview 删除）
        try:
            now = time.time()
            for name in os.listdir(root):
                d = os.path.join(root, name)
                try:
                    if os.path.isdir(d) and now - os.path.getmtime(d) > 7 * 86400:
                        import shutil
                        shutil.rmtree(d, ignore_errors=True)
                except Exception:
                    pass
        except Exception:
            pass
        p = os.path.join(root, "wv2_%d" % os.getpid())
        os.makedirs(p, exist_ok=True)
        if not os.access(p, os.W_OK):
            return None
        return p
    except Exception:
        return None


def _self_visible_window():
    """当前进程是否有可见顶层窗口（ctypes EnumWindows，失败返回 False）"""
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
                return False  # 找到即停
            return True

        WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        u.EnumWindows(WNDENUMPROC(cb), 0)
        return bool(found)
    except Exception:
        return False


def _show_startup_fail_msg():
    """启动失败提示框（原生 MessageBox，双保险：正常应该由自家窗口兜底）"""
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(
            0,
            "CivitaiFreeTool 窗口启动超时（WebView2 初始化卡住）。\n\n"
            "已自动尝试重启一次仍未成功，请按以下步骤处理：\n"
            "1. 任务管理器结束所有 CivitaiFreeToolWeb.exe 和 msedgewebview2.exe\n"
            "2. 关闭正在使用 WebView2 的程序（如游戏串流/搜索类软件）后重试\n"
            "3. 若仍失败，重启电脑后再试\n\n"
            "启动日志：%LOCALAPPDATA%\\CivitaiFreeToolWeb\\startup.log",
            "CivitaiFreeTool 启动失败", 0x10)
    except Exception:
        pass


def _watchdog_startup():
    """启动看门狗：轮询主窗口是否出现。
    - 30 秒内出现 → 正常，退出线程；
    - 超时且未重试过 → 自动重启本程序一次（环境变量防循环）；
    - 已重试仍超时 → 弹窗给出处理指引，继续保持运行等待。"""
    deadline = time.time() + 30
    while time.time() < deadline:
        time.sleep(2)
        if _self_visible_window():
            _startup_log("watchdog: window visible, ok")
            return
    _startup_log("watchdog: window NOT visible after 30s")
    if os.environ.get("CFT_STARTUP_RETRY") != "1":
        _startup_log("watchdog: auto-restart once")
        try:
            import subprocess
            env = dict(os.environ)
            env["CFT_STARTUP_RETRY"] = "1"
            subprocess.Popen([sys.executable] + sys.argv, env=env)
            time.sleep(2)
            os._exit(0)  # 立即让出互斥体，让新进程成为唯一实例
        except Exception:
            _show_startup_fail_msg()
    else:
        _startup_log("watchdog: retry failed, showing guidance")
        _show_startup_fail_msg()


def main():
    _startup_log("start: begin")
    if not _single_instance():
        print("CivitaiFreeTool 已在运行，本次启动自动退出（已激活已有窗口）", file=sys.stderr)
        try:
            sys.stdout.flush()
            sys.stderr.flush()
        except Exception:
            pass
        # os._exit：跳过 Python 完整收尾（pythonnet/CLR 卸载等），让第二实例瞬间消失，
        # 避免 bootloader 父进程长时间残留造成「很多后台进程」的观感。
        # 此处无任何需要清理的状态（互斥体句柄由系统在进程退出时释放）。
        os._exit(0)
    _startup_log("single-instance ok")

    import webview
    import webui
    _startup_log("imports ok")

    BASE_DIR = _app_dir()
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

    def _check_qt_backend():
        """非 Windows：pywebview Qt 后端需要 qtpy + QtWebEngine 绑定。
        缺失时提前给出安装指引，而不是让 pywebview 抛裸 traceback。"""
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

    api = webui.Api()
    _startup_log("Api() ok")
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
    else:
        # 降低 WebView2 (Chromium) 在本机偶发初始化卡死概率：
        # 禁用 GPU 进程（虚拟显示适配器/显卡驱动异常时 Chrome_WidgetWin 初始化会挂）；
        # 本应用 UI 为本地页面，软件渲染无感。
        try:
            extra = os.environ.get("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "").strip()
            if "--disable-gpu" not in extra:
                os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = (extra + " --disable-gpu").strip()
        except Exception:
            pass
        sp = _webview_storage_path()
        if sp:
            start_kwargs["storage_path"] = sp
    _startup_log("create_window ok, storage=%s" % (start_kwargs.get("storage_path") or "default"))
    # 启动看门狗：30 秒无可见窗口 → 自动重启一次 → 仍失败弹窗指引
    import threading
    threading.Thread(target=_watchdog_startup, daemon=True).start()
    webview.start(
        lambda: (time.sleep(0.8), apply_mica(), set_window_icon()),
        debug=False,
        **start_kwargs,
    )
    _startup_log("app exited")


if __name__ == "__main__":
    main()
