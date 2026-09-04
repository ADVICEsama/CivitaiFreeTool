# -*- coding: utf-8 -*-
"""UI 引擎：深浅色板、全局主题、GlowButton 光晕按钮、列表行 hover
Modern Flat + Subtle Depth；动效基于帧插值（16ms/帧，ease-out 曲线）。"""
import os
import time
import tkinter as tk
import tkinter.font as tkfont
from tkinter import ttk

# ---------------- 色板（iOS 风格） ----------------
LIGHT = {
    "bg": "#f2f2f7", "surface": "#ffffff", "surface2": "#e5e5ea",
    "border": "#c7c7cc", "text": "#1c1c1e", "text_dim": "#8e8e93",
    "primary": "#007aff", "primary_hover": "#3395ff", "primary_press": "#0062cc",
    "primary_fg": "#ffffff", "danger": "#ff3b30", "danger_hover": "#ff6b61",
    "hover": "#e9e9ee", "selection": "#d9e9ff", "tab_active": "#ffffff",
    "glow": "#007aff", "progress": "#007aff", "disabled": "#d8d8dd",
}
DARK = {
    "bg": "#1c1c1e", "surface": "#2c2c2e", "surface2": "#3a3a3c",
    "border": "#48484a", "text": "#ffffff", "text_dim": "#98989d",
    "primary": "#0a84ff", "primary_hover": "#409cff", "primary_press": "#0060df",
    "primary_fg": "#ffffff", "danger": "#ff453a", "danger_hover": "#ff6b61",
    "hover": "#3a3a3c", "selection": "#2d4a7a", "tab_active": "#2c2c2e",
    "glow": "#0a84ff", "progress": "#0a84ff", "disabled": "#444446",
}
MODERN_LIGHT = {
    # Axion Studio 风格：浅灰底 + 白卡片 + 深灰文字 + 橙 #F26522
    "bg": "#efefef", "surface": "#ffffff", "surface2": "#e6e6e6",
    "border": "#d8d8d8", "text": "#1a1a1a", "text_dim": "#6b6b6b",
    "primary": "#f26522", "primary_hover": "#e05a1a", "primary_press": "#c94e12",
    "primary_fg": "#ffffff", "danger": "#e5484d", "danger_hover": "#f26b70",
    "hover": "#f5f0eb", "selection": "#ffe8dc", "tab_active": "#ffffff",
    "glow": "#f26522", "progress": "#f26522", "disabled": "#dcdcdc",
}
CURRENT = DARK  # 运行时色板引用（apply_theme 时替换）

# 主题注册表（设置页三选）
THEMES = {"dark": DARK, "light": LIGHT, "modern": MODERN_LIGHT}
THEME_LABELS = {"dark": "深色", "light": "浅色", "modern": "现代浅色"}


# ---------------- CJK 字体（跨平台） ----------------
# 运行时由 resolve_font_family() 按平台实际可用字体解析覆盖；
# 未探测到时 Windows 保持雅黑默认，其他平台回退 Tk 通用族 Helvetica
# （中文字形由 fontconfig 逐字回退渲染；注意 Tk9 打包异常时 families()
#  可能只报告核心 X 字体，探测必然失败，此时同样走该回退）。
FONT_FAMILY = "Microsoft YaHei UI"
_FONT_RESOLVED = False

_FONT_CANDIDATES = (
    "Microsoft YaHei UI", "Microsoft YaHei",                   # Windows
    "PingFang SC", "Hiragino Sans GB",                         # macOS
    "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC",  # Linux 主流
    "LXGW WenKai",                                             # Linux 常见手装中文字体
    "WenQuanYi Micro Hei", "WenQuanYi Zen Hei",                # Linux 轻量
    "SimHei", "SimSun",
)


def resolve_font_family(root):
    """探测当前平台第一个可用的 CJK 字体族，写入全局 FONT_FAMILY 并返回；
    找不到返回 None（调用方应保留默认字体，不要强行指定）。幂等，可重复调用。"""
    global FONT_FAMILY, _FONT_RESOLVED
    try:
        fams = set(tkfont.families(root))
        for fam in _FONT_CANDIDATES:
            if fam in fams:
                FONT_FAMILY = fam
                _FONT_RESOLVED = True
                return fam
    except Exception:
        pass
    return None


