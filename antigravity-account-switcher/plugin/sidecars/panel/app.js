const accountsListEl = document.getElementById("accountsList");
const panelFetch=async(url,options)=>{const res=await (window.sidecar?.fetch?window.sidecar.fetch('/'+String(url).replace(/^\/+/,''),options):window.fetch(url,options));if(String(url).includes('api/switch')&&res.ok)window.parent.postMessage({type:'agy-account-switcher-updated'},'*');return res;};
const statusBannerEl = document.getElementById("statusBanner");
const addAccountPanelEl = document.getElementById("addAccountPanel");
const toggleAddBtn = document.getElementById("toggleAddBtn");
const closeAddBtn = document.getElementById("closeAddBtn");
const refreshQuotaBtn = document.getElementById("refreshQuotaBtn");
const newAccountLabelInput = document.getElementById("newAccountLabel");
const startOAuthBtn = document.getElementById("startOAuthBtn");
const copyOAuthUrlBtn = document.getElementById("copyOAuthUrlBtn");
const oauthWaitingBox = document.getElementById("oauthWaitingBox");
const oauthWaitingText = document.getElementById("oauthWaitingText");
const manualCallbackInput = document.getElementById("manualCallbackInput");
const submitManualCodeBtn = document.getElementById("submitManualCodeBtn");
const refreshTokenInput = document.getElementById("refreshTokenInput");
const importTokenBtn = document.getElementById("importTokenBtn");

let oauthPollTimer = null;
let isSwitching = false;

function showStatus(msg, type = "info", autoHideMs = 0) {
  statusBannerEl.className = `status-banner ${type}`;
  statusBannerEl.innerHTML =
    type === "info" && isSwitching
      ? `<span class="spinner"></span><span>${escapeHtml(msg)}</span>`
      : `<span>${escapeHtml(msg)}</span>`;
  statusBannerEl.classList.remove("hidden");
  if (autoHideMs > 0) {
    setTimeout(() => {
      statusBannerEl.classList.add("hidden");
    }, autoHideMs);
  }
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderQuotaSummary(quotaSummary) {
  if (!quotaSummary || !Array.isArray(quotaSummary.groups)) return "";
  const items = [];
  for (const g of quotaSummary.groups) {
    const isGemini = /gemini/i.test(g.displayName);
    const prefix = isGemini ? "Gemini" : "Claude/GPT";
    for (const b of g.buckets || []) {
      if (typeof b.remainingPercent !== "number") continue;
      const winLabel = b.window === "5h" ? "5小时" : "周额度";
      const pct = b.remainingPercent;
      const colorClass = pct >= 50 ? "high" : pct <= 15 ? "low" : "";
      items.push(`
        <div class="quota-item">
          <div class="quota-label-row">
            <span>${escapeHtml(prefix)} · ${winLabel}</span>
            <span class="quota-pct">${pct}%</span>
          </div>
          <div class="quota-bar">
            <div class="quota-fill ${colorClass}" style="width: ${Math.max(0, Math.min(100, pct))}%"></div>
          </div>
        </div>
      `);
    }
  }
  if (items.length === 0) return "";
  return `<div class="quota-grid">${items.join("")}</div>`;
}

function renderAccounts(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    accountsListEl.innerHTML = `
      <div class="account-card">
        <div>暂未检测到已保存的账号，请点击右上角「+ 添加账号」。</div>
      </div>
    `;
    return;
  }

  accountsListEl.innerHTML = accounts
    .map((acc) => {
      const initial = (acc.name || acc.email || "U").trim().charAt(0).toUpperCase();
      const avatarHtml = acc.picture
        ? `<img src="${escapeHtml(acc.picture)}" alt="" referrerpolicy="no-referrer" />`
        : `<span>${escapeHtml(initial)}</span>`;

      const rightActionHtml = acc.isCurrent
        ? `<span class="badge-current">● 当前使用中</span>`
        : `<button class="btn-switch" data-switch-email="${escapeHtml(acc.email)}">点击切换</button>
           <button class="btn-delete" data-delete-email="${escapeHtml(acc.email)}" title="从列表中移除此账号">✕</button>`;

      return `
        <div class="account-card ${acc.isCurrent ? "active" : "switchable"}" data-card-email="${escapeHtml(acc.email)}" data-is-current="${acc.isCurrent}">
          <div class="account-top">
            <div class="account-identity">
              <div class="avatar">${avatarHtml}</div>
              <div class="account-info">
                <div class="account-name-row">
                  <span class="account-name">${escapeHtml(acc.name || acc.email)}</span>
                  <span class="account-label-tag" data-edit-label="${escapeHtml(acc.email)}" title="点击修改账号备注">${escapeHtml(acc.label || "点击添加备注")} ✎</span>
                </div>
                <div class="account-email">${escapeHtml(acc.email)}</div>
              </div>
            </div>
            <div class="account-right">
              ${rightActionHtml}
            </div>
          </div>
          ${renderQuotaSummary(acc.quotaSummary)}
        </div>
      `;
    })
    .join("");

  // Attach events
  accountsListEl.querySelectorAll("[data-edit-label]").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      const email = el.getAttribute("data-edit-label");
      const currentText = el.textContent.replace(/\s*✎$/, "").trim();
      const nextLabel = window.prompt(`修改账号 ${email} 的备注名称：`, currentText);
      if (nextLabel === null) return;
      try {
        const res = await panelFetch("api/accounts/meta", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, label: nextLabel }),
        });
        const data = await res.json();
        if (data.ok) renderAccounts(data.accounts);
      } catch (err) {
        showStatus(`修改备注失败: ${err.message}`, "error", 4000);
      }
    });
  });

  accountsListEl.querySelectorAll("[data-delete-email]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const email = btn.getAttribute("data-delete-email");
      if (!window.confirm(`确定要从切换器列表中移除 ${email} 吗？`)) return;
      try {
        const res = await panelFetch("api/accounts/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = await res.json();
        if (data.ok) {
          renderAccounts(data.accounts);
          showStatus(`已移除账号 ${email}`, "success", 3000);
        }
      } catch (err) {
        showStatus(`移除失败: ${err.message}`, "error", 4000);
      }
    });
  });

  accountsListEl.querySelectorAll(".account-card.switchable").forEach((card) => {
    card.addEventListener("click", async () => {
      const email = card.getAttribute("data-card-email");
      if (email) await triggerAccountSwitch(email);
    });
  });
}

