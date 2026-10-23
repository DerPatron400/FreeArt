@echo off
rem Serves Khora locally and opens it in your browser.
cd /d "%~dp0"
where python >nul 2>nul && (
  start "" http://localhost:5173
  python -m http.server 5173
  goto :eof
)
where npx >nul 2>nul && (
  npx --yes http-server -p 5173 -c-1 -o
  goto :eof
)
echo Please install Python or Node.js, then run this again.
pause