def main_font(size=10):
    """主字体元组 (family, size)。探测失败时：Windows 用雅黑默认，
    其他平台用 Tk 全平台保证的 Helvetica（中文靠字形回退）。"""
    if _FONT_RESOLVED or os.name == "nt":
        return (FONT_FAMILY, size)
    return ("Helvetica", size)


def _hex_to_rgb(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i + 2], 16) for i in (0, 2, 4))


def _rgb_to_hex(r, g, b):
    return "#%02x%02x%02x" % (max(0, min(255, int(r))), max(0, min(255, int(g))), max(0, min(255, int(b))))


def mix(c1, c2, t):
    """颜色线性插值 t∈[0,1]（ease 需外部处理）"""
    a, b = _hex_to_rgb(c1), _hex_to_rgb(c2)
    return _rgb_to_hex(*(a[i] + (b[i] - a[i]) * t for i in range(3)))


def ease_out(t):
    return 1 - (1 - t) ** 3


def ease_out_spring(t):
    """带轻微过冲的 spring 近似：t∈[0,1] -> 0..1（可>1）"""
    if t >= 1:
        return 1.0
    return 1 - 1.0001 ** (-t * 6) * (0.98 * __import__("math").cos(t * 5.2) + 0.02)


# ---------------- 主题应用 ----------------
_glow_buttons = []  # 所有 GlowButton 实例（主题切换时统一重绘）


def apply_theme(root, style, theme="dark"):
    """按主题名（dark/light/modern）应用色板到整个 ttk 样式体系与根窗口"""
    global CURRENT
    C = THEMES.get(theme, DARK)
    CURRENT = C
    resolve_font_family(root)
    try:
        root.configure(bg=C["bg"])
    except Exception:
        pass
    try:
        style.theme_use("clam")
    except Exception:
        pass
    style.configure(".", background=C["bg"], foreground=C["text"], borderwidth=0,
                    focuscolor=C["primary"], font=main_font(10))
    style.configure("TFrame", background=C["bg"])
    style.configure("TLabel", background=C["bg"], foreground=C["text"])
    if theme == "modern":
        # Axion 风格白色胶囊导航：选中白底、间距大、padding 饱满
        style.configure("TNotebook", background=C["bg"], borderwidth=0, tabmargins=(6, 8, 6, 0))
        style.configure("TNotebook.Tab", background=C["surface2"], foreground=C["text_dim"],
                        padding=(22, 9), borderwidth=0)
        style.map("TNotebook.Tab",
                  background=[("selected", C["surface"]), ("active", C["hover"])],
                  foreground=[("selected", C["text"]), ("active", C["text"])])
    else:
        style.configure("TNotebook", background=C["bg"], borderwidth=0)
        style.configure("TNotebook.Tab", background=C["surface2"], foreground=C["text_dim"],
                        padding=(16, 7), borderwidth=0)
        style.map("TNotebook.Tab",
                  background=[("selected", C["tab_active"]), ("active", C["surface"])],
                  foreground=[("selected", C["text"]), ("active", C["text"])])
    style.configure("TLabelframe", background=C["bg"], bordercolor=C["border"])
    style.configure("TLabelframe.Label", background=C["bg"], foreground=C["text"])
    style.configure("TCheckbutton", background=C["bg"], foreground=C["text"])
    style.map("TCheckbutton", background=[("active", C["bg"])],
              foreground=[("active", C["text"])])
    style.configure("TEntry", fieldbackground=C["surface"], foreground=C["text"],
                    bordercolor=C["border"], insertcolor=C["text"], lightcolor=C["border"],
                    darkcolor=C["border"])
    style.configure("TSpinbox", fieldbackground=C["surface"], foreground=C["text"],
                    bordercolor=C["border"], arrowcolor=C["text_dim"], lightcolor=C["border"],
                    darkcolor=C["border"])
    style.configure("TCombobox", fieldbackground=C["surface"], foreground=C["text"],
                    background=C["surface"], arrowcolor=C["text_dim"], bordercolor=C["border"],
                    lightcolor=C["border"], darkcolor=C["border"])
    style.map("TCombobox", fieldbackground=[("readonly", C["surface"])],
              selectbackground=[("readonly", C["selection"])])
    if theme == "modern":
        # 卡片感列表：行更高、表头白底大内边距
        style.configure("Treeview", background=C["surface"], fieldbackground=C["surface"],
                        foreground=C["text"], bordercolor=C["border"], rowheight=32)
        style.configure("Treeview.Heading", background=C["surface"], foreground=C["text"],
                        bordercolor=C["border"], relief="flat", padding=(6, 7))
    else:
        style.configure("Treeview", background=C["surface"], fieldbackground=C["surface"],
                        foreground=C["text"], bordercolor=C["border"], rowheight=26)
        style.configure("Treeview.Heading", background=C["surface2"], foreground=C["text_dim"],
                        bordercolor=C["border"], relief="flat", padding=4)
    style.map("Treeview.Heading", background=[("active", C["hover"])],
              foreground=[("active", C["text"])])
    style.map("Treeview",
              background=[("selected", C["selection"])],
              foreground=[("selected", C["text"])])
    style.configure("Vertical.TScrollbar", background=C["surface2"], troughcolor=C["bg"],
                    bordercolor=C["bg"], arrowcolor=C["text_dim"], width=8)
    style.map("Vertical.TScrollbar", background=[("active", C["hover"])])
    style.configure("Horizontal.TScrollbar", background=C["surface2"], troughcolor=C["bg"],
                    bordercolor=C["bg"], arrowcolor=C["text_dim"], width=8)
    style.map("Horizontal.TScrollbar", background=[("active", C["hover"])])
    style.configure("TProgressbar", background=C["progress"], troughcolor=C["surface2"],
                    bordercolor=C["bg"], lightcolor=C["progress"], darkcolor=C["progress"])
    style.configure("TButton", background=C["surface2"], foreground=C["text"], padding=(10, 5))
    style.map("TButton", background=[("active", C["hover"])])
    # 同步已创建的 ttk 控件（重建过的控件已用新样式；Text 等需手动刷）
    try:
        for w in root.winfo_children():
            _refresh_widget(root, w)
    except Exception:
        pass
    for b in _glow_buttons:
        try:
            b._anim_from = b._anim_to = b._cur_bg = None
            b._draw()
        except Exception:
            pass
    return C


