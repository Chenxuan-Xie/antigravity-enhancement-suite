# Antigravity Claude Desktop Skin + 简体中文汉化引擎

专为 **Antigravity 2.0 桌面端** 深度定制的 **Claude Desktop 羊皮纸暖白 + 中西文人文衬线（书卷风）主题皮肤 + 简体中文全量界面汉化引擎**（深度融合 [`Silas-02/antigravity-desktop-cn`](https://github.com/Silas-02/antigravity-desktop-cn) 并补齐 Antigravity v2.22.0+ 新增词条）。

---

## 1. 核心视觉、排版与中文汉化体系

### 色彩体系（Light Mode: Warm Parchment 羊皮纸暖白）
| 界面区域 | 变量 / 选择器 | 颜色值 | 视觉说明 |
| :--- | :--- | :--- | :--- |
| **主对话画布 & 顶部栏** | `--background` / `--content` | `#FAF9F5` | 温润羊皮纸暖白，消除刺眼冷白光 |
| **左侧边栏 & 用户提问气泡** | `--sidebar` / `user-input-step` | `#F0EEE6` | 暖亚麻灰米色，柔和区分功能层级 |
| **底部胶囊输入框（外框/内卡）** | `.rounded-2xl.bg-card-border` | `#EFECE3` / `#FDFCF8` | 微暖象牙白悬浮卡片，聚焦时切换纯白并带暖橙微光 |
| **品牌强调色（Claude 赤陶橙）** | `--primary` / `--link` | `#D97757` / `#C6613F` | 按钮、开关、加载微光（`--shimmer-peak`）、超链接 |
| **代码块与行内代码** | `.rounded-xl.bg-muted.border` | `#F4F2EA` / `#EAE7DD` | 暖砂岩卡片配 `#9A3E20` 赤陶深褐行内代码 |
| **深色模式兼容（Warm Charcoal）** | `body.theme-dark` | `#1F1E1D` / `#161514` | 同步适配 Claude 深色暖炭黑模式 |

### 字体与排版体系（离线内嵌，零外部网络依赖）
- **AI 回复正文与 Markdown 标题（人文衬线体 Bookish Serif）**：
  - 字体栈：`'ClaudeSerif'`（内嵌离线 Base64 `Source Serif 4` 可变衬线体）+ `'Noto Serif SC'`（思源宋体可变字体）+ `'STZhongsong'`（华文中宋）。
  - 参数：`font-size: 15.5px`、`font-weight: 450`（粗体 `650`）、`line-height: 1.76`、`font-optical-sizing: auto`，中英文混排基线自然对齐，笔画温润饱满不发虚。
- **UI 控件与用户提问气泡（现代无衬线体 Sans-Serif）**：
  - 字体栈：`'Inter'`, `-apple-system`, `'Segoe UI'`, `'Noto Sans SC'`, `'Microsoft YaHei'`。
  - 形成 Claude 标志性的 **“你的提问现代干练、AI 的回答温润如书”** 的阅读层次。
- **代码块与行内代码（等宽字体 Monospace）**：
  - 字体栈：`'Cascadia Code'`, `'JetBrains Mono'`, `'Consolas'`。

### 简体中文全量汉化体系（无损融合，零冲突）
- **词典库与动态翻译**：完整收录 `Silas-02/antigravity-desktop-cn` 全部 7 大词库（`common.json`、`menu_nav.json`、`page_agents.json`、`page_mcp_knowledge.json`、`page_settings.json`、`page_workspaces.json`、`v2.21.1.json`）及 **Antigravity v2.22.0+ 专属增量词库 (`v2.22.0_overlay.json`)**，总计 **2,126 条** 词条与动态正则规则。
- **全场景覆盖**：
  1. **前端界面与 Shadow DOM**：顶栏菜单（`文件` / `视图` / `窗口`）、左侧边栏（`新建会话` / `会话历史` / `自动化` / `个性化定制` / `项目` / `会话` / `设置`）、相对时间（`刚刚` / `X分钟前` / `X小时前`）、输入框占位符（`提问任何问题，使用 @ 提及，/ 执行操作`）、工具调用状态（`工作了 X 分钟` / `探索了 X 个文件`）、悬停提示（`aria-label` / `title`）及设置页全部动态汉化。
  2. **Electron 原生菜单与托盘**：主进程原生钩子直接接管 `Menu.buildFromTemplate` 与 `Menu.setApplicationMenu`，无需解包或破坏 `app.asar`，即可完整汉化原生右键菜单（`重命名` / `归档` / `删除` / `向右拆分` 等）、系统托盘菜单（`无运行中的智能体` / `打开 Antigravity` / `退出`）与更新提示弹窗。
  3. **代码与输入保护**：严格跳过用户提问气泡 (`[data-testid="user-input-step"]`)、代码块 (`CODE` / `PRE`)、Monaco 编辑器与终端，绝不污染代码内容或影响 Claude 皮肤样式。

---

## 2. 更新恢复与外置启动架构

启动器位于 `tools/native-bootstrap.cjs`，`resources/app/index.js` 仅委托给它，并按当前 `app.asar/package.json` 的 `main` 和 `version` 启动官方入口。安装、自愈与兼容的 `patch-asar-inplace.js` 入口均不再改写 ASAR，消除了 `preload.js` 和 `languageServer.js` 的定长槽位限制，也不会拿旧备份覆盖更新后的官方归档。

自愈由以下链路负责：
- 当前用户 `Run` 项负责登录启动。计划任务“Antigravity Claude Skin Guardian”同样在登录触发，并每分钟检查/重新启动；进程异常退出后按分钟重试，任务运行中忽略重复实例。
- 隐藏运行的守护每 10 秒检查切换后端、外置启动器和窗口注入。检查进程身份后处理陈旧 PID，避免把复用 PID 的其他进程当作守护。
- 文件事件与心跳共同覆盖应用资源替换；先确认归档稳定，再恢复启动器和最新版本元数据。恢复时官方 ASAR 保持字节不变。
- CDP 会校验环境端口、已发现端口和端口文件，失败后查询 Antigravity 进程实际监听端口，重新读取当前浏览器 WebSocket 路径；不改写应用自己的 `DevToolsActivePort`。
- 汉化/聊天 bundle 带内容标识，相同版本重复注入不清理或重新挂载界面；正在生成时跳过更新，后续心跳再处理。

---

## 3. 常用管理命令（PowerShell）

推荐使用仓库根目录下的统一脚本 `..\install-all.ps1`、`..\live-reload.ps1` 和 `..\uninstall-all.ps1`。也可以在本目录中单独执行：

### 一键安装 / 重新激活（Claude 皮肤 + 简体中文汉化）
```powershell
.\install-claude-skin.ps1
```

### 修改样式或词条后手动触发实时热重载（无需重启软件）
编辑 `src\claude-core.css`（样式）或 `i18n\dicts\v2.22.0_overlay.json`（自定义汉化词条）后保存，使用下面的命令构建并热重载：
```powershell
.\live-reload.ps1
```

### 停止守护并移除外置皮肤入口
```powershell
.\restore-default.ps1
```
