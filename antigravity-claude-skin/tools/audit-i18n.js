const fs = require('fs');
const path = require('path');
const http = require('http');

const skinRoot = path.resolve(__dirname, '..');
const inspectDir = path.join(skinRoot, 'inspect');
const artifactDir = path.join(skinRoot, 'inspect');

async function main() {
  const { targets } = await require('./cdp-discovery.cjs').discoverCdp();
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  const callCdp = (method, params, id) => new Promise((resolve) => {
    const handler = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === id) {
        ws.removeEventListener('message', handler);
        resolve(msg.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });

  const auditRes = await callCdp('Runtime.evaluate', {
    expression: `(() => {
      const translatedTextSamples = [];
      if (window.__agyCnOrigTextValues) {
        for (const [node, orig] of window.__agyCnOrigTextValues.entries()) {
          if (node && node.isConnected) {
            translatedTextSamples.push({ from: orig.trim(), to: (node.nodeValue || '').trim() });
          }
        }
      }
      const translatedAttrSamples = [];
      if (window.__agyCnOrigAttrValues) {
        for (const [el, attrMap] of window.__agyCnOrigAttrValues.entries()) {
          if (el && el.isConnected) {
            for (const [attr, orig] of attrMap.entries()) {
              translatedAttrSamples.push({ attr, from: orig, to: el.getAttribute(attr) });
            }
          }
        }
      }

      // Check remaining visible English UI text outside of .prose, user-input-step, code, pre
      const remainingUiStrings = new Set();
      const walk = (n) => {
        if (!n) return;
        if (n.nodeType === 1) {
          if (n.closest && (n.closest('.prose') || n.closest('[data-testid="user-input-step"]') || n.closest('pre') || n.closest('code') || n.closest('style') || n.closest('script'))) {
            return;
          }
          for (const a of ['placeholder', 'aria-label', 'title', 'data-placeholder']) {
            const v = n.getAttribute && n.getAttribute(a);
            if (v && /[A-Za-z]{3,}/.test(v) && !/[\\u4e00-\\u9fff]/.test(v)) {
              remainingUiStrings.add('[ATTR:' + a + '] ' + v.trim());
            }
          }
        }
        if (n.nodeType === 3) {
          const v = (n.nodeValue || '').trim();
          if (v && v.length <= 100 && /[A-Za-z]{3,}/.test(v) && !/[\\u4e00-\\u9fff]/.test(v)) {
            const p = n.parentElement;
            if (p && !p.closest('.prose') && !p.closest('[data-testid="user-input-step"]') && !p.closest('pre') && !p.closest('code')) {
              remainingUiStrings.add(v);
            }
          }
        }
        if (n.childNodes) n.childNodes.forEach(walk);
      };
      walk(document.body);

      const bodyStyle = getComputedStyle(document.body);
      const proseEl = document.querySelector('.prose');
      const proseStyle = proseEl ? getComputedStyle(proseEl) : null;

      return {
        hasSkinStyleTag: Boolean(document.getElementById('agy-claude-skin')),
        i18nActive: Boolean(window.__agyCnI18nActive),
        translatedTextCount: translatedTextSamples.length,
        translatedAttrCount: translatedAttrSamples.length,
        translatedTextSamples: translatedTextSamples.slice(0, 50),
        translatedAttrSamples: translatedAttrSamples.slice(0, 40),
        remainingUiStrings: Array.from(remainingUiStrings).slice(0, 80),
        skinCheck: {
          bodyBg: bodyStyle.backgroundColor,
          bodyColor: bodyStyle.color,
          proseFontFamily: proseStyle ? proseStyle.fontFamily : null
        }
      };
    })()`,
    returnByValue: true
  }, 1);

  console.log(JSON.stringify(auditRes.result.value, null, 2));

  // Capture screenshot of current localized + skinned view
  const shot = await callCdp('Page.captureScreenshot', { format: 'png' }, 2);
  const shotBuf = Buffer.from(shot.data, 'base64');
  const inspectShotPath = path.join(inspectDir, 'round5-cn-i18n.png');
  const artifactShotPath = path.join(artifactDir, 'round5-cn-i18n.png');
  fs.writeFileSync(inspectShotPath, shotBuf);
  fs.writeFileSync(artifactShotPath, shotBuf);
  ws.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
