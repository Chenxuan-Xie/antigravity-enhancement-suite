@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-all.ps1"
if errorlevel 1 echo Installation failed. Please read the error above.
pause
