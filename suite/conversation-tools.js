(() => {
  window.__agyConvToolsCleanup?.();
  let disposed = false;
  let openState = false;
  let filterQuery = '';
  let starOnly = false;
  let statusNotice = '';
  let statusTimer = null;
  let scheduled = false;
  let highlightTimer = null;

  const text = (cn, en) => window.__agySuiteSettings?.i18n === false ? en : cn;

  const style = document.createElement('style');
  style.id = 'agy-conv-tools-style';
  style.textContent = `
    #agy-outline-pill {
      position: fixed;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      z-index: 9970;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      padding: 9px 7px;
      border-radius: 999px;
      border: 1px solid var(--border, rgba(20, 20, 19, 0.11));
      background: var(--glass, rgba(250, 249, 245, 0.92));
      color: var(--foreground, #141413);
      backdrop-filter: blur(10px);
      box-shadow: 0 6px 22px rgba(20, 20, 19, 0.08);
      cursor: pointer;
      font: 600 11px/1 system-ui, sans-serif;
      font-variant-numeric: tabular-nums;
      transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.18s ease, box-shadow 0.18s ease;
      user-select: none;
    }
    body.theme-dark #agy-outline-pill, html.dark #agy-outline-pill {
      background: rgba(40, 39, 37, 0.92);
      border-color: rgba(236, 233, 226, 0.13);
      box-shadow: 0 8px 26px rgba(0, 0, 0, 0.42);
    }
    #agy-outline-pill:hover, #agy-outline-pill:focus-visible, #agy-outline-pill[aria-expanded="true"] {
      transform: translate(-2px, -50%);
      border-color: #D97757;
      box-shadow: 0 8px 26px rgba(217, 119, 87, 0.18);
      outline: none;
    }
    #agy-outline-pill svg { color: #D97757; flex-shrink: 0; }
    #agy-outline-pill .agy-op-star-dot {
      width: 5px; height: 5px; border-radius: 50%; background: #D97757;
    }
    #agy-outline-drawer {
      position: fixed;
      right: 16px;
      top: 52px;
      bottom: 88px;
      width: min(356px, calc(100vw - 32px));
      max-height: calc(100vh - 110px);
      z-index: 9985;
      display: flex;
      flex-direction: column;
      border-radius: 18px;
      border: 1px solid var(--border, rgba(20, 20, 19, 0.11));
      background: var(--background, #FAF9F5);
      color: var(--foreground, #141413);
      box-shadow: 0 22px 64px rgba(20, 20, 19, 0.16), 0 2px 10px rgba(20, 20, 19, 0.06);
      font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow: hidden;
      animation: agyOutlineSlideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    body.theme-dark #agy-outline-drawer, html.dark #agy-outline-drawer {
      background: #232220;
      border-color: rgba(236, 233, 226, 0.12);
      box-shadow: 0 26px 72px rgba(0, 0, 0, 0.58), 0 2px 12px rgba(0, 0, 0, 0.35);
    }
    @keyframes agyOutlineSlideIn {
      from { opacity: 0; transform: translateX(10px) scale(0.985); }
      to { opacity: 1; transform: translateX(0) scale(1); }
    }
    .agy-od-header {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 13px 14px 10px;
      border-bottom: 1px solid var(--border, rgba(20, 20, 19, 0.08));
    }
    .agy-od-title-group { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .agy-od-title {
      font-size: 14px; font-weight: 600; margin: 0; display: flex; align-items: center; gap: 7px;
      letter-spacing: -0.01em;
    }
    .agy-od-sub { font-size: 11px; opacity: 0.58; font-variant-numeric: tabular-nums; }
    .agy-od-nav-btns { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
    .agy-od-icon-btn {
      border: 1px solid transparent; background: transparent; color: inherit;
      width: 27px; height: 27px; border-radius: 7px; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      opacity: 0.72; transition: all 0.14s ease; font-size: 13px;
    }
    .agy-od-icon-btn:hover, .agy-od-icon-btn:focus-visible {
      opacity: 1; background: var(--muted, rgba(128, 128, 128, 0.12)); outline: none;
    }
    .agy-od-toolbar {
      display: flex; align-items: center; gap: 7px;
      padding: 9px 14px;
      border-bottom: 1px solid var(--border, rgba(20, 20, 19, 0.07));
    }
    .agy-od-search {
      flex: 1; min-width: 0; padding: 6px 10px; border-radius: 8px;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.22));
      background: var(--card, rgba(255, 255, 255, 0.65));
      color: inherit; font: 12px system-ui, sans-serif; outline: none;
    }
    body.theme-dark .agy-od-search, html.dark .agy-od-search { background: #1B1A18; }
    .agy-od-search:focus { border-color: #D97757; }
    .agy-od-star-filter {
      padding: 5px 9px; border-radius: 8px; font: 500 11.5px system-ui, sans-serif;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.22));
      background: transparent; color: inherit; cursor: pointer; white-space: nowrap;
      transition: all 0.14s ease;
    }
    .agy-od-star-filter[aria-pressed="true"] {
      background: rgba(217, 119, 87, 0.14); border-color: #D97757; color: #D97757; font-weight: 600;
    }
    .agy-od-list {
      flex: 1; overflow-y: auto; padding: 10px 12px; display: flex; flex-direction: column; gap: 7px;
    }
    .agy-od-empty {
      padding: 28px 14px; text-align: center; font-size: 12px; opacity: 0.58;
    }
    .agy-od-item {
      border-radius: 11px; padding: 9px 11px;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.14));
      background: var(--card, rgba(255, 255, 255, 0.55));
      transition: border-color 0.15s ease, transform 0.15s ease, background 0.15s ease;
      cursor: pointer; display: flex; flex-direction: column; gap: 6px;
    }
    body.theme-dark .agy-od-item, html.dark .agy-od-item { background: rgba(255, 255, 255, 0.03); }
    .agy-od-item:hover { border-color: rgba(217, 119, 87, 0.55); }
    .agy-od-item[data-starred="true"] {
      border-color: rgba(217, 119, 87, 0.45);
      background: rgba(217, 119, 87, 0.045);
    }
    .agy-od-item-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .agy-od-index {
      font: 600 10.5px/1.6 system-ui, sans-serif; font-variant-numeric: tabular-nums;
      padding: 0 6px; border-radius: 99px; background: rgba(217, 119, 87, 0.13);
      color: #D97757; flex-shrink: 0; margin-top: 1px;
    }
    .agy-od-prompt {
      flex: 1; min-width: 0; font-size: 12.5px; font-weight: 500; line-height: 1.42;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      word-break: break-word;
    }
    .agy-od-item-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
    .agy-od-mini-btn {
      border: 0; background: transparent; color: inherit; cursor: pointer;
      width: 23px; height: 23px; border-radius: 6px; opacity: 0.52;
      display: inline-flex; align-items: center; justify-content: center; font-size: 12.5px;
      transition: opacity 0.14s, background 0.14s, color 0.14s;
    }
    .agy-od-mini-btn:hover, .agy-od-mini-btn:focus-visible {
      opacity: 1; background: rgba(128, 128, 128, 0.14); outline: none;
    }
    .agy-od-mini-btn[data-active="true"] { opacity: 1; color: #D97757; }
    .agy-od-badges { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
    .agy-od-badge {
      font-size: 10.5px; padding: 1px 6px; border-radius: 5px;
      background: var(--muted, rgba(128, 128, 128, 0.11)); opacity: 0.78;
      font-variant-numeric: tabular-nums;
    }
    .agy-od-headings { display: flex; flex-wrap: wrap; gap: 4px; }
    .agy-od-heading-chip {
      border: 1px solid var(--border, rgba(128, 128, 128, 0.18));
      background: transparent; color: inherit; border-radius: 6px;
      padding: 2px 7px; font: 11px/1.35 system-ui, sans-serif; cursor: pointer;
      max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      opacity: 0.82; transition: all 0.14s ease;
    }
    .agy-od-heading-chip:hover { opacity: 1; border-color: #D97757; color: #D97757; }
    .agy-od-footer {
      padding: 10px 14px; border-top: 1px solid var(--border, rgba(20, 20, 19, 0.08));
      display: flex; flex-direction: column; gap: 6px;
    }
    .agy-od-export-row { display: flex; gap: 8px; }
    .agy-od-btn {
      flex: 1; padding: 7px 10px; border-radius: 9px; font: 500 12px system-ui, sans-serif;
      cursor: pointer; border: 1px solid var(--border, rgba(128, 128, 128, 0.25));
      background: transparent; color: inherit; transition: all 0.15s ease;
      display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    }
    .agy-od-btn:hover { border-color: #D97757; color: #D97757; }
    .agy-od-btn.primary {
      background: #D97757; border-color: #D97757; color: #FFFFFF; font-weight: 600;
    }
    .agy-od-btn.primary:hover { background: #C46344; border-color: #C46344; color: #FFFFFF; }
    .agy-od-status {
      font-size: 11px; color: #D97757; min-height: 15px; text-align: center;
    }
    [data-agy-jump-highlight="true"] {
      outline: 2px solid #D97757 !important;
      outline-offset: 4px !important;
      border-radius: 12px;
      transition: outline-color 0.3s ease;
    }
    .agy-code-header-actions {
      margin-left: auto; display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0;
    }
    .agy-code-fold-btn, .agy-code-preview-btn, .agy-code-diff-btn {
      padding: 1px 8px; border-radius: 6px;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.22));
      background: transparent; color: inherit; cursor: pointer;
      font: 500 11px/1.4 system-ui, sans-serif; font-variant-numeric: tabular-nums;
      opacity: 0.82; transition: all 0.14s ease; white-space: nowrap;
    }
    .agy-code-preview-btn {
      border-color: rgba(217, 119, 87, 0.42);
      color: #D97757;
      background: rgba(217, 119, 87, 0.08);
      font-weight: 600;
    }
    body.theme-dark .agy-code-preview-btn, html.dark .agy-code-preview-btn { color: #E58B6D; }
    .agy-code-fold-btn:hover, .agy-code-preview-btn:hover, .agy-code-diff-btn:hover {
      opacity: 1; border-color: #D97757; color: #D97757;
    }
    .agy-code-preview-btn[data-open="true"], .agy-code-diff-btn[data-open="true"] {
      background: #D97757; border-color: #D97757; color: #FFFFFF; opacity: 1;
    }
    .agy-code-diff-panel {
      border-top: 1px solid var(--border, rgba(128, 128, 128, 0.18));
      background: var(--background, #FAF9F5);
      display: flex; flex-direction: column;
      font: 12px/1.5 Consolas, "Cascadia Code", Monaco, monospace;
    }
    body.theme-dark .agy-code-diff-panel, html.dark .agy-code-diff-panel { background: #1A1918; }
    .agy-code-diff-head {
      display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
      padding: 6px 12px; font: 500 11.5px/1.3 system-ui, sans-serif;
      border-bottom: 1px solid var(--border, rgba(128, 128, 128, 0.14));
      background: rgba(217, 119, 87, 0.055);
    }
    .agy-code-diff-select {
      padding: 2px 7px; border-radius: 6px; font: 11px system-ui, sans-serif;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.25));
      background: var(--card, #FFFFFF); color: inherit;
    }
    body.theme-dark .agy-code-diff-select, html.dark .agy-code-diff-select { background: #252422; color: #ECE9E2; }
    .agy-code-diff-body { max-height: 320px; overflow: auto; padding: 4px 0; }
    .agy-diff-row {
      display: grid; grid-template-columns: 36px 36px 18px 1fr;
      padding: 0 10px; white-space: pre-wrap; word-break: break-all;
    }
    .agy-diff-row .agy-diff-no {
      opacity: 0.42; text-align: right; padding-right: 6px; user-select: none; font-size: 11px;
    }
    .agy-diff-row .agy-diff-sig { user-select: none; font-weight: 600; }
    .agy-diff-row[data-diff="add"] { background: rgba(46, 125, 71, 0.13); color: #1E5E32; }
    .agy-diff-row[data-diff="del"] { background: rgba(201, 64, 56, 0.12); color: #9E2A24; }
    body.theme-dark .agy-diff-row[data-diff="add"], html.dark .agy-diff-row[data-diff="add"] {
      background: rgba(72, 168, 104, 0.16); color: #7CE09B;
    }
    body.theme-dark .agy-diff-row[data-diff="del"], html.dark .agy-diff-row[data-diff="del"] {
      background: rgba(224, 90, 82, 0.16); color: #F5938D;
    }
    .agy-diff-skip {
      padding: 3px 14px; font: 11px system-ui, sans-serif; opacity: 0.52;
      background: rgba(128, 128, 128, 0.06); text-align: center; user-select: none;
    }
    .agy-live-preview-panel {
      border-top: 1px solid var(--border, rgba(128, 128, 128, 0.18));
      background: var(--background, #FAF9F5);
      display: flex; flex-direction: column;
    }
    body.theme-dark .agy-live-preview-panel, html.dark .agy-live-preview-panel {
      background: #1B1A18;
    }
    .agy-live-preview-toolbar {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 6px 12px; font: 500 11px/1.3 system-ui, sans-serif;
      border-bottom: 1px solid var(--border, rgba(128, 128, 128, 0.14));
      background: rgba(217, 119, 87, 0.06);
      flex-wrap: wrap;
    }
    .agy-live-preview-badge {
      display: inline-flex; align-items: center; gap: 5px; color: #D97757; font-weight: 600;
    }
    .agy-live-preview-btns { display: inline-flex; align-items: center; gap: 5px; flex-wrap: wrap; }
    .agy-live-preview-btns button {
      border: 1px solid var(--border, rgba(128, 128, 128, 0.24));
      background: var(--card, rgba(255, 255, 255, 0.6)); color: inherit;
      border-radius: 6px; padding: 2px 8px; font: inherit; cursor: pointer;
      transition: all 0.13s ease;
    }
    body.theme-dark .agy-live-preview-btns button, html.dark .agy-live-preview-btns button {
      background: rgba(255, 255, 255, 0.05);
    }
    .agy-live-preview-btns button:hover, .agy-live-preview-btns button[data-active="true"] {
      border-color: #D97757; color: #D97757;
    }
    .agy-live-preview-stage {
      padding: 12px; display: flex; justify-content: center; background: rgba(128, 128, 128, 0.04);
    }
    .agy-live-preview-frame {
      width: 100%; height: 300px; border: 1px solid var(--border, rgba(128, 128, 128, 0.18));
      border-radius: 8px; background: #FFFFFF; transition: width 0.2s ease;
    }
    .agy-live-preview-frame[data-viewport="mobile"] {
      width: 390px; max-width: 100%;
    }
    caption.agy-table-tools {
      caption-side: bottom; text-align: right; padding: 6px 2px 2px;
      font: 500 11px/1.3 system-ui, sans-serif;
    }
    .agy-table-tools-bar {
      display: inline-flex; align-items: center; gap: 5px;
    }
    .agy-table-tools-bar button {
      border: 1px solid var(--border, rgba(128, 128, 128, 0.22));
      background: var(--card, rgba(250, 249, 245, 0.78));
      color: var(--foreground, #141413);
      border-radius: 6px; padding: 2px 8px; font: inherit; cursor: pointer;
      opacity: 0.78; transition: all 0.14s ease;
    }
    body.theme-dark .agy-table-tools-bar button, html.dark .agy-table-tools-bar button {
      background: rgba(40, 39, 37, 0.85); color: #ECE9E2;
    }
    .agy-table-tools-bar button:hover {
      opacity: 1; border-color: #D97757; color: #D97757;
    }
    .rounded-xl.bg-muted.border[data-agy-code-folded="true"] pre,
    .rounded-xl.bg-muted.border[data-agy-code-folded="true"] > div:not(.border-b):not(.agy-live-preview-panel):not(.agy-code-diff-panel) {
      max-height: 156px !important;
      overflow: hidden !important;
      mask-image: linear-gradient(to bottom, #000 58%, transparent 100%);
      -webkit-mask-image: linear-gradient(to bottom, #000 58%, transparent 100%);
    }
    #agy-selection-pill {
      position: fixed; z-index: 10010;
      display: inline-flex; align-items: center; gap: 3px;
      padding: 4px 5px; border-radius: 999px;
      border: 1px solid var(--border, rgba(20, 20, 19, 0.14));
      background: var(--background, #FAF9F5); color: var(--foreground, #141413);
      box-shadow: 0 10px 28px rgba(20, 20, 19, 0.16), 0 1px 4px rgba(20, 20, 19, 0.08);
      font: 500 11.5px/1.2 system-ui, sans-serif;
      animation: agySelPop 0.12s cubic-bezier(0.16, 1, 0.3, 1) both;
      user-select: none;
    }
    body.theme-dark #agy-selection-pill, html.dark #agy-selection-pill {
      background: #262523; border-color: rgba(236, 233, 226, 0.16);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
    }
    @keyframes agySelPop {
      from { opacity: 0; transform: translateY(4px) scale(0.96); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    #agy-selection-pill button {
      border: 0; background: transparent; color: inherit; cursor: pointer;
      padding: 5px 9px; border-radius: 999px; font: inherit; white-space: nowrap;
      transition: background 0.12s, color 0.12s;
    }
    #agy-selection-pill button:hover { background: rgba(217, 119, 87, 0.14); color: #D97757; }
  `;
  document.head.appendChild(style);

  function conversationKey() {
    const match = location.pathname.match(/\/c\/([^/?#]+)/);
    return match ? match[1] : 'home';
  }

  function loadStars() {
    try {
      const raw = localStorage.getItem('__agy_conv_stars__:' + conversationKey());
      const arr = JSON.parse(raw || '[]');
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  }

  function saveStars(stars) {
    try {
      localStorage.setItem('__agy_conv_stars__:' + conversationKey(), JSON.stringify([...stars]));
    } catch {}
  }

  function stripBridgeMarkers(raw) {
    return String(raw || '')
      .replace(/\[ANTIGRAVITY_BRIDGE_SYNC_START\][\s\S]*?\[ANTIGRAVITY_BRIDGE_SYNC_END\]\s*/g, '')
      .trim();
  }

  function primaryRoot() {
    return document.querySelector('[data-main-content-body]') || document.querySelector('main') || document.body;
  }

  function isExcluded(el) {
    return Boolean(el.closest?.('[data-side-panel-body], #agy-suite-backdrop, #agy-outline-drawer, #agy-prompt-vault-backdrop, #agy-command-palette-backdrop'));
  }

  function getTurns() {
    const root = primaryRoot();
    if (!root) return [];
    const nodes = [...root.querySelectorAll('[data-testid="user-input-step"], [data-testid="user-message-bubble"], [data-testid="planner-response-text"]')];
    const turns = [];
    let current = null;

    for (const el of nodes) {
      if (isExcluded(el)) continue;
      const testid = el.getAttribute('data-testid');
      if (testid === 'user-message-bubble' && el.closest('[data-testid="user-input-step"]')) continue;

      if (testid === 'user-input-step' || testid === 'user-message-bubble') {
        const quoteEl = el.querySelector('[data-quotable="true"], [data-testid="user-message-content"]') || el;
        const prompt = stripBridgeMarkers(quoteEl.textContent || '');
        if (!prompt) continue;
        const index = turns.length + 1;
        current = {
          index,
          id: index + ':' + prompt.slice(0, 48),
          prompt,
          userEl: el,
          replyNodes: [],
          headings: [],
          codeCount: 0,
          tableCount: 0
        };
        turns.push(current);
      } else if (testid === 'planner-response-text') {
        if (!current) {
          const index = turns.length + 1;
          current = {
            index,
            id: index + ':reply',
            prompt: text('（AI 回复）', '(Assistant reply)'),
            userEl: el,
            replyNodes: [],
            headings: [],
            codeCount: 0,
            tableCount: 0
          };
          turns.push(current);
        }
        current.replyNodes.push(el);
        const pres = el.querySelectorAll('pre');
        current.codeCount += pres.length || el.querySelectorAll('.code-block').length;
        current.tableCount += el.querySelectorAll('table').length;
        for (const h of el.querySelectorAll('h1, h2, h3')) {
          const hText = (h.textContent || '').trim();
          if (hText && current.headings.length < 6) {
            current.headings.push({ tag: h.tagName.toLowerCase(), text: hText, el: h });
          }
        }
      }
    }
    return turns;
  }

  function inlineMarkdown(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toUpperCase();
    if (tag === 'BUTTON' || tag === 'STYLE' || tag === 'SCRIPT' || tag === 'SVG') return '';
    if (tag === 'BR') return '\n';
    const inner = [...node.childNodes].map(inlineMarkdown).join('');
    if (tag === 'CODE' && !node.closest('pre')) return '`' + inner.replace(/`/g, '\\`') + '`';
    if (tag === 'STRONG' || tag === 'B') return inner.trim() ? `**${inner.trim()}**` : '';
    if (tag === 'EM' || tag === 'I') return inner.trim() ? `*${inner.trim()}*` : '';
    if (tag === 'DEL' || tag === 'S') return inner.trim() ? `~~${inner.trim()}~~` : '';
    if (tag === 'A') {
      const href = node.getAttribute('href') || '';
      return href && !href.startsWith('javascript:') ? `[${inner.trim() || href}](${href})` : inner;
    }
    return inner;
  }

  function resolveCodeCard(node) {
    if (!node) return null;
    const card = node.matches?.('.rounded-xl.bg-muted.border')
      ? node
      : (node.querySelector?.(':scope > .rounded-xl.bg-muted.border, .rounded-xl.bg-muted.border') || node.closest?.('.rounded-xl.bg-muted.border'));
    const header = card?.querySelector?.(':scope > .border-b') || null;
    let bodyEl = null;
    if (card) {
      bodyEl = [...card.children].find(ch =>
        ch !== header &&
        !ch.classList.contains('agy-live-preview-panel') &&
        !ch.classList.contains('agy-code-diff-panel') &&
        ch.tagName?.toUpperCase() !== 'STYLE'
      ) || null;
    } else if (node.tagName?.toUpperCase() === 'PRE') {
      bodyEl = node;
    }
    if (!bodyEl) return null;
    const codeNode = bodyEl.querySelector?.('pre code, code, .code-block') || bodyEl;
    let lang = '';
    if (header) {
      const dedicated = header.querySelector('.text-muted-foreground');
      if (dedicated && !dedicated.closest('button, .agy-code-header-actions')) {
        const tok = (dedicated.textContent || '').trim().split(/\s+/)[0] || '';
        if (/^[a-zA-Z0-9_+#.-]{1,24}$/.test(tok) && !/^(copy|复制|preview|raw)$/i.test(tok)) lang = tok.toLowerCase();
      }
      if (!lang) {
        const headerText = [...header.childNodes]
          .filter(n => {
            if (n.nodeType === 3) return true;
            if (n.nodeType !== 1) return false;
            if (n.matches?.('button, [role="button"], .agy-code-fold-btn, .agy-code-preview-btn, .agy-code-diff-btn, .agy-code-header-actions')) return false;
            if (n.querySelector?.('button') && !(n.textContent || '').replace(/copy|复制|preview|raw/gi, '').trim()) return false;
            return true;
          })
          .map(n => n.textContent || '')
          .join(' ');
        const tok = headerText.trim().split(/\s+/)[0] || '';
        if (/^[a-zA-Z0-9_+#.-]{1,24}$/.test(tok) && !/^(copy|复制|preview|raw)$/i.test(tok)) lang = tok.toLowerCase();
      }
    }
    if (!lang) {
      const cls = codeNode.className || '';
      const m = typeof cls === 'string' && cls.match(/language-([a-zA-Z0-9_+-]+)/);
      if (m) lang = m[1].toLowerCase();
    }
    const rawCode = (codeNode.textContent || '').replace(/\n+$/, '');
    return { card, header, bodyEl, codeNode, lang, rawCode };
  }

  function extractCodeBlock(preOrCard) {
    const info = resolveCodeCard(preOrCard);
    const lang = info?.lang || '';
    const raw = info ? info.rawCode : (preOrCard.textContent || '').replace(/\n+$/, '');
    const fence = raw.includes('```') ? '````' : '```';
    return `\n${fence}${lang}\n${raw}\n${fence}\n\n`;
  }

  function tableToMarkdown(table) {
    const rows = [...table.querySelectorAll('tr')].map(tr =>
      [...tr.querySelectorAll('th, td')].map(cell => inlineMarkdown(cell).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim())
    ).filter(r => r.length > 0);
    if (!rows.length) return '';
    const cols = Math.max(...rows.map(r => r.length));
    const pad = r => Array.from({ length: cols }, (_, i) => r[i] || '');
    const head = pad(rows[0]);
    const sep = head.map(() => '---');
    const body = rows.slice(1).map(r => `| ${pad(r).join(' | ')} |`);
    return `\n| ${head.join(' | ')} |\n| ${sep.join(' | ')} |\n${body.join('\n')}\n\n`;
  }

  function tablePlainCell(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toUpperCase();
    if (tag === 'BUTTON' || tag === 'STYLE' || tag === 'SCRIPT' || tag === 'SVG' || tag === 'CAPTION') return '';
    if (tag === 'BR') return ' ';
    return [...node.childNodes].map(tablePlainCell).join('');
  }

  function tableToDelimited(table, sep = '\t') {
    if (!table) return '';
    const rows = [...table.querySelectorAll('tr')].map(tr =>
      [...tr.querySelectorAll('th, td')].map(cell => tablePlainCell(cell).replace(/\s+/g, ' ').trim())
    ).filter(r => r.length > 0);
    if (!rows.length) return '';
    return rows.map(row => row.map(val => {
      if (sep === ',') {
        return /[",\r\n]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val;
      }
      return val.replace(/[\t\r\n]+/g, ' ');
    }).join(sep)).join('\n');
  }

  function blockMarkdown(node, listDepth = 0) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.matches?.('.agy-live-preview-panel, .agy-code-diff-panel, .agy-table-tools, .agy-code-header-actions')) return '';
    const tag = node.tagName.toUpperCase();
    if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'BUTTON' || tag === 'SVG' || tag === 'IFRAME' || tag === 'CAPTION') return '';
    if (tag === 'PRE') return extractCodeBlock(node);
    if (node.matches?.('.rounded-xl.bg-muted.border') && resolveCodeCard(node)) {
      return extractCodeBlock(node);
    }
    if (tag === 'TABLE') return tableToMarkdown(node);
    if (/^H[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      return `\n${'#'.repeat(level)} ${inlineMarkdown(node).trim()}\n\n`;
    }
    if (tag === 'HR') return '\n---\n\n';
    if (tag === 'BLOCKQUOTE') {
      const textContent = [...node.childNodes].map(c => blockMarkdown(c, listDepth)).join('').trim();
      return '\n' + textContent.split('\n').map(l => `> ${l}`).join('\n') + '\n\n';
    }
    if (tag === 'UL' || tag === 'OL') {
      const ordered = tag === 'OL';
      let idx = 1;
      const items = [...node.children].filter(c => c.tagName?.toUpperCase() === 'LI').map(li => {
        const prefix = '  '.repeat(listDepth) + (ordered ? `${idx++}. ` : '- ');
        const parts = [];
        for (const child of li.childNodes) {
          const cTag = child.tagName?.toUpperCase();
          if (cTag === 'UL' || cTag === 'OL') parts.push('\n' + blockMarkdown(child, listDepth + 1).trimEnd());
          else parts.push(inlineMarkdown(child));
        }
        return prefix + parts.join('').replace(/^\s+/, '').trimEnd();
      });
      return (listDepth === 0 ? '\n' : '') + items.join('\n') + (listDepth === 0 ? '\n\n' : '\n');
    }
    if (tag === 'P') {
      const content = inlineMarkdown(node).trim();
      return content ? `${content}\n\n` : '';
    }
    return [...node.childNodes].map(c => blockMarkdown(c, listDepth)).join('');
  }

  function turnToMarkdown(turn) {
    const replyMd = turn.replyNodes
      .map(el => blockMarkdown(el))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const header = `## ${text(`第 ${turn.index} 轮`, `Turn ${turn.index}`)}`;
    const userPart = `### ${text('提问', 'Prompt')}\n\n${turn.prompt.trim()}`;
    const aiPart = replyMd ? `\n\n### ${text('回复', 'Response')}\n\n${replyMd}` : '';
    return `${header}\n\n${userPart}${aiPart}`;
  }

  function exportMarkdown({ onlyStarred = false } = {}) {
    const turns = getTurns();
    const stars = loadStars();
    const list = onlyStarred ? turns.filter(t => stars.has(t.id)) : turns;
    const title = (document.title || 'Antigravity Conversation').replace(/\s*[-|]\s*Antigravity.*$/i, '').trim() || 'Antigravity Conversation';
    const date = new Date().toISOString().slice(0, 10);
    const meta = `# ${title}\n\n> ${text('导出日期', 'Exported')}: ${date} · ${text('共', 'Total')} ${list.length} ${text('轮', 'turns')}${onlyStarred ? text('（仅星标重点）', ' (starred only)') : ''}\n\n---\n\n`;
    return meta + list.map(turnToMarkdown).join('\n\n---\n\n') + '\n';
  }

  async function writeClipboard(value) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const area = document.createElement('textarea');
    area.value = value;
    area.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }

  function flashStatus(msg) {
    statusNotice = msg;
    clearTimeout(statusTimer);
    const el = document.querySelector('#agy-outline-drawer .agy-od-status');
    if (el) el.textContent = msg;
    statusTimer = setTimeout(() => {
      statusNotice = '';
      const target = document.querySelector('#agy-outline-drawer .agy-od-status');
      if (target) target.textContent = '';
    }, 2800);
  }

  async function copyMarkdown(options = {}) {
    const turns = getTurns();
    const stars = loadStars();
    const useStarred = options.onlyStarred ?? starOnly;
    const selected = useStarred ? turns.filter(t => stars.has(t.id)) : turns;
    if (!selected.length) {
      flashStatus(text('没有可导出的对话轮次', 'No conversation turns to copy'));
      return '';
    }
    const md = exportMarkdown({ onlyStarred: useStarred });
    await writeClipboard(md);
    flashStatus(text(`✓ 已复制 ${selected.length} 轮 Markdown`, `✓ Copied ${selected.length} turns as Markdown`));
    return md;
  }

  function downloadMarkdown(options = {}) {
    const useStarred = options.onlyStarred ?? starOnly;
    const md = exportMarkdown({ onlyStarred: useStarred });
    const rawTitle = (document.title || 'conversation').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 48).trim() || 'conversation';
    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rawTitle}-${date}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flashStatus(text('✓ 已导出 .md 文件', '✓ Downloaded .md file'));
  }

  function escapeHtml(raw) {
    return String(raw ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeNodeToHtml(node) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.nodeValue || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.matches?.('.agy-live-preview-panel, .agy-code-diff-panel, .agy-table-tools, .agy-code-header-actions')) return '';
    const tag = node.tagName.toUpperCase();
    if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'BUTTON' || tag === 'SVG' || tag === 'IFRAME' || tag === 'OBJECT' || tag === 'CAPTION') return '';
    if (tag === 'BR') return '<br>';
    if (tag === 'HR') return '<hr>';
    if (tag === 'PRE' || (node.matches?.('.rounded-xl.bg-muted.border') && resolveCodeCard(node))) {
      const info = resolveCodeCard(node);
      const lang = info?.lang || 'code';
      const raw = info ? info.rawCode : (node.textContent || '').replace(/\n+$/, '');
      return `<div class="code-card"><div class="code-head"><span>${escapeHtml(lang)}</span><button type="button" class="copy-code">Copy</button></div><pre><code>${escapeHtml(raw)}</code></pre></div>`;
    }
    const children = [...node.childNodes].map(safeNodeToHtml).join('');
    if (/^H[1-6]$/.test(tag)) {
      const lvl = tag.toLowerCase();
      return `<${lvl}>${children}</${lvl}>`;
    }
    if (['P', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'STRONG', 'B', 'EM', 'I', 'DEL', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD'].includes(tag)) {
      const out = tag === 'B' ? 'strong' : tag === 'I' ? 'em' : tag.toLowerCase();
      return `<${out}>${children}</${out}>`;
    }
    if (tag === 'CODE') return `<code class="inline-code">${children}</code>`;
    if (tag === 'A') {
      const href = String(node.getAttribute('href') || '').trim();
      if (/^(https?:|mailto:)/i.test(href)) {
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${children}</a>`;
      }
      return children;
    }
    return children;
  }

  function exportBookishHtml({ onlyStarred = false } = {}) {
    const turns = getTurns();
    const stars = loadStars();
    const list = onlyStarred ? turns.filter(t => stars.has(t.id)) : turns;
    const rawTitle = (document.title || 'Antigravity Conversation').replace(/\s*[-|]\s*Antigravity.*$/i, '').trim() || 'Antigravity Conversation';
    const date = new Date().toISOString().slice(0, 10);
    const tocItems = list.map(t => {
      const preview = escapeHtml(t.prompt.replace(/\s+/g, ' ').slice(0, 44));
      return `<a class="toc-item" href="#turn-${t.index}"><span class="toc-idx">#${t.index}</span><span>${preview}</span></a>`;
    }).join('');
    const bodyTurns = list.map(t => {
      const replyHtml = t.replyNodes.map(safeNodeToHtml).join('\n');
      return `<article class="turn" id="turn-${t.index}">
        <div class="turn-meta"><span class="turn-badge">#${t.index}</span>${stars.has(t.id) ? '<span class="star-tag">★ Starred</span>' : ''}</div>
        <div class="user-bubble">${escapeHtml(t.prompt)}</div>
        <div class="ai-prose">${replyHtml}</div>
      </article>`;
    }).join('\n');

    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(rawTitle)}</title>
<style>
:root{--bg:#FAF9F5;--sidebar:#F0EEE6;--card:#FFFFFF;--fg:#191816;--muted:#706D64;--border:rgba(20,20,19,.09);--accent:#D97757;--bubble:#F2EFE7;--code-bg:#F4F2EA;--code-head:#EAE7DD}
html.dark{--bg:#1F1E1D;--sidebar:#161514;--card:#282725;--fg:#ECE9E2;--muted:#9A968C;--border:rgba(236,233,226,.11);--accent:#E58B6D;--bubble:#2B2A27;--code-bg:#1A1918;--code-head:#242320}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.76 "Source Serif 4","Noto Serif SC",Georgia,serif;display:grid;grid-template-columns:260px 1fr;min-height:100vh}
aside{position:sticky;top:0;height:100vh;overflow-y:auto;background:var(--sidebar);border-right:1px solid var(--border);padding:20px 14px;font-family:system-ui,-apple-system,sans-serif}
.toc-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:14px}.toc-head strong{font-size:13px}
.theme-btn{border:1px solid var(--border);background:var(--card);color:var(--fg);border-radius:99px;padding:4px 10px;font-size:11.5px;cursor:pointer}
.toc-item{display:flex;gap:7px;align-items:baseline;padding:7px 9px;border-radius:8px;color:var(--fg);text-decoration:none;font-size:12.5px;line-height:1.4;margin-bottom:3px}
.toc-item:hover{background:rgba(217,119,87,.12);color:var(--accent)}.toc-idx{color:var(--accent);font-weight:600;font-size:11px;flex-shrink:0}
main{max-width:52rem;width:100%;margin:0 auto;padding:42px 32px 80px}
header.doc-head{border-bottom:1px solid var(--border);padding-bottom:18px;margin-bottom:32px}
header.doc-head h1{margin:0 0 8px;font-size:28px;line-height:1.3}header.doc-head p{margin:0;font:13px system-ui,sans-serif;color:var(--muted)}
.turn{padding:24px 0;border-bottom:1px solid var(--border)}.turn-meta{display:flex;gap:8px;align-items:center;margin-bottom:10px;font:600 12px system-ui,sans-serif}
.turn-badge{background:rgba(217,119,87,.14);color:var(--accent);padding:2px 8px;border-radius:99px}.star-tag{color:var(--accent)}
.user-bubble{background:var(--bubble);border:1px solid var(--border);border-radius:16px;padding:12px 16px;font:14.5px/1.62 system-ui,-apple-system,sans-serif;white-space:pre-wrap;margin-bottom:18px}
.ai-prose h1,.ai-prose h2,.ai-prose h3{line-height:1.35;margin:1.3em 0 .5em}.ai-prose a{color:var(--accent)}
.inline-code{font:0.86em Consolas,monospace;background:var(--code-head);padding:2px 6px;border-radius:5px}
.code-card{background:var(--code-bg);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin:14px 0;font-family:Consolas,monospace}
.code-head{display:flex;justify-content:space-between;align-items:center;padding:6px 12px;background:var(--code-head);font:12px system-ui,sans-serif;color:var(--muted)}
.copy-code{border:1px solid var(--border);background:transparent;color:inherit;border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer}
.code-card pre{margin:0;padding:12px 14px;overflow-x:auto;font-size:13px;line-height:1.55}
blockquote{margin:12px 0;padding:8px 14px;border-left:3px solid var(--accent);background:var(--bubble);border-radius:0 8px 8px 0}
table{width:100%;border-collapse:collapse;margin:14px 0;font-size:14px}th,td{border:1px solid var(--border);padding:8px 11px;text-align:left}th{background:var(--code-head)}
@media(max-width:800px){body{grid-template-columns:1fr}aside{position:static;height:auto}}
@media print{aside,.copy-code,.theme-btn{display:none}body{display:block;background:#fff;color:#111}main{max-width:100%;padding:0}}
</style>
</head>
<body>
<aside>
  <div class="toc-head"><strong>${escapeHtml(text('对话目录', 'Contents'))} (${list.length})</strong><button type="button" class="theme-btn" id="theme-toggle">☀️ / 🌙</button></div>
  ${tocItems}
</aside>
<main>
  <header class="doc-head"><h1>${escapeHtml(rawTitle)}</h1><p>${escapeHtml(date)} · ${list.length} ${escapeHtml(text('轮对话归档', 'turns archived'))}</p></header>
  ${bodyTurns}
</main>
<script>
document.getElementById('theme-toggle').onclick=()=>document.documentElement.classList.toggle('dark');
document.querySelectorAll('.copy-code').forEach(b=>b.onclick=()=>{navigator.clipboard.writeText(b.closest('.code-card').querySelector('code').textContent);b.textContent='Copied ✓';setTimeout(()=>b.textContent='Copy',1500);});
</script>
</body>
</html>`;
  }

  function downloadBookishHtml(options = {}) {
    const useStarred = options.onlyStarred ?? starOnly;
    const html = exportBookishHtml({ onlyStarred: useStarred });
    const rawTitle = (document.title || 'conversation').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 48).trim() || 'conversation';
    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rawTitle}-${date}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flashStatus(text('✓ 已导出书卷排版 .html 报告', '✓ Downloaded bookish .html report'));
  }

  function jumpToElement(el) {
    if (!el) return;
    document.querySelectorAll('[data-agy-jump-highlight]').forEach(n => n.removeAttribute('data-agy-jump-highlight'));
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.setAttribute('data-agy-jump-highlight', 'true');
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => el.removeAttribute('data-agy-jump-highlight'), 1500);
  }

  function toggleStar(turnId) {
    const stars = loadStars();
    if (stars.has(turnId)) stars.delete(turnId);
    else stars.add(turnId);
    saveStars(stars);
    render();
    return stars.has(turnId);
  }

  function isStarred(turnId) {
    return loadStars().has(turnId);
  }

  function scrollEdge(toBottom) {
    const turns = getTurns();
    if (!turns.length) return;
    if (toBottom) {
      const last = turns.at(-1);
      const target = last.replyNodes.at(-1) || last.userEl;
      target?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    } else {
      turns[0].userEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function renderDrawer(turns, stars) {
    let drawer = document.getElementById('agy-outline-drawer');
    if (!openState || !turns.length || window.__agySuiteSettings?.outline === false) {
      drawer?.remove();
      return;
    }
    if (!drawer) {
      drawer = document.createElement('aside');
      drawer.id = 'agy-outline-drawer';
      drawer.setAttribute('role', 'dialog');
      drawer.setAttribute('aria-label', text('对话目录与导出', 'Conversation Outline & Export'));
      drawer.setAttribute('data-ag-localization-skip', 'true');
      document.body.appendChild(drawer);
    }

    const activeSearch = drawer.querySelector('.agy-od-search');
    const hadSearchFocus = activeSearch && document.activeElement === activeSearch;
    const cursorStart = hadSearchFocus ? activeSearch.selectionStart : null;

    const starredCount = turns.filter(t => stars.has(t.id)).length;
    const q = filterQuery.trim().toLowerCase();
    const filtered = turns.filter(t => {
      if (starOnly && !stars.has(t.id)) return false;
      if (!q) return true;
      return t.prompt.toLowerCase().includes(q) || t.headings.some(h => h.text.toLowerCase().includes(q));
    });

    drawer.replaceChildren();

    const header = document.createElement('div');
    header.className = 'agy-od-header';
    const titleGroup = document.createElement('div');
    titleGroup.className = 'agy-od-title-group';
    const h = document.createElement('h3');
    h.className = 'agy-od-title';
    h.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#D97757" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg><span></span>';
    h.lastElementChild.textContent = text('对话目录与导出', 'Conversation Outline');
    const sub = document.createElement('span');
    sub.className = 'agy-od-sub';
    sub.textContent = text(`共 ${turns.length} 轮对话 · ${starredCount} 个重点星标`, `${turns.length} turns · ${starredCount} starred`);
    titleGroup.append(h, sub);

    const navBtns = document.createElement('div');
    navBtns.className = 'agy-od-nav-btns';
    const topBtn = document.createElement('button');
    topBtn.type = 'button';
    topBtn.className = 'agy-od-icon-btn';
    topBtn.textContent = '↑';
    topBtn.title = text('回到首轮提问', 'Jump to top');
    topBtn.onclick = () => scrollEdge(false);
    const botBtn = document.createElement('button');
    botBtn.type = 'button';
    botBtn.className = 'agy-od-icon-btn';
    botBtn.textContent = '↓';
    botBtn.title = text('跳至最新回复', 'Jump to bottom');
    botBtn.onclick = () => scrollEdge(true);
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'agy-od-icon-btn';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', text('关闭目录', 'Close outline'));
    closeBtn.onclick = () => close();
    navBtns.append(topBtn, botBtn, closeBtn);
    header.append(titleGroup, navBtns);

    const toolbar = document.createElement('div');
    toolbar.className = 'agy-od-toolbar';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'agy-od-search';
    search.placeholder = text('搜索本会话提问或小标题…', 'Filter prompts or headings…');
    search.value = filterQuery;
    search.oninput = () => {
      filterQuery = search.value;
      renderDrawer(getTurns(), loadStars());
    };
    const starBtn = document.createElement('button');
    starBtn.type = 'button';
    starBtn.className = 'agy-od-star-filter';
    starBtn.setAttribute('aria-pressed', String(starOnly));
    starBtn.textContent = `★ ${starredCount}`;
    starBtn.title = text('仅显示星标轮次', 'Show starred turns only');
    starBtn.onclick = () => {
      starOnly = !starOnly;
      renderDrawer(getTurns(), loadStars());
    };
    toolbar.append(search, starBtn);

    const list = document.createElement('div');
    list.className = 'agy-od-list';
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'agy-od-empty';
      empty.textContent = starOnly
        ? text('尚未标记星标轮次；点击任意轮次右侧 ☆ 即可收藏重点结论', 'No starred turns yet. Click ☆ on any turn to bookmark it.')
        : text('没有匹配的对话轮次', 'No matching turns');
      list.appendChild(empty);
    } else {
      for (const turn of filtered) {
        const starred = stars.has(turn.id);
        const card = document.createElement('div');
        card.className = 'agy-od-item';
        card.dataset.turnIndex = String(turn.index);
        card.dataset.starred = String(starred);
        card.onclick = e => {
          if (e.target.closest('button')) return;
          jumpToElement(turn.userEl);
        };

        const top = document.createElement('div');
        top.className = 'agy-od-item-top';
        const idx = document.createElement('span');
        idx.className = 'agy-od-index';
        idx.textContent = `#${turn.index}`;
        const prompt = document.createElement('span');
        prompt.className = 'agy-od-prompt';
        prompt.textContent = turn.prompt.replace(/\s+/g, ' ');

        const actions = document.createElement('div');
        actions.className = 'agy-od-item-actions';
        const reuseBtn = document.createElement('button');
        reuseBtn.type = 'button';
        reuseBtn.className = 'agy-od-mini-btn';
        reuseBtn.dataset.reuseTurn = String(turn.index);
        reuseBtn.title = text('将本轮提问填入输入框复用', 'Reuse this prompt in composer');
        reuseBtn.textContent = '↺';
        reuseBtn.onclick = e => {
          e.stopPropagation();
          if (window.__agyPromptVault?.insertIntoComposer) {
            window.__agyPromptVault.insertIntoComposer(turn.prompt, { append: false });
          } else {
            writeClipboard(turn.prompt);
          }
          flashStatus(text(`✓ 已将第 ${turn.index} 轮提问填入输入框`, `✓ Loaded Turn #${turn.index} prompt`));
        };
        const pinOne = document.createElement('button');
        pinOne.type = 'button';
        pinOne.className = 'agy-od-mini-btn';
        pinOne.dataset.pinTurn = String(turn.index);
        pinOne.title = text('钉入跨会话上下文暂存匣 (Alt+B)', 'Pin turn to Cross-Session Pinboard (Alt+B)');
        pinOne.textContent = '📌';
        pinOne.onclick = async e => {
          e.stopPropagation();
          if (window.__agyPinboard?.addPin) {
            await window.__agyPinboard.addPin({
              title: `#${turn.index} ${turn.prompt.replace(/\s+/g, ' ').slice(0, 44)}`,
              content: turnToMarkdown(turn)
            });
            flashStatus(text(`✓ 已将第 ${turn.index} 轮钉入暂存匣`, `✓ Pinned Turn #${turn.index} to Pinboard`));
          }
        };
        const copyOne = document.createElement('button');
        copyOne.type = 'button';
        copyOne.className = 'agy-od-mini-btn';
        copyOne.dataset.copyTurn = String(turn.index);
        copyOne.title = text('复制本轮问答 Markdown', 'Copy this turn as Markdown');
        copyOne.textContent = '⧉';
        copyOne.onclick = async e => {
          e.stopPropagation();
          await writeClipboard(turnToMarkdown(turn));
          flashStatus(text(`✓ 已复制第 ${turn.index} 轮 Markdown`, `✓ Copied Turn #${turn.index}`));
        };
        const starToggle = document.createElement('button');
        starToggle.type = 'button';
        starToggle.className = 'agy-od-mini-btn';
        starToggle.dataset.starTurn = String(turn.index);
        starToggle.dataset.active = String(starred);
        starToggle.title = starred ? text('取消星标', 'Remove star') : text('标记重点星标', 'Star this turn');
        starToggle.textContent = starred ? '★' : '☆';
        starToggle.onclick = e => {
          e.stopPropagation();
          toggleStar(turn.id);
        };
        actions.append(reuseBtn, pinOne, copyOne, starToggle);
        top.append(idx, prompt, actions);
        card.appendChild(top);

        if (turn.codeCount > 0 || turn.tableCount > 0) {
          const badges = document.createElement('div');
          badges.className = 'agy-od-badges';
          if (turn.codeCount > 0) {
            const b = document.createElement('span');
            b.className = 'agy-od-badge';
            b.textContent = `</> ${turn.codeCount} ${text('处代码', 'code')}`;
            badges.appendChild(b);
          }
          if (turn.tableCount > 0) {
            const b = document.createElement('span');
            b.className = 'agy-od-badge';
            b.textContent = `⊞ ${turn.tableCount} ${text('张表格', 'tables')}`;
            badges.appendChild(b);
          }
          card.appendChild(badges);
        }

        if (turn.headings.length > 0) {
          const hWrap = document.createElement('div');
          hWrap.className = 'agy-od-headings';
          for (const hItem of turn.headings) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'agy-od-heading-chip';
            chip.textContent = `§ ${hItem.text}`;
            chip.onclick = e => {
              e.stopPropagation();
              jumpToElement(hItem.el);
            };
            hWrap.appendChild(chip);
          }
          card.appendChild(hWrap);
        }

        list.appendChild(card);
      }
    }

    const footer = document.createElement('div');
    footer.className = 'agy-od-footer';
    const exportRow = document.createElement('div');
    exportRow.className = 'agy-od-export-row';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'agy-od-btn primary';
    copyBtn.id = 'agy-od-copy-md';
    copyBtn.textContent = starOnly
      ? text('📋 复制星标 Markdown', '📋 Copy Starred MD')
      : text('📋 复制全文 Markdown', '📋 Copy Full MD');
    copyBtn.onclick = () => copyMarkdown({ onlyStarred: starOnly });

    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.className = 'agy-od-btn';
    dlBtn.id = 'agy-od-download-md';
    dlBtn.textContent = text('💾 .md', '💾 .md');
    dlBtn.title = text('导出为纯净 Markdown 文件', 'Download clean Markdown');
    dlBtn.onclick = () => downloadMarkdown({ onlyStarred: starOnly });

    const htmlBtn = document.createElement('button');
    htmlBtn.type = 'button';
    htmlBtn.className = 'agy-od-btn';
    htmlBtn.id = 'agy-od-download-html';
    htmlBtn.textContent = text('📄 书卷 HTML', '📄 HTML');
    htmlBtn.title = text('导出为带目录与深浅色切换的 Claude 书卷排版单文件 HTML', 'Export self-contained dual-theme bookish HTML report');
    htmlBtn.onclick = () => downloadBookishHtml({ onlyStarred: starOnly });
    exportRow.append(copyBtn, dlBtn, htmlBtn);

    const status = document.createElement('div');
    status.className = 'agy-od-status';
    status.setAttribute('role', 'status');
    status.textContent = statusNotice;
    footer.append(exportRow, status);

    drawer.append(header, toolbar, list, footer);

    if (hadSearchFocus) {
      search.focus();
      if (typeof cursorStart === 'number') search.setSelectionRange(cursorStart, cursorStart);
    }
  }

  function detectPreviewableCode(lang, rawCode) {
    const clean = String(rawCode || '').trim();
    if (!clean) return { previewable: false, kind: '' };
    const l = String(lang || '').toLowerCase();
    if (l === 'svg' || /^(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(clean)) {
      return { previewable: true, kind: 'svg' };
    }
    if (l === 'html' || l === 'htm' || /^(?:<!doctype\s+html|<html[\s>])/i.test(clean)) {
      return { previewable: true, kind: 'html' };
    }
    return { previewable: false, kind: '' };
  }

  function buildPreviewSrcdoc(rawCode, kind, darkCanvas = false) {
    const clean = String(rawCode || '').trim();
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'unsafe-inline' 'unsafe-eval' data: blob: https:; connect-src 'none';">`;
    const bg = darkCanvas ? '#1A1918' : '#FAF9F5';
    const fg = darkCanvas ? '#ECE9E2' : '#141413';
    if (kind === 'svg') {
      return `<!doctype html><html><head><meta charset="utf-8">${csp}<style>html,body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:${bg};color:${fg};padding:16px;box-sizing:border-box}svg{max-width:100%;max-height:calc(100vh - 32px);height:auto}</style></head><body>${clean}</body></html>`;
    }
    if (/<head[\s>]/i.test(clean)) {
      return clean.replace(/<head([^>]*)>/i, `<head$1>${csp}`);
    }
    if (/^(?:<!doctype\s+html|<html[\s>])/i.test(clean)) {
      return csp + clean;
    }
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${csp}<style>body{margin:16px;background:${bg};color:${fg};font-family:system-ui,-apple-system,sans-serif}</style></head><body>${clean}</body></html>`;
  }

  function downloadBlobText(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadTableCsv(table, idx = 1) {
    const csv = tableToDelimited(table, ',');
    if (!csv) return '';
    const date = new Date().toISOString().slice(0, 10);
    downloadBlobText('\uFEFF' + csv, `table-${idx}-${date}.csv`, 'text/csv;charset=utf-8');
    return csv;
  }

  function computeLineDiff(oldText, newText) {
    const a = String(oldText ?? '').replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
    const b = String(newText ?? '').replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length - 1;
    let endB = b.length - 1;
    while (endA >= start && endB >= start && a[endA] === b[endB]) { endA--; endB--; }

    const ops = [];
    for (let i = 0; i < start; i++) ops.push({ type: 'eq', line: a[i] });

    const midA = a.slice(start, endA + 1);
    const midB = b.slice(start, endB + 1);
    if (midA.length * midB.length <= 360000) {
      const m = midA.length, n = midB.length;
      const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
      for (let i = m - 1; i >= 0; i--) {
        for (let j = n - 1; j >= 0; j--) {
          dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
      let i = 0, j = 0;
      while (i < m && j < n) {
        if (midA[i] === midB[j]) { ops.push({ type: 'eq', line: midA[i++] }); j++; }
        else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ type: 'del', line: midA[i++] });
        else ops.push({ type: 'add', line: midB[j++] });
      }
      while (i < m) ops.push({ type: 'del', line: midA[i++] });
      while (j < n) ops.push({ type: 'add', line: midB[j++] });
    } else {
      for (const l of midA) ops.push({ type: 'del', line: l });
      for (const l of midB) ops.push({ type: 'add', line: l });
    }

    for (let i = endA + 1; i < a.length; i++) ops.push({ type: 'eq', line: a[i] });

    let oldNo = 1, newNo = 1, added = 0, removed = 0;
    for (const op of ops) {
      if (op.type === 'eq') { op.oldNo = oldNo++; op.newNo = newNo++; }
      else if (op.type === 'del') { op.oldNo = oldNo++; op.newNo = null; removed++; }
      else { op.oldNo = null; op.newNo = newNo++; added++; }
    }
    const patchLines = ['--- a/previous', '+++ b/current'];
    for (const op of ops) {
      patchLines.push((op.type === 'add' ? '+' : op.type === 'del' ? '-' : ' ') + op.line);
    }
    return { added, removed, ops, unifiedPatch: patchLines.join('\n') };
  }

  function cleanupCodeFolds() {
    document.querySelectorAll('.agy-code-fold-btn, .agy-code-preview-btn, .agy-code-diff-btn, .agy-code-header-actions, .agy-live-preview-panel, .agy-code-diff-panel, caption.agy-table-tools').forEach(el => el.remove());
    document.querySelectorAll('[data-agy-code-folded]').forEach(el => el.removeAttribute('data-agy-code-folded'));
  }

  function mountCodeDiffPanel(card, getRawCode, candidates, defaultBaseIdx) {
    let panel = card.querySelector(':scope > .agy-code-diff-panel');
    if (panel) return panel;
    let selectedBase = defaultBaseIdx;

    panel = document.createElement('div');
    panel.className = 'agy-code-diff-panel';
    panel.setAttribute('data-ag-localization-skip', 'true');

    const head = document.createElement('div');
    head.className = 'agy-code-diff-head';
    const leftWrap = document.createElement('div');
    leftWrap.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap';
    const badge = document.createElement('span');
    badge.className = 'agy-live-preview-badge';
    const select = document.createElement('select');
    select.className = 'agy-code-diff-select';
    candidates.forEach((cand, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = text(`对比代码 #${cand.seq}${cand.lang ? ` (${cand.lang})` : ''} · ${cand.lines} 行`, `vs Code #${cand.seq}${cand.lang ? ` (${cand.lang})` : ''} · ${cand.lines} lines`);
      if (idx === selectedBase) opt.selected = true;
      select.appendChild(opt);
    });
    leftWrap.append(badge, select);

    const copyPatchBtn = document.createElement('button');
    copyPatchBtn.type = 'button';
    copyPatchBtn.className = 'agy-code-fold-btn';
    copyPatchBtn.textContent = text('📋 复制 .diff', '📋 Copy .diff');
    head.append(leftWrap, copyPatchBtn);

    const body = document.createElement('div');
    body.className = 'agy-code-diff-body';
    panel.append(head, body);
    card.appendChild(panel);

    const renderDiffRows = () => {
      const base = candidates[selectedBase] || candidates[0];
      const diff = computeLineDiff(base?.rawCode || '', getRawCode());
      badge.textContent = `⇄ +${diff.added} / -${diff.removed}`;
      copyPatchBtn.onclick = async e => {
        e.stopPropagation();
        await writeClipboard(diff.unifiedPatch);
        copyPatchBtn.textContent = text('✓ 已复制 Patch', '✓ Copied Patch');
        setTimeout(() => { copyPatchBtn.textContent = text('📋 复制 .diff', '📋 Copy .diff'); }, 1400);
      };

      body.replaceChildren();
      const keep = new Uint8Array(diff.ops.length);
      diff.ops.forEach((op, i) => {
        if (op.type !== 'eq') {
          for (let k = Math.max(0, i - 3); k <= Math.min(diff.ops.length - 1, i + 3); k++) keep[k] = 1;
        }
      });
      if (diff.added === 0 && diff.removed === 0) {
        const same = document.createElement('div');
        same.className = 'agy-diff-skip';
        same.textContent = text('两处代码块内容完全一致', 'Both code blocks are identical');
        body.appendChild(same);
        return;
      }
      let skipped = 0;
      const flushSkip = () => {
        if (!skipped) return;
        const sk = document.createElement('div');
        sk.className = 'agy-diff-skip';
        sk.textContent = text(`⋯ 折叠未改动代码 ${skipped} 行 ⋯`, `⋯ ${skipped} unchanged lines hidden ⋯`);
        body.appendChild(sk);
        skipped = 0;
      };
      diff.ops.forEach((op, idx) => {
        if (!keep[idx]) { skipped++; return; }
        flushSkip();
        const row = document.createElement('div');
        row.className = 'agy-diff-row';
        row.dataset.diff = op.type;
        const n1 = document.createElement('span');
        n1.className = 'agy-diff-no';
        n1.textContent = op.oldNo ?? '';
        const n2 = document.createElement('span');
        n2.className = 'agy-diff-no';
        n2.textContent = op.newNo ?? '';
        const sig = document.createElement('span');
        sig.className = 'agy-diff-sig';
        sig.textContent = op.type === 'add' ? '+' : op.type === 'del' ? '-' : ' ';
        const code = document.createElement('span');
        code.textContent = op.line;
        row.append(n1, n2, sig, code);
        body.appendChild(row);
      });
      flushSkip();
    };

    select.onchange = e => {
      e.stopPropagation();
      selectedBase = Number(select.value) || 0;
      renderDiffRows();
    };
    renderDiffRows();
    return panel;
  }

  function mountLivePreviewPanel(card, getRawCode, kind) {
    let panel = card.querySelector(':scope > .agy-live-preview-panel');
    if (panel) return panel;
    let darkCanvas = document.body.classList.contains('theme-dark') || document.documentElement.classList.contains('dark');
    let viewport = 'desktop';

    panel = document.createElement('div');
    panel.className = 'agy-live-preview-panel';
    panel.setAttribute('data-ag-localization-skip', 'true');

    const toolbar = document.createElement('div');
    toolbar.className = 'agy-live-preview-toolbar';
    const badge = document.createElement('span');
    badge.className = 'agy-live-preview-badge';
    badge.textContent = kind === 'svg'
      ? text('🎨 SVG 隔离沙盒实时预览', '🎨 Sandboxed SVG Preview')
      : text('🌐 HTML 隔离沙盒实时预览', '🌐 Sandboxed HTML Preview');

    const btns = document.createElement('div');
    btns.className = 'agy-live-preview-btns';

    const vpBtn = document.createElement('button');
    vpBtn.type = 'button';
    vpBtn.dataset.previewAct = 'viewport';
    const bgBtn = document.createElement('button');
    bgBtn.type = 'button';
    bgBtn.dataset.previewAct = 'canvas';
    const reloadBtn = document.createElement('button');
    reloadBtn.type = 'button';
    reloadBtn.dataset.previewAct = 'reload';
    reloadBtn.textContent = text('↻ 刷新', '↻ Reload');
    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.dataset.previewAct = 'download';
    dlBtn.textContent = kind === 'svg' ? '💾 .svg' : '💾 .html';

    const stage = document.createElement('div');
    stage.className = 'agy-live-preview-stage';
    const frame = document.createElement('iframe');
    frame.className = 'agy-live-preview-frame';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.title = kind === 'svg' ? 'SVG Live Preview' : 'HTML Live Preview';

    const syncFrame = () => {
      const raw = getRawCode();
      frame.dataset.viewport = viewport;
      frame.style.background = darkCanvas ? '#1A1918' : '#FAF9F5';
      frame.srcdoc = buildPreviewSrcdoc(raw, kind, darkCanvas);
      vpBtn.textContent = viewport === 'desktop' ? text('🖥️ 100%', '🖥️ 100%') : text('📱 390px', '📱 390px');
      vpBtn.dataset.active = String(viewport === 'mobile');
      bgBtn.textContent = darkCanvas ? text('🌙 深底', '🌙 Dark') : text('☀️ 浅底', '☀️ Light');
    };

    vpBtn.onclick = e => { e.stopPropagation(); viewport = viewport === 'desktop' ? 'mobile' : 'desktop'; syncFrame(); };
    bgBtn.onclick = e => { e.stopPropagation(); darkCanvas = !darkCanvas; syncFrame(); };
    reloadBtn.onclick = e => { e.stopPropagation(); syncFrame(); };
    dlBtn.onclick = e => {
      e.stopPropagation();
      const raw = getRawCode();
      const ext = kind === 'svg' ? 'svg' : 'html';
      const mime = kind === 'svg' ? 'image/svg+xml;charset=utf-8' : 'text/html;charset=utf-8';
      downloadBlobText(raw, `snippet-${Date.now().toString(36)}.${ext}`, mime);
    };

    btns.append(vpBtn, bgBtn, reloadBtn, dlBtn);
    toolbar.append(badge, btns);
    stage.appendChild(frame);
    panel.append(toolbar, stage);
    card.appendChild(panel);
    syncFrame();
    return panel;
  }

  function enhanceLongCodeBlocks() {
    const root = primaryRoot();
    if (!root) return;
    const historyBlocks = [];
    let codeSeq = 0;

    for (const card of root.querySelectorAll('[data-testid="planner-response-text"] .rounded-xl.bg-muted.border')) {
      if (isExcluded(card)) continue;
      const info = resolveCodeCard(card);
      if (!info || !info.header || !info.bodyEl) continue;
      const { header, lang, rawCode } = info;
      const getRawCode = () => resolveCodeCard(card)?.rawCode || '';
      const lines = rawCode ? rawCode.split('\n').length : 0;
      const previewMeta = detectPreviewableCode(lang, rawCode);
      codeSeq++;

      let diffTargetIdx = -1;
      let diffSummary = null;
      const candidates = historyBlocks.slice();
      if (lines >= 2 && candidates.length > 0) {
        const curLineSet = new Set(rawCode.split('\n').map(l => l.trim()).filter(l => l.length >= 6));
        for (let i = candidates.length - 1; i >= 0; i--) {
          const prev = candidates[i];
          if (prev.lines < 2 || prev.rawCode.trim() === rawCode.trim()) continue;
          const sameLang = Boolean(lang && prev.lang && lang === prev.lang);
          const hasSharedLine = [...curLineSet].some(l => prev.lineSet.has(l));
          if (sameLang || hasSharedLine) {
            diffTargetIdx = i;
            diffSummary = computeLineDiff(prev.rawCode, rawCode);
            break;
          }
        }
      }
      if (lines >= 2) {
        historyBlocks.push({
          seq: codeSeq,
          lang,
          rawCode,
          lines,
          lineSet: new Set(rawCode.split('\n').map(l => l.trim()).filter(l => l.length >= 6))
        });
      }

      let actionsWrap = header.querySelector(':scope > .agy-code-header-actions');
      if (!previewMeta.previewable && lines < 18 && diffTargetIdx < 0) {
        actionsWrap?.remove();
        card.querySelector(':scope > .agy-live-preview-panel')?.remove();
        card.querySelector(':scope > .agy-code-diff-panel')?.remove();
        card.removeAttribute('data-agy-code-folded');
        continue;
      }

      if (getComputedStyle(header).display !== 'flex') {
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.gap = '8px';
      }
      if (!actionsWrap) {
        actionsWrap = document.createElement('span');
        actionsWrap.className = 'agy-code-header-actions';
        actionsWrap.setAttribute('data-ag-localization-skip', 'true');
        header.appendChild(actionsWrap);
      }

      // 1) Inline Sandboxed HTML/SVG Live Preview button
      let previewBtn = actionsWrap.querySelector('.agy-code-preview-btn');
      if (!previewMeta.previewable) {
        previewBtn?.remove();
        card.querySelector(':scope > .agy-live-preview-panel')?.remove();
      } else {
        if (!previewBtn) {
          previewBtn = document.createElement('button');
          previewBtn.type = 'button';
          previewBtn.className = 'agy-code-preview-btn';
          previewBtn.setAttribute('data-ag-localization-skip', 'true');
          actionsWrap.insertBefore(previewBtn, actionsWrap.firstChild);
        }
        const updatePreviewBtn = () => {
          const isOpen = Boolean(card.querySelector(':scope > .agy-live-preview-panel'));
          previewBtn.dataset.open = String(isOpen);
          const lbl = isOpen
            ? text('✕ 收起预览', '✕ Close Preview')
            : text(`▶ 预览 ${previewMeta.kind.toUpperCase()}`, `▶ Preview ${previewMeta.kind.toUpperCase()}`);
          if (previewBtn.textContent !== lbl) previewBtn.textContent = lbl;
        };
        previewBtn.onclick = e => {
          e.stopPropagation();
          const existing = card.querySelector(':scope > .agy-live-preview-panel');
          if (existing) existing.remove();
          else mountLivePreviewPanel(card, getRawCode, previewMeta.kind);
          updatePreviewBtn();
        };
        updatePreviewBtn();
      }

      // 2) Turn-to-Turn Code Diff button
      let diffBtn = actionsWrap.querySelector('.agy-code-diff-btn');
      if (diffTargetIdx < 0 || !diffSummary) {
        diffBtn?.remove();
        card.querySelector(':scope > .agy-code-diff-panel')?.remove();
      } else {
        if (!diffBtn) {
          diffBtn = document.createElement('button');
          diffBtn.type = 'button';
          diffBtn.className = 'agy-code-diff-btn';
          diffBtn.setAttribute('data-ag-localization-skip', 'true');
          actionsWrap.appendChild(diffBtn);
        }
        const updateDiffBtn = () => {
          const isOpen = Boolean(card.querySelector(':scope > .agy-code-diff-panel'));
          diffBtn.dataset.open = String(isOpen);
          const lbl = isOpen
            ? text('✕ 收起对比', '✕ Close Diff')
            : text(`⇄ 对比 (+${diffSummary.added}/-${diffSummary.removed})`, `⇄ Diff (+${diffSummary.added}/-${diffSummary.removed})`);
          if (diffBtn.textContent !== lbl) diffBtn.textContent = lbl;
        };
        diffBtn.onclick = e => {
          e.stopPropagation();
          const existing = card.querySelector(':scope > .agy-code-diff-panel');
          if (existing) existing.remove();
          else mountCodeDiffPanel(card, getRawCode, candidates, diffTargetIdx);
          updateDiffBtn();
        };
        updateDiffBtn();
      }

      // 3) Long Code Block Fold button (18+ lines)
      let foldBtn = actionsWrap.querySelector('.agy-code-fold-btn');
      if (lines < 18) {
        foldBtn?.remove();
        card.removeAttribute('data-agy-code-folded');
      } else {
        if (!foldBtn) {
          foldBtn = document.createElement('button');
          foldBtn.type = 'button';
          foldBtn.className = 'agy-code-fold-btn';
          foldBtn.setAttribute('data-ag-localization-skip', 'true');
          actionsWrap.appendChild(foldBtn);
        }
        const updateFoldLabel = () => {
          const folded = card.getAttribute('data-agy-code-folded') === 'true';
          const label = folded
            ? text(`${lines} 行 · 展开 ▾`, `${lines} lines · Expand ▾`)
            : text(`${lines} 行 · 收起 ▴`, `${lines} lines · Fold ▴`);
          if (foldBtn.textContent !== label) foldBtn.textContent = label;
        };
        foldBtn.onclick = e => {
          e.stopPropagation();
          const next = card.getAttribute('data-agy-code-folded') !== 'true';
          card.setAttribute('data-agy-code-folded', String(next));
          updateFoldLabel();
        };
        updateFoldLabel();
      }
    }

    // 3) Excel-ready Markdown Table TSV Copy & UTF-8 BOM CSV Export
    let tableIndex = 0;
    for (const table of root.querySelectorAll('[data-testid="planner-response-text"] table')) {
      if (isExcluded(table)) continue;
      const rows = table.querySelectorAll('tr');
      let cap = table.querySelector(':scope > caption.agy-table-tools');
      if (!rows.length) {
        cap?.remove();
        continue;
      }
      tableIndex++;
      const currentIndex = tableIndex;
      if (!cap) {
        cap = document.createElement('caption');
        cap.className = 'agy-table-tools';
        cap.setAttribute('data-ag-localization-skip', 'true');
        table.insertBefore(cap, table.firstChild);
      }
      let bar = cap.querySelector('.agy-table-tools-bar');
      if (!bar) {
        bar = document.createElement('span');
        bar.className = 'agy-table-tools-bar';
        const tsvBtn = document.createElement('button');
        tsvBtn.type = 'button';
        tsvBtn.dataset.tableAct = 'tsv';
        const csvBtn = document.createElement('button');
        csvBtn.type = 'button';
        csvBtn.dataset.tableAct = 'csv';
        tsvBtn.onclick = async e => {
          e.stopPropagation();
          const tsv = tableToDelimited(table, '\t');
          await writeClipboard(tsv);
          tsvBtn.textContent = text('✓ 已复制 TSV', '✓ Copied TSV');
          setTimeout(() => { tsvBtn.textContent = text('📊 复制表格 (Excel)', '📊 Copy TSV'); }, 1400);
        };
        csvBtn.onclick = e => {
          e.stopPropagation();
          downloadTableCsv(table, currentIndex);
          csvBtn.textContent = text('✓ 已导出 .csv', '✓ Saved .csv');
          setTimeout(() => { csvBtn.textContent = text('💾 导出 .csv', '💾 .csv'); }, 1400);
        };
        bar.append(tsvBtn, csvBtn);
        cap.appendChild(bar);
      }
      const [tsvBtn, csvBtn] = bar.querySelectorAll('button');
      const wantTsv = text('📊 复制表格 (Excel)', '📊 Copy TSV');
      const wantCsv = text('💾 导出 .csv', '💾 .csv');
      if (tsvBtn && !tsvBtn.textContent.startsWith('✓') && tsvBtn.textContent !== wantTsv) tsvBtn.textContent = wantTsv;
      if (csvBtn && !csvBtn.textContent.startsWith('✓') && csvBtn.textContent !== wantCsv) csvBtn.textContent = wantCsv;
    }
  }

  function syncMainEdgeOffset(pill, drawer) {
    const mainEl = document.querySelector('[data-main-content-body]');
    let extraRight = 0;
    if (mainEl) {
      const r = mainEl.getBoundingClientRect();
      if (r.width > 180 && window.innerWidth - r.right > 80) {
        extraRight = Math.max(0, Math.round(window.innerWidth - r.right));
      }
    }
    if (pill) pill.style.right = extraRight ? `${extraRight + 12}px` : '';
    if (drawer) drawer.style.right = extraRight ? `${extraRight + 16}px` : '';
  }

  function render() {
    if (disposed) return;
    const enabled = window.__agySuiteSettings?.outline !== false;
    if (!enabled) cleanupCodeFolds();
    else enhanceLongCodeBlocks();
    const turns = enabled ? getTurns() : [];
    let pill = document.getElementById('agy-outline-pill');

    if (!enabled || !turns.length) {
      pill?.remove();
      document.getElementById('agy-outline-drawer')?.remove();
      return;
    }

    const stars = loadStars();
    const hasStarred = turns.some(t => stars.has(t.id));

    if (!pill) {
      pill = document.createElement('button');
      pill.id = 'agy-outline-pill';
      pill.type = 'button';
      pill.setAttribute('data-ag-localization-skip', 'true');
      pill.onclick = () => toggle();
      document.body.appendChild(pill);
    }
    pill.setAttribute('aria-expanded', String(openState));
    pill.title = text(`对话目录与导出 (${turns.length} 轮) · Alt+O`, `Conversation Outline & Export (${turns.length} turns) · Alt+O`);
    pill.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>' +
      `<span class="agy-op-count">${turns.length}</span>` +
      (hasStarred ? '<span class="agy-op-star-dot" aria-hidden="true"></span>' : '');

    if (openState) renderDrawer(turns, stars);
    else document.getElementById('agy-outline-drawer')?.remove();
    syncMainEdgeOffset(pill, document.getElementById('agy-outline-drawer'));
  }

  function open() {
    if (disposed || window.__agySuiteSettings?.outline === false) return false;
    if (!getTurns().length) return false;
    openState = true;
    render();
    document.querySelector('#agy-outline-drawer .agy-od-search')?.focus();
    return true;
  }

  function close() {
    openState = false;
    render();
  }

  function toggle() {
    if (openState) close();
    else open();
  }

  function scheduleRender() {
    if (disposed || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      render();
    });
  }

  function onKeyDown(e) {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'o') {
      if (window.__agySuiteSettings?.outline === false) return;
      if (getTurns().length > 0) {
        e.preventDefault();
        toggle();
      }
    } else if (e.key === 'Escape' && openState) {
      e.preventDefault();
      close();
    }
  }

  function onPointerDown(e) {
    if (!openState) return;
    const drawer = document.getElementById('agy-outline-drawer');
    const pill = document.getElementById('agy-outline-pill');
    if (drawer && !drawer.contains(e.target) && (!pill || !pill.contains(e.target))) {
      close();
    }
  }

  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.target?.closest?.('#agy-outline-drawer, #agy-outline-pill, #agy-selection-pill, .agy-code-fold-btn, .agy-code-preview-btn, .agy-code-diff-btn, .agy-code-header-actions, .agy-live-preview-panel, .agy-code-diff-panel, .agy-table-tools')) continue;
      scheduleRender();
      break;
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('agy-suite-settings-updated', scheduleRender);
  window.addEventListener('resize', scheduleRender);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('pointerdown', onPointerDown);
  scheduleRender();

  let selTimer = null;
  function quoteSelectionIntoComposer(rawText, sourceHost = null) {
    const clean = String(rawText || '').trim();
    if (!clean) return false;
    const quoted = clean.split('\n').map(l => `> ${l}`).join('\n') + '\n\n';
    const scopedComposer = sourceHost?.closest?.('[data-side-panel-body], [data-main-content-body]')?.querySelector?.('[data-testid="agent-input-box"]') || null;
    if (window.__agyPromptVault?.insertIntoComposer) {
      return window.__agyPromptVault.insertIntoComposer(quoted, { append: true, composerBox: scopedComposer });
    }
    const editor = (scopedComposer || document).querySelector('[data-testid="agent-input-box"] [data-lexical-editor="true"], [data-lexical-editor="true"]');
    if (!editor) return false;
    const prev = (editor.textContent || '').trim();
    editor.textContent = prev ? `${prev}\n\n${quoted}` : quoted;
    editor.focus();
    return true;
  }

  function removeSelectionPill() {
    document.getElementById('agy-selection-pill')?.remove();
  }

  function updateSelectionPill() {
    if (disposed || window.__agySuiteSettings?.outline === false) {
      removeSelectionPill();
      return;
    }
    const sel = window.getSelection?.();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      removeSelectionPill();
      return;
    }
    const selectedText = sel.toString().trim();
    if (selectedText.length < 6 || selectedText.length > 2400) {
      removeSelectionPill();
      return;
    }
    const range = sel.getRangeAt(0);
    const host = (range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement);
    if (!host || host.closest?.('input, textarea, [contenteditable="true"], #agy-outline-drawer, #agy-prompt-vault-backdrop, #agy-pinboard-backdrop, #agy-suite-backdrop, #agy-command-palette-backdrop')) {
      removeSelectionPill();
      return;
    }
    if (!host.closest?.('[data-testid="planner-response-text"], [data-testid="user-input-step"], [data-testid="user-message-bubble"]')) {
      removeSelectionPill();
      return;
    }
    const rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      removeSelectionPill();
      return;
    }

    let pill = document.getElementById('agy-selection-pill');
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'agy-selection-pill';
      pill.setAttribute('data-ag-localization-skip', 'true');
      pill.onmousedown = e => e.preventDefault();
      document.body.appendChild(pill);
    }
    pill.replaceChildren();

    const quoteBtn = document.createElement('button');
    quoteBtn.type = 'button';
    quoteBtn.dataset.selAction = 'quote';
    quoteBtn.textContent = text('❝ 引用追问', '❝ Quote & Ask');
    quoteBtn.onclick = () => {
      const captured = sel.toString().trim();
      sel.removeAllRanges();
      removeSelectionPill();
      quoteSelectionIntoComposer(captured, host);
    };

    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.dataset.selAction = 'pin';
    pinBtn.textContent = text('📌 暂存', '📌 Pin');
    pinBtn.onclick = () => {
      const captured = sel.toString().trim();
      sel.removeAllRanges();
      removeSelectionPill();
      window.__agyPinboard?.addPin?.({ content: captured });
    };

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.dataset.selAction = 'vault';
    saveBtn.textContent = text('✦ 存为模板', '✦ Save Template');
    saveBtn.onclick = () => {
      const captured = sel.toString().trim();
      sel.removeAllRanges();
      removeSelectionPill();
      window.__agyPromptVault?.openWithDraft?.({
        title: captured.replace(/\s+/g, ' ').slice(0, 32),
        content: captured
      });
    };

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.dataset.selAction = 'copy';
    copyBtn.textContent = text('📋 复制', '📋 Copy');
    copyBtn.onclick = async () => {
      await writeClipboard(sel.toString().trim());
      copyBtn.textContent = '✓';
      setTimeout(removeSelectionPill, 450);
    };

    pill.append(quoteBtn, pinBtn, saveBtn, copyBtn);
    const pillWidth = pill.offsetWidth || 220;
    const left = Math.max(8, Math.min(rect.left + rect.width / 2 - pillWidth / 2, innerWidth - pillWidth - 8));
    const top = rect.top > 48 ? rect.top - 40 : Math.min(innerHeight - 44, rect.bottom + 8);
    pill.style.left = `${Math.round(left)}px`;
    pill.style.top = `${Math.round(top)}px`;
  }

  function onSelectionChange() {
    clearTimeout(selTimer);
    selTimer = setTimeout(updateSelectionPill, 110);
  }

  document.addEventListener('selectionchange', onSelectionChange);
  window.addEventListener('scroll', removeSelectionPill, true);

  window.__agyConvTools = {
    open,
    close,
    toggle,
    isOpen: () => openState,
    getTurns,
    exportMarkdown,
    exportBookishHtml,
    downloadBookishHtml,
    tableToDelimited,
    buildPreviewSrcdoc,
    computeLineDiff,
    resolveCodeCard,
    copyMarkdown,
    quoteSelectionIntoComposer,
    updateSelectionPill,
    toggleStar,
    isStarred,
    refresh: render
  };

  window.__agyConvToolsCleanup = () => {
    disposed = true;
    observer.disconnect();
    clearTimeout(statusTimer);
    clearTimeout(highlightTimer);
    clearTimeout(selTimer);
    document.removeEventListener('selectionchange', onSelectionChange);
    window.removeEventListener('scroll', removeSelectionPill, true);
    window.removeEventListener('agy-suite-settings-updated', scheduleRender);
    window.removeEventListener('resize', scheduleRender);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('pointerdown', onPointerDown);
    document.getElementById('agy-outline-pill')?.remove();
    document.getElementById('agy-outline-drawer')?.remove();
    removeSelectionPill();
    cleanupCodeFolds();
    document.querySelectorAll('[data-agy-jump-highlight]').forEach(n => n.removeAttribute('data-agy-jump-highlight'));
    style.remove();
    delete window.__agyConvTools;
  };
})();
