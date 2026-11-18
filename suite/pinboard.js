(() => {
  window.__agyPinboardCleanup?.();
  const API = 'http://127.0.0.1:19823/api/suite/pinboard';
  const CACHE_KEY = '__agy_suite_pinboard_cache__';
  let disposed = false;
  let pins = [];
  let searchQuery = '';
  let addingOpen = false;
  let draftTitle = '';
  let draftContent = '';
  let statusNotice = '';
  let returnFocus = null;
  let toastTimer = null;
  let scheduled = false;

  const text = (cn, en) => window.__agySuiteSettings?.i18n === false ? en : cn;

  const style = document.createElement('style');
  style.id = 'agy-pinboard-style';
  style.textContent = `
    #agy-pinboard-trigger {
      display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; width: auto !important;
      border: 1px solid rgba(217, 119, 87, 0.36); border-radius: 999px; padding: 5px 10px; margin: 0;
      background: rgba(217, 119, 87, 0.07); color: inherit; font: 500 12px system-ui, sans-serif;
      cursor: pointer; transition: all 0.15s; user-select: none; font-variant-numeric: tabular-nums;
    }
    #agy-pinboard-trigger:hover, #agy-pinboard-trigger:focus-visible {
      background: rgba(217, 119, 87, 0.15); border-color: #D97757; outline: none;
    }
    #agy-pinboard-backdrop {
      position: fixed; inset: 0; z-index: 10025;
      background: var(--scrim, rgba(15, 14, 13, 0.44));
      backdrop-filter: blur(3px);
      display: flex; align-items: center; justify-content: center; padding: 20px;
    }
    #agy-pinboard {
      width: min(680px, 100%); max-height: min(620px, calc(100vh - 40px));
      display: flex; flex-direction: column;
      border-radius: 20px; border: 1px solid var(--border, rgba(20, 20, 19, 0.12));
      background: var(--background, #FAF9F5); color: var(--foreground, #141413);
      box-shadow: 0 28px 90px rgba(0, 0, 0, 0.25); overflow: hidden;
      font: 13px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      animation: agyPbPop 0.17s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    body.theme-dark #agy-pinboard, html.dark #agy-pinboard {
      background: #22211F; border-color: rgba(236, 233, 226, 0.12);
      box-shadow: 0 32px 100px rgba(0, 0, 0, 0.62);
    }
    @keyframes agyPbPop {
      from { opacity: 0; transform: translateY(6px) scale(0.985); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .agy-pb-head {
      padding: 16px 20px 12px; display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
      border-bottom: 1px solid var(--border, rgba(128, 128, 128, 0.15));
    }
    .agy-pb-title { margin: 0; font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 7px; }
    .agy-pb-sub { margin: 3px 0 0; font-size: 11.5px; opacity: 0.6; }
    .agy-pb-bar {
      padding: 10px 20px; display: flex; align-items: center; gap: 8px;
      border-bottom: 1px solid var(--border, rgba(128, 128, 128, 0.12));
      background: var(--sidebar, rgba(240, 238, 230, 0.55));
    }
    body.theme-dark .agy-pb-bar, html.dark .agy-pb-bar { background: rgba(25, 24, 23, 0.65); }
    .agy-pb-input, .agy-pb-textarea {
      box-sizing: border-box; padding: 6px 10px; border-radius: 8px;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.24));
      background: var(--card, #FFFFFF); color: inherit; font: 12.5px/1.45 system-ui, sans-serif; outline: none;
    }
    body.theme-dark .agy-pb-input, body.theme-dark .agy-pb-textarea, html.dark .agy-pb-input, html.dark .agy-pb-textarea {
      background: #1B1A18;
    }
    .agy-pb-input:focus, .agy-pb-textarea:focus { border-color: #D97757; }
    .agy-pb-btn {
      padding: 6px 11px; border-radius: 8px; border: 1px solid var(--border, rgba(128, 128, 128, 0.25));
      background: transparent; color: inherit; font: 500 12px system-ui, sans-serif; cursor: pointer;
      transition: all 0.14s; white-space: nowrap;
    }
    .agy-pb-btn:hover { border-color: #D97757; color: #D97757; }
    .agy-pb-btn.primary { background: #D97757; border-color: #D97757; color: #FFFFFF; font-weight: 600; }
    .agy-pb-btn.primary:hover { background: #C46344; border-color: #C46344; color: #FFFFFF; }
    .agy-pb-add-box {
      padding: 12px 20px; display: flex; flex-direction: column; gap: 8px;
      border-bottom: 1px solid var(--border, rgba(128, 128, 128, 0.15));
      background: rgba(217, 119, 87, 0.04);
    }
    .agy-pb-list {
      flex: 1; overflow-y: auto; padding: 12px 20px; display: flex; flex-direction: column; gap: 8px;
    }
    .agy-pb-empty {
      padding: 36px 18px; text-align: center; opacity: 0.58; font-size: 12.5px; line-height: 1.65;
    }
    .agy-pb-card {
      border-radius: 12px; padding: 10px 12px;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.18));
      background: var(--card, #FFFFFF); display: flex; flex-direction: column; gap: 6px;
      transition: border-color 0.14s, opacity 0.14s;
    }
    body.theme-dark .agy-pb-card, html.dark .agy-pb-card { background: #282725; }
    .agy-pb-card[data-enabled="false"] { opacity: 0.56; }
    .agy-pb-card[data-enabled="true"] { border-color: rgba(217, 119, 87, 0.38); }
    .agy-pb-card-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .agy-pb-check-wrap { display: flex; align-items: center; gap: 7px; min-width: 0; flex: 1; cursor: pointer; font-weight: 600; font-size: 12.5px; }
    .agy-pb-source {
      font-size: 10.5px; padding: 1px 7px; border-radius: 99px;
      background: var(--muted, rgba(128, 128, 128, 0.12)); opacity: 0.75; white-space: nowrap; max-width: 160px; overflow: hidden; text-overflow: ellipsis;
    }
    .agy-pb-snippet {
      margin: 0; font: 12px/1.55 var(--claude-font-sans, system-ui, sans-serif); opacity: 0.85;
      white-space: pre-wrap; word-break: break-word; max-height: 84px; overflow-y: auto;
      padding: 6px 8px; border-radius: 7px; background: var(--muted, rgba(128, 128, 128, 0.07));
    }
    .agy-pb-foot {
      padding: 11px 20px; border-top: 1px solid var(--border, rgba(128, 128, 128, 0.15));
      display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;
    }
    #agy-pinboard-toast {
      position: fixed; right: 20px; bottom: 26px; z-index: 10035;
      padding: 9px 14px; border-radius: 999px;
      background: #232220; color: #ECE9E2; border: 1px solid rgba(217, 119, 87, 0.45);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28); font: 500 12px system-ui, sans-serif;
    }
  `;
  document.head.appendChild(style);

  function loadCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveCache(list) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(list));
    } catch {}
  }

  pins = loadCache();

  async function apiCall(body) {
    const res = await fetch(API, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw Error(data.error || 'Pinboard service unavailable');
    return data.pins;
  }

  function showToast(msg) {
    document.getElementById('agy-pinboard-toast')?.remove();
    clearTimeout(toastTimer);
    const el = document.createElement('div');
    el.id = 'agy-pinboard-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('data-ag-localization-skip', 'true');
    el.textContent = msg;
    document.body.appendChild(el);
    toastTimer = setTimeout(() => el.remove(), 2400);
  }

  async function refresh() {
    try {
      const next = await apiCall();
      if (Array.isArray(next)) {
        pins = next;
        saveCache(pins);
      }
    } catch {}
    renderTrigger();
    const modal = document.getElementById('agy-pinboard');
    if (modal && !modal.contains(document.activeElement)) renderModal();
    return pins;
  }

  function defaultSourceName() {
    const t = (document.title || '').replace(/\s*[-|]\s*Antigravity.*$/i, '').trim();
    return t && t !== 'Antigravity' ? t.slice(0, 48) : text('当前会话', 'Current Chat');
  }

  async function addPin({ title = '', content = '', source = '' } = {}) {
    const clean = String(content || '').trim();
    if (!clean) return null;
    const derivedTitle = String(title || clean.split('\n')[0].replace(/^[#>*\-\s]+/, '')).trim().slice(0, 60) || text('上下文片段', 'Pinned Snippet');
    const item = {
      id: 'pin_' + Math.random().toString(36).slice(2, 10),
      title: derivedTitle,
      content: clean.slice(0, 16000),
      source: String(source || defaultSourceName()).trim().slice(0, 60),
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    pins = [item, ...pins].slice(0, 100);
    saveCache(pins);
    renderTrigger();
    try {
      pins = await apiCall({ action: 'upsert', pin: item });
      saveCache(pins);
    } catch {}
    renderTrigger();
    if (document.getElementById('agy-pinboard-backdrop')) renderModal();
    showToast(text(`📌 已钉入跨会话暂存匣（共 ${pins.length} 条 · Alt+B）`, `📌 Pinned to Context Pinboard (${pins.length} total · Alt+B)`));
    return item;
  }

  async function togglePin(id, enabled) {
    pins = pins.map(p => p.id === id ? { ...p, enabled: enabled === undefined ? !p.enabled : Boolean(enabled) } : p);
    saveCache(pins);
    try {
      pins = await apiCall({ action: 'toggle', id, enabled });
      saveCache(pins);
    } catch {}
    if (document.getElementById('agy-pinboard-backdrop')) renderModal();
    renderTrigger();
  }

  async function deletePin(id) {
    pins = pins.filter(p => p.id !== id);
    saveCache(pins);
    try {
      pins = await apiCall({ action: 'delete', id });
      saveCache(pins);
    } catch {}
    renderTrigger();
    if (document.getElementById('agy-pinboard-backdrop')) renderModal();
  }

  async function clearPins() {
    pins = [];
    saveCache(pins);
    try {
      pins = await apiCall({ action: 'clear' });
      saveCache(pins);
    } catch {}
    renderTrigger();
    if (document.getElementById('agy-pinboard-backdrop')) renderModal();
  }

  function formatActiveContext(customList = null) {
    const active = (customList || pins).filter(p => p.enabled !== false);
    if (!active.length) return '';
    const blocks = active.map((p, idx) => {
      const src = p.source ? ` (${p.source})` : '';
      return `### ${idx + 1}. ${p.title}${src}\n${p.content.trim()}`;
    }).join('\n\n');
    return `<CONTEXT_PINBOARD>\n${blocks}\n</CONTEXT_PINBOARD>\n\n`;
  }

  function injectActivePins({ append = true, composerBox = null } = {}) {
    const block = formatActiveContext();
    if (!block) return false;
    if (window.__agyPromptVault?.insertIntoComposer) {
      return window.__agyPromptVault.insertIntoComposer(block, { append, composerBox });
    }
    return false;
  }

  function close() {
    document.getElementById('agy-pinboard-backdrop')?.remove();
    returnFocus?.focus?.();
    returnFocus = null;
  }

  function open({ withAddForm = false } = {}) {
    if (disposed || window.__agySuiteSettings?.prompts === false) return;
    if (withAddForm) addingOpen = true;
    if (!document.getElementById('agy-pinboard-backdrop')) {
      returnFocus = document.activeElement;
      const backdrop = document.createElement('div');
      backdrop.id = 'agy-pinboard-backdrop';
      backdrop.setAttribute('data-ag-localization-skip', 'true');
      backdrop.onclick = e => { if (e.target === backdrop) close(); };
      document.body.appendChild(backdrop);
    }
    renderModal();
    if (addingOpen) document.getElementById('agy-pb-draft-title')?.focus();
    else document.querySelector('#agy-pinboard .agy-pb-search')?.focus();
    refresh();
  }

  function renderModal() {
    const backdrop = document.getElementById('agy-pinboard-backdrop');
    if (!backdrop) return;
    let modal = document.getElementById('agy-pinboard');
    if (!modal) {
      modal = document.createElement('section');
      modal.id = 'agy-pinboard';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', text('跨会话上下文暂存匣', 'Cross-Session Context Pinboard'));
      backdrop.appendChild(modal);
    }
    modal.replaceChildren();

    const head = document.createElement('div');
    head.className = 'agy-pb-head';
    const titleWrap = document.createElement('div');
    const h3 = document.createElement('h3');
    h3.className = 'agy-pb-title';
    h3.innerHTML = `<span style="color:#D97757">📌</span><span>${text('跨会话上下文暂存匣', 'Context Pinboard')}</span>`;
    const sub = document.createElement('p');
    sub.className = 'agy-pb-sub';
    sub.textContent = text('在不同对话间收集关键公式、架构约束与结论，一键打包注入任意新会话（Alt+B）', 'Collect key decisions, formulas & constraints across chats and inject into any session (Alt+B)');
    titleWrap.append(h3, sub);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'agy-pb-btn';
    closeBtn.style.padding = '3px 9px';
    closeBtn.textContent = '×';
    closeBtn.onclick = close;
    head.append(titleWrap, closeBtn);

    const bar = document.createElement('div');
    bar.className = 'agy-pb-bar';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'agy-pb-input agy-pb-search';
    search.style.flex = '1';
    search.placeholder = text('搜索已暂存的片段、标题或来源会话…', 'Filter pinned snippets…');
    search.value = searchQuery;
    search.oninput = () => {
      searchQuery = search.value;
      renderModal();
      const s = modal.querySelector('.agy-pb-search');
      s?.focus();
      s?.setSelectionRange(searchQuery.length, searchQuery.length);
    };
    const toggleAddBtn = document.createElement('button');
    toggleAddBtn.type = 'button';
    toggleAddBtn.id = 'agy-pb-toggle-add';
    toggleAddBtn.className = addingOpen ? 'agy-pb-btn' : 'agy-pb-btn primary';
    toggleAddBtn.textContent = addingOpen ? text('收起新建', 'Hide Form') : text('+ 手动添加备忘', '+ New Note');
    toggleAddBtn.onclick = () => {
      addingOpen = !addingOpen;
      renderModal();
      if (addingOpen) document.getElementById('agy-pb-draft-title')?.focus();
    };
    bar.append(search, toggleAddBtn);
    modal.append(head, bar);

    if (addingOpen) {
      const addBox = document.createElement('div');
      addBox.className = 'agy-pb-add-box';
      const tInput = document.createElement('input');
      tInput.id = 'agy-pb-draft-title';
      tInput.className = 'agy-pb-input';
      tInput.placeholder = text('备忘标题（选填，如：核心架构不变量 / 服务器环境）', 'Note title (optional)');
      tInput.value = draftTitle;
      tInput.oninput = () => { draftTitle = tInput.value; };
      const cArea = document.createElement('textarea');
      cArea.id = 'agy-pb-draft-content';
      cArea.className = 'agy-pb-textarea';
      cArea.rows = 3;
      cArea.placeholder = text('输入希望跨对话复用的关键上下文、路径、接口契约或实验结论…', 'Enter context snippet, constraints, or findings…');
      cArea.value = draftContent;
      cArea.oninput = () => { draftContent = cArea.value; };
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:flex-end;gap:8px';
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.id = 'agy-pb-save-note';
      saveBtn.className = 'agy-pb-btn primary';
      saveBtn.textContent = text('📌 存入暂存匣', '📌 Save Pin');
      saveBtn.onclick = async () => {
        if (!cArea.value.trim()) return;
        const t = tInput.value;
        const c = cArea.value;
        draftTitle = '';
        draftContent = '';
        addingOpen = false;
        await addPin({ title: t, content: c, source: text('手动备忘', 'Manual Note') });
      };
      row.appendChild(saveBtn);
      addBox.append(tInput, cArea, row);
      modal.appendChild(addBox);
    }

    const q = searchQuery.trim().toLowerCase();
    const filtered = pins.filter(p => !q || p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q) || (p.source || '').toLowerCase().includes(q));

    const list = document.createElement('div');
    list.className = 'agy-pb-list';
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'agy-pb-empty';
      empty.textContent = pins.length === 0
        ? text('暂存匣为空。在任意对话中划选文字点击「📌 暂存」，或在上方点击「+ 手动添加备忘」，即可跨会话随时注入复用！', 'Pinboard is empty. Select any text in chat and click "📌 Pin", or click "+ New Note" above to collect cross-session context.')
        : text('没有匹配的暂存片段', 'No matching pins');
      list.appendChild(empty);
    } else {
      for (const item of filtered) {
        const card = document.createElement('div');
        card.className = 'agy-pb-card';
        card.dataset.pinId = item.id;
        card.dataset.enabled = String(item.enabled !== false);

        const top = document.createElement('div');
        top.className = 'agy-pb-card-top';
        const checkWrap = document.createElement('label');
        checkWrap.className = 'agy-pb-check-wrap';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = item.enabled !== false;
        cb.onchange = () => togglePin(item.id, cb.checked);
        const titleSpan = document.createElement('span');
        titleSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        titleSpan.textContent = item.title;
        checkWrap.append(cb, titleSpan);

        const rightActs = document.createElement('div');
        rightActs.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0';
        if (item.source) {
          const src = document.createElement('span');
          src.className = 'agy-pb-source';
          src.textContent = item.source;
          rightActs.appendChild(src);
        }
        const oneBtn = document.createElement('button');
        oneBtn.type = 'button';
        oneBtn.className = 'agy-pb-btn';
        oneBtn.style.padding = '2px 7px';
        oneBtn.style.fontSize = '11px';
        oneBtn.textContent = text('↵ 填入', '↵ Insert');
        oneBtn.onclick = () => {
          const block = formatActiveContext([{ ...item, enabled: true }]);
          if (window.__agyPromptVault?.insertIntoComposer?.(block, { append: true })) close();
        };
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'agy-pb-btn';
        delBtn.style.padding = '2px 7px';
        delBtn.style.fontSize = '11px';
        delBtn.textContent = '×';
        delBtn.title = text('移除此片段', 'Remove pin');
        delBtn.onclick = () => deletePin(item.id);
        rightActs.append(oneBtn, delBtn);

        top.append(checkWrap, rightActs);
        const pre = document.createElement('pre');
        pre.className = 'agy-pb-snippet';
        pre.textContent = item.content;
        card.append(top, pre);
        list.appendChild(card);
      }
    }
    modal.appendChild(list);

    const activeCount = pins.filter(p => p.enabled !== false).length;
    const foot = document.createElement('div');
    foot.className = 'agy-pb-foot';
    const meta = document.createElement('span');
    meta.style.cssText = 'font-size:11.5px;opacity:0.72';
    meta.textContent = statusNotice || text(`已勾选 ${activeCount} / ${pins.length} 条片段参与注入`, `${activeCount} / ${pins.length} pins enabled for injection`);

    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;align-items:center;gap:7px;flex-wrap:wrap';
    if (pins.length > 0) {
      const clrBtn = document.createElement('button');
      clrBtn.type = 'button';
      clrBtn.id = 'agy-pb-clear';
      clrBtn.className = 'agy-pb-btn';
      clrBtn.textContent = text('清空', 'Clear All');
      clrBtn.onclick = () => clearPins();
      btns.appendChild(clrBtn);
    }
    const copyAll = document.createElement('button');
    copyAll.type = 'button';
    copyAll.id = 'agy-pb-copy';
    copyAll.className = 'agy-pb-btn';
    copyAll.disabled = activeCount === 0;
    copyAll.textContent = text('📋 复制上下文', '📋 Copy Context');
    copyAll.onclick = async () => {
      const block = formatActiveContext();
      if (!block) return;
      await navigator.clipboard?.writeText?.(block);
      statusNotice = text('✓ 已复制结构化上下文到剪贴板', '✓ Copied context block');
      renderModal();
      setTimeout(() => { statusNotice = ''; }, 2000);
    };
    const injectBtn = document.createElement('button');
    injectBtn.type = 'button';
    injectBtn.id = 'agy-pb-inject';
    injectBtn.className = 'agy-pb-btn primary';
    injectBtn.disabled = activeCount === 0;
    injectBtn.textContent = text(`⚡ 一键注入输入框 (${activeCount})`, `⚡ Inject Context (${activeCount})`);
    injectBtn.onclick = () => {
      if (injectActivePins({ append: true })) close();
    };
    btns.append(copyAll, injectBtn);
    foot.append(meta, btns);
    modal.appendChild(foot);
  }

  function renderTrigger() {
    if (disposed || window.__agySuiteSettings?.prompts === false || pins.length === 0) {
      document.getElementById('agy-pinboard-trigger')?.remove();
      return;
    }
    const host = document.getElementById('agy-account-capsule') || document.getElementById('agy-prompt-capsule');
    if (!host) return;
    let btn = document.getElementById('agy-pinboard-trigger');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'agy-pinboard-trigger';
      btn.type = 'button';
      btn.setAttribute('data-ag-localization-skip', 'true');
      btn.onclick = () => open();
    }
    const activeCount = pins.filter(p => p.enabled !== false).length;
    const label = `📌 ${activeCount}/${pins.length}`;
    if (btn.textContent !== label) btn.textContent = label;
    btn.title = text(`跨会话上下文暂存匣：${activeCount} 条启用 / 共 ${pins.length} 条（Alt+B）`, `Context Pinboard: ${activeCount} enabled / ${pins.length} total (Alt+B)`);
    if (btn.parentElement !== host) host.insertBefore(btn, host.firstChild);
  }

  function scheduleRender() {
    if (disposed || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      renderTrigger();
    });
  }

  function onKeyDown(e) {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'b') {
      if (window.__agySuiteSettings?.prompts === false) return;
      e.preventDefault();
      if (document.getElementById('agy-pinboard-backdrop')) close();
      else open();
    } else if (document.getElementById('agy-pinboard-backdrop')) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (addingOpen && document.getElementById('agy-pb-draft-content')?.value.trim()) {
          e.preventDefault();
          document.getElementById('agy-pb-save-note')?.click();
        } else if (pins.some(p => p.enabled !== false)) {
          e.preventDefault();
          if (injectActivePins({ append: true })) close();
        }
      }
    }
  }

  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.target?.closest?.('#agy-pinboard-backdrop, #agy-pinboard-toast')) continue;
      scheduleRender();
      break;
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('agy-suite-settings-updated', scheduleRender);
  document.addEventListener('keydown', onKeyDown);
  refresh();

  window.__agyPinboard = {
    open,
    close,
    refresh,
    addPin,
    togglePin,
    deletePin,
    clearPins,
    getPins: () => pins,
    formatActiveContext,
    injectActivePins
  };

  window.__agyPinboardCleanup = () => {
    disposed = true;
    observer.disconnect();
    clearTimeout(toastTimer);
    window.removeEventListener('agy-suite-settings-updated', scheduleRender);
    document.removeEventListener('keydown', onKeyDown);
    document.getElementById('agy-pinboard-trigger')?.remove();
    document.getElementById('agy-pinboard-backdrop')?.remove();
    document.getElementById('agy-pinboard-toast')?.remove();
    style.remove();
    delete window.__agyPinboard;
  };
})();
