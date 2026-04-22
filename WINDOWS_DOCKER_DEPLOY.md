# MeetSpace — Windows Server Docker Deployment Guide

---

## ⚠️ Critical: Linux Container Mode Required

Your Docker version (20.10.9 on Windows) supports both Windows and Linux containers.
**You MUST use Linux containers** because:
- `coturn/coturn` image is Linux-only
- mediasoup compiles Linux native binaries

**Switch to Linux containers:**
1. Right-click Docker icon in system tray
2. Click **"Switch to Linux containers..."**
3. Wait for Docker to restart

Verify:
```powershell
docker info | findstr "OSType"
# Must show: OSType: linux
```

---

## 🔥 Windows Firewall — Open Required Ports

Run PowerShell as **Administrator**:

```powershell
# HTTP + HTTPS
netsh advfirewall firewall add rule name="MeetSpace HTTP" dir=in action=allow protocol=TCP localport=80
netsh advfirewall firewall add rule name="MeetSpace HTTPS" dir=in action=allow protocol=TCP localport=443

# App port (if not behind reverse proxy)
netsh advfirewall firewall add rule name="MeetSpace App" dir=in action=allow protocol=TCP localport=5001

# coturn STUN/TURN
netsh advfirewall firewall add rule name="coturn UDP" dir=in action=allow protocol=UDP localport=3478
netsh advfirewall firewall add rule name="coturn TCP" dir=in action=allow protocol=TCP localport=3478

# coturn relay ports
netsh advfirewall firewall add rule name="coturn Relay UDP" dir=in action=allow protocol=UDP localport=49152-65535

# mediasoup WebRTC media
netsh advfirewall firewall add rule name="mediasoup WebRTC" dir=in action=allow protocol=UDP localport=40000-49999
```

---

## 📋 Step-by-Step Deployment

### Step 1 — Get your server's public IP

```powershell
curl https://api.ipify.org
# Example output: 103.45.67.89
```

### Step 2 — Clone the repository

```powershell
cd C:\inetpub\wwwroot
git clone https://github.com/Aditi-Rajput-02/meet-space.git meetspace
cd meetspace
```

### Step 3 — Create .env file

```powershell
copy .env.example .env
notepad .env
```

Fill in these values:
```env
PORT=5001
NODE_ENV=production
CLIENT_URL=https://meetconnect.swiftcampus.com

# Your server's PUBLIC IP (from Step 1)
MEDIASOUP_ANNOUNCED_IP=103.45.67.89

MEDIASOUP_RTC_MIN_PORT=40000
MEDIASOUP_RTC_MAX_PORT=49999

# Same IP for TURN
TURN_HOST=103.45.67.89
TURN_PORT=3478
TURN_TLS_PORT=5349

# Generate secret:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
TURN_SECRET=your_generated_secret_here

TURN_TTL=86400
TURN_REALM=meetconnect.swiftcampus.com
```

### Step 4 — Verify Linux container mode

```powershell
docker info | findstr "OSType"
# Must show: OSType: linux
```

### Step 5 — Build and start containers

```powershell
cd C:\inetpub\wwwroot\meetspace

# Build images and start all services
docker compose up -d --build
```

This will:
1. Build the React frontend (inside Docker)
2. Compile mediasoup C++ worker (inside Docker)
3. Start coturn TURN server
4. Start the MeetSpace Node.js app

> ⏱️ First build takes **5-10 minutes** (mediasoup compiles from source)

### Step 6 — Verify containers are running

```powershell
docker compose ps
```

Expected output:
```
NAME              STATUS          PORTS
meetspace-turn    Up (healthy)    0.0.0.0:3478->3478/udp, ...
meetspace-app     Up (healthy)    0.0.0.0:5001->5001/tcp, ...
```

### Step 7 — Check health

```powershell
curl http://localhost:5001/health
```

Expected: `{"status":"ok","timestamp":"...","rooms":0,"mediasoup":true}`

### Step 8 — Set up IIS Reverse Proxy (for HTTPS)

Install **URL Rewrite** and **Application Request Routing** in IIS:

1. Open **IIS Manager**
2. Select your site → **URL Rewrite** → **Add Rule** → **Reverse Proxy**
3. Set inbound rule: forward to `localhost:5001`
4. Enable **WebSocket** support in IIS

Or use the included `web.config`:

```powershell
# Copy web.config to your IIS site root
copy web.config C:\inetpub\wwwroot\meetconnect\web.config
```

### Step 9 — SSL Certificate

Use **Win-ACME** (free Let's Encrypt for Windows/IIS):
```powershell
# Download win-acme from https://www.win-acme.com/
# Run as Administrator:
wacs.exe --target iis --host meetconnect.swiftcampus.com
```

---

## 🔄 Updating the App

```powershell
cd C:\inetpub\wwwroot\meetspace
git pull
docker compose up -d --build
```

---

## 📊 Useful Docker Commands

```powershell
# View running containers
docker compose ps

# View app logs (live)
docker compose logs -f meetspace

# View coturn logs
docker compose logs -f coturn

# Restart app only
docker compose restart meetspace

# Stop everything
docker compose down

# Stop and remove volumes
docker compose down -v

# Check resource usage
docker stats
```

---

## 🆘 Troubleshooting

### "image platform does not match host platform"
```powershell
# You're in Windows container mode — switch to Linux:
# Right-click Docker tray → Switch to Linux containers
docker info | findstr "OSType"   # must be: linux
```

### mediasoup build fails in Docker
```powershell
# Check build logs
docker compose logs meetspace

# Common fix: ensure enough memory for Docker
# Docker Desktop → Settings → Resources → Memory: at least 2GB
```

### Port already in use
```powershell
netstat -ano | findstr :5001
# Kill the process using that PID:
taskkill /PID <PID> /F
```

### Video not flowing (black screen after connecting)
- Check `MEDIASOUP_ANNOUNCED_IP` is your **public** IP (not 192.168.x.x or 127.0.0.1)
- Check Windows Firewall allows UDP 40000-49999
- Check Docker port mapping: `docker compose ps`

### TURN server not working
```powershell
docker compose logs coturn --tail 30
# Check port 3478 is open:
netstat -ano | findstr :3478
```

### WebSocket connection fails
- Ensure IIS has WebSocket Protocol feature installed:
  ```powershell
  Install-WindowsFeature Web-WebSockets
  ```
- Check `web.config` has WebSocket upgrade headers

---

## 📋 Quick Checklist

- [ ] Docker in **Linux container mode** (`docker info | findstr OSType` = linux)
- [ ] Windows Firewall: ports 80, 443, 3478, 5001, 40000-49999/UDP open
- [ ] `.env` created with correct `MEDIASOUP_ANNOUNCED_IP` (public IP)
- [ ] `.env` has strong `TURN_SECRET`
- [ ] `docker compose up -d --build` completed successfully
- [ ] `docker compose ps` shows both containers as "Up (healthy)"
- [ ] `curl http://localhost:5001/health` returns `{"status":"ok"}`
- [ ] IIS reverse proxy configured (port 5001 → domain)
- [ ] SSL certificate installed
- [ ] Test with 2 browsers — both see each other's tiles