async function triggerAccountSwitch(email) {
  if (isSwitching) return;
  isSwitching = true;
  showStatus(`正在为您无缝切换至 ${email}（自动续期 Token 并热重载服务，约 2 秒完成）…`, "info");

  try {
    const res = await panelFetch("api/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.error || "切换失败");
    }
    showStatus(data.message || `已切换至 ${email}，正在重载窗口…`, "info");
  } catch (err) {
    isSwitching = false;
    showStatus(`切换账号失败: ${err.message}`, "error", 6000);
  }
}

async function loadAccounts() {
  try {
    const res = await panelFetch("api/accounts");
    const data = await res.json();
    if (data.ok) {
      renderAccounts(data.accounts);
    }
  } catch (err) {
    accountsListEl.innerHTML = `<div class="account-card">读取账号列表失败: ${escapeHtml(err.message)}</div>`;
  }
}

toggleAddBtn.addEventListener("click", () => {
  addAccountPanelEl.classList.toggle("hidden");
});

closeAddBtn.addEventListener("click", () => {
  addAccountPanelEl.classList.add("hidden");
});

refreshQuotaBtn.addEventListener("click", async () => {
  refreshQuotaBtn.disabled = true;
  showStatus("正在同步所有账号的最新模型配额…", "info");
  try {
    const res = await panelFetch("api/accounts/quota", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (data.ok) {
      renderAccounts(data.accounts);
      showStatus("所有账号额度与资料已更新", "success", 2500);
    }
  } catch (err) {
    showStatus(`刷新额度失败: ${err.message}`, "error", 4000);
  } finally {
    refreshQuotaBtn.disabled = false;
  }
});

function startPollingOAuthStatus() {
  if (oauthPollTimer) clearInterval(oauthPollTimer);
  oauthPollTimer = setInterval(async () => {
    try {
      const res = await panelFetch("api/oauth/status");
      const data = await res.json();
      if (data.status === "completed" && data.account) {
        clearInterval(oauthPollTimer);
        oauthPollTimer = null;
        oauthWaitingBox.classList.add("hidden");
        addAccountPanelEl.classList.add("hidden");
        newAccountLabelInput.value = "";
        showStatus(`🎉 成功添加账号: ${data.account.email}！点击该账号即可一键切换。`, "success", 6000);
        await loadAccounts();
        setTimeout(loadAccounts, 2000);
      } else if (data.status === "error") {
        clearInterval(oauthPollTimer);
        oauthPollTimer = null;
        showStatus(`授权失败: ${data.error}`, "error", 6000);
      }
    } catch {}
  }, 1200);
}

startOAuthBtn.addEventListener("click", async () => {
  startOAuthBtn.disabled = true;
  try {
    const label = newAccountLabelInput.value.trim();
    const res = await panelFetch("api/oauth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openBrowser: true, label }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "启动授权失败");
    oauthWaitingBox.classList.remove("hidden");
    oauthWaitingText.textContent = "已在浏览器打开 Google 账号选择页，请登录并同意授权…";
    startPollingOAuthStatus();
  } catch (err) {
    showStatus(`启动浏览器授权失败: ${err.message}`, "error", 5000);
  } finally {
    startOAuthBtn.disabled = false;
  }
});

copyOAuthUrlBtn.addEventListener("click", async () => {
  copyOAuthUrlBtn.disabled = true;
  try {
    const label = newAccountLabelInput.value.trim();
    const res = await panelFetch("api/oauth/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openBrowser: false, label }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "生成链接失败");
    await navigator.clipboard.writeText(data.authUrl);
    oauthWaitingBox.classList.remove("hidden");
    oauthWaitingText.textContent = "授权链接已复制到剪贴板！请粘贴到任意浏览器或无痕窗口完成登录授权…";
    showStatus("已复制 Google 授权链接！可粘贴到无痕窗口或另一个浏览器分身中登录要添加的新账号。", "success", 5000);
    startPollingOAuthStatus();
  } catch (err) {
    showStatus(`复制授权链接失败: ${err.message}`, "error", 5000);
  } finally {
    copyOAuthUrlBtn.disabled = false;
  }
});

submitManualCodeBtn.addEventListener("click", async () => {
  const codeOrUrl = manualCallbackInput.value.trim();
  if (!codeOrUrl) return;
  submitManualCodeBtn.disabled = true;
  try {
    const label = newAccountLabelInput.value.trim();
    const res = await panelFetch("api/oauth/manual", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codeOrUrl, label }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "手动授权失败");
    if (oauthPollTimer) clearInterval(oauthPollTimer);
    oauthWaitingBox.classList.add("hidden");
    addAccountPanelEl.classList.add("hidden");
    manualCallbackInput.value = "";
    renderAccounts(data.accounts);
    showStatus(`🎉 成功添加账号: ${data.account.email}`, "success", 5000);
  } catch (err) {
    showStatus(`手动提交失败: ${err.message}`, "error", 5000);
  } finally {
    submitManualCodeBtn.disabled = false;
  }
});

importTokenBtn.addEventListener("click", async () => {
  const refreshToken = refreshTokenInput.value.trim();
  if (!refreshToken) return;
  importTokenBtn.disabled = true;
  try {
    const label = newAccountLabelInput.value.trim();
    const res = await panelFetch("api/accounts/import-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken, label }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "导入失败");
    refreshTokenInput.value = "";
    addAccountPanelEl.classList.add("hidden");
    renderAccounts(data.accounts);
    showStatus(`🎉 成功导入账号: ${data.account.email}`, "success", 5000);
  } catch (err) {
    showStatus(`Refresh Token 导入失败: ${err.message}`, "error", 5000);
  } finally {
    importTokenBtn.disabled = false;
  }
});

loadAccounts();
// Refresh list once after 2.5s in case background quota enrichment completed
setTimeout(loadAccounts, 2500);
