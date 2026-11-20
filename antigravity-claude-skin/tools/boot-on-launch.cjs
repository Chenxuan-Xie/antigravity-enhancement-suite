'use strict';
/**
 * Antigravity v2.33.0+ 外部启动辅助进程：
 * 1. 确保账号/模型切换守护进程 (127.0.0.1:19823) 与自愈守护（按设置开启）就绪；
 * 2. 等待由 launch.cjs 开启的 --remote-debugging-port=0 就绪后，立即通过 CDP 注入前端套件并退出。
 */
const fs = require('node:fs');
const path = require('node:path');
const { injectLiveViaCdp } = require('./install-core');
const { ensureGuardian, ensureSwitcherDaemon } = require('./guardian-runtime.cjs');

const DEFAULT_PORT_FILE = process.env?.APPDATA ? path.join(process.env.APPDATA, 'Antigravity', 'DevToolsActivePort') : '';

function waitMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function bootOnLaunch(options = {}) {
  const sleep = options.sleep || waitMs;
  const inject = options.injectLiveViaCdp || injectLiveViaCdp;
  const startDaemon = options.ensureSwitcherDaemon || ensureSwitcherDaemon;
  const startGuardian = options.ensureGuardian || ensureGuardian;
  const portFile = options.portFile || DEFAULT_PORT_FILE;
  const startedAt = Number(options.startedAt || Date.now());
  const maxAttempts = Number(options.maxAttempts || 100);
  const intervalMs = Number(options.intervalMs || 250);
  const settleMs = Number(options.settleMs ?? 1500);

  try { await startDaemon(); } catch {}
  try { startGuardian(); } catch {}

  let attached = false;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let portFileFresh = false;
    try {
      if (portFile && fs.existsSync(portFile)) {
        portFileFresh = fs.statSync(portFile).mtimeMs >= startedAt - 5000;
      }
    } catch {}
    // 优先复用刚写入的 DevToolsActivePort，避免启动初期频繁唤醒 PowerShell 扫描。
    const noScan = !portFileFresh && attempt % 12 !== 10;
    try {
      const result = await inject({ onlyIfMissing: true, ignoreCache: true, noScan });
      if (result && (result.injected > 0 || result.present > 0)) {
        attached = true;
        break;
      }
    } catch {}
    await sleep(intervalMs);
  }

  if (attached && settleMs > 0) {
    // 初始加载界面跳转到正式 HostBridge 端口后，再确认补注一次新页面。
    await sleep(settleMs);
    try { await inject({ onlyIfMissing: true, ignoreCache: true }); } catch {}
  }
  return { attached };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const startedAtArg = args.find(arg => arg.startsWith('--started-at='));
  const startedAt = startedAtArg ? Number(startedAtArg.split('=')[1]) : Date.now();
  bootOnLaunch({ startedAt }).catch(() => { process.exitCode = 1; });
}

module.exports = { bootOnLaunch };
