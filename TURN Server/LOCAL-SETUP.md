# 🏠 Running coturn TURN Server Locally

> Run your own TURN server on your **Windows PC** or **Linux VM** for local development and testing.  
> No VPS needed — works on your own machine!

---

## 📋 Quick Reference

| Environment | Method | Config File | Start Command |
|-------------|--------|-------------|---------------|
| Windows (Docker Desktop) | Docker | `turnserver-local.conf` | `start-turn-local.bat` |
| Linux VM (Ubuntu/Debian) | Docker | `turnserver-local.conf` | `./start-turn-local.sh` |
| Linux VM (native, no Docker) | apt install | `turnserver-local.conf` | `systemctl start coturn` |

---

## 🪟 Option 1 — Windows (Docker Desktop)

### Prerequisites
- **Docker Desktop** installed and running  
  Download: https://www.docker.com/products/docker-desktop/

### Steps

1. **Start Docker Desktop** (look for the whale icon in system tray)

2. **Double-click** `TURN Server/start-turn-local.bat`  
   OR run in Command Prompt:
   ```cmd
   cd "c:\Users\Admin\Downloads\video-call\meet-space"
   "TURN Server\start-turn-local.bat"
   ```

3. **Update your `.env`** in the project root:
   ```env
   TURN_HOST=127.0.0.1
   TURN_PORT=3478
   TURN_SECRET=localdevelopmentsecret123
   TURN_TTL=86400
   ```

4. **Restart your Node.js server** (`app.js`) so it picks up the new `.env`

5. **Test it works:**
   ```cmd
   node "TURN Server/test-credentials.js"
   ```

> ⚠️ **Local limitation:** `127.0.0.1` only works when both browser tabs are on the **same machine**.  
> For testing across devices on your WiFi, see the **LAN Testing** section below.

---

## 🐧 Option 2 — Linux VM (Docker — Recommended)

This works on **Ubuntu, Debian, Fedora, CentOS** — any Linux VM (VirtualBox, VMware, WSL2, etc.)

### Step 1 — Install Docker on your Linux VM

```bash
# One-line install (official Docker script):
curl -fsSL https://get.docker.com | sh

# Add your user to docker group (so you don't need sudo):
sudo usermod -aG docker $USER
newgrp docker

# Verify:
docker --version
```

### Step 2 — Copy the TURN Server files to your Linux VM

**Option A — If your Linux VM shares a folder with Windows:**
```bash
# The files are already accessible via the shared folder
cd /path/to/shared/folder/meet-space
```

**Option B — Copy via SCP from Windows PowerShell:**
```powershell
# Replace VM_IP with your Linux VM's IP (run `ip addr` on the VM to find it)
scp -r "TURN Server" user@VM_IP:/home/user/meetspace-turn
```

**Option C — Clone/copy manually:**
```bash
mkdir -p ~/meetspace-turn
# Then copy turnserver-local.conf and start-turn-local.sh into it
```

### Step 3 — Get your Linux VM's IP address

```bash
# Run this on your Linux VM:
ip addr show | grep "inet " | grep -v 127.0.0.1
# Example output: inet 192.168.1.105/24 ...
# Your VM IP is: 192.168.1.105
```

### Step 4 — Edit `turnserver-local.conf` for your VM IP

```bash
# On your Linux VM, edit the config:
nano ~/meetspace-turn/turnserver-local.conf

# Change this line:
external-ip=127.0.0.1
# To your VM's actual IP:
external-ip=192.168.1.105    # ← replace with your VM's IP
```

### Step 5 — Start coturn via Docker

```bash
cd ~/meetspace-turn

# Make the script executable:
chmod +x start-turn-local.sh

# Run it:
./start-turn-local.sh
```

**Or run Docker directly:**
```bash
docker run -d \
  --name meetspace-turn-local \
  --restart unless-stopped \
  --network host \
  -v $(pwd)/turnserver-local.conf:/etc/coturn/turnserver.conf:ro \
  coturn/coturn:latest \
  -c /etc/coturn/turnserver.conf

# Check it's running:
docker ps
docker logs meetspace-turn-local
```

> 💡 **`--network host`** is used on Linux so coturn binds to the real network interface.  
> This is better than port mapping for TURN servers.

### Step 6 — Update `.env` on Windows (your dev machine)

```env
TURN_HOST=192.168.1.105      # ← your Linux VM's IP
TURN_PORT=3478
TURN_SECRET=localdevelopmentsecret123
TURN_TTL=86400
```

Then restart `app.js`.

---

## 🐧 Option 3 — Linux VM (Native Install — No Docker)

Install coturn directly on Ubuntu/Debian without Docker:

```bash
# Install coturn from apt:
sudo apt update
sudo apt install -y coturn

# Check version:
turnserver --version
```

### Configure coturn

```bash
# Copy the local config:
sudo cp ~/meetspace-turn/turnserver-local.conf /etc/turnserver.conf

# Edit it:
sudo nano /etc/turnserver.conf
# Set external-ip= to your VM's IP address

# Enable coturn service:
sudo nano /etc/default/coturn
# Uncomment this line:
TURNSERVER_ENABLED=1

# Start the service:
sudo systemctl enable coturn
sudo systemctl start coturn

# Check status:
sudo systemctl status coturn

# View logs:
sudo journalctl -u coturn -f
```

