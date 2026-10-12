# =============================================================================
# Antigravity Enhancement Suite - One-Click Uninstaller & Stock UI Restorer
# Note: Your saved accounts.json and models.json in data/ are preserved safely.
# =============================================================================

$ErrorActionPreference = "Continue"
$SuiteRoot = $PSScriptRoot
$SkinRoot  = Join-Path $SuiteRoot "antigravity-claude-skin"

Write-Host "======================================================================" -ForegroundColor Yellow
Write-Host "  Antigravity Enhancement Suite - Restoring Official Stock State..." -ForegroundColor Yellow
Write-Host "======================================================================" -ForegroundColor Yellow

# 1. Restore default UI, remove external bootstrap & stop auto-heal guardian
& (Join-Path $SkinRoot "restore-default.ps1")

# 2. Stop local switcher daemon on 127.0.0.1:19823 if running
try {
    $procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -match "antigravity-account-switcher.*daemon\.mjs" }
    foreach ($p in $procs) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
        Write-Host "[Restore] Stopped local switcher daemon (PID $($p.ProcessId))" -ForegroundColor Green
    }
} catch {}

Write-Host ""
Write-Host "Uninstall Complete! Antigravity is restored to stock UI. (Local data/ configs were safely kept)" -ForegroundColor Cyan
