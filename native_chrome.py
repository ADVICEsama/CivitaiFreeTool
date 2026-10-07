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
        # 保留窄缩放边缘，避免 WebView 子 HWND 抢走边缘命中；底色由 DWM 材质提供。
        self.frame.Edge=max(4,round(6*dpi/96));self.frame.TitleHeight=0;self.frame.ControlsWidth=0
        p=0 if self.maximized else max(4,round(4*dpi/96))
        self.webview.SetBounds(p,p,max(0,self.form.ClientSize.Width-2*p),max(0,self.form.ClientSize.Height-2*p))

    def refresh(self, options):
        self.layout()  # 不创建字体、图像或原生按钮；主题/圆角全部由现有 CSS 控制。

    def close(self):
        from System.Windows.Forms import DockStyle, FormBorderStyle
        self.form.Resize -= self.layout_handler
        self.frame.RestoreFrame()
        self.form.FormBorderStyle=FormBorderStyle.Sizable
        self.window.frameless=False
        self.webview.Dock=DockStyle.Fill;self.webview.BringToFront()
