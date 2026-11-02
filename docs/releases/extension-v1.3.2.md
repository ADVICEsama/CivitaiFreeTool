# Firefox 商店提交修复 1.3.2

- 补充 Mozilla 新扩展必需的 data_collection_permissions，声明 browsingActivity。
- 仅在用户主动发送时，将选中的 Civitai 模型 URL 发送到本机 127.0.0.1:47531；不向开发者发送浏览记录或分析数据。发送历史保存在浏览器本地。
- 最低 Firefox 版本设为 140，以使用内置的数据传输同意提示；不新增任何第三方服务器。
- Chrome 扩展不受此 Firefox 专属声明影响。

重新上传本版本，旧的 1.3.1 ZIP 不包含声明。最终仍需 Mozilla 验证和审核。