def _refresh_widget(root, w):
    """递归刷新现存控件配色（ttk 走样式自动，tk 控件手动）"""
    for ch in w.winfo_children():
        _refresh_widget(root, ch)
    try:
        if isinstance(w, tk.Text):
            w.configure(bg=CURRENT["surface"], fg=CURRENT["text"],
                        insertbackground=CURRENT["text"])
        elif isinstance(w, tk.Listbox):
            w.configure(bg=CURRENT["surface"], fg=CURRENT["text"])
        elif isinstance(w, tk.Canvas):
            w.configure(bg=CURRENT["bg"])
    except Exception:
        pass


# ---------------- 圆角矩形 ----------------
def round_rect(cv, x1, y1, x2, y2, r, **kw):
    r = min(r, (x2 - x1) / 2, (y2 - y1) / 2)
    pts = [x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r, x2, y2 - r, x2, y2,
           x2 - r, y2, x1 + r, y2, x1, y2, x1, y2 - r, x1, y1 + r, x1, y1]
    return cv.create_polygon(pts, smooth=True, **kw)


# ---------------- GlowButton 光晕按钮 ----------------
class GlowButton(tk.Canvas):
    """自绘扁平按钮：hover 背景平滑过渡（ease-out 16ms/帧）+ 鼠标微光光晕
    兼容 ttk 接口子集：configure(state=...)/configure(text=...)/cget("state")/cget("text")"""

    def __init__(self, master, text="", command=None, kind="ghost", height=34,
                 padx=16, font=None, state="normal", **kw):
        self._font = font or main_font(10)
        f = tkfont.Font(root=master, font=self._font)
        width = f.measure(text or "") + padx * 2 + 4
        super().__init__(master, height=height, width=width, highlightthickness=0,
                         bd=0, bg=CURRENT["bg"], **kw)
        self.text = text
        self.command = command
        self.kind = kind
        self._state = state
        self._hover = False
        self._pressed = False
        self._glow_pos = None
        self._cur_bg = None        # 当前背景色（动画插值中）
        self._anim_from = None
        self._anim_to = None
        self._anim_t0 = None
        self._anim_id = None
        self._glow_id = None
        self._roll = 0.0           # 文字上滚动画偏移
        self.bind("<Enter>", self._on_enter)
        self.bind("<Leave>", self._on_leave)
        self.bind("<Motion>", self._on_motion)
        self.bind("<Button-1>", self._on_press)
        self.bind("<ButtonRelease-1>", self._on_release)
        _glow_buttons.append(self)
        self._draw()

    # ---- 配色 ----
    def _base_colors(self):
        C = CURRENT
        if self.kind == "primary":
            return C["primary"], C["primary_fg"], C["primary_hover"]
        if self.kind == "danger":
            return C["danger"], "#ffffff", C["danger_hover"]
        return C["bg"], C["text"], C["hover"]

    def _text_color(self, hover=False):
        if self.kind == "ghost":
            return CURRENT["text"] if not hover else CURRENT["primary"]
        return CURRENT["primary_fg"]

    # ---- 绘制 ----
    def _draw(self):
        C = CURRENT
        bg = self._cur_bg or self._anim_to or self._base_colors()[0]
        if self._state == "disabled":
            bg = C["disabled"]
        self.delete("all")
        w = int(self.cget("width"))
        h = int(self.cget("height"))
        # iOS 风格：胶囊圆角（半径 = 高度一半）
        round_rect(self, 1, 1, w - 2, h - 2, (h - 2) // 2, fill=bg, outline="")
        # 光晕（鼠标微光）：径向色阶同心圆
        if self._glow_pos and self._state != "disabled" and not self._pressed:
            gx, gy = self._glow_pos
            glow = C["glow"]
            for i in range(6, 0, -1):
                t = i / 6.0
                r = 3 + (h * 0.9) * (1 - t)
                col = mix(bg, glow, (1 - t) * 0.55)
                self.create_oval(gx - r, gy - r, gx + r, gy + r, fill=col, outline="")
        if self._pressed and self._state != "disabled":
            bg = self._base_colors()[2]
        txt_color = self._text_color(self._hover)
        # 文字上滚动画（hover 时文字上移，近似原设计 text roll）
        roll = getattr(self, "_roll", 0.0)
        self.create_text(w // 2, h // 2 + (1 if self._pressed else 0) + roll,
                         text=self.text, fill=txt_color, font=self._font)

    # ---- hover 动画 ----
    def _on_enter(self, _e=None):
        if self._state == "disabled":
            return
        self._hover = True
        self._start_anim(self._base_colors()[0], self._base_colors()[2])

    def _on_leave(self, _e=None):
        self._hover = False
        self._glow_pos = None
        self._start_anim(self._base_colors()[0], self._base_colors()[0])

    def _on_motion(self, e):
        if self._state == "disabled":
            return
        self._glow_pos = (e.x, e.y)
        if self._hover:
            self._draw()

    def _start_anim(self, frm, to):
        self._anim_from = frm
        self._anim_to = to
        self._anim_t0 = time.monotonic()
        if self._anim_id is None:
            self._tick()

    def _tick(self):
        if self._anim_from is None or self._anim_to is None:
            self._anim_id = None
            return
        dt = time.monotonic() - self._anim_t0
        dur = 0.15
        t = min(1.0, dt / dur)
        col = mix(self._anim_from, self._anim_to, ease_out(t))
        self._cur_bg = col
        # 文字上滚插值（hover 上移，离开回位）
        target_roll = -2.5 if (self._hover and self._state != "disabled") else 0.0
        self._roll = (getattr(self, "_roll", 0.0) + target_roll) * 0.5 if target_roll else getattr(self, "_roll", 0.0) * 0.5
        self._draw()
        if t >= 1:
            self._anim_from = self._anim_to = None
            self._anim_id = None
        else:
            self._anim_id = self.after(16, self._tick)

    # ---- 点击 ----
    def _on_press(self, _e=None):
        if self._state == "disabled":
            return
        self._pressed = True
        self._draw()

    def _on_release(self, _e=None):
        if self._state == "disabled":
            return
        self._pressed = False
        self._draw()
        if self._hover and self.command:
            try:
                self.command()
            except Exception:
                pass

    # ---- ttk 兼容接口 ----
    def configure(self, cnf=None, **kw):
        if cnf is None and not kw:
            return {k: self.cget(k) for k in ("state", "text")}
        if isinstance(cnf, dict):
            kw.update(cnf)
        for k, v in kw.items():
            if k == "state":
                self._state = v
                if v == "disabled":
                    self._hover = False
                    self._glow_pos = None
                self._draw()
            elif k == "text":
                self.text = v
                f = tkfont.Font(root=self, font=self._font)
                super().configure(width=f.measure(v or "") + 2 * 16 + 4)
                self._draw()
            elif k == "command":
                self.command = v
            elif k == "width":
                super().configure(width=v)
                self._draw()
            else:
                super().configure(**{k: v})
        return None

    def cget(self, key):
        if key == "state":
            return self._state
        if key == "text":
            return self.text
        return super().cget(key)

    def set_disabled(self, d):
        self.configure(state="disabled" if d else "normal")


# ---------------- Treeview 行 hover ----------------
class RowHover:
    """Treeview 行 hover 高亮（30fps 节流，颜色平滑）"""

    def __init__(self, tree):
        self.tree = tree
        self.last = None
        self._last_t = 0
        self._tag = "_rowhover"
        tree.tag_configure(self._tag, background=CURRENT["hover"])
        tree.bind("<Motion>", self._on_motion, add="+")
        tree.bind("<Leave>", self._clear, add="+")

    def _on_motion(self, e):
        now = time.monotonic()
        if now - self._last_t < 0.033:
            return
        self._last_t = now
        iid = self.tree.identify_row(e.y)
        if iid != self.last:
            if self.last:
                self._set_hover(self.last, False)
            if iid:
                self._set_hover(iid, True)
            self.last = iid

    def _clear(self, _e=None):
        if self.last:
            self._set_hover(self.last, False)
            self.last = None

    def _set_hover(self, iid, on):
        """设置/清除 hover tag，保留行原有的其他 tag（如斑马纹）"""
        try:
            tags = list(self.tree.item(iid, "tags") or ())
            if on:
                if self._tag not in tags:
                    tags.append(self._tag)
            else:
                tags = [t for t in tags if t != self._tag]
            self.tree.item(iid, tags=tuple(tags))
        except Exception:
            pass

    def refresh(self):
        self.tree.tag_configure(self._tag, background=CURRENT["hover"])


# ---------------- 页面切换微动效 ----------------
class AmbientBackground:
    """氛围动态背景：Canvas 流动渐变光晕（近似 shader 氛围，15fps 低负载）
    在顶部装饰带上绘制随时间漂移的柔光斑，颜色跟随主题 glow。"""

    def __init__(self, canvas, height=22):
        self.cv = canvas
        self.height = height
        self._id = None
        self._t0 = time.monotonic()
        self._running = False

    def start(self):
        if self._running:
            return
        self._running = True
        self._t0 = time.monotonic()
        self._frame()

    def stop(self):
        self._running = False
        if self._id:
            try:
                self.cv.after_cancel(self._id)
            except Exception:
                pass
            self._id = None
        try:
            self.cv.delete("all")
        except Exception:
            pass

    def _frame(self):
        if not self._running:
            return
        try:
            C = CURRENT
            w = self.cv.winfo_width() or 400
            h = self.cv.winfo_height() or self.height
            t = time.monotonic() - self._t0
            self.cv.delete("all")
            # 底色
            self.cv.create_rectangle(0, 0, w, h, fill=C["bg"], outline="")
            # 3 个柔光斑：位置正弦漂移，颜色从 glow 渐变到背景
            for i in range(3):
                cx = (w * (0.2 + 0.3 * i) + 60 * __import__("math").sin(t * 0.5 + i * 2.1)) % (w + 200) - 100
                cy = h / 2 + 8 * __import__("math").sin(t * 0.8 + i * 1.7)
                r = h * (2.6 + 0.5 * __import__("math").sin(t * 0.3 + i))
                for k in range(5, 0, -1):
                    rr = r * k / 5.0
                    col = mix(C["bg"], C["glow"], (1 - k / 5.0) * 0.35)
                    self.cv.create_oval(cx - rr, cy - rr, cx + rr, cy + rr,
                                        fill=col, outline="")
        except Exception:
            pass
        self._id = self.cv.after(66, self._frame)  # ~15fps


class TabMotion:
    """Notebook 切换微动效：顶部装饰线从 0 宽度 spring 展开到全宽（16ms/帧）"""

    def __init__(self, canvas):
        self.cv = canvas
        self._id = None

    def play(self):
        try:
            if self._id:
                self.cv.after_cancel(self._id)
                self._id = None
            w = self.cv.winfo_width() or 400

            def frame(t):
                k = max(0.0, min(1.2, ease_out_spring(t)))
                self.cv.delete("all")
                self.cv.create_rectangle(0, 0, w * k, 3, fill=CURRENT["primary"], outline="")
                if t >= 1:
                    self._id = None
                    return
                self._id = self.cv.after(16, lambda: frame(t + 0.07))

            frame(0)
        except Exception:
            pass
