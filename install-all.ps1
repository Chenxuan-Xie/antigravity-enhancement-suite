# =============================================================================
# Antigravity Enhancement Suite - One-Click Full Installer
# Modules:
#   1. Claude Desktop Skin (Warm Parchment + Bookish Serif) & Simplified CN i18n
#   2. Google Multi-Account Hot Switcher & Quota Monitor
#   3. Custom Relay API / Token Proxy Model Switcher & Context Bridge
# =============================================================================

param(
    [string]$AntigravityDir = ""
)

$ErrorActionPreference = "Stop"
$SuiteRoot   = $PSScriptRoot
$SkinRoot    = Join-Path $SuiteRoot "antigravity-claude-skin"
$AccRoot     = Join-Path $SuiteRoot "antigravity-account-switcher"
$ModelRoot   = Join-Path $SuiteRoot "antigravity-model-switcher"

if ($AntigravityDir) {
    $env:AGY_APP_DIR = $AntigravityDir
}

$NodeCmd = (Get-Command node -ErrorAction Stop).Source
$env:AGY_NODE_BIN = $NodeCmd

Write-Host "======================================================================" -ForegroundColor Yellow
Write-Host "  Antigravity Enhancement Suite - One-Click Installer" -ForegroundColor Yellow
Write-Host "  [1] Claude Warm Parchment Skin + Simplified Chinese Localization" -ForegroundColor Yellow
Write-Host "  [2] Google Multi-Account Seamless Hot Switcher" -ForegroundColor Yellow
Write-Host "  [3] Custom API / Relay Model Switcher (OpenAI & Anthropic)" -ForegroundColor Yellow
Write-Host "======================================================================" -ForegroundColor Yellow

# -----------------------------------------------------------------------------
# Step 1: Install & Configure Plugins in ~/.gemini/config/plugins
# -----------------------------------------------------------------------------
$GeminiConfigDir = Join-Path $HOME ".gemini\config"
$PluginsDir      = Join-Path $GeminiConfigDir "plugins"
New-Item -ItemType Directory -Path $PluginsDir -Force | Out-Null

# 1.1 Account Switcher Plugin
$AccPluginDst = Join-Path $PluginsDir "account-switcher"
if (Test-Path $AccPluginDst) { Remove-Item $AccPluginDst -Recurse -Force }
Copy-Item -Path (Join-Path $AccRoot "plugin") -Destination $AccPluginDst -Recurse -Force

$AccApiUrl  = ([System.Uri](Join-Path $AccRoot "core\api-handler.mjs")).AbsoluteUri
$AccDaemon  = (Join-Path $AccRoot "core\daemon.mjs").Replace('\', '\\')
$AccPanelJs = Join-Path $AccPluginDst "sidecars\panel\main.mjs"
$accPanelContent = Get-Content $AccPanelJs -Raw -Encoding UTF8
$accPanelContent = $accPanelContent.Replace('../../../core/api-handler.mjs', $AccApiUrl)
$accPanelContent = $accPanelContent.Replace('path.resolve(__dirname, "../../../core/daemon.mjs")', "`"$AccDaemon`"")
Set-Content -Path $AccPanelJs -Value $accPanelContent -Encoding UTF8
Write-Host "[Plugin] Installed account-switcher -> $AccPluginDst" -ForegroundColor Green

# 1.2 API Model Switcher Plugin
$ModelPluginDst = Join-Path $PluginsDir "api-model-switcher"
if (Test-Path $ModelPluginDst) { Remove-Item $ModelPluginDst -Recurse -Force }
Copy-Item -Path (Join-Path $ModelRoot "plugin") -Destination $ModelPluginDst -Recurse -Force

$ModelApiUrl  = ([System.Uri](Join-Path $ModelRoot "core\api-handler.mjs")).AbsoluteUri
$ModelPanelJs = Join-Path $ModelPluginDst "sidecars\panel\main.mjs"
$modelPanelContent = Get-Content $ModelPanelJs -Raw -Encoding UTF8
$modelPanelContent = $modelPanelContent.Replace('../../../core/api-handler.mjs', $ModelApiUrl)
Set-Content -Path $ModelPanelJs -Value $modelPanelContent -Encoding UTF8

$McpServerPath = Join-Path $ModelRoot "core\mcp-server.mjs"
$McpConfigObj  = @{
    mcpServers = @{
        "api-model-switcher-mcp" = @{
            command = $NodeCmd
            args    = @($McpServerPath)
        }
    }
}
$McpJson = $McpConfigObj | ConvertTo-Json -Depth 5
Set-Content -Path (Join-Path $ModelPluginDst "mcp_config.json") -Value $McpJson -Encoding UTF8
Write-Host "[Plugin] Installed api-model-switcher -> $ModelPluginDst" -ForegroundColor Green

# 1.3 Enable both plugins in ~/.gemini/config/config.json
$ConfigJsonPath = Join-Path $GeminiConfigDir "config.json"
$BackupDir      = Join-Path $SkinRoot "backup"
New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
if ((Test-Path $ConfigJsonPath) -and -not (Test-Path (Join-Path $BackupDir "config.json.bak"))) {
    Copy-Item -Path $ConfigJsonPath -Destination (Join-Path $BackupDir "config.json.bak") -Force
}

$cfg = @{}
if (Test-Path $ConfigJsonPath) {
    try {
        $cfg = Get-Content $ConfigJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
    } catch {
        $cfg = @{}
    }
}
if (-not $cfg.ContainsKey("plugins") -or $null -eq $cfg["plugins"]) {
    $cfg["plugins"] = @{}
}
$cfg["plugins"]["account-switcher"]   = @{ enabled = $true }
$cfg["plugins"]["api-model-switcher"] = @{ enabled = $true }
($cfg | ConvertTo-Json -Depth 10) | Set-Content -Path $ConfigJsonPath -Encoding UTF8
Write-Host "[Config] Enabled account-switcher & api-model-switcher in $ConfigJsonPath" -ForegroundColor Green

# -----------------------------------------------------------------------------
# Step 2: Build & Install Claude Skin + CN i18n + External Bootstrap + Guardian
# -----------------------------------------------------------------------------
& (Join-Path $SkinRoot "install-claude-skin.ps1")

Write-Host ""
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "  All 3 Enhancement Modules Installed Successfully!" -ForegroundColor Cyan
Write-Host "  - Theme & CN UI: Active (auto-healing guardian registered)" -ForegroundColor Cyan
Write-Host "  - Account Switcher: Available in Settings -> Account & Side Panel" -ForegroundColor Cyan
Write-Host "  - API Model Switcher: Available in Chat Model Menu & Side Panel" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
