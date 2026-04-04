# 🚀 Plesk Deployment Guide — meetspace.swiftcampus.com

> **Server:** Windows Server with Plesk Obsidian (Web Pro Edition)  
> **Node.js:** 18.20.6 (already installed at `C:\Program Files\nodejs\node.exe`)  
> **Domain:** meetspace.swiftcampus.com  
> **Server Root:** `C:\Inetpub\vhosts\swiftcampus.com\meetspace.swiftcampus.com\`  
> **Web Root (httpdocs):** `C:\Inetpub\vhosts\swiftcampus.com\meetspace.swiftcampus.com\httpdocs\`  
> **System User:** swiftcampus-admin

---

## Architecture Overview

```
Browser → https://meetspace.swiftcampus.com
              ↓
         Plesk IIS (SSL termination + reverse proxy via iisnode/ARR)
              ↓
         Node.js app (iisnode → httpdocs/app.js)
              ↓
    Express serves:
    ├── /api/*        → REST API
    ├── /health       → Health check
    ├── /socket.io/*  → WebSocket signaling
    └── /*            → React SPA (httpdocs/dist/)
```

Everything runs as **one Node.js app** on a single domain — no CORS issues, WebSocket works through Plesk's reverse proxy.

---

## Step 1 — Build the Frontend Locally

Before uploading, build the React frontend on your local machine:

```bash
cd frontend
npm install
npm run build
```

This creates `frontend/dist/` with the compiled React app. ✅

---

## Step 2 — Upload Files to Plesk via FTP

### Server Path
All files go directly into:
```
C:\Inetpub\vhosts\swiftcampus.com\meetspace.swiftcampus.com\httpdocs\
```

### Target Structure on Server

```
httpdocs\
├── app.js              ← from backend/app.js
├── package.json        ← from backend/package.json
├── web.config          ← from backend/web.config (required for iisnode)
├── .env                ← from backend/.env
├── node_modules\       ← run npm install on server
└── dist\               ← from frontend/dist/ (entire folder)
    ├── index.html
    └── assets\
```

### What to Upload (FTP)

| Local file | Upload to server as |
|-----------|-------------------|
| `backend/app.js` | `httpdocs/app.js` |
| `backend/package.json` | `httpdocs/package.json` |
| `backend/web.config` | `httpdocs/web.config` |
| `backend/.env` | `httpdocs/.env` |
| `frontend/dist/` (folder) | `httpdocs/dist/` (folder) |

> ❌ Do NOT upload `node_modules/` — install on server instead  
> ❌ Do NOT upload `frontend/src/` — not needed  
> ❌ Do NOT create a `backend/` subfolder on the server

---

## Step 3 — Install Backend Dependencies on Server

In Plesk, go to **meetspace.swiftcampus.com → Files → Terminal** (or use SSH):

```cmd
cd C:\Inetpub\vhosts\swiftcampus.com\meetspace.swiftcampus.com\httpdocs
npm install --omit=dev
```

---

## Step 4 — Configure Node.js in Plesk (Node.js Toolkit)

1. Log in to **Plesk Panel**
2. Search for **"Node.js Toolkit"** → select it for `meetspace.swiftcampus.com`
3. Click **Enable Node.js** (if not already enabled)
4. Set the following:

| Setting | Value |
|---------|-------|
| **Node.js Version** | `18.20.6` |
| **Application Root** | `httpdocs` |
| **Application Startup File** | `app.js` |
| **Application Mode** | `production` |

5. Click **Apply / Save**

> ⚠️ If you get **"app.js does not exist"** — it means `app.js` is not yet uploaded to `httpdocs/`. Upload it via FTP first, then save.

---

## Step 5 — Set Environment Variables in Plesk

In the Node.js settings, under **Environment Variables**, add:

| Variable | Value |
|----------|-------|
| `PORT` | `5001` |
| `CLIENT_URL` | `https://meetspace.swiftcampus.com` |
| `TURN_URL` | `turn:openrelay.metered.ca:80` |
| `TURN_USERNAME` | `openrelayproject` |
| `TURN_PASSWORD` | `openrelayproject` |
| `NODE_ENV` | `production` |

---

## Step 6 — Configure IIS for WebSocket Support

1. In Plesk, go to **meetspace.swiftcampus.com → IIS Settings**
2. Enable **WebSocket Protocol**
3. Enable **Keep-Alive**

> iisnode handles WebSocket proxying automatically once WebSocket is enabled in IIS.

---

## Step 7 — SSL Certificate

1. Go to **meetspace.swiftcampus.com → SSL/TLS Certificates**
2. Click **Get it free** (Let's Encrypt)
3. Check **Redirect from HTTP to HTTPS**
4. Click **Install**

> ✅ HTTPS is **required** for WebRTC (camera/microphone access).

---

## Step 8 — Start the Application

In the Node.js Toolkit panel:
- Click **Restart App** (or **Start App**)

> ⚠️ **IMPORTANT — Do NOT run `npm start` manually in the terminal.**  
> With `web.config` in place, iisnode starts `app.js` automatically on the first browser request.  
> Running `npm start` manually creates a **second process** that conflicts → `EADDRINUSE` port error.  
> If this happens, kill the stuck process:
> ```cmd
> for /f "tokens=5" %a in ('netstat -ano ^| findstr :5001') do taskkill /F /PID %a
> ```

---

## Step 9 — Verify Deployment

| URL | Expected Result |
|-----|----------------|
| `https://meetspace.swiftcampus.com/` | React app loads |
| `https://meetspace.swiftcampus.com/health` | `{"status":"ok","rooms":0,"iceServers":7}` |
| `https://meetspace.swiftcampus.com/api/rooms` | `[]` |
| `https://meetspace.swiftcampus.com/api/ice-servers` | JSON with ICE server list |

---

## Troubleshooting

### "app.js does not exist" in Plesk Node.js Toolkit
- Upload `backend/app.js` to `httpdocs/app.js` via FTP first
- Make sure Application Root is set to `httpdocs` (not `httpdocs/backend`)
- Then click Apply/Save again in Node.js Toolkit

### Port already in use (EADDRINUSE :5001)
- Do NOT run `npm start` manually — iisnode manages the process
- Kill the stuck process via Plesk Terminal:
  ```cmd
  for /f "tokens=5" %a in ('netstat -ano ^| findstr :5001') do taskkill /F /PID %a
  ```
- Then visit the site — iisnode starts `app.js` automatically

### App won't start
- Make sure `web.config` is in `httpdocs/` — iisnode won't work without it
- Make sure `node_modules/` is in `httpdocs/` (run `npm install --omit=dev`)
- Check `httpdocs/logs/` for iisnode error logs

### Frontend shows blank page / 404
- Confirm `httpdocs/dist/index.html` exists
- `app.js` auto-detects `dist/` in the same folder

### WebSocket / Socket.IO errors
- Enable WebSocket Protocol in IIS Settings
- Verify `CLIENT_URL` in `.env` has no trailing slash

### Camera/Microphone not working
- HTTPS must be active — browsers block WebRTC on HTTP

---

## File Checklist

```
Upload to httpdocs\ on the server:

✅ app.js              ← backend/app.js
✅ package.json        ← backend/package.json
✅ web.config          ← backend/web.config  (REQUIRED for iisnode)
✅ .env                ← backend/.env
✅ dist\               ← frontend/dist\ (entire folder)
   ├── index.html
   └── assets\

Run on server:  npm install --omit=dev

❌ node_modules\   (install on server, do not upload)
❌ frontend\src\   (not needed)
❌ backend\        (do NOT create this subfolder on server)
```

---

## Current .env (Production)

```
PORT=5001
CLIENT_URL=https://meetspace.swiftcampus.com

TURN_URL=turn:openrelay.metered.ca:80
TURN_USERNAME=openrelayproject
TURN_PASSWORD=openrelayproject
```

---

## Local Development

Restore `backend/.env` for local dev:

```
PORT=5001
CLIENT_URL=http://localhost:3000
```

`frontend/.env` (build time only):
```
VITE_SOCKET_URL=http://localhost:5001
```

Run: `npm run dev` in both `backend/` and `frontend/` folders.

---

## Quick Reference — Plesk Navigation

| Task | Path in Plesk |
|------|--------------|
| File Manager | meetspace.swiftcampus.com → Files |
| FTP Credentials | meetspace.swiftcampus.com → Connection Info |
| Node.js Settings | Search bar → "Node.js Toolkit" |
| IIS Settings | meetspace.swiftcampus.com → Hosting & DNS → IIS Settings |
| SSL Certificate | meetspace.swiftcampus.com → SSL/TLS Certificates |
| Logs | meetspace.swiftcampus.com → Logs |
| Terminal (SSH) | meetspace.swiftcampus.com → Files → Terminal |
