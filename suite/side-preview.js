(() => {
  window.__agySidePreviewCleanup?.();

  const API = 'http://127.0.0.1:19823';
  const STYLE_ID = 'agy-side-preview-style';
  const DOCK_ID = 'agy-side-preview-dock';
  const text = (cn, en) => (window.__agySuiteSettings?.i18n === false ? en : cn);

  let disposed = false;
  let scheduled = false;
  let lastClickedUri = '';
  let lastClickedAt = 0;
  const manualToggleUris = new Set();
  const dismissedAutoUris = new Set();

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .agy-sp-host {
      position: absolute;
      inset: 0;
      z-index: 30;
      display: flex;
      flex-direction: column;
      background: var(--agy-bg-primary, var(--background, #FAF9F5));
      color: var(--agy-text-primary, var(--foreground, #141413));
      font: 13px/1.55 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      overflow: hidden;
    }
    body.theme-dark .agy-sp-host, html.dark .agy-sp-host,
    body.theme-dark #${DOCK_ID}, html.dark #${DOCK_ID} {
      background: #1C1B19;
      color: #ECE9E2;
    }
    #${DOCK_ID} {
      position: fixed;
      top: 40px;
      right: 10px;
      bottom: 10px;
      width: min(560px, calc(100vw - 24px));
      z-index: 9995;
      display: flex;
      flex-direction: column;
      border-radius: 14px;
      border: 1px solid rgba(20, 20, 19, 0.14);
      background: var(--agy-bg-primary, var(--background, #FAF9F5));
      color: var(--agy-text-primary, var(--foreground, #141413));
      box-shadow: -8px 18px 54px rgba(0, 0, 0, 0.16);
      overflow: hidden;
      font: 13px/1.55 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    }
    body.theme-dark #${DOCK_ID}, html.dark #${DOCK_ID} {
      border-color: rgba(236, 233, 226, 0.15);
      box-shadow: -10px 22px 64px rgba(0, 0, 0, 0.58);
    }
    .agy-sp-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid rgba(20, 20, 19, 0.09);
      background: rgba(20, 20, 19, 0.025);
      flex-shrink: 0;
      flex-wrap: wrap;
    }
    body.theme-dark .agy-sp-toolbar, html.dark .agy-sp-toolbar {
      border-bottom-color: rgba(236, 233, 226, 0.10);
      background: rgba(255, 255, 255, 0.03);
    }
    .agy-sp-meta {
      display: flex;
      align-items: center;
      gap: 7px;
      min-width: 0;
      flex: 1;
    }
    .agy-sp-title {
      font-weight: 600;
      font-size: 12.5px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .agy-sp-badge {
      font-size: 10.5px;
      font-weight: 600;
      padding: 1px 7px;
      border-radius: 99px;
      background: rgba(217, 119, 87, 0.13);
      color: #C46344;
      white-space: nowrap;
      flex-shrink: 0;
    }
    body.theme-dark .agy-sp-badge, html.dark .agy-sp-badge {
      background: rgba(217, 119, 87, 0.22);
      color: #F09B7E;
    }
    .agy-sp-actions {
      display: flex;
      align-items: center;
      gap: 5px;
      flex-wrap: wrap;
    }
    .agy-sp-btn {
      padding: 4px 9px;
      border-radius: 7px;
      border: 1px solid rgba(20, 20, 19, 0.14);
      background: transparent;
      color: inherit;
      font: 500 11.5px system-ui;
      cursor: pointer;
      transition: all 0.14s ease;
      white-space: nowrap;
    }
    body.theme-dark .agy-sp-btn, html.dark .agy-sp-btn {
      border-color: rgba(236, 233, 226, 0.16);
    }
    .agy-sp-btn:hover {
      border-color: #D97757;
      color: #D97757;
      background: rgba(217, 119, 87, 0.08);
    }
    .agy-sp-btn.primary {
      background: #D97757;
      border-color: #D97757;
      color: #fff;
    }
    .agy-sp-btn.primary:hover {
      background: #C46344;
      color: #fff;
    }
    .agy-sp-filter {
      padding: 4px 8px;
      border-radius: 7px;
      border: 1px solid rgba(20, 20, 19, 0.15);
      background: rgba(255, 255, 255, 0.7);
      color: inherit;
      font: 11.5px system-ui;
      width: 135px;
      outline: none;
    }
    body.theme-dark .agy-sp-filter, html.dark .agy-sp-filter {
      background: rgba(0, 0, 0, 0.25);
      border-color: rgba(236, 233, 226, 0.18);
    }
    .agy-sp-filter:focus {
      border-color: #D97757;
    }
    .agy-sp-body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      position: relative;
    }
    .agy-sp-pdf-frame, .agy-sp-html-frame {
      width: 100%;
      height: 100%;
      border: 0;
      display: block;
      background: #fff;
    }
    .agy-sp-doc {
      max-width: 760px;
      margin: 0 auto;
      padding: 22px 26px 36px;
      font-family: var(--claude-font-serif, "ClaudeSerif", "Georgia", "Noto Serif SC", serif);
      line-height: 1.72;
      font-size: 14.5px;
    }
    .agy-sp-doc h1, .agy-sp-doc h2, .agy-sp-doc h3, .agy-sp-doc h4 {
      font-family: system-ui, -apple-system, "PingFang SC", sans-serif;
      margin: 1.15em 0 0.45em;
      line-height: 1.35;
    }
    .agy-sp-doc h1 { font-size: 20px; border-bottom: 1px solid rgba(128,128,128,0.18); padding-bottom: 6px; }
    .agy-sp-doc h2 { font-size: 17px; }
    .agy-sp-doc h3 { font-size: 15px; }
    .agy-sp-doc p { margin: 0 0 0.8em; white-space: pre-wrap; word-break: break-word; }
    .agy-sp-doc li { margin: 0.25em 0 0.25em 1.2em; }
    .agy-sp-sheet-tabs {
      display: flex;
      gap: 5px;
      padding: 7px 12px;
      border-bottom: 1px solid rgba(128, 128, 128, 0.15);
      overflow-x: auto;
      flex-shrink: 0;
    }
    .agy-sp-sheet-tab {
      padding: 3px 10px;
      border-radius: 99px;
      border: 1px solid rgba(128, 128, 128, 0.22);
      background: transparent;
      color: inherit;
      font: 500 11.5px system-ui;
      cursor: pointer;
      white-space: nowrap;
    }
    .agy-sp-sheet-tab.active {
      background: rgba(217, 119, 87, 0.14);
      border-color: #D97757;
      color: #D97757;
      font-weight: 600;
    }
    .agy-sp-table-wrap {
      overflow: auto;
      height: 100%;
    }
    .agy-sp-table {
      border-collapse: collapse;
      width: max-content;
      min-width: 100%;
      font: 12px/1.45 system-ui, sans-serif;
    }
    .agy-sp-table th, .agy-sp-table td {
      border: 1px solid rgba(128, 128, 128, 0.18);
      padding: 5px 9px;
      text-align: left;
      max-width: 340px;
      vertical-align: top;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .agy-sp-table thead th {
      position: sticky;
      top: 0;
      z-index: 2;
      background: var(--agy-bg-secondary, #F0EEE6);
      font-weight: 600;
    }
    body.theme-dark .agy-sp-table thead th, html.dark .agy-sp-table thead th {
      background: #282725;
    }
    .agy-sp-table tbody tr:nth-child(even) {
      background: rgba(128, 128, 128, 0.04);
    }
    .agy-sp-card-list {
      padding: 14px 16px 28px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .agy-sp-card {
      border: 1px solid rgba(128, 128, 128, 0.18);
      border-radius: 10px;
      padding: 12px 14px;
      background: rgba(255, 255, 255, 0.45);
    }
    body.theme-dark .agy-sp-card, html.dark .agy-sp-card {
      background: rgba(255, 255, 255, 0.03);
    }
    .agy-sp-card-head {
      font-weight: 600;
      font-size: 12.5px;
      margin-bottom: 6px;
      color: #D97757;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .agy-sp-pre {
      margin: 0;
      padding: 12px 14px;
      font: 12px/1.55 "JetBrains Mono", "Cascadia Code", Consolas, monospace;
      white-space: pre-wrap;
      word-break: break-all;
      overflow-x: auto;
    }
    .agy-sp-code-lines {
      padding: 10px 0;
      font: 12px/1.55 "JetBrains Mono", "Cascadia Code", Consolas, monospace;
    }
    .agy-sp-line {
      display: flex;
      padding: 0 12px;
    }
    .agy-sp-line.hl {
      background: rgba(217, 119, 87, 0.16);
    }
    .agy-sp-ln {
      width: 44px;
      flex-shrink: 0;
      opacity: 0.42;
      user-select: none;
      text-align: right;
      padding-right: 12px;
    }
    .agy-sp-lc {
      white-space: pre-wrap;
      word-break: break-all;
      flex: 1;
    }
    .agy-sp-svg-stage {
      min-height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background-image: linear-gradient(45deg, rgba(128,128,128,.08) 25%, transparent 25%),
        linear-gradient(-45deg, rgba(128,128,128,.08) 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, rgba(128,128,128,.08) 75%),
        linear-gradient(-45deg, transparent 75%, rgba(128,128,128,.08) 75%);
      background-size: 16px 16px;
      background-position: 0 0, 0 8px, 8px -8px, -8px 0;
    }
    .agy-sp-svg-stage img {
      max-width: 100%;
      max-height: calc(100vh - 140px);
      object-fit: contain;
    }
    .agy-sp-float-pill {
      position: absolute;
      right: 14px;
      bottom: 14px;
      z-index: 28;
      padding: 5px 12px;
      border-radius: 999px;
      border: 1px solid rgba(217, 119, 87, 0.42);
      background: var(--agy-bg-primary, #FAF9F5);
      color: #D97757;
      font: 600 11.5px system-ui;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.10);
    }
    body.theme-dark .agy-sp-float-pill, html.dark .agy-sp-float-pill {
      background: #262523;
      color: #F09B7E;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
    }
    .agy-sp-float-pill:hover {
      background: #D97757;
      color: #fff;
    }
    .agy-sp-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 24px;
      text-align: center;
      gap: 10px;
      opacity: 0.85;
    }
  `;
  (document.head || document.documentElement).appendChild(style);

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1048576).toFixed(2)} MB`;
  }

  function normalizeUriKey(uri) {
    let s = String(uri || '').trim();
    const hashIdx = s.indexOf('#');
    if (hashIdx !== -1) s = s.slice(0, hashIdx);
    const qIdx = s.indexOf('?');
    if (qIdx !== -1 && /^file:/i.test(s)) s = s.slice(0, qIdx);
    try {
      s = decodeURIComponent(s);
    } catch {}
    s = s.replace(/^file:\/\/(?:localhost)?\/?/i, '').replace(/\\/g, '/').toLowerCase();
    return s;
  }

  function uriFromFiberNode(el) {
    if (!el) return '';
    const attrUri = el.getAttribute?.('data-agy-file-uri');
    if (attrUri) return attrUri;
    const fk = Object.keys(el).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    let cur = fk ? el[fk] : null;
    let guard = 0;
    while (cur && guard < 40) {
      const p = cur.memoizedProps;
      if (p && typeof p === 'object') {
        if (typeof p.fileUri === 'string' && p.fileUri) return p.fileUri;
        if (p.ari?.sourceUri) {
          const u = typeof p.ari.sourceUri === 'string' ? p.ari.sourceUri : p.ari.sourceUri?.toString?.();
          if (u) return u;
        }
        const fv = p.tab?.content?.fileView?.fileUri;
        if (typeof fv === 'string' && fv) return fv;
        const av = p.tab?.content?.artifactView?.artifact?.sourceUri;
        if (av) {
          const u = typeof av === 'string' ? av : av?.toString?.();
          if (u) return u;
        }
      }
      cur = cur.return;
      guard++;
    }
    return '';
  }

  function extractSidePanelFileUri(panelBody) {
    if (!panelBody) return '';
    const directAttr = panelBody.getAttribute('data-agy-file-uri');
    if (directAttr) return directAttr;

    const candidates = [
      panelBody.querySelector('[data-agy-file-uri]'),
      panelBody.querySelector('[data-testid="binary-file-no-preview"]'),
      panelBody.querySelector('[data-testid="artifact-no-preview"]'),
      panelBody.querySelector('[data-testid="artifact-pdf-fallback"]'),
      panelBody.querySelector('[data-testid="artifact-pdf-view"]'),
      panelBody.querySelector('[data-side-panel-focus-scope="true"] > *'),
      panelBody.querySelector('[data-side-panel-focus-scope="true"]'),
    ].filter(Boolean);

    // Also walk a few deep leaf elements where FKc/UHc/wIc live
    const deep = panelBody.querySelectorAll('[data-side-panel-focus-scope="true"] div, [data-side-panel-focus-scope="true"] p');
    for (let i = 0; i < Math.min(deep.length, 14); i++) {
      candidates.push(deep[i]);
    }

    for (const node of candidates) {
      const found = uriFromFiberNode(node);
      if (found) return found;
    }

    try {
      const tabParam = new URLSearchParams(window.location.search || '').get('tab') || '';
      const m = tabParam.match(/^(?:artifact|file)__(.+)$/i);
      if (m && document.querySelectorAll('[data-side-panel-body]').length <= 1) {
        let decoded = m[1];
        for (let i = 0; i < 2 && /%[0-9A-Fa-f]{2}/.test(decoded); i++) {
          if (/^file:\/\//i.test(decoded)) break;
          decoded = decodeURIComponent(decoded);
        }
        if (/^file:\/\//i.test(decoded)) return decoded;
      }
    } catch {}

    if (detectFallbackNode(panelBody) && lastClickedUri && Date.now() - lastClickedAt < 3500) {
      return lastClickedUri;
    }
    return '';
  }

  function detectFallbackNode(panelBody) {
    if (!panelBody) return null;
    const byTestId = panelBody.querySelector(
      '[data-testid="binary-file-no-preview"], [data-testid="artifact-no-preview"], [data-testid="artifact-pdf-fallback"]'
    );
    if (byTestId) return byTestId;
    const paragraphs = panelBody.querySelectorAll('p, span');
    for (const p of paragraphs) {
      if (p.closest('.agy-sp-host')) continue;
      const t = (p.textContent || '').trim();
      if (
        t === 'Preview is not available for this file type.' ||
        t === '此文件类型暂不支持原生预览。' ||
        t === 'Inline PDF preview is not available in this environment.' ||
        t === '当前环境暂不支持原生内联 PDF 预览。' ||
        t === 'Failed to read file content' ||
        t === '读取文件内容失败' ||
        /^File exceeds the \d+MB display limit/i.test(t) ||
        /^文件超出原生 \d+MB 预览上限/.test(t)
      ) {
        return p;
      }
    }
    return null;
  }

  function isRichToggleCandidate(uri) {
    const clean = String(uri || '').split(/[?#]/)[0].toLowerCase();
    return /\.(svg|html|htm|csv|tsv|jsonl|ndjson|ipynb|md|markdown)$/.test(clean);
  }

  async function apiInspect(uri, zipEntry = '') {
    const qs = new URLSearchParams({ uri });
    if (zipEntry) qs.set('zipEntry', zipEntry);
    const res = await fetch(`${API}/api/suite/file-preview?${qs.toString()}`, {
      signal: AbortSignal.timeout(18000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || text('读取预览失败', 'Failed to load preview'));
    }
    return data;
  }

  async function apiSystemAction(uri, action) {
    const res = await fetch(`${API}/api/suite/file-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, uri }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || text('操作失败', 'Action failed'));
    }
    return data;
  }

  function renderSimpleMarkdown(md) {
    const lines = String(md || '').replace(/\r/g, '').split('\n');
    const html = [];
    let inFence = false;
    let fenceBuf = [];
    for (const line of lines) {
      if (line.trim().startsWith('```')) {
        if (!inFence) {
          inFence = true;
          fenceBuf = [];
        } else {
          inFence = false;
          html.push(`<div class="agy-sp-card"><pre class="agy-sp-pre">${escapeHtml(fenceBuf.join('\n'))}</pre></div>`);
        }
        continue;
      }
      if (inFence) {
        fenceBuf.push(line);
        continue;
      }
      const h = line.match(/^(#{1,4})\s+(.+)$/);
      if (h) {
        const lvl = h[1].length;
        html.push(`<h${lvl}>${escapeHtml(h[2])}</h${lvl}>`);
      } else if (/^\s*[-*+]\s+/.test(line)) {
        html.push(`<li>${escapeHtml(line.replace(/^\s*[-*+]\s+/, ''))}</li>`);
      } else if (line.trim()) {
        html.push(`<p>${escapeHtml(line)}</p>`);
      }
    }
    if (inFence && fenceBuf.length) {
      html.push(`<div class="agy-sp-card"><pre class="agy-sp-pre">${escapeHtml(fenceBuf.join('\n'))}</pre></div>`);
    }
    return `<div class="agy-sp-doc">${html.join('')}</div>`;
  }

  function renderTableView(container, rows, filterQuery = '') {
    if (!Array.isArray(rows) || rows.length === 0) {
      container.innerHTML = `<div class="agy-sp-empty">${escapeHtml(text('表格内容为空', 'Empty table'))}</div>`;
      return;
    }
    const q = filterQuery.trim().toLowerCase();
    const header = rows[0];
    const bodyRows = rows.slice(1).filter((r) => !q || r.some((cell) => String(cell).toLowerCase().includes(q)));
    const headHtml = `<tr><th>#</th>${header.map((h, idx) => `<th>${escapeHtml(h || `Col ${idx + 1}`)}</th>`).join('')}</tr>`;
    const bodyHtml = bodyRows
      .map(
        (r, rIdx) =>
          `<tr><td style="opacity:.5;user-select:none">${rIdx + 1}</td>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`
      )
      .join('');
    container.innerHTML = `<div class="agy-sp-table-wrap"><table class="agy-sp-table"><thead>${headHtml}</thead><tbody>${bodyHtml}</tbody></table></div>`;
  }

  async function mountPreviewIntoContainer(host, uri, options = {}) {
    host.dataset.uri = uri;
    host.innerHTML = `
      <div class="agy-sp-toolbar">
        <div class="agy-sp-meta">
          <span class="agy-sp-title">${escapeHtml(decodeURIComponent(String(uri).split(/[\\/]/).pop() || 'File'))}</span>
          <span class="agy-sp-badge">${escapeHtml(text('正在解析预览…', 'Loading preview…'))}</span>
        </div>
      </div>
      <div class="agy-sp-body"><div class="agy-sp-empty">${escapeHtml(text('正在加载文件内容…', 'Reading file…'))}</div></div>
    `;

    let data;
    try {
      data = await apiInspect(uri, options.zipEntry || '');
    } catch (err) {
      if (disposed || host.dataset.uri !== uri) return;
      host.innerHTML = `
        <div class="agy-sp-toolbar">
          <div class="agy-sp-meta">
            <span class="agy-sp-title">${escapeHtml(decodeURIComponent(String(uri).split(/[\\/]/).pop() || 'File'))}</span>
            <span class="agy-sp-badge">${escapeHtml(text('预览受限', 'Unavailable'))}</span>
          </div>
          <div class="agy-sp-actions">
            ${options.onClose ? `<button type="button" class="agy-sp-btn" data-sp-act="close">✕ ${escapeHtml(text('关闭', 'Close'))}</button>` : ''}
          </div>
        </div>
        <div class="agy-sp-body">
          <div class="agy-sp-empty">
            <div>${escapeHtml(err.message)}</div>
            <div style="display:flex;gap:8px;margin-top:6px;">
              <button type="button" class="agy-sp-btn" data-sp-act="reveal">📂 ${escapeHtml(text('定位文件', 'Reveal'))}</button>
              <button type="button" class="agy-sp-btn primary" data-sp-act="openExternal">↗ ${escapeHtml(text('系统默认打开', 'Open externally'))}</button>
            </div>
          </div>
        </div>
      `;
      host.querySelector('[data-sp-act="close"]')?.addEventListener('click', options.onClose);
      host.querySelector('[data-sp-act="reveal"]')?.addEventListener('click', () => apiSystemAction(uri, 'reveal').catch(() => {}));
      host.querySelector('[data-sp-act="openExternal"]')?.addEventListener('click', () => apiSystemAction(uri, 'openExternal').catch(() => {}));
      return;
    }

    if (disposed || host.dataset.uri !== uri) return;

    const badgeParts = [data.kind.toUpperCase()];
    if (data.encoding && data.encoding !== 'UTF-8') badgeParts.push(data.encoding);
    if (data.pageCount) badgeParts.push(`${data.pageCount} ${text('页', 'pages')}`);
    if (data.sheets) badgeParts.push(`${data.sheets.length} ${text('表', 'sheets')}`);
    if (data.slides) badgeParts.push(`${data.slides.length} ${text('页幻灯片', 'slides')}`);
    if (data.size) badgeParts.push(formatBytes(data.size));

    const supportsFilter = ['xlsx', 'table', 'jsonl', 'archive', 'docx', 'pptx'].includes(data.kind);

    host.innerHTML = `
      <div class="agy-sp-toolbar">
        <div class="agy-sp-meta">
          <span class="agy-sp-title" title="${escapeHtml(data.filePath)}">${escapeHtml(data.entryName || data.fileName)}</span>
          <span class="agy-sp-badge">${escapeHtml(badgeParts.join(' · '))}</span>
        </div>
        <div class="agy-sp-actions">
          ${data.kind === 'zip-entry' ? `<button type="button" class="agy-sp-btn" data-sp-act="backZip">← ${escapeHtml(text('返回目录', 'Archive'))}</button>` : ''}
          ${supportsFilter ? `<input type="search" class="agy-sp-filter" data-sp-role="filter" placeholder="${escapeHtml(text('筛选内容…', 'Filter…'))}" />` : ''}
          <button type="button" class="agy-sp-btn" data-sp-act="reveal" title="${escapeHtml(data.filePath)}">📂 ${escapeHtml(text('定位', 'Reveal'))}</button>
          <button type="button" class="agy-sp-btn" data-sp-act="openExternal">↗ ${escapeHtml(text('外部打开', 'Open'))}</button>
          ${options.onNativeView ? `<button type="button" class="agy-sp-btn" data-sp-act="nativeView">&lt;/&gt; ${escapeHtml(text('原生视图', 'Native'))}</button>` : ''}
          ${options.onClose ? `<button type="button" class="agy-sp-btn" data-sp-act="close">✕</button>` : ''}
        </div>
      </div>
      <div class="agy-sp-sheet-slot"></div>
      <div class="agy-sp-body" data-sp-role="body"></div>
    `;

    const bodyEl = host.querySelector('[data-sp-role="body"]');
    const sheetSlot = host.querySelector('.agy-sp-sheet-slot');
    const filterInput = host.querySelector('[data-sp-role="filter"]');

    host.querySelector('[data-sp-act="reveal"]')?.addEventListener('click', () => apiSystemAction(uri, 'reveal').catch(() => {}));
    host.querySelector('[data-sp-act="openExternal"]')?.addEventListener('click', () => apiSystemAction(uri, 'openExternal').catch(() => {}));
    host.querySelector('[data-sp-act="nativeView"]')?.addEventListener('click', options.onNativeView);
    host.querySelector('[data-sp-act="close"]')?.addEventListener('click', options.onClose);
    host.querySelector('[data-sp-act="backZip"]')?.addEventListener('click', () => mountPreviewIntoContainer(host, uri, { ...options, zipEntry: '' }));

    const rawUrl = `${API}/api/suite/file-preview?uri=${encodeURIComponent(uri)}&raw=1`;

    if (data.kind === 'pdf') {
      if (data.streamable) {
        const iframe = document.createElement('iframe');
        iframe.className = 'agy-sp-pdf-frame';
        iframe.title = data.fileName;
        iframe.src = `${rawUrl}#view=FitH`;
        bodyEl.appendChild(iframe);
      } else {
        bodyEl.innerHTML = `<div class="agy-sp-empty">${escapeHtml(text('PDF 超出内联流式上限，请点击右上角「外部打开」。', 'PDF exceeds inline limit; click Open to view externally.'))}</div>`;
      }
      return;
    }

    if (data.kind === 'media') {
      if (data.mediaType === 'image') {
        bodyEl.innerHTML = `<div class="agy-sp-svg-stage"><img src="${escapeHtml(rawUrl)}" alt="${escapeHtml(data.fileName)}" /></div>`;
      } else if (data.mediaType === 'audio') {
        bodyEl.innerHTML = `<div class="agy-sp-empty"><audio controls src="${escapeHtml(rawUrl)}" style="width:min(420px,90%)"></audio></div>`;
      } else {
        bodyEl.innerHTML = `<div class="agy-sp-empty" style="padding:12px"><video controls src="${escapeHtml(rawUrl)}" style="max-width:100%;max-height:100%;border-radius:8px"></video></div>`;
      }
      return;
    }

    if (data.kind === 'svg') {
      const svgDataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.content || '')}`;
      bodyEl.innerHTML = `<div class="agy-sp-svg-stage"><img src="${escapeHtml(svgDataUri)}" alt="${escapeHtml(data.fileName)}" /></div>`;
      return;
    }

    if (data.kind === 'html') {
      const iframe = document.createElement('iframe');
      iframe.className = 'agy-sp-html-frame';
      iframe.setAttribute('sandbox', 'allow-scripts');
      const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:;">`;
      iframe.srcdoc = csp + String(data.content || '');
      bodyEl.appendChild(iframe);
      return;
    }

    if (data.kind === 'docx') {
      const renderDocx = (q = '') => {
        const needle = q.trim().toLowerCase();
        const blocks = (data.blocks || []).filter((b) => {
          if (!needle) return true;
          if (b.type === 'table') return b.rows.some((r) => r.some((c) => c.toLowerCase().includes(needle)));
          return String(b.text || '').toLowerCase().includes(needle);
        });
        if (!blocks.length) {
          bodyEl.innerHTML = `<div class="agy-sp-empty">${escapeHtml(text('未找到匹配段落', 'No matching content'))}</div>`;
          return;
        }
        const html = blocks
          .map((b) => {
            if (b.type === 'heading') {
              const lvl = Math.min(4, Math.max(1, b.level || 2));
              return `<h${lvl}>${escapeHtml(b.text)}</h${lvl}>`;
            }
            if (b.type === 'list') return `<li>${escapeHtml(b.text)}</li>`;
            if (b.type === 'table') {
              const trs = b.rows
                .map((r, ri) => `<tr>${r.map((c) => `<${ri === 0 ? 'th' : 'td'}>${escapeHtml(c)}</${ri === 0 ? 'th' : 'td'}>`).join('')}</tr>`)
                .join('');
              return `<div style="overflow-x:auto;margin:12px 0"><table class="agy-sp-table">${trs}</table></div>`;
            }
            return `<p>${escapeHtml(b.text)}</p>`;
          })
          .join('');
        bodyEl.innerHTML = `<div class="agy-sp-doc">${html}</div>`;
      };
      renderDocx();
      filterInput?.addEventListener('input', () => renderDocx(filterInput.value));
      return;
    }

    if (data.kind === 'xlsx') {
      const sheets = data.sheets || [];
      let activeIdx = 0;
      const renderSheets = () => {
        if (sheets.length > 1) {
          sheetSlot.innerHTML = `<div class="agy-sp-sheet-tabs">${sheets
            .map(
              (s, idx) =>
                `<button type="button" class="agy-sp-sheet-tab ${idx === activeIdx ? 'active' : ''}" data-sheet-idx="${idx}">${escapeHtml(s.name)} (${s.totalRows})</button>`
            )
            .join('')}</div>`;
          sheetSlot.querySelectorAll('[data-sheet-idx]').forEach((btn) => {
            btn.addEventListener('click', () => {
              activeIdx = Number(btn.dataset.sheetIdx);
              renderSheets();
            });
          });
        } else {
          sheetSlot.innerHTML = '';
        }
        renderTableView(bodyEl, sheets[activeIdx]?.rows || [], filterInput?.value || '');
      };
      renderSheets();
      filterInput?.addEventListener('input', () => renderTableView(bodyEl, sheets[activeIdx]?.rows || [], filterInput.value));
      return;
    }

    if (data.kind === 'table') {
      renderTableView(bodyEl, data.rows || [], '');
      filterInput?.addEventListener('input', () => renderTableView(bodyEl, data.rows || [], filterInput.value));
      return;
    }

    if (data.kind === 'pptx') {
      const renderSlides = (q = '') => {
        const needle = q.trim().toLowerCase();
        const slides = (data.slides || []).filter(
          (s) => !needle || s.title.toLowerCase().includes(needle) || s.lines.some((l) => l.toLowerCase().includes(needle))
        );
        bodyEl.innerHTML = slides.length
          ? `<div class="agy-sp-card-list">${slides
              .map(
                (s) => `
              <div class="agy-sp-card">
                <div class="agy-sp-card-head">
                  <span>${escapeHtml(s.title)}</span>
                  <span style="opacity:.65;font-size:11px">#${s.number}</span>
                </div>
                ${s.lines.length ? `<ul style="margin:6px 0 0;padding-left:18px">${s.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>` : `<div style="opacity:.55;font-size:12px">${escapeHtml(text('（无附加正文文本）', '(No body text)'))}</div>`}
              </div>`
              )
              .join('')}</div>`
          : `<div class="agy-sp-empty">${escapeHtml(text('无匹配幻灯片', 'No matching slides'))}</div>`;
      };
      renderSlides();
      filterInput?.addEventListener('input', () => renderSlides(filterInput.value));
      return;
    }

    if (data.kind === 'ipynb') {
      const cells = data.cells || [];
      bodyEl.innerHTML = `<div class="agy-sp-card-list">${cells
        .map((c) => {
          if (c.cellType === 'markdown') {
            return `<div class="agy-sp-card">${renderSimpleMarkdown(c.source)}</div>`;
          }
          const outs = (c.outputs || [])
            .map((o) =>
              o.kind === 'image'
                ? `<div style="margin-top:8px"><img src="data:${escapeHtml(o.mime)};base64,${escapeHtml(o.data)}" style="max-width:100%;border-radius:6px" alt="output" /></div>`
                : `<pre class="agy-sp-pre" style="margin-top:8px;border-top:1px dashed rgba(128,128,128,.2);${o.kind === 'error' ? 'color:#C94A4A' : ''}">${escapeHtml(o.text)}</pre>`
            )
            .join('');
          return `<div class="agy-sp-card">
            <div class="agy-sp-card-head"><span>In [${c.executionCount ?? ' '}] (${escapeHtml(data.language || 'code')})</span><span>#${c.index}</span></div>
            <pre class="agy-sp-pre">${escapeHtml(c.source)}</pre>
            ${outs}
          </div>`;
        })
        .join('')}</div>`;
      return;
    }

    if (data.kind === 'jsonl') {
      const renderJsonl = (q = '') => {
        const needle = q.trim().toLowerCase();
        const recs = (data.records || []).filter((r) => {
          if (!needle) return true;
          const str = r.ok ? JSON.stringify(r.value) : r.raw;
          return str.toLowerCase().includes(needle);
        });
        bodyEl.innerHTML = `<div class="agy-sp-card-list">${recs
          .map(
            (r) => `<div class="agy-sp-card">
              <div class="agy-sp-card-head"><span>Line #${r.line}</span></div>
              <pre class="agy-sp-pre">${escapeHtml(r.ok ? JSON.stringify(r.value, null, 2) : r.raw)}</pre>
            </div>`
          )
          .join('')}</div>`;
      };
      renderJsonl();
      filterInput?.addEventListener('input', () => renderJsonl(filterInput.value));
      return;
    }

    if (data.kind === 'archive') {
      const renderArchive = (q = '') => {
        const needle = q.trim().toLowerCase();
        const entries = (data.entries || []).filter((e) => !needle || e.name.toLowerCase().includes(needle));
        bodyEl.innerHTML = `<div class="agy-sp-table-wrap"><table class="agy-sp-table">
          <thead><tr><th>${escapeHtml(text('路径', 'Entry'))}</th><th>${escapeHtml(text('原始大小', 'Size'))}</th><th>${escapeHtml(text('压缩后', 'Compressed'))}</th><th>${escapeHtml(text('操作', 'Action'))}</th></tr></thead>
          <tbody>${entries
            .map(
              (e) => `<tr>
                <td>${e.isDirectory ? '📁 ' : '📄 '}${escapeHtml(e.name)}</td>
                <td>${e.isDirectory ? '—' : escapeHtml(formatBytes(e.size))}</td>
                <td>${e.isDirectory ? '—' : escapeHtml(formatBytes(e.compressedSize))}</td>
                <td>${!e.isDirectory && e.size <= 5 * 1048576 ? `<button type="button" class="agy-sp-btn" data-zip-entry="${escapeHtml(e.name)}">${escapeHtml(text('预览', 'View'))}</button>` : ''}</td>
              </tr>`
            )
            .join('')}</tbody>
        </table></div>`;
        bodyEl.querySelectorAll('[data-zip-entry]').forEach((btn) => {
          btn.addEventListener('click', () => mountPreviewIntoContainer(host, uri, { ...options, zipEntry: btn.dataset.zipEntry }));
        });
      };
      renderArchive();
      filterInput?.addEventListener('input', () => renderArchive(filterInput.value));
      return;
    }

    if (data.kind === 'sqlite') {
      const info = data.sqliteInfo || {};
      const schemas = info.schemas || [];
      bodyEl.innerHTML = `<div class="agy-sp-card-list">
        <div class="agy-sp-card">
          <div class="agy-sp-card-head"><span>SQLite 3 Database</span><span>${escapeHtml(info.encoding || 'UTF-8')}</span></div>
          <div>${escapeHtml(text('页大小', 'Page size'))}: <strong>${info.pageSize} B</strong> · ${escapeHtml(text('总页数', 'Pages'))}: <strong>${info.pageCount}</strong> · ${escapeHtml(text('提取到对象结构', 'Schemas'))}: <strong>${schemas.length}</strong></div>
        </div>
        ${schemas.map((ddl, i) => `<div class="agy-sp-card"><div class="agy-sp-card-head"><span>DDL #${i + 1}</span></div><pre class="agy-sp-pre">${escapeHtml(ddl)}</pre></div>`).join('')}
      </div>`;
      return;
    }

    if (data.kind === 'markdown') {
      bodyEl.innerHTML = renderSimpleMarkdown(data.content);
      return;
    }

    if (data.kind === 'text' || data.kind === 'zip-entry') {
      const lines = String(data.content || '').replace(/\r/g, '').split('\n');
      const range = data.lineRange;
      const lineHtml = lines
        .slice(0, 4000)
        .map((line, i) => {
          const ln = i + 1;
          const hl = range && ln >= range.start && ln <= range.end ? 'hl' : '';
          return `<div class="agy-sp-line ${hl}" data-ln="${ln}"><span class="agy-sp-ln">${ln}</span><span class="agy-sp-lc">${escapeHtml(line) || ' '}</span></div>`;
        })
        .join('');
      const truncBanner = data.truncated
        ? `<div class="agy-sp-card" style="margin:12px"><div class="agy-sp-card-head">${escapeHtml(text('大文件极速采样预览（头部 384KB + 尾部 64KB）', 'Large file head + tail preview'))}</div><pre class="agy-sp-pre">${escapeHtml(data.tailContent || '')}</pre></div>`
        : '';
      bodyEl.innerHTML = `<div class="agy-sp-code-lines">${lineHtml}</div>${truncBanner}`;
      if (range?.start) {
        requestAnimationFrame(() => {
          bodyEl.querySelector(`[data-ln="${range.start}"]`)?.scrollIntoView({ block: 'center' });
        });
      }
      return;
    }

    // Binary / Hex inspector fallback
    bodyEl.innerHTML = `<div class="agy-sp-card-list">
      <div class="agy-sp-card">
        <div class="agy-sp-card-head"><span>${escapeHtml(data.signature || 'Binary File')}</span><span>${escapeHtml(formatBytes(data.size))}</span></div>
        <div style="margin-bottom:10px;font-size:12px;opacity:.8">${escapeHtml(text('已识别文件头签名与前 256 字节十六进制结构；如需完整编辑可一键调用系统默认程序打开。', 'Binary signature & 256-byte hex header preview.'))}</div>
        <pre class="agy-sp-pre">${escapeHtml(data.hexPreview || '')}</pre>
      </div>
    </div>`;
  }

  function inspectSidePanels() {
    if (disposed || window.__agySuiteSettings?.sidePreview === false) return;
    const panels = document.querySelectorAll('[data-side-panel-body]');
    for (const panel of panels) {
      const scope = panel.querySelector('[data-side-panel-focus-scope="true"]') || panel;
      if (getComputedStyle(scope).position === 'static') {
        scope.style.position = 'relative';
      }

      const uri = extractSidePanelFileUri(panel);
      const fallbackNode = detectFallbackNode(panel);
      const existingHost = scope.querySelector(':scope > .agy-sp-host');
      const existingPill = scope.querySelector(':scope > .agy-sp-float-pill');

      if (!uri) {
        existingHost?.remove();
        existingPill?.remove();
        continue;
      }

      const openDock = document.getElementById(DOCK_ID);
      if (openDock && normalizeUriKey(openDock.dataset.uri) === normalizeUriKey(uri)) {
        openDock.remove();
      }

      const shouldAutoMount = Boolean(fallbackNode) && !dismissedAutoUris.has(uri);
      const shouldManualMount = manualToggleUris.has(uri);

      if (shouldAutoMount || shouldManualMount) {
        existingPill?.remove();
        if (!existingHost || existingHost.dataset.uri !== uri) {
          const host = existingHost || document.createElement('div');
          host.className = 'agy-sp-host';
          host.setAttribute('data-ag-i18n-skip', 'true');
          host.setAttribute('data-ag-localization-skip', 'true');
          if (!existingHost) scope.appendChild(host);
          mountPreviewIntoContainer(host, uri, {
            onNativeView: () => {
              manualToggleUris.delete(uri);
              if (fallbackNode) dismissedAutoUris.add(uri);
              host.remove();
              scheduleInspect();
            },
          });
        }
      } else {
        existingHost?.remove();
        if (isRichToggleCandidate(uri) || dismissedAutoUris.has(uri)) {
          if (!existingPill || existingPill.dataset.uri !== uri) {
            const pill = existingPill || document.createElement('button');
            pill.type = 'button';
            pill.className = 'agy-sp-float-pill';
            pill.dataset.uri = uri;
            pill.setAttribute('data-ag-i18n-skip', 'true');
            pill.setAttribute('data-ag-localization-skip', 'true');
            pill.textContent = '👁️ ' + text('增强预览', 'Rich Preview');
            pill.onclick = () => {
              dismissedAutoUris.delete(uri);
              manualToggleUris.add(uri);
              pill.remove();
              inspectSidePanels();
            };
            if (!existingPill) scope.appendChild(pill);
          }
        } else {
          existingPill?.remove();
        }
      }
    }
  }

  function closeDock() {
    document.getElementById(DOCK_ID)?.remove();
  }

  function openPreview(uri) {
    if (!uri || disposed) return;
    let dock = document.getElementById(DOCK_ID);
    if (!dock) {
      dock = document.createElement('aside');
      dock.id = DOCK_ID;
      dock.setAttribute('data-ag-i18n-skip', 'true');
      dock.setAttribute('data-ag-localization-skip', 'true');
      document.body.appendChild(dock);
    }
    mountPreviewIntoContainer(dock, uri, { onClose: closeDock });
  }

  function scheduleInspect() {
    if (disposed || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      inspectSidePanels();
    });
  }

  function onDocumentClick(event) {
    if (disposed || window.__agySuiteSettings?.sidePreview === false) return;
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || anchor.closest(`#${DOCK_ID}`) || anchor.closest('.agy-sp-host')) return;
    const href = anchor.getAttribute('href') || '';
    if (!/^file:\/\//i.test(href)) return;

    lastClickedUri = href;
    lastClickedAt = Date.now();
    const targetKey = normalizeUriKey(href);

    // Custom startpage relay log has no native file router: intercept directly.
    if (anchor.closest('#agy-ms-startpage-chat-log')) {
      event.preventDefault();
      openPreview(href);
      return;
    }

    // Otherwise let Antigravity's native openFile run first; if it silently drops
    // the file (e.g. outside workspace abortIfAllStatFail), open our docked preview!
    const targetBase = targetKey.split('/').pop() || '';
    setTimeout(() => {
      if (disposed) return;
      const panels = [...document.querySelectorAll('[data-side-panel-body]')].filter(
        (el) => el.getBoundingClientRect().width > 40
      );
      const handledByNative = panels.some((p) => {
        const panelUri = extractSidePanelFileUri(p);
        if (panelUri && normalizeUriKey(panelUri) === targetKey) return true;
        const container = p.parentElement;
        if (targetBase && container) {
          const activeTab = container.querySelector('[role="tab"][aria-selected="true"]');
          if (activeTab && (activeTab.textContent || '').toLowerCase().includes(targetBase)) return true;
        }
        return false;
      });
      if (handledByNative) {
        inspectSidePanels();
      } else {
        openPreview(href);
      }
    }, 360);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && document.getElementById(DOCK_ID)) {
      closeDock();
    }
  }

  document.addEventListener('click', onDocumentClick, true);
  document.addEventListener('keydown', onKeyDown);

  const observer = new MutationObserver(scheduleInspect);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  inspectSidePanels();

  window.__agySidePreview = {
    openPreview,
    closeDock,
    inspectSidePanels,
    extractSidePanelFileUri,
  };

  window.__agySidePreviewCleanup = () => {
    disposed = true;
    observer.disconnect();
    document.removeEventListener('click', onDocumentClick, true);
    document.removeEventListener('keydown', onKeyDown);
    document.querySelectorAll('.agy-sp-host, .agy-sp-float-pill').forEach((el) => el.remove());
    closeDock();
    style.remove();
    delete window.__agySidePreview;
  };
})();
