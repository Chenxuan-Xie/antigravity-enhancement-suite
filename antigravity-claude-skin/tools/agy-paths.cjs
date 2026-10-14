"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const skinRoot = path.resolve(__dirname, "..");
const suiteRoot = path.resolve(skinRoot, "..");
const accountSwitcherRoot = path.join(suiteRoot, "antigravity-account-switcher");
const modelSwitcherRoot = path.join(suiteRoot, "antigravity-model-switcher");
const installPathsCacheFile = path.join(skinRoot, "backup", "install-paths.json");

function readInstallPathsCache() {
  try {
    if (fs.existsSync(installPathsCacheFile)) {
      return JSON.parse(fs.readFileSync(installPathsCacheFile, "utf8")) || {};
    }
  } catch {}
  return {};
}

function saveInstallPathsCache(patch = {}) {
  try {
    const current = readInstallPathsCache();
    const merged = { ...current, ...patch, updatedAt: new Date().toISOString() };
    fs.mkdirSync(path.dirname(installPathsCacheFile), { recursive: true });
    fs.writeFileSync(installPathsCacheFile, JSON.stringify(merged, null, 2) + "\n", "utf8");
  } catch {}
}

function isValidResourcesDir(dir) {
  if (!dir || typeof dir !== "string") return false;
  try {
    return fs.existsSync(path.join(dir, "app.asar"));
  } catch {
    return false;
  }
}

let lastWindowsProbe;
function probeWindowsResourcesDir(refresh = false) {
  if (process.platform !== 'win32') return;
  // The updater can install to a different directory while the old ASAR survives.
  // Recheck periodically, without spawning PowerShell on every path lookup.
  if (!refresh && lastWindowsProbe && Date.now() - lastWindowsProbe.time < 30000) return lastWindowsProbe.dir;
  let dir;
  try {
    const script = [
      "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);",
      "$p=Get-CimInstance Win32_Process -Filter \"Name='Antigravity.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath -and $_.CommandLine -notmatch '--type=' } | Select-Object -First 1;",
      "if($p){Split-Path -Parent $p.ExecutablePath;exit}",
      "$link=Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'Antigravity.lnk';",
      "if(Test-Path -LiteralPath $link){$shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut($link);$target=$shortcut.TargetPath;if((Split-Path -Leaf $target) -ine 'Antigravity.exe'){$target=($shortcut.IconLocation -replace ',\\d+$','').Trim('\"')};if($target -and (Split-Path -Leaf $target) -ieq 'Antigravity.exe' -and (Test-Path -LiteralPath $target)){Split-Path -Parent $target;exit}}",
      "$keys=@('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*');",
      "$item=Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '^Antigravity(?: |$)' } | Select-Object -First 1;",
      "if($item.InstallLocation){$item.InstallLocation}elseif($item.DisplayIcon){Split-Path -Parent (($item.DisplayIcon -replace ',\\d+$','').Trim('\"'))}"
    ].join(' ');
    const appDir = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    const candidate = appDir && path.join(appDir, 'resources');
    if (isValidResourcesDir(candidate)) dir = candidate;
  } catch {}
  lastWindowsProbe = { time: Date.now(), dir };
  return dir;
}

function resolveResourcesDir(options = {}) {
  if (process.env.AGY_RESOURCES_DIR && isValidResourcesDir(process.env.AGY_RESOURCES_DIR)) {
    return path.resolve(process.env.AGY_RESOURCES_DIR);
  }
  if (process.env.AGY_APP_DIR) {
    const candidate = path.join(process.env.AGY_APP_DIR, "resources");
    if (isValidResourcesDir(candidate)) return path.resolve(candidate);
  }

  if (process.resourcesPath && isValidResourcesDir(process.resourcesPath)) {
    saveInstallPathsCache({ resourcesDir: process.resourcesPath });
    return process.resourcesPath;
  }

  const detected = probeWindowsResourcesDir(options.refresh);
  if (detected) {
    const cached = readInstallPathsCache();
    if (cached.resourcesDir !== detected) saveInstallPathsCache({ resourcesDir: detected });
    return detected;
  }

  const cached = readInstallPathsCache();
  if (cached.resourcesDir && isValidResourcesDir(cached.resourcesDir)) return cached.resourcesDir;

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
  const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";

  const candidates = [
    path.join(localAppData, "Programs", "Antigravity", "resources"),
    path.join(os.homedir(), "AppData", "Local", "Programs", "Antigravity", "resources"),
    path.join(localAppData, "Antigravity", "resources"),
    path.join(programFiles, "Antigravity", "resources"),
    path.join(programFilesX86, "Antigravity", "resources"),
    "C:\\Antigravity\\resources",
    "D:\\Antigravity\\resources",
    "D:\\Program Files\\Antigravity\\resources",
  ];

  for (const dir of candidates) {
    if (isValidResourcesDir(dir)) {
      saveInstallPathsCache({ resourcesDir: dir });
      return dir;
    }
  }

  // Default fallback to standard Per-User Electron installer location
  return path.join(localAppData, "Programs", "Antigravity", "resources");
}

function resolveNodeBin() {
  if (process.env.AGY_NODE_BIN && fs.existsSync(process.env.AGY_NODE_BIN)) {
    return process.env.AGY_NODE_BIN;
  }
  const cached = readInstallPathsCache();
  if (cached.nodeBin && fs.existsSync(cached.nodeBin)) {
    return cached.nodeBin;
  }
  if (path.basename(process.execPath || "").toLowerCase() === "node.exe" && fs.existsSync(process.execPath)) {
    saveInstallPathsCache({ nodeBin: process.execPath });
    return process.execPath;
  }
  const candidates = [
    path.join(process.env.PROGRAMFILES || "C:\\Program Files", "nodejs", "node.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "nodejs", "node.exe"),
    path.join(process.env.NVM_SYMLINK || "C:\\Program Files\\nodejs", "node.exe"),
  ];
  for (const bin of candidates) {
    if (bin && fs.existsSync(bin)) {
      return bin;
    }
  }
  return "node";
}

module.exports = {
  skinRoot,
  suiteRoot,
  accountSwitcherRoot,
  modelSwitcherRoot,
  installPathsCacheFile,
  readInstallPathsCache,
  saveInstallPathsCache,
  resolveResourcesDir,
  resolveNodeBin,
};
