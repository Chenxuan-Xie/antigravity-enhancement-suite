/**
 * Antigravity Claude Desktop Skin — Theme Mode Switcher (白天 / 黑夜 / 跟随系统)
 * Supports real-time zero-reload switching between:
 *  - 'light'  : Claude Warm Parchment (白天 · 浅色羊皮纸 #FAF9F5)
 *  - 'dark'   : Claude Warm Charcoal  (黑夜 · 深色暖炭黑 #1F1E1D)
 *  - 'system' : Follow OS prefers-color-scheme (跟随系统自动切换)
 */
(() => {
  const STORAGE_KEY = "__agy_claude_theme_mode__";
  const WIDGET_ID = "agy-settings-skin-switcher";
  const STYLE_ID = "agy-settings-skin-switcher-style";

  if (typeof window.__agyThemeSwitcherCleanup === "function") {
    try {
      window.__agyThemeSwitcherCleanup();
    } catch (_) {}
  }

  function getSavedMode() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "light" || saved === "dark" || saved === "system") {
        return saved;
      }
    } catch (_) {}
    if (window.__agySuiteSettings && ["light", "dark", "system"].includes(window.__agySuiteSettings.themeMode)) {
      return window.__agySuiteSettings.themeMode;
    }
    return "light";
  }

  function isSystemDark() {
    try {
      return Boolean(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    } catch (_) {
      return false;
    }
  }

  function resolveIsDark(mode) {
    const m = mode || getSavedMode();
    if (m === "dark") return true;
    if (m === "light") return false;
    return isSystemDark();
  }

  function toggleClassIfChanged(el, cls, force) {
    if (!el || !el.classList) return;
    if (el.classList.contains(cls) !== Boolean(force)) {
      el.classList.toggle(cls, Boolean(force));
    }
  }

  function updateTitleBarOverlay(isDark) {
    try {
      if (window.electronNative && typeof window.electronNative.setTitleBarOverlay === "function") {
        const orig = window.electronNative.__origSetTitleBarOverlay || window.electronNative.setTitleBarOverlay.bind(window.electronNative);
        if (!window.electronNative.__origSetTitleBarOverlay) {
          window.electronNative.__origSetTitleBarOverlay = orig;
          window.electronNative.setTitleBarOverlay = function (opts) {
            const darkNow = resolveIsDark(getSavedMode());
            return orig({
              color: darkNow ? "#1F1E1D" : "#FAF9F5",
              symbolColor: darkNow ? "#ECE9E2" : "#3D3A34",
              height: (opts && opts.height) || 30
            });
          };
        }
        orig({
          color: isDark ? "#1F1E1D" : "#FAF9F5",
          symbolColor: isDark ? "#ECE9E2" : "#3D3A34",
          height: 30
        });
      }
    } catch (_) {}
  }

  let lastAppliedOverlayTheme = null;

  function applyThemeClasses(mode) {
    const targetMode = mode || getSavedMode();
    const isDark = resolveIsDark(targetMode);
    const root = document.documentElement;
    const body = document.body;

    if (root) {
      toggleClassIfChanged(root, "dark", isDark);
      toggleClassIfChanged(root, "theme-dark", isDark);
      toggleClassIfChanged(root, "theme-light", !isDark);
      const nextThemeStr = isDark ? "dark" : "light";
      if (root.dataset.claudeTheme !== nextThemeStr) root.dataset.claudeTheme = nextThemeStr;
      if (root.dataset.claudeThemeMode !== targetMode) root.dataset.claudeThemeMode = targetMode;
      if (root.dataset.agThemeSeeded !== nextThemeStr) root.dataset.agThemeSeeded = nextThemeStr;
    }
    if (body) {
      toggleClassIfChanged(body, "theme-standalone", true);
      toggleClassIfChanged(body, "dark", isDark);
      toggleClassIfChanged(body, "dark-theme", isDark);
      toggleClassIfChanged(body, "theme-dark", isDark);
      toggleClassIfChanged(body, "theme-light", !isDark);
    }
    if (lastAppliedOverlayTheme !== isDark) {
      lastAppliedOverlayTheme = isDark;
      updateTitleBarOverlay(isDark);
    }
    syncWidgetState(targetMode, isDark);
  }

  function setThemeMode(mode, options = {}) {
    if (mode !== "light" && mode !== "dark" && mode !== "system") return;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch (_) {}
    lastAppliedOverlayTheme = null;
    applyThemeClasses(mode);
    if (!options.fromSuite && window.__agySuite && typeof window.__agySuite.save === "function") {
      try {
        window.__agySuite.save({ themeMode: mode });
      } catch (_) {}
    }
  }

  const css = `
    #${WIDGET_ID} {
      margin: 0 0 16px 0;
      padding: 14px 18px;
      border-radius: 12px;
      border: 1px solid rgba(20, 20, 19, 0.11);
      background: rgba(255, 255, 255, 0.78);
      color: #141413;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.03);
      transition: background-color 0.18s ease, border-color 0.18s ease, color 0.18s ease;
    }
    body.theme-dark #${WIDGET_ID},
    html.dark #${WIDGET_ID} {
      background: rgba(40, 39, 37, 0.88);
      border-color: rgba(236, 233, 226, 0.13);
      color: #ECE9E2;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    }
    #${WIDGET_ID} * {
      box-sizing: border-box;
    }
    .agy-ts-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
    }
    .agy-ts-info {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 200px;
      flex: 1;
    }
    .agy-ts-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 600;
      margin: 0;
    }
    .agy-ts-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #D97757;
      box-shadow: 0 0 0 3px rgba(217, 119, 87, 0.18);
      flex-shrink: 0;
    }
    .agy-ts-badge {
      font-size: 11px;
      font-weight: 500;
      padding: 1px 8px;
      border-radius: 999px;
      background: rgba(217, 119, 87, 0.13);
      color: #D97757;
      border: 1px solid rgba(217, 119, 87, 0.28);
    }
    .agy-ts-sub {
      font-size: 12px;
      opacity: 0.72;
      margin: 0;
      line-height: 1.45;
    }
    .agy-ts-seg {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      border-radius: 10px;
      background: rgba(20, 20, 19, 0.055);
      border: 1px solid rgba(20, 20, 19, 0.08);
    }
    body.theme-dark .agy-ts-seg,
    html.dark .agy-ts-seg {
      background: rgba(20, 19, 18, 0.65);
      border-color: rgba(236, 233, 226, 0.10);
    }
    .agy-ts-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 7px;
      border: 1px solid transparent;
      background: transparent;
      color: inherit;
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
      opacity: 0.78;
    }
    .agy-ts-btn:hover {
      opacity: 1;
      background: rgba(217, 119, 87, 0.08);
    }
    .agy-ts-btn.active {
      opacity: 1;
      font-weight: 600;
      background: #FAF9F5;
      color: #141413;
      border-color: rgba(217, 119, 87, 0.45);
      box-shadow: 0 1px 4px rgba(20, 20, 19, 0.08);
    }
    body.theme-dark .agy-ts-btn.active,
    html.dark .agy-ts-btn.active {
      background: #2E2C29;
      color: #ECE9E2;
      border-color: #D97757;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
    }
    .agy-ts-btn svg {
      width: 14px;
      height: 14px;
      color: #D97757;
      flex-shrink: 0;
    }
    .agy-ts-swatch {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
      flex-shrink: 0;
    }
    .agy-ts-swatch-light {
      background: #FAF9F5;
      border: 1.5px solid #B5AEA0;
    }
    .agy-ts-swatch-dark {
      background: #1F1E1D;
      border: 1.5px solid #D97757;
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

  function syncWidgetState(mode, isDark) {
    const widget = document.getElementById(WIDGET_ID);
    if (!widget) return;
    const m = mode || getSavedMode();
    const dark = typeof isDark === "boolean" ? isDark : resolveIsDark(m);
    const badge = widget.querySelector('[data-ts-role="badge"]');
    if (badge) {
      const modeLabel = m === "light" ? "白天模式" : m === "dark" ? "黑夜模式" : "跟随系统";
      const skinLabel = dark ? "暖炭黑深色" : "羊皮纸浅色";
      const nextText = `${modeLabel} · ${skinLabel}`;
      if (badge.textContent !== nextText) {
        badge.textContent = nextText;
      }
    }
    widget.querySelectorAll("[data-theme-mode]").forEach((btn) => {
      const btnMode = btn.getAttribute("data-theme-mode");
      const isActive = btnMode === m;
      toggleClassIfChanged(btn, "active", isActive);
      const nextPressed = String(isActive);
      if (btn.getAttribute("aria-pressed") !== nextPressed) {
        btn.setAttribute("aria-pressed", nextPressed);
      }
    });
  }

  function buildWidget() {
    const root = document.createElement("div");
    root.id = WIDGET_ID;
    root.setAttribute("data-ag-i18n-skip", "true");
    root.setAttribute("data-ag-localization-skip", "true");
    root.innerHTML = `
      <div class="agy-ts-row">
        <div class="agy-ts-info">
          <div class="agy-ts-title">
            <span class="agy-ts-dot"></span>
            <span>切换皮肤（Claude 书卷双色主题）</span>
            <span class="agy-ts-badge" data-ts-role="badge">白天模式 · 羊皮纸浅色</span>
          </div>
          <p class="agy-ts-sub">在 Claude 经典浅色羊皮纸（#FAF9F5）与深色暖炭黑（#1F1E1D）之间实时切换，共享人文衬线排版</p>
        </div>
        <div class="agy-ts-seg" role="group" aria-label="切换皮肤模式">
          <button type="button" class="agy-ts-btn" data-theme-mode="light" title="浅色羊皮纸书卷风 (#FAF9F5)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
            <span>白天</span>
            <span class="agy-ts-swatch agy-ts-swatch-light"></span>
          </button>
          <button type="button" class="agy-ts-btn" data-theme-mode="dark" title="深色暖炭黑书卷风 (#1F1E1D)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
            <span>黑夜</span>
            <span class="agy-ts-swatch agy-ts-swatch-dark"></span>
          </button>
          <button type="button" class="agy-ts-btn" data-theme-mode="system" title="跟随 Windows 系统深浅色自动切换">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
            <span>跟随系统</span>
          </button>
        </div>
      </div>
    `;

    root.querySelectorAll("[data-theme-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.getAttribute("data-theme-mode");
        setThemeMode(mode);
      });
    });

    return root;
  }

  function findSettingsMountTarget() {
    const dialog = document.querySelector(".settings-modal-container");
    if (dialog) {
      const headings = Array.from(dialog.querySelectorAll("h2, h3"));
      const targetHeading = headings.find((h) => {
        const t = (h.textContent || "").trim();
        return /^(General|通用|Appearance|外观|Account|账号|账户)$/.test(t);
      });
      if (targetHeading) {
        const sectionWrap = targetHeading.closest(".space-y-2") || targetHeading.parentElement;
        if (sectionWrap && sectionWrap.parentElement) {
          return { parent: sectionWrap.parentElement, before: sectionWrap };
        }
      }
      const scroller = Array.from(dialog.querySelectorAll("div")).find(
        (el) =>
          el.classList.contains("overflow-y-auto") &&
          !el.querySelector('[data-testid^="settings-nav-item-"]')
      );
      if (scroller) {
        return { parent: scroller, before: scroller.firstChild };
      }
    }

    const accSwitcher = document.getElementById("agy-settings-account-switcher");
    if (accSwitcher && accSwitcher.parentElement) {
      return { parent: accSwitcher.parentElement, before: accSwitcher };
    }

    return null;
  }

  function checkAndMount() {
    ensureStyle();
    const target = findSettingsMountTarget();
    if (!target || !target.parent) return;

    let widget = document.getElementById(WIDGET_ID);
    if (!widget) {
      widget = buildWidget();
    }
    if (!target.parent.contains(widget)) {
      if (target.before && target.before.parentNode === target.parent) {
        target.parent.insertBefore(widget, target.before);
      } else {
        target.parent.prepend(widget);
      }
    }
    syncWidgetState();
  }

  applyThemeClasses(getSavedMode());
  checkAndMount();

  let mediaQuery = null;
  const onSystemThemeChange = () => {
    if (getSavedMode() === "system") {
      lastAppliedOverlayTheme = null;
      applyThemeClasses("system");
    }
  };
  try {
    if (window.matchMedia) {
      mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
      mediaQuery.addEventListener("change", onSystemThemeChange);
    }
  } catch (_) {}

  let rafScheduled = false;
  const observer = new MutationObserver(() => {
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      applyThemeClasses(getSavedMode());
      checkAndMount();
    });
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  window.__AGY_THEME_SWITCHER = {
    getMode: getSavedMode,
    setMode: setThemeMode,
    getResolvedTheme: () => (resolveIsDark(getSavedMode()) ? "dark" : "light"),
    applyTheme: applyThemeClasses
  };

  window.__agyThemeSwitcherCleanup = () => {
    try {
      observer.disconnect();
    } catch (_) {}
    try {
      if (mediaQuery) mediaQuery.removeEventListener("change", onSystemThemeChange);
    } catch (_) {}
    const w = document.getElementById(WIDGET_ID);
    if (w) w.remove();
    const s = document.getElementById(STYLE_ID);
    if (s) s.remove();
  };
})();
