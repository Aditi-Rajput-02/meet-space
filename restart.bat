@echo off
taskkill /f /im node.exe 2>nul
timeout /t 2 /nobreak >nul
cd /d c:\Users\Admin\Downloads\video-call\meet-space
node app.js
