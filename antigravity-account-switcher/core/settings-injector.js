/**
 * Antigravity Settings -> Account Native Multi-Account Switcher Widget
 * Automatically mounts inside the "设置 -> 账户 (Settings -> Account)" page
 * and talks to the local Account Switcher service on http://127.0.0.1:19823
 */
(() => {
  const API_BASE = "http://127.0.0.1:19823";
  const WIDGET_ID = "agy-settings-account-switcher";
  const STYLE_ID = "agy-settings-account-switcher-style";

  if (window.__agyAccountSwitcherCleanup) {
    try {
      window.__agyAccountSwitcherCleanup();
    } catch (_) {}
  }

  const css = `
    #${WIDGET_ID} {
      margin: 16px 0 20px 0;
      padding: 16px 18px;
      border-radius: 12px;
      border: 1px solid var(--agy-border-default, rgba(20, 20, 19, 0.12));
      background: var(--agy-bg-secondary, rgba(255, 255, 255, 0.75));
      color: var(--agy-text-primary, #141413);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.03);
    }
    .dark #${WIDGET_ID}, [data-theme="dark"] #${WIDGET_ID}, .theme-dark #${WIDGET_ID} {
      background: rgba(40, 39, 37, 0.85);
      border-color: rgba(236, 233, 226, 0.14);
      color: #ECE9E2;
    }
    #${WIDGET_ID} * {
      box-sizing: border-box;
    }
    .agy-as-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
      flex-wrap: wrap;
    }
    .agy-as-title-wrap {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .agy-as-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 600;
      margin: 0;
    }
    .agy-as-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #D97757;
      box-shadow: 0 0 0 3px rgba(217, 119, 87, 0.18);
    }
    .agy-as-sub {
      font-size: 12px;
      opacity: 0.68;
      margin: 0;
    }
    .agy-as-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .agy-as-btn {
      padding: 5px 11px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid rgba(20, 20, 19, 0.15);
      background: transparent;
      color: inherit;
      transition: all 0.15s ease;
    }
    .agy-as-btn:hover:not(:disabled) {
      border-color: #D97757;
      color: #D97757;
    }
    .agy-as-btn-primary {
      background: #D97757;
      color: #FFFFFF !important;
      border-color: #D97757;
      font-weight: 600;
    }
    .agy-as-btn-primary:hover:not(:disabled) {
      background: #C46344;
      border-color: #C46344;
    }
    .agy-as-status {
      margin-bottom: 10px;
      padding: 9px 12px;
      border-radius: 8px;
      font-size: 12.5px;
      font-weight: 500;
      background: rgba(217, 119, 87, 0.12);
      border: 1px solid rgba(217, 119, 87, 0.35);
      display: none;
    }
    .agy-as-status.show {
      display: block;
    }
    .agy-as-drawer {
      margin-bottom: 12px;
      padding: 12px;
      border-radius: 10px;
      border: 1px dashed rgba(217, 119, 87, 0.45);
      background: rgba(217, 119, 87, 0.04);
      display: none;
      flex-direction: column;
      gap: 9px;
    }
    .agy-as-drawer.show {
      display: flex;
    }
    .agy-as-input-row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .agy-as-input {
      flex: 1;
      min-width: 180px;
      padding: 6px 10px;
      border-radius: 7px;
      border: 1px solid rgba(20, 20, 19, 0.18);
      background: rgba(255, 255, 255, 0.8);
      color: #141413;
      font-size: 12.5px;
      outline: none;
    }
    .agy-as-input:focus {
      border-color: #D97757;
    }
    .agy-as-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .agy-as-card {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 11px 13px;
      border-radius: 10px;
      border: 1.5px solid rgba(20, 20, 19, 0.10);
      background: rgba(255, 255, 255, 0.55);
      transition: all 0.15s ease;
    }
    .dark .agy-as-card, [data-theme="dark"] .agy-as-card, .theme-dark .agy-as-card {
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.10);
    }
    .agy-as-card.switchable {
      cursor: pointer;
    }
    .agy-as-card.switchable:hover {
      border-color: #D97757;
      box-shadow: 0 3px 12px rgba(217, 119, 87, 0.10);
      transform: translateY(-1px);
    }
    .agy-as-card.current {
      border-color: #2E7D47;
      background: rgba(46, 125, 71, 0.05);
    }
    .agy-as-card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .agy-as-user {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      flex: 1;
    }
    .agy-as-avatar {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: rgba(217, 119, 87, 0.15);
      color: #D97757;
      font-weight: 700;
      font-size: 13px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      flex-shrink: 0;
    }
    .agy-as-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .agy-as-meta {
      min-width: 0;
      flex: 1;
    }
    .agy-as-name-line {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .agy-as-name {
      font-weight: 600;
      font-size: 13px;
    }
    .agy-as-tag {
      font-size: 11px;
      padding: 1px 7px;
      border-radius: 99px;
      background: rgba(20, 20, 19, 0.06);
      opacity: 0.85;
      cursor: pointer;
    }
    .agy-as-tag:hover {
      color: #D97757;
      opacity: 1;
    }
    .agy-as-email {
      font-size: 12px;
      opacity: 0.72;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .agy-as-badge-active {
      font-size: 11.5px;
      font-weight: 600;
      color: #2E7D47;
      background: rgba(46, 125, 71, 0.12);
      padding: 3px 10px;
      border-radius: 99px;
      white-space: nowrap;
    }
    .agy-as-quotas {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(135px, 1fr));
      gap: 6px;
      padding-top: 6px;
      border-top: 1px solid rgba(20, 20, 19, 0.07);
    }
    .agy-as-qitem {
      display: flex;
      flex-direction: column;
      gap: 3px;
      font-size: 11px;
      opacity: 0.85;
    }
    .agy-as-qrow {
      display: flex;
      justify-content: space-between;
    }
    .agy-as-qbar {
      height: 4px;
      border-radius: 99px;
      background: rgba(20, 20, 19, 0.10);
      overflow: hidden;
    }
    .agy-as-qfill {
      height: 100%;
      background: #D97757;
      border-radius: 99px;
    }
    .agy-as-qfill.high {
      background: #2E7D47;
    }
    .agy-as-qfill.low {
      background: #C94A4A;
    }
  `;

  function ensureStyle() {
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(el);
    }
    if (el.textContent !== css) el.textContent = css;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  let oauthPollTimer = null;

  function findAccountSettingsAnchor() {
    // Look for the Sign out / 退出登录 button on the Settings -> Account tab
    const buttons = Array.from(document.querySelectorAll("button"));
    const signOutBtn = buttons.find((b) => {
      const t = (b.textContent || "").trim();
      return t === "退出登录" || t === "Sign out" || t === "Sign Out" || t === "Log out";
    });
    if (!signOutBtn) return null;

    // Walk up to find the row/card container that holds the email + sign out button
    let curr = signOutBtn.parentElement;
    while (curr && curr !== document.body) {
      const text = curr.textContent || "";
      if (
        (text.includes("@") || text.includes("电子邮箱") || text.includes("Email")) &&
        curr.parentElement
      ) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return signOutBtn.parentElement;
  }

  function buildWidgetElement() {
    const root = document.createElement("div");
    root.id = WIDGET_ID;
    root.setAttribute("data-ag-i18n-skip", "true");
    root.innerHTML = `
      <div class="agy-as-header">
        <div class="agy-as-title-wrap">
          <div class="agy-as-title">
            <span class="agy-as-dot"></span>
            <span>多账号快速切换</span>
          </div>
          <p class="agy-as-sub">点击下方任意非当前账号即可无感切换（免退回登录页，约 2 秒自动生效）</p>
        </div>
        <div class="agy-as-actions">
          <button type="button" class="agy-as-btn" data-as-action="refresh">刷新额度</button>
          <button type="button" class="agy-as-btn agy-as-btn-primary" data-as-action="toggle-add">+ 添加一个新的账号</button>
        </div>
      </div>

      <div class="agy-as-status" data-as-role="status"></div>

      <div class="agy-as-drawer" data-as-role="drawer">
        <div style="font-size:12.5px;font-weight:600;">添加新 Google 账号（无需退出当前账号）</div>
        <div class="agy-as-input-row">
          <input type="text" class="agy-as-input" data-as-role="label-input" placeholder="账号备注（可选，如：备用账号 / 工作号）" />
          <button type="button" class="agy-as-btn agy-as-btn-primary" data-as-action="oauth-open">在浏览器中选择账号授权</button>
          <button type="button" class="agy-as-btn" data-as-action="oauth-copy" title="可粘贴到无痕窗口或其他浏览器分身登录新账号">复制授权链接</button>
        </div>
        <div class="agy-as-input-row" data-as-role="manual-row" style="display:none;">
          <input type="text" class="agy-as-input" data-as-role="manual-input" placeholder="正在等待浏览器授权完成… 若浏览器未自动回调，可在此粘贴回调 URL" />
          <button type="button" class="agy-as-btn" data-as-action="oauth-manual">手动提交</button>
        </div>
      </div>

      <div class="agy-as-list" data-as-role="list">
        <div style="font-size:12px;opacity:0.7;">正在加载已保存的账户列表…</div>
      </div>
    `;

    const statusEl = root.querySelector('[data-as-role="status"]');
    const drawerEl = root.querySelector('[data-as-role="drawer"]');
    const listEl = root.querySelector('[data-as-role="list"]');
    const labelInput = root.querySelector('[data-as-role="label-input"]');
    const manualRow = root.querySelector('[data-as-role="manual-row"]');
    const manualInput = root.querySelector('[data-as-role="manual-input"]');

    async function apiRequest(endpoint, bodyObj = null, maxRetries = 3) {
      let lastErr = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const opts = bodyObj !== null
            ? { method: "POST", body: JSON.stringify(bodyObj) }
            : { method: "GET" };
          const r = await fetch(`${API_BASE}${endpoint}`, opts);
          const d = await r.json();
          if (d && Array.isArray(d.accounts)) {
            try {
              localStorage.setItem("__agy_saved_accounts__", JSON.stringify(d.accounts));
            } catch (_) {}
          }
          return d;
        } catch (err) {
          lastErr = err;
          if (window.agyAccountSwitcher && typeof window.agyAccountSwitcher.wake === "function") {
            try {
              window.agyAccountSwitcher.wake();
            } catch (_) {}
          }
          if (attempt < maxRetries) {
            await new Promise((res) => setTimeout(res, 500));
          }
        }
      }
      throw lastErr || new Error("连接本地服务失败");
    }

    function setStatus(msg, autoHide = 0) {
      if (!msg) {
        statusEl.classList.remove("show");
        return;
      }
      statusEl.textContent = msg;
      statusEl.classList.add("show");
      if (autoHide > 0) {
        setTimeout(() => statusEl.classList.remove("show"), autoHide);
      }
    }

    function renderQuotas(qs) {
      if (!qs || !Array.isArray(qs.groups)) return "";
      const cells = [];
      for (const g of qs.groups) {
        const prefix = /gemini/i.test(g.displayName) ? "Gemini" : "Claude/GPT";
        for (const b of g.buckets || []) {
          if (typeof b.remainingPercent !== "number") continue;
          const win = b.window === "5h" ? "5h" : "周";
          const pct = b.remainingPercent;
          const cls = pct >= 50 ? "high" : pct <= 15 ? "low" : "";
          cells.push(`
            <div class="agy-as-qitem">
              <div class="agy-as-qrow">
                <span>${escapeHtml(prefix)} (${win})</span>
                <strong>${pct}%</strong>
              </div>
              <div class="agy-as-qbar">
                <div class="agy-as-qfill ${cls}" style="width:${Math.max(0, Math.min(100, pct))}%"></div>
              </div>
            </div>
          `);
        }
      }
      return cells.length ? `<div class="agy-as-quotas">${cells.join("")}</div>` : "";
    }

    function renderList(accounts) {
      if (!Array.isArray(accounts) || accounts.length === 0) {
        listEl.innerHTML = `<div style="font-size:12px;opacity:0.75;">暂无已保存账号，请点击右上角「+ 添加一个新的账号」。</div>`;
        return;
      }

      listEl.innerHTML = accounts
        .map((acc) => {
          const init = (acc.name || acc.email || "U").trim().charAt(0).toUpperCase();
          const avatar = acc.picture
            ? `<img src="${escapeHtml(acc.picture)}" alt="" referrerpolicy="no-referrer" />`
            : `<span>${escapeHtml(init)}</span>`;

          const right = acc.isCurrent
            ? `<span class="agy-as-badge-active">● 当前使用中</span>`
            : `<button type="button" class="agy-as-btn agy-as-btn-primary" data-switch="${escapeHtml(acc.email)}">点击切换</button>
               <button type="button" class="agy-as-btn" data-remove="${escapeHtml(acc.email)}" title="从列表移除">✕</button>`;

          return `
            <div class="agy-as-card ${acc.isCurrent ? "current" : "switchable"}" data-card-email="${escapeHtml(acc.email)}" data-current="${acc.isCurrent}">
              <div class="agy-as-card-top">
                <div class="agy-as-user">
                  <div class="agy-as-avatar">${avatar}</div>
                  <div class="agy-as-meta">
                    <div class="agy-as-name-line">
                      <span class="agy-as-name">${escapeHtml(acc.name || acc.email)}</span>
                      <span class="agy-as-tag" data-edit-tag="${escapeHtml(acc.email)}" title="点击修改备注">${escapeHtml(acc.label || "备注")} ✎</span>
                    </div>
                    <div class="agy-as-email">${escapeHtml(acc.email)}</div>
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:6px;">
                  ${right}
                </div>
              </div>
              ${renderQuotas(acc.quotaSummary)}
            </div>
          `;
        })
        .join("");

      listEl.querySelectorAll("[data-edit-tag]").forEach((tag) => {
        tag.addEventListener("click", async (e) => {
          e.stopPropagation();
          const email = tag.getAttribute("data-edit-tag");
          const cur = tag.textContent.replace(/\s*✎$/, "").trim();
          const next = window.prompt(`修改账号 ${email} 的备注名称：`, cur);
          if (next === null) return;
          try {
            const d = await apiRequest("/api/accounts/meta", { email, label: next });
            if (d.ok) renderList(d.accounts);
          } catch (err) {
            setStatus(`修改备注失败: ${err.message}`, 4000);
          }
        });
      });

      listEl.querySelectorAll("[data-remove]").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const email = btn.getAttribute("data-remove");
          if (!window.confirm(`确定要从快速切换列表中移除 ${email} 吗？`)) return;
          try {
            const d = await apiRequest("/api/accounts/delete", { email });
            if (d.ok) renderList(d.accounts);
          } catch (err) {
            setStatus(`移除失败: ${err.message}`, 4000);
          }
        });
      });

      listEl.querySelectorAll(".agy-as-card.switchable").forEach((card) => {
        card.addEventListener("click", async () => {
          const email = card.getAttribute("data-card-email");
          if (!email) return;
          setStatus(`⚡ 正在为您无缝切换至 ${email}（自动续期凭证并热重载服务，约 2 秒后自动刷新窗口）…`);
          try {
            const d = await apiRequest("/api/switch", { email });
            if (!d.ok) throw new Error(d.error || "切换失败");
            setStatus(d.message || `正在切换至 ${email}…`);
          } catch (err) {
            setStatus(`切换失败: ${err.message}`, 5000);
          }
        });
      });
    }

    async function fetchAccounts() {
      try {
        const cached = JSON.parse(localStorage.getItem("__agy_saved_accounts__") || "null");
        if (Array.isArray(cached) && cached.length > 0) {
          renderList(cached);
        }
      } catch (_) {}
      try {
        const d = await apiRequest("/api/accounts", null, 5);
        if (d.ok && Array.isArray(d.accounts)) {
          renderList(d.accounts);
        }
      } catch (_) {
        const hasCached = Boolean(listEl.querySelector(".agy-as-card"));
        if (!hasCached) {
          listEl.innerHTML = `<div style="font-size:12px;color:#C94A4A;display:flex;align-items:center;gap:8px;">
            <span>本地切换服务未响应</span>
            <button type="button" class="agy-as-btn" id="agy-as-retry-wake">点击一键唤醒</button>
          </div>`;
          const retryBtn = listEl.querySelector("#agy-as-retry-wake");
          if (retryBtn) {
            retryBtn.addEventListener("click", () => {
              if (window.agyAccountSwitcher && typeof window.agyAccountSwitcher.wake === "function") {
                try { window.agyAccountSwitcher.wake(); } catch (_) {}
              }
              fetchAccounts();
            });
          }
        }
      }
    }

    function startPollingOAuth() {
      if (oauthPollTimer) clearInterval(oauthPollTimer);
      oauthPollTimer = setInterval(async () => {
        try {
          const d = await apiRequest("/api/oauth/status", null, 1);
          if (d.status === "completed" && d.account) {
            clearInterval(oauthPollTimer);
            oauthPollTimer = null;
            manualRow.style.display = "none";
            drawerEl.classList.remove("show");
            setStatus(`🎉 已成功添加账号 ${d.account.email}！直接点击该账号即可一键切换。`, 6000);
            await fetchAccounts();
            setTimeout(fetchAccounts, 2000);
          } else if (d.status === "error") {
            clearInterval(oauthPollTimer);
            oauthPollTimer = null;
            setStatus(`授权未完成: ${d.error}`, 5000);
          }
        } catch (_) {}
      }, 1200);
    }

    root.querySelector('[data-as-action="toggle-add"]').addEventListener("click", () => {
      drawerEl.classList.toggle("show");
    });

    root.querySelector('[data-as-action="refresh"]').addEventListener("click", async () => {
      setStatus("正在刷新所有账号的最新模型配额…");
      try {
        const d = await apiRequest("/api/accounts/quota", {});
        if (d.ok) {
          renderList(d.accounts);
          setStatus("模型配额已更新", 2500);
        }
      } catch (err) {
        setStatus(`刷新失败: ${err.message}`, 4000);
      }
    });

    root.querySelector('[data-as-action="oauth-open"]').addEventListener("click", async () => {
      try {
        const label = labelInput.value.trim();
        const d = await apiRequest("/api/oauth/start", { openBrowser: true, label });
        if (!d.ok) throw new Error(d.error || "启动失败");
        manualRow.style.display = "flex";
        setStatus("已在浏览器中打开 Google 账号授权页，请选择您要添加的新账号并完成授权…");
        startPollingOAuth();
      } catch (err) {
        setStatus(`启动授权失败: ${err.message}`, 4000);
      }
    });

    root.querySelector('[data-as-action="oauth-copy"]').addEventListener("click", async () => {
      try {
        const label = labelInput.value.trim();
        const d = await apiRequest("/api/oauth/start", { openBrowser: false, label });
        if (!d.ok) throw new Error(d.error || "生成失败");
        await navigator.clipboard.writeText(d.authUrl);
        manualRow.style.display = "flex";
        setStatus("已复制授权链接！请粘贴到任意浏览器或无痕窗口登录您要添加的新 Google 账号。", 6000);
        startPollingOAuth();
      } catch (err) {
        setStatus(`复制链接失败: ${err.message}`, 4000);
      }
    });

    root.querySelector('[data-as-action="oauth-manual"]').addEventListener("click", async () => {
      const codeOrUrl = manualInput.value.trim();
      if (!codeOrUrl) return;
      try {
        const label = labelInput.value.trim();
        const d = await apiRequest("/api/oauth/manual", { codeOrUrl, label });
        if (!d.ok) throw new Error(d.error || "提交失败");
        if (oauthPollTimer) clearInterval(oauthPollTimer);
        manualRow.style.display = "none";
        drawerEl.classList.remove("show");
        manualInput.value = "";
        renderList(d.accounts);
        setStatus(`🎉 成功添加账号 ${d.account.email}！`, 5000);
      } catch (err) {
        setStatus(`手动提交失败: ${err.message}`, 4000);
      }
    });

    fetchAccounts();
    setTimeout(fetchAccounts, 2200);
    return root;
  }

  function checkAndMount() {
    ensureStyle();
    const anchor = findAccountSettingsAnchor();
    if (!anchor || !anchor.parentElement) return;

    const existing = document.getElementById(WIDGET_ID);
    if (existing && document.body.contains(existing)) return;

    const widget = buildWidgetElement();
    if (anchor.nextSibling) {
      anchor.parentElement.insertBefore(widget, anchor.nextSibling);
    } else {
      anchor.parentElement.appendChild(widget);
    }
  }

  checkAndMount();

  const obs = new MutationObserver(() => {
    checkAndMount();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });

  window.__agyAccountSwitcherCleanup = () => {
    try {
      obs.disconnect();
    } catch (_) {}
    if (oauthPollTimer) clearInterval(oauthPollTimer);
    const el = document.getElementById(WIDGET_ID);
    if (el) el.remove();
  };
})();
