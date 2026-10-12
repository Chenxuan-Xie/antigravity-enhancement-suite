param(
    [string]$AntigravityDir = '',
    [string]$RuntimeDir = '',
    [string]$ConfigDir = '',
    [string]$Modules = '',
    [switch]$EnableGuardian,
    [switch]$NoUi
)
$ErrorActionPreference = 'Stop'
$nodeBin = (Get-Command node -ErrorAction Stop).Source
if (([version]((& $nodeBin --version).Trim().TrimStart('v'))).Major -lt 22) { throw 'Please install Node.js 22 or later: https://nodejs.org/' }
if (-not $Modules -and -not $NoUi) {
    Add-Type -AssemblyName System.Windows.Forms
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'Antigravity Enhancement Suite'; $form.Width = 440; $form.Height = 330
    $form.StartPosition = 'CenterScreen'; $form.FormBorderStyle = 'FixedDialog'; $form.MaximizeBox = $false
    $choices = @{}
    $moduleLabels = @('Claude theme / Claude 皮肤','Chinese localization / 中文汉化','Account switcher / 多账号切换','API model switcher / API 中转切换')
    $moduleKeys = @('skin','i18n','accounts','api')
    for ($i = 0; $i -lt 4; $i++) {
        $choice = New-Object System.Windows.Forms.CheckBox
        $choice.Text = $moduleLabels[$i]; $choice.Left = 22; $choice.Top = 20 + $i * 36; $choice.Width = 380; $choice.Checked = $true
        $form.Controls.Add($choice); $choices[$moduleKeys[$i]] = $choice
    }
    $guardianChoice = New-Object System.Windows.Forms.CheckBox
    $guardianChoice.Text = 'Update recovery task / 更新自愈计划任务（可选）'; $guardianChoice.Left = 22; $guardianChoice.Top = 168; $guardianChoice.Width = 390
    $form.Controls.Add($guardianChoice)
    $button = New-Object System.Windows.Forms.Button
    $button.Text = 'Install / 安装'; $button.Left = 260; $button.Top = 225; $button.Width = 130; $button.DialogResult = 'OK'
    $form.Controls.Add($button); $form.AcceptButton = $button
    if ($form.ShowDialog() -ne 'OK') { exit 0 }
    $Modules = (($moduleKeys | Where-Object { $choices[$_].Checked }) -join ',')
    if (-not $Modules) { throw 'Please select at least one feature.' }
    $EnableGuardian = $guardianChoice.Checked
}
if (-not $Modules) { $Modules = 'skin,i18n,accounts,api' }
$installArgs = @((Join-Path $PSScriptRoot 'suite\install.cjs'),'--modules',$Modules,'--guardian',([bool]$EnableGuardian).ToString().ToLowerInvariant())
if ($AntigravityDir) { $installArgs += @('--app',$AntigravityDir) }
if ($RuntimeDir) { $installArgs += @('--runtime',$RuntimeDir) }
if ($ConfigDir) { $installArgs += @('--config',$ConfigDir) }
& $nodeBin @installArgs
if ($LASTEXITCODE -ne 0) { throw 'Installation failed. Your existing account and model data were preserved.' }
