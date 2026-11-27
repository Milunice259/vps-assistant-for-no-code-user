@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "%~dp0OwnerSigner.ps1"
if errorlevel 1 (
  echo.
  echo Setup did not finish. No release was published.
  pause
)
