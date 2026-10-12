param([switch]$Disable)
$ErrorActionPreference = 'Stop'
$vbsPath = Join-Path $PSScriptRoot 'start-auto-heal.vbs'
$regPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$name = 'AntigravityClaudeSkinAutoHeal'
$taskName = 'Antigravity Claude Skin Guardian'
if ($Disable) {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $taskName
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
    if (Get-ItemProperty -Path $regPath -Name $name -ErrorAction SilentlyContinue) { Remove-ItemProperty -Path $regPath -Name $name }
    $guardianScript = Join-Path $PSScriptRoot 'auto-heal-daemon.js'
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine.Contains($guardianScript) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    exit 0
}
Set-ItemProperty -Path $regPath -Name $name -Value "wscript.exe //B //Nologo `"$vbsPath`""
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\wscript.exe" -Argument "//B //Nologo `"$vbsPath`""
$triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1))
)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName,State
