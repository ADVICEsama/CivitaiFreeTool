# CivitaiFreeTool 一键下载（Firefox 扩展）

在 `civitai.red` / `civitai.com` 的模型页面点击扩展图标，确认模型与链接后，将下载交给正在运行的 CivitaiFreeTool。

## 获取与临时安装

当前扩展的 `manifest.json` 声明最低 Firefox 版本为 121.0。发行 ZIP 统一放在 [GitHub Release](https://github.com/ADVICEsama/CivitaiFreeTool/releases/latest)，源码目录不再保存旧压缩包。

1. 在 Release 下载名称含 **FirefoxExtension** 的 ZIP，不要使用 Chrome 包。
2. 打开 `about:debugging#/runtime/this-firefox`。
3. 点击“临时载入附加组件”，选择下载的 Firefox ZIP；包内 `manifest.json` 位于根目录。
4. 若直接使用本目录源码，也可选择本目录的 `manifest.json`。

当前发行包未签名，临时加载在 Firefox 重启后需要重新操作；长期安装需要 Mozilla 签名，不能把 ZIP 当作已签名永久扩展。

## 使用

1. 先启动 `CivitaiFreeToolWeb.exe`。
2. 打开 C站模型页面，点击扩展图标。
3. 确认当前模型与链接，点击“开始下载”。
4. 在软件的“下载管理”查看任务进度。

也可以使用扩展提供的页面/链接右键下载入口。软件的本地桥服务监听 `127.0.0.1:47531`；扩展只接受支持的模型页面或模型下载链接，不支持图片页、主页。

## 常见问题

- **未连接软件**：先启动或更新 CivitaiFreeTool；再重试扩展。
- **不是模型页**：切换到具体模型页面，不要在主页或图片页面操作。
- **下载失败**：检查模型是否可访问、是否下架，以及软件中的网络/代理设置。
- **重启浏览器后扩展消失**：这是未签名扩展的临时加载行为，不是安装完成的永久扩展。
