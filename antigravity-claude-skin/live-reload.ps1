param([string]$RuntimeDir = '')
& (Join-Path (Split-Path $PSScriptRoot -Parent) 'live-reload.ps1') -RuntimeDir $RuntimeDir
