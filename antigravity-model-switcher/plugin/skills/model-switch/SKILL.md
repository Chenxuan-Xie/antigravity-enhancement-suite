---
name: model-switch
description: 管理 Antigravity 中的第三方 Token 中转站 / 自定义 API 模型（支持 OpenAI 与 Claude Code 协议），执行连接测试并在同一会话中无缝切换官方模型与自定义模型。
---

# 中转站 API 模型无缝切换技能 (`model-switch`)

当用户需要添加中转站模型、测试 API Key 连通性、或者在当前对话中切换自定义模型与官方模型时，使用本技能与 `api-model-switcher-mcp` 工具集。

## 可用操作
1. **查看已配置的模型与桥接状态**：调用 `list_custom_models`。
2. **新增中转模型并测试连接**：调用 `add_custom_model`（传入 `name`、`modelId`、`baseUrl`、`apiKey`、`protocol`）。
3. **单独测试连接**：调用 `test_custom_model`。
4. **同会话切换模型**：调用 `switch_active_model`（`mode: "custom"` 或 `mode: "official"`）。
5. **打开右侧可视化面板**：可在对话中输出 `<ui-plugin-pill id="api-model-switcher.panel" label="中转模型无缝切换面板" />` 引导用户一键展开右侧管理面板。
