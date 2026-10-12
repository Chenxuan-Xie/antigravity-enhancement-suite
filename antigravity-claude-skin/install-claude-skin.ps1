param([string]$AntigravityDir = '', [string]$RuntimeDir = '', [switch]$EnableGuardian)
& (Join-Path (Split-Path $PSScriptRoot -Parent) 'install-all.ps1') -Modules 'skin,i18n' -NoUi -AntigravityDir $AntigravityDir -RuntimeDir $RuntimeDir -EnableGuardian:$EnableGuardian
