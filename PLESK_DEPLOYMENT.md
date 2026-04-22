# MeetSpace — Plesk Deployment Guide

---

## ⚠️ Can I Deploy mediasoup + coturn on Plesk?

**It depends on what type of Plesk you have:**

| Plesk Type | mediasoup | coturn | Works? |
|------------|-----------|--------|--------|
| **Plesk on VPS** (you have SSH/root) | ✅ Yes | ✅ Yes | ✅ **YES** |
| **Plesk shared hosting** (no SSH/root) | ❌ No | ❌ No | ❌ **NO** |

**Why?** mediasoup needs:
- UDP ports **40000–49999** open (for WebRTC media)
- A **public IP** to announce to clients
- A **long-running Node.js process** (not IIS/iisnode managed)

coturn needs:
- UDP/TCP port **3478** open
- Root access to run Docker or install packages

> **If your Plesk is on a VPS with SSH access → follow this guide.**
> **If your Plesk is shared hosting → use the Hostinger VPS guide in `DEPLOYMENT.md` instead.**

---

## 🖥️ OPTION A — Plesk on VPS (SSH access available) ✅

This is the recommended Plesk setup. You use Plesk for domain/SSL management but run the app directly via SSH (PM2), not through iisnode.

### Step 1 — SSH into your Plesk VPS

```bash
ssh root@YOUR_PLESK_VPS_IP
```

### Step 2 — Install Node.js 20.x (if not already)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs build-essential python3 git
node --version   # v20.x
```

### Step 3 — Install PM2 + Docker

```bash
npm install -g pm2
curl -fsSL https://get.docker.com | sh
systemctl enable docker && systemctl start docker
```

### Step 4 — Open firewall ports

```bash
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 5349/tcp
ufw allow 5349/udp
ufw allow 40000:49999/udp
ufw --force enable
```

> Also open these ports in **Plesk → Firewall** if Plesk manages the firewall.

### Step 5 — Clone repo

```bash
cd /var/www/vhosts/meetconnect.swiftcampus.com/httpdocs
git clone https://github.com/Aditi-Rajput-02/meet-space.git .
```

Or if Plesk already cloned it via Git integration, just `cd` to the httpdocs folder.

### Step 6 — Install dependencies + build frontend

```bash
npm install
cd frontend && npm install && npm run build && cd ..
```

### Step 7 — Create .env

```bash
nano .env
```

```env
PORT=5001
CLIENT_URL=https://meetconnect.swiftcampus.com

# mediasoup — MUST be your VPS public IP
MEDIASOUP_ANNOUNCED_IP=YOUR_VPS_PUBLIC_IP

# coturn TURN server
TURN_HOST=YOUR_VPS_PUBLIC_IP
TURN_PORT=3478
TURN_TLS_PORT=5349
TURN_SECRET=YOUR_STRONG_RANDOM_SECRET
TURN_TTL=86400
```

> Get public IP: `curl ifconfig.me`
> Generate secret: `openssl rand -hex 32`

### Step 8 — Start coturn (Docker)

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

### Step 9 — Start app with PM2

```bash
pm2 start app.js --name meetspace
pm2 save
pm2 startup   # run the printed command to auto-start on reboot
```

### Step 10 — Configure Nginx in Plesk (reverse proxy)

In Plesk → **meetconnect.swiftcampus.com** → **Apache & nginx Settings**:

1. Disable **Apache** (use Nginx only)
2. In **Additional nginx directives**, paste:

```nginx
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
```

3. Click **Apply**

### Step 11 — Enable SSL in Plesk

Plesk → **meetconnect.swiftcampus.com** → **SSL/TLS Certificates** → **Let's Encrypt** → Install

### Step 12 — Verify

```bash
curl https://meetconnect.swiftcampus.com/health
```

Expected: `{"status":"ok","timestamp":"...","rooms":0}`

---

## ❌ OPTION B — Plesk Shared Hosting (iisnode / no SSH)

**mediasoup and coturn CANNOT run on Plesk shared hosting.**

| Requirement | Shared Hosting |
|-------------|---------------|
| UDP ports 40000-49999 | ❌ Blocked |
| Port 3478 UDP for TURN | ❌ Blocked |
| Long-running Node.js process | ❌ iisnode kills idle processes |
| Public IP for mediasoup | ❌ Shared IP, not configurable |
| Docker for coturn | ❌ No root access |

**What you CAN do with Plesk shared hosting:**
- Host the **React frontend** (static files from `frontend/dist/`) only
- Point it to a backend running on a separate VPS

**Frontend-only on Plesk shared hosting:**
1. Build locally: `cd frontend && npm run build`
2. Upload `frontend/dist/` contents to Plesk `httpdocs/` via File Manager
3. In Plesk → **Apache & nginx Settings** → Additional nginx directives:
   ```nginx
   location / {
       try_files $uri $uri/ /index.html;
   }
   ```
4. Set `VITE_SOCKET_URL=https://your-vps-backend.com` in `frontend/.env` before building

---

## 🔄 Updating the App (Plesk VPS)

```bash
cd /var/www/vhosts/meetconnect.swiftcampus.com/httpdocs
git pull
npm install
cd frontend && npm install && npm run build && cd ..
pm2 restart meetspace
```

Or use the deploy script:
```bash
bash deploy-vps.sh
```

---

## 🆘 Troubleshooting

### App not starting
```bash
pm2 logs meetspace --lines 50
```

### mediasoup Worker dies immediately
```bash
# Install build tools
apt-get install -y build-essential python3
# Reinstall mediasoup
npm install mediasoup --build-from-source
```

### Video not flowing (black screen)
- Check `MEDIASOUP_ANNOUNCED_IP` is your **public** VPS IP (not 127.0.0.1)
- Check UDP 40000-49999 is open: `ufw status`

### WebSocket not connecting
- Ensure Nginx has `proxy_set_header Upgrade $http_upgrade` and `Connection "upgrade"`
- Check Plesk nginx config was saved correctly

### TURN server not working
```bash
docker ps                              # check coturn is running
docker logs meetspace-turn --tail 20   # check for errors
ufw status | grep 3478                 # check port is open
```

### Health check
```bash
curl https://meetconnect.swiftcampus.com/health
```

---

## 📋 Quick Checklist (Plesk VPS)

- [ ] SSH access to Plesk VPS confirmed
- [ ] Node.js 20.x + build-essential + python3 installed
- [ ] PM2 installed globally
- [ ] Docker installed and running
- [ ] Firewall: 80, 443, 3478, 5349, 40000-49999/UDP open (ufw + Plesk firewall)
- [ ] Repo cloned and `npm install` done (mediasoup compiled)
- [ ] `frontend/dist/` built
- [ ] `.env` created with correct `MEDIASOUP_ANNOUNCED_IP` (public IP)
- [ ] coturn Docker container running (`docker ps`)
- [ ] PM2 running app.js (`pm2 status`)
- [ ] Plesk Nginx reverse proxy configured (port 5001)
- [ ] SSL certificate installed via Plesk Let's Encrypt
- [ ] `/health` endpoint returns `{"status":"ok"}`
