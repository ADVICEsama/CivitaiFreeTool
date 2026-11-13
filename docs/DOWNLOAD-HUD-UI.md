# 下载悬浮窗布局修正（2026-11-13）

- 与主窗口共用 endfield-controls / endfield-global-actions 的字体、主题令牌、胶囊渲染器；不是另一套按钮。
- 默认拉丁字母 LINE Seed Sans，数字 Geource Sans Alt，中文 HarmonyOS Sans SC；继承用户的字体栈与分文字回退设置。
- 外壳纵向 flex；任务区独立滚动，底部状态与打开下载管理按钮固定留在外壳底部内边距内。取消固定 155px 列表高度。
- 原生缩放同时设置 --hud-scale，补偿根 zoom 对视口高度的影响。
- 截图使用默认字体，不把 Arial / Consolas 回退测试的截图当成正式外观。
- tests/test_download_hud.cjs 已检查两主题、字体回退、75/100/150% 缩放贴底、任务动作及隐藏，不接触真实下载。
- 原生 Windows 窗口的实际拖动与更新安装尚未验收；本轮已构建 3.0.11；公开发布状态以对应 Release 为准。
