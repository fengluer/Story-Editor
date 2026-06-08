@echo off
setlocal

cd /d "%~dp0"

echo.
echo Starting Story Editor...
echo Project: %CD%
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please install Node.js first.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo.
echo Open this URL in your browser:
echo http://localhost:5173/
echo.
echo Press Ctrl+C to stop the service.
echo.

call npm run dev -- --port 5173

pause
