"""A separate, non-activating view of the existing download queue. No downloader of its own."""
import math
import os
import sys
import threading
from config import normalize_theme


THEMES = ('dark_endfield', 'light_endfield')


def number(value):
    try:
        value = float(value)
        return max(0, value) if math.isfinite(value) else 0
    except (ValueError, TypeError):
        return 0


def snapshot(rows, cfg):
    # Whitelist data: never pass URLs, credentials, destinations or metadata to the HUD.
    tasks = [{k: r.get(k) for k in ('id', 'filename', 'status', 'downloaded', 'total', 'speed')}
             for r in rows if r.get('status') != 'canceled']
    total = sum(number(r['total']) for r in tasks)
    received = sum(min(number(r['downloaded']), number(r['total'])) for r in tasks if number(r['total']))
    unknown = any(not number(r['total']) and r['status'] != 'done' for r in tasks)
    done = bool(tasks) and all(r['status'] == 'done' for r in tasks)
    progress = 100 if done else min(99.9, received / total * 100) if total else 0
    theme = cfg.get('download_hud_theme', 'follow')
    if theme == 'follow':
        theme = cfg.get('theme')
        if theme is None and cfg.get('dark_mode') is False:
            theme = 'light_endfield'
    theme = normalize_theme(theme, cfg.get('ui_scheme', 'light'))
    return dict(tasks=tasks, total=total, received=received, progress=progress, unknown=unknown,
                done=done, speed=sum(number(r['speed']) for r in tasks if r['status'] == 'downloading'),
                active=sum(r['status'] == 'downloading' for r in tasks),
                waiting=sum(r['status'] == 'pending' for r in tasks),
                failed=sum(r['status'] == 'error' for r in tasks), theme=theme,
                motion=cfg.get('download_hud_motion', True), enabled=cfg.get('download_hud_enabled', False))


class HudBridge:
    def __init__(self, controller):
        self._controller = controller

    def snapshot(self):
        c = self._controller
        return dict(snapshot(c.api.get_tasks(), c.api.cfg), folded=c.folded)

    def dock(self, folded):
        c = self._controller
        folded = bool(folded) and bool(c.dock_side) and not c.expanded and c.api.cfg.get('download_hud_dock', True)
        if folded != c.folded:
            old_width = c.width
            x, y = c.window.x, c.window.y
            c.folded = folded
            c.resize()
            c.window.move(x + old_width - c.width if c.dock_side == 'right' else x, y)
        return c.folded

    def position(self):
        c = self._controller
        return {'x': c.window.x, 'y': c.window.y}

    def action(self, action, task_id=None):
        if action not in ('pause', 'start', 'pause_all'):
            return False
        if action != 'pause_all' and (not isinstance(task_id, str) or not task_id.strip()):
            return False
        return self._controller.api.dl_action(action, task_ids=[task_id] if task_id else [])

    def hide(self):
        self._controller.hide()
        return True

    def expand(self, expanded):
        c = self._controller
        c.expanded = bool(expanded)
        c.folded = False
        c.resize()
        return True

    def open_manager(self):
        c = self._controller
        c.main.show()
        c.main.restore()
        c.main.evaluate_js("document.querySelector('.nav-tab[data-page=\"dlmanager\"]')?.click()")
        return True

    def move(self, x, y, commit=True):
        c = self._controller
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (x, y)):
            return False
        c.position(int(x), int(y), save=commit is True)
        return True


