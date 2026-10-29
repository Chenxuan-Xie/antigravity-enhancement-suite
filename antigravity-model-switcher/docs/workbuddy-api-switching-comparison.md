# WorkBuddy 同会话 API 切换机制对照

本文记录对 WorkBuddy 5.9.3 桌面端（`D:\应用数据\WorkBuddy\resources\app.asar`）同会话模型切换机制的静态分析结论，以及本套件据此采用的改进。

## 观察到的 WorkBuddy 做法

主要证据来自以下打包文件：

- `renderer/assets/workbuddy-provider-bpI7NE0V.js`
- `renderer/assets/ModelsSettingsPanel-DT-IyYEu.js`
- `main/server.js`（`SessionManager.updateSessionConfig` / `setSessionModel`）

关键行为：

1. **会话级模型状态**：`WorkbuddyAgentAdapterNext` 使用 `sessionModels = Map<sessionId, modelId>`，会话的 `activeSession.currentModelId` 是会话状态的一部分，而不是全局 UI 状态。
2. **切换只是更新会话配置**：`setSessionModel(sessionId, modelId)` 调用 `updateSessionConfig(sessionId, { model })`，由常驻的 SessionManager 把配置应用到已有会话；不需要新建会话，也不需要重新拼接历史。
3. **每次提问前校准模型**：`ensureSessionModelBeforeSend(sessionId, requestedModelId)` 会再次确认目标模型属于当前可用模型列表，然后写入会话配置；每条 prompt 的 `_meta` 同时携带 `modelId` 与 `modeId`。
4. **模型是会话运行时的一等配置**：自定义模型（`custom:` / `custom-local:`）与官方模型出现在同一个 `availableModels` 列表里；切换模型不会重建 Agent 运行时，工具、权限、会话消息队列与上下文都留在原 SessionManager 中。
5. **失效模型恢复**：对已删除/不可用的模型做 stale 检测，并提供兼容选项或回退到默认模型。

## 与本套件原实现的对比

| 维度 | WorkBuddy | 本套件原实现 |
| --- | --- | --- |
| 模型选择作用域 | 每个会话独立 `sessionModels` | 全局 `activeMode` / `activeModelId` |
| 切换方式 | 更新已有会话配置 | 切换 UI 通道 + 本地桥接历史 |
| 上下文存放 | 会话运行时统一保存 | 官方会话记录 + `bridges/` 自定义轮次双份记录 |
| 每条消息的模型标记 | prompt `_meta.modelId` / `_meta.modeId` | 由全局状态决定，切换会话可能串台 |
| 自定义模型 | 会话运行时的普通模型 | 由前端注入脚本单独渲染与转发 |
| 失效模型 | stale 检测 + 回退 | 全局回退到首个模型或官方 |

## 已采用的改进

- 在 `model-store.mjs` 增加 `selectionByConversation`，让每个会话记住自己的官方/中转模型选择；新建会话继续沿用最近一次全局选择。
- `/api/models` 与 `/api/models/select` 接收 `conversationId`；`chat-injector` 切换模型时携带当前会话 ID。
- 中转请求在缺少显式 `modelId` 时按当前会话的模型选择解析，避免切换会话后使用另一个会话的模型。
- 保留现有的 `context-bridge.mjs`：Antigravity 没有 WorkBuddy 那样的公开 SessionManager 配置接口，官方与第三方模型之间仍需做历史消毒和桥接。

## 未直接照搬的部分

WorkBuddy 的「切换只是改会话配置」依赖于它自己的 Agent Runtime 统一管理模型调用。Antigravity 的官方 Agent 与语言服务不开放同等的 provider 注入点，因此本套件仍采用「官方原生代理 + 本地中转 Agent」双通道，并通过桥接保持上下文。若后续 Antigravity 暴露模型 provider 配置接口，可以进一步把中转模型升级为原生会话的一等模型，届时可移除双份历史桥接。

静态分析只是打包代码事实，不代表 WorkBuddy 运行时一定按该路径执行；上表结论均以打包源码中的函数与状态字段为依据。
