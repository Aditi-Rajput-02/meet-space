# 🔄 Self-Hosted TURN Server — coturn

> **GitHub:** https://github.com/coturn/coturn  
> **Docker Hub:** https://hub.docker.com/r/coturn/coturn

This directory contains everything needed to run your own **TURN/STUN server** for the MeetSpace video-call application using **coturn** — the most widely used open-source TURN server.

---

## 📁 Files in This Directory

| File | Purpose |
|------|---------|
| `turnserver.conf` | coturn configuration (ports, auth, relay settings) |
| `docker-compose.yml` | Docker Compose to run coturn as a container |
| `start-turn.sh` | Helper script to start coturn (Linux/Mac) |
| `test-credentials.js` | Generate & verify HMAC credentials for testing |
| `README.md` | This file |

---

## 🤔 Why Do You Need a TURN Server?

WebRTC uses **ICE (Interactive Connectivity Establishment)** to connect peers:

1. **Direct P2P** — works when both peers are on the same network
2. **STUN** — works when peers are behind simple NAT (most home routers)
3. **TURN** — required when peers are behind **symmetric NAT** or strict firewalls (corporate networks, mobile carriers)

Without a TURN server, ~15–20% of calls will fail to connect. coturn handles both STUN and TURN in one process.

---

## ⚡ Quick Start (5 Steps)

### Step 1 — Get a Server (Hostinger VPS — Recommended for India 🇮🇳)

**Hostinger** is the cheapest option with an **India (Mumbai) data center** — perfect for low-latency TURN relay for Indian users.

#### 🛒 Buy Hostinger KVM 1 VPS (~₹299–₹399/month)

1. Go to: **https://www.hostinger.in/vps-hosting**
2. Choose **KVM 1** plan (cheapest):
   - 1 vCPU, 4GB RAM, 50GB SSD
   - **1TB bandwidth/month** (more than enough)
   - ~₹299–399/month
3. At checkout, select **Location → India (Mumbai)** 🇮🇳
4. Choose **Ubuntu 22.04** as the OS
5. Complete payment — you'll get an email with your **server IP** and **root password**

> ✅ **Why Hostinger?**
> - Cheapest VPS in India with Mumbai data center
> - Low latency for Indian users (~5–15ms vs 100ms+ for US servers)
> - 1TB/month bandwidth is free (TURN relay uses ~1–5GB per hour of calls)
> - No credit card needed — UPI / Paytm / NetBanking accepted

> **Minimum specs needed:** 1 vCPU, 512MB RAM — KVM 1 exceeds this comfortably

### Step 2 — Connect to Your Hostinger VPS

After purchasing, Hostinger sends you the **IP address** and **root password** by email.

