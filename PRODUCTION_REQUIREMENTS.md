# MeetSpace — Production Requirements

Everything you need before going live.

---

## 1. 🖥️ SERVER (Hostinger VPS)

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| **OS** | Ubuntu 20.04 LTS | Ubuntu 22.04 LTS |
| **CPU** | 2 vCPU | 4 vCPU |
| **RAM** | 2 GB | 4 GB |
| **Storage** | 20 GB SSD | 40 GB SSD |
| **Bandwidth** | 1 TB/month | 2 TB/month |
| **Public IP** | ✅ Required (static) | ✅ Required (static) |

> **Hostinger plan:** KVM 2 or higher (~$7–12/month)
> mediasoup is CPU-intensive for video encoding — more CPU = more concurrent rooms

---

## 2. 🌐 DOMAIN & DNS

| Requirement | Details |
|-------------|---------|
| **Domain name** | e.g. `meetconnect.swiftcampus.com` |
| **DNS A record** | `meetconnect.swiftcampus.com` → `YOUR_VPS_IP` |
| **DNS propagation** | Wait 5–30 min after changing DNS |
| **SSL certificate** | Free via Let's Encrypt (certbot) — auto-renewed |

> If your domain is on Plesk, add the A record there pointing to your VPS IP.

---

## 3. 🔓 FIREWALL PORTS (must be open on VPS)

| Port | Protocol | Purpose |
|------|----------|---------|
| `22` | TCP | SSH access |
| `80` | TCP | HTTP (redirects to HTTPS) |
| `443` | TCP | HTTPS (Nginx) |
| `3478` | TCP + UDP | STUN/TURN (coturn) |
| `5349` | TCP + UDP | TURNS over TLS (coturn) |
| `40000–49999` | **UDP** | mediasoup WebRTC media ⚠️ critical |

> ⚠️ The UDP range 40000–49999 is **mandatory** for mediasoup. Without it, video/audio will not flow.

---

## 4. 🛠️ SOFTWARE (installed on VPS)

