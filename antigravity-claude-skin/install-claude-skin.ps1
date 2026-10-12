# =============================================================================
# Antigravity Claude Desktop Skin + CN Localization - One-Click Installer
# Theme: Warm Parchment (#FAF9F5) + Bookish Serif + Simplified Chinese UI
# =============================================================================

$ErrorActionPreference = "Stop"
$SkinRoot = $PSScriptRoot
$VbsPath  = Join-Path $SkinRoot "tools\start-auto-heal.vbs"
$CoreJs   = Join-Path $SkinRoot "tools\install-core.js"
$RegPath  = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$RegName  = "AntigravityClaudeSkinAutoHeal"

Write-Host "================================================================" -ForegroundColor Yellow
Write-Host "  Antigravity Claude Desktop Skin + CN i18n - Installing..." -ForegroundColor Yellow
Write-Host "  Mode: Warm Parchment (#FAF9F5) + Bookish Serif + Simplified CN" -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Yellow

# 1. Build CSS & i18n bundles, backup stock files, install the external bootstrap without modifying app.asar, install hook, and live-inject via CDP
& node $CoreJs
if ($LASTEXITCODE -ne 0) {
    throw "install-core.js exited with code $LASTEXITCODE"
}

# 2. Register the user logon hook and Task Scheduler recovery watchdog.
& (Join-Path $SkinRoot "tools\register-guardian.ps1")

Write-Host ""
Write-Host "Install Complete! Antigravity Claude Skin + Simplified Chinese Localization are now installed with monitored update recovery." -ForegroundColor Cyan
