# CivitaiFreeTool

> **免费 · 全功能 · 无付费墙** —— Civitai / HuggingFace 模型下载、管理、反向解析工具（Windows / Linux / macOS）

![Version](https://img.shields.io/badge/version-2.1.8-blue) ![License](https://img.shields.io/badge/license-MIT-green) ![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-orange) ![CI](https://github.com/ADVICEsama/CivitaiFreeTool/workflows/tests/badge.svg)

CivitaiFreeTool 是一款开箱即用的 AI 模型管理桌面工具：**批量下载 C 站 / HuggingFace 模型、本地模型管理（缩略图 / 改名 / 整理 / 校验）、反向解析（识别已下载模型）、ComfyUI 工作流分析**，全部功能免费开放。

配套 **Chrome 扩展**：浏览 C 站模型页时点击图标一键下载，直达软件下载管理（见下方「Chrome 扩展」）。

---

## ✨ 功能总览

### 🖥️ Chrome 扩展一键下载
- 浏览器打开 Civitai 模型页 → 点扩展图标 → 确认小窗（模型名 + 链接）→ 一键开始下载
- 软件自动切到「下载管理」页显示进度；解析失败小窗直接显示原因（代理 / 网络 / 权限）
- 右键页面或链接也可直达下载；扩展安装见 `chrome-extension/README.md`

### 📥 批量下载
- 支持 `civitai.red` / `civitai.com` / `huggingface.co`（仓库或文件直链）
- 粘贴多个链接一键解析入队；**点击后立即跳转下载管理页**（解析中按钮禁用，杜绝重复下载同一模型）
- 付费 / Early Access 模型自动识别：弹窗选择「加入到期提醒（自动判断免费时间）」或「仍要下载」
- 断点续传 · 并发下载 · 下载完成自动写元数据（`模型名.civitai.info` / WebUI 可读 `模型名.json`，含**触发词**）

### 📁 下载管理
- 实时进度 / 速度 / 剩余时间，暂停、重试、移除、清空已完成
- 列表缩略图 + 行右键菜单（打开文件夹 / 复制文件名 / 打开 C 站）
- 下载完成后可选移动到分类文件夹（弹窗显示封面缩略图）
- SHA256 完整性校验；下载到 HTML 页面（付费/失效）自动报错不写文件

### 🧩 模型管理
- 多目录扫描（WebUI `models` + ComfyUI `models` 合并显示），缩略图瀑布流 / 列表双视图
- **改名**：自定义（保留扩展名）/ **改成 C 站名** / 文件名翻译中文（批量）
- **整理模型**：目标环境（WebUI / ComfyUI）+ 三种模式（手动分类 / C 站 tags 自动两级分类 / 自定义规则）
- **🔧 恢复误整理**：按移动日志反向恢复，预览后执行，只移动不删除
- 校验完整性（哈希比对）· 清理冗余文件 · 下载封面图（走代理）· 翻译成中文 · 文件夹显示/隐藏
- 详情面板：多图画廊（本地图集 + C 站图）、触发词复制、右键复制图片 / 正面提示词 / 负面提示词
- 图片缓存清理：设置页一键删除 `模型名.images/` 文件夹

### 🔍 反向解析
- 把已下载的模型文件识别出 C 站信息：模型名、触发词、类型、基础模型，并生成封面
- 支持 SHA256 反查 + 百度翻译（设置页有免费申请指南）

### 🔬 工作流分析
- 拖入 / 选择 ComfyUI 的 `.json` / `.png` 工作流，解析节点、模型引用、正/负面提示词

### ⚙️ 设置
- **10 套主题**：深色 / 暮紫 / 深海 / 森林 / 熔岩 + 浅色 / 晴空 / 樱粉 / 薄荷 / 现代浅色
- 下载目录、API Key、百度翻译、代理（C 站被墙时启用）、界面缩放、启动默认页
- 分类规则（目标环境 / 整理模式 / 自定义规则）、维护（清理图片缓存）
- 新手引导：功能介绍页 + 逐步配置

### 💡 细节体验
- 全部按钮 / 菜单项带 **hover 浮窗备注**
- 关于弹窗：动态版本号 + 最近更新 + GitHub 直达；左上角 logo 点击同样打开关于
- 到期提醒（记录需等待免费的模型，到期自动提示）
- 断点续传失败自动重试、Windows Shell API 打开所在文件夹（无黑窗）

---

## 🚀 快速开始（Windows）

1. 从 **Releases** 下载 `CivitaiFreeToolWeb.exe`（单文件，免安装）
2. 双击运行，首次启动弹出引导：主题 → 下载目录 → API Key → 模型目录 → 反向解析
3. （可选）到 `civitai.com/user/account` 免费申请 API Key，模型查询更完整

> 配置保存在程序同目录 `user_config.json`（含 API Key，**请勿分享该文件**）

### 🌐 Linux / macOS

本仓库支持跨平台运行（社区贡献），安装与使用方法见 **[LINUX.md](LINUX.md)**（含依赖安装、已知限制）。

## 🧩 Chrome 扩展安装

1. 从 Releases 下载 `CivitaiFreeTool-ChromeExtension-*.zip` 并解压
2. Chrome 打开 `chrome://extensions/` → 开启「开发者模式」
3. 「加载已解压的扩展程序」→ 选择 `chrome-extension` 文件夹
4. 打开 CivitaiFreeTool（v2.1.0+）→ 浏览 C 站模型页 → 点击扩展图标一键下载

> 📄 图文安装说明与最新下载：**https://advicesama.github.io/CivitaiFreeTool/**（软件 + 扩展项目主页）

## 🧩 源码构建

```bash
# 依赖（Python 3.10+；Linux/macOS 另见 LINUX.md）
pip install pywebview pillow requests
# 打包（含 web 资源）
pyinstaller --onefile --windowed --name CivitaiFreeToolWeb \
  --add-data "web;web" --icon "icon.ico" \
  --version-file "version_info.txt" --hidden-import clr main_web.py
```

## ✅ 质量保障

- **CI 自动测试**：每次 push / PR 自动运行单测（GitHub Actions）
- **分支保护**：main 禁止强制推送 / 删除，合并前必须通过状态检查
- **社区贡献**：全部 PR 经审核合并（跨平台支持、稳定性修复等），感谢 [@guanhaisen](https://github.com/guanhaisen)、[@LckHot](https://github.com/LckHot)

## 📝 更新日志

### v2.1.x（2026-08 ~ 09）
- 🌐 **跨平台**：Linux / macOS 支持（posix_compat + Qt 后端 + 中文字体）
- 🖥️ **Chrome 扩展**：一键下载当前 C 站模型页（确认小窗 + 直接下载 + 自动切下载管理页）
- 🐛 修复：插件下载无缩略图（封面走代理）；触发词读不到（字段归一化）；改名丢失扩展名；打开 C 站跳主页；设置页底部遮挡；`import time` 缺失
- 🔒 main 分支保护 + CI 自动测试

### v2.0.0（2026-08）
- 10 套颜色主题；批量下载点击即反馈；下载管理缩略图 + 右键菜单；恢复误整理；多目录扫描；新手引导 6 步等

### v1.5.5.x（历史迭代）
- 本地 PNG 提示词识别 · 复制图片到剪贴板 · C 站 tags 两级分类 · 移动日志回退 · 待办自动时间 · 下载 HTML 检测等

---

## 🤝 反馈

- GitHub Issues：https://github.com/ADVICEsama/CivitaiFreeTool/issues
- 作者 B 站：https://space.bilibili.com/273101122
- 粉丝群：909810278

## 📄 License

MIT