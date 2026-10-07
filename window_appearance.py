"""原生 DWM 标题栏外观；保留系统拖动、缩放、Snap 和关闭按钮。

客户端材质仅在 DWM 成功且 WebView2 透明底可用时启用，否则回退不透明底。
外部控制模式只在交接时撤销本软件设置，此后不抢写外部工具的属性。
"""
import re
import sys

MODES = {"theme", "mica", "mica_alt", "system", "external"}
DEFAULT_COLOR = 0xFFFFFFFF
NO_BORDER = 0xFFFFFFFE


def colorref(value):
    if not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise ValueError("窗口颜色必须是 #RRGGBB")
    r, g, b = (int(value[i:i+2], 16) for i in (1, 3, 5))
    return r | g << 8 | b << 16


def appearance_plan(options, previous=None):
    mode = options.get("mode", "theme")
    if mode not in MODES:
        raise ValueError("未知窗口外观模式")
    background = options.get("background", "#171221")
    foreground = options.get("text", "#eceaf2")
    bg, fg = colorref(background), colorref(foreground)
    rgb = [int(background[i:i+2], 16) for i in (1, 3, 5)]
    dark = int(sum(c*w for c, w in zip(rgb, (.2126, .7152, .0722))) < 140)
    if mode == "external" and previous in (None, "external"):
        return []
    if mode in ("system", "external"):
        return [(20, 0), (34, DEFAULT_COLOR), (35, DEFAULT_COLOR), (36, DEFAULT_COLOR), (38, 0)]
    if mode == "theme":
        return [(20, dark), (38, 1), (34, NO_BORDER), (35, bg), (36, fg)]
    return [(20, dark), (34, NO_BORDER), (35, DEFAULT_COLOR), (36, DEFAULT_COLOR), (38, 2 if mode == "mica" else 4)]


