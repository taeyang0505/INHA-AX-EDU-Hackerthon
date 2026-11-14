@echo off
rem LOOKteracy launcher (Windows). Double-click to start the local server and open the browser.
cd /d "%~dp0"
if "%PORT%"=="" set PORT=4186
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install the LTS version from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
echo Starting LOOKteracy at http://127.0.0.1:%PORT%
echo Close this window or press Ctrl+C to stop the server.
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul && start http://127.0.0.1:%PORT%"
node scripts\serve.mjs --port %PORT%
pause
