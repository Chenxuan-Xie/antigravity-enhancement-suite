'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const winPath = path.win32;
let checks = 0;
function check(value, message) { assert(value, message); checks++; console.log('PASS ' + message); }
const oldDir = 'D:\\old-app\\resources', updatedDir = 'C:\\updated-app\\resources';

function pathsFixture() {
  let cache = { resourcesDir: oldDir }, detected = 'C:\\updated-app', now = 0, probes = 0;
  const valid = new Set([oldDir, updatedDir, 'E:\\pinned\\resources']);
  const proc = { platform: 'win32', env: {}, execPath: 'D:\\node\\node.exe' };
  const fakeFs = {
    existsSync: file => file.endsWith('install-paths.json') || valid.has(winPath.dirname(file)),
    readFileSync: () => JSON.stringify(cache),
    mkdirSync() {}, writeFileSync: (_file, value) => { cache = JSON.parse(value); }
  };
  const context = { module: { exports: {} }, __dirname: 'D:\\suite\\antigravity-claude-skin\\tools', process: proc,
    Date: class extends Date { static now() { return now; } },
    require: name => name === 'node:fs' ? fakeFs : name === 'node:path' ? winPath : name === 'node:os' ? { homedir: () => 'C:\\Users\\demo' } : {
      execFileSync: (_bin, args) => {
        probes++;
        check(args.includes('-NonInteractive') && args.at(-1).includes('--type='), 'discovery checks the main app and runs without an interactive shell');
        return detected;
      }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'agy-paths.cjs'), 'utf8'), context);
  return { resolve: context.module.exports.resolveResourcesDir, proc, cache: () => cache, probes: () => probes,
    setDetected: value => { detected = value; }, advance: () => { now += 31000; } };
}

async function main() {
  const f = pathsFixture();
  f.proc.env.AGY_APP_DIR = 'E:\\pinned';
  check(f.resolve() === 'E:\\pinned\\resources' && !f.probes(), 'explicit install location takes precedence');
  delete f.proc.env.AGY_APP_DIR;
  f.proc.resourcesPath = updatedDir;
  check(f.resolve() === updatedDir && !f.probes(), 'Electron uses its own updated resources rather than the old valid cache');
  delete f.proc.resourcesPath;
  const moved = pathsFixture();
  check(moved.resolve() === updatedDir && moved.cache().resourcesDir === updatedDir, 'running or shortcut installation replaces a stale but still valid directory');
  const probeCount = moved.probes(); moved.resolve();
  check(moved.probes() === probeCount, 'repeated lookups share the discovery probe');
  moved.setDetected('E:\\pinned'); moved.advance();
  check(moved.resolve() === 'E:\\pinned\\resources', 'long-running processes discover subsequent installation changes');
  moved.setDetected('Z:\\missing');
  check(moved.resolve({ refresh: true }) === 'E:\\pinned\\resources', 'invalid detected installation falls back to the last valid location');

  // A directory change must reset stability even when both ASARs have identical metadata.
  let resources = oldDir, now = 0;
  let manifest = { runtime: winPath.resolve('D:\\suite'), resourcesDir: oldDir };
  const installs = [], watchers = [];
  const fakeFs = { existsSync: () => true, statSync: () => ({ size: 4096, mtimeMs: 1 }),
    readFileSync: () => JSON.stringify(manifest), mkdirSync() {}, appendFileSync() {},
    watch: dir => { const watcher = { dir, on() {}, close() { this.closed = true; } }; watchers.push(watcher); return watcher; }
  };
  const module = { exports: {} };
  const context = { module, __dirname: 'D:\\suite\\antigravity-claude-skin\\tools', process: { pid: 1 }, console,
    Date: class extends Date { static now() { return now; } }, clearTimeout, setTimeout,
    require: name => name === 'node:fs' ? fakeFs : name === 'node:path' ? winPath : name === './agy-paths.cjs' ? { resolveResourcesDir: () => resources } :
      name === './guardian-runtime.cjs' ? { ensureSwitcherDaemon: async () => ({ running: true }) } : name === './install-core' ? {
        installNativeAppHook: options => { installs.push(options.resourcesDir); return { changed: false }; }, injectLiveViaCdp: async () => ({ injected: 0 }),
        writeIfChanged: (file, value) => { if (file.endsWith('install-manifest.json')) manifest = JSON.parse(value); }
      } : { readSettings: () => ({ guardian: true }), installDesktopLauncher: () => ({ changed: false }) }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'auto-heal-daemon.js'), 'utf8'), context);
  await module.exports.tick(); now += 1600; await module.exports.tick();
  check(installs[0] === oldDir, 'guardian waits for the original archive to stabilize');
  resources = updatedDir; await module.exports.tick();
  check(installs.length === 1 && watchers.filter(w => w.dir.startsWith('D:\\old-app')).every(w => w.closed), 'directory migration closes old watchers and waits for the new archive');
  now += 1600; await module.exports.tick();
  check(installs[1] === updatedDir && manifest.resourcesDir === updatedDir, 'guardian restores the updated install and keeps the uninstall manifest current');
  console.log(`${checks} installation path checks passed; no real app files changed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
