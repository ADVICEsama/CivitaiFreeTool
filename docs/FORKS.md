# Fork 检查（2026-10-07）

基准：主仓库提交 `c03a9cb9a6f4bdb013dfa59e1f8ba78938e0da8a`。只读检查了公开 Fork、默认分支与 GitHub compare；没有运行、自动合并或重置外来代码。本记录是该日期的快照，不是持续监控。

## 结论与可借鉴点

- 16 个公开 Fork 中，14 个可直接比较的默认分支都没有主仓库尚未包含的提交（ahead=0），只处于落后状态。因此当前没有可直接挑选的新提交。
- `yiyays` 与 `pattoneirc` 的旧历史无法与当前主分支直接 compare。进一步查看默认分支文件树和最近提交，两者保留早期 GUI/网页布局及三张 screenshots；最近提交主要更新 README。这不等于完成了其全部代码的逐行审计。
- 文档的“功能介绍 + 入门步骤 + 多张界面截图”组织方式值得参考，本轮 README 已补齐当前版本的图文示例。没有复制这些旧 Fork 的图片、代码或配置。
- 当前工作台、历史记录和原生窗口已经有自己的框架。不能因为 Fork 名字或提交时间就整包替换；未来确有独立功能，应先按差异、许可、数据迁移和回归结果筛选。

## 分支状态

| Fork | 检查结果 |
| --- | --- |
| [zuiyi233/CivitaiFreeTool](https://github.com/zuiyi233/CivitaiFreeTool) | 没有独立提交；落后 84 个提交 |
| [FuwaFoxx/CivitaiFreeTool](https://github.com/FuwaFoxx/CivitaiFreeTool) | 没有独立提交；落后 99 个提交 |
| [LckHot/CivitaiFreeTool](https://github.com/LckHot/CivitaiFreeTool) | 没有独立提交；落后 99 个提交 |
| [lunasoul/CivitaiFreeTool](https://github.com/lunasoul/CivitaiFreeTool) | 没有独立提交；落后 105 个提交 |
| [Felix1723/CivitaiFreeTool](https://github.com/Felix1723/CivitaiFreeTool) | 没有独立提交；落后 105 个提交 |
| [Wu228271813/CivitaiFreeTool](https://github.com/Wu228271813/CivitaiFreeTool) | 没有独立提交；落后 105 个提交 |
| [2233admin/CivitaiFreeTool](https://github.com/2233admin/CivitaiFreeTool) | 没有独立提交；落后 105 个提交 |
| [windExplorer/CivitaiFreeTool](https://github.com/windExplorer/CivitaiFreeTool) | 没有独立提交；落后 105 个提交 |
| [suofang/CivitaiFreeTool](https://github.com/suofang/CivitaiFreeTool) | 没有独立提交；落后 105 个提交 |
| [guanhaisen/CivitaiFreeTool](https://github.com/guanhaisen/CivitaiFreeTool) | 没有独立提交；落后 112 个提交 |
| [orangewoker/CivitaiFreeTool](https://github.com/orangewoker/CivitaiFreeTool) | 没有独立提交；落后 114 个提交 |
| [liyebin520555/CivitaiFreeTool](https://github.com/liyebin520555/CivitaiFreeTool) | 没有独立提交；落后 114 个提交 |
| [sjf9179/CivitaiFreeTool](https://github.com/sjf9179/CivitaiFreeTool) | 没有独立提交；落后 114 个提交 |
| [lhzero2000/CivitaiFreeTool](https://github.com/lhzero2000/CivitaiFreeTool) | 没有独立提交；落后 133 个提交 |
| [yiyays/CivitaiFreeTool](https://github.com/yiyays/CivitaiFreeTool) | 旧历史无法直接比较；查看了文件树和最近提交 |
| [pattoneirc/CivitaiFreeTool](https://github.com/pattoneirc/CivitaiFreeTool) | 旧历史无法直接比较；查看了文件树和最近提交 |
