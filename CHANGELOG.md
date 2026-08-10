# CivitaiFreeTool 更新日志（v1.5.1 → v1.5.2）

> 免费 · 全功能 · 无付费墙

---

## ✨ 整理模型全新设计（v1.5.2）

### 🐛 修复：整理后 ComfyUI / Forge 读不到模型
**根因**：旧整理逻辑无条件按「类型 + 基础模型」两层拼接目标目录，不检查模型是否已在类型目录下——已在 `Lora\` 里的模型被再移到 `Lora\SDXL\`、`Lora\Pony\` 等嵌套子目录；模型移走后空目录被整个删除（`Lora\` 目录消失，ComfyUI/Forge 自然读不到）；Checkpoint 还被放进了 Forge 不认的 `Checkpoint\` 目录（应为 `Stable-diffusion\`）。

### 📁 整理功能三模式
- **🎯 目标环境前置**：整理前必须先选择 WebUI/Forge 或 ComfyUI（目录名不同：`Lora/loras`、`Stable-diffusion/checkpoints`），未选择时按钮拦截提示，防止再乱移
- **手动分类**（默认）：逐个弹窗选择目标文件夹，完全由你决定
- **C 站 tags 自动分类**：按模型 info 里的 C 站分类标签（Style / Pose / Character / Anime / Clothing / Concept / Backgrounds 等 15 类）分类到 `<类型目录>/<基础模型>/<分类>` 两级目录——光辉、noob、anima 等基础模型作第一级，pose / style 作第二级
- **自定义规则**：关键词 → 文件夹（原有功能）

### 🛡️ 安全兜底
- 无匹配 tags 的模型**保持原位不动**
- animatediff、onnx、clip、optical flow 等未知类型目录**一律不碰**
- 类型根目录（`Lora/`、`loras/` 等）**永不删除**

### 🔧 恢复误整理（新功能）
- 选择环境 + 自动分类模式后，工具栏出现「🔧 恢复误整理」按钮
- 每次整理自动记录 `organize_log.json` 移动日志（时间/源/目标）
- 恢复 = 日志反向回退 + 扫描非标准目录，**预览清单后确认执行**，只移动不删除，json / 封面随行

---

## 🔧 修复与优化（v1.5.1）

### 🐛 修复
- **工作流分析**：拖入大文件解析报「Maximum call stack size exceeded」栈溢出 → 改为迭代解析
- **瀑布流**：切换到瀑布流后无法切回列表视图
- **图片下载**：下载全部图片时新图出现在 6-9 位、2-4 位空占位 → 顺序与占位修复
- **图片右键菜单**：详情图右键菜单无法弹出（变量作用域 ReferenceError 崩溃）→ 提升为全局变量
- **右键菜单定位错位**：缩放后菜单位置偏移 → 迭代校正 + rAF 二次校准双保险
- **作者显示去重**：详情页只保留一个可点击复制的作者徽章

### ✨ 优化
- **确认弹窗按钮位置**：默认「确定」在左、「取消」在右（防误触），设置页可一键翻转回旧布局
- API Key / 百度密钥输入框改为**密码框**（默认隐藏），带**小眼睛**切换明文

---

## 📦 下载

- **GitHub Releases**：https://github.com/ADVICEsama/CivitaiFreeTool/releases
- 配置保存在程序同目录 `user_config.json`（含 API Key，**请勿分享该文件**）
