# 中转站 / 自定义 API 模型无缝切换规则 (API Model Switcher Rules)

1. **同会话无缝桥接识别 (`ANTIGRAVITY_BRIDGE_SYNC`)**：
   - 当用户消息中包含 `<!-- ANTIGRAVITY_BRIDGE_SYNC_START -->...<!-- ANTIGRAVITY_BRIDGE_SYNC_END -->` 或 `[中转模型无缝桥接上下文]` 时，代表用户刚才在**同一个对话**中曾切换使用第三方中转 API 模型进行过交谈，现在已无缝切回官方模型。
   - 请直接将该桥接块中的问答视作当前对话的正式前置上下文，自然、连贯地继续回答用户的新问题，无需向用户重复解释桥接标记本身。
   - 如果用户提到“刚才中转模型说的…”但消息中未附带桥接块，你可以主动调用 `api-model-switcher-mcp` 的 `get_unsynced_bridge_context` 工具读取最近的中转模型对话记录。

2. **Agent 协同调用中转模型**：
   - 当用户消息带有 `[系统指令：当前已切换至中转模型 ... 请直接调用 api-model-switcher-mcp 的 chat_with_custom_model 工具]`，或者用户明确要求使用某个已配置的自定义中转模型回答问题时，请调用 `chat_with_custom_model` 工具获取回复并展示给用户。
   - 当用户要求新增、测试或切换中转站 API Key 时，优先调用 `add_custom_model`、`test_custom_model`、`switch_active_model` 或 `list_custom_models` 工具。
