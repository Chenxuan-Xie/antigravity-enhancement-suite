(() => {
  window.__agyCommandPaletteCleanup?.();
  let disposed = false;
  let query = '';
  let activeIndex = 0;
  let items = [];
  let returnFocus = null;

  const text = (cn, en) => window.__agySuiteSettings?.i18n === false ? en : cn;

  const style = document.createElement('style');
  style.id = 'agy-command-palette-style';
  style.textContent = `
    #agy-command-palette-backdrop {
      position: fixed; inset: 0; z-index: 10040;
      background: var(--scrim, rgba(15, 14, 13, 0.42));
      backdrop-filter: blur(3px);
      display: flex; align-items: flex-start; justify-content: center;
      padding: 12vh 16px 24px;
    }
    #agy-command-palette {
      width: min(580px, 100%);
      max-height: min(480px, 72vh);
      display: flex; flex-direction: column;
      border-radius: 18px;
      border: 1px solid var(--border, rgba(20, 20, 19, 0.13));
      background: var(--background, #FAF9F5);
      color: var(--foreground, #141413);
      box-shadow: 0 28px 90px rgba(0, 0, 0, 0.26);
      font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow: hidden;
      animation: agyCpDrop 0.15s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    body.theme-dark #agy-command-palette, html.dark #agy-command-palette {
      background: #232220;
      border-color: rgba(236, 233, 226, 0.13);
      box-shadow: 0 32px 96px rgba(0, 0, 0, 0.65);
    }
    @keyframes agyCpDrop {
      from { opacity: 0; transform: translateY(-8px) scale(0.985); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .agy-cp-head {
      display: flex; align-items: center; gap: 10px;
      padding: 13px 16px;
      border-bottom: 1px solid var(--border, rgba(128, 128, 128, 0.16));
    }
    .agy-cp-icon { color: #D97757; flex-shrink: 0; display: flex; }
    #agy-cp-input {
      flex: 1; border: 0; background: transparent; color: inherit;
      font: 14.5px/1.4 system-ui, sans-serif; outline: none; min-width: 0;
    }
    .agy-cp-kbd {
      font: 500 10.5px/1.4 system-ui, monospace; padding: 2px 6px; border-radius: 5px;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.25)); opacity: 0.6;
    }
    .agy-cp-list {
      flex: 1; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 2px;
    }
    .agy-cp-group {
      padding: 7px 10px 3px; font-size: 10.5px; font-weight: 600; letter-spacing: 0.06em;
      opacity: 0.5; text-transform: uppercase;
    }
    .agy-cp-item {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      width: 100%; padding: 9px 11px; border: 0; border-radius: 10px;
      background: transparent; color: inherit; text-align: left; cursor: pointer;
      font: inherit; transition: background 0.1s;
    }
    .agy-cp-item[data-active="true"] {
      background: rgba(217, 119, 87, 0.13);
    }
    body.theme-dark .agy-cp-item[data-active="true"], html.dark .agy-cp-item[data-active="true"] {
      background: rgba(217, 119, 87, 0.2);
    }
    .agy-cp-item-main { display: flex; align-items: center; gap: 9px; min-width: 0; flex: 1; }
    .agy-cp-item-title { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .agy-cp-item-badge {
      font-size: 11px; opacity: 0.62; white-space: nowrap; flex-shrink: 0;
      font-variant-numeric: tabular-nums;
    }
    .agy-cp-empty { padding: 28px 14px; text-align: center; opacity: 0.55; font-size: 12.5px; }
    .agy-cp-foot {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 14px; font-size: 11px; opacity: 0.55;
      border-top: 1px solid var(--border, rgba(128, 128, 128, 0.13));
    }
  `;
  document.head.appendChild(style);

  function buildActions() {
    const s = window.__agySuite?.getSettings?.() || window.__agySuiteSettings || {};
    const list = [];

    // 1. Theme & Reading
    const appearanceGroup = text('外观与排版', 'APPEARANCE & READING');
    list.push({
      id: 'theme-light',
      group: appearanceGroup,
      title: text('☀️ 切换为白天模式（羊皮纸浅色）', '☀️ Switch to Light Theme (Warm Parchment)'),
      badge: s.skin && s.themeMode === 'light' ? text('当前', 'Active') : '',
      keywords: 'light theme warm parchment 白天 浅色 羊皮纸 皮肤',
      run: () => window.__agySuite?.save({ skin: true, themeMode: 'light' })
    });
    list.push({
      id: 'theme-dark',
      group: appearanceGroup,
      title: text('🌙 切换为黑夜模式（暖炭黑深色）', '🌙 Switch to Dark Theme (Warm Charcoal)'),
      badge: s.skin && s.themeMode === 'dark' ? text('当前', 'Active') : '',
      keywords: 'dark theme night charcoal 黑夜 深色 暗黑 炭黑 皮肤',
      run: () => window.__agySuite?.save({ skin: true, themeMode: 'dark' })
    });
    list.push({
      id: 'theme-system',
      group: appearanceGroup,
      title: text('💻 皮肤跟随系统深浅色', '💻 Follow System Appearance'),
      badge: s.skin && s.themeMode === 'system' ? text('当前', 'Active') : '',
      keywords: 'system auto theme 跟随系统 自动',
      run: () => window.__agySuite?.save({ skin: true, themeMode: 'system' })
    });
    for (const [val, zh, en] of [
      ['standard', '📖 阅读宽度：标准书卷 (51rem)', '📖 Reading Width: Standard (51rem)'],
      ['wide', '🖥️ 阅读宽度：宽屏代码 (68rem)', '🖥️ Reading Width: Wide (68rem)'],
      ['full', '↔️ 阅读宽度：全宽画布 (92%)', '↔️ Reading Width: Full (92%)']
    ]) {
      list.push({
        id: 'width-' + val,
        group: appearanceGroup,
        title: text(zh, en),
        badge: (s.readingWidth || 'standard') === val ? text('当前', 'Active') : '',
        keywords: `width reading layout 宽度 宽屏 ${val}`,
        run: () => window.__agySuite?.save({ skin: true, readingWidth: val })
      });
    }

    // 2. Conversation Tools
    const turns = window.__agyConvTools?.getTurns?.() || [];
    if (turns.length > 0) {
      const convGroup = text('当前对话增强', 'CONVERSATION');
      list.push({
        id: 'conv-outline',
        group: convGroup,
        title: text(`📑 打开对话目录与小标题导航（${turns.length} 轮）`, `📑 Open Conversation Outline (${turns.length} turns)`),
        badge: 'Alt+O',
        keywords: 'outline toc jump turns 目录 大纲 导航 跳转',
        run: () => window.__agyConvTools?.open()
      });
      list.push({
        id: 'conv-copy-md',
        group: convGroup,
        title: text('📋 复制当前对话全文为纯净 Markdown', '📋 Copy Full Conversation as Markdown'),
        badge: `${turns.length} ${text('轮', 'turns')}`,
        keywords: 'copy markdown export 复制 导出 对话 md',
        run: () => window.__agyConvTools?.copyMarkdown({ onlyStarred: false })
      });
      list.push({
        id: 'conv-copy-starred',
        group: convGroup,
        title: text('★ 仅复制星标重点轮次为 Markdown', '★ Copy Starred Turns as Markdown'),
        badge: 'Markdown',
        keywords: 'star bookmark copy markdown 星标 收藏 重点 导出',
        run: () => window.__agyConvTools?.copyMarkdown({ onlyStarred: true })
      });
      list.push({
        id: 'conv-export-html',
        group: convGroup,
        title: text('📄 导出当前对话为 Claude 书卷排版 HTML 离线报告', '📄 Export Conversation as Bookish HTML Report'),
        badge: 'HTML',
        keywords: 'html export report bookish archive 书卷 报告 网页 归档 导出',
        run: () => window.__agyConvTools?.downloadBookishHtml({ onlyStarred: false })
      });
    }

    // 3. Prompt Vault
    if (window.__agyPromptVault) {
      const pvGroup = text('提示词灵感库', 'PROMPT VAULT');
      list.push({
        id: 'pv-open',
        group: pvGroup,
        title: text('✦ 打开提示词灵感库与参数模板', '✦ Open Prompt Vault & Variable Templates'),
        badge: 'Alt+P',
        keywords: 'prompt template vault variable 提示词 模板 灵感库 参数',
        run: () => window.__agyPromptVault.open()
      });
      for (const tpl of (window.__agyPromptVault.getPrompts?.() || []).filter(p => p.pinned).slice(0, 4)) {
        list.push({
          id: 'pv-tpl-' + tpl.id,
          group: pvGroup,
          title: `${tpl.title}`,
          badge: tpl.category || '',
          keywords: `prompt template 模板 ${tpl.title} ${tpl.category || ''}`,
          run: () => {
            const vars = window.__agyPromptVault.parseVariables(tpl.content);
            if (!vars.length) window.__agyPromptVault.insertIntoComposer(tpl.content);
            else window.__agyPromptVault.open();
          }
        });
      }
    }

    // 4. Multi-Account Hot Switch
    if (s.accounts && window.__agyQuotaBadge) {
      const accGroup = text('Google 账号热切换', 'ACCOUNTS');
      const accs = window.__agyQuotaBadge.getAccounts?.() || [];
      for (const acc of accs) {
        const pct = window.__agyQuotaBadge.percentage?.(acc, '') ?? null;
        list.push({
          id: 'acc-' + acc.email,
          group: accGroup,
          title: (acc.isCurrent ? '✓ ' : '⇄ ') + (acc.label || acc.email),
          badge: pct !== null ? `${pct}%` : (acc.isCurrent ? text('当前', 'Current') : ''),
          keywords: `account switch google 账号 切换 配额 ${acc.email} ${acc.label || ''}`,
          run: async () => {
            if (!acc.isCurrent) {
              await fetch('http://127.0.0.1:19823/api/switch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: acc.email })
              });
              window.__agyQuotaBadge?.refresh?.({ notify: true });
            }
          }
        });
      }
      list.push({
        id: 'acc-refresh',
        group: accGroup,
        title: text('↻ 刷新当前账号模型配额', '↻ Refresh Current Account Quota'),
        badge: '',
        keywords: 'quota refresh 刷新 额度 配额',
        run: () => window.__agyQuotaBadge?.refresh?.({ notify: true })
      });
    }

    // 5. Relay API Models
    if (s.api && window.__AGY_MODEL_SWITCHER) {
      const apiGroup = text('模型与中转 API', 'MODELS & RELAY API');
      const st = window.__AGY_MODEL_SWITCHER.getState?.() || {};
      list.push({
        id: 'mdl-official',
        group: apiGroup,
        title: text('🏛️ 使用 Google 官方原生模型', '🏛️ Use Official Native Model'),
        badge: st.activeMode === 'official' ? text('当前', 'Active') : '',
        keywords: 'official native model 官方 原生 模型',
        run: () => window.__AGY_MODEL_SWITCHER.selectModel?.('official')
      });
      const enabledModels = (st.models || []).filter(x => x.enabled !== false);
      if (enabledModels.length > 0) {
        list.push({
          id: 'mdl-race-fastest',
          group: apiGroup,
          title: text('🏁 并发测速全部中转模型并优选最快节点', '🏁 Benchmark All Relay Models & Pick Fastest'),
          badge: `${enabledModels.length} ${text('个节点', 'nodes')}`,
          keywords: 'benchmark latency race fastest speed 并发 测速 赛马 最快 延迟 节点',
          run: () => window.__AGY_MODEL_SWITCHER.benchmarkModels?.({ autoSelectFastest: true })
        });
      }
      for (const m of enabledModels) {
        const latencyHint = m.lastTestOk === true && Number.isFinite(m.lastTestLatencyMs) ? `${m.lastTestLatencyMs}ms` : (m.protocol || '');
        list.push({
          id: 'mdl-' + m.id,
          group: apiGroup,
          title: `⚡ ${m.name || m.modelId}`,
          badge: st.activeMode === 'custom' && st.activeModelId === m.id ? text('当前', 'Active') : latencyHint,
          keywords: `relay api custom model 中转 模型 ${m.name || ''} ${m.modelId || ''}`,
          run: () => window.__AGY_MODEL_SWITCHER.selectModel?.('custom', m.id)
        });
      }
      list.push({
        id: 'mdl-manage',
        group: apiGroup,
        title: text('⚙️ 打开中转 API 服务商与模型管理', '⚙️ Open Relay API Model Manager'),
        badge: '',
        keywords: 'api provider key import 中转 服务商 密钥 批量导入',
        run: () => window.__AGY_MODEL_SWITCHER.openModal?.()
      });
    }

    // 6. Suite Control & Toggles
    const suiteGroup = text('套件控制中心', 'SUITE CONTROLS');
    list.push({
      id: 'suite-center',
      group: suiteGroup,
      title: text('🎛️ 打开增强套件控制中心', '🎛️ Open Enhancement Suite Control Center'),
      badge: '',
      keywords: 'suite control center settings 控制中心 设置 开关',
      run: () => window.__agySuite?.openCenter?.()
    });
    list.push({
      id: 'toggle-i18n',
      group: suiteGroup,
      title: s.i18n ? text('🌐 切换为英文原版界面（关闭汉化）', '🌐 Switch to English UI') : text('🇨🇳 开启简体中文界面汉化', '🇨🇳 Enable Chinese Localization'),
      badge: s.i18n ? 'ON' : 'OFF',
      keywords: 'i18n chinese english language 汉化 中文 英文 语言',
      run: () => window.__agySuite?.save({ i18n: !s.i18n })
    });
    list.push({
      id: 'toggle-skin',
      group: suiteGroup,
      title: s.skin ? text('🎨 恢复官方默认配色（关闭 Claude 皮肤）', '🎨 Restore Official Appearance') : text('🎨 启用 Claude 羊皮纸书卷皮肤', '🎨 Enable Claude Skin'),
      badge: s.skin ? 'ON' : 'OFF',
      keywords: 'skin claude official appearance 皮肤 主题 官方配色',
      run: () => window.__agySuite?.save({ skin: !s.skin })
    });

    return list;
  }

  function filterItems(all, q) {
    const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return all;
    return all.filter(item => {
      const hay = `${item.title} ${item.group} ${item.keywords || ''} ${item.badge || ''}`.toLowerCase();
      return tokens.every(tok => hay.includes(tok));
    });
  }

  function close() {
    document.getElementById('agy-command-palette-backdrop')?.remove();
    returnFocus?.focus?.();
    returnFocus = null;
  }

  function executeIndex(idx) {
    const chosen = items[idx];
    if (!chosen) return;
    returnFocus = null;
    document.getElementById('agy-command-palette-backdrop')?.remove();
    chosen.run?.();
  }

  function renderListOnly() {
    const listEl = document.querySelector('#agy-command-palette .agy-cp-list');
    if (!listEl) return;
    listEl.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'agy-cp-empty';
      empty.textContent = text('未找到匹配的命令', 'No matching commands');
      listEl.appendChild(empty);
      return;
    }
    let lastGroup = '';
    items.forEach((item, idx) => {
      if (item.group !== lastGroup) {
        lastGroup = item.group;
        const g = document.createElement('div');
        g.className = 'agy-cp-group';
        g.textContent = item.group;
        listEl.appendChild(g);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'agy-cp-item';
      btn.dataset.commandId = item.id;
      btn.dataset.active = String(idx === activeIndex);
      const main = document.createElement('span');
      main.className = 'agy-cp-item-main';
      const title = document.createElement('span');
      title.className = 'agy-cp-item-title';
      title.textContent = item.title;
      main.appendChild(title);
      btn.appendChild(main);
      if (item.badge) {
        const badge = document.createElement('span');
        badge.className = 'agy-cp-item-badge';
        badge.textContent = item.badge;
        btn.appendChild(badge);
      }
      btn.onmouseenter = () => {
        if (activeIndex === idx) return;
        activeIndex = idx;
        for (const [i, node] of [...listEl.querySelectorAll('.agy-cp-item')].entries()) {
          node.dataset.active = String(i === activeIndex);
        }
      };
      btn.onclick = () => executeIndex(idx);
      listEl.appendChild(btn);
    });
    listEl.querySelector('.agy-cp-item[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }

  function open() {
    if (disposed) return;
    if (document.getElementById('agy-command-palette-backdrop')) {
      document.getElementById('agy-cp-input')?.focus();
      return;
    }
    returnFocus = document.activeElement;
    query = '';
    activeIndex = 0;
    const allActions = buildActions();
    items = filterItems(allActions, '');

    const backdrop = document.createElement('div');
    backdrop.id = 'agy-command-palette-backdrop';
    backdrop.setAttribute('data-ag-localization-skip', 'true');
    backdrop.addEventListener('click', e => {
      if (e.target === backdrop) close();
    });

    const dialog = document.createElement('section');
    dialog.id = 'agy-command-palette';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', text('全能命令面板', 'Suite Command Palette'));

    const head = document.createElement('div');
    head.className = 'agy-cp-head';
    head.innerHTML = '<span class="agy-cp-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>';
    const input = document.createElement('input');
    input.id = 'agy-cp-input';
    input.type = 'text';
    input.placeholder = text('输入命令：切号、换肤、切换模型、导出 Markdown、调出提示词…', 'Type a command: switch theme, account, model, export Markdown…');
    const esc = document.createElement('span');
    esc.className = 'agy-cp-kbd';
    esc.textContent = 'ESC';
    head.append(input, esc);

    const listEl = document.createElement('div');
    listEl.className = 'agy-cp-list';

    const foot = document.createElement('div');
    foot.className = 'agy-cp-foot';
    foot.innerHTML = `<span>${text('↑↓ 选择 · Enter 执行', '↑↓ Navigate · Enter Run')}</span><span>Alt+K</span>`;

    dialog.append(head, listEl, foot);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    input.oninput = () => {
      query = input.value;
      activeIndex = 0;
      items = filterItems(allActions, query);
      renderListOnly();
    };
    input.onkeydown = e => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (items.length) activeIndex = (activeIndex + 1) % items.length;
        renderListOnly();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length) activeIndex = (activeIndex - 1 + items.length) % items.length;
        renderListOnly();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        executeIndex(activeIndex);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };

    renderListOnly();
    input.focus();
  }

  function onGlobalKeyDown(e) {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (document.getElementById('agy-command-palette-backdrop')) close();
      else open();
    }
  }

  document.addEventListener('keydown', onGlobalKeyDown);

  window.__agyCommandPalette = { open, close, isOpen: () => !!document.getElementById('agy-command-palette-backdrop') };
  window.__agyCommandPaletteCleanup = () => {
    disposed = true;
    document.removeEventListener('keydown', onGlobalKeyDown);
    document.getElementById('agy-command-palette-backdrop')?.remove();
    style.remove();
    delete window.__agyCommandPalette;
  };
})();
