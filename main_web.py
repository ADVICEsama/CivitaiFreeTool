# -*- coding: utf-8 -*-
"""CivitaiFreeTool Web 版入口（pywebview / Chromium 壳）
用法: python main_web.py  （或打包后 CivitaiFreeToolWeb.exe）"""
import os
import sys
import threading
import time

import posix_compat

_mutex_handle = None  # 单实例互斥体句柄（保持存活至进程结束）


def _app_dir_log():
    """日志/状态目录（%LOCALAPPDATA%\\CivitaiFreeToolWeb）"""
    return os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"),
                        "CivitaiFreeToolWeb")


def _write_app_pid():
    """把真实实例 PID 写给外部看门狗（必须在单实例检查通过后调用）。

    看门狗靠它找到宿主进程：窗口超时未出现就杀这棵树并重启。"""
    try:
        d = _app_dir_log()
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "app_pid.txt"), "w", encoding="utf-8") as f:
            f.write(str(os.getpid()))
    except Exception:
        pass


def _spawn_external_watchdog():
    """拉起独立进程看门狗。

    为什么必须独立进程：卡死点在 pywebview/WebView2 建窗的 .NET 互操作里，GIL 被永久占住，
    进程内所有 Python 线程（含旧版内置看门狗）都会饿死——连日志都写不出来，自愈必然失效。
    独立进程有自己的 GIL 与线程，不碰 .NET，才能真正做到「超时即杀 + 重启」。"""
    try:
        import watchdog_ext
        if watchdog_ext.watchdog_alive():
            _startup_log("external watchdog already running, skip spawn")
            return
        import subprocess
        exe = sys.executable
        if getattr(sys, "frozen", False):
            args = [exe, "--watchdog", "--app-name", os.path.basename(exe)]
        else:
            args = [exe, os.path.abspath(__file__), "--watchdog", "--app-name",
                    os.path.basename(sys.executable)]
        flags = 0
        if posix_compat.IS_WINDOWS:
            flags = (getattr(subprocess, "DETACHED_PROCESS", 0)
                     | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
        # env 必须剥掉 PyInstaller 解包目录变量（_PYI_APPLICATION_HOME_DIR 等）：
        # 不剥的话看门狗会复用宿主的 _MEI 目录 —— 宿主 bootloader 清理失败弹警告框，
        # 且看门狗会把宿主目录钉住不放。
        subprocess.Popen(args, creationflags=flags, close_fds=True, env=watchdog_ext.clean_env(),
                         stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                         stderr=subprocess.DEVNULL)
        _startup_log("external watchdog spawned: %s" % " ".join(args))
    except Exception as e:
        _startup_log("external watchdog spawn failed: %r" % (e,))


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


def _watchdog_log_only():
    """进程内窗口观察者（**只记录，不重启**）。

    重启职责已交给独立进程看门狗（watchdog_ext）：建窗死锁会把 GIL 占死，
    本线程连日志都可能写不出来，留在进程内做重启毫无意义。此处仅用于健康时的里程碑记录。"""
    deadline = time.time() + 30
    while time.time() < deadline:
        time.sleep(2)
        if _self_visible_window():
            _startup_log("in-process observer: window visible, ok")
            return
    _startup_log("in-process observer: window NOT visible after 30s (external watchdog owns recovery)")


def _tray_icon(api, url):
    """浏览器模式：托盘图标（打开界面 / 打开下载文件夹 / 退出软件）"""
    try:
        import pystray
        from PIL import Image
        try:
            img = Image.open(os.path.join(_app_dir(), "web", "favicon.ico"))
        except Exception:
            img = Image.new("RGBA", (64, 64), (40, 44, 52, 255))

        def _open(icon=None, item=None):
            try:
                import webbrowser
                webbrowser.open(url)
            except Exception:
                pass

        def _open_dl(icon=None, item=None):
            try:
                d = (api.cfg.get("download_dir") or "").strip()
                if d and os.path.isdir(d):
                    os.startfile(d)
            except Exception:
                pass

        def _quit(icon=None, item=None):
            _startup_log("browser mode: tray quit")
            try:
                icon.stop()
            except Exception:
                pass
            os._exit(0)

        menu = pystray.Menu(
            pystray.MenuItem("打开界面", _open, default=True),
            pystray.MenuItem("打开下载文件夹", _open_dl),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("退出软件", _quit),
        )
        icon = pystray.Icon("CivitaiFreeTool", img, "CivitaiFreeTool（浏览器模式运行中）", menu)
        threading.Thread(target=icon.run, daemon=True).start()
        _startup_log("browser mode: tray ok")
    except Exception as e:
        _startup_log("browser mode: tray failed %r" % (e,))


def _watch_page_close(api):
    """浏览器模式：开着「关页面后自动退出」时，页面心跳消失且没有下载在跑 → 退出"""
    if not api.cfg.get("exit_when_page_closed", False):
        return
    import browser_bridge   # 本地导入：与窗口模式共享同一套桥服务
    # 时间参数（测试可用环境变量压缩，正式默认：20s 启动宽限 / 8s 静默判定 / 8s 确认）
    grace = float(os.environ.get("CFT_PAGE_CLOSE_GRACE") or 20)
    silence = float(os.environ.get("CFT_PAGE_CLOSE_SILENCE") or 8)
    confirm = float(os.environ.get("CFT_PAGE_CLOSE_CONFIRM") or 8)

    def work():
        time.sleep(grace)      # 启动宽限：浏览器还在打开、首屏还没发请求
        idle_since = 0.0
        while True:
            time.sleep(1)
            if browser_bridge.page_alive(silence):
                idle_since = 0.0
                continue
            # 有任务正在下载就先不退（否则等于关页面掐断下载）
            busy = any(getattr(t, "status", "") == "downloading" for t in api.dl.tasks)
            if busy:
                idle_since = 0.0
                continue
            if idle_since == 0.0:
                idle_since = time.time()
            elif time.time() - idle_since > confirm:
                _startup_log("browser mode: page closed and idle -> exit")
                os._exit(0)

    threading.Thread(target=work, daemon=True).start()


def _browser_mode():
    """浏览器模式（A/C 方案）：后端常驻 + 系统浏览器显示界面。

    与窗口模式的唯一区别是「显示器」：界面文件由本机 127.0.0.1 的桥服务提供，
    前端通过 /api/rpc 调同一套 Api 方法（web/app.js 顶部的 shim）。
    好处：界面卡死/崩溃不拖死下载任务（刷新或重开页面即可），启动也不再解 63MB 包建窗。
    """
    import webbrowser
    import webui
    import browser_bridge
    _startup_log("browser mode: start")
    if not _single_instance():
        try:
            webbrowser.open("http://127.0.0.1:%d/" % browser_bridge.DEFAULT_PORT)
        except Exception:
            pass
        os._exit(0)
    _startup_log("browser mode: single-instance ok")
    _write_app_pid()
    api = webui.Api()
    web_root = os.path.join(_app_dir(), "web")
    browser_bridge.set_api(api, web_root)
    port = browser_bridge.port() or browser_bridge.DEFAULT_PORT
    url = "http://127.0.0.1:%d/" % port
    _startup_log("browser mode: ui at %s" % url)
    if os.environ.get("CFT_NO_BROWSER_OPEN"):
        _startup_log("browser mode: CFT_NO_BROWSER_OPEN set, skip opening browser")
    else:
        try:
            webbrowser.open(url)
        except Exception as e:
            _startup_log("browser mode: open browser failed %r" % (e,))
    if api.cfg.get("tray_icon", True):
        _tray_icon(api, url)
    _watch_page_close(api)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        _startup_log("browser mode: interrupted, exit")


def main():
    # 外部看门狗模式：必须在**任何重量级导入（pywebview/clr/pythonnet）之前**分流，
    # 保证看门狗进程完全不碰 .NET（那些东西正是会把 GIL 弄死的元凶）。
    if "--watchdog" in sys.argv:
        import watchdog_ext
        return watchdog_ext.main([a for a in sys.argv[1:] if a != "--watchdog"])

    # 界面模式路由：设置里选「浏览器」、或命令行 --browser 强制；--window 强制窗口
    try:
        import config
        _cfg = config.load()
    except Exception:
        _cfg = {}
    if ("--browser" in sys.argv) or (_cfg.get("ui_mode") == "browser" and "--window" not in sys.argv):
        return _browser_mode()

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
    # 单实例确认后才写 PID / 拉看门狗：第二实例（秒退）绝不能覆盖 app_pid.txt，
    # 否则看门狗会误判宿主已死。
    _write_app_pid()
    _spawn_external_watchdog()

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
    # 进程内观察者：只记录窗口里程碑（重启已由独立进程看门狗负责——建窗死锁会饿死本线程）
    import threading
    threading.Thread(target=_watchdog_log_only, daemon=True).start()
    webview.start(
        lambda: (time.sleep(0.8), apply_mica(), set_window_icon()),
        debug=False,
        **start_kwargs,
    )
    _startup_log("app exited")


if __name__ == "__main__":
    main()
