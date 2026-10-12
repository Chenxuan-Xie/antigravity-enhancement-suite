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

function resolveResourcesDir() {
  if (process.env.AGY_RESOURCES_DIR && isValidResourcesDir(process.env.AGY_RESOURCES_DIR)) {
    return path.resolve(process.env.AGY_RESOURCES_DIR);
  }
  if (process.env.AGY_APP_DIR) {
    const candidate = path.join(process.env.AGY_APP_DIR, "resources");
    if (isValidResourcesDir(candidate)) return path.resolve(candidate);
  }

  const cached = readInstallPathsCache();
  if (cached.resourcesDir && isValidResourcesDir(cached.resourcesDir)) {
    return cached.resourcesDir;
  }

  if (process.resourcesPath && isValidResourcesDir(process.resourcesPath)) {
    return process.resourcesPath;
  }

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
  const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";

  const candidates = [
    path.join(localAppData, "Programs", "Antigravity", "resources"),
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

  // Probe running Antigravity.exe process or Windows Registry Uninstall keys
  if (process.platform === "win32") {
    try {
      const psScript = [
        "$p = Get-CimInstance Win32_Process -Filter \"Name='Antigravity.exe'\" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty ExecutablePath;",
        "if ($p) { Split-Path -Parent $p; exit }",
        "$regPaths = @('HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*', 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*');",
        "$item = Get-ItemProperty $regPaths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'Antigravity' } | Select-Object -First 1;",
        "if ($item.InstallLocation) { $item.InstallLocation } elseif ($item.DisplayIcon) { Split-Path -Parent ($item.DisplayIcon -replace '\"','') }"
      ].join(" ");
      const detectedAppDir = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", psScript],
        { windowsHide: true, encoding: "utf8", timeout: 5000 }
      ).trim();
      if (detectedAppDir) {
        const resDir = path.join(detectedAppDir, "resources");
        if (isValidResourcesDir(resDir)) {
          saveInstallPathsCache({ resourcesDir: resDir });
          return resDir;
        }
      }
    } catch {}
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
