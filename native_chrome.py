"""在已显示的 WinForms 窗口上安装应用内风格窗口栏，不提前访问 UI 控件。"""
from pathlib import Path
import sys

class IntegratedChrome:
    def __init__(self, form, window):
        import clr
        root = Path(getattr(sys, '_MEIPASS', Path(__file__).parent))
        dll = root/'native'/'CftChrome.dll' if getattr(sys,'frozen',False) else root/'build'/'native'/'CftChrome.dll'
        clr.AddReference(str(dll))  # 加载失败时不改变标准窗口。
        from CftNative import Frame, PassCaption, CaptionButton
        from System.Drawing import Icon, Color, ContentAlignment
        from System.Windows.Forms import Panel, Label, PictureBox, PictureBoxSizeMode, FormWindowState, DockStyle
        self.form = form
        self.current_font = None
        self.webview = form.browser.webview
        self.frame = Frame(form.Handle)
        self.bar = Panel(); self.title = Label();self.logo = PictureBox()
        self.bar.Controls.Add(self.title);self.bar.Controls.Add(self.logo);form.Controls.Add(self.bar)
        self.title.Text = 'CivitaiFreeTool';self.title.TextAlign = ContentAlignment.MiddleLeft
        self.logo.SizeMode = PictureBoxSizeMode.Zoom
        icon = root/'web'/'favicon.ico'
        if icon.is_file(): self.logo.Image = Icon(str(icon)).ToBitmap()
        self.passers = [PassCaption(c) for c in (self.bar,self.title,self.logo)]
        self.buttons = [CaptionButton(i) for i in range(3)]
        for b in self.buttons:self.bar.Controls.Add(b)
        self.buttons[0].Click += lambda *_: setattr(form,'WindowState',FormWindowState.Minimized)
        def maximize(*_):form.WindowState=FormWindowState.Normal if form.WindowState==FormWindowState.Maximized else FormWindowState.Maximized
        self.buttons[1].Click += maximize
        self.buttons[2].Click += lambda *_: form.Close()
        self.webview.Dock = getattr(DockStyle, 'None')
        self.layout_handler = lambda *_: self.layout()
        form.Resize += self.layout_handler
        self.bar.BringToFront();self.refresh({})

    def layout(self):
        from System.Windows.Forms import FormWindowState
        from System.Drawing import Point,Size
        try:
            import ctypes
            dpi=ctypes.windll.user32.GetDpiForWindow(ctypes.c_void_p(self.form.Handle.ToInt64())) or 96
        except Exception:dpi=96
        scale=dpi/96; p=0 if self.form.WindowState==FormWindowState.Maximized else max(4,round(6*scale))
        h=round(42*scale);w=self.form.ClientSize.Width;total=self.form.ClientSize.Height
        self.frame.Edge=max(4,round(6*scale));self.frame.TitleHeight=h+p;self.frame.ControlsWidth=round(138*scale)+p
        self.bar.SetBounds(p,p,max(0,w-2*p),h)
        self.logo.SetBounds(round(9*scale),round(9*scale),round(24*scale),round(24*scale))
        self.title.SetBounds(round(43*scale),0,max(0,w-round(210*scale)),h)
        for i,b in enumerate(self.buttons):
            b.SetBounds(max(0,self.bar.Width-round((3-i)*46*scale)),0,round(46*scale),h)
            b.Maximized=self.form.WindowState==FormWindowState.Maximized;b.Invalidate()
        self.webview.SetBounds(p,p+h,max(0,w-2*p),max(0,total-h-2*p))

    def refresh(self, options):
        from System.Drawing import Color, Font, FontStyle, GraphicsUnit
        def color(key,fallback):
            v=options.get(key,fallback);return Color.FromArgb(int(v[1:3],16),int(v[3:5],16),int(v[5:7],16))
        bg=color('background','#171221');text=color('text','#eceaf2')
        self.bar.BackColor=bg;self.title.ForeColor=text
        old=self.current_font
        try:self.title.Font=Font(options.get('font') or 'Microsoft YaHei UI',float(options.get('text_scale',1))*13,FontStyle.Regular,GraphicsUnit.Pixel)
        except Exception:pass
        self.current_font=self.title.Font
        if old is not None and self.current_font is not old:
            try:old.Dispose()
            except Exception:pass
        page=str(options.get('page',''))[:40];self.title.Text='CivitaiFreeTool'+('  ·  '+page if page else '')
        for i,b in enumerate(self.buttons):
            b.Normal=bg;b.Hover=Color.FromArgb(190,40,55) if i==2 else Color.FromArgb(min(255,bg.R+25),min(255,bg.G+25),min(255,bg.B+25))
            b.BackColor=bg;b.ForeColor=text;b.Invalidate()
        self.layout()

    def close(self):
        from System.Windows.Forms import DockStyle
        self.form.Resize -= self.layout_handler
        for passer in self.passers:passer.ReleaseHandle()
        self.form.Controls.Remove(self.bar);self.bar.Dispose()
        self.frame.RestoreFrame();self.webview.Dock=DockStyle.Fill;self.webview.BringToFront()

