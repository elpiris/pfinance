@echo off
rem PFinance launcher for Windows (double-click).
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo PFinance needs Node.js, which isn't installed.
  echo Install the LTS version from https://nodejs.org, then double-click start.bat again.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo PFinance needs Node.js 22.13 or newer. Update it from https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies ^(first run only, needs internet^)...
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)

node server.js --open
pause
