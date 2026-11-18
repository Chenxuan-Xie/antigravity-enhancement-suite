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
    .agy-code-fold-btn {
      margin-left: auto; padding: 1px 7px; border-radius: 6px;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.22));
      background: transparent; color: inherit; cursor: pointer;
      font: 500 11px/1.4 system-ui, sans-serif; font-variant-numeric: tabular-nums;
      opacity: 0.78; transition: all 0.14s ease;
    }
    .agy-code-fold-btn:hover { opacity: 1; border-color: #D97757; color: #D97757; }
    .rounded-xl.bg-muted.border[data-agy-code-folded="true"] pre {
      max-height: 156px !important;
      overflow: hidden !important;
      mask-image: linear-gradient(to bottom, #000 58%, transparent 100%);
      -webkit-mask-image: linear-gradient(to bottom, #000 58%, transparent 100%);
    }
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

  function extractCodeBlock(preOrCard) {
    let lang = '';
    const card = preOrCard.closest?.('.rounded-xl.bg-muted.border') || (preOrCard.matches?.('.rounded-xl.bg-muted.border') ? preOrCard : null);
    if (card) {
      const header = card.querySelector(':scope > .border-b');
      if (header) {
        const headerText = [...header.childNodes]
          .filter(n => !(n.nodeType === 1 && n.matches?.('button, .agy-code-fold-btn')))
          .map(n => n.textContent || '')
          .join(' ');
        const token = headerText.trim().split(/\s+/)[0] || '';
        if (/^[a-zA-Z0-9_+#.-]{1,24}$/.test(token) && !/^(copy|复制)$/i.test(token)) lang = token.toLowerCase();
      }
    }
    const codeEl = preOrCard.querySelector?.('code, .code-block') || preOrCard;
    if (!lang) {
      const cls = codeEl.className || '';
      const m = typeof cls === 'string' && cls.match(/language-([a-zA-Z0-9_+-]+)/);
      if (m) lang = m[1];
    }
    const raw = (codeEl.textContent || '').replace(/\n+$/, '');
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

  function blockMarkdown(node, listDepth = 0) {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName.toUpperCase();
    if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'BUTTON' || tag === 'SVG') return '';
    if (node.matches?.('.rounded-xl.bg-muted.border') && node.querySelector('pre, .code-block')) {
      return extractCodeBlock(node);
    }
    if (tag === 'PRE') return extractCodeBlock(node);
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
        actions.append(reuseBtn, copyOne, starToggle);
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
    dlBtn.textContent = text('💾 导出 .md', '💾 Export .md');
    dlBtn.onclick = () => downloadMarkdown({ onlyStarred: starOnly });
    exportRow.append(copyBtn, dlBtn);

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

  function cleanupCodeFolds() {
    document.querySelectorAll('.agy-code-fold-btn').forEach(el => el.remove());
    document.querySelectorAll('[data-agy-code-folded]').forEach(el => el.removeAttribute('data-agy-code-folded'));
  }

  function enhanceLongCodeBlocks() {
    const root = primaryRoot();
    if (!root) return;
    for (const card of root.querySelectorAll('[data-testid="planner-response-text"] .rounded-xl.bg-muted.border')) {
      const header = card.querySelector(':scope > .border-b');
      const pre = card.querySelector('pre');
      if (!header || !pre) continue;
      const lines = (pre.textContent || '').replace(/\n+$/, '').split('\n').length;
      let btn = header.querySelector('.agy-code-fold-btn');
      if (lines < 18) {
        btn?.remove();
        card.removeAttribute('data-agy-code-folded');
        continue;
      }
      if (getComputedStyle(header).display !== 'flex') {
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.gap = '8px';
      }
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'agy-code-fold-btn';
        btn.setAttribute('data-ag-localization-skip', 'true');
        btn.onclick = e => {
          e.stopPropagation();
          const next = card.getAttribute('data-agy-code-folded') !== 'true';
          card.setAttribute('data-agy-code-folded', String(next));
          updateLabel();
        };
        header.appendChild(btn);
      }
      const updateLabel = () => {
        const folded = card.getAttribute('data-agy-code-folded') === 'true';
        const label = folded
          ? text(`${lines} 行 · 展开 ▾`, `${lines} lines · Expand ▾`)
          : text(`${lines} 行 · 收起 ▴`, `${lines} lines · Fold ▴`);
        if (btn.textContent !== label) btn.textContent = label;
      };
      updateLabel();
    }
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
      if (m.target?.closest?.('#agy-outline-drawer, #agy-outline-pill, .agy-code-fold-btn')) continue;
      scheduleRender();
      break;
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('agy-suite-settings-updated', scheduleRender);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('pointerdown', onPointerDown);
  scheduleRender();

  window.__agyConvTools = {
    open,
    close,
    toggle,
    isOpen: () => openState,
    getTurns,
    exportMarkdown,
    copyMarkdown,
    toggleStar,
    isStarred,
    refresh: render
  };

  window.__agyConvToolsCleanup = () => {
    disposed = true;
    observer.disconnect();
    clearTimeout(statusTimer);
    clearTimeout(highlightTimer);
    window.removeEventListener('agy-suite-settings-updated', scheduleRender);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('pointerdown', onPointerDown);
    document.getElementById('agy-outline-pill')?.remove();
    document.getElementById('agy-outline-drawer')?.remove();
    cleanupCodeFolds();
    document.querySelectorAll('[data-agy-jump-highlight]').forEach(n => n.removeAttribute('data-agy-jump-highlight'));
    style.remove();
    delete window.__agyConvTools;
  };
})();
