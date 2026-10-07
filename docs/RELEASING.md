# 修复后的发布流程

维护约定：每次修复后，检查并提交当前源码到 GitHub，然后发布对应版本 Release，附带 Chrome 与 Firefox 扩展。

1. 在隔离目录运行后端、桥服务与前端回归检查；涉及原生窗口时另做实际窗口验证。
2. 同步版本号、更新日志与 `docs/releases/v<版本>.md`。保留现有下载任务、历史及模型数据。
3. Windows 使用 Python 3.12，安装 `requirements.txt` 与 PyInstaller，执行 `python -m PyInstaller -y CivitaiFreeToolWeb.spec`。Spec 自动用 Windows 自带 .NET Framework 编译器编译 `native/CftChrome.cs`。
4. 校验 EXE 中的页面、后端版本、原生 DLL、托盘与 Tcl/Tk。备份旧 EXE 后替换本机安装，确认原生窗口启动。
5. 只提交应用源码、长期测试与发布文档；**不能上传 API Key、用户配置、任务/历史 JSON、图片缓存或用户模型/素材目录**。
6. 正常推送 main，不强推。附件清单须绑定这次提交的完整 SHA。
7. Release 附件为版本号 EXE、Windows 便携 ZIP、Chrome 扩展 ZIP、Firefox 扩展 ZIP、源码 ZIP、SHA256SUMS.txt；扩展 ZIP 的 manifest.json 必须位于根目录，不嵌套旧 ZIP。
8. `python scripts/release_github.py <版本> docs/releases/v<版本>.md --assets-dir <附件目录>` 只发布完整、哈希匹配的附件：先草稿，上传并验证远端 SHA256/大小，全部通过后才公开。出错保持草稿，不把“建了 Release”当作完成。

认证使用环境变量或 Git Credential Manager，认证信息不写日志、源码、清单或聊天。Firefox 包未签名，仅支持临时加载；永久安装需要 Mozilla 签名。
