@echo off
setlocal

cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0package-release.ps1"
if errorlevel 1 (
  echo.
  echo Package failed. Exit code: %errorlevel%
)

echo.
pause
