const PRESETS = [
  { label: "Claude 3.7 中转", modelId: "claude-3-7-sonnet-20250219", protocol: "auto" },
  { label: "Claude 4.5 Sonnet", modelId: "claude-sonnet-4-5-20250929", protocol: "auto" },
  { label: "Claude 4.6 Opus", modelId: "claude-opus-4-6", protocol: "auto" },
  { label: "GPT-4o", modelId: "gpt-4o", protocol: "openai" },
  { label: "DeepSeek V3", modelId: "deepseek-chat", protocol: "openai" },
  { label: "DeepSeek R1", modelId: "deepseek-reasoner", protocol: "openai" },
];

let appState = {
  activeMode: "official",
  activeModelId: null,
  models: [],
  providers: [],
  providerPresets: [],
  bridge: null,
  editingId: null,
};

async function apiRequest(subpath = "", options = {}) {
  const fetchOpts = {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
  };
  if (options.body) {
    fetchOpts.body = JSON.stringify(options.body);
  }
  fetchOpts.signal = AbortSignal.timeout(30000);
  // A failed mutation must not be replayed against a different server.
  const request = window.sidecar?.fetch ? window.sidecar.fetch.bind(window.sidecar) : window.fetch.bind(window);
  const res = await request(`/api/models${subpath}`, fetchOpts);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

window.addEventListener("unhandledrejection", event => {
  showTestBanner({ ok: false, error: event.reason?.message || String(event.reason) });
  event.preventDefault();
});

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function updateProviders(){
  const select=document.getElementById('providerSelect'),selected=select.value;
  select.innerHTML='<option value="">新服务商 / 自定义</option>';
  for(const p of appState.providers){const option=document.createElement('option');option.value=p.id;option.textContent=p.name+' · '+p.baseUrl;select.appendChild(option);}select.value=selected;
  const presets=document.getElementById('providerPreset'),preset=presets.value;
  presets.innerHTML='<option value="">主流服务商一键预设</option>';
  for(const p of appState.providerPresets){const option=document.createElement('option');option.value=p.id;option.textContent=p.name;presets.appendChild(option);}presets.value=preset;
}
function renderPresets() {
  const row = document.getElementById("presetsRow");
  for (const p of PRESETS) {
    const chip = document.createElement("span");
    chip.className = "preset-chip";
    chip.textContent = p.label;
    chip.addEventListener("click", () => {
      const nameEl = document.getElementById("modelName");
      if (!nameEl.value.trim()) nameEl.value = p.label;
      document.getElementById("modelId").value = p.modelId;
      document.getElementById("protocol").value = p.protocol;
    });
    row.appendChild(chip);
  }
}

function updateUI() {
  const statusCard = document.getElementById("statusCard");
  const activeDisplay = document.getElementById("activeModelDisplay");
  const switchOfficialBtn = document.getElementById("switchOfficialBtn");
  const bridgeInfoBar = document.getElementById("bridgeInfoBar");
  const modelCount = document.getElementById("modelCount");
  const modelsList = document.getElementById("modelsList");

  modelCount.textContent = String(appState.models.length);

  const activeModel = appState.models.find((m) => m.id === appState.activeModelId) || appState.models[0];
  if (appState.activeMode === "custom" && activeModel) {
    statusCard.classList.add("is-custom");
    activeDisplay.innerHTML = `⚡ 自定义中转: ${escapeHtml(activeModel.name)} <span class="tag">${escapeHtml(activeModel.modelId)}</span>`;
    switchOfficialBtn.style.display = "inline-flex";
  } else {
    statusCard.classList.remove("is-custom");
    activeDisplay.textContent = "🔵 Google / Antigravity 官方模型";
    switchOfficialBtn.style.display = "none";
  }

  if (appState.bridge) {
    const b = appState.bridge;
    bridgeInfoBar.innerHTML = `🔗 当前会话已连接 · 官方轮次: <b>${b.officialTurnCount || 0}</b> · 中转轮次: <b>${b.customExchangeCount || 0}</b>${b.unsyncedCustomCount > 0 ? ` · <span style="color:#34d399;">待同步给官方(${b.unsyncedCustomCount})</span>` : ""}`;
  }

  modelsList.innerHTML = "";
  if (appState.models.length === 0) {
    modelsList.innerHTML = `<div style="text-align:center;padding:12px;color:var(--fg-muted);font-size:12px;">暂未添加模型，请在上方填写中转站地址与 API Key 后保存</div>`;
    return;
  }

  for (const m of appState.models) {
    const isCurrent = appState.activeMode === "custom" && appState.activeModelId === m.id;
    const item = document.createElement("div");
    item.className = `model-item${isCurrent ? " active" : ""}`;

    const testBadge =
      m.lastTestOk === true
        ? `<span class="tag ok">✅ ${m.lastTestLatencyMs || 0}ms</span>`
        : m.lastTestOk === false
          ? `<span class="tag" style="color:#f87171;">❌ 异常</span>`
          : `<span class="tag">未测试</span>`;

    item.innerHTML = `
      <div class="model-top">
        <span class="model-name">${escapeHtml(m.name)}</span>
        <div style="display:flex;gap:4px;align-items:center;">
          ${testBadge}
          <span class="tag">${escapeHtml((m.protocol || "auto").toUpperCase())}</span>
        </div>
      </div>
      <div class="model-meta">
        <div>模型 ID: <code>${escapeHtml(m.modelId)}</code></div>
        <div>地址: ${escapeHtml(m.baseUrl)} · 密钥: ${escapeHtml(m.apiKeyMasked || m.maskedApiKey || "••••")}</div>
      </div>
      <div class="model-actions">
        <button class="btn btn-sm ${isCurrent ? "btn-success" : ""}" data-act="select">${isCurrent ? "🟢 当前使用中" : "选用此模型"}</button>
        <button class="btn btn-sm" data-act="test">🔌 测试连接</button>
        <button class="btn btn-sm" data-act="edit">✏️ 编辑</button>
        <button class="btn btn-sm btn-danger" data-act="delete">🗑️ 删除</button>
      </div>
    `;

    item.querySelector('[data-act="select"]').addEventListener("click", async () => {
      await apiRequest("/select", { method: "POST", body: { mode: "custom", modelId: m.id } });
      await loadState();
    });

    const testBtn = item.querySelector('[data-act="test"]');
    testBtn.addEventListener("click", async () => {
      testBtn.disabled = true;
      testBtn.textContent = "⏳ 测试中...";
      try {
        const res = await apiRequest("/test", { method: "POST", body: { id: m.id } });
        showTestBanner(res?.result);
        await loadState();
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = "🔌 测试连接";
      }
    });

    item.querySelector('[data-act="edit"]').addEventListener("click", () => {
      appState.editingId = m.id;
      document.getElementById('providerSelect').value=m.providerId||'';
      document.getElementById("formTitle").textContent = `✏️ 编辑: ${m.name}`;
      document.getElementById("cancelEditBtn").style.display = "inline-flex";
      document.getElementById("modelName").value = m.name;
      document.getElementById("modelId").value = m.modelId;
      document.getElementById("baseUrl").value = m.baseUrl;
      document.getElementById("protocol").value = m.protocol || "auto";
      const keyInput = document.getElementById("apiKey");
      keyInput.value = "";
      keyInput.placeholder = `已保存 (${m.apiKeyMasked || "••••"})，留空保持不变`;
    });

    item.querySelector('[data-act="delete"]').addEventListener("click", async () => {
      await apiRequest("/delete", { method: "POST", body: { id: m.id } });
      await loadState();
    });

    modelsList.appendChild(item);
  }
}

function showTestBanner(result) {
  const box = document.getElementById("testResultBox");
  box.style.display = "block";
  if (result && result.ok) {
    box.className = "test-result ok";
    box.innerHTML = `✅ <b>连接成功</b> · 延迟: <b>${result.latencyMs}ms</b> · 协议: <b>${escapeHtml(result.resolvedProtocol)}</b><br/>返回预览: "${escapeHtml(result.replyPreview)}"`;
  } else {
    box.className = "test-result err";
    box.innerHTML = `❌ <b>连接失败</b>: ${escapeHtml(result?.error || "请检查接口地址与 API Key")}`;
  }
}

function resetForm() {
  appState.editingId = null;
  document.getElementById("formTitle").textContent = "➕ 添加中转站模型";
  document.getElementById("cancelEditBtn").style.display = "none";
  document.getElementById("modelName").value = "";
  document.getElementById("modelId").value = "";
  document.getElementById("baseUrl").value = "";
  document.getElementById('providerSelect').value='';
  document.getElementById("protocol").value = "auto";
  const keyInput = document.getElementById("apiKey");
  keyInput.value = "";
  keyInput.placeholder = "sk-...";
}

async function loadState() {
  const cid = window.sidecar?.conversationId || new URLSearchParams(location.search).get('conversationId');
  const data = await apiRequest(cid ? `?conversationId=${encodeURIComponent(cid)}` : "");
  if (data && data.ok) {
    appState.activeMode = data.activeMode || "official";
    appState.activeModelId = data.activeModelId || null;
    appState.models = data.models || [];
    appState.providers=data.providers||[];appState.providerPresets=data.providerPresets||[];
    updateProviders();
    appState.bridge = data.bridge || null;
    const stats=document.getElementById('usageStats'),known=(data.bridge?.exchanges||[]).filter(ex=>ex.usage?.reportedRounds>0);
    stats.hidden=!data.showUsage;
    stats.textContent=known.length?`会话 Token：输入 ${known.reduce((sum,ex)=>sum+(ex.usage.inputTokens||0),0)} / 输出 ${known.reduce((sum,ex)=>sum+(ex.usage.outputTokens||0),0)}（仅累计接口返回的数据）`:'本会话尚无接口返回的 Token 统计';
    updateUI();
  }
}

function readDraft() {
  const name = document.getElementById("modelName").value.trim();
  const modelId = document.getElementById("modelId").value.trim();
  const baseUrl = document.getElementById("baseUrl").value.trim();
  const protocol = document.getElementById("protocol").value;
  const apiKey = document.getElementById("apiKey").value.trim();
  return {
    id: appState.editingId || undefined,
    name: name || modelId,
    modelId,
    baseUrl,
    protocol,
    apiKey,
    providerId:document.getElementById('providerSelect').value||null,
  };
}

document.addEventListener("DOMContentLoaded", () => {
  const discovered=document.getElementById('discoveredModels'),importBtn=document.getElementById('importModelsBtn');
  let discoverySignature='';
  const signature=draft=>JSON.stringify([draft.providerId,draft.baseUrl,draft.apiKey,draft.protocol]);
  document.getElementById('providerSelect').addEventListener('change',()=>{
    const p=appState.providers.find(p=>p.id===document.getElementById('providerSelect').value);
    document.getElementById('baseUrl').value=p?.baseUrl||'';document.getElementById('protocol').value=p?.protocol||'auto';
    const key=document.getElementById('apiKey');key.value='';key.placeholder=p?'已保存，留空保留':'sk-...';discovered.replaceChildren();importBtn.hidden=true;
  });
  document.getElementById('providerPreset').addEventListener('change',()=>{
    const p=appState.providerPresets.find(p=>p.id===document.getElementById('providerPreset').value);if(!p)return;
    document.getElementById('providerSelect').value='';document.getElementById('baseUrl').value=p.baseUrl;document.getElementById('protocol').value=p.protocol;
    document.getElementById('apiKey').value='';document.getElementById('providerHint').textContent=p.hint||'填写 API Key 后拉取模型列表。';discovered.replaceChildren();importBtn.hidden=true;
  });
  document.getElementById('saveProviderBtn').addEventListener('click',async()=>{
    const draft=readDraft();if(!draft.providerId)throw Error('请先选择已保存服务商');
    await apiRequest('/provider',{method:'POST',body:{...draft,id:draft.providerId}});await loadState();
  });
  document.getElementById('discoverModelsBtn').addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{const draft=readDraft(),data=await apiRequest('/discover',{method:'POST',body:draft});if(!data.ok)throw Error(data.error);
      discoverySignature=signature(draft);discovered.replaceChildren();
      for(const id of data.models){const row=document.createElement('label');row.style.display='block';const input=document.createElement('input');input.type='checkbox';input.value=id;row.append(input,document.createTextNode(id));discovered.appendChild(row);}importBtn.hidden=false;
    }finally{button.disabled=false;}
  });
  importBtn.addEventListener('click',async()=>{
    const draft=readDraft();if(signature(draft)!==discoverySignature)throw Error('连接信息已改变，请重新拉取模型列表');
    const modelIds=[...discovered.querySelectorAll('input:checked')].map(input=>input.value);if(!modelIds.length)throw Error('请勾选模型');
    importBtn.disabled=true;try{await apiRequest('/import',{method:'POST',body:{...draft,id:undefined,modelIds}});discovered.replaceChildren();importBtn.hidden=true;await loadState();}finally{importBtn.disabled=false;}
  });
  renderPresets();
  loadState();

  document.getElementById("refreshBtn").addEventListener("click", loadState);
  document.getElementById("cancelEditBtn").addEventListener("click", resetForm);

  document.getElementById("switchOfficialBtn").addEventListener("click", async () => {
    await apiRequest("/select", { method: "POST", body: { mode: "official" } });
    await loadState();
  });

  const keyInput = document.getElementById("apiKey");
  document.getElementById("toggleKeyBtn").addEventListener("click", () => {
    keyInput.type = keyInput.type === "password" ? "text" : "password";
  });

  const testBtn = document.getElementById("testConnBtn");
  testBtn.addEventListener("click", async () => {
    const draft = readDraft();
    if (!draft.modelId || !draft.baseUrl || (!draft.apiKey && !draft.id && !draft.providerId)) {
      showTestBanner({ ok: false, error: "请先填写模型标识 (Model ID)、Base URL 和 API Key" });
      return;
    }
    testBtn.disabled = true;
    testBtn.textContent = "⏳ 测试中...";
    try {
      const res = await apiRequest("/test", { method: "POST", body: draft });
      showTestBanner(res?.result);
      await loadState();
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = "🔌 测试连接";
    }
  });

  const saveBtn = document.getElementById("saveModelBtn");
  saveBtn.addEventListener("click", async () => {
    const draft = readDraft();
    if (!draft.modelId || !draft.baseUrl || (!draft.apiKey && !draft.id && !draft.providerId)) {
      showTestBanner({ ok: false, error: "请先填写模型标识 (Model ID)、Base URL 和 API Key" });
      return;
    }
    saveBtn.disabled = true;
    saveBtn.textContent = "⏳ 保存中...";
    try {
      const res = await apiRequest("/save", { method: "POST", body: { ...draft, autoActivate: true } });
      if (res && res.ok) {
        resetForm();
        const box = document.getElementById("testResultBox");
        box.style.display = "block";
        box.className = "test-result ok";
        box.innerHTML = `✅ 已保存 <b>${escapeHtml(res.model.name)}</b> 并自动加入到聊天框模型选择界面！`;
        await loadState();
      } else {
        showTestBanner({ ok: false, error: res?.error || "保存失败" });
      }
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = "💾 保存并加入聊天模型菜单";
    }
  });
});
