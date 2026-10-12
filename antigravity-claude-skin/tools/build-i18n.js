const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('node:crypto');

const skinRoot = path.resolve(__dirname, '..');
const i18nDir = path.join(skinRoot, 'i18n');
const dictsDir = path.join(i18nDir, 'dicts');
const repoEnginePath = path.join(skinRoot, 'i18n-repo', 'localization_engine.js');
const engineTemplatePath = path.join(i18nDir, 'engine-template.js');
const outputI18nJsPath = path.join(i18nDir, 'claude-cn-i18n.js');
const overlayDictPath = path.join(dictsDir, 'v2.22.0_overlay.json');

function normalizeText(text) {
  if (!text) return '';
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/’/g, "'")
    .replace(/‘/g, "'")
    .replace(/“/g, '"')
    .replace(/”/g, '"');
}

// Ensure v2.22.0 custom overlay dictionary exists for any newest Antigravity 2.22+ strings
function ensureOverlayDict() {
  fs.mkdirSync(dictsDir, { recursive: true });
  const defaultOverlay = {
    "Ask anything, @ to mention, / for workflows": "输入任何问题，输入 @ 提及上下文，输入 / 调用技能与工作流",
    "Ask anything...": "输入任何问题...",
    "Type a message...": "输入消息...",
    "Running command": "正在运行命令",
    "Ran command": "已运行命令",
    "Thought Process": "思考过程",
    "Thinking...": "正在思考...",
    "Proceed": "继续执行",
    "Good response": "回答得好",
    "Bad response": "回答不佳",
    "Copy response": "复制回复",
    "Edit message": "编辑消息",
    "Rerun from here": "从此处重新运行"
  };
  if (!fs.existsSync(overlayDictPath)) {
    fs.writeFileSync(overlayDictPath, JSON.stringify(defaultOverlay, null, 2) + '\n', 'utf8');
  } else {
    try {
      const existing = JSON.parse(fs.readFileSync(overlayDictPath, 'utf8'));
      const merged = Object.assign({}, defaultOverlay, existing);
      fs.writeFileSync(overlayDictPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');
    } catch (_) {}
  }
}

// Extract and persist the engine template from i18n-repo/localization_engine.js if not yet saved
function ensureEngineTemplate() {
  if (!fs.existsSync(engineTemplatePath) && fs.existsSync(repoEnginePath)) {
    const src = fs.readFileSync(repoEnginePath, 'utf8');
    const startMarker = 'const jsSource = `${SIGNATURE_START}';
    const endMarker = 'return jsSource.replace("DICT_PLACEHOLDER", dictJson).replace("REPLACEMENT_ENTRIES_PLACEHOLDER", entriesJson);';
    const sIdx = src.indexOf(startMarker);
    const eIdx = src.indexOf(endMarker);
    if (sIdx === -1 || eIdx === -1) {
      throw new Error('Could not locate generateJs template markers in localization_engine.js');
    }
    // Extract the template body inside generateJs
    const rawSlice = src.slice(sIdx, eIdx + endMarker.length);
    const moduleCode = `"use strict";
const SIGNATURE_START = "'__ANTIGRAVITY_CHINESE_LOCALIZATION_START__';";
const SIGNATURE_END = "'__ANTIGRAVITY_CHINESE_LOCALIZATION_END__';";
function buildRendererScript(dictJson, entriesJson) {
  ${rawSlice}
}
module.exports = { buildRendererScript };
`;
    fs.writeFileSync(engineTemplatePath, moduleCode, 'utf8');
  }
}

function loadDictionary() {
  const totalMap = {};
  if (fs.existsSync(dictsDir)) {
    const files = fs.readdirSync(dictsDir).filter(f => f.endsWith('.json')).sort();
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(dictsDir, file), 'utf8'));
        for (const [k, v] of Object.entries(data)) {
          const normK = normalizeText(k);
          if (normK) totalMap[normK] = v;
        }
      } catch (e) {
        console.warn('[i18n] Warning reading dict', file, e.message);
      }
    }
  }
  delete totalMap[normalizeText('Antigravity')];
  return totalMap;
}

