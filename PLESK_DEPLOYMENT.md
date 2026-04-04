# MeetSpace — Plesk Deployment Guide

## Repository Structure (= httpdocs structure)

```
httpdocs/  (= repo root, cloned by Plesk)
├── app.js              ← Node.js backend entry point
├── package.json        ← backend dependencies (uuid ^9.0.1 !)
├── web.config          ← iisnode configuration for IIS/Plesk
├── .env                ← ⚠️ NOT in git — create manually on server
├── .env.example        ← template for .env
├── node_modules/       ← installed by deploy script
├── frontend/
│   ├── src/            ← React source (in git)
│   ├── package.json    ← frontend dependencies
│   ├── vite.config.js
│   ├── .env.example    ← template for frontend .env
│   └── dist/           ← ⚠️ NOT in git — built by deploy script
│       ├── index.html
│       └── assets/
└── .plesk-deploy       ← post-deployment bash script
```

---

## Deployment Flow

```
git push (developer)
   ↓
Plesk pulls from GitHub
   ↓
Plesk runs post-deployment script (.plesk-deploy):
   cd frontend && npm install && npm run build
   cd .. && npm install --omit=dev
   ↓
app.js serves frontend/dist/ as static files
   ↓
LIVE ✅
```

---

## One-Time Server Setup

### 1. Connect GitHub Repo to Plesk

1. Log in to **Plesk** → go to **meetspace.swiftcampus.com**
2. Click **Git** in the domain panel
3. Click **Add Repository**
4. Enter your GitHub repo URL: `https://github.com/Aditi-Rajput02/webRTC.git`
5. Set **Deployment mode** to: `Automatic` (deploys on every push)
6. Set **Document root** to: `/httpdocs` (already set)
7. Click **OK** to clone the repo

### 2. Configure Post-Deployment Script

In Plesk Git settings for the repo:
- Find **Additional deploy actions** (or **Post-deployment script**)
- Enter this command:
  ```bash
  bash .plesk-deploy
  ```
  Or if bash isn't available, use:
  ```bash
  node -e "
    const {execSync}=require('child_process');
    execSync('npm install', {cwd:'frontend', stdio:'inherit'});
    execSync('npm run build', {cwd:'frontend', stdio:'inherit'});
    execSync('npm install --omit=dev', {stdio:'inherit'});
  "
  ```

### 3. Create `.env` on the Server

After the first deploy, create `.env` in `httpdocs/` via Plesk File Manager:

```
PORT=5001
CLIENT_URL=https://meetspace.swiftcampus.com

TURN_URL=turn:openrelay.metered.ca:80
TURN_USERNAME=openrelayproject
TURN_PASSWORD=openrelayproject
```

> ⚠️ This file is NOT in git. You must create it manually on the server.
> See `.env.example` for the template.

### 4. Configure Node.js App in Plesk

1. Go to **meetspace.swiftcampus.com** → **Node.js**
2. Set:
   - **Node.js version**: 18.x or higher
   - **Application root**: `/httpdocs`
   - **Application startup file**: `app.js`
3. Click **Enable Node.js**
4. Click **NPM Install** (or let the deploy script handle it)
5. Click **Restart App**

---

## Subsequent Deployments (Automatic)

Once set up, every `git push` to the main branch will:
1. Plesk pulls the latest code
2. Runs the post-deployment script (builds frontend, installs deps)
3. Restarts the Node.js app automatically

---

## Local Development

### Backend
```bash
cd backend
cp .env.example .env   # edit with local values
npm install
npm run dev            # starts on port 5001
```

### Frontend
```bash
cd frontend
cp .env.example .env   # set VITE_SOCKET_URL=http://localhost:5001
npm install
npm run dev            # starts on port 3000
```

---

## Troubleshooting

### 500 Internal Server Error
- Check iisnode logs in `httpdocs/logs/` via Plesk File Manager
- Common causes:
  - `uuid` version is v13 (ESM-only) — must be `^9.0.1` in `package.json`
  - `node_modules/` not installed — run `npm install --omit=dev` in httpdocs
  - `.env` file missing — create it manually (see Step 3 above)
  - `web.config` missing `<webSocket enabled="false" />` — already fixed

### Frontend shows blank page
- `frontend/dist/` not built — run the deploy script manually
- Check `VITE_SOCKET_URL` in `frontend/.env` points to correct server URL

### Socket.IO not connecting
- Ensure `CLIENT_URL` in `.env` matches the domain exactly
- Ensure `<webSocket enabled="false" />` is in `web.config`

### Health Check
Visit: `https://meetspace.swiftcampus.com/health`
Expected response:
```json
{"status":"ok","timestamp":"...","rooms":0,"iceServers":7}
```