### Open firewall ports (if UFW is active):

```bash
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 49152:49200/udp
sudo ufw reload
```

---

## 🌐 LAN Testing (Test Across Devices on Same WiFi)

If you want to test your video call between **two different devices** (e.g., your PC and phone) on the same WiFi network:

### 1. Find your Windows PC's local IP:
```cmd
ipconfig
# Look for: IPv4 Address . . . . . . . . . . : 192.168.1.x
```

### 2. Edit `turnserver-local.conf`:
```ini
# Change from:
external-ip=127.0.0.1
# To your PC's local IP:
external-ip=192.168.1.100    # ← your Windows PC's WiFi IP
```

### 3. Restart the TURN server:
```cmd
docker stop meetspace-turn-local
"TURN Server\start-turn-local.bat"
```

### 4. Update `.env`:
```env
TURN_HOST=192.168.1.100      # ← your Windows PC's WiFi IP
TURN_SECRET=localdevelopmentsecret123
```

### 5. Allow port 3478 through Windows Firewall:
```powershell
# Run PowerShell as Administrator:
New-NetFirewallRule -DisplayName "TURN Server 3478 UDP" -Direction Inbound -Protocol UDP -LocalPort 3478 -Action Allow
New-NetFirewallRule -DisplayName "TURN Server 3478 TCP" -Direction Inbound -Protocol TCP -LocalPort 3478 -Action Allow
New-NetFirewallRule -DisplayName "TURN Relay Ports" -Direction Inbound -Protocol UDP -LocalPort 49152-49200 -Action Allow
```

---

## 🔄 start-turn-local.sh (Linux version of the .bat file)

Save this as `TURN Server/start-turn-local.sh` on your Linux VM:

```bash
#!/usr/bin/env bash
# Start coturn locally on Linux VM via Docker

set -euo pipefail
cd "$(dirname "$0")"

# Get local IP
LOCAL_IP=$(hostname -I | awk '{print $1}')
echo "[TURN] Local IP: $LOCAL_IP"

# Update external-ip in config
sed -i "s/^external-ip=.*/external-ip=$LOCAL_IP/" turnserver-local.conf
echo "[TURN] Set external-ip=$LOCAL_IP in turnserver-local.conf"

# Stop existing container
docker stop meetspace-turn-local 2>/dev/null || true
docker rm meetspace-turn-local 2>/dev/null || true

# Start coturn
docker run -d \
  --name meetspace-turn-local \
  --restart unless-stopped \
  --network host \
  -v "$(pwd)/turnserver-local.conf:/etc/coturn/turnserver.conf:ro" \
  coturn/coturn:latest \
  -c /etc/coturn/turnserver.conf

echo ""
echo "✅ coturn TURN server started!"
echo "   STUN/TURN: $LOCAL_IP:3478"
echo "   Secret:    localdevelopmentsecret123"
echo ""
echo "Update your .env:"
echo "  TURN_HOST=$LOCAL_IP"
echo "  TURN_SECRET=localdevelopmentsecret123"
echo ""
echo "Logs: docker logs -f meetspace-turn-local"
docker logs -f meetspace-turn-local
```

---

## ✅ Verify TURN is Working Locally

### Method 1 — Generate credentials and check output:
```cmd
node "TURN Server/test-credentials.js"
```

### Method 2 — Trickle ICE web tool:
1. Open: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
2. Add server:
   - URI: `turn:127.0.0.1:3478` (or your VM/LAN IP)
   - Username: (copy from test-credentials.js output)
   - Password: (copy from test-credentials.js output)
3. Click **Gather candidates**
4. ✅ Look for **`relay`** type candidates

### Method 3 — Docker logs:
```cmd
docker logs -f meetspace-turn-local
```
Look for lines like: `handle_udp_packet` — these are STUN/TURN requests arriving.

---

## 🛑 Stop the Local TURN Server

```cmd
docker stop meetspace-turn-local
```

Or to remove it completely:
```cmd
docker rm -f meetspace-turn-local
```

---

## ⚠️ Local vs Production Differences

| Feature | Local (this config) | Production (Hostinger VPS) |
|---------|--------------------|-----------------------------|
| `external-ip` | `127.0.0.1` or LAN IP | Real public IP |
| `static-auth-secret` | `localdevelopmentsecret123` | Strong random secret |
| `no-loopback-peers` | Disabled (allows localhost) | Enabled (security) |
| `verbose` logging | Enabled | Disabled |
| Relay port range | 49152–49200 (small) | 49152–65535 (full) |
| Accessible from internet | ❌ No | ✅ Yes |
| TLS certificate | ❌ No | ✅ Yes (Let's Encrypt) |

---

## 🔁 Switching Between Local and Production

In your `.env`, just change `TURN_HOST` and `TURN_SECRET`:

```env
# ── LOCAL DEVELOPMENT ──
TURN_HOST=127.0.0.1
TURN_SECRET=localdevelopmentsecret123

# ── LINUX VM (LAN) ──
# TURN_HOST=192.168.1.105
# TURN_SECRET=localdevelopmentsecret123

# ── PRODUCTION (Hostinger VPS) ──
# TURN_HOST=103.x.x.x
# TURN_SECRET=your_real_64char_secret_here
```

Restart `app.js` after changing `.env`.
