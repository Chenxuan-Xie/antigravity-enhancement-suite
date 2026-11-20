'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const paths = require('../antigravity-claude-skin/tools/agy-paths.cjs');
const proxy = require('../antigravity-claude-skin/tools/native-proxy.cjs');
const runtime = path.resolve(__dirname, '..');
const scriptFile = path.join(runtime, 'data', 'launch-antigravity.vbs');
const shortcutBackup = path.join(runtime, 'data', 'desktop-shortcut.before.lnk');
const startMenuBackup = path.join(runtime, 'data', 'startmenu-shortcut.before.lnk');
const startMenuSubBackup = path.join(runtime, 'data', 'startmenu-sub-shortcut.before.lnk');
const bootScript = path.join(runtime, 'antigravity-claude-skin', 'tools', 'boot-on-launch.cjs');
let lastRepair;

function launch(options = {}) {
  const resources = options.resourcesDir || paths.resolveResourcesDir({ refresh: true });
  const exe = path.join(path.dirname(resources), 'Antigravity.exe');
  if (!fs.existsSync(exe)) throw Error('Antigravity executable is unavailable');
  const env = { ...process.env, ...proxy.getProxyEnvironment() };
  // Read the current Windows proxy on every launch, never a recorded exit IP.
  const servers = [];
  for (const [protocol, key] of [['http', 'HTTP_PROXY'], ['https', 'HTTPS_PROXY']]) {
    if (!env[key]) continue;
    const server = new URL(env[key]);
    if (!server.username && !server.password) servers.push(protocol + '=' + server.protocol.replace('socks5h:', 'socks5:') + '//' + server.host);
  }
  const args = ['--proxy-bypass-list=' + proxy.loopbackBypass()];
  // Supply the current proxy, loopback bypass, and local CDP switch directly on launch
  // so Antigravity v2.33.0+ opens loopback DevTools even when app.asar skips resources/app.
  if (servers.length) args.push('--proxy-server=' + servers.join(';'));
  args.push('--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1');
  if (Array.isArray(options.args) && options.args.length) args.push(...options.args);
  const startedAt = Date.now();
  const child = spawn(exe, args, {
    cwd: path.dirname(exe), env, detached: true, stdio: 'ignore', windowsHide: false
  });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.unref();
  if (!options.skipBoot && fs.existsSync(bootScript)) {
    const boot = spawn(paths.resolveNodeBin(), [bootScript, '--started-at=' + startedAt], {
      cwd: runtime, env, detached: true, stdio: 'ignore', windowsHide: true
    });
    boot.on('error', () => {});
    boot.unref();
  }
  return { pid: child.pid, args };
}

