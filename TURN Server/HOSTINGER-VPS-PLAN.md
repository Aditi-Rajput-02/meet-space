# 🖥️ Hostinger VPS Plan — mediasoup SFU + coturn TURN

> This document answers: **"Can I host mediasoup SFU and coturn TURN on one VPS?"**  
> Short answer: **Yes — but you need the right plan.**

---

## 🧠 Understanding the Two Services

| Service | What it does | CPU | RAM | Bandwidth |
|---------|-------------|-----|-----|-----------|
| **coturn** (TURN) | Relays media packets when P2P fails | Very low (~1–2%) | ~50MB | Only used as fallback (~20% of calls) |
| **mediasoup** (SFU) | Receives ALL streams, re-sends to each participant | **HIGH** (~1 core per 50 streams) | ~500MB–2GB | ALL call traffic passes through it |

> ⚠️ **Key difference:** TURN is a fallback relay (light). SFU handles 100% of media (heavy).  
> With SFU, every participant sends their stream to the server, and the server sends N copies out.  
> A 6-person room = 6 incoming + 30 outgoing streams = 36 streams through your VPS.

---

## 📦 Hostinger VPS Plans — Which One Do You Need?

| Plan | vCPU | RAM | Bandwidth | Price | Verdict |
|------|------|-----|-----------|-------|---------|
| **KVM 1** | 1 | 4 GB | 1 TB/mo | ~₹299/mo | ❌ Too small for SFU |
| **KVM 2** | 2 | 8 GB | 2 TB/mo | ~₹599/mo | ✅ **TURN + SFU (up to ~20 users)** |
| **KVM 4** | 4 | 16 GB | 4 TB/mo | ~₹1,199/mo | ✅✅ **TURN + SFU (up to ~50 users)** |
| **KVM 8** | 8 | 32 GB | 8 TB/mo | ~₹2,399/mo | 🚀 Production (100+ users) |

---

## ✅ Recommended Plan by Use Case

### 🧪 Development / Testing (you + a few friends)
```
Plan:    Hostinger KVM 2
vCPU:    2
RAM:     8 GB
Cost:    ~₹599/month
Hosts:   coturn TURN + mediasoup SFU + Node.js signaling server
Capacity: ~3–5 simultaneous rooms (6 users each)
```

### 🏢 Small Production (startup / school / team)
```
Plan:    Hostinger KVM 4
vCPU:    4
RAM:     16 GB
Cost:    ~₹1,199/month
Hosts:   coturn TURN + mediasoup SFU + Node.js signaling server
Capacity: ~10–15 simultaneous rooms (6 users each)
```

### 🚀 Scaling (separate servers)
```
Server 1 (KVM 1 ~₹299/mo):  coturn TURN only
Server 2 (KVM 4 ~₹1,199/mo): mediasoup SFU + Node.js signaling
Benefit: TURN and SFU don't compete for CPU/RAM
```

---

## 🏗️ Architecture on One KVM 2 VPS

```
┌─────────────────────────────────────────────────────┐
│              Hostinger KVM 2 VPS (India)            │
│                  2 vCPU  |  8 GB RAM                │
│                                                     │
│  ┌─────────────────┐   ┌─────────────────────────┐  │
│  │   coturn TURN   │   │    mediasoup SFU         │  │
│  │   (Docker)      │   │    (Node.js / Docker)    │  │
│  │   Port 3478     │   │    Port 2200 (RTC)       │  │
│  │   Port 5349     │   │    Port 3000 (API)       │  │
│  │   ~50MB RAM     │   │    ~1–2 GB RAM           │  │
│  └─────────────────┘   └─────────────────────────┘  │
│                                                     │
│  ┌─────────────────────────────────────────────────┐ │
│  │   Node.js Signaling Server (app.js)             │ │
│  │   Port 5001                                     │ │
│  │   ~200MB RAM                                    │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## 📡 Port Map (open all of these in Hostinger firewall)

| Port | Protocol | Service | Purpose |
|------|----------|---------|---------|
| 22 | TCP | SSH | Server management |
| 80 | TCP | Nginx | HTTP (redirect to HTTPS) |
| 443 | TCP | Nginx | HTTPS / WSS |
| 5001 | TCP | Node.js | Signaling server (if exposed directly) |
| 3478 | UDP+TCP | coturn | STUN / TURN |
| 5349 | UDP+TCP | coturn | TURN over TLS |
| 2200 | UDP | mediasoup | WebRTC media (RTC port) |
| 40000–49999 | UDP | mediasoup | mediasoup RTC port range |
| 49152–65535 | UDP | coturn | TURN relay port range |

> ⚠️ **Note:** mediasoup and coturn use different UDP port ranges — they don't conflict.

---

## 🐳 Docker Compose — Both Services Together

Save this as `/root/meetspace-infra/docker-compose.yml` on your VPS:

```yaml
# ─────────────────────────────────────────────────────────────────────────────
# MeetSpace Infrastructure — coturn TURN + mediasoup SFU
# Run on Hostinger KVM 2+ (India, Mumbai)
# ─────────────────────────────────────────────────────────────────────────────

