@echo off
echo.
echo ========================================
echo   MeetSpace - Build and Deploy Script
echo ========================================
echo.

echo [1/3] Building frontend...
node "%~dp0frontend\node_modules\vite\bin\vite.js" build --config "%~dp0frontend\vite.config.js"

if %ERRORLEVEL% neq 0 (
  echo [ERROR] Build failed! Aborting.
  exit /b 1
)

echo [OK] Build successful.
echo.

echo [2/3] Staging files...
cd /d "%~dp0"
git add frontend/dist/ -f
git add -A

echo [3/3] Committing and pushing...
set MSG=%~1
if "%MSG%"=="" set MSG=build: update frontend dist

git commit -m "%MSG%"
git push origin main

echo.
echo Done! Pushed to GitHub.
echo.
