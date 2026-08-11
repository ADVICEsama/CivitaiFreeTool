# CivitaiFreeTool v2.0

> **免费 · 全功能 · 无付费墙** —— Civitai / HuggingFace 模型下载、管理、反向解析工具（Windows 桌面版）

![Version](https://img.shields.io/badge/version-2.0.0-blue) ![License](https://img.shields.io/badge/license-MIT-green) ![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-orange)

CivitaiFreeTool 是一款开箱即用的 AI 模型管理桌面工具：**批量下载 C 站 / HuggingFace 模型、本地模型管理（缩略图 / 改名 / 整理 / 校验）、反向解析（识别已下载模型）、ComfyUI 工作流分析**，全部功能免费开放。

---

## ✨ 功能总览

### 📥 批量下载
- 支持 `civitai.red` / `civitai.com` / `huggingface.co`（仓库或文件直链）
- 粘贴多个链接一键解析入队；**点击后立即跳转下载管理页**（解析中按钮禁用，杜绝重复下载同一模型）
- 付费 / Early Access 模型自动识别：弹窗选择「加入到期提醒（自动判断免费时间）」或「仍要下载」
- 断点续传 · 并发下载 · 下载完成自动写元数据（`模型名.civitai.info` / WebUI 可读 `模型名.json`）

### 📁 下载管理
- 实时进度 / 速度 / 剩余时间，暂停、重试、移除、清空已完成
- 下载完成后可选移动到分类文件夹（弹窗选择目标目录）
- SHA256 完整性校验；下载到 HTML 页面（付费/失效）自动报错不写文件

### 🧩 模型管理
- 多目录扫描（WebUI `models` + ComfyUI `models` 合并显示），缩略图瀑布流 / 列表双视图
- **改名**：自定义 / **文件名改成 C 站名** / 文件名翻中文（批量）
- **整理模型**：目标环境（WebUI / ComfyUI）+ 三种模式（手动分类 / C 站 tags 自动两级分类 / 自定义规则），未选环境时拦截提示
- **🔧 恢复误整理**：按移动日志反向恢复，预览后执行，只移动不删除
- 校验完整性（哈希比对）· 清理冗余文件 · 下载封面图 · 翻译成中文 · 文件夹显示/隐藏
- 详情面板：多图画廊（本地图集 + C 站图）、触发词复制、**右键复制图片到剪贴板 / 正面提示词 / 负面提示词**（本地 PNG 元数据优先识别）
- 图片缓存清理：设置页一键删除 `模型名.images/` 文件夹

### 🔍 反向解析
- 把已下载的模型文件识别出 C 站信息：自动匹配模型名、触发词（tags）、类型、基础模型，并生成封面
- 支持 SHA256 反查 + 百度翻译（设置页有免费申请指南）

### 🔬 工作流分析
- 拖入 / 选择 ComfyUI 的 `.json` / `.png` 工作流，解析节点、模型引用、正/负面提示词

### ⚙️ 设置
- **10 套主题**：深色 / 暮紫 / 深海 / 森林 / 熔岩（暗色系）+ 浅色 / 晴空 / 樱粉 / 薄荷 / 现代浅色（亮色系）
- 下载目录、API Key、百度翻译、界面缩放（Ctrl+滚轮）、启动默认页、模型管理默认视图
- 分类规则（目标环境 / 整理模式 / 自定义规则）、维护（清理图片缓存）
- 新手引导：功能介绍页（六页面 hover 简介 + GitHub 直达）+ 逐步配置

### 💡 细节体验
- 所有按钮 / 菜单项带 **hover 浮窗备注**（歧义词已全部改为大白话）
- 关于弹窗：动态版本号 + 最近更新 + **GitHub 一键直达**；左上角 logo 点击同样打开关于
- 到期提醒（记录需等待免费的模型，到期自动提示）
- 断点续传失败自动重试、Windows Shell API 打开文件所在文件夹（无黑窗、路径 100% 正确）

---

## 🚀 快速开始

1. 从 **Releases** 下载 `CivitaiFreeToolWeb.exe`（单文件，免安装）
2. 双击运行，首次启动会弹出引导：主题 → 下载目录 → API Key → 模型目录 → 反向解析
3. （可选）到 `civitai.com/user/account` 免费申请 API Key，模型查询更完整

> 配置保存在程序同目录 `user_config.json`（含 API Key，**请勿分享该文件**）

## 🧩 源码构建

```bash
# 依赖（Python 3.10+）
pip install pywebview pillow requests
# 打包（含 web 资源）
pyinstaller --onefile --windowed --name CivitaiFreeToolWeb \
  --add-data "web;web" --icon "icon.ico" \
  --version-file "version_info.txt" --hidden-import clr main_web.py
```

## 📝 更新日志

### v2.0.0（2026-08-11）
- 🎨 **10 套颜色主题**：暗色系新增 暮紫 / 深海 / 森林 / 熔岩，亮色系新增 晴空 / 樱粉 / 薄荷（设置页与新手引导均可切换）
- ⚡ **批量下载点击即反馈**：点「解析并加入下载队列」立即跳转下载管理页，解析期间按钮禁用——不再因等待过久重复点击导致同一模型重复下载
- 🏷️ 版本号更新至 v2.0，关于页动态显示 + 最近更新内容 + GitHub 直达按钮；左上角 logo 点击打开关于
- 🧹 设置页新增「维护」区块：一键清理图片缓存文件夹（`模型名.images/`）
- 💬 右键图片复制「图片本身 / 正面提示词 / 负面提示词」（本地 PNG 元数据优先识别）
- 📂 打开所在文件夹改用 Windows Shell API（无黑窗、带空格路径 100% 正确）
- ⏰ 到期提醒自动判断 C 站免费时间；歧义词全面优化 + 全量 hover 备注

### v1.5.5.x（历史迭代）
- 本地 PNG 提示词本地识别 · 复制图片到剪贴板 · 恢复误整理 · 环境目录映射（WebUI/ComfyUI）· C 站 tags 两级分类 · 移动日志回退 · 多目录扫描 · 新手引导 6 步 · 待办自动时间 · 下载 HTML 检测等

---

## 🤝 反馈

- GitHub Issues：https://github.com/ADVICEsama/CivitaiFreeTool/issues
- 作者 B 站：https://space.bilibili.com/273101122
- 粉丝群：909810278

## 📄 License

MIT