| Software | Version | Purpose |
|----------|---------|---------|
| **Node.js** | 20.x LTS | Run app.js |
| **npm** | 10.x | Package manager |
| **Python 3** | 3.8+ | mediasoup build dependency |
| **GCC / build-essential** | Latest | mediasoup native compilation |
| **PM2** | Latest | Keep Node.js running, auto-restart |
| **Nginx** | Latest | Reverse proxy + SSL termination |
| **Certbot** | Latest | Free SSL certificates (Let's Encrypt) |
| **Docker** | Latest | Run coturn TURN server |
| **Git** | Latest | Pull code from GitHub |

---

## 5. 📦 NODE.JS PACKAGES (auto-installed via npm install)

### Backend (package.json)
| Package | Purpose |
|---------|---------|
| `mediasoup` | SFU — routes video/audio between peers |
| `socket.io` | Real-time signaling |
| `express` | HTTP server |
| `cors` | Cross-origin requests |
| `dotenv` | Environment variables |
| `uuid` | Unique room/message IDs |

### Frontend (frontend/package.json)
| Package | Purpose |
|---------|---------|
| `mediasoup-client` | Browser-side WebRTC via SFU |
| `socket.io-client` | Connect to signaling server |
| `react` + `react-dom` | UI framework |
| `react-router-dom` | Page routing |
| `vite` | Build tool |

---

## 6. 🔑 ENVIRONMENT VARIABLES (.env on VPS)

Create this file at `/var/www/meetspace/.env`:

```env
# ── Server ────────────────────────────────────────────────────────────────────
PORT=5001
CLIENT_URL=https://meetconnect.swiftcampus.com

# ── mediasoup ─────────────────────────────────────────────────────────────────
# MUST be your VPS public IP (not 127.0.0.1)
MEDIASOUP_ANNOUNCED_IP=YOUR_VPS_PUBLIC_IP

# ── coturn TURN Server ────────────────────────────────────────────────────────
TURN_HOST=YOUR_VPS_PUBLIC_IP
TURN_PORT=3478
TURN_TLS_PORT=5349
TURN_SECRET=YOUR_STRONG_RANDOM_SECRET   # generate: openssl rand -hex 32
TURN_TTL=86400
```

> ⚠️ Never commit `.env` to Git. It's in `.gitignore`.

---

## 7. 🐳 COTURN TURN SERVER (Docker)

The TURN server relays WebRTC traffic when peers are behind strict NATs/firewalls.

**Docker command to start it:**
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

**GitHub:** https://github.com/coturn/coturn

---

## 8. 🔐 SSL CERTIFICATE

```bash
certbot --nginx -d meetconnect.swiftcampus.com --non-interactive --agree-tos \
  --email your@email.com --redirect
```

- Free via Let's Encrypt
- Auto-renews every 90 days
- Required for WebRTC (browsers block camera/mic on HTTP)

---

## 9. ⚙️ NGINX CONFIG (reverse proxy)

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

---

## 10. 📋 PRE-LAUNCH CHECKLIST

### Server
- [ ] Hostinger VPS purchased (KVM 2+, Ubuntu 22.04)
- [ ] SSH access working (`ssh root@YOUR_VPS_IP`)
- [ ] Static public IP assigned

### Software
- [ ] Node.js 20.x installed
- [ ] build-essential + python3 installed (for mediasoup)
- [ ] PM2 installed globally
- [ ] Docker installed and running
- [ ] Nginx installed

### Code
- [ ] Repo cloned to `/var/www/meetspace`
- [ ] `npm install` completed (mediasoup compiled)
- [ ] `frontend/dist/` built (`cd frontend && npm run build`)
- [ ] `.env` created with correct values

### Network
- [ ] Port 80, 443 open (TCP)
- [ ] Port 3478 open (TCP + UDP)
- [ ] Port 5349 open (TCP + UDP)
- [ ] Port 40000–49999 open (UDP) ← most important
- [ ] DNS A record: `meetconnect.swiftcampus.com` → VPS IP

### Services
- [ ] coturn Docker container running (`docker ps`)
- [ ] PM2 running app.js (`pm2 status`)
- [ ] Nginx configured and running
- [ ] SSL certificate obtained (certbot)
- [ ] PM2 startup configured (survives reboot)

### Verification
- [ ] `https://meetconnect.swiftcampus.com/health` returns `{"status":"ok"}`
- [ ] Can join a room from browser
- [ ] Video/audio flows between two browser tabs
- [ ] No console errors in browser

---

## 11. ☁️ CLOUD PROVIDERS — INDIA REGION

> mediasoup needs a **VPS with a static public IP** and open UDP ports (40000–49999).
> Serverless platforms (Vercel, Netlify, Railway, Render, Heroku) **do NOT work**.

### ✅ Recommended for India (servers in Mumbai / Bangalore)

| Provider | Plan | Price/month (INR) | Data Center | Best For |
|----------|------|-------------------|-------------|----------|
| **Hostinger VPS** | KVM 2 | ₹600–900 | Mumbai 🇮🇳 | You already have this — **use it** |
| **DigitalOcean** | Droplet 2GB | ₹1,000 | Bangalore 🇮🇳 | Easiest to use, great docs |
| **Vultr** | Cloud Compute 2GB | ₹1,000 | Mumbai 🇮🇳 | Fast SSD, good India latency |
| **AWS EC2** | t3.small | ₹1,200–1,500 | Mumbai 🇮🇳 | Enterprise, complex setup |
| **Google Cloud** | e2-small | ₹1,200 | Mumbai 🇮🇳 | Good if using other GCP services |
| **Azure** | B2s | ₹1,500 | Pune 🇮🇳 | Enterprise, expensive |
| **Hetzner** | CX22 | ₹400–500 | Germany 🇩🇪 | Cheapest globally, no India DC |
| **Linode/Akamai** | Nanode 2GB | ₹1,000 | Mumbai 🇮🇳 | Reliable, good network |

### ❌ Does NOT Work (no UDP ports / serverless)

| Platform | Why |
|----------|-----|
| Vercel | Serverless — no persistent process |
| Netlify | Static only — no backend |
| Railway | No custom UDP port ranges |
| Render | No UDP, no mediasoup |
| Heroku | No UDP, no persistent WebSocket |
| Cloudflare Workers | Edge serverless — no UDP |
| Plesk shared hosting | No raw UDP ports |

### 🏆 Best Choice for India

| Priority | Provider | Reason |
|----------|----------|--------|
| **Already have** | **Hostinger VPS** | Use it — Mumbai DC, cheapest |
| **Best performance** | **DigitalOcean Bangalore** | Lowest latency in India, easiest UI |
| **Cheapest** | **Hetzner** (Germany) | ~₹400/mo but higher latency from India |
| **Enterprise** | **AWS Mumbai** | Most reliable, but complex + costly |

---

## 12. 💰 ESTIMATED MONTHLY COST (India)

| Item | Cost (INR) | Cost (USD) |
|------|-----------|-----------|
| Hostinger KVM 2 VPS (Mumbai) | ₹600–900/mo | ~$7–12/mo |
| Domain (if needed) | ₹100–200/mo | ~$1–2/mo |
| SSL Certificate | **Free** (Let's Encrypt) | Free |
| coturn TURN server | **Free** (self-hosted on VPS) | Free |
| **Total** | **₹700–1,100/mo** | **~$8–14/mo** |

---

## 12. 🆘 SUPPORT COMMANDS

```bash
# Check app status
pm2 status
pm2 logs meetspace --lines 50

# Restart app
pm2 restart meetspace

# Check TURN server
docker ps
docker logs meetspace-turn --tail 20

# Check Nginx
nginx -t
systemctl status nginx

# Check SSL
certbot certificates

# Check open ports
ufw status
ss -tulnp | grep -E '5001|3478|443|80'

# Health check
curl https://meetconnect.swiftcampus.com/health
```