class DownloadHud:
    def __init__(self, api, main, root):
        self.api, self.main, self.root = api, main, root
        self.window = None
        self.expanded = False
        self.folded = False
        self.dock_side = None
        self._lock = threading.Lock()
        self.closed = False
        self._hide_timer = None
        self._hidden_requested = False

    def resize(self):
        cfg = self.api.cfg
        scale = max(.75, min(1.5, number(cfg.get('download_hud_scale', 100))/100))
        self.width = round((60 if self.folded else 440)*scale)
        self.height = round((300 if self.expanded else 54)*scale)
        self.window.resize(self.width, self.height)
        self.decorate()
        self.window.evaluate_js("document.documentElement.style.zoom="+str(scale)+";document.body.dataset.folded="+str(self.folded).lower())

    def decorate(self):
        """Round the actual native region, not a painted rectangle with black corners."""
        from System import Action
        def apply():
            import ctypes
            from System.Drawing import Region
            from System.Drawing import ColorTranslator
            from System.Drawing.Drawing2D import GraphicsPath
            form = self.window.native
            form.ShowInTaskbar = False
            path = GraphicsPath()
            diameter = min(52, form.ClientSize.Height)
            w, h = form.ClientSize.Width, form.ClientSize.Height
            if w < diameter or h < diameter: return
            for x, y, angle in ((0,0,180),(w-diameter,0,270),(w-diameter,h-diameter,0),(0,h-diameter,90)):
                path.AddArc(x,y,diameter,diameter,angle,90)
            path.CloseFigure()
            old = form.Region
            form.Region = Region(path)
            path.Dispose()
            if old is not None: old.Dispose()
            # Endfield uses its own opaque panel, never the retired glass material.
            light = snapshot([], self.api.cfg)['theme'].startswith('light')
            bg = '#f0f1ec' if light else '#292b2d'
            hwnd = ctypes.c_void_p(form.Handle.ToInt64())
            dwm = ctypes.windll.dwmapi
            backdrop = ctypes.c_int(1)
            dark = ctypes.c_int(0 if light else 1)
            dwm.DwmSetWindowAttribute(hwnd, 20, ctypes.byref(dark), 4)
            dwm.DwmSetWindowAttribute(hwnd, 38, ctypes.byref(backdrop), 4)
            class Margins(ctypes.Structure):
                _fields_ = [('l',ctypes.c_int),('r',ctypes.c_int),('t',ctypes.c_int),('b',ctypes.c_int)]
            margins = Margins(0, 0, 0, 0)
            dwm.DwmExtendFrameIntoClientArea(hwnd,ctypes.byref(margins))
            form.BackColor = ColorTranslator.FromHtml(bg)
            form.browser.webview.DefaultBackgroundColor = ColorTranslator.FromHtml(bg)
            self.material = False
        if self.window.native is not None:
            self.window.native.Invoke(Action(apply))
            self.window.evaluate_js("document.body.dataset.material=" + ('true' if self.material else 'false'))

    def position(self, x=None, y=None, save=False):
        # Clamp to the closest display working area; never strand HUD after monitor removal.
        from System.Windows.Forms import Screen
        from System.Drawing import Point
        cfg = self.api.cfg
        x = int(cfg.get('download_hud_x', 40)) if x is None else x
        y = int(cfg.get('download_hud_y', 40)) if y is None else y
        area = Screen.FromPoint(Point(x, y)).WorkingArea
        x = max(area.Left, min(x, area.Right - self.width))
        y = max(area.Top, min(y, area.Bottom - self.height))
        if abs(x-area.Left) < 18: x = area.Left
        if abs(x+self.width-area.Right) < 18: x = area.Right-self.width
        if abs(y-area.Top) < 18: y = area.Top
        if abs(y+self.height-area.Bottom) < 18: y = area.Bottom-self.height
        self.dock_side = 'left' if x == area.Left else 'right' if x+self.width == area.Right else None
        self.window.move(x, y)
        if save:
            import config
            cfg.update(download_hud_x=x, download_hud_y=y)
            config.save(cfg)

    def show(self):
        if sys.platform != 'win32':
            return {'ok': False, 'msg': '桌面悬浮窗目前仅支持 Windows 软件窗口模式'}
        with self._lock:
            self._hidden_requested = False
            if self._hide_timer is not None:
                self._hide_timer.cancel()
                self._hide_timer = None
            if self.closed: return {'ok': False, 'msg': '软件正在退出'}
            if self.window is not None:
                if self.window.native is None:
                    return {'ok': True, 'msg': '悬浮窗正在初始化'}
                self.resize()
                self.window.evaluate_js("document.body.dataset.hidden='false'")
                self.window.show()
                return {'ok': True}
            import webview
            self.window = webview.create_window('CFT 下载进度',
                url=os.path.join(self.root, 'web', 'download-hud.html'),
                js_api=HudBridge(self), width=440, height=54, min_size=(40, 40),
                frameless=True, easy_drag=False, resizable=False, hidden=True,
                on_top=True, focus=False, background_color='#252729', text_select=False)
            self.window.events.loaded += self.ready
            self.window.events.closing += self.on_closing
            return {'ok': True, 'msg': '悬浮窗正在初始化'}

    def on_closing(self):
        if self.closed: return True
        # FormClosing is synchronous on the WinForms UI thread. Do not call
        # evaluate_js / Invoke / hide here: WebView waits on this very callback.
        # Cancel close immediately, and hide from a daemon after the UI unwinds.
        self._hidden_requested = True
        if self._hide_timer is None or not self._hide_timer.is_alive():
            self._hide_timer = threading.Timer(.03, self._hide_after_close)
            self._hide_timer.daemon = True
            self._hide_timer.start()
        return False

    def _hide_after_close(self):
        if not self.closed and self._hidden_requested:
            self.hide()

    def hide(self):
        self._hidden_requested = True
        if not self.closed and self.window is not None:
            # A hidden WebView receives visibilitychange; no JS round trip needed.
            self.window.hide()
        return True

    def ready(self):
        if self.closed: return
        from System import Action
        def apply():
            form = self.window.native
            form.ShowInTaskbar = False
        self.window.native.Invoke(Action(apply))
        self.resize()
        self.position()
        if not self._hidden_requested:
            self.window.show()

    def close(self):
        self.closed = True
        if self._hide_timer is not None:
            self._hide_timer.cancel()
        if self.window:
            self.window.destroy()

    def sync(self):
        if self.api.cfg.get('download_hud_enabled'):
            self.show()
        elif self.window and self.window.native is not None:
            self.window.hide()
