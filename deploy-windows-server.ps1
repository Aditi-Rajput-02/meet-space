# ─────────────────────────────────────────────────────────────────────────────
# MeetSpace — Windows Server Deployment Script
# Run this on your REMOTE SERVER via SSH or Plesk Terminal
#
# Usage:
#   1. Open SSH or Plesk Terminal on your server
#   2. Run: powershell -ExecutionPolicy Bypass -File deploy-windows-server.ps1
# ─────────────────────────────────────────────────────────────────────────────

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  MeetSpace — Windows Server Deployment" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ── Step 1: Check Docker is in Linux container mode ──────────────────────────
Write-Host "[1/7] Checking Docker..." -ForegroundColor Yellow
$dockerInfo = docker info 2>&1
if ($dockerInfo -match "OSType: linux") {
    Write-Host "  ✅ Docker is in Linux container mode" -ForegroundColor Green
} else {
    Write-Host "  ❌ Docker is NOT in Linux container mode!" -ForegroundColor Red
    Write-Host "     Right-click Docker tray icon → Switch to Linux containers" -ForegroundColor Red
    Write-Host "     Then re-run this script." -ForegroundColor Red
    exit 1
}

# ── Step 2: Get public IP ─────────────────────────────────────────────────────
Write-Host ""
Write-Host "[2/7] Getting server public IP..." -ForegroundColor Yellow
$publicIP = (Invoke-WebRequest -Uri "https://api.ipify.org" -UseBasicParsing).Content.Trim()
Write-Host "  ✅ Public IP: $publicIP" -ForegroundColor Green

# ── Step 3: Clone or update repo ─────────────────────────────────────────────
Write-Host ""
Write-Host "[3/7] Setting up code..." -ForegroundColor Yellow
$deployPath = "C:\meetspace"

if (Test-Path "$deployPath\.git") {
    Write-Host "  Repo exists — pulling latest changes..." -ForegroundColor Gray
    Set-Location $deployPath
    git pull
} else {
    Write-Host "  Cloning repository..." -ForegroundColor Gray
    git clone https://github.com/Aditi-Rajput-02/meet-space.git $deployPath
    Set-Location $deployPath
}
Write-Host "  ✅ Code ready at $deployPath" -ForegroundColor Green

# ── Step 4: Create .env if not exists ────────────────────────────────────────
Write-Host ""
Write-Host "[4/7] Setting up .env..." -ForegroundColor Yellow

if (-not (Test-Path "$deployPath\.env")) {
    # Generate a random TURN secret
    $turnSecret = -join ((1..64) | ForEach-Object { [char](Get-Random -Minimum 97 -Maximum 123) })

    $envContent = @"
PORT=5001
NODE_ENV=production
CLIENT_URL=https://meetconnect.swiftcampus.com

# mediasoup — your server public IP
MEDIASOUP_ANNOUNCED_IP=$publicIP
MEDIASOUP_RTC_MIN_PORT=40000
MEDIASOUP_RTC_MAX_PORT=49999

# coturn TURN server
TURN_HOST=$publicIP
TURN_PORT=3478
TURN_TLS_PORT=5349
TURN_SECRET=$turnSecret
TURN_TTL=86400
TURN_REALM=meetconnect.swiftcampus.com
"@
    $envContent | Out-File -FilePath "$deployPath\.env" -Encoding UTF8
    Write-Host "  ✅ .env created with public IP: $publicIP" -ForegroundColor Green
    Write-Host "  ⚠️  TURN_SECRET auto-generated. Edit .env if needed." -ForegroundColor Yellow
    Write-Host "     File: $deployPath\.env" -ForegroundColor Gray
} else {
    Write-Host "  ✅ .env already exists (skipping)" -ForegroundColor Green
    Write-Host "     Edit manually if needed: notepad $deployPath\.env" -ForegroundColor Gray
}

# ── Step 5: Open Windows Firewall ports ──────────────────────────────────────
Write-Host ""
Write-Host "[5/7] Opening Windows Firewall ports..." -ForegroundColor Yellow

$rules = @(
    @{Name="MeetSpace-HTTP";    Protocol="TCP"; Port="80"},
    @{Name="MeetSpace-HTTPS";   Protocol="TCP"; Port="443"},
    @{Name="MeetSpace-App";     Protocol="TCP"; Port="5001"},
    @{Name="MeetSpace-TURN-UDP";Protocol="UDP"; Port="3478"},
    @{Name="MeetSpace-TURN-TCP";Protocol="TCP"; Port="3478"},
    @{Name="MeetSpace-TURN-TLS-UDP";Protocol="UDP"; Port="5349"},
    @{Name="MeetSpace-TURN-TLS-TCP";Protocol="TCP"; Port="5349"},
    @{Name="MeetSpace-TURN-Relay";Protocol="UDP"; Port="49152-65535"},
    @{Name="MeetSpace-WebRTC";  Protocol="UDP"; Port="40000-49999"}
)

foreach ($rule in $rules) {
    $existing = netsh advfirewall firewall show rule name="$($rule.Name)" 2>&1
    if ($existing -match "No rules match") {
        netsh advfirewall firewall add rule name="$($rule.Name)" dir=in action=allow protocol=$($rule.Protocol) localport=$($rule.Port) | Out-Null
        Write-Host "  ✅ Opened $($rule.Protocol) $($rule.Port) ($($rule.Name))" -ForegroundColor Green
    } else {
        Write-Host "  ⏭️  Already open: $($rule.Protocol) $($rule.Port)" -ForegroundColor Gray
    }
}

# ── Step 6: Build and start Docker containers ─────────────────────────────────
Write-Host ""
Write-Host "[6/7] Building and starting Docker containers..." -ForegroundColor Yellow
Write-Host "  ⏱️  First build takes 5-10 minutes (mediasoup compiles from source)" -ForegroundColor Gray
Write-Host ""

Set-Location $deployPath
docker compose down 2>&1 | Out-Null
docker compose up -d --build

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "  ✅ Containers started!" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "  ❌ Docker compose failed. Check logs:" -ForegroundColor Red
    Write-Host "     docker compose logs meetspace" -ForegroundColor Red
    exit 1
}

# ── Step 7: Health check ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "[7/7] Waiting for app to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

$maxRetries = 6
$retries = 0
$healthy = $false

while ($retries -lt $maxRetries) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:5001/health" -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -eq 200) {
            $healthy = $true
            break
        }
    } catch {}
    $retries++
    Write-Host "  Waiting... ($retries/$maxRetries)" -ForegroundColor Gray
    Start-Sleep -Seconds 5
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan

if ($healthy) {
    Write-Host "  ✅ MeetSpace is LIVE!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Health: http://localhost:5001/health" -ForegroundColor White
    Write-Host "  App:    http://$publicIP`:5001" -ForegroundColor White
    Write-Host ""
    Write-Host "  Next steps:" -ForegroundColor Yellow
    Write-Host "  1. In Plesk: configure Nginx reverse proxy → localhost:5001" -ForegroundColor White
    Write-Host "  2. In Plesk: install Let's Encrypt SSL for your domain" -ForegroundColor White
    Write-Host "  3. Test: https://meetconnect.swiftcampus.com" -ForegroundColor White
} else {
    Write-Host "  ⚠️  App may still be starting. Check:" -ForegroundColor Yellow
    Write-Host "     docker compose ps" -ForegroundColor White
    Write-Host "     docker compose logs meetspace --tail 30" -ForegroundColor White
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
