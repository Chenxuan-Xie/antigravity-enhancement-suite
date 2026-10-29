# Antigravity Google 多账号无感热切换器 (`antigravity-account-switcher`)

为 Antigravity 桌面端提供 **Google 多账号管理、2 秒无感热切换、OAuth 2.0 离线授权添加与实时模型配额监控**。

---

## ✨ 核心特性

1. **双入口可视化管理**：
   - **原生设置页内嵌卡片 (`core/settings-injector.js`)**：打开 Antigravity `设置 -> 账号`，顶部直接呈现多账号切换与配额面板。
   - **右侧边栏独立面板 (`plugin/sidecars/panel`)**：支持在 IDE 右侧边栏随时打开账号管理面板。
2. **2 秒零登出无感热切换 (`core/hot-switch-worker.mjs`)**：
   - 自动将当前登录账号同步至本地账号库，绝不丢失已有登录态；
   - 切换目标账号时自动检查并刷新 OAuth `access_token`；
   - 根据账号 `id_token.aud` 自动匹配 Antigravity 新旧 OAuth 客户端，避免 `unauthorized_client` 刷新失败；
   - 自动写入 Antigravity 2.28+ 的 `antigravity-<credential-user-scope>`、兼容旧版 `gemini:antigravity`，并更新 `%APPDATA%\Antigravity\app_storage.json`；
   - 切换前校验目标账号是否有 Antigravity 使用许可；无许可账号会提示并保持当前账号，不会跳回登录页；
   - 通过独立进程仅重启后台 `language_server.exe`，Electron 主窗口与已打开代码工作区保持不变，2 秒内即可无缝切换至新账号。
3. **三种账号添加方式**：
   - **浏览器 OAuth 授权**：启动本地临时回调服务并拉起浏览器登录新 Google 账号，无需退出当前账号；
   - **手动回调 URL / 授权码解析**：支持复制粘贴回调地址完成授权；
   - **直接导入 `refresh_token`**：支持粘贴 `1//...` 格式的 Google Refresh Token 快速导入。
4. **智能代理识别与配额监控**：
   - 自动检测环境变量代理 (`HTTPS_PROXY` / `HTTP_PROXY`) 与 Windows 系统代理设置，支持 HTTP CONNECT 隧道与直连自动回退；
   - 一键查询并展示各账号下不同模型分组的剩余配额百分比与重置时间。

---

## 🔒 隐私与配置说明

- 账号数据在运行时自动保存在 `data/accounts.json`（已被 `.gitignore` 严格忽略，不会提交至 Git）。
- 仓库内的 [`data/accounts.example.json`](./data/accounts.example.json) 仅作为字段结构参考模板，请勿将真实 Token 写入示例文件或上传至公开仓库。
