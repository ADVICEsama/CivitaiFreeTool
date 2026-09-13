# -*- coding: utf-8 -*-
"""CivitaiFreeTool 外部启动看门狗（独立进程，纯 stdlib + ctypes，绝不导入 pywebview/clr）

为什么必须独立进程
------------------
「有后台无前台」的死锁发生在 pywebview 6.2.1 的 WinForms 建窗阶段
（winforms.create_window 主线程 Join 循环 → STA 线程卡在 edgechromium.EnsureCoreWebView2Async）。
卡住时 pythonnet/CLR 的 .NET 互操作把 GIL 永久占住，进程内**所有** Python 线程都会饿死——
包括旧版内置看门狗：它连「超时」日志都写不出来，自动重启自然也不会发生（已用 py-spy 转储证实）。
只有另一个进程（自己的 GIL、自己的线程、不碰 .NET）才能真正做到「超时即杀 + 重启」。

职责
----
1. 轮询宿主应用（app_pid.txt 里的 PID）是否在 grace 秒内出现**可见顶层窗口**；
2. 超时 → 杀掉该 PID 的整棵进程树（含 WebView2 子进程，逐个 PID 精确杀，绝不用 /T
   以免把自己一起带走）→ 重新拉起应用；
3. 再超时 → 重启 + 弹原生提示框给出处理指引；
4. 之后保持监控不再自动重启（避免重启风暴），窗口一旦出现即恢复健康态；
5. 应用正常退出（窗口出现过、进程消失）→ 看门狗自行退出，不留残留。

与主程序约定
------------
- 主程序启动早期写 ``%LOCALAPPDATA%\\CivitaiFreeToolWeb\\app_pid.txt``（真实实例 PID）；
- 主程序是否再拉看门狗，由 ``watchdog_alive()`` 判断（本文件里的 owner 文件）；
- 看门狗用 ``--watchdog`` 参数启动：主程序在**任何重量级导入之前**识别该参数并直接调用 ``run()``。
"""
import ctypes
import json
import os
import subprocess
import sys
import tempfile
import time
from ctypes import wintypes

IS_WINDOWS = sys.platform.startswith("win")

GRACE_DEFAULT = 12  # 秒：**默认等窗口 12 秒**，没出来就直接换浏览器模式（用户要求：宁可快点看到界面）
                    # 可在设置里改「窗口模式等待秒数」（config.window_wait_seconds）
# 实测（2026-09-13 多轮日志）：本机冷启动出窗口 6.0s / 8.0s / 10s+ 都有过
# （一个 66MB onefile 解包 + 杀软扫描 + WebView2 初始化），判定太短会把正常启动误杀
# （日志实锤：no window after 6s/10s -> kill 掉的其实是正在启动的实例）。
# 策略：20 秒起步 + 只要有进展信号（启动日志或 _MEI 解包目录在变）就继续宽限（最多 6 次），
# 真正的卡死不会有任何进展信号，很快会被杀。
PROGRESS_GRACE = 5  # 秒：启动日志在这个时间内更新过 = 有进展 → 宽限 MAX_EXTENDS 次
MAX_EXTENDS = 8     # 有活动最多宽限 8 次（每次 PROGRESS_GRACE 秒，共 +40s）——本机实测：
                    # 解包 ~15s + WebView2 初始化 15~30s，全程没有日志但进程树一直有 CPU/IO 活动；
                    # 真卡死时进程树彻底静止，宽限不会触发，仍按 GRACE 秒杀掉。
RETRY_GRACE = 15    # 秒：窗口模式重试给的时间（重试仍要重新解包 + 建 WebView2，不能太短）

# --------------------------------------------------------------------------
# 路径 / 日志
# --------------------------------------------------------------------------


def _app_dir():
    d = os.environ.get("CFT_WD_DIR")
    if d:
        return d
    base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Local")
    return os.path.join(base, "CivitaiFreeToolWeb")


def _ensure_dir(path):
    try:
        os.makedirs(path, exist_ok=True)
    except Exception:
        pass
    return path


