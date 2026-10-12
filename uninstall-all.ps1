param([string]$RuntimeDir = '')
$ErrorActionPreference = 'Stop'
if (-not $RuntimeDir) {
    if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'data\install-manifest.json')) { $RuntimeDir = $PSScriptRoot }
    else { $RuntimeDir = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.gemini\antigravity-suite' }
}
$installer = Join-Path $RuntimeDir 'suite\install.cjs'
if (-not (Test-Path -LiteralPath $installer)) { throw "Installed runtime was not found: $RuntimeDir" }
& node $installer --runtime $RuntimeDir --uninstall true
if ($LASTEXITCODE -ne 0) { throw 'Uninstall failed; see the message above.' }
