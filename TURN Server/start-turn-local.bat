@echo off
:: ─────────────────────────────────────────────────────────────────────────────
:: start-turn-local.bat — Run coturn TURN server locally on Windows
:: GitHub: https://github.com/coturn/coturn
::
:: Requirements: Docker Desktop must be installed and running
:: Download: https://www.docker.com/products/docker-desktop/
::
:: Usage: Double-click this file OR run from Command Prompt
:: ─────────────────────────────────────────────────────────────────────────────

title MeetSpace — Local TURN Server
color 0B

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║       MeetSpace — Local coturn TURN Server          ║
echo  ║       GitHub: github.com/coturn/coturn              ║
echo  ╚══════════════════════════════════════════════════════╝
echo.

:: ── Check Docker is installed ─────────────────────────────────────────────────
docker --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Docker is not installed or not in PATH.
    echo.
    echo  Please install Docker Desktop from:
    echo  https://www.docker.com/products/docker-desktop/
    echo.
    pause
    exit /b 1
)

:: ── Check Docker is running ───────────────────────────────────────────────────
docker info >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Docker Desktop is not running.
    echo  Please start Docker Desktop and try again.
    echo.
    pause
    exit /b 1
)

echo  [OK] Docker is running.
echo.

:: ── Get local IP address ──────────────────────────────────────────────────────
echo  [INFO] Detecting your local IP address...
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1" ^| findstr /v "169.254"') do (
    set LOCAL_IP=%%a
    goto :found_ip
)
:found_ip
:: Trim leading space
set LOCAL_IP=%LOCAL_IP: =%

echo  [INFO] Local IP: %LOCAL_IP%
echo.

:: ── Navigate to TURN Server directory ────────────────────────────────────────
cd /d "%~dp0"

:: ── Stop any existing coturn container ───────────────────────────────────────
echo  [INFO] Stopping any existing TURN server container...
docker stop meetspace-turn-local >nul 2>&1
docker rm meetspace-turn-local >nul 2>&1

:: ── Pull latest coturn image ──────────────────────────────────────────────────
echo  [INFO] Pulling latest coturn image...
docker pull coturn/coturn:latest

:: ── Start coturn with local config ───────────────────────────────────────────
echo.
echo  [INFO] Starting coturn TURN server for LOCAL development...
echo.

docker run -d ^
  --name meetspace-turn-local ^
  --restart unless-stopped ^
  -p 3478:3478/udp ^
  -p 3478:3478/tcp ^
  -p 5349:5349/udp ^
  -p 5349:5349/tcp ^
  -p 49152-49200:49152-49200/udp ^
  -v "%~dp0turnserver-local.conf:/etc/coturn/turnserver.conf:ro" ^
  coturn/coturn:latest ^
  -c /etc/coturn/turnserver.conf

if errorlevel 1 (
    echo.
    echo  [ERROR] Failed to start coturn. Check the error above.
    echo  Common fix: Make sure ports 3478 are not in use.
    echo  Run: netstat -ano ^| findstr :3478
    pause
    exit /b 1
)

echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║   ✅  Local TURN Server is RUNNING!                 ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
echo  STUN/TURN address : %LOCAL_IP%:3478
echo  Container name    : meetspace-turn-local
echo  Config file       : turnserver-local.conf
echo.
echo  ── Your .env should have: ──────────────────────────────
echo  TURN_HOST=%LOCAL_IP%
echo  TURN_PORT=3478
echo  TURN_SECRET=localdevelopmentsecret123
echo.
echo  ── Useful commands: ────────────────────────────────────
echo  View logs  : docker logs -f meetspace-turn-local
echo  Stop       : docker stop meetspace-turn-local
echo  Status     : docker ps
echo.
echo  ── Test credentials: ───────────────────────────────────
echo  node "TURN Server/test-credentials.js"
echo.

:: ── Show live logs ────────────────────────────────────────────────────────────
echo  [INFO] Showing live logs (Ctrl+C to exit logs, server keeps running)...
echo.
docker logs -f meetspace-turn-local
