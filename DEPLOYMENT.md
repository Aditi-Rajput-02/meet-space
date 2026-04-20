# MeetSpace — Complete Deployment Guide
# Hostinger VPS (recommended) + Plesk

---

## ⚡ TL;DR — Which Server for What?

| Component | Where to deploy | Why |
|-----------|----------------|-----|
| **Node.js backend (app.js)** | **Hostinger VPS** | mediasoup needs raw UDP ports (40000-49999) — Plesk/shared hosting blocks these |
| **React frontend (dist/)** | **Hostinger VPS** (served by app.js) OR Plesk static hosting | VPS is simpler (one server) |
| **coturn TURN server** | **Hostinger VPS** (Docker) | Needs UDP 3478 open |

> **Bottom line:** Deploy everything on the Hostinger VPS. Use Plesk only if you want to host the frontend separately as a static site.

---

## 🖥️ OPTION A — Full Deploy on Hostinger VPS (Recommended)

### Why VPS for mediasoup?
mediasoup requires:
- Raw UDP ports (40000–49999) for WebRTC media
- A public IP to announce to clients
- Long-running Node.js process (not serverless/shared)

Plesk shared hosting **cannot** open raw UDP ports. VPS can.

---

### Step 1 — SSH into your Hostinger VPS

```bash
ssh root@YOUR_VPS_IP
```

---

### Step 2 — Install Node.js 20.x

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node --version   # should be v20.x
npm --version
```

---

### Step 3 — Install mediasoup build dependencies

mediasoup compiles native C++ code — these are required:

```bash
apt-get install -y build-essential python3 python3-pip git
```

---

### Step 4 — Install PM2 (process manager)

```bash
npm install -g pm2
```

---

### Step 5 — Clone your repo

```bash
cd /var/www
git clone git@github-work:Aditi-Rajput-02/meet-space.git meetspace
cd meetspace
```

Or via HTTPS:
```bash
git clone https://github.com/Aditi-Rajput-02/meet-space.git meetspace
cd meetspace
```

---

### Step 6 — Install backend dependencies

```bash
npm install
```

> mediasoup will compile its native Worker binary here (~2-3 min first time).

---

### Step 7 — Build the frontend

```bash
cd frontend
npm install
npm run build
cd ..
```

---

### Step 8 — Create .env on the server

```bash
nano .env
```

Paste and fill in your values:

```env
PORT=5001
CLIENT_URL=https://meetconnect.swiftcampus.com

# mediasoup — MUST be your VPS public IP
MEDIASOUP_ANNOUNCED_IP=YOUR_VPS_PUBLIC_IP

# coturn TURN server (running on same VPS via Docker)
TURN_HOST=YOUR_VPS_PUBLIC_IP
TURN_PORT=3478
TURN_TLS_PORT=5349
TURN_SECRET=YOUR_STRONG_RANDOM_SECRET
TURN_TTL=86400
```

> Get your VPS public IP: `curl ifconfig.me`
> Generate a strong secret: `openssl rand -hex 32`

---

### Step 9 — Open firewall ports

```bash
# Allow HTTP/HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Allow Node.js app port
ufw allow 5001/tcp

# Allow TURN server
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 5349/tcp
ufw allow 5349/udp

# Allow mediasoup WebRTC media ports
ufw allow 40000:49999/udp

ufw enable
ufw status
```

---

### Step 10 — Start the coturn TURN server (Docker)

```bash
# Install Docker if not already installed
curl -fsSL https://get.docker.com | sh

# Start coturn
cd "TURN Server"
bash start-turn-production.bat   # or run the docker command directly:
```

Or run coturn directly:
```bash
docker run -d \
  --name meetspace-turn \
  --network=host \
  --restart=always \
  coturn/coturn \
  -n \
  --log-file=stdout \
  --min-port=49152 \
  --max-port=65535 \
  --use-auth-secret \
  --static-auth-secret=YOUR_STRONG_RANDOM_SECRET \
  --realm=meetconnect.swiftcampus.com \
  --no-cli \
  --no-tls \
  --no-dtls
