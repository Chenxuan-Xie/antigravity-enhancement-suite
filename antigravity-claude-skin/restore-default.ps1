# =============================================================================
# Antigravity Claude Desktop Skin - One-Click Full Restore & Uninstaller
# =============================================================================

$ErrorActionPreference = "Continue"
$SkinRoot  = $PSScriptRoot
$RestoreJs = Join-Path $SkinRoot "tools\restore-core.js"
$RegPath   = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$RegName   = "AntigravityClaudeSkinAutoHeal"

Write-Host "================================================================" -ForegroundColor Yellow
Write-Host "  Antigravity Claude Desktop Skin - Restoring Default Stock UI" -ForegroundColor Yellow
Write-Host "================================================================" -ForegroundColor Yellow

# 1. Remove Auto-Heal startup registry entry
Stop-ScheduledTask -TaskName 'Antigravity Claude Skin Guardian' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'Antigravity Claude Skin Guardian' -Confirm:$false -ErrorAction SilentlyContinue
if (Get-ItemProperty -Path $RegPath -Name $RegName -ErrorAction SilentlyContinue) {
    Remove-ItemProperty -Path $RegPath -Name $RegName -ErrorAction SilentlyContinue
    Write-Host "[Restore] Removed startup guardian from $RegPath\$RegName" -ForegroundColor Green
}

# 2. Stop daemon, remove native Electron hook, restore config.json, and un-inject live window
& node $RestoreJs

Write-Host ""
Write-Host "Restore Complete! Antigravity has been 100% restored to its original stock appearance." -ForegroundColor Cyan
