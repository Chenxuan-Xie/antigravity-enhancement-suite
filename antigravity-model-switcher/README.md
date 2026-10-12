# Antigravity 第三方 API / 中转站无缝切换器 (`antigravity-model-switcher`)

在 Antigravity 桌面端中接入任意第三方 **OpenAI 兼容 (`/v1/chat/completions`)** 与 **Anthropic / Claude Code (`/v1/messages`)** 协议的 API 端点或 Token 中转站，支持原生聊天框模型菜单切换、思考强度（Reasoning Effort）调节、本地 Agent 工具调用以及**同会话官方模型与中转模型双向无缝桥接**。

---

## ✨ 核心机制与特性

- **顺序一致的模型切换与严谨校验**：模型切换等后端确认才更新界面，连续选择按顺序执行，过期刷新结果不能覆盖新选择。保存时校验地址、协议、数字参数；编辑时可保留现有密钥。
- **双协议与健壮 SSE 流式解析**：支持完整 API 端点或 Base URL，SSE 支持多行事件、分段 UTF-8、无末尾换行、普通 JSON 回退及结束标记；流式超时按连续无响应时间计算，持续思考和输出不会被固定总时长中断。
- **原生输入框实时状态与超时倒计时**：原生输入框显示正在接收思考、输出答复、执行工具或等待模型响应，并显示运行时长。支持点击原生停止按钮随时取消上游请求和正在执行的本地命令。
- **中转 Agent 自动续答与纠错策略**：不设固定执行轮数上限，长任务按需压缩请求上下文并保留原始任务和最近工具结果，完整会话记录保存在本地磁盘。短进度说明自动续答（最多 3 次），工具标签/参数格式错误和上游长度截断自动纠错（最多 4 次）。
- **原生聊天界面深度投影**：
  - 首条中转消息通过原生 `StartCascade` 创建空会话并写入原生摘要，直接进入正常会话列表，无需先调用一次官方模型。
  - 中转消息投影到原生步骤状态，由原生用户气泡、Markdown、思考折叠区、工具卡片和回复操作组件渲染。
  - 完整支持长聊天向上滚动时的分页索引映射、会话切换缓存恢复与原生会话删除同步。
- **原生模型菜单内嵌思考强度子菜单**：
  - 已识别支持思考强度的中转模型在原生模型菜单内提供强度子菜单，每个模型独立保存选择，输入框同步显示档位。
  - 协议映射：Anthropic 使用 `output_config.effort` 和自适应思考（Opus 4.5 使用符合预算约束的扩展思考）；OpenAI Chat Completions 使用 `reasoning_effort`；DeepSeek 使用 thinking 开关及支持的 effort 档位。
- **双向无状态上下文消毒与桥接 (`core/context-bridge.mjs`)**：
  - 从官方模型切换到中转模型时，自动剥离 `thinking.signature` 等不兼容字段；
  - 从中转模型切回官方模型时，自动在发送前附带未同步的中转对话记录，待官方 transcript 收到对应记录后确认同步。

---

## 🧪 隔离回归验证

所有回归脚本均使用本机模拟中转站、系统临时目录 (`os.tmpdir()`) 下的隔离模型文件和隔离会话，结束时自动清理，**不会调用真实中转站或修改用户的真实配置**：

```powershell
node "./tools/regression.mjs"
node "./tools/verify-ui.mjs"
node "./tools/verify-native-ui.mjs"
node "./tools/verify-native-pages.mjs"
node "./tools/verify-reasoning-ui.mjs"
node "./tools/verify-delete-ui.mjs"
node "./tools/verify-same-prompt-delete.mjs"
```

---

## 🔄 开发与热重载

修改前端注入脚本 `core/chat-injector.js` 或后端逻辑后，可在仓库根目录执行 `..\live-reload.ps1`，或依次执行：

```powershell
node "../antigravity-claude-skin/tools/build-i18n.js"
node "./tools/reload-runtime.mjs"
```

---

## 🔒 隐私与配置说明

- 您添加的中转站地址与 `apiKey` 在运行时保存在 `data/models.json`，会话桥接记录保存在 `data/bridges/`，均已被 `.gitignore` 严格排除。
- 仓库内的 [`data/models.example.json`](./data/models.example.json) 仅作为配置结构示例模板。
