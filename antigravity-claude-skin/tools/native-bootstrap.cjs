"use strict";
/**
 * Antigravity Claude Desktop Skin + Simplified Chinese Localization Engine
 * Native Electron Main-Process Bootstrapper (Zero-Polling, 0% Idle CPU)
 */
module.exports = function boot(resourcesDir) {
const electron = require("electron");
const fs = require("fs");
const path = require("path");

const BASE_DIR = typeof __dirname !== "undefined" ? __dirname : path.dirname(typeof __filename !== "undefined" ? __filename : ".");
const SKIN_ROOT = path.resolve(BASE_DIR, "..");
const SKIN_CSS_PATH = path.join(SKIN_ROOT, "claude-theme.css");
const I18N_JS_PATH = path.join(SKIN_ROOT, "i18n", "claude-cn-i18n.js");
const INSTALL_CORE_PATH = path.join(BASE_DIR, "install-core.js");
const SWITCHER_DAEMON_PATH = path.resolve(SKIN_ROOT, "..", "antigravity-account-switcher", "core", "daemon.mjs");
const ASAR_DIR = path.join(resourcesDir, "app.asar");
const HOOK_DIR = path.join(resourcesDir, "app");
const suiteSettings = require(path.resolve(SKIN_ROOT,'..','suite','settings.cjs'));
const flags = () => {try{return suiteSettings.readSettings();}catch{return {skin:false,i18n:false,accounts:false,api:false,guardian:false};}};
const asarPkg = JSON.parse(fs.readFileSync(path.join(ASAR_DIR, "package.json"), "utf8"));
// The external bootstrap has no ASAR byte budget. Keep debugging loopback-only.
if (!electron.app.commandLine.hasSwitch('remote-debugging-port')) electron.app.commandLine.appendSwitch('remote-debugging-port', '0');
electron.app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
try { require('./guardian-runtime.cjs').ensureGuardian(); } catch (error) { console.error('[Guardian]', error.message); }
const Module = require('node:module');
const loadJs = Module._extensions['.js'];
const policyFile = path.join(ASAR_DIR, 'dist', 'languageServer.js');
const utilsFile=path.join(ASAR_DIR,'dist','utils.js');
let legacyPreload=false;
try{legacyPreload=require('./runtime-transforms.cjs').retireLegacyPreload(fs.readFileSync(path.join(ASAR_DIR,'dist','preload.js'),'utf8')).legacy;}catch{}
Module._extensions['.js'] = function(module, filename) {
  if(legacyPreload&&path.resolve(filename)===path.resolve(utilsFile)){
    const result=require('./runtime-transforms.cjs').legacyPreloadPath(fs.readFileSync(filename,'utf8'),path.join(BASE_DIR,'legacy-preload.cjs'));
    if(result.compatible)return module._compile(result.code,filename);
    console.warn('[Suite] Legacy preload path changed; keeping original window code');
  }
  if (path.resolve(filename) !== path.resolve(policyFile)) return loadJs(module, filename);
  const source = fs.readFileSync(filename, 'utf8');
  const proxy = require('./native-proxy.cjs');
  const proxied = proxy.languageServerProxy(source);
  if(!proxied.compatible)console.warn('[Suite] Language server environment changed; keeping official networking code');
  if (flags().accounts === false) return module._compile(proxied.code,filename);
  const result = require('./runtime-transforms.cjs').languageServerPolicy(proxied.code);
  if (!result.compatible) console.warn('[Guardian] Language server restart policy changed; keeping official code');
  return module._compile(result.compatible ? result.code : proxied.code, filename);
};

// 0. Auto-start Multi-Account Switcher Local Daemon (127.0.0.1:19823)
try {
  if (fs.existsSync(SWITCHER_DAEMON_PATH)) {
    const { spawn } = require("child_process");
    const agyPaths = require("./agy-paths.cjs");
    const nodeBin = typeof agyPaths.resolveNodeBin === "function" ? agyPaths.resolveNodeBin() : "node";
    const child = spawn(nodeBin, [SWITCHER_DAEMON_PATH], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
  }
} catch (_) {}

// 1. Sync version & metadata from ../app.asar/package.json so official updates work seamlessly
try {
  const localPkgPath = path.join(HOOK_DIR, "package.json");
  const localPkg = JSON.parse(fs.readFileSync(localPkgPath, "utf8"));
  if (asarPkg.version && asarPkg.version !== localPkg.version) {
    const updated = Object.assign({}, asarPkg, { main: "index.js" });
    fs.writeFileSync(localPkgPath, JSON.stringify(updated, null, 2) + "\n", "utf8");
  }
  if (asarPkg.version && typeof electron.app.setVersion === "function") {
    electron.app.setVersion(asarPkg.version);
  }
  if (asarPkg.productName && typeof electron.app.setName === "function") {
    electron.app.setName(asarPkg.productName);
  }
} catch (err) {
  console.error("[ClaudeSkin+CN] Version sync warning:", err);
}

// 2. Hook loadingOverlay so the startup splash screen is Warm Parchment + Claude Terracotta
try {
  const loadingOverlay = require(path.join(ASAR_DIR, "dist", "loadingOverlay.js"));
  const origAttach = loadingOverlay.attachLoadingOverlay;
  if (typeof origAttach === "function") {
    loadingOverlay.attachLoadingOverlay = function (win, fg, bg) {
      if (!flags().skin) return origAttach.call(this,win,fg,bg);
      const isDark = bg === "#131313" || bg === "#1F1E1D";
      const claudeBg = isDark ? "#1F1E1D" : "#FAF9F5";
      const claudeFg = "#D97757";
      return origAttach.call(this, win, claudeFg, claudeBg);
    };
  }
} catch (err) {
  console.error("[ClaudeSkin+CN] LoadingOverlay hook warning:", err);
}

// 3. Hook Electron Native Menus, Context Menus, Tray Menus & Updater Dialogs for Simplified Chinese
const NATIVE_MENU_DICT = {
  "File": "文件",
  "Edit": "编辑",
  "View": "视图",
  "Window": "窗口",
  "Help": "帮助",
  "New Window": "新建窗口",
  "Create Project": "创建项目",
  "Command Palette": "命令面板",
  "Docs": "文档",
  "Check for Updates": "检查更新",
  "Toggle Developer Tools": "切换开发者工具",
  "Undo": "撤销",
  "Redo": "重做",
  "Cut": "剪切",
  "Copy": "复制",
  "Paste": "粘贴",
  "Select All": "全选",
  "Minimize": "最小化",
  "Maximize": "最大化",
  "Close": "关闭",
  "Zoom": "缩放",
  "Reset Zoom": "重置缩放",
  "Zoom In": "放大",
  "Zoom Out": "缩小",
  "Toggle Full Screen": "切换全屏",
  "Version": "版本",
  "About Antigravity": "关于 Antigravity",
  "Services": "服务",
  "Hide Antigravity": "隐藏 Antigravity",
  "Hide Others": "隐藏其他",
  "Show All": "显示全部",
  "Quit Antigravity": "退出 Antigravity",
  "Quit": "退出",
  "Connect to WSL": "连接至 WSL",
  "Reopen Locally": "在本地重新打开",
  "No agents running": "无运行中的智能体",
  "Open Antigravity": "打开 Antigravity",
  "Rename": "重命名",
  "Mark Unread": "标记为未读",
  "Mark Read": "标记为已读",
  "Split": "拆分",
  "Archive": "归档",
  "Delete": "删除",
  "Conversation Name": "会话名称",
  "Conversation ID": "会话 ID",
  "Project Name": "项目名称",
  "Workspace Name": "工作区名称",
  "Worktree Name": "工作树名称",
  "Split Right": "向右拆分",
  "Split Down": "向下拆分",
  "Replace With New": "替换为新会话",
  "Remove From Split": "从拆分中移除",
  "Copy File Path": "复制文件路径",
  "Copy File Name": "复制文件名称",
  "Add to Chat": "添加到聊天",
  "Copy Image": "复制图片",
  "Save Image": "保存图片"
};

function translateMenuLabel(rawLabel, itemId) {
  if (!flags().i18n) return rawLabel;
  if (typeof rawLabel !== "string" || !rawLabel) return rawLabel;
  if (itemId && /^group-(?!new$|remove$)/i.test(String(itemId))) return rawLabel;
  let label = rawLabel.trim();
  let mnemonic = "";
  let cleanLabel = label;
  const m = label.match(/&([a-zA-Z])/);
  if (m) {
    mnemonic = "(&" + m[1] + ")";
    cleanLabel = label.replace("&", "");
  }
  if (NATIVE_MENU_DICT[cleanLabel]) {
    return NATIVE_MENU_DICT[cleanLabel] + mnemonic;
  }
  if (NATIVE_MENU_DICT[label]) {
    return NATIVE_MENU_DICT[label];
  }
  if (/^Version\s*([\d.]*)$/i.test(cleanLabel)) {
    return cleanLabel.replace(/^Version\s*([\d.]*)$/i, (_match, v) => (v ? "版本 " + v : "版本"));
  }
  const agentRunMatch = cleanLabel.match(/^(\d+)\s+agents?\s+running$/i);
  if (agentRunMatch) {
    return agentRunMatch[1] + " 个智能体运行中";
  }
  return rawLabel;
}

function translateMenuItemsRecursive(items) {
  if (!Array.isArray(items)) return items;
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (typeof item.label === "string" && item.label) {
      if (!item.__origLabel) item.__origLabel = item.label;
      item.label = translateMenuLabel(item.__origLabel, item.id);
    }
    if (Array.isArray(item.submenu)) {
      translateMenuItemsRecursive(item.submenu);
    } else if (item.submenu && Array.isArray(item.submenu.items)) {
      translateMenuItemsRecursive(item.submenu.items);
    }
  }
  return items;
}

try {
  if (electron.Tray?.prototype?.setContextMenu) {
    const original = electron.Tray.prototype.setContextMenu;
    electron.Tray.prototype.setContextMenu = function(menu) {
      translateMenuItemsRecursive(menu?.items);
      return original.call(this, menu);
    };
  }
  if (electron.Menu) {
    const origBuildFromTemplate = electron.Menu.buildFromTemplate.bind(electron.Menu);
    electron.Menu.buildFromTemplate = function (template) {
      try {
        if (Array.isArray(template)) {
          translateMenuItemsRecursive(template);
        }
      } catch (_) {}
      return origBuildFromTemplate(template);
    };

    const origSetAppMenu = electron.Menu.setApplicationMenu.bind(electron.Menu);
    electron.Menu.setApplicationMenu = function (menu) {
      try {
        if (menu && Array.isArray(menu.items)) {
          translateMenuItemsRecursive(menu.items);
          if (!menu.items.__cnFindWrapped) {
            const origFind = menu.items.find.bind(menu.items);
            Object.defineProperty(menu.items, "find", {
              configurable: true,
              value: function (predicate, thisArg) {
                return origFind((item, idx, arr) => {
                  if (predicate.call(thisArg, item, idx, arr)) return true;
                  if (item && item.__origLabel) {
                    const proxy = new Proxy(item, {
                      get(target, prop) {
                        if (prop === "label") return target.__origLabel;
                        return target[prop];
                      }
                    });
                    return predicate.call(thisArg, proxy, idx, arr);
                  }
                  return false;
                });
              }
            });
            Object.defineProperty(menu.items, "__cnFindWrapped", { value: true });
          }
        }
      } catch (_) {}
      return origSetAppMenu(menu);
    };
  }
} catch (err) {
  console.error("[ClaudeSkin+CN] Menu hook warning:", err);
}

try {
  const trayMod = require(path.join(ASAR_DIR, "dist", "tray.js"));
  const origInsertTray = trayMod.insertTrayMenuItem;
  if (typeof origInsertTray === "function") {
    trayMod.insertTrayMenuItem = function (position, options) {
      if (options && typeof options.label === "string") {
        options.label = translateMenuLabel(options.label, options.id);
      }
      return origInsertTray.call(this, position, options);
    };
  }
} catch (_) {}

try {
  if (electron.dialog && typeof electron.dialog.showMessageBox === "function") {
    const origShowMessageBox = electron.dialog.showMessageBox.bind(electron.dialog);
    electron.dialog.showMessageBox = function (...args) {
      for (const arg of flags().i18n ? args : []) {
        if (arg && typeof arg === "object" && !Array.isArray(arg)) {
          if (arg.title === "Check for Updates") arg.title = "检查更新";
          if (arg.message === "No updates available") arg.message = "暂无可用更新";
          if (Array.isArray(arg.buttons)) {
            arg.buttons = arg.buttons.map(b => (b === "OK" ? "确定" : b));
          }
        }
      }
      return origShowMessageBox(...args);
    };
  }
} catch (_) {}

function getSkinInjectionScript(cssContent) {
  return `(() => {
    try {
      let style = document.getElementById('agy-claude-skin');
      if (!style) {
        style = document.createElement('style');
        style.id = 'agy-claude-skin';
        (document.head || document.documentElement).appendChild(style);
      }
      if (style.textContent !== ${JSON.stringify(cssContent)}) {
        style.textContent = ${JSON.stringify(cssContent)};
      }
      const cleanScrollbars = () => {
        document.querySelectorAll('[style*="scrollbar"]').forEach(el => {
          el.style.removeProperty('scrollbar-color');
          el.style.removeProperty('scrollbar-width');
        });
      };
      cleanScrollbars();
      if (!window.__agyClaudeObserver) {
        window.__agyClaudeObserver = new MutationObserver(() => {
          cleanScrollbars();
          if (document.head && style.parentNode !== document.head) {
            document.head.appendChild(style);
          }
        });
        window.__agyClaudeObserver.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style', 'class']
        });
      }
    } catch (e) {
      console.error('[ClaudeSkin] Renderer inject error:', e);
    }
  })()`;
}

function injectSkinAndI18nIntoWindow(win) {
  if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return;
  try {
    if (fs.existsSync(I18N_JS_PATH)) {
      const i18nJs = fs.readFileSync(I18N_JS_PATH, "utf8");
      win.webContents.executeJavaScript(i18nJs).catch(() => {});
    }
  } catch (err) {
    console.error("[ClaudeSkin+CN] Failed to inject skin/i18n:", err);
  }
}

// 4. Intercept every BrowserWindow creation for zero-flash titleBarOverlay + Skin & CN DOM injection
electron.app.on("browser-window-created", (_event, win) => {
  try {
    if (process.platform === "win32" && typeof win.setTitleBarOverlay === "function") {
      const origSetOverlay = win.setTitleBarOverlay.bind(win);
      win.setTitleBarOverlay = function (options) {
        if(!['#faf9f5','#1f1e1d','#161514'].includes(String(options?.color||'').toLowerCase()))win.__agyOriginalOverlay = options;
        if (!flags().skin) return origSetOverlay(options);
        const rawColor = String((options && options.color) || "").toLowerCase();
        if (rawColor === "#1f1e1d" || rawColor === "#161514") {
          win.__agyForceDarkOverlay = true;
        } else if (rawColor === "#faf9f5") {
          win.__agyForceDarkOverlay = false;
        }
        const isDark =
          win.__agyForceDarkOverlay !== undefined
            ? win.__agyForceDarkOverlay
            : rawColor === "#131313" || rawColor === "#181818" || rawColor === "#1f1e1d" || rawColor === "#161514";
        return origSetOverlay({
          color: isDark ? "#1F1E1D" : "#FAF9F5",
          symbolColor: isDark ? "#ECE9E2" : "#3D3A34",
          height: (options && options.height) || 30
        });
      };
      win.setTitleBarOverlay({ color: "#FAFAFA", symbolColor: "#383A42", height: 30 });
    }
    win.__agyOriginalBackground=win.getBackgroundColor?.();
    if (flags().skin && typeof win.setBackgroundColor === "function") {
      win.setBackgroundColor("#FAF9F5");
    }
    win.webContents.on("dom-ready", () => injectSkinAndI18nIntoWindow(win));
    win.webContents.on("did-finish-load", () => injectSkinAndI18nIntoWindow(win));
  } catch (err) {
    console.error("[ClaudeSkin+CN] Window hook error:", err);
  }
});

// 5. Self-heal hook on app quit (if an in-app update modified resources, re-ensure hook before exit)
let lastFlags = JSON.stringify(flags());
const suiteTimer = setInterval(() => {
  try {
    const next=JSON.stringify(flags());if(next===lastFlags)return;lastFlags=next;
    const menu=electron.Menu.getApplicationMenu();if(menu)electron.Menu.setApplicationMenu(menu);
    for(const win of electron.BrowserWindow.getAllWindows()) {
      if(win.__agyOriginalOverlay)win.setTitleBarOverlay(win.__agyOriginalOverlay);
      if(!flags().skin&&win.__agyOriginalBackground)win.setBackgroundColor?.(win.__agyOriginalBackground);
      injectSkinAndI18nIntoWindow(win);
    }
  }catch(error){console.warn('[Suite]',error.message);}
},2000);suiteTimer.unref?.();
electron.app.on("will-quit", () => {
  try {
    if (!fs.existsSync(__filename) && fs.existsSync(INSTALL_CORE_PATH)) {
      const { installNativeAppHook } = require(INSTALL_CORE_PATH);
      installNativeAppHook();
    }
  } catch (_) {}
});

// 6. Delegate to official Antigravity entry point inside app.asar
require(path.join(ASAR_DIR, asarPkg.main || "dist/main.js"));
};
