@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required to run Meme Fast locally.
  echo Install Node.js 20 or newer, then run this file again.
  pause
  exit /b 1
)

echo Starting Meme Fast at http://127.0.0.1:4173/narratives.html
echo Press Ctrl+C to stop the local server.
node preview.mjs

pause