def _log(msg):
    try:
        d = _ensure_dir(_app_dir())
        with open(os.path.join(d, "watchdog.log"), "a", encoding="utf-8") as f:
            f.write("%s [%d] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), os.getpid(), msg))
    except Exception:
        pass


def _pid_file():
    return os.path.join(_app_dir(), "app_pid.txt")


def startup_log_path():
    """主程序的启动日志（用来判断「还在正常启动」还是「卡死」）"""
    return os.path.join(_app_dir(), "startup.log")


# PyInstaller（onefile）用这些环境变量把「解包目录」传给子进程。
# 冻结程序里它们指向本进程自己的 _MEI 目录；若原样传给新拉起的进程，
# 新进程会**复用那个目录**而不是重新解包：
#   - 看门狗会一直占着宿主的解包目录 → 宿主 bootloader 清理失败，弹
#     「Failed to remove temporary directory」警告框；
#   - 重启的实例以为自己还是老 _MEI → 启动即崩（实测：Tcl data directory ... not found）。
# 所以拉起任何新实例前必须剥掉。
_PYI_ENV_KEYS = ("_MEIPASS", "_MEIPASS2", "_PYI_APPLICATION_HOME_DIR",
                 "_PYI_ARCHIVE_FILE", "_PYI_PARENT_PROCESS_LEVEL", "_PYI_SPLASH_IPC")


def clean_env():
    """去掉 PyInstaller 解包目录相关的环境变量，返回可直接传给新进程的 env 副本"""
    env = dict(os.environ)
    for k in _PYI_ENV_KEYS:
        env.pop(k, None)
    return env


def _owner_file():
    return os.path.join(_app_dir(), "watchdog_owner.json")


def read_app_pid():
    """读取主程序写入的 PID（无则返回 None）"""
    try:
        with open(_pid_file(), "r", encoding="utf-8") as f:
            return int((f.read() or "").strip() or "0") or None
    except Exception:
        return None


def _write_owner(pid, started=None):
    """写看门狗归属文件（带心跳时间戳）。

    心跳的用处：`watchdog_alive()` 只靠 PID 判断会被 Windows 的 PID 复用骗到
    （实测：被杀的看门狗 PID 被系统回收给了别的进程 → 新实例误判「看门狗已在跑」
    → 跳过拉狗 → 那个实例卡死后没人救）。所以要求心跳新鲜才算活着。"""
    try:
        _ensure_dir(_app_dir())
        with open(_owner_file(), "w", encoding="utf-8") as f:
            json.dump({"pid": pid, "started": started or time.time(), "beat": time.time()}, f)
    except Exception:
        pass


def _read_owner():
    try:
        with open(_owner_file(), "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def watchdog_alive(max_age=25.0):
    """主程序用：是否已有活着的看门狗（有则不必再拉）。

    要求 PID 存活 **且** 心跳新鲜（看门狗每 2 秒刷新一次），避免 PID 复用误判。"""
    o = _read_owner()
    try:
        pid = int(o.get("pid") or 0)
        beat = float(o.get("beat") or 0)
    except Exception:
        return False
    return bool(pid and pid != os.getpid() and pid_alive(pid)
                and (time.time() - beat) < max_age)


# --------------------------------------------------------------------------
# Windows 进程 / 窗口探测（ctypes，无第三方依赖）
# --------------------------------------------------------------------------
if IS_WINDOWS:
    _u32 = ctypes.windll.user32
    _k32 = ctypes.windll.kernel32
    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    STILL_ACTIVE = 259
    TH32CS_SNAPPROCESS = 0x00000002

    class PROCESSENTRY32(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.POINTER(ctypes.c_ulong)),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", ctypes.c_long),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", ctypes.c_char * 260),
        ]

    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)


def pid_alive(pid):
    """进程是否存活（且不是我们自己的 PID 复用）"""
    if not pid:
        return False
    if not IS_WINDOWS:
        try:
            os.kill(pid, 0)
            return True
        except Exception:
            return False
    h = _k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
    if not h:
        return False
    try:
        code = wintypes.DWORD()
        if not _k32.GetExitCodeProcess(h, ctypes.byref(code)):
            return False
        return code.value == STILL_ACTIVE
    finally:
        _k32.CloseHandle(h)


def _proc_name(pid):
    """进程可执行文件名（小写）"""
    if not IS_WINDOWS:
        return ""
    h = _k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
    if not h:
        return ""
    try:
        buf = ctypes.create_unicode_buffer(1024)
        size = wintypes.DWORD(len(buf))
        if _k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
            return os.path.basename(buf.value).lower()
        return ""
    finally:
        _k32.CloseHandle(h)