**Option A — Use Hostinger's Browser Terminal (easiest, no setup):**
1. Login to [hpanel.hostinger.com](https://hpanel.hostinger.com)
2. Go to **VPS → Manage → Terminal** (browser-based SSH)
3. Login as `root` with your password

**Option B — SSH from your Windows PC:**
```powershell
# Open PowerShell and run (replace with your server IP):
ssh root@YOUR_SERVER_IP
# Enter the root password from your email
```

---

### Step 3 — First-Time Server Setup (run on Hostinger VPS)

Copy-paste these commands one by one into your server terminal:

```bash
# 1. Update the system
apt update && apt upgrade -y

# 2. Install Docker (one command — official script)
curl -fsSL https://get.docker.com | sh

# 3. Verify Docker is running
docker --version

# 4. Open firewall ports for TURN
ufw allow 22/tcp        # SSH (keep this open!)
ufw allow 3478/udp
ufw allow 3478/tcp
ufw allow 5349/udp
ufw allow 5349/tcp
ufw allow 49152:65535/udp
ufw --force enable

# 5. Verify ports are open
ufw status

# 6. Find your server's public IP (save this!)
curl -s ifconfig.me
```

---

### Step 4 — Generate a Secret Key

Run this on your **local machine** (Windows PowerShell):
```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# Example output: a3f8c2d1e4b5a6f7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1
```
**Save this secret — you'll need it in the next step.**

---

### Step 5 — Edit Configuration Files

**Edit `TURN Server/turnserver.conf`** (in VS Code):
```ini
# Replace these two lines with your real values:
external-ip=103.x.x.x                          # ← your Hostinger server IP
static-auth-secret=a3f8c2d1e4b5a6f7c8d9...    # ← the secret from Step 4
realm=meetconnect.swiftcampus.com              # ← your domain (already set)
```

**Edit `.env`** in the project root:
```env
TURN_HOST=103.x.x.x                    # ← same Hostinger server IP
TURN_SECRET=a3f8c2d1e4b5a6f7c8d9...   # ← same secret as turnserver.conf
```

> ⚠️ **The `TURN_SECRET` MUST be identical in both files!**

---

### Step 6 — Upload & Start coturn on Hostinger

**From your Windows PC (PowerShell), upload the TURN Server folder:**
```powershell
# Copy the TURN Server folder to your Hostinger VPS:
scp -r "TURN Server" root@YOUR_SERVER_IP:/root/meetspace-turn
```

**Then on your Hostinger VPS terminal:**
```bash
cd /root/meetspace-turn

# Make the start script executable
chmod +x start-turn.sh

# Start coturn!
./start-turn.sh

# Check it's running:
docker ps
# You should see: meetspace-turn   Up X seconds
```

**Check logs to confirm it started correctly:**
```bash
docker logs meetspace-turn
# Look for: "turnserver process 1 started successfully"
```

---

## ✅ Verify It's Working

### Method 1 — Trickle ICE Web Tool (easiest)

1. Run the credential generator:
   ```bash
   node "TURN Server/test-credentials.js"
   ```
2. Open: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
3. Enter the TURN URI, username, and password from the output
4. Click **"Gather candidates"**
5. ✅ You should see **`relay`** type candidates — TURN is working!

### Method 2 — turnutils_uclient (inside Docker)

```bash
# Generate credentials first:
node "TURN Server/test-credentials.js"

# Then test (replace USERNAME and PASSWORD with the output above):
docker exec meetspace-turn turnutils_uclient \
  -u "1234567890:testuser" \
  -w "base64credentialhere==" \
  YOUR_SERVER_IP
```

### Method 3 — Check Docker logs

```bash
cd "TURN Server"
docker compose logs -f
# Look for: "handle_udp_packet" lines — these are STUN/TURN requests
```

---

## 🔧 Configuration Reference

### `turnserver.conf` Key Settings

```ini
external-ip=1.2.3.4          # Your server's public IP (REQUIRED)
listening-port=3478           # STUN/TURN port
tls-listening-port=5349       # TLS port
min-port=49152                # Relay port range start
max-port=65535                # Relay port range end
use-auth-secret               # Enable HMAC-SHA1 auth (REST API mode)
static-auth-secret=SECRET     # Shared secret (REQUIRED)
credential-lifetime=86400     # Credential TTL (24h)
realm=your-domain.com         # Your domain
no-loopback-peers             # Security: block loopback relay
no-multicast-peers            # Security: block multicast relay
fingerprint                   # Add fingerprint to TURN messages
```

### `.env` Key Settings

```env
TURN_HOST=1.2.3.4             # Server IP or domain
TURN_PORT=3478                # TURN port (match turnserver.conf)
TURN_TLS_PORT=5349            # TLS port (match turnserver.conf)
TURN_SECRET=your-secret       # MUST match static-auth-secret
TURN_TTL=86400                # Credential lifetime in seconds
```

---

## 🔐 How HMAC-SHA1 Credentials Work

The app uses **time-limited credentials** (no database needed):

```
username  = "<unix_expiry_timestamp>:<user_id>"
password  = base64( HMAC-SHA1( shared_secret, username ) )
```

- Credentials auto-expire after `TURN_TTL` seconds
- coturn verifies the HMAC using the same `static-auth-secret`
- No external API calls — everything is computed locally
- Each user gets unique credentials tied to their socket ID

---

## 🐳 Docker Management Commands

```bash
cd "TURN Server"

# Start
docker compose up -d

# Stop
docker compose down

# Restart (after config changes)
docker compose restart

# View logs
docker compose logs -f

# Check status
docker compose ps

# Update to latest coturn image
docker compose pull && docker compose up -d
```

---

## 🔒 Adding TLS (Recommended for Production)

TLS encrypts the TURN signaling and is required for `turns://` URIs.

**Using Let's Encrypt:**
```bash
# On your server (replace with your domain):
sudo apt install certbot
sudo certbot certonly --standalone -d turn.yourdomain.com

# Then uncomment in turnserver.conf:
cert=/etc/letsencrypt/live/turn.yourdomain.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.yourdomain.com/privkey.pem
```

**Uncomment in `docker-compose.yml`:**
```yaml
volumes:
  - ./turnserver.conf:/etc/coturn/turnserver.conf:ro
  - /etc/letsencrypt:/etc/letsencrypt:ro   # ← uncomment this
```

---

## 📊 Bandwidth Estimation

TURN relays all media traffic through your server when P2P fails:

| Concurrent Calls | Estimated Bandwidth |
|-----------------|---------------------|
| 5 calls (10 users) | ~50 Mbps |
| 20 calls (40 users) | ~200 Mbps |
| 50 calls (100 users) | ~500 Mbps |

> Most VPS providers include 1–5 TB/month of bandwidth. For 50 concurrent calls, a $20/month server is sufficient.

---

## 🛠️ Troubleshooting

### TURN not working — no relay candidates

1. Check firewall: ports 3478 UDP/TCP and 49152-65535 UDP must be open
2. Verify `external-ip` in `turnserver.conf` matches your server's real public IP
3. Check logs: `docker compose logs -f | grep -i error`

### Authentication failures

1. Ensure `TURN_SECRET` in `.env` exactly matches `static-auth-secret` in `turnserver.conf`
2. Check server clock sync: `timedatectl` (HMAC credentials are time-sensitive)
3. Run `node "TURN Server/test-credentials.js"` and verify credentials manually

### Container won't start

```bash
docker compose logs coturn
# Common issues:
# - Port already in use: another process on 3478
# - Config syntax error: check turnserver.conf
```

### Clock skew issues

```bash
# Sync server time (Ubuntu/Debian):
sudo timedatectl set-ntp true
sudo systemctl restart systemd-timesyncd
```

---

## 📚 Resources

- **coturn GitHub:** https://github.com/coturn/coturn
- **coturn Wiki:** https://github.com/coturn/coturn/wiki
- **Docker Hub:** https://hub.docker.com/r/coturn/coturn
- **WebRTC ICE explained:** https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity
- **Trickle ICE tester:** https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
- **RFC 8489 (STUN):** https://datatracker.ietf.org/doc/html/rfc8489
- **RFC 8656 (TURN):** https://datatracker.ietf.org/doc/html/rfc8656