function buildI18nBundle() {
  ensureOverlayDict();
  ensureEngineTemplate();

  const { buildRendererScript } = require(engineTemplatePath);
  const fullDict = loadDictionary();
  const longEntries = Object.entries(fullDict).sort((a, b) => b[0].length - a[0].length);

  let js = buildRendererScript(JSON.stringify(fullDict), JSON.stringify(longEntries));

  // Enhance the generated script with:
  // 1. Singleton cleanup on re-injection so hot-reload never duplicates MutationObservers
  // 2. Original text & attribute tracking so restore-default.ps1 can revert live DOM back to English instantly!
  js = js.replace(
    'const translatedValues = new WeakMap();',
    `if (typeof window !== 'undefined' && typeof window.__agyCnI18nCleanup === 'function') {
        try { window.__agyCnI18nCleanup(); } catch (_) {}
    }
    const translatedValues = new WeakMap();
    const origTextValues = (typeof window !== 'undefined' && window.__agyCnOrigTextValues) || new Map();
    const origAttrValues = (typeof window !== 'undefined' && window.__agyCnOrigAttrValues) || new Map();
    if (typeof window !== 'undefined') {
        window.__agyCnOrigTextValues = origTextValues;
        window.__agyCnOrigAttrValues = origAttrValues;
    }
    function recordOrigText(node) {
        if (node && (!origTextValues.has(node) || translatedValues.get(node) !== node.nodeValue)) {
            origTextValues.set(node, node.nodeValue);
        }
    }
    function recordOrigAttr(el, attr) {
        if (!el || !attr) return;
        let attrMap = origAttrValues.get(el);
        if (!attrMap) {
            attrMap = new Map();
            origAttrValues.set(el, attrMap);
        }
        if (!attrMap.has(attr)) {
            attrMap.set(attr, el.getAttribute(attr));
        }
    }`
  );

  // Hook replaceTextNode to record original English text before mutating
  js = js.replace(
    `function replaceTextNode(node, value) {
        if (!node) return false;
        translatedValues.set(node, value);
        if (node.nodeValue === value) return false;
        node.nodeValue = value;
        return true;
    }`,
    `function replaceTextNode(node, value) {
        if (!node) return false;
        recordOrigText(node);
        translatedValues.set(node, value);
        if (node.nodeValue === value) return false;
        node.nodeValue = value;
        return true;
    }`
  );

  // Hook direct node.nodeValue assignment at end of translateNode
  js = js.replace(
    `if (newVal !== originalVal) {
                    translatedValues.set(node, newVal);
                    node.nodeValue = newVal;
                }`,
    `if (newVal !== originalVal) {
                    recordOrigText(node);
                    translatedValues.set(node, newVal);
                    node.nodeValue = newVal;
                }`
  );

  // Hook attribute replacements to record original attribute value
  js = js.replace(
    /if \(target && target !== value\) node\.setAttribute\(attr, target\);/g,
    'if (target && target !== value) { recordOrigAttr(node, attr); node.setAttribute(attr, target); }'
  );
  js = js.replace(
    /if \(target && target !== v\) node\.setAttribute\(attr, target\);/g,
    'if (target && target !== v) { recordOrigAttr(node, attr); node.setAttribute(attr, target); }'
  );
  js = js.replace(
    /if \(searchingTrans && searchingTrans !== v\) \{\s*node\.setAttribute\(attr, searchingTrans\);/g,
    'if (searchingTrans && searchingTrans !== v) { recordOrigAttr(node, attr); node.setAttribute(attr, searchingTrans);'
  );

  // Add cleanup & live restore hooks before the IIFE closes
  js = js.replace(
    `if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startEngine);
    } else {
        startEngine();
    }
    window.addEventListener('load', startEngine);`,
    `if (typeof window !== 'undefined') {
        window.__agyCnI18nActive = true;
        window.__agyCnRetranslate = () => {
            try { translateNode(document.body || document.documentElement); } catch (_) {}
        };
        window.__agyCnI18nCleanup = () => {
            try { observer.disconnect(); } catch (_) {}
            document.removeEventListener('DOMContentLoaded', startEngine);
            window.removeEventListener('load', startEngine);
            try { Element.prototype.attachShadow = origAttachShadow; } catch (_) {}
            window.__agyCnI18nActive = false;
        };
        window.__agyCnRestore = () => {
            try {
                if (window.__agyCnI18nCleanup) window.__agyCnI18nCleanup();
                for (const [node, origVal] of origTextValues.entries()) {
                    try {
                        if (node && node.nodeValue !== origVal) {
                            node.nodeValue = origVal;
                        }
                    } catch (_) {}
                }
                origTextValues.clear();
                for (const [el, attrMap] of origAttrValues.entries()) {
                    try {
                        for (const [attr, origVal] of attrMap.entries()) {
                            if (origVal !== null && origVal !== undefined) {
                                el.setAttribute(attr, origVal);
                            }
                        }
                    } catch (_) {}
                }
                origAttrValues.clear();
            } catch (_) {}
        };
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startEngine);
    } else {
        startEngine();
    }
    window.addEventListener('load', startEngine);`
  );

  // Localization is independent of theme decorations.
  js = js.replace('function mountClaudeStartPageHero() {', 'function mountClaudeStartPageHero() { return;');
  js = `window.__agySuiteModules={i18n:function(){\n${js}\n}};`;
  // Modules are definitions, not unconditional side effects.
  const switcherInjectorPath = path.resolve(skinRoot, '..', 'antigravity-account-switcher', 'core', 'settings-injector.js');
  if (fs.existsSync(switcherInjectorPath)) {
    js += '\nwindow.__agySuiteModules.accounts=function(){\n' + fs.readFileSync(switcherInjectorPath, 'utf8') + '\n' + fs.readFileSync(path.join(path.dirname(switcherInjectorPath),'quota-badge.js'),'utf8') + '\n};';
  }

  // Append Native Chat Model Selector + Seamless Relay Switcher widget if present
  const modelInjectorPath = path.resolve(skinRoot, '..', 'antigravity-model-switcher', 'core', 'chat-injector.js');
  if (fs.existsSync(modelInjectorPath)) {
    js += '\nwindow.__agySuiteModules.api=function(){\n' + fs.readFileSync(modelInjectorPath, 'utf8') + '\n};';
  }

  // Main hooks, legacy preloads and the guardian can reach the same renderer.
  // Do not tear down a live relay or re-mount identical code on repeated injection.
  js += `\nwindow.__agyProviderPresets=${fs.readFileSync(path.join(skinRoot,'..','antigravity-model-switcher','core','provider-presets.json'),'utf8')};\n`;
  js += `\nwindow.__agySuiteTheme=${JSON.stringify(fs.readFileSync(path.join(skinRoot,'claude-theme.css'),'utf8'))};\n`;
  const themeSwitcherPath = path.join(skinRoot, 'src', 'theme-switcher.js');
  if (fs.existsSync(themeSwitcherPath)) {
    js += '\n;\n' + fs.readFileSync(themeSwitcherPath, 'utf8') + '\n';
  }
  js += fs.readFileSync(path.join(skinRoot,'..','suite','control-center.js'),'utf8');
  const bundleId = crypto.createHash('sha256').update(js).digest('hex');
  js = `(()=>{if(window.__agyRendererBundleId===${JSON.stringify(bundleId)}&&window.__agySuite)return;if(window.__AGY_MODEL_SWITCHER?.getState().isSendingCustomChat)return;\n${js}\nwindow.__agyRendererBundleId=${JSON.stringify(bundleId)};})();`;

  // Verify syntax with vm.Script
  new vm.Script(js);

  fs.writeFileSync(outputI18nJsPath, js, 'utf8');
  console.log('[i18n] Built claude-cn-i18n.js (' + ( Buffer.byteLength(js) / 1024 ).toFixed(1) + ' KB, ' + Object.keys(fullDict).length + ' dictionary entries)');
  return outputI18nJsPath;
}

buildI18nBundle();

module.exports = { buildI18nBundle };

