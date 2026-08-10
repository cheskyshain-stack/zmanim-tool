@echo off
cd /d "%~dp0"
echo Starting Zmanim Sheet Generator...
start "Zmanim server (keep this window open)" cmd /k python -m http.server 8000
timeout /t 2 /nobreak >nul
start http://localhost:8000
