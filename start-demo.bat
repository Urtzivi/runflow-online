@echo off
cd /d "%~dp0"
set DEMO_MODE=1
start "" http://127.0.0.1:8787/demo/coach
node server.js
pause