```

---

### Step 11 — Start the Node.js app with PM2

```bash
cd /var/www/meetspace
pm2 start app.js --name meetspace
pm2 save
pm2 startup   # follow the printed command to auto-start on reboot
```

Check it's running:
```bash
pm2 status
pm2 logs meetspace
```

---

### Step 12 — Set up Nginx as reverse proxy (HTTPS)

```bash
apt-get install -y nginx certbot python3-certbot-nginx
```

Create Nginx config:
```bash
nano /etc/nginx/sites-available/meetspace
```

Paste:
```nginx
server {
    listen 80;
    server_name meetconnect.swiftcampus.com;

    location / {
        proxy_pass http://localhost:5001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }
}
```

Enable and get SSL:
```bash
ln -s /etc/nginx/sites-available/meetspace /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

# Get free SSL certificate
certbot --nginx -d meetconnect.swiftcampus.com
```

---

### Step 13 — Point your domain to the VPS

In your domain DNS settings (wherever meetconnect.swiftcampus.com is managed):

```
Type: A
Name: meetconnect  (or @ for root)
Value: YOUR_VPS_PUBLIC_IP
TTL: 300
```

---

### Step 14 — Verify deployment

```bash
curl https://meetconnect.swiftcampus.com/health
```

Expected:
```json
{"status":"ok","timestamp":"...","rooms":0,"mediasoup":true}
```

---

### Updating the app (future deployments)

```bash
cd /var/www/meetspace
git pull
npm install
cd frontend && npm install && npm run build && cd ..
pm2 restart meetspace
```

Or create a deploy script:
```bash
nano deploy.sh
```
```bash
#!/bin/bash
set -e
cd /var/www/meetspace
git pull
npm install
cd frontend && npm install && npm run build && cd ..
pm2 restart meetspace
echo "✅ Deployed successfully"
```
```bash
chmod +x deploy.sh
./deploy.sh
```

---

## 🌐 OPTION B — Frontend on Plesk, Backend on VPS

Use this if you want Plesk to handle the domain/SSL for the frontend only.

### Backend (VPS)
Follow Steps 1–11 above. The backend runs on `https://api.meetconnect.swiftcampus.com` or a separate port.

### Frontend (Plesk)

1. Build locally:
   ```bash
   cd frontend
   npm run build
   ```

2. In `frontend/.env` before building, set:
   ```env
   VITE_SOCKET_URL=https://api.meetconnect.swiftcampus.com
   ```

3. Upload `frontend/dist/` contents to Plesk `httpdocs/` via:
   - Plesk File Manager, OR
   - FTP/SFTP, OR
   - Git (set document root to `frontend/dist`)

4. In Plesk → **meetconnect.swiftcampus.com** → **SSL/TLS** → enable Let's Encrypt

5. In Plesk → **Apache & nginx Settings** → add to nginx config:
   ```nginx
   location / {
       try_files $uri $uri/ /index.html;
   }
   ```
   (This makes React Router work — all routes serve index.html)

---

## 🔧 Environment Variables Reference

### Backend `.env` (on VPS)

```env
# Server
PORT=5001
CLIENT_URL=https://meetconnect.swiftcampus.com

# mediasoup — REQUIRED: your VPS public IP
MEDIASOUP_ANNOUNCED_IP=103.x.x.x

# coturn TURN server
TURN_HOST=103.x.x.x
TURN_PORT=3478
TURN_TLS_PORT=5349
TURN_SECRET=your-strong-secret-here
TURN_TTL=86400
```

### Frontend `.env` (only needed for separate frontend deploy)

```env
# Leave empty if frontend is served by the same Node.js server
# Set this only if frontend is on a different server/domain
VITE_SOCKET_URL=https://meetconnect.swiftcampus.com
```

---

## 🚨 Common Issues

### mediasoup Worker fails to start
```
Error: worker process died unexpectedly
```
**Fix:** Install build tools: `apt-get install -y build-essential python3`

### WebRTC media not flowing (black video)
**Fix:** `MEDIASOUP_ANNOUNCED_IP` must be your **public** VPS IP, not `127.0.0.1`

### TURN server not working
**Fix:** Ensure ports 3478 UDP/TCP and 49152-65535 UDP are open in firewall

### Port 5001 already in use
```bash
pm2 delete meetspace
pm2 start app.js --name meetspace
```

### SSL certificate issues
```bash
certbot renew --dry-run
```

---

## 📋 Quick Checklist

- [ ] VPS has Node.js 20.x installed
- [ ] Build tools installed (`build-essential`, `python3`)
- [ ] `npm install` run (mediasoup compiled)
- [ ] `frontend/dist/` built
- [ ] `.env` created with correct `MEDIASOUP_ANNOUNCED_IP` (public IP)
- [ ] Firewall: ports 80, 443, 5001, 3478, 40000-49999/UDP open
- [ ] coturn Docker container running
- [ ] PM2 running `app.js`
- [ ] Nginx reverse proxy configured
- [ ] SSL certificate obtained
- [ ] DNS A record pointing to VPS IP
- [ ] `/health` endpoint returns `{"status":"ok"}`
