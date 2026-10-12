/**
 * Antigravity Claude Desktop Skin — Theme Mode Switcher (白天 / 黑夜 / 跟随系统)
 * Mounts as a single clean native row inside Settings -> General (通用) / Appearance (外观)
 */
(() => {
  const STORAGE_KEY = "__agy_claude_theme_mode__";
  const WIDGET_ID = "agy-settings-skin-switcher";
  const STYLE_ID = "agy-settings-skin-switcher-style";
  let disposed = false;

  if (typeof window.__agyThemeSwitcherCleanup === "function") {
    try {
      window.__agyThemeSwitcherCleanup();
    } catch (_) {}
  }

  const originalTheme = window.__agySuiteStartupTheme || [document.documentElement,document.body].filter(Boolean).map(el=>({el,
    classes:new Map(['dark','dark-theme','theme-dark','theme-light','theme-standalone'].map(name=>[name,el.classList.contains(name)])),
    attrs:new Map(['data-claude-theme','data-claude-theme-mode','data-ag-theme-seeded'].map(name=>[name,el.getAttribute(name)]))}));
  delete window.__agySuiteStartupTheme;

  function getSavedMode() {
    if (window.__agySuiteSettings && ["light", "dark", "system"].includes(window.__agySuiteSettings.themeMode)) return window.__agySuiteSettings.themeMode;
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
        window.electronNative.setTitleBarOverlay({
          color: isDark ? "#1F1E1D" : "#FAF9F5",
          symbolColor: isDark ? "#ECE9E2" : "#3D3A34",
          height: 30
        });
      }
    } catch (_) {}
  }

  let lastAppliedOverlayTheme = null;

  function applyThemeClasses(mode) {
    if (disposed) return;
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
    syncWidgetState(targetMode);
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
      padding: 8px 12px;
      width: 100%;
      background: transparent;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      box-sizing: border-box;
    }
    .agy-ts-label {
      font-size: 14px;
      line-height: 20px;
      color: var(--foreground, inherit);
      user-select: none;
    }
    .agy-ts-seg {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      border-radius: 8px;
      background: var(--muted, rgba(20, 20, 19, 0.06));
      border: 1px solid var(--border, rgba(20, 20, 19, 0.08));
    }
    .agy-ts-btn {
      padding: 4px 12px;
      border-radius: 6px;
      border: none;
      background: transparent;
      color: var(--muted-foreground, inherit);
      font-size: 12.5px;
      font-weight: 500;
      line-height: 18px;
      cursor: pointer;
      transition: all 0.14s ease;
      white-space: nowrap;
    }
    .agy-ts-btn:hover {
      color: var(--foreground, inherit);
    }
    .agy-ts-btn.active {
      background: var(--card, #FFFFFF);
      color: var(--foreground, #141413);
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
    }
    body.theme-dark .agy-ts-btn.active,
    html.dark .agy-ts-btn.active {
      background: #35332F;
      color: #ECE9E2;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
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

  function syncWidgetState(mode) {
    const widget = document.getElementById(WIDGET_ID);
    if (!widget) return;
    const m = mode || getSavedMode();
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
      <span class="agy-ts-label">切换皮肤</span>
      <div class="agy-ts-seg" role="group" aria-label="切换皮肤">
        <button type="button" class="agy-ts-btn" data-theme-mode="light">白天</button>
        <button type="button" class="agy-ts-btn" data-theme-mode="dark">黑夜</button>
        <button type="button" class="agy-ts-btn" data-theme-mode="system">跟随系统</button>
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

  function findSettingsCardContainer() {
    const dialog = document.querySelector(".settings-modal-container");
    if (!dialog) return null;

    // Look ONLY for section <h3> headings ("通用" / "General" / "外观" / "Appearance"), never the page title <h2>
    const h3List = Array.from(dialog.querySelectorAll("h3"));
    const targetH3 = h3List.find((h) => {
      const t = (h.textContent || "").trim();
      return /^(General|通用|Appearance|外观)$/.test(t);
    });
    if (targetH3) {
      const section = targetH3.closest(".space-y-2");
      if (section) {
        const card = section.querySelector(".divide-y.divide-border") || section.querySelector(".rounded-xl.border");
        if (card) return card;
      }
    }

    // Fallback: first .divide-y.divide-border card inside settings-modal-container
    const firstCard = dialog.querySelector(".divide-y.divide-border");
    if (firstCard) return firstCard;

    return null;
  }

  function checkAndMount() {
    if (disposed) return;
    ensureStyle();
    const card = findSettingsCardContainer();
    if (!card) return;

    let widget = document.getElementById(WIDGET_ID);
    if (!widget) {
      widget = buildWidget();
    }
    if (widget.parentElement !== card || card.firstElementChild !== widget) {
      card.prepend(widget);
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
      if (disposed) return;
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
    if (disposed) return;
    disposed = true;
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
    for(const entry of originalTheme){for(const [name,present] of entry.classes)entry.el.classList.toggle(name,present);for(const [name,value] of entry.attrs){if(value===null)entry.el.removeAttribute(name);else entry.el.setAttribute(name,value);}}
    const wasDark=originalTheme.some(entry=>entry.classes.get('dark')||entry.classes.get('theme-dark')||entry.classes.get('dark-theme'));
    try{window.electronNative?.setTitleBarOverlay?.({color:wasDark?'#131313':'#FAFAFA',symbolColor:wasDark?'#FAFAFA':'#383A42',height:30});}catch{}
  };
})();
