# CivitaiFreeTool

免费、全功能的 Civitai 模型下载 / 管理 / 反向解析工具（独立实现，**无任何付费墙**）。

## 运行方式

- **免安装版**：双击 `CivitaiFreeTool.exe`（单文件，无需 Python）
- **源码版**：`python main.py`（需要 Python 3.10+；缩略图功能需 `pip install pillow`）

## 功能

### 1. 批量下载
粘贴 Civitai 链接（每行一个）即可批量入队，支持三种格式：
- `https://civitai.com/models/12345`
- `https://civitai.com/models/12345?modelVersionId=678`
- `https://civitai.com/api/download/models/678`

### 2. 下载管理
- 并发下载（可调 1-20）、断点续传、暂停/重试/移除、任务持久化
- 下载完成后自动 SHA256 校验（防损坏/被篡改）
- **下载完成后弹窗询问移动位置**：选择目标文件夹，模型文件连同 json/预览图/封面等附属文件一起移动（可在设置页关闭此询问）

### 3. 模型管理
- **扫描模型**：递归扫描模型目录，可按子文件夹设置显示/隐藏（工具栏"文件夹显示"，例如只显示 `Lora`、`Stable-diffusion`，隐藏 VAE/embeddings 等用不上的）
- **封面缩略图**：列表第一列异步加载模型封面（本地 cover/preview 图）
- **双名称显示**：文件名 + C站模型名 两列（无元数据的模型可先"校验哈希/反向解析"补全）
- **重命名C站名**：一键把模型重命名为 C 站文件名（仅同目录改名，json/预览图等附属文件同步改名，不移动目录）
- **校验哈希**：多线程 SHA256 与 C 站对比（一致/未收录/失败）
- **检查更新**：对比本地版本与 C 站最新版本
- **整理模型**：按 C 站文件名改名 + 按 类型/基础模型 分类移动（如需按类型归档）
- **一键清理**：删除 info/封面/示例图/HTML 附属文件（模型本体保留）
- **生成 HTML 图例**：封面网格 + 名称 + 类型 + 触发词 + 链接

### 4. 反向解析
对本地"来路不明"的模型文件：SHA256 → Civitai 官方 `by-hash` 接口 → 自动生成 `civitai.info`（模型名/类型/触发词/标签/作者/统计等，可翻译描述）。

### 5. metadata.json（SD 兼容）
下载完成时自动生成模型元数据，格式可在设置页选择：
- **sd**（默认）：扁平结构 `<模型名>.json` —— `name/model_id/version/base_model/trained_words/tags/description/author/url/file_name/preview/hashes` 等，SD 生态扩展易读
- **civitai**：C 站原结构 `<模型名>.civitai.info`（civitai 助手扩展兼容）
- **both**：两者都生成

### 6. 界面
- **Mica / 亚克力窗口风格**（Win11，设置页可选：mica=云母 / acrylic=亚克力 / none=经典；Win10 自动忽略）

### 7. 设置
API Key、下载目录、模型目录、并发数、哈希线程数、超时、代理、翻译开关、窗口风格、metadata 格式、下载后移动询问。

## 数据与合规

- 数据来自 [Civitai 官方公开 API](https://docs.civitai.com/)，请遵守其服务条款
- 模型版权归各作者所有，请遵守模型页面的许可协议
- 本工具为独立编写的免费软件，与任何商业软件无关

## 目录结构

```
CivitaiFreeTool/
├── CivitaiFreeTool.exe  # 打包好的单文件程序
├── main.py / gui.py     # 入口与界面
├── config.py            # 配置读写
├── civitai_api.py       # Civitai API 封装
├── downloader.py        # 并发下载器
├── model_manager.py     # 扫描/哈希/改名/整理/清理/HTML
├── reverse_parse.py     # 按哈希反查 + info/metadata 生成
├── theme.py             # Mica/亚克力窗口效果
├── translator.py        # 可选在线翻译
└── user_config.json     # 本地配置（含你的 API Key）
```