def _all_processes():
    """返回 {pid: parent_pid} 快照（Toolhelp32）"""
    snap = {}
    if not IS_WINDOWS:
        return snap
    h = _k32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
    if h == -1 or not h:
        return snap
    try:
        e = PROCESSENTRY32()
        e.dwSize = ctypes.sizeof(PROCESSENTRY32)
        if _k32.Process32First(h, ctypes.byref(e)):
            while True:
                snap[int(e.th32ProcessID)] = int(e.th32ParentProcessID)
                if not _k32.Process32Next(h, ctypes.byref(e)):
                    break
    except Exception:
        pass
    finally:
        _k32.CloseHandle(h)
    return snap


def _descendants(root_pid, exclude=()):
    """root_pid 的整棵子孙 PID 列表（不含 root 本身），按深度从叶到根排序"""
    snap = _all_processes()
    children = {}
    for pid, ppid in snap.items():
        children.setdefault(ppid, []).append(pid)
    out, stack, depth = [], list(children.get(root_pid, [])), {}
    frontier = [(c, 1) for c in children.get(root_pid, [])]
    while frontier:
        pid, d = frontier.pop()
        out.append(pid)
        depth[pid] = d
        for c in children.get(pid, []):
            frontier.append((c, d + 1))
    out = [p for p in out if p not in exclude]
    out.sort(key=lambda p: depth.get(p, 0), reverse=True)
    return out


def has_visible_window(pids):
    """给定 PID 集合中是否存在可见顶层窗口（要求窗口有标题，排除隐藏壳窗口）"""
    if not IS_WINDOWS or not pids:
        return False
    pids = set(int(p) for p in pids)
    found = []

    def cb(hwnd, _):
        pid = wintypes.DWORD()
        _u32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value in pids and _u32.IsWindowVisible(hwnd):
            n = _u32.GetWindowTextLengthW(hwnd)
            if n > 0:
                found.append(hwnd)
                return False
        return True

    _u32.EnumWindows(WNDENUMPROC(cb), 0)
    return bool(found)


def _no_window_flags():
    return getattr(subprocess, "CREATE_NO_WINDOW", 0)


def kill_pid(pid):
    try:
        subprocess.run(["taskkill", "/F", "/PID", str(int(pid))],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       creationflags=_no_window_flags())
        return True
    except Exception as e:
        _log("taskkill %s failed: %r" % (pid, e))
        return False


def kill_app_tree(app_pid, exclude=()):
    """杀掉应用进程树：先把子孙（WebView2 等）逐 PID 杀掉，最后杀主进程。

    逐个 PID 杀而不是 /T：看门狗自己是应用 PID 的子进程，/T 会把看门狗一起带走。
    """
    victims = _descendants(app_pid, exclude=set(exclude) | {os.getpid()})
    for pid in victims:
        kill_pid(pid)
    kill_pid(app_pid)
    _log("killed tree of %s (%d descendants, excluded %s)" % (app_pid, len(victims), list(exclude)))


_ORPHAN_PS = ("Get-CimInstance Win32_Process -Filter \"Name='msedgewebview2.exe'\" | "
              "Where-Object { $_.CommandLine -like '*CivitaiFreeToolWeb\\wv2*' } | "
              "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; "
              "$_.ProcessId }")


def kill_orphan_webview2():
    """清掉属于本工具的孤儿 msedgewebview2（卡死实例的残留子进程）。

    它们的命令行 user-data-dir 里带 CivitaiFreeToolWeb\\wv2，所以绝不会误杀其它 WebView2 应用。
    残留在卡死实例被强杀后会出现（父进程没了、浏览器进程还活着），会占着存储目录与显卡资源。"""
    if not IS_WINDOWS:
        return 0
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-Command", _ORPHAN_PS],
                           capture_output=True, text=True, timeout=40,
                           creationflags=_no_window_flags())
        pids = [p for p in (r.stdout or "").split() if p.strip().isdigit()]
        if pids:
            _log("killed %d orphan webview2: %s" % (len(pids), ",".join(pids[:8])))
        return len(pids)
    except Exception as e:
        _log("orphan webview2 cleanup failed: %r" % (e,))
        return 0


def _message(title, text):
    if os.environ.get("CFT_WD_NO_MSGBOX") == "1":
        _log("msgbox suppressed: %s" % text.replace("\n", " / "))
        return
    try:
        ctypes.windll.user32.MessageBoxW(0, text, title, 0x30)
    except Exception:
        pass


# --------------------------------------------------------------------------
# 主循环
# --------------------------------------------------------------------------


