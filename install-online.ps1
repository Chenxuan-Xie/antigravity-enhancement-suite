param([string]$DownloadDir = (Join-Path $env:TEMP 'antigravity-suite-download'))
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $DownloadDir -Force | Out-Null
$zip = Join-Path $DownloadDir 'suite.zip'
Invoke-WebRequest 'https://github.com/Chenxuan-Xie/antigravity-enhancement-suite/archive/refs/heads/main.zip' -OutFile $zip -UseBasicParsing
Expand-Archive -LiteralPath $zip -DestinationPath $DownloadDir -Force
& (Join-Path $DownloadDir 'antigravity-enhancement-suite-main\install-all.ps1')
