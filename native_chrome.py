"""只保留原生缩放边框，窗口按钮由网页主题渲染，不叠加不透明 WinForms 面板。"""
from pathlib import Path
import sys

class IntegratedChrome:
    def __init__(self, form, window):
        import clr
        root = Path(getattr(sys, '_MEIPASS', Path(__file__).parent))
        dll = root/'native'/'CftChrome.dll' if getattr(sys,'frozen',False) else root/'build'/'native'/'CftChrome.dll'
        clr.AddReference(str(dll))
        from CftNative import Frame
        from System.Windows.Forms import DockStyle
        self.form, self.window = form, window
        self.webview = form.browser.webview
        self.frame = Frame(form.Handle)
        self.maximized = False
        self.last_bounds = None
        self.webview.Dock = getattr(DockStyle, 'None')
        self.layout_handler = lambda *_: self.layout()
        form.Resize += self.layout_handler
        self.layout()

    def layout(self):
        from System.Windows.Forms import FormWindowState
        try:
            import ctypes
            dpi=ctypes.windll.user32.GetDpiForWindow(ctypes.c_void_p(self.form.Handle.ToInt64())) or 96
        except Exception:dpi=96
        self.maximized = self.form.WindowState == FormWindowState.Maximized
        # 自定义 NC 框架后 WinForms 的 ClientSize 可能滞后；按真实 GetClientRect 铺满。
        self.frame.Edge=max(4,round(6*dpi/96));self.frame.TitleHeight=0;self.frame.ControlsWidth=0
        import ctypes
        from ctypes import wintypes
        rect=wintypes.RECT()
        if ctypes.windll.user32.GetClientRect(ctypes.c_void_p(self.form.Handle.ToInt64()),ctypes.byref(rect)):
            self.webview.SetBounds(0,0,max(0,rect.right-rect.left),max(0,rect.bottom-rect.top))
        else:self.webview.SetBounds(0,0,self.form.ClientSize.Width,self.form.ClientSize.Height)
        bounds=(self.webview.Width,self.webview.Height,self.maximized)
        if bounds!=self.last_bounds:
            self.last_bounds=bounds;self.form.Invalidate(True);self.frame.Repaint()

    def refresh(self, options):
        self.layout()  # 不创建字体、图像或原生按钮；主题/圆角全部由现有 CSS 控制。

    def close(self):
        from System.Windows.Forms import DockStyle, FormBorderStyle
        self.form.Resize -= self.layout_handler
        self.frame.RestoreFrame()
        self.form.FormBorderStyle=FormBorderStyle.Sizable
        self.window.frameless=False
        self.webview.Dock=DockStyle.Fill;self.webview.BringToFront()
