param([string]$RuntimeDir = '')
$ErrorActionPreference = 'Stop'
if (-not $RuntimeDir) { $RuntimeDir = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.gemini\antigravity-suite' }
$installer = Join-Path $RuntimeDir 'suite\install.cjs'
if (-not (Test-Path -LiteralPath $installer)) { throw "Installed runtime was not found: $RuntimeDir" }
& node $installer --runtime $RuntimeDir --uninstall true
if ($LASTEXITCODE -ne 0) { throw 'Uninstall failed; see the message above.' }
