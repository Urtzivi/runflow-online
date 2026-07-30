@echo off
cd /d "%~dp0"
if not exist .env (
  echo Falta el archivo .env. Copia .env.example como .env y completa Supabase.
  pause
  exit /b 1
)
start "" http://127.0.0.1:8787
node launcher.js
pause
