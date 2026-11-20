'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const proxy = require('../../antigravity-claude-skin/tools/native-proxy.cjs');
let checks = 0;
function check(condition, label) { assert(condition, label); checks++; console.log('PASS ' + label); }
async function main() {
  const files = new Map(), launches = [], scripts = [];
  const exe = 'C:\\updated-app\\Antigravity.exe';
  const env = { WINDIR: 'C:\\Windows', KEEP_SETTING: 'preserved' };
  let registry = 'ProxyEnable REG_DWORD 0x1\nProxyServer REG_SZ 127.0.0.1:8800';
  const fakeFs = { existsSync: file => file === exe || files.has(file), readFileSync: file => files.get(file),
    mkdirSync() {}, writeFileSync: (file, bytes) => files.set(file, bytes) };
  const child = { pid: 123, on() {}, unref() { this.detached = true; } };
  const module = { exports: {} };
  const context = { module, __dirname: 'D:\\runtime\\suite', __filename: 'D:\\runtime\\suite\\launch.cjs',
    process: { platform: 'win32', env }, Buffer, Date, URL, console,
    require: name => name === 'node:fs' ? fakeFs : name === 'node:path' ? path.win32 : name.endsWith('agy-paths.cjs') ? {
      resolveResourcesDir: () => 'C:\\updated-app\\resources', resolveNodeBin: () => 'D:\\node\\node.exe'
    } : name.endsWith('native-proxy.cjs') ? { ...proxy, getProxyEnvironment: () => proxy.proxyEnvironment(env, registry) } : {
      spawn: (...args) => { launches.push(args); return child; },
      execFileSync: (...args) => { scripts.push(args); return '{"changed":true}'; }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'launch.cjs'), 'utf8'), context);
  const api = module.exports;
  api.launch();
  check(launches[0][0] === exe && launches[0][2].cwd === 'C:\\updated-app', 'launcher starts the currently detected version');
  check(launches[0][2].env.HTTPS_PROXY === 'http://127.0.0.1:8800/', 'HTTPS requests use the HTTP proxy tunnel rather than TLS to the local proxy port');
  check(launches[0][1][0].includes('localhost;127.0.0.1;[::1]'), 'local app pages bypass the external proxy');
  check(launches[0][1].includes('--proxy-server=http=http://127.0.0.1:8800;https=http://127.0.0.1:8800'), 'Chromium receives the current proxy together with its loopback bypass rules');
  check(launches[0][1].includes('--remote-debugging-port=0') && launches[0][1].includes('--remote-debugging-address=127.0.0.1'), 'launcher supplies loopback remote debugging flags directly for Antigravity 2.33+');
  check(launches[0][2].env.KEEP_SETTING === 'preserved' && child.detached, 'unrelated environment and independent app lifetime are preserved');
  check(launches[0][2].windowsHide === false, 'the interactive app window is allowed to show while its launcher stays hidden');
  registry = registry.replace('8800', '9900'); api.launch();
  check(launches[1][2].env.HTTP_PROXY === 'http://127.0.0.1:9900/', 'changing the system proxy takes effect on the next launch');
  env.HTTPS_PROXY = 'http://custom-proxy:1234'; api.launch();
  check(launches[2][2].env.HTTPS_PROXY === new URL(env.HTTPS_PROXY).href, 'explicit user proxy settings take precedence');
  check(!env.HTTP_PROXY && !env.NO_PROXY, 'launcher does not write global proxy settings');
  files.set('D:\\runtime\\antigravity-claude-skin\\tools\\boot-on-launch.cjs', '// boot');
  api.launch({ args: ['D:\\workspace'] });
  check(launches.at(-2)[1].at(-1) === 'D:\\workspace' && launches.at(-1)[0] === 'D:\\node\\node.exe' && launches.at(-1)[1][0].endsWith('boot-on-launch.cjs') && launches.at(-1)[2].windowsHide === true, 'launcher forwards CLI args and starts the hidden CDP boot helper on launch');
  const result = api.installDesktopLauncher('C:\\updated-app\\resources');
  check(result.changed && scripts[0][2].env.AGY_APP_EXE === exe && scripts[0][2].env.AGY_STARTMENU_BACKUP.endsWith('startmenu-shortcut.before.lnk'), 'desktop and Start Menu launchers point to the updated official executable');
  const [vbsFile, bytes] = [...files.entries()].find(([k]) => k.endsWith('.vbs'));
  check(vbsFile.startsWith('D:\\runtime\\data\\') && bytes.subarray(0, 2).equals(Buffer.from([255, 254])), 'launcher stays in the fixed runtime and uses Unicode-safe VBScript encoding');
  const vbs = bytes.subarray(2).toString('utf16le');
  check(vbs.includes('"""D:\\node\\node.exe"" ""D:\\runtime\\suite\\launch.cjs"""') && vbs.includes(', 0, False'), 'paths are quoted correctly and the background helper stays hidden');
  api.installDesktopLauncher('C:\\updated-app\\resources');
  check(scripts.length === 1, 'stable desktop shortcut repairs are throttled');
  files.set(scripts[0][2].env.AGY_SHORTCUT_BACKUP, Buffer.from('shortcut'));
  files.set(scripts[0][2].env.AGY_STARTMENU_BACKUP, Buffer.from('startmenu'));
  api.restoreDesktopLauncher();
  check(scripts.length === 2 && scripts[1][1].at(-1).includes('Arguments.Contains') && scripts[1][1].at(-1).includes('AGY_STARTMENU_BACKUP'), 'uninstall restores Desktop and Start Menu backups only while shortcuts belong to this suite');
  console.log(`${checks} desktop launch checks passed; no real shortcuts or app files changed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
