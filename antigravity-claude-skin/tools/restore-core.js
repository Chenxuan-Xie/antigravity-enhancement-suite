const fs = require('fs');
const path = require('path');
const http = require('http');

const os = require('os');
const { skinRoot, resolveResourcesDir } = require('./agy-paths.cjs');
const resourcesDir = resolveResourcesDir();
const appHookDir = path.join(resourcesDir, 'app');
const backupDir = path.join(skinRoot, 'backup');
const pidFile = path.join(backupDir, 'daemon.pid');
const configPath = path.join(process.env.USERPROFILE || os.homedir(), '.gemini', 'config', 'config.json');

function stopDaemon() {
  if (fs.existsSync(pidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
      if (require('./guardian-runtime.cjs').guardianAlive(pid)) {
        process.kill(pid);
        console.log('[Restore] Stopped Auto-Heal Daemon (PID ' + pid + ')');
      }
    } catch (_) {}
    try {
      fs.unlinkSync(pidFile);
    } catch (_) {}
  }
}

function removeNativeHook() {
  if (fs.existsSync(appHookDir)) {
    fs.rmSync(appHookDir, { recursive: true, force: true });
    console.log('[Restore] Removed native Electron hook directory:', appHookDir);
  }
  // External bootstrap never modifies ASAR. Do not restore an older archive after an update.
  const appStoragePath = path.join(process.env.APPDATA, 'Antigravity', 'app_storage.json');
  if (fs.existsSync(appStoragePath)) {
    try {
      const obj = JSON.parse(fs.readFileSync(appStoragePath, 'utf8'));
      delete obj.__agy_claude_css__;
      delete obj.__agy_claude_i18n__;
      fs.writeFileSync(appStoragePath, JSON.stringify(obj, null, 2), 'utf8');
    } catch (_) {}
  }
}

function restoreConfig() {
  const configBak = path.join(backupDir, 'config.json.bak');
  if (fs.existsSync(configBak)) {
    fs.copyFileSync(configBak, configPath);
    console.log('[Restore] Restored original config.json from backup');
  }
}

async function removeLiveViaCdp() {
  try {
    const { targets } = await require('./cdp-discovery.cjs').discoverCdp();
    const pageTarget = targets.find(t => t.type === 'page') || targets[0];
    if (!pageTarget) return;

    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });

    await new Promise((resolve) => {
      const id = 1;
      ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id === id) resolve(msg.result);
      });
      ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: {
          expression: `(() => {
            try {
              localStorage.removeItem('__agy_claude_css__');
              localStorage.removeItem('__agy_claude_i18n__');
            } catch (e) {}
            if (window.__agyClaudeObserver) {
              window.__agyClaudeObserver.disconnect();
              delete window.__agyClaudeObserver;
            }
            const style = document.getElementById('agy-claude-skin');
            if (style) style.remove();
            if (typeof window.__agyCnRestore === 'function') {
              window.__agyCnRestore();
            }
            if (window.electronNative && typeof window.electronNative.setTitleBarOverlay === 'function') {
              const isDark = document.body.classList.contains('theme-dark');
              window.electronNative.setTitleBarOverlay({
                color: isDark ? '#131313' : '#FAFAFA',
                symbolColor: isDark ? '#FAFAFA' : '#383A42',
                height: 30
              });
            }
            return 'restored';
          })()`,
          returnByValue: true
        }
      }));
    });
    ws.close();
    console.log('[Restore] Live-removed Claude skin and reverted CN localization from running Antigravity window!');
  } catch (err) {
    console.log('[Restore] Live CDP restore skipped:', err.message);
  }
}

async function main() {
  stopDaemon();
  removeNativeHook();
  restoreConfig();
  await removeLiveViaCdp();
  console.log('[Restore] Antigravity has been 100% restored to stock default appearance and English UI.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
