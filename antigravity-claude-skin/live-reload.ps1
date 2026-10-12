# =============================================================================
# Antigravity Claude Desktop Skin - Live CSS Hot-Reload Utility
# Rebuilds claude-theme.css from src\claude-core.css and hot-reloads the live window
# =============================================================================

$ErrorActionPreference = "Stop"
$SkinRoot = $PSScriptRoot
$CoreJs   = Join-Path $SkinRoot "tools\install-core.js"

Write-Host "[Hot-Reload] Rebuilding claude-theme.css and injecting into live Antigravity window..." -ForegroundColor Yellow
& node $CoreJs
Write-Host "[Hot-Reload] Done!" -ForegroundColor Green