services:

  # ── coturn TURN Server ──────────────────────────────────────────────────────
  coturn:
    image: coturn/coturn:latest
    container_name: meetspace-turn
    restart: unless-stopped
    network_mode: host          # Required for correct IP binding on Linux
    volumes:
      - ./turnserver.conf:/etc/coturn/turnserver.conf:ro
    command: -c /etc/coturn/turnserver.conf
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: "0.5"
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  # ── mediasoup SFU ───────────────────────────────────────────────────────────
  # GitHub: https://github.com/versatica/mediasoup
  # Using mediasoup-demo as a ready-made server:
  # https://github.com/versatica/mediasoup-demo
  mediasoup:
    image: node:20-alpine
    container_name: meetspace-sfu
    restart: unless-stopped
    working_dir: /app
    volumes:
      - ./mediasoup-server:/app
    command: node server.js
    environment:
      - MEDIASOUP_LISTEN_IP=0.0.0.0
      - MEDIASOUP_ANNOUNCED_IP=${VPS_PUBLIC_IP}   # Set in .env
      - MEDIASOUP_MIN_PORT=40000
      - MEDIASOUP_MAX_PORT=49999
      - MEDIASOUP_RTC_PORT=2200
    ports:
      - "3000:3000"             # mediasoup HTTP API / WebSocket
      - "2200:2200/udp"         # RTC UDP
      - "40000-49999:40000-49999/udp"  # RTC port range
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: "1.5"
    logging:
      driver: "json-file"
      options:
        max-size: "20m"
        max-file: "5"
```

---

## 💰 Cost Summary

| Setup | Monthly Cost | Max Users | Best For |
|-------|-------------|-----------|---------|
| KVM 1 (TURN only) | ₹299 | Unlimited (relay only) | TURN fallback only |
| KVM 2 (TURN + SFU) | ₹599 | ~20 concurrent | Dev / small teams |
| KVM 4 (TURN + SFU) | ₹1,199 | ~50 concurrent | Production |
| KVM 1 + KVM 2 (split) | ₹898 | ~30 concurrent | Better isolation |

---

## 🆚 SFU vs TURN — When Is Each Used?

```
Without SFU (current app — mesh P2P):
  User A ──────────────────────────── User B
  User A ──────────────────────────── User C
  User A ──────────────────────────── User D
  (Each user uploads N-1 streams — bad for mobile/slow connections)

With SFU (mediasoup):
  User A ──► SFU Server ──► User B
                       ──► User C
                       ──► User D
  (Each user uploads only 1 stream — server handles distribution)

TURN is still needed even with SFU:
  User A ──► [TURN relay] ──► SFU Server
  (When User A is behind symmetric NAT, TURN relays to the SFU)
```

---

## 📋 Setup Order (Recommended)

1. **Buy Hostinger KVM 2** (India/Mumbai, Ubuntu 22.04)
2. **Set up coturn TURN** first (simpler, test it works)
3. **Set up mediasoup SFU** second (more complex)
4. **Update `app.js`** to use mediasoup instead of mesh P2P
5. **Test** with the Trickle ICE tool + a real call

---

## 📚 mediasoup Resources

- **GitHub:** https://github.com/versatica/mediasoup
- **mediasoup-demo (ready server):** https://github.com/versatica/mediasoup-demo
- **Documentation:** https://mediasoup.org/documentation/
- **Node.js API:** https://mediasoup.org/documentation/v3/mediasoup/api/

---

## ⚡ Quick Decision Guide

```
Q: How many simultaneous users do you expect?

  < 10 users  → KVM 2 (₹599/mo) — TURN + SFU on same server ✅
  10–30 users → KVM 4 (₹1,199/mo) — TURN + SFU on same server ✅
  30–100 users → KVM 4 for SFU + KVM 1 for TURN (separate) ✅
  100+ users  → Multiple KVM 8 servers + load balancer 🚀

Q: Do I need SFU right now?

  If your rooms have ≤ 4 people → Mesh P2P is fine, TURN is enough
  If your rooms have 5+ people  → SFU is strongly recommended
  (Each extra peer in mesh = N more upload streams from every user)
```
