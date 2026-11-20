(() => {
  window.__agyTokenSpeedCleanup?.();

  const STORAGE_KEY = '__agy_token_speed_v1__';
  const MAX_CONVERSATIONS = 40;
  const MAX_TURNS_PER_CONV = 15;
  const ACTIVE_GAP_LIMIT_MS = 1500;
  const PAUSE_RESUME_QUANTUM_MS = 180;
  const SKIP_I18N_ATTR = 'data-ag-localization-skip';

  let disposed = false;
  let scheduled = false;
  let store = loadStore();
  let popoverEl = null;
  let popoverConvId = null;
  let popoverAnchor = null;
  let pendingHomeSession = null;

  const paneSessions = new WeakMap();
  const relayConvSessions = new Map();
  const knownComposers = new Set();

  const text = (cn, en) => window.__agySuiteSettings?.i18n === false ? en : cn;

  const style = document.createElement('style');
  style.id = 'agy-token-speed-style';
  style.setAttribute(SKIP_I18N_ATTR, 'true');
  style.textContent = `
    body button.agy-ts-pill[data-agy-token-speed="true"] {
      display: inline-flex !important;
      align-items: center !important;
      gap: 5px !important;
      flex: 0 0 auto !important;
      height: 22px !important;
      min-height: 22px !important;
      width: auto !important;
      max-width: 168px !important;
      margin: 0 2px 0 4px !important;
      padding: 0 8px !important;
      border-radius: 999px !important;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.22)) !important;
      background: rgba(128, 128, 128, 0.06) !important;
      color: var(--muted-foreground, #6E6A61) !important;
      font: 500 11px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      font-variant-numeric: tabular-nums !important;
      white-space: nowrap !important;
      cursor: pointer !important;
      user-select: none !important;
      vertical-align: middle !important;
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease !important;
    }
    body.theme-dark button.agy-ts-pill[data-agy-token-speed="true"],
    html.dark button.agy-ts-pill[data-agy-token-speed="true"] {
      background: rgba(255, 255, 255, 0.05) !important;
      color: #B4AFA6 !important;
      border-color: rgba(236, 233, 226, 0.14) !important;
    }
    body button.agy-ts-pill[data-agy-token-speed="true"]:hover,
    body button.agy-ts-pill[data-agy-token-speed="true"]:focus-visible,
    body button.agy-ts-pill[data-agy-token-speed="true"][aria-expanded="true"] {
      background: rgba(217, 119, 87, 0.1) !important;
      border-color: rgba(217, 119, 87, 0.45) !important;
      color: #D97757 !important;
      outline: none !important;
    }
    body button.agy-ts-pill[data-agy-token-speed="true"][data-live="true"] {
      background: rgba(217, 119, 87, 0.12) !important;
      border-color: rgba(217, 119, 87, 0.5) !important;
      color: #C65D3B !important;
    }
    body.theme-dark button.agy-ts-pill[data-agy-token-speed="true"][data-live="true"],
    html.dark button.agy-ts-pill[data-agy-token-speed="true"][data-live="true"] {
      color: #EA8B6C !important;
    }
    .agy-ts-dot {
      width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
      background: #9A958C; transition: background 0.15s ease;
    }
    button.agy-ts-pill[data-tier="fast"] .agy-ts-dot { background: #3E8E5A; }
    button.agy-ts-pill[data-tier="normal"] .agy-ts-dot { background: #D97757; }
    button.agy-ts-pill[data-tier="slow"] .agy-ts-dot { background: #C9563C; }
    button.agy-ts-pill[data-live="true"] .agy-ts-dot {
      background: #D97757;
      animation: agyTsPulse 1s ease-in-out infinite;
    }
    @keyframes agyTsPulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.82); }
    }
    .agy-ts-value { overflow: hidden; text-overflow: ellipsis; }
    #agy-token-speed-popover {
      position: fixed;
      z-index: 10030;
      width: min(352px, calc(100vw - 20px));
      max-height: min(440px, calc(100vh - 24px));
      display: flex; flex-direction: column;
      border-radius: 15px;
      border: 1px solid var(--border, rgba(20, 20, 19, 0.13));
      background: var(--agy-bg-primary, var(--background, #FAF9F5));
      color: var(--agy-text-primary, var(--foreground, #141413));
      box-shadow: 0 20px 58px rgba(0, 0, 0, 0.22);
      font: 12.5px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-variant-numeric: tabular-nums;
      overflow: hidden;
      animation: agyTsPop 0.14s cubic-bezier(0.16, 1, 0.3, 1) both;
    }
    body.theme-dark #agy-token-speed-popover,
    html.dark #agy-token-speed-popover {
      background: #232220;
      border-color: rgba(236, 233, 226, 0.15);
      box-shadow: 0 24px 66px rgba(0, 0, 0, 0.62);
    }
    @keyframes agyTsPop {
      from { opacity: 0; transform: translateY(4px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    .agy-ts-pop-head {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 11px 14px 9px;
      border-bottom: 1px solid var(--border, rgba(128, 128, 128, 0.16));
    }
    .agy-ts-pop-title {
      font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px;
    }
    .agy-ts-pop-actions { display: flex; align-items: center; gap: 4px; }
    .agy-ts-pop-actions button {
      border: 1px solid var(--border, rgba(128, 128, 128, 0.22));
      background: transparent; color: inherit; border-radius: 6px;
      padding: 2px 7px; font: 500 11px system-ui, sans-serif; cursor: pointer;
      transition: border-color 0.14s, color 0.14s, background 0.14s;
    }
    .agy-ts-pop-actions button:hover {
      border-color: #D97757; color: #D97757; background: rgba(217, 119, 87, 0.08);
    }
    .agy-ts-pop-body { padding: 11px 14px 13px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
    .agy-ts-hero {
      display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 7px;
    }
    .agy-ts-stat {
      padding: 8px 9px; border-radius: 10px;
      border: 1px solid var(--border, rgba(128, 128, 128, 0.15));
      background: rgba(128, 128, 128, 0.045);
      display: flex; flex-direction: column; gap: 2px;
    }
    .agy-ts-stat-k { font-size: 10.5px; opacity: 0.62; }
    .agy-ts-stat-v { font-size: 13.5px; font-weight: 700; color: inherit; }
    .agy-ts-stat.primary .agy-ts-stat-v { color: #D97757; }
    .agy-ts-meta-line {
      font-size: 11px; opacity: 0.72; display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;
    }
    .agy-ts-badge {
      padding: 1px 6px; border-radius: 999px; font-size: 10px; font-weight: 600;
      background: rgba(217, 119, 87, 0.12); color: #D97757;
    }
    .agy-ts-hist-title {
      font-size: 10.5px; font-weight: 600; letter-spacing: 0.04em; opacity: 0.56;
      text-transform: uppercase; margin-top: 2px;
    }
    .agy-ts-hist-list { display: flex; flex-direction: column; gap: 5px; }
    .agy-ts-hist-row {
      display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 6px 8px; border-radius: 8px;
      background: rgba(128, 128, 128, 0.05); font-size: 11.5px;
    }
    .agy-ts-hist-left { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
    .agy-ts-hist-model { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .agy-ts-hist-sub { font-size: 10.5px; opacity: 0.6; }
    .agy-ts-hist-right { font-weight: 700; color: #D97757; flex-shrink: 0; }
    .agy-ts-empty { font-size: 11.5px; opacity: 0.62; padding: 8px 2px; line-height: 1.5; }
  `;
  document.head.appendChild(style);

  function loadStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (parsed && typeof parsed.conversations === 'object' && parsed.conversations) return parsed;
    } catch {}
    return { version: 1, conversations: {} };
  }

  function saveStore() {
    try {
      const entries = Object.entries(store.conversations || {})
        .sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0))
        .slice(0, MAX_CONVERSATIONS);
      store.conversations = Object.fromEntries(entries);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {}
  }

  function estimateTokens(raw) {
    const str = String(raw || '');
    if (!str) return 0;
    let cjk = 0;
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3000 && code <= 0x30FF) || (code >= 0xFF00 && code <= 0xFFEF)) cjk++;
    }
    const rest = str.length - cjk;
    return Math.max(1, Math.round(cjk * 0.68 + rest * 0.27));
  }

  function cleanModelLabel(btn) {
    if (!btn) return text('默认模型', 'Model');
    const custom = btn.querySelector('.agy-ms-trigger-custom-label');
    const raw = (custom ? custom.textContent : (btn.innerText || btn.textContent || '')).replace(/\s+/g, ' ').trim();
    return raw || text('默认模型', 'Model');
  }

  function findComposerBox(el) {
    return el?.closest?.('[data-testid="agent-input-box"]') || null;
  }

  function findPaneRoot(composer) {
    if (!composer) return null;
    const cascade = composer.closest('[data-cascade-id], [data-testid="conversation-view"]');
    if (cascade) return cascade;
    let cur = composer.parentElement;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (cur.querySelector('[data-testid="user-input-step"], [data-testid="user-message-bubble"], [data-testid="planner-response-text"], .agy-ms-chat-body')) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return composer.closest('main') || document.body;
  }

  function resolveConversationId(composer, paneRoot) {
    const direct = composer?.closest?.('[data-cascade-id]')?.getAttribute('data-cascade-id')
      || paneRoot?.getAttribute?.('data-cascade-id')
      || paneRoot?.querySelector?.('[data-cascade-id]')?.getAttribute('data-cascade-id');
    if (direct) return direct;
    if (window.__AGY_MODEL_SWITCHER?.getState) {
      const st = window.__AGY_MODEL_SWITCHER.getState();
      if (st?.activeLocalSessionId) return st.activeLocalSessionId;
    }
    const match = location.pathname.match(/\/c\/([^/?#]+)/);
    return match ? match[1] : 'home';
  }

  function extractCleanAssistantText(node) {
    if (!node) return '';
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, {
      acceptNode(textNode) {
        const el = textNode.parentElement;
        if (!el) return NodeFilter.FILTER_REJECT;
        if (el.closest('button, style, script, .agy-code-fold-btn, .agy-code-preview-btn, .agy-code-diff-btn, .agy-live-preview-panel, .agy-code-diff-panel, .agy-table-tools, .agy-code-header-actions, .agy-ms-live-status')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let out = '';
    let cur;
    while ((cur = walker.nextNode())) out += cur.nodeValue || '';
    return out;
  }

  function snapshotPaneTurns(paneRoot) {
    if (!paneRoot) return { userCount: 0, lastUserEl: null, replyText: '' };
    const nodes = [...paneRoot.querySelectorAll('[data-testid="user-input-step"], [data-testid="user-message-bubble"], [data-testid="planner-response-text"], .agy-ms-chat-body')];
    const filtered = nodes.filter(el => !el.closest('[data-side-panel-body], #agy-suite-backdrop, #agy-outline-drawer, #agy-prompt-vault-backdrop, #agy-command-palette-backdrop, #agy-pinboard-backdrop, #agy-token-speed-popover'));
    let userCount = 0;
    let lastUserEl = null;
    let replyParts = [];
    for (const el of filtered) {
      const tid = el.getAttribute('data-testid');
      if (tid === 'user-message-bubble' && el.closest('[data-testid="user-input-step"]')) continue;
      if (tid === 'user-input-step' || tid === 'user-message-bubble') {
        userCount++;
        lastUserEl = el;
        replyParts = [];
      } else {
        if (tid === 'planner-response-text' && el.querySelector('.agy-ms-chat-body')) continue;
        replyParts.push(extractCleanAssistantText(el));
      }
    }
    return { userCount, lastUserEl, replyText: replyParts.join('\n') };
  }

  function isPaneGenerating(composer, paneRoot) {
    if (composer?.querySelector('button[data-tooltip-id="input-send-button-cancel-tooltip"]')) return true;
    if (paneRoot?.querySelector('button[data-tooltip-id="input-send-button-cancel-tooltip"]')) return true;
    const msState = window.__AGY_MODEL_SWITCHER?.getState?.();
    if (msState?.isSendingCustomChat) {
      const cid = resolveConversationId(composer, paneRoot);
      if (!msState.activeConversationId || msState.activeConversationId === cid) return true;
    }
    return false;
  }

  function speedTier(tokPerSec) {
    if (!Number.isFinite(tokPerSec) || tokPerSec <= 0) return 'idle';
    if (tokPerSec >= 80) return 'fast';
    if (tokPerSec >= 35) return 'normal';
    return 'slow';
  }

  function round1(v) {
    return Math.round(Number(v) * 10) / 10;
  }

  function createSession({ convId, composer, triggerBtn, source, modelName }) {
    const now = performance.now();
    const paneRoot = findPaneRoot(composer);
    const snap = paneRoot ? snapshotPaneTurns(paneRoot) : { userCount: 0, lastUserEl: null, replyText: '' };
    return {
      convId,
      composer,
      paneRoot,
      source: source || 'dom',
      modelName: modelName || cleanModelLabel(triggerBtn),
      submittedAt: now,
      firstTokenAt: null,
      lastSampleAt: null,
      activeMs: 0,
      chars: 0,
      tokens: 0,
      liveTokPerSec: 0,
      peakTokPerSec: 0,
      paused: false,
      samples: [],
      baselineUserCount: snap.userCount,
      baselineLastUserEl: snap.lastUserEl,
      baselineReplyLen: snap.replyText.length,
      baselineReplyText: snap.replyText,
      seenNewUserTurn: false,
      rawReplyText: '',
      rawThinkingText: '',
      calibratedUsage: null,
      finished: false
    };
  }

  function pushTokenSample(session, nextTokens, nextChars, now = performance.now()) {
    if (session.finished || nextChars <= 0) return;
    if (!session.firstTokenAt) {
      session.firstTokenAt = now;
      session.lastSampleAt = now;
      session.activeMs = 0;
    } else {
      const dt = now - (session.lastSampleAt || now);
      if (dt > 0) {
        session.activeMs += dt <= ACTIVE_GAP_LIMIT_MS ? dt : PAUSE_RESUME_QUANTUM_MS;
      }
      session.lastSampleAt = now;
    }
    session.paused = false;
    session.chars = nextChars;
    session.tokens = nextTokens;
    session.samples.push({ t: now, tokens: nextTokens, chars: nextChars });
    const cutoff = now - 2600;
    while (session.samples.length > 2 && session.samples[0].t < cutoff) {
      session.samples.shift();
    }
    // 计算近 1.5s 滑窗瞬时速率并做轻量平滑，避免单个 chunk 抖动失真
    const anchor = session.samples.find(s => s.t >= now - 1600) || session.samples[0];
    const windowMs = anchor ? Math.max(0, now - anchor.t) : 0;
    const windowTokens = anchor ? Math.max(0, nextTokens - anchor.tokens) : 0;
    let instant = 0;
    if (windowMs >= 260 && windowTokens >= 2) {
      instant = (windowTokens * 1000) / windowMs;
    } else if (session.activeMs >= 220 && nextTokens >= 3) {
      instant = (nextTokens * 1000) / session.activeMs;
    }
    if (instant > 0) {
      session.liveTokPerSec = session.liveTokPerSec > 0
        ? round1(instant * 0.45 + session.liveTokPerSec * 0.55)
        : round1(instant);
      if (session.liveTokPerSec > session.peakTokPerSec) {
        session.peakTokPerSec = session.liveTokPerSec;
      }
    }
  }

  function commitSession(session) {
    if (!session || session.finished) return null;
    session.finished = true;
    const now = performance.now();
    const totalChars = session.chars;
    const usageTokens = Number.isFinite(session.calibratedUsage?.outputTokens) && session.calibratedUsage.outputTokens > 0
      ? Number(session.calibratedUsage.outputTokens)
      : null;
    const totalTokens = usageTokens ?? session.tokens;
    if (totalTokens <= 0 || !session.firstTokenAt) return null;

    const activeSec = Math.max(0.2, session.activeMs / 1000);
    const wallSinceFirstSec = Math.max(0.2, ((session.lastSampleAt || now) - session.firstTokenAt) / 1000);
    const effectiveSec = Math.max(0.2, activeSec >= 0.25 ? activeSec : wallSinceFirstSec);
    const tokPerSec = round1(totalTokens / effectiveSec);
    const charsPerSec = totalChars > 0 ? round1(totalChars / effectiveSec) : 0;
    const ttftMs = Math.max(0, Math.round(session.firstTokenAt - session.submittedAt));
    const wallMs = Math.max(100, Math.round((session.lastSampleAt || now) - session.submittedAt));

    const recordTurn = {
      id: 'ts-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      at: Date.now(),
      modelName: session.modelName || text('默认模型', 'Model'),
      tokPerSec,
      peakTokPerSec: Math.max(tokPerSec, session.peakTokPerSec || tokPerSec),
      charsPerSec,
      tokens: totalTokens,
      chars: totalChars,
      ttftMs,
      activeMs: Math.round(effectiveSec * 1000),
      wallMs,
      calibrated: usageTokens !== null,
      source: session.source
    };

    const conv = store.conversations[session.convId] || {
      convId: session.convId,
      history: []
    };
    conv.convId = session.convId;
    conv.updatedAt = Date.now();
    conv.lastTurn = recordTurn;
    conv.history = [recordTurn, ...(Array.isArray(conv.history) ? conv.history : [])].slice(0, MAX_TURNS_PER_CONV);
    const validRates = conv.history.map(h => h.tokPerSec).filter(n => Number.isFinite(n) && n > 0);
    conv.avgTokPerSec = validRates.length ? round1(validRates.reduce((a, b) => a + b, 0) / validRates.length) : tokPerSec;
    conv.peakTokPerSec = validRates.length ? round1(Math.max(...conv.history.map(h => h.peakTokPerSec || h.tokPerSec || 0))) : recordTurn.peakTokPerSec;
    conv.totalTurns = (conv.totalTurns || 0) + 1;
    store.conversations[session.convId] = conv;
    saveStore();
    return conv;
  }

  function updateDomSessionForComposer(composer, triggerBtn) {
    const paneRoot = findPaneRoot(composer);
    const convId = resolveConversationId(composer, paneRoot);
    let session = paneSessions.get(composer);

    // 若刚在首页 (home) 发送消息后跳进了新生成的 /c/<uuid>，自动把会话上下文迁移到新 ID
    if (session && !session.finished && session.convId !== convId && session.convId === 'home' && convId !== 'home') {
      session.convId = convId;
      if (pendingHomeSession === session) pendingHomeSession = null;
    }
    if ((!session || session.finished) && convId !== 'home' && pendingHomeSession && !pendingHomeSession.finished &&
        (!pendingHomeSession.composer?.isConnected || pendingHomeSession.composer === composer) &&
        performance.now() - pendingHomeSession.submittedAt < 15000) {
      session = pendingHomeSession;
      session.convId = convId;
      session.composer = composer;
      session.paneRoot = paneRoot;
      session.baselineUserCount = 0;
      session.seenNewUserTurn = true;
      paneSessions.set(composer, session);
      pendingHomeSession = null;
    }

    const activeRelay = relayConvSessions.get(convId);
    if (activeRelay && !activeRelay.finished) {
      session = activeRelay;
      paneSessions.set(composer, activeRelay);
    }

    const generating = isPaneGenerating(composer, paneRoot);
    if (!session || session.finished) {
      if (generating) {
        session = createSession({ convId, composer, triggerBtn, source: 'dom' });
        paneSessions.set(composer, session);
      } else {
        return { convId, session: null, generating: false };
      }
    }

    if (session.source === 'dom') {
      const snap = snapshotPaneTurns(paneRoot);
      if (snap.userCount > session.baselineUserCount || (snap.lastUserEl && snap.lastUserEl !== session.baselineLastUserEl)) {
        session.seenNewUserTurn = true;
      }
      let nextText = '';
      if (session.seenNewUserTurn) {
        nextText = snap.replyText;
      } else if (snap.replyText.length > session.baselineReplyLen && snap.replyText.startsWith(session.baselineReplyText.slice(0, 24))) {
        nextText = snap.replyText.slice(session.baselineReplyLen);
      } else if (snap.replyText && snap.replyText !== session.baselineReplyText && generating) {
        nextText = snap.replyText;
      }

      const trimmed = nextText.trim();
      if (trimmed.length > session.chars) {
        pushTokenSample(session, estimateTokens(trimmed), trimmed.length);
      } else if (session.firstTokenAt && session.lastSampleAt && performance.now() - session.lastSampleAt > ACTIVE_GAP_LIMIT_MS && generating) {
        session.paused = true;
      }

      const idleEnough = session.firstTokenAt
        ? (performance.now() - (session.lastSampleAt || session.firstTokenAt) > 250)
        : (performance.now() - session.submittedAt > 12000);
      if (!generating && ((session.tokens > 0 && idleEnough) || (!session.firstTokenAt && performance.now() - session.submittedAt > 4000))) {
        if (session.tokens > 0) commitSession(session);
        else session.finished = true;
      }
    }

    return { convId, session: session.finished ? null : session, generating };
  }

  function renderPill(triggerBtn, composer) {
    if (disposed || !triggerBtn?.isConnected) return;
    const { convId, session, generating } = updateDomSessionForComposer(composer, triggerBtn);
    const convRecord = store.conversations?.[convId];

    let pill = triggerBtn.nextElementSibling;
    if (!pill || !pill.classList?.contains('agy-ts-pill')) {
      const existing = triggerBtn.parentElement?.querySelector('.agy-ts-pill[data-agy-token-speed="true"]');
      if (existing) pill = existing;
      else {
        pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'agy-ts-pill';
        pill.setAttribute('data-agy-token-speed', 'true');
        pill.setAttribute(SKIP_I18N_ATTR, 'true');
        pill.setAttribute('aria-haspopup', 'dialog');
        pill.setAttribute('aria-expanded', 'false');
        pill.innerHTML = '<span class="agy-ts-dot" aria-hidden="true"></span><span class="agy-ts-value"></span>';
      }
      if (triggerBtn.nextElementSibling !== pill) {
        triggerBtn.after(pill);
      }
    }

    pill.dataset.convId = convId;
    pill.onclick = e => {
      e.stopPropagation();
      if (popoverEl && popoverAnchor === pill) closePopover();
      else openPopover(pill, pill.dataset.convId || convId);
    };

    const valEl = pill.querySelector('.agy-ts-value');
    let label = '';
    let title = '';
    let live = false;
    let tier = 'idle';

    if (session && !session.finished) {
      live = true;
      if (!session.firstTokenAt) {
        const waitSec = ((performance.now() - session.submittedAt) / 1000).toFixed(1);
        label = text(`首字 ${waitSec}s…`, `TTFT ${waitSec}s…`);
        title = text('正在等待首字输出… 点击查看详情', 'Waiting for first token… Click for details');
      } else if (session.paused && generating) {
        const rate = session.liveTokPerSec || round1(session.tokens / Math.max(0.2, session.activeMs / 1000));
        tier = speedTier(rate);
        label = `${rate.toFixed(1)} tok/s · ${text('工具', 'tool')}`;
        title = text(`当前 ${session.tokens} tok · 等待工具或思考继续输出`, `${session.tokens} tok so far · waiting for tool step`);
      } else {
        const rate = session.liveTokPerSec || (session.activeMs >= 200 ? round1((session.tokens * 1000) / session.activeMs) : 0);
        tier = rate > 0 ? speedTier(rate) : 'normal';
        label = rate > 0 ? `${rate.toFixed(1)} tok/s` : text('生成中…', 'Streaming…');
        title = text(`实时输出速度 · 已生成约 ${session.tokens} tokens`, `Live output speed · ~${session.tokens} tokens generated`);
      }
    } else if (convRecord?.lastTurn) {
      const last = convRecord.lastTurn;
      tier = speedTier(last.tokPerSec);
      label = `${last.tokPerSec.toFixed(1)} tok/s`;
      const ttftSec = (last.ttftMs / 1000).toFixed(2);
      const srcTag = last.calibrated ? text('实测 Usage', 'Measured Usage') : text('本地估算', 'Est.');
      title = text(
        `上轮输出速度 ${last.tokPerSec.toFixed(1)} tok/s（首字 ${ttftSec}s · ${last.tokens} tok · ${srcTag}）\n点击查看本对话各轮明细`,
        `Last turn: ${last.tokPerSec.toFixed(1)} tok/s (TTFT ${ttftSec}s · ${last.tokens} tok · ${srcTag})\nClick for conversation breakdown`
      );
    } else {
      label = text('-- tok/s', '-- tok/s');
      title = text('发送消息后自动监测本对话实时输出速度 (tok/s) 与首字延迟', 'Send a message to measure per-conversation tok/s & TTFT');
    }

    pill.dataset.live = String(live);
    pill.dataset.tier = tier;
    if (valEl && valEl.textContent !== label) valEl.textContent = label;
    if (pill.title !== title) pill.title = title;
    if (popoverEl && popoverAnchor === pill) renderPopoverContent(convId);
  }

  function closePopover() {
    if (popoverAnchor?.isConnected) popoverAnchor.setAttribute('aria-expanded', 'false');
    popoverEl?.remove();
    popoverEl = null;
    popoverConvId = null;
    popoverAnchor = null;
  }

  function positionPopover(anchor, pop) {
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(352, window.innerWidth - 20);
    const left = Math.max(10, Math.min(rect.left, window.innerWidth - width - 10));
    pop.style.left = left + 'px';
    if (rect.top > 240) {
      pop.style.bottom = Math.max(10, window.innerHeight - rect.top + 8) + 'px';
      pop.style.top = 'auto';
    } else {
      pop.style.top = Math.min(window.innerHeight - 240, rect.bottom + 8) + 'px';
      pop.style.bottom = 'auto';
    }
  }

  function renderPopoverContent(convId) {
    if (!popoverEl) return;
    const conv = store.conversations?.[convId];
    const active = [...relayConvSessions.values()].find(s => s.convId === convId && !s.finished)
      || Array.from(knownComposers).map(c => paneSessions.get(c)).find(s => s && !s.finished && s.convId === convId);

    popoverEl.replaceChildren();

    const head = document.createElement('div');
    head.className = 'agy-ts-pop-head';
    const title = document.createElement('div');
    title.className = 'agy-ts-pop-title';
    title.innerHTML = `<span style="color:#D97757">⚡</span><span>${text('对话输出速度监测', 'Output Speed Monitor')}</span>`;

    const acts = document.createElement('div');
    acts.className = 'agy-ts-pop-actions';

    if (conv?.history?.length) {
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.textContent = text('清空', 'Clear');
      clearBtn.onclick = () => {
        delete store.conversations[convId];
        saveStore();
        renderAll();
        renderPopoverContent(convId);
      };
      acts.appendChild(clearBtn);
    }
    const hideBtn = document.createElement('button');
    hideBtn.type = 'button';
    hideBtn.textContent = text('隐藏', 'Hide');
    hideBtn.title = text('可在控制中心重新开启', 'Re-enable anytime in Control Center');
    hideBtn.onclick = () => {
      closePopover();
      window.__agySuite?.save?.({ tokenSpeed: false });
    };
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', text('关闭', 'Close'));
    closeBtn.onclick = closePopover;
    acts.append(hideBtn, closeBtn);
    head.append(title, acts);

    const body = document.createElement('div');
    body.className = 'agy-ts-pop-body';

    const cur = active && !active.finished
      ? {
          tokPerSec: active.liveTokPerSec || (active.activeMs >= 200 ? round1((active.tokens * 1000) / active.activeMs) : 0),
          ttftMs: active.firstTokenAt ? Math.round(active.firstTokenAt - active.submittedAt) : Math.round(performance.now() - active.submittedAt),
          tokens: active.tokens,
          charsPerSec: active.activeMs >= 200 ? round1((active.chars * 1000) / active.activeMs) : 0,
          activeMs: Math.round(active.activeMs),
          modelName: active.modelName,
          calibrated: false,
          live: true
        }
      : conv?.lastTurn || null;

    if (cur) {
      const hero = document.createElement('div');
      hero.className = 'agy-ts-hero';
      const stats = [
        { k: cur.live ? text('实时速度', 'Live Speed') : text('本轮速度', 'Last Speed'), v: cur.tokPerSec ? `${cur.tokPerSec.toFixed(1)} tok/s` : '…', primary: true },
        { k: text('首字延迟', 'TTFT'), v: `${(cur.ttftMs / 1000).toFixed(2)}s` },
        { k: text('生成量', 'Output'), v: `${cur.tokens} tok` }
      ];
      for (const st of stats) {
        const card = document.createElement('div');
        card.className = 'agy-ts-stat' + (st.primary ? ' primary' : '');
        card.innerHTML = `<span class="agy-ts-stat-k">${st.k}</span><span class="agy-ts-stat-v">${st.v}</span>`;
        hero.appendChild(card);
      }
      body.appendChild(hero);

      const meta = document.createElement('div');
      meta.className = 'agy-ts-meta-line';
      const leftMeta = document.createElement('span');
      const parts = [];
      if (cur.charsPerSec > 0) parts.push(`${cur.charsPerSec.toFixed(0)} ${text('字/s', 'ch/s')}`);
      if (conv?.avgTokPerSec > 0) parts.push(`${text('均值', 'Avg')} ${conv.avgTokPerSec.toFixed(1)}`);
      if (conv?.peakTokPerSec > 0) parts.push(`${text('峰值', 'Peak')} ${conv.peakTokPerSec.toFixed(1)}`);
      leftMeta.textContent = parts.join(' · ') || cur.modelName;

      const rightBadge = document.createElement('span');
      rightBadge.className = 'agy-ts-badge';
      rightBadge.textContent = cur.live
        ? text('● 实时监测中', '● Live')
        : (cur.calibrated ? text('API Usage 实测', 'Verified Usage') : text('本地 Token 估算', 'Local Est.'));
      meta.append(leftMeta, rightBadge);
      body.appendChild(meta);
    } else {
      const empty = document.createElement('div');
      empty.className = 'agy-ts-empty';
      empty.textContent = text(
        '当前对话尚无已完成的生成轮次。发送一条消息后，这里将实时显示每秒输出 Token 速率 (tok/s)、首字延迟 (TTFT) 与各轮测速历史。',
        'No measured turns in this conversation yet. Send a message to record live tok/s output speed, TTFT, and per-turn history.'
      );
      body.appendChild(empty);
    }

    if (conv?.history?.length) {
      const hTitle = document.createElement('div');
      hTitle.className = 'agy-ts-hist-title';
      hTitle.textContent = text(`本对话测速记录（共 ${conv.history.length} 轮）`, `Conversation Turns (${conv.history.length})`);
      body.appendChild(hTitle);

      const list = document.createElement('div');
      list.className = 'agy-ts-hist-list';
      conv.history.slice(0, 8).forEach((item, idx) => {
        const row = document.createElement('div');
        row.className = 'agy-ts-hist-row';
        const l = document.createElement('div');
        l.className = 'agy-ts-hist-left';
        const mEl = document.createElement('span');
        mEl.className = 'agy-ts-hist-model';
        mEl.textContent = `#${conv.history.length - idx} ${item.modelName}`;
        const sEl = document.createElement('span');
        sEl.className = 'agy-ts-hist-sub';
        sEl.textContent = `${text('首字', 'TTFT')} ${(item.ttftMs / 1000).toFixed(2)}s · ${item.tokens} tok · ${(item.activeMs / 1000).toFixed(1)}s${item.calibrated ? ' ✓' : ''}`;
        l.append(mEl, sEl);
        const r = document.createElement('span');
        r.className = 'agy-ts-hist-right';
        r.textContent = `${item.tokPerSec.toFixed(1)} tok/s`;
        row.append(l, r);
        list.appendChild(row);
      });
      body.appendChild(list);
    }

    popoverEl.append(head, body);
  }

  function openPopover(anchor, convId) {
    closePopover();
    const targetAnchor = anchor || document.querySelector('.agy-ts-pill[data-agy-token-speed="true"]');
    if (!targetAnchor) return;
    popoverAnchor = targetAnchor;
    popoverConvId = convId || targetAnchor.dataset.convId || 'home';
    popoverAnchor.setAttribute('aria-expanded', 'true');
    popoverEl = document.createElement('section');
    popoverEl.id = 'agy-token-speed-popover';
    popoverEl.setAttribute('role', 'dialog');
    popoverEl.setAttribute('aria-label', text('对话输出速度详情', 'Token Output Speed Details'));
    popoverEl.setAttribute(SKIP_I18N_ATTR, 'true');
    renderPopoverContent(popoverConvId);
    document.body.appendChild(popoverEl);
    positionPopover(popoverAnchor, popoverEl);
  }

  function renderAll() {
    if (disposed) return;
    if (window.__agySuiteSettings?.tokenSpeed === false) {
      closePopover();
      document.querySelectorAll('.agy-ts-pill[data-agy-token-speed="true"]').forEach(el => el.remove());
      return;
    }
    const triggers = [...document.querySelectorAll('button[data-testid="model-selector-trigger"]')];
    for (const triggerBtn of triggers) {
      if (triggerBtn.closest('#agy-suite-backdrop, #agy-command-palette-backdrop, #agy-prompt-vault-backdrop, #agy-pinboard-backdrop')) continue;
      const composer = findComposerBox(triggerBtn);
      if (!composer) continue;
      knownComposers.add(composer);
      renderPill(triggerBtn, composer);
    }
  }

  function scheduleRender() {
    if (disposed || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      renderAll();
    });
  }

  function startTurnForComposer(composerBox, source = 'dom') {
    if (!composerBox) return;
    const triggerBtn = composerBox.querySelector('button[data-testid="model-selector-trigger"]');
    const paneRoot = findPaneRoot(composerBox);
    const convId = resolveConversationId(composerBox, paneRoot);
    const existing = paneSessions.get(composerBox);
    if (existing && !existing.finished && performance.now() - existing.submittedAt < 300) return;
    const session = createSession({ convId, composer: composerBox, triggerBtn, source });
    paneSessions.set(composerBox, session);
    if (convId === 'home') pendingHomeSession = session;
    scheduleRender();
  }

  function onDocumentKeyDown(e) {
    if (e.key === 'Escape' && popoverEl) {
      closePopover();
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    const editor = e.target?.closest?.('[data-testid="agent-input-box"] [data-lexical-editor="true"]');
    if (!editor) return;
    const composer = findComposerBox(editor);
    if (!composer || !(editor.textContent || '').trim()) return;
    if (document.querySelector('[role="listbox"], [data-testid="mention-menu"], [data-testid="slash-command-menu"]')) return;
    startTurnForComposer(composer);
  }

  function onDocumentClick(e) {
    const target = e.target;
    if (popoverEl && !target?.closest?.('#agy-token-speed-popover, .agy-ts-pill[data-agy-token-speed="true"]')) {
      closePopover();
    }
    const sendBtn = target?.closest?.('button[data-testid="send-button"], button[aria-label="发送消息"], button[aria-label="Send message"]');
    if (!sendBtn) return;
    const composer = findComposerBox(sendBtn);
    if (composer) startTurnForComposer(composer);
  }

  function onRelayStream(e) {
    const d = e?.detail;
    if (!d || !d.conversationId) return;
    const cid = String(d.conversationId);
    if (d.phase === 'start') {
      const composer = [...knownComposers].find(c => c.isConnected && resolveConversationId(c, findPaneRoot(c)) === cid)
        || document.querySelector('[data-testid="agent-input-box"]');
      const triggerBtn = composer?.querySelector('button[data-testid="model-selector-trigger"]');
      const session = createSession({ convId: cid, composer, triggerBtn, source: 'relay', modelName: d.modelName });
      relayConvSessions.set(cid, session);
      if (composer) paneSessions.set(composer, session);
      scheduleRender();
    } else if (d.phase === 'delta') {
      let session = relayConvSessions.get(cid);
      if (!session || session.finished) {
        session = createSession({ convId: cid, composer: document.querySelector('[data-testid="agent-input-box"]'), source: 'relay', modelName: d.modelName });
        relayConvSessions.set(cid, session);
      }
      if (d.kind === 'thinking') session.rawThinkingText += String(d.delta || '');
      else session.rawReplyText += String(d.delta || '');
      const combined = (session.rawThinkingText + '\n' + session.rawReplyText).trim();
      if (combined) pushTokenSample(session, estimateTokens(combined), combined.length);
      scheduleRender();
    } else if (d.phase === 'done') {
      const session = relayConvSessions.get(cid);
      if (!session || session.finished) return;
      const finalCombined = (String(d.totalThinking ?? session.rawThinkingText) + '\n' + String(d.totalText ?? session.rawReplyText)).trim();
      if (finalCombined && finalCombined.length >= session.chars) {
        pushTokenSample(session, estimateTokens(finalCombined), finalCombined.length);
      }
      session.calibratedUsage = d.usage || null;
      commitSession(session);
      relayConvSessions.delete(cid);
      scheduleRender();
    } else if (d.phase === 'abort') {
      const session = relayConvSessions.get(cid);
      if (session && !session.finished) {
        if (session.tokens > 0) commitSession(session);
        else session.finished = true;
      }
      relayConvSessions.delete(cid);
      scheduleRender();
    }
  }

  function onResize() {
    if (popoverEl && popoverAnchor?.isConnected) positionPopover(popoverAnchor, popoverEl);
  }

  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.target?.closest?.('#agy-token-speed-popover, .agy-ts-pill, #agy-suite-backdrop, #agy-command-palette-backdrop, #agy-prompt-vault-backdrop')) continue;
      scheduleRender();
      break;
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  const liveTicker = setInterval(() => {
    if (disposed) return;
    const hasActive = [...relayConvSessions.values()].some(s => !s.finished)
      || [...knownComposers].some(c => c.isConnected && paneSessions.get(c) && !paneSessions.get(c).finished);
    if (hasActive) renderAll();
  }, 180);

  window.addEventListener('keydown', onDocumentKeyDown, true);
  window.addEventListener('click', onDocumentClick, true);
  window.addEventListener('resize', onResize);
  window.addEventListener('agy-token-stream', onRelayStream);
  window.addEventListener('agy-suite-settings-updated', scheduleRender);
  scheduleRender();

  window.__agyTokenSpeed = {
    refresh: renderAll,
    getState: () => store,
    getConversationRecord: cid => store.conversations?.[cid || resolveConversationId(document.querySelector('[data-testid="agent-input-box"]'), findPaneRoot(document.querySelector('[data-testid="agent-input-box"]')))] || null,
    clearConversation: cid => {
      if (cid && store.conversations?.[cid]) {
        delete store.conversations[cid];
        saveStore();
        renderAll();
      }
    },
    openPopover: () => {
      const pill = document.querySelector('.agy-ts-pill[data-agy-token-speed="true"]');
      if (pill) openPopover(pill, pill.dataset.convId || 'home');
    },
    closePopover,
    estimateTokens
  };

  window.__agyTokenSpeedCleanup = () => {
    disposed = true;
    clearInterval(liveTicker);
    observer.disconnect();
    window.removeEventListener('keydown', onDocumentKeyDown, true);
    window.removeEventListener('click', onDocumentClick, true);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('agy-token-stream', onRelayStream);
    window.removeEventListener('agy-suite-settings-updated', scheduleRender);
    closePopover();
    pendingHomeSession = null;
    document.querySelectorAll('.agy-ts-pill[data-agy-token-speed="true"]').forEach(el => el.remove());
    style.remove();
    delete window.__agyTokenSpeed;
  };
})();