function installDesktopLauncher(resources, options = {}) {
  if (process.platform !== 'win32') return { skipped: true };
  if (!options.force && lastRepair?.resources === resources && Date.now() - lastRepair.time < 300000) {
    return { ...lastRepair.result, changed: false, throttled: true };
  }
  const exe = path.join(path.dirname(resources), 'Antigravity.exe');
  if (!fs.existsSync(exe)) return { skipped: true };
  const quote = value => '"' + value.replaceAll('"', '""') + '"';
  const command = '"' + paths.resolveNodeBin() + '" "' + __filename + '"';
  const vbs = '// AGY_SUITE_LAUNCHER\n'.replace('//', "'") + 'CreateObject("WScript.Shell").Run ' + quote(command) + ', 0, False\n';
  fs.mkdirSync(path.dirname(scriptFile), { recursive: true });
  const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(vbs, 'utf16le')]);
  if (!fs.existsSync(scriptFile) || !fs.readFileSync(scriptFile).equals(bytes)) fs.writeFileSync(scriptFile, bytes);
  const script = [
    "$ErrorActionPreference='Stop';",
    "$shell=New-Object -ComObject WScript.Shell;",
    "$target=Join-Path $env:WINDIR 'System32\\wscript.exe';",
    "$args='//B //Nologo \"'+$env:AGY_LAUNCH_SCRIPT+'\"';",
    "$items=@(",
    "  @{file=(Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Antigravity.lnk');bak=$env:AGY_SHORTCUT_BACKUP},",
    "  @{file=(Join-Path ([Environment]::GetFolderPath('Programs')) 'Antigravity.lnk');bak=$env:AGY_STARTMENU_BACKUP},",
    "  @{file=(Join-Path (Join-Path ([Environment]::GetFolderPath('Programs')) 'Antigravity') 'Antigravity.lnk');bak=$env:AGY_STARTMENU_SUB_BACKUP}",
    ");",
    "$changed=$false;$updated=0;$found=0;",
    "foreach($item in $items){",
    "  if(!(Test-Path -LiteralPath $item.file)){continue}",
    "  $link=$shell.CreateShortcut($item.file);",
    "  $owned=$link.Arguments.Contains($env:AGY_LAUNCH_SCRIPT);",
    "  if(!$owned -and (Split-Path -Leaf $link.TargetPath) -ine 'Antigravity.exe'){continue}",
    "  $found++;",
    "  if(!$owned){Copy-Item -LiteralPath $item.file -Destination $item.bak -Force}",
    "  if($owned -and $link.TargetPath -eq $target -and $link.Arguments -eq $args -and $link.IconLocation -eq ($env:AGY_APP_EXE+',0')){continue}",
    "  $link.TargetPath=$target;$link.Arguments=$args;$link.WorkingDirectory=Split-Path -Parent $env:AGY_APP_EXE;$link.IconLocation=$env:AGY_APP_EXE+',0';$link.Save();$changed=$true;$updated++",
    "}",
    "if($found -eq 0){'{\"skipped\":true}';exit}",
    "@{changed=$changed;updated=$updated} | ConvertTo-Json -Compress"
  ].join(' ');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: {
      ...process.env,
      AGY_LAUNCH_SCRIPT: scriptFile,
      AGY_SHORTCUT_BACKUP: shortcutBackup,
      AGY_STARTMENU_BACKUP: startMenuBackup,
      AGY_STARTMENU_SUB_BACKUP: startMenuSubBackup,
      AGY_APP_EXE: exe
    },
    windowsHide: true, encoding: 'utf8', timeout: 12000, stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
  const result = JSON.parse(output);
  lastRepair = { resources, time: Date.now(), result };
  return result;
}

function restoreDesktopLauncher() {
  if (process.platform !== 'win32') return;
  if (!fs.existsSync(shortcutBackup) && !fs.existsSync(startMenuBackup) && !fs.existsSync(startMenuSubBackup)) return;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', [
    "$shell=New-Object -ComObject WScript.Shell;",
    "$items=@(",
    "  @{file=(Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Antigravity.lnk');bak=$env:AGY_SHORTCUT_BACKUP},",
    "  @{file=(Join-Path ([Environment]::GetFolderPath('Programs')) 'Antigravity.lnk');bak=$env:AGY_STARTMENU_BACKUP},",
    "  @{file=(Join-Path (Join-Path ([Environment]::GetFolderPath('Programs')) 'Antigravity') 'Antigravity.lnk');bak=$env:AGY_STARTMENU_SUB_BACKUP}",
    ");",
    "foreach($item in $items){if((Test-Path -LiteralPath $item.bak) -and (Test-Path -LiteralPath $item.file)){$link=$shell.CreateShortcut($item.file);if($link.Arguments.Contains($env:AGY_LAUNCH_SCRIPT)){Copy-Item -LiteralPath $item.bak -Destination $item.file -Force}}}"
  ].join(' ')], {
    env: {
      ...process.env,
      AGY_LAUNCH_SCRIPT: scriptFile,
      AGY_SHORTCUT_BACKUP: shortcutBackup,
      AGY_STARTMENU_BACKUP: startMenuBackup,
      AGY_STARTMENU_SUB_BACKUP: startMenuSubBackup
    },
    windowsHide: true, timeout: 12000
  });
}

if (require.main === module) { try { launch({ args: process.argv.slice(2) }); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { launch, installDesktopLauncher, restoreDesktopLauncher };