def _relaunch(app_name, browser=False):
    """重新拉起应用（与自身同 exe；源码模式下用 python + 脚本）

    browser=True：以浏览器模式重启（窗口两次起不来时的兜底：界面改用系统浏览器打开，
    后端照常运行，不再依赖 WebView2 建窗）。
    """
    # 先清掉属于本工具的孤儿 WebView2（卡死实例残留，占着存储目录/显卡资源，会拖累新实例启动）
    kill_orphan_webview2()
    override = os.environ.get("CFT_WD_APP_CMD")
    if override:
        cmd = json.loads(override)
    else:
        cmd = [sys.executable]
        if not getattr(sys, "frozen", False):
            cmd.append(os.path.abspath(sys.argv[0]))
    if browser and "--browser" not in cmd:
        cmd.append("--browser")
    # 关键：剥掉 PyInstaller 解包目录环境变量，否则新实例会复用旧 _MEI 直接崩溃
    env = clean_env()
    flags = 0
    if IS_WINDOWS:
        flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    try:
        p = subprocess.Popen(cmd, env=env, creationflags=flags, close_fds=True,
                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        _log("relaunched: %s (pid %s)" % (" ".join(cmd), p.pid))
        return True
    except Exception as e:
        _log("relaunch failed: %r" % (e,))
        return False


def _app_progressing(within=PROGRESS_GRACE):
    """应用仍在正常启动（不是卡死）？看两个"轻"信号：启动日志、_MEI 解包目录。

    注意：WebView2 初始化阶段（实测 15~30s）这两者都是静的，主要靠 _tree_active 的重信号。
    """
    now = time.time()
    try:
        if (now - os.path.getmtime(startup_log_path())) < within:
            return True
    except Exception:
        pass
    try:
        tmp = tempfile.gettempdir()
        best = 0.0
        for name in os.listdir(tmp):
            if not name.startswith("_MEI"):
                continue
            try:
                best = max(best, os.path.getmtime(os.path.join(tmp, name)))
            except Exception:
                pass
        if best and (now - best) < within:
            return True
    except Exception:
        pass
    return False


class _IO_COUNTERS(ctypes.Structure):
    _fields_ = [("ReadOperationCount", ctypes.c_ulonglong), ("WriteOperationCount", ctypes.c_ulonglong),
                ("OtherOperationCount", ctypes.c_ulonglong), ("ReadTransferCount", ctypes.c_ulonglong),
                ("WriteTransferCount", ctypes.c_ulonglong), ("OtherTransferCount", ctypes.c_ulonglong)]


def _proc_activity(pid):
    """单个进程的 (CPU 秒, I/O 字节) 或 None（无权限/已退出）"""
    try:
        h = ctypes.windll.kernel32.OpenProcess(0x1000, False, int(pid))   # QUERY_LIMITED_INFORMATION
        if not h:
            return None
        try:
            c, e, k, u = (wintypes.FILETIME(), wintypes.FILETIME(), wintypes.FILETIME(), wintypes.FILETIME())
            if not ctypes.windll.kernel32.GetProcessTimes(h, ctypes.byref(c), ctypes.byref(e),
                                                          ctypes.byref(k), ctypes.byref(u)):
                return None
            ft = lambda f: (f.dwHighDateTime << 32) | f.dwLowDateTime     # noqa: E731
            cpu = (ft(k) + ft(u)) / 1e7
            io = 0.0
            ctr = _IO_COUNTERS()
            if ctypes.windll.kernel32.GetProcessIoCounters(h, ctypes.byref(ctr)):
                io = float(ctr.ReadTransferCount + ctr.WriteTransferCount + ctr.OtherTransferCount)
            return (cpu, io)
        finally:
            ctypes.windll.kernel32.CloseHandle(h)
    except Exception:
        return None


_LAST_TREE = {"v": None}


def _tree_active(pids, min_cpu=0.05, min_io=65536):
    """整棵进程树还在动吗？

    这是"真卡死 vs 慢启动"的关键判据：真正的死锁（GIL 被 WebView2 初始化攥死）时，
    进程树 CPU 与 I/O 完全不再增长；而慢启动（解包、杀软扫描、WebView2 起子进程）总有活动。
    阈值取得很小 —— 只用来区分"完全静止"。
    注意：进程集合一变（重启/新子进程出现）就重采基线，否则新旧树的累计值不可比
    （曾导致 stage-1 重试阶段永远判为"无活动"，16 秒就被杀）。
    """
    keys = tuple(sorted(int(p) for p in set(pids)))
    cpu = io = 0.0
    seen = 0
    for p in keys:
        a = _proc_activity(p)
        if a:
            cpu += a[0]
            io += a[1]
            seen += 1
    if not seen:
        return False
    if _LAST_TREE.get("pids") != keys:
        _LAST_TREE["pids"] = keys
        _LAST_TREE["v"] = (cpu, io)
        return True                      # 树变了：重采基线，这一轮乐观处理
    prev = _LAST_TREE.get("v")
    _LAST_TREE["v"] = (cpu, io)
    if not prev:
        return True
    return (cpu - prev[0]) >= min_cpu or (io - prev[1]) >= min_io


def _app_health(timeout=2.0):
    """探 /api/health —— 应用启动完成后才会响应（GIL 被卡死时连它都不出）。

    返回 dict 或 None。界面判定优先用它（比 Win32 探窗口准：窗口刚建好但还没"可见"时会漏判）。
    """
    try:
        import urllib.request
        port = 47531
        try:
            import browser_bridge
            port = getattr(browser_bridge, "DEFAULT_PORT", port) or port
        except Exception:
            pass
        with urllib.request.urlopen("http://127.0.0.1:%d/api/health" % port, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        return None


def _ui_ready():
    """应用自己报告「界面已就绪」？（窗口已可见，或浏览器模式下后端常驻）

    旧版本（health 里没有 window 字段）只要能应答就认为是活的。
    """
    h = _app_health()
    if not (h and h.get("ok")):
        return False
    return bool(h.get("mode") == "browser" or h.get("window") or ("window" not in h))


def _cfg_window_wait():
    """从应用配置读「窗口模式等待秒数」（设置里的 window_wait_seconds；3~600 之外视为未设置）"""
    try:
        import config
        v = int(config.load().get("window_wait_seconds") or 0)
        return v if 3 <= v <= 600 else 0
    except Exception:
        return 0


def run(grace=None, exe_name=None):
    """看门狗主循环。grace 秒内没窗口就杀掉换浏览器模式（用户要求：宁可快点看到界面）。"""
    try:
        grace = int(grace or os.environ.get("CFT_WD_GRACE") or _cfg_window_wait() or GRACE_DEFAULT)
    except Exception:
        grace = GRACE_DEFAULT
    own = os.getpid()
    started = time.time()
    app_name = (exe_name or (os.path.basename(sys.executable) if getattr(sys, "frozen", False) else "python.exe")).lower()
    _write_owner(own, started)
    _log("watchdog start (grace=%ss, app_name=%s, exe=%s)" % (grace, app_name, sys.executable))

    healthy = False
    stage = 0
    msg_shown = False
    browser_fallback = False     # 切了浏览器模式后不再要求窗口
    progresses = 0               # 启动日志「还在推进」的宽限次数
    deadline = time.time() + grace
    relaunch_until = 0.0

    while True:
        time.sleep(2)

        # 交班：已有更新的看门狗接管 → 退出，避免多只狗并存
        o = _read_owner()
        try:
            other = int(o.get("pid") or 0)
            other_started = float(o.get("started") or 0)
        except Exception:
            other, other_started = 0, 0
        if other and other != own and other_started > started and pid_alive(other):
            _log("newer watchdog %s took over, exiting" % other)
            return
        # 心跳：让主程序判断「看门狗是否真活着」时不受 PID 复用影响。
        # 必须在交班检查之后写：否则会把新看门狗的归属条目覆盖回自己，交班判断失效。
        _write_owner(own, started)

        pid = read_app_pid()
        if pid and pid != own and pid_alive(pid):
            # PID 复用防护：名字必须对得上
            nm = _proc_name(pid)
            if nm and nm != app_name and not nm.startswith(app_name.split(".")[0].lower()):
                _log("pid %s is %s (not our app), ignore" % (pid, nm))

            if browser_fallback:
                # 已切浏览器模式：没有窗口是正常的，只确认后端还活着
                if not healthy:
                    _log("browser fallback: backend alive (pid %s)" % pid)
                    healthy = True
                continue

            if has_visible_window([pid]) or has_visible_window(_descendants(pid)) or _ui_ready():
                if not healthy:
                    _log("window visible, healthy (took %.1fs)" % (time.time() - started))
                healthy, stage, msg_shown, progresses = True, 0, False, 0
                deadline = time.time() + grace
                continue

            if healthy:
                _log("window lost, re-arming watchdog")
                healthy = False
                deadline = time.time() + grace
                continue

            if time.time() < deadline:
                continue

            # 宽限保护：**只对浏览器模式那一轮**生效（stage>0）。
            # 窗口模式（stage 0）是硬时限：等满 grace 秒没窗口就直接换浏览器（用户明确要求，
            # 不再因为"进程树还在动"而拖到一分多钟）。真卡死时浏览器那一轮也不会有活动，照常被杀。
            tree = [pid] + _descendants(pid)
            if stage > 0 and progresses < MAX_EXTENDS and (_app_progressing() or _tree_active(tree)):
                progresses += 1
                deadline = time.time() + PROGRESS_GRACE
                _log("still starting (activity detected), extend deadline #%d/%d" % (progresses, MAX_EXTENDS))
                continue

            # 超时无窗口 = 卡死（或 WebView2 起不来）
            elapsed = int(time.time() - started)
            if stage == 0:
                # 用户要求：窗口等不到就**直接**换浏览器模式（不再二次尝试窗口），尽快让界面可用
                _log("stage0: no window after %ss (pid %s) -> kill tree + relaunch in BROWSER mode" % (elapsed, pid))
                kill_app_tree(pid)
                time.sleep(1.0)
                _relaunch(app_name, browser=True)
                _message("CivitaiFreeTool：窗口没出来，已切到浏览器模式",
                         "等了 %s 秒没等到窗口（常见原因：WebView2 运行时正在自动更新，或系统忙）。\n\n"
                         "已改用「浏览器模式」：软件在后台照常运行（下载不受影响），界面在系统浏览器里打开。\n"
                         "任务栏托盘图标可随时打开界面 / 退出软件。\n\n"
                         "想调长等待：设置 → 界面 → 「窗口模式等待秒数」\n"
                         "想固定用浏览器模式：设置 → 界面 → 「界面模式」。" % elapsed)
                stage, healthy = 1, False
                progresses = 0
                relaunch_until = time.time() + 300
                # 浏览器模式自己也有一段启动时间（单文件解包 + 起后端），给宽一点，避免刚起来就被杀
                deadline = time.time() + max(40, grace * 2)
                started = time.time()
            elif stage == 1:
                _log("stage1: still no window (%ss) -> kill tree + relaunch in BROWSER mode" % elapsed)
                kill_app_tree(pid)
                time.sleep(1.0)
                _relaunch(app_name, browser=True)
                _message("CivitaiFreeTool 窗口启动失败，已切换浏览器模式",
                         "窗口连续两次启动超时（WebView2 初始化卡住）。\n\n"
                         "已自动改用「浏览器模式」重启：软件在后台照常运行（下载不受影响），"
                         "界面稍后会在系统浏览器里打开。\n\n"
                         "任务栏托盘图标可随时打开界面或退出软件；\n"
                         "想切回窗口模式：设置 → 界面 → 界面模式。\n\n"
                         "日志：%LOCALAPPDATA%\\CivitaiFreeToolWeb\\（startup.log / watchdog.log）")
                stage, healthy, msg_shown = 2, False, True
                browser_fallback = True
                progresses = 0
                relaunch_until = time.time() + 120
                deadline = time.time() + 120
                started = time.time()
            else:
                if not msg_shown:
                    _message("CivitaiFreeTool 启动失败",
                             "多次自动重启后窗口仍未出现，已停止自动重启。\n\n"
                             "请结束所有 CivitaiFreeToolWeb.exe / msedgewebview2.exe 后重启电脑再试。\n"
                             "日志：%LOCALAPPDATA%\\CivitaiFreeToolWeb\\")
                    msg_shown = True
                deadline = time.time() + 120
        else:
            # 没有存活的应用进程
            if healthy:
                _log("app exited normally, watchdog exit")
                return
            if time.time() < relaunch_until:
                continue  # 重启中的空档（PyInstaller 解包 + 子进程拉起）
            if time.time() - started > grace:
                _log("app never appeared (or exited), watchdog exit")
                return


def main(argv=None):
    """供 --watchdog 入口调用：解析自身参数后进入主循环"""
    argv = list(sys.argv[1:] if argv is None else argv)
    grace, exe_name = None, None
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--grace" and i + 1 < len(argv):
            grace = argv[i + 1]
            i += 2
            continue
        if a == "--app-name" and i + 1 < len(argv):
            exe_name = argv[i + 1]
            i += 2
            continue
        i += 1
    run(grace=grace, exe_name=exe_name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
