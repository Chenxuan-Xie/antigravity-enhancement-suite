@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall-all.ps1"
if errorlevel 1 echo Uninstall failed. Please read the error above.
pause
