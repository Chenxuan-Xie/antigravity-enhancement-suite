param([string]$RuntimeDir = '')
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'suite\update-runtime.cjs') $RuntimeDir
if ($LASTEXITCODE -ne 0) { throw 'Runtime update failed; see the message above.' }
