(() => {
  window.__agyPromptVaultCleanup?.();
  const API = 'http://127.0.0.1:19823/api/suite/prompts';
  const CACHE_KEY = '__agy_suite_prompts_cache__';
  let disposed = false;
  let prompts = [];
  let selectedId = null;
  let editingItem = null; // null | { id?, title, category, pinned, content }
  let searchQuery = '';
  let activeCategory = 'all';
  let varValues = {};
  let statusNotice = '';
  let statusError = false;
  let returnFocus = null;
  let scheduled = false;

  const FALLBACK_PROMPTS = [
    {
      id: 'builtin-root-cause',
      title: '🔬 深度根因排查与最小修复',
      category: '调试',
      pinned: true,
      content: '我遇到了以下异常 / 问题现象：\n{{问题现象或报错日志}}\n\n相关模块或上下文：{{涉及模块或文件:自动检索相关代码}}\n\n请按以下步骤处理：\n1. 先定位真实根因（给出调用链与代码行号依据），不要猜测或只做表面兜底；\n2. 设计最小侵入且无副作用的修复方案；\n3. 修改后运行并补充针对该边界场景的回归验证。'
    },
    {
      id: 'builtin-arch-design',
      title: '🏛️ 模块架构设计与边界评审',
      category: '工程',
      pinned: true,
      content: '请帮我设计并实现 **{{功能或模块名称}}**：\n- 核心目标：{{核心业务或技术目标}}\n- 关键约束：{{性能与兼容约束:保持现有接口向后兼容，零冗余依赖}}\n\n请先梳理数据流、状态边界与异常恢复策略，确认无架构隐患后直接完成高质量实现与测试。'
    },
    {
      id: 'builtin-research-pilot',
      title: '📐 算法 / 论文核心创新点提炼',
      category: '科研',
      pinned: true,
      content: '围绕课题 **{{研究课题或赛题方向}}**，结合当前代码库与实验基线：\n- 现有瓶颈：{{基线方法痛点}}\n- 目标场景：{{实验平台或评价指标}}\n\n请从第一性原理出发，提炼 2~3 个机制自洽、可消融验证、具备强差异化的核心创新点，并给出最小可行先导实验（Pilot）验证路径。'
    }
  ];

  const text = (cn, en) => window.__agySuiteSettings?.i18n === false ? en : cn;

  const style = document.createElement('style');
  style.id = 'agy-prompt-vault-style';
  style.textContent = `
    #agy-account-capsule { gap: 6px; flex-wrap: wrap; }
    #agy-prompt-capsule {
      display: flex; align-items: center; justify-content: flex-end; align-self: flex-end;
      flex: 0 0 auto; margin: 4px 12px 8px; gap: 6px; max-width: 100%;
    }
    #agy-prompt-vault-trigger {
      display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; width: auto !important;
      border: 1px solid var(--border, #8883); border-radius: 999px; padding: 5px 10px; margin: 0;
      background: transparent; color: inherit; font: 12px system-ui, sans-serif; cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s; user-select: none;
    }
    #agy-prompt-vault-trigger:hover, #agy-prompt-vault-trigger:focus-visible {
      background: #8882; border-color: #D97757; outline: none;
    }
    #agy-prompt-vault-trigger .agy-pv-spark { color: #D97757; font-size: 12px; line-height: 1; }
    #agy-prompt-vault-backdrop {
      position: fixed; inset: 0; z-index: 10020; background: var(--scrim, rgba(15, 14, 13, 0.42));
      backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; padding: 20px;
    }
    #agy-prompt-vault {
      width: min(860px, 100%); height: min(600px, calc(100vh - 40px));
      display: grid; grid-template-columns: 290px 1fr;
      border-radius: 20px; border: 1px solid var(--border, rgba(20, 20, 19, 0.12));
      background: var(--background, #FAF9F5); color: var(--foreground, #141413);
      box-shadow: 0 28px 90px rgba(0, 0, 0, 0.24); overflow: hidden;
      font: 13px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      animation: agyPvPop 0.18s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    body.theme-dark #agy-prompt-vault, html.dark #agy-prompt-vault {
      background: #22211F; border-color: rgba(236, 233, 226, 0.12);
      box-shadow: 0 32px 100px rgba(0, 0, 0, 0.62);
    }
    @keyframes agyPvPop {
      from { opacity: 0; transform: translateY(6px) scale(0.985); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .agy-pv-left {
      display: flex; flex-direction: column; border-right: 1px solid var(--border, rgba(128, 128, 128, 0.16));
      background: var(--sidebar, #F0EEE6); min-height: 0;
    }
    body.theme-dark .agy-pv-left, html.dark .agy-pv-left { background: #191817; }
    .agy-pv-left-head { padding: 14px 14px 10px; display: flex; flex-direction: column; gap: 9px; }
    .agy-pv-brand {
      display: flex; align-items: center; justify-content: space-between; font-size: 14.5px; font-weight: 600;
    }
    .agy-pv-search {
      width: 100%; box-sizing: border-box; padding: 7px 10px; border-radius: 9px;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.22));
      background: var(--card, #FFFFFF); color: inherit; font: 12px system-ui, sans-serif; outline: none;
    }
    body.theme-dark .agy-pv-search, html.dark .agy-pv-search { background: #252422; }
    .agy-pv-search:focus { border-color: #D97757; }
    .agy-pv-cats { display: flex; gap: 5px; overflow-x: auto; padding-bottom: 2px; scrollbar-width: none; }
    .agy-pv-cat {
      border: 1px solid var(--border, rgba(128, 128, 128, 0.2)); background: transparent; color: inherit;
      padding: 3px 9px; border-radius: 999px; font: 500 11px system-ui, sans-serif; cursor: pointer;
      white-space: nowrap; opacity: 0.75; transition: all 0.14s;
    }
    .agy-pv-cat[data-active="true"] {
      background: #D97757; border-color: #D97757; color: #FFFFFF; opacity: 1; font-weight: 600;
    }
    .agy-pv-list { flex: 1; overflow-y: auto; padding: 6px 10px; display: flex; flex-direction: column; gap: 5px; }
    .agy-pv-card {
      padding: 9px 11px; border-radius: 10px; border: 1px solid transparent;
      background: transparent; color: inherit; text-align: left; cursor: pointer;
      display: flex; flex-direction: column; gap: 4px; transition: all 0.14s;
    }
    .agy-pv-card:hover { background: rgba(128, 128, 128, 0.09); }
    .agy-pv-card[data-selected="true"] {
      background: var(--card, #FFFFFF); border-color: rgba(217, 119, 87, 0.5);
      box-shadow: 0 2px 8px rgba(20, 20, 19, 0.05);
    }
    body.theme-dark .agy-pv-card[data-selected="true"], html.dark .agy-pv-card[data-selected="true"] {
      background: #2A2926; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
    }
    .agy-pv-card-title { font-size: 12.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .agy-pv-card-meta { display: flex; align-items: center; gap: 6px; font-size: 10.5px; opacity: 0.62; }
    .agy-pv-left-foot {
      padding: 10px 12px; border-top: 1px solid var(--border, rgba(128, 128, 128, 0.16));
      display: flex; gap: 6px;
    }
    .agy-pv-right { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 16px 20px; gap: 12px; }
    .agy-pv-right-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .agy-pv-detail-title { font-size: 16px; font-weight: 600; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .agy-pv-head-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .agy-pv-btn {
      padding: 6px 11px; border-radius: 8px; border: 1px solid var(--border, rgba(128, 128, 128, 0.25));
      background: transparent; color: inherit; font: 500 12px system-ui, sans-serif; cursor: pointer;
      transition: all 0.14s; white-space: nowrap;
    }
    .agy-pv-btn:hover { border-color: #D97757; color: #D97757; }
    .agy-pv-btn.primary { background: #D97757; border-color: #D97757; color: #FFFFFF; font-weight: 600; }
    .agy-pv-btn.primary:hover { background: #C46344; border-color: #C46344; color: #FFFFFF; }
    .agy-pv-vars {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 9px;
      padding: 11px 13px; border-radius: 12px;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.18));
      background: var(--muted, rgba(128, 128, 128, 0.06));
      max-height: 175px; overflow-y: auto;
    }
    .agy-pv-var-field { display: flex; flex-direction: column; gap: 4px; }
    .agy-pv-var-label { font-size: 11px; font-weight: 600; color: #D97757; }
    .agy-pv-input, .agy-pv-textarea {
      width: 100%; box-sizing: border-box; padding: 6px 9px; border-radius: 7px;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.25));
      background: var(--card, #FFFFFF); color: inherit; font: 12.5px/1.45 system-ui, sans-serif; outline: none;
    }
    body.theme-dark .agy-pv-input, body.theme-dark .agy-pv-textarea, html.dark .agy-pv-input, html.dark .agy-pv-textarea {
      background: #1B1A18;
    }
    .agy-pv-input:focus, .agy-pv-textarea:focus { border-color: #D97757; }
    .agy-pv-preview-wrap { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 5px; }
    .agy-pv-section-label { font-size: 11px; font-weight: 600; opacity: 0.58; letter-spacing: 0.04em; }
    #agy-pv-preview {
      flex: 1; overflow-y: auto; margin: 0; padding: 12px 14px; border-radius: 12px;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.16));
      background: var(--card, #FDFCF9); font: 12.5px/1.62 var(--claude-font-sans, system-ui, sans-serif);
      white-space: pre-wrap; word-break: break-word;
    }
    body.theme-dark #agy-pv-preview, html.dark #agy-pv-preview { background: #1B1A18; }
    .agy-pv-foot {
      display: flex; align-items: center; justify-content: space-between; gap: 10px;
      padding-top: 8px; border-top: 1px solid var(--border, rgba(128, 128, 128, 0.14));
    }
    .agy-pv-status { font-size: 11.5px; opacity: 0.75; min-height: 16px; }
    .agy-pv-status[data-error="true"] { color: #C94038; opacity: 1; }
    .agy-pv-foot-btns { display: flex; gap: 8px; align-items: center; }
    @media (max-width: 700px) {
      #agy-prompt-vault { grid-template-columns: 1fr; height: calc(100vh - 24px); }
      .agy-pv-left { max-height: 200px; border-right: 0; border-bottom: 1px solid var(--border, #8883); }
    }
  `;
  document.head.appendChild(style);

  function loadCachedPrompts() {
    try {
      const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (Array.isArray(raw) && raw.length) return raw;
    } catch {}
    return [...FALLBACK_PROMPTS];
  }

  function saveCachedPrompts(list) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(list));
    } catch {}
  }

  function parseVariables(content) {
    const seen = new Map();
    const regex = /\{\{\s*([^}:]+?)(?::([^}]*))?\s*\}\}/g;
    let m;
    while ((m = regex.exec(String(content || '')))) {
      const name = m[1].trim();
      const defaultValue = m[2] !== undefined ? m[2].trim() : '';
      if (name && !seen.has(name)) seen.set(name, { name, defaultValue });
    }
    return [...seen.values()];
  }

  function composePrompt(content, values = {}) {
    return String(content || '').replace(/\{\{\s*([^}:]+?)(?::([^}]*))?\s*\}\}/g, (_, rawName, rawDef) => {
      const name = rawName.trim();
      const def = rawDef !== undefined ? rawDef.trim() : '';
      const provided = values[name];
      if (provided !== undefined && String(provided).trim() !== '') return String(provided);
      if (def !== '') return def;
      return `{{${name}}}`;
    });
  }

  async function apiCall(body) {
    const res = await fetch(API, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000)
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw Error(data.error || 'Prompts service unavailable');
    return data.prompts;
  }

  async function refresh() {
    try {
      prompts = await apiCall();
      saveCachedPrompts(prompts);
    } catch {
      if (!prompts.length) prompts = loadCachedPrompts();
    }
    if (!selectedId || !prompts.some(p => p.id === selectedId)) {
      selectedId = prompts[0]?.id || null;
    }
    if (document.getElementById('agy-prompt-vault-backdrop')) renderModal();
    return prompts;
  }

  function insertIntoComposer(value, { append = false } = {}) {
    const box = [...document.querySelectorAll('[data-testid="agent-input-box"]')].find(el => !el.closest('[data-side-panel-body]')) ||
      document.querySelector('[data-testid="agent-input-box"]');
    const editor = box?.querySelector('[data-lexical-editor="true"]');
    if (!editor || !value) return false;

    const currentText = (editor.textContent || '').trim();
    const targetText = append && currentText ? `${currentText}\n\n${value}` : value;

    const lex = editor.__lexicalEditor;
    let updatedViaLex = false;
    if (lex && typeof lex.update === 'function') {
      try {
        lex.update(() => {
          const st = lex._pendingEditorState || lex.getEditorState?.();
          if (!st?._nodeMap) return;
          let textNode = null;
          for (const [, node] of st._nodeMap.entries()) {
            if (node && node.__type === 'text' && typeof node.setTextContent === 'function') {
              textNode = node;
            }
          }
          if (textNode) {
            textNode.setTextContent(targetText);
            updatedViaLex = true;
          } else if (!append) {
            const root = st._nodeMap.get('root');
            root?.getWritable?.()?.clear?.();
          }
        }, { discrete: true });
      } catch {}
    }

    if (!updatedViaLex) {
      editor.focus();
      let execWorked = false;
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        if (append && currentText) range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
        execWorked = document.execCommand('insertText', false, append && currentText ? `\n\n${value}` : value);
      } catch {}
      if (!execWorked || !(editor.textContent || '').includes(value.slice(0, 12))) {
        editor.textContent = targetText;
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: targetText }));
      }
    }

    editor.focus();
    return true;
  }

  function setStatus(msg, isErr = false) {
    statusNotice = msg;
    statusError = isErr;
    const el = document.querySelector('#agy-prompt-vault .agy-pv-status');
    if (el) {
      el.textContent = msg;
      el.dataset.error = String(isErr);
    }
  }

  function close() {
    document.getElementById('agy-prompt-vault-backdrop')?.remove();
    editingItem = null;
    returnFocus?.focus?.();
    returnFocus = null;
  }

  async function open(draft = null) {
    if (disposed || window.__agySuiteSettings?.prompts === false) return;
    if (!prompts.length) prompts = loadCachedPrompts();
    if (!selectedId && prompts[0]) selectedId = prompts[0].id;
    if (draft && typeof draft === 'object' && draft.content) {
      editingItem = {
        title: String(draft.title || '').trim().slice(0, 60),
        category: String(draft.category || text('摘录', 'Saved')).trim(),
        pinned: true,
        content: String(draft.content || '').trim()
      };
    }
    if (!document.getElementById('agy-prompt-vault-backdrop')) {
      returnFocus = document.activeElement;
      const backdrop = document.createElement('div');
      backdrop.id = 'agy-prompt-vault-backdrop';
      backdrop.setAttribute('data-ag-localization-skip', 'true');
      backdrop.addEventListener('click', e => {
        if (e.target === backdrop) close();
      });
      document.body.appendChild(backdrop);
    }
    renderModal();
    if (editingItem) document.getElementById('agy-pv-edit-title')?.focus();
    else document.querySelector('#agy-prompt-vault .agy-pv-search')?.focus();
    refresh();
  }

  function updatePreviewOnly() {
    const active = prompts.find(p => p.id === selectedId);
    const preview = document.getElementById('agy-pv-preview');
    if (active && preview) {
      preview.textContent = composePrompt(active.content, varValues);
    }
  }

  function renderModal() {
    const backdrop = document.getElementById('agy-prompt-vault-backdrop');
    if (!backdrop) return;
    let modal = document.getElementById('agy-prompt-vault');
    if (!modal) {
      modal = document.createElement('section');
      modal.id = 'agy-prompt-vault';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', text('提示词灵感库', 'Prompt Vault'));
      backdrop.appendChild(modal);
    }
    modal.replaceChildren();

    // Left column
    const left = document.createElement('div');
    left.className = 'agy-pv-left';
    const leftHead = document.createElement('div');
    leftHead.className = 'agy-pv-left-head';
    const brand = document.createElement('div');
    brand.className = 'agy-pv-brand';
    brand.innerHTML = `<span style="display:flex;align-items:center;gap:6px"><span style="color:#D97757">✦</span><span>${text('提示词灵感库', 'Prompt Vault')}</span></span>`;
    const closeTop = document.createElement('button');
    closeTop.type = 'button';
    closeTop.className = 'agy-pv-btn';
    closeTop.style.padding = '2px 8px';
    closeTop.textContent = '×';
    closeTop.setAttribute('aria-label', text('关闭', 'Close'));
    closeTop.onclick = close;
    brand.appendChild(closeTop);

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'agy-pv-search';
    search.placeholder = text('搜索模板标题或内容…', 'Search templates…');
    search.value = searchQuery;
    search.oninput = () => {
      searchQuery = search.value;
      renderModal();
      const nextSearch = modal.querySelector('.agy-pv-search');
      nextSearch?.focus();
      nextSearch?.setSelectionRange(searchQuery.length, searchQuery.length);
    };

    const categories = ['all', 'pinned', ...new Set(prompts.map(p => p.category).filter(Boolean))];
    const catsRow = document.createElement('div');
    catsRow.className = 'agy-pv-cats';
    for (const cat of categories) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'agy-pv-cat';
      chip.dataset.active = String(activeCategory === cat);
      chip.textContent = cat === 'all' ? text('全部', 'All') : cat === 'pinned' ? text('★ 置顶', '★ Pinned') : cat;
      chip.onclick = () => {
        activeCategory = cat;
        renderModal();
      };
      catsRow.appendChild(chip);
    }
    leftHead.append(brand, search, catsRow);

    const q = searchQuery.trim().toLowerCase();
    const filtered = prompts.filter(p => {
      if (activeCategory === 'pinned' && !p.pinned) return false;
      if (activeCategory !== 'all' && activeCategory !== 'pinned' && p.category !== activeCategory) return false;
      if (!q) return true;
      return p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q);
    });

    const list = document.createElement('div');
    list.className = 'agy-pv-list';
    for (const item of filtered) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'agy-pv-card';
      btn.dataset.promptId = item.id;
      btn.dataset.selected = String(!editingItem && item.id === selectedId);
      const varsCount = parseVariables(item.content).length;
      const t = document.createElement('div');
      t.className = 'agy-pv-card-title';
      t.textContent = (item.pinned ? '★ ' : '') + item.title;
      const meta = document.createElement('div');
      meta.className = 'agy-pv-card-meta';
      meta.textContent = `${item.category || text('通用', 'General')}${varsCount ? ` · ${varsCount} ${text('个参数', 'vars')}` : ''}`;
      btn.append(t, meta);
      btn.onclick = () => {
        editingItem = null;
        selectedId = item.id;
        varValues = {};
        renderModal();
      };
      list.appendChild(btn);
    }

    const leftFoot = document.createElement('div');
    leftFoot.className = 'agy-pv-left-foot';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.id = 'agy-pv-new-btn';
    addBtn.className = 'agy-pv-btn primary';
    addBtn.style.flex = '1';
    addBtn.textContent = text('+ 新建模板', '+ New Template');
    addBtn.onclick = () => {
      editingItem = { title: '', category: text('工程', 'Engineering'), pinned: true, content: '' };
      renderModal();
      document.getElementById('agy-pv-edit-title')?.focus();
    };
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'agy-pv-btn';
    exportBtn.title = text('复制全部模板 JSON 备份', 'Copy all templates as JSON');
    exportBtn.textContent = text('导出', 'Export');
    exportBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(prompts, null, 2));
        setStatus(text('✓ 已复制模板库 JSON 到剪贴板', '✓ Copied templates JSON to clipboard'));
      } catch {}
    };
    leftFoot.append(addBtn, exportBtn);
    left.append(leftHead, list, leftFoot);

    // Right column
    const right = document.createElement('div');
    right.className = 'agy-pv-right';

    if (editingItem) {
      const head = document.createElement('div');
      head.className = 'agy-pv-right-head';
      const h3 = document.createElement('h3');
      h3.className = 'agy-pv-detail-title';
      h3.textContent = editingItem.id ? text('编辑提示词模板', 'Edit Template') : text('新建提示词模板', 'Create Template');
      head.appendChild(h3);

      const form = document.createElement('div');
      form.style.cssText = 'display:flex;flex-direction:column;gap:10px;flex:1;min-height:0';
      const row1 = document.createElement('div');
      row1.style.cssText = 'display:grid;grid-template-columns:1fr 140px auto;gap:8px;align-items:center';
      const titleInput = document.createElement('input');
      titleInput.id = 'agy-pv-edit-title';
      titleInput.className = 'agy-pv-input';
      titleInput.maxLength = 80;
      titleInput.placeholder = text('模板标题（例如：🚀 接口契约审查）', 'Template title');
      titleInput.value = editingItem.title;
      const catInput = document.createElement('input');
      catInput.id = 'agy-pv-edit-category';
      catInput.className = 'agy-pv-input';
      catInput.maxLength = 24;
      catInput.placeholder = text('分类', 'Category');
      catInput.value = editingItem.category;
      const pinWrap = document.createElement('label');
      pinWrap.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;white-space:nowrap';
      const pinCheck = document.createElement('input');
      pinCheck.type = 'checkbox';
      pinCheck.id = 'agy-pv-edit-pinned';
      pinCheck.checked = Boolean(editingItem.pinned);
      pinWrap.append(pinCheck, document.createTextNode(text('置顶', 'Pin')));
      row1.append(titleInput, catInput, pinWrap);

      const helperRow = document.createElement('div');
      helperRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px';
      const hint = document.createElement('span');
      hint.className = 'agy-pv-section-label';
      hint.textContent = text('支持 {{变量名}} 或 {{变量名:默认值}} 动态参数占位符', 'Use {{variable}} or {{variable:default}} placeholders');
      const insertTokenBtn = document.createElement('button');
      insertTokenBtn.type = 'button';
      insertTokenBtn.className = 'agy-pv-btn';
      insertTokenBtn.style.padding = '3px 8px';
      insertTokenBtn.textContent = text('+ 插入 {{参数}}', '+ Insert {{var}}');
      helperRow.append(hint, insertTokenBtn);

      const contentArea = document.createElement('textarea');
      contentArea.id = 'agy-pv-edit-content';
      contentArea.className = 'agy-pv-textarea';
      contentArea.style.cssText = 'flex:1;resize:none;min-height:180px';
      contentArea.placeholder = text('输入提示词模板内容，例如：\n请针对 {{目标模块}} 进行审查，重点关注 {{关注维度:并发安全与边界条件}}。', 'Enter prompt template content…');
      contentArea.value = editingItem.content;
      insertTokenBtn.onclick = () => {
        const token = '{{参数名:默认值}}';
        const start = contentArea.selectionStart ?? contentArea.value.length;
        contentArea.value = contentArea.value.slice(0, start) + token + contentArea.value.slice(contentArea.selectionEnd ?? start);
        contentArea.focus();
      };
      form.append(row1, helperRow, contentArea);

      const foot = document.createElement('div');
      foot.className = 'agy-pv-foot';
      const status = document.createElement('div');
      status.className = 'agy-pv-status';
      status.textContent = statusNotice;
      status.dataset.error = String(statusError);
      const btns = document.createElement('div');
      btns.className = 'agy-pv-foot-btns';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'agy-pv-btn';
      cancelBtn.textContent = text('取消', 'Cancel');
      cancelBtn.onclick = () => {
        editingItem = null;
        setStatus('');
        renderModal();
      };
      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.id = 'agy-pv-save-btn';
      saveBtn.className = 'agy-pv-btn primary';
      saveBtn.textContent = text('保存模板', 'Save Template');
      saveBtn.onclick = async () => {
        const nextItem = {
          id: editingItem.id,
          title: titleInput.value.trim(),
          category: catInput.value.trim() || text('通用', 'General'),
          pinned: pinCheck.checked,
          content: contentArea.value.trim()
        };
        if (!nextItem.title || !nextItem.content) {
          setStatus(text('请填写模板标题与内容', 'Title and content are required'), true);
          return;
        }
        try {
          prompts = await apiCall({ action: 'upsert', prompt: nextItem });
          saveCachedPrompts(prompts);
          const saved = prompts.find(p => p.title === nextItem.title) || prompts[0];
          selectedId = saved?.id || null;
          editingItem = null;
          varValues = {};
          setStatus(text('✓ 模板已保存', '✓ Template saved'));
          renderModal();
        } catch (err) {
          setStatus(err.message, true);
        }
      };
      btns.append(cancelBtn, saveBtn);
      foot.append(status, btns);
      right.append(head, form, foot);
    } else {
      const active = prompts.find(p => p.id === selectedId) || filtered[0];
      if (!active) {
        const empty = document.createElement('div');
        empty.style.cssText = 'margin:auto;opacity:0.55;text-align:center';
        empty.textContent = text('选择左侧模板或点击「+ 新建模板」', 'Select or create a prompt template');
        right.appendChild(empty);
      } else {
        selectedId = active.id;
        const head = document.createElement('div');
        head.className = 'agy-pv-right-head';
        const h3 = document.createElement('h3');
        h3.className = 'agy-pv-detail-title';
        h3.textContent = active.title;
        const actions = document.createElement('div');
        actions.className = 'agy-pv-head-actions';
        const pinBtn = document.createElement('button');
        pinBtn.type = 'button';
        pinBtn.className = 'agy-pv-btn';
        pinBtn.textContent = active.pinned ? text('★ 已置顶', '★ Pinned') : text('☆ 置顶', '☆ Pin');
        pinBtn.onclick = async () => {
          try {
            prompts = await apiCall({ action: 'upsert', prompt: { ...active, pinned: !active.pinned } });
            saveCachedPrompts(prompts);
            renderModal();
          } catch (err) {
            setStatus(err.message, true);
          }
        };
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'agy-pv-btn';
        editBtn.textContent = text('✎ 编辑', '✎ Edit');
        editBtn.onclick = () => {
          editingItem = { ...active };
          renderModal();
        };
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.id = 'agy-pv-delete-btn';
        delBtn.className = 'agy-pv-btn';
        delBtn.textContent = text('🗑 删除', '🗑 Delete');
        delBtn.onclick = async () => {
          try {
            prompts = await apiCall({ action: 'delete', id: active.id });
            saveCachedPrompts(prompts);
            selectedId = prompts[0]?.id || null;
            varValues = {};
            setStatus(text('已删除模板', 'Template deleted'));
            renderModal();
          } catch (err) {
            setStatus(err.message, true);
          }
        };
        actions.append(pinBtn, editBtn, delBtn);
        head.append(h3, actions);
        right.appendChild(head);

        const vars = parseVariables(active.content);
        if (vars.length > 0) {
          const varsBox = document.createElement('div');
          varsBox.className = 'agy-pv-vars';
          for (const v of vars) {
            const field = document.createElement('label');
            field.className = 'agy-pv-var-field';
            const lbl = document.createElement('span');
            lbl.className = 'agy-pv-var-label';
            lbl.textContent = v.name;
            const inp = document.createElement('input');
            inp.type = 'text';
            inp.className = 'agy-pv-input';
            inp.dataset.promptVar = v.name;
            inp.placeholder = v.defaultValue || text(`输入 ${v.name}…`, `Enter ${v.name}…`);
            inp.value = varValues[v.name] ?? '';
            inp.oninput = () => {
              varValues[v.name] = inp.value;
              updatePreviewOnly();
            };
            inp.onkeydown = e => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                if (insertIntoComposer(composePrompt(active.content, varValues), { append: false })) close();
              }
            };
            field.append(lbl, inp);
            varsBox.appendChild(field);
          }
          right.appendChild(varsBox);
        }

        const previewWrap = document.createElement('div');
        previewWrap.className = 'agy-pv-preview-wrap';
        const pLabel = document.createElement('span');
        pLabel.className = 'agy-pv-section-label';
        pLabel.textContent = text('实时合成预览（Ctrl+Enter 直接填入输入框）', 'LIVE PREVIEW (Ctrl+Enter to insert)');
        const preview = document.createElement('pre');
        preview.id = 'agy-pv-preview';
        preview.textContent = composePrompt(active.content, varValues);
        previewWrap.append(pLabel, preview);
        right.appendChild(previewWrap);

        const foot = document.createElement('div');
        foot.className = 'agy-pv-foot';
        const status = document.createElement('div');
        status.className = 'agy-pv-status';
        status.textContent = statusNotice;
        status.dataset.error = String(statusError);
        const btns = document.createElement('div');
        btns.className = 'agy-pv-foot-btns';
        const copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.id = 'agy-pv-copy';
        copyBtn.className = 'agy-pv-btn';
        copyBtn.textContent = text('📋 复制', '📋 Copy');
        copyBtn.onclick = async () => {
          await navigator.clipboard?.writeText?.(composePrompt(active.content, varValues));
          setStatus(text('✓ 已复制到剪贴板', '✓ Copied to clipboard'));
        };
        const appendBtn = document.createElement('button');
        appendBtn.type = 'button';
        appendBtn.id = 'agy-pv-append';
        appendBtn.className = 'agy-pv-btn';
        appendBtn.textContent = text('+ 追加末尾', '+ Append');
        appendBtn.onclick = () => {
          if (insertIntoComposer(composePrompt(active.content, varValues), { append: true })) close();
        };
        const insertBtn = document.createElement('button');
        insertBtn.type = 'button';
        insertBtn.id = 'agy-pv-insert';
        insertBtn.className = 'agy-pv-btn primary';
        insertBtn.textContent = text('↵ 填入输入框', '↵ Insert into Composer');
        insertBtn.onclick = () => {
          if (insertIntoComposer(composePrompt(active.content, varValues), { append: false })) close();
        };
        btns.append(copyBtn, appendBtn, insertBtn);
        foot.append(status, btns);
        right.appendChild(foot);
      }
    }

    modal.append(left, right);
  }

  function renderTrigger() {
    if (disposed) return;
    if (window.__agySuiteSettings?.prompts === false) {
      document.getElementById('agy-prompt-vault-trigger')?.remove();
      document.getElementById('agy-prompt-capsule')?.remove();
      close();
      return;
    }
    const composer = [...document.querySelectorAll('[data-testid="agent-input-box"]')].find(el => !el.closest('[data-side-panel-body]')) ||
      document.querySelector('[data-testid="agent-input-box"]');
    if (!composer) return;

    let btn = document.getElementById('agy-prompt-vault-trigger');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'agy-prompt-vault-trigger';
      btn.type = 'button';
      btn.setAttribute('aria-haspopup', 'dialog');
      btn.setAttribute('data-ag-localization-skip', 'true');
      btn.innerHTML = '<span class="agy-pv-spark" aria-hidden="true">✦</span><span class="agy-pv-label"></span>';
      btn.onclick = () => open();
    }
    const labelText = text('提示词库', 'Prompts');
    const lbl = btn.querySelector('.agy-pv-label');
    if (lbl.textContent !== labelText) lbl.textContent = labelText;
    btn.title = text('打开提示词灵感库与 {{参数}} 模板（Alt+P）', 'Open Prompt Vault & {{variable}} templates (Alt+P)');

    const accountCapsule = document.getElementById('agy-account-capsule');
    if (accountCapsule && accountCapsule.parentElement === composer) {
      document.getElementById('agy-prompt-capsule')?.remove();
      if (btn.parentElement !== accountCapsule) {
        accountCapsule.insertBefore(btn, accountCapsule.firstChild);
      }
    } else {
      let host = document.getElementById('agy-prompt-capsule');
      if (!host) {
        host = document.createElement('div');
        host.id = 'agy-prompt-capsule';
      }
      if (host.parentElement !== composer) composer.appendChild(host);
      if (btn.parentElement !== host) host.appendChild(btn);
    }
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
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'p') {
      if (window.__agySuiteSettings?.prompts === false) return;
      e.preventDefault();
      if (document.getElementById('agy-prompt-vault-backdrop')) close();
      else open();
    } else if (e.key === 'Escape' && document.getElementById('agy-prompt-vault-backdrop')) {
      e.preventDefault();
      close();
    }
  }

  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.target?.closest?.('#agy-prompt-vault-backdrop')) continue;
      scheduleRender();
      break;
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('agy-suite-settings-updated', scheduleRender);
  document.addEventListener('keydown', onKeyDown);
  scheduleRender();

  window.__agyPromptVault = {
    open,
    openWithDraft: draft => open(draft),
    close,
    refresh,
    getPrompts: () => prompts.length ? prompts : loadCachedPrompts(),
    parseVariables,
    composePrompt,
    insertIntoComposer
  };

  window.__agyPromptVaultCleanup = () => {
    disposed = true;
    observer.disconnect();
    window.removeEventListener('agy-suite-settings-updated', scheduleRender);
    document.removeEventListener('keydown', onKeyDown);
    document.getElementById('agy-prompt-vault-trigger')?.remove();
    document.getElementById('agy-prompt-capsule')?.remove();
    document.getElementById('agy-prompt-vault-backdrop')?.remove();
    style.remove();
    delete window.__agyPromptVault;
  };
})();
