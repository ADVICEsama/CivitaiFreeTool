# Linux 运行说明（Qt6 WebEngine 版）

本项目支持在 Linux/macOS 上运行（桌面入口 `main_web.py`）。Windows 原代码路径未改动，
所有平台差异通过 `posix_compat.py` 在调用点分支处理。

## GUI 框架

Linux 下强制 pywebview 的 **Qt 后端**（`gui='qt'`）：底层是 `QWebEngineView` +
`QWebChannel`（Chromium 内核），通过 `qtpy` 自动选择 PySide6 / PyQt6 绑定。
KDE Plasma 下与系统风格完全一致。Windows 保持原 EdgeChromium (WebView2) 不变。

## 改动内容

- 新增 `posix_compat.py`：跨平台辅助模块
  - 打开 URL / 文件夹：`xdg-open`（Linux）、`open`（macOS）
  - 资源管理器中定位文件：DBus `org.freedesktop.FileManager1.ShowItems`（优先，
    Nautilus/Dolphin/Nemo/Thunar 均支持），回退 `xdg-open` 打开所在目录；
    路径经 `urllib.parse.quote` 做 percent-encoding 后以 **argv 形式**调 `gdbus`
    （不经 shell，含空格/引号/中文的路径都安全）
  - 回收站：`gio trash`（gvfs）→ `trash-put`（trash-cli）依次尝试；
    两者都没有时**拒绝删除**而非永久删除（不回退 rm）
  - 剪贴板：`wl-clipboard`（Wayland）/ `xclip`·`xsel`（X11）/ `pbcopy`（macOS）；
    xclip/xsel 需驻留进程持有剪贴板，超时不算失败
- `webui.py`：`copy_text` / `get_clipboard` / `open_in_folder` / `open_url` /
  `mm_open_site` / `rm_file` 加平台分支
- `gui.py`：5 处 `os.startfile` 换为 `_os_start` helper；`recycle` 非
  Windows 走 `gio trash` / `trash-put`
- `main_web.py`：非 Windows 强制 `gui='qt'`，启动前预检 qtpy + QtWebEngine，
  缺依赖时打印安装指引退出（不再抛裸 traceback）；Mica/图标等 Win32 调用本就在
  try/except 内静默回退
- 中文字体跨平台解析（`ui.py`）：按平台探测 微软雅黑 / PingFang SC /
  Noto Sans CJK / 文泉驿 等字体族，`gui.py`·`ui.py`·`frameless.py` 统一使用
- `requirements.txt`：`pythonnet` 仅在 Windows 安装（环境标记）；
  补上运行时实际用到的 `requests`；非 Windows 附加 `QtPy`
- `browser_bridge.py`：CORS 收紧——被拒 Origin 不再下发 `Access-Control-Allow-Origin: *`

## 运行方法（Arch Linux / KDE）

推荐用 [uv](https://docs.astral.sh/uv/) 管理环境（Qt 用 PySide6 pip 轮子自带，
无需系统级安装）：

```bash
uv venv                              # 默认用 uv 自管 CPython
uv pip install -r requirements.txt PySide6
uv run python main_web.py            # 或 .venv/bin/python main_web.py
```

也可以全部走系统包（official extra repo，无 pip 大轮子）：

```bash
sudo pacman -S pyside6 qt6-webengine python-qtpy wl-clipboard
# X11 会话用 xclip 替代 wl-clipboard：sudo pacman -S xclip
uv venv --python /usr/sbin/python    # 基于系统解释器建 venv（Tk 8.6 + Xft，字体探测正常）
uv pip install -r requirements.txt   # pythonnet 已用环境标记排除，Linux 不会装

python main_web.py
```

依赖说明：

- `PySide6`（pip 轮子自带 WebEngine）：Qt6 官方 Python 绑定；走系统包时
  `qt6-webengine` 是 `pyside6` 的可选依赖，必须显式安装
- `QtPy`（requirements 已含，非 Windows 环境标记）：pywebview Qt 后端要求的
  绑定 shim（自动挑 PySide6/PyQt6）
- `wl-clipboard`：Wayland 剪贴板命令（KDE Wayland 默认不带，需装）；X11 则用 `xclip`
- pywebview 在 arch/manjaro/nixos/rhel/pop 上会自动启用 `--no-sandbox`
  （上游针对 QtWebEngine 白屏的修复，见 pywebview #890）
- 缺 `PySide6`/`QtPy` 时，`main_web.py` 启动即打印安装指引退出

## 已知限制

- Win11 Mica/Acrylic 窗口特效、无边框自绘标题栏：Windows 专属，Linux 自动回退系统窗口
- 打开文件夹并"选中"文件依赖文件管理器实现 FileManager1 接口（Dolphin 支持）；
  不支持时退化为直接打开所在目录
- 剪贴板走外部命令（wl-copy/xclip）而非 QClipboard：pywebview 的 js_api 调用发生在
  工作线程，QClipboard 仅允许在 GUI 线程访问，线程外调用会崩溃——外部命令是线程安全
  的正确做法
- headless 环境所有桌面操作优雅返回失败，不影响下载/管理/解析核心功能
- Tk 版 GUI（`python main.py`）在 Linux 可运行（Mica/无边框自动回退、字体自动探测），
  但界面按 Windows 设计，推荐使用 `main_web.py`
- **uv 自管 Python 的 Tk 已知问题**：uv 下载的 CPython（当前 3.14.7）捆绑的 Tk 9
  未链接 Xft/fontconfig，`font families` 只报告核心 X 字体 `fixed`——Tk 版中文会渲染
  成方框（代码已探测到该情况并回退 Helvetica，但无 fontconfig 就无字形回退）。
  Web 版 `main_web.py` 不依赖 Tk 渲染文字，完全不受影响；需要 Tk 版请用系统解释器
  建 venv（Arch `tk` 8.6 带 Xft，字体探测正常）