class WindowAppearance:
    def __init__(self, window):
        self.window = window
        self.previous = None
        self.serial = 0
        self.chrome = None
        self.runtime_chrome_disabled = False
        self.native_error_count = 0
        self.exception_handler = None
        self.status = {"ok": False, "mode": "pending", "msg": "窗口尚未就绪"}

    def control(self, action):
        if action not in ("minimize", "maximize", "close"):
            return {"ok": False, "msg": "未知窗口操作"}
        form = getattr(self.window, "native", None)
        if form is None or sys.platform != "win32":
            return {"ok": False, "msg": "当前无原生窗口"}
        try:
            from System import Action
            from System.Windows.Forms import FormWindowState
            def apply():
                if action == "close": form.Close()  # 保留现有关窗保存/最小化设置。
                elif action == "minimize": form.WindowState = FormWindowState.Minimized
                else: form.WindowState = FormWindowState.Normal if form.WindowState == FormWindowState.Maximized else FormWindowState.Maximized
            form.BeginInvoke(Action(apply))
            return {"ok": True, "queued": True}
        except Exception:
            return {"ok": False, "msg": "窗口操作暂不可用"}

    def resize(self, direction):
        edge={"left":1,"right":2,"top":3,"top-left":4,"top-right":5,"bottom":6,"bottom-left":7,"bottom-right":8}.get(direction)
        form=getattr(self.window,"native",None)
        if edge is None or self.chrome is None or form is None:
            return {"ok":False,"msg":"当前无法调整窗口边缘"}
        try:
            from System import Action
            form.BeginInvoke(Action(lambda:self.chrome.frame.BeginResize(edge) if self.chrome is not None else None))
            return {"ok":True,"queued":True}
        except Exception:return {"ok":False,"msg":"窗口缩放暂不可用"}

    def request(self, options):
        try:
            options = dict(options or {})
            appearance_plan(options, self.previous)  # 验证输入；不允许任意 DWM 属性或 HWND
            if sys.platform != "win32":
                return {"ok": False, "msg": "原生标题栏外观仅适用于 Windows；网页主题仍正常生效"}
            form = getattr(self.window, "native", None)
            if form is None:
                return {"ok": False, "msg": "窗口尚未就绪"}
            # WinForms 的 FindForm() 返回 CLR 基类代理，会丢失 pywebview 的 browser 属性。
            # window.native 本身就是顶层 BrowserForm，保留原 Python 包装对象。
            from System import Action
            self.serial += 1
            serial = self.serial
            self.status = {"ok": False, "mode": "pending", "msg": "正在应用标题栏外观…"}

            def apply():
                if serial != self.serial:
                    return
                try:
                    import ctypes
                    hwnd = ctypes.c_void_p(form.Handle.ToInt64())
                    if self.exception_handler is None:
                        from System.Windows.Forms import Application
                        def recover(sender,event):
                            import logging
                            self.native_error_count += 1
                            logging.getLogger(__name__).error('Native UI exception; reverting chrome: %s', event.Exception.ToString())
                            self.runtime_chrome_disabled=True
                            if self.chrome is not None:
                                try:self.chrome.close()
                                except Exception:logging.getLogger(__name__).exception('Native chrome rollback failed')
                                self.chrome=None
                            self.status={'ok':False,'mode':options.get('mode','theme'),'integrated':False,'client_material':False,
                                         'native_error_count':self.native_error_count,'msg':'原生窗口栏发生异常，已回退系统标题栏；下载后台保留。重新启动后再试。'}
                        self.exception_handler=recover
                        Application.ThreadException += recover
                    chrome_error = ''
                    # 原生框架在 create_window 阶段确定，避免 WinForms 仍按 Sizable 绘制旧系统框。
                    requested=options.get('integrated', True) and options.get('mode','theme') not in ('external','system')
                    initialized=bool(getattr(self.window,'frameless',False))
                    restart_required=requested!=initialized
                    if initialized and not self.runtime_chrome_disabled:
                        try:
                            if self.chrome is None:
                                from native_chrome import IntegratedChrome
                                self.chrome = IntegratedChrome(form, self.window)
                            self.chrome.refresh(options)
                        except Exception as e:
                            import logging
                            logging.getLogger(__name__).exception('Integrated window chrome failed')
                            chrome_error = '应用内窗口栏不可用，保留标准标题栏。'
                    elif self.chrome is not None:
                        self.chrome.close();self.chrome=None
                    dwm = ctypes.windll.dwmapi
                    mode = options.get("mode", "theme")
                    plan = appearance_plan(options, self.previous)
                    failures = []
                    for attr, value in plan:
                        number = ctypes.c_uint32(value)
                        hr = dwm.DwmSetWindowAttribute(hwnd, attr, ctypes.byref(number), 4)
                        if hr != 0:
                            failures.append(attr)
                    self.previous = mode
                    # 不在建窗阶段设置 transparent=True（WebView2 有 Show/Hide 兼容分支）。
                    # 显示后透明 WebView2 + 黑色零 alpha GDI 底 + DWM 扩展才可见客户端材质。
                    class Margins(ctypes.Structure):
                        _fields_ = [('left',ctypes.c_int),('right',ctypes.c_int),('top',ctypes.c_int),('bottom',ctypes.c_int)]
                    material = mode in ('mica','mica_alt') and not failures
                    if mode == 'external':
                        backdrop=ctypes.c_uint32()
                        material=dwm.DwmGetWindowAttribute(hwnd,38,ctypes.byref(backdrop),4)==0 and backdrop.value in (2,3,4)
                    from System.Drawing import Color, ColorTranslator
                    form.browser.webview.DefaultBackgroundColor=Color.Transparent if material else ColorTranslator.FromHtml(options.get('background','#171221'))
                    form.BackColor=Color.Black if material else ColorTranslator.FromHtml(options.get('background','#171221'))
                    margins=Margins(*([-1]*4 if material else [0]*4))
                    frame_hr=dwm.DwmExtendFrameIntoClientArea(hwnd,ctypes.byref(margins))
                    if material and frame_hr != 0:
                        material=False
                        form.browser.webview.DefaultBackgroundColor=ColorTranslator.FromHtml(options.get('background','#171221'))
                    transparency = None
                    try:
                        import winreg
                        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize") as key:
                            transparency = bool(winreg.QueryValueEx(key,"EnableTransparency")[0])
                    except OSError: pass
                    from System.Windows.Forms import SystemInformation
                    high_contrast = bool(SystemInformation.HighContrast)
                    active = bool(form.ContainsFocus)
                    if mode == "external":
                        msg = "已交给外部工具。Mica For Everyone 按进程名 CivitaiFreeToolWeb.exe 建规则；规则生效后重新应用外观或重启软件。"
                    elif mode == "system":
                        msg = "使用 Windows 系统标题栏。"
                    elif failures:
                        msg = "当前系统不支持部分标题栏效果，已保留标准窗口；Mica / Mica Alt 需要 Windows 11 22H2 或更新版本。"
                    elif mode == "theme":
                        msg = "已使用应用内窗口栏；支持拖动、双击最大化、边缘缩放与窗口按钮。" if self.chrome else "标题栏已跟随软件主题；保留系统窗口操作。"
                    else:
                        msg = "已启用原生 " + ("Mica Alt" if mode == "mica_alt" else "Mica") + (" 窗口背景；面板半透明，图片与文字保持清晰。" if material else " 标题栏；客户端材质不可用，保留不透明背景。")
                    if material:
                        if transparency is False or high_contrast:
                            msg += " 系统关闭透明效果或启用高对比度，Windows 会使用纯色回退；本软件不强改系统设置。"
                        elif not active:
                            msg += " 窗口未激活时 Windows 会使用中性色；激活后查看壁纸色调。"
                        msg += " Mica 是壁纸色调材质，不是实时透视背后窗口的毛玻璃。"
                    if chrome_error:msg += ' '+chrome_error
                    if restart_required:msg += ' 窗口框架改动需重启生效，当前保持单一窗口栏。'
                    if self.runtime_chrome_disabled:msg += ' 原生窗口栏已因异常禁用，本次运行保留系统标题栏。'
                    self.status = {"ok": not failures, "mode": mode, "integrated":self.chrome is not None,"client_material":material,"webview_alpha":int(form.browser.webview.DefaultBackgroundColor.A),"native_error_count":self.native_error_count,"restart_required":restart_required,"border_style":str(form.FormBorderStyle),"transparency_enabled":transparency,"high_contrast":high_contrast,"active":active,"failed_attributes": failures, "msg": msg}
                    # 不在 WinForms UI 线程同步 evaluate_js，避免阻塞 WebView2 的回调。
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).exception('Window appearance failed')
                    self.status = {"ok": False, "mode": options.get("mode"), "error_type":type(e).__name__,"msg": "标题栏效果无法应用，已保留标准窗口"}

            form.BeginInvoke(Action(apply))
            return {"ok": True, "queued": True, "msg": "正在应用标题栏外观…"}
        except (ValueError, TypeError) as e:
            return {"ok": False, "msg": str(e)}
        except Exception:
            return {"ok": False, "msg": "标题栏外观暂不可用，已保留标准窗口"}
