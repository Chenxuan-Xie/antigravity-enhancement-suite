'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const paths = require('../antigravity-claude-skin/tools/agy-paths.cjs');
const proxy = require('../antigravity-claude-skin/tools/native-proxy.cjs');
const runtime = path.resolve(__dirname, '..');
const scriptFile = path.join(runtime, 'data', 'launch-antigravity.vbs');
const shortcutBackup = path.join(runtime, 'data', 'desktop-shortcut.before.lnk');
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
  // Supply the current proxy and loopback bypass as one Chromium configuration.
  if (servers.length) args.push('--proxy-server=' + servers.join(';'));
  const child = spawn(exe, args, {
    cwd: path.dirname(exe), env, detached: true, stdio: 'ignore', windowsHide: false
  });
  child.on('error', error => { console.error(error.message); process.exitCode = 1; });
  child.unref();
  return { pid: child.pid };
}

function installDesktopLauncher(resources) {
  if (process.platform !== 'win32') return { skipped: true };
  if (lastRepair?.resources === resources && Date.now() - lastRepair.time < 30000) return lastRepair.result;
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
    "$file=Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Antigravity.lnk';",
    "if(!(Test-Path -LiteralPath $file)){'{\"skipped\":true}';exit}",
    "$link=(New-Object -ComObject WScript.Shell).CreateShortcut($file);",
    "$owned=$link.Arguments.Contains($env:AGY_LAUNCH_SCRIPT);",
    "if(!$owned -and (Split-Path -Leaf $link.TargetPath) -ine 'Antigravity.exe'){'{\"skipped\":true}';exit}",
    "if(!$owned){Copy-Item -LiteralPath $file -Destination $env:AGY_SHORTCUT_BACKUP -Force}",
    "$target=Join-Path $env:WINDIR 'System32\\wscript.exe';$args='//B //Nologo \"'+$env:AGY_LAUNCH_SCRIPT+'\"';",
    "if($owned -and $link.TargetPath -eq $target -and $link.Arguments -eq $args -and $link.IconLocation -eq ($env:AGY_APP_EXE+',0')){'{\"changed\":false}';exit}",
    "$link.TargetPath=$target;$link.Arguments=$args;$link.WorkingDirectory=Split-Path -Parent $env:AGY_APP_EXE;$link.IconLocation=$env:AGY_APP_EXE+',0';$link.Save();'{\"changed\":true}'"
  ].join(' ');
  const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, AGY_LAUNCH_SCRIPT: scriptFile, AGY_SHORTCUT_BACKUP: shortcutBackup, AGY_APP_EXE: exe },
    windowsHide: true, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore']
  }).trim();
  const result = JSON.parse(output);
  lastRepair = { resources, time: Date.now(), result };
  return result;
}

function restoreDesktopLauncher() {
  if (process.platform !== 'win32' || !fs.existsSync(shortcutBackup)) return;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', [
    "$file=Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Antigravity.lnk';",
    "if(Test-Path -LiteralPath $file){$link=(New-Object -ComObject WScript.Shell).CreateShortcut($file);if($link.Arguments.Contains($env:AGY_LAUNCH_SCRIPT)){Copy-Item -LiteralPath $env:AGY_SHORTCUT_BACKUP -Destination $file -Force}}"
  ].join(' ')], { env: { ...process.env, AGY_LAUNCH_SCRIPT: scriptFile, AGY_SHORTCUT_BACKUP: shortcutBackup }, windowsHide: true, timeout: 5000 });
}

if (require.main === module) { try { launch(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { launch, installDesktopLauncher, restoreDesktopLauncher };
