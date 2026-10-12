# Antigravity 第三方 API / 中转站无缝切换器 (`antigravity-model-switcher`)

在 Antigravity 桌面端中接入任意支持 **OpenAI (`/v1/chat/completions`)** 或 **Anthropic / Claude (`/v1/messages`)** 协议的第三方 API 或 Token 中转站，支持原生聊天框模型菜单切换、思考强度调节、本地工具调用以及**同一对话内官方模型与第三方模型无缝切换**。

---

## ✨ 功能亮点

1. **原生聊天框无缝融合**：
   - 在聊天输入框左下角的模型菜单中直接展示您添加的第三方模型；
   - 使用第三方模型发送消息时，自动创建原生会话并保存至左侧历史列表，回复内容直接渲染在原生聊天气泡、Markdown 组件、思考折叠区与工具卡片中；
   - 原生输入框实时显示模型思考、回复输出、工具执行状态与响应计时，支持随时点击原生停止按钮中断生成。
2. **思考强度（Reasoning Effort）独立调节**：
   - 对支持深度思考的模型（如 Claude 3.7/4.x、OpenAI o1/o3/GPT-5、DeepSeek R1 等），在模型菜单中提供 **默认 / 低 / 中 / 高 / 最大** 思考强度子菜单，每个模型独立保存档位配置。
3. **同一对话双向无缝切换 (`core/context-bridge.mjs`)**：
   - **从官方模型切到第三方模型**：自动清理官方历史中不兼容的加密签名与内部标签，将上下文完整传递给第三方模型；
   - **从第三方模型切回官方模型**：发送新消息时自动将第三方模型的最新对话记录同步给官方模型，实现同一个会话窗口内自由混用不同模型。
4. **内置本地 Agent 工具与 MCP 服务**：
   - 为第三方模型提供本地文件读取 (`read_file`)、文件写入 (`write_file`)、代码片段替换 (`replace_in_file`)、目录浏览 (`list_dir`)、文本搜索 (`search_files`) 与终端命令执行 (`run_command`) 能力；
   - 内置标准 MCP Server (`api-model-switcher-mcp`)，支持通过自然语言对话直接添加、测试和切换模型。

---

## 🔒 隐私与配置说明

- 您添加的中转站地址与 `API Key` 在运行时保存在本地 `data/models.json` 中，会话桥接记录保存在 `data/bridges/` 中，均已被 `.gitignore` 排除，不会上传至 Git。
- 仓库内的 [`data/models.example.json`](./data/models.example.json) 仅作为配置文件格式参考示例。

---

## 🧪 本地自动化自检（可选）

如果您修改了插件源码，可运行以下隔离自检脚本验证功能（所有测试均在系统临时目录中使用本地模拟服务运行，不会调用真实 API 或修改您的个人配置）：

```powershell
node "./tools/regression.mjs"
node "./tools/verify-ui.mjs"
```
