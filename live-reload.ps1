# =============================================================================
# Antigravity Enhancement Suite - Live Hot-Reload Utility
# Rebuilds theme CSS + CN i18n + Account/Model injectors and hot-reloads window
# =============================================================================

$ErrorActionPreference = "Stop"
$SuiteRoot = $PSScriptRoot
$SkinRoot  = Join-Path $SuiteRoot "antigravity-claude-skin"
$ModelRoot = Join-Path $SuiteRoot "antigravity-model-switcher"

Write-Host "[Hot-Reload] Rebuilding theme, i18n, and injector bundles..." -ForegroundColor Yellow
& (Join-Path $SkinRoot "live-reload.ps1")

try {
    & node (Join-Path $ModelRoot "tools\reload-runtime.mjs")
} catch {
    Write-Host "[Hot-Reload] Note: reload-runtime skipped or window not active ($($_.Exception.Message))" -ForegroundColor DarkGray
}
Write-Host "[Hot-Reload] All changes applied!" -ForegroundColor Green
