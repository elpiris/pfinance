#!/bin/bash
# PFinance launcher for macOS (double-click in Finder). Also works on Linux: ./start.command
cd "$(dirname "$0")" || exit 1

# Finder-launched shells may miss Homebrew's paths.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

pause_and_exit() {
  echo
  read -n 1 -s -r -p "Press any key to close this window..."
  exit "$1"
}

if ! command -v node >/dev/null 2>&1; then
  echo "PFinance needs Node.js, which isn't installed."
  echo "Install the LTS version from https://nodejs.org, then double-click start.command again."
  command -v open >/dev/null && open "https://nodejs.org/en/download"
  pause_and_exit 1
fi

if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"; then
  echo "PFinance needs Node.js 22.13 or newer (you have $(node -v))."
  echo "Update it from https://nodejs.org, then try again."
  pause_and_exit 1
fi

# First run, or the app was updated with new dependencies.
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Installing dependencies (first run only, needs internet)..."
  npm install --omit=dev --no-audit --no-fund || { echo "npm install failed."; pause_and_exit 1; }
fi

node server.js --open
pause_and_exit $?
