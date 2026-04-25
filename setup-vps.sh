#!/bin/bash
# =============================================================================
# MeetSpace — First-Time Setup Script
# Ubuntu 22.04 LTS (Hostinger VPS)
#
# Usage:
#   ssh root@YOUR_VPS_IP
#   git clone https://github.com/Aditi-Rajput-02/meet-space.git /var/www/meetspace
#   cd /var/www/meetspace
#   bash setup-vps.sh
# =============================================================================
set -e

# ── CONFIG — edit these before running ───────────────────────────────────────
DOMAIN="meetconnect.swiftcampus.com"
EMAIL="admin@swiftcampus.com"
REPO_URL="https://github.com/Aditi-Rajput-02/meet-space.git"
APP_DIR="/var/www/meetspace"
APP_NAME="meetspace"
APP_PORT=5001
# =============================================================================

echo ""
echo "============================================================"
echo "  MeetSpace — Ubuntu 22.04 Setup (Hostinger VPS)"
echo "  Domain: $DOMAIN"
echo "============================================================"
echo ""

# ── 1. System update ─────────────────────────────────────────────────────────
echo "[1/16] Updating system packages..."
apt-get update -y && apt-get upgrade -y

# ── 2. Install build tools (required for mediasoup native compile) ───────────
echo "[2/16] Installing build tools..."
apt-get install -y \
  build-essential \
  python3 \
  python3-pip \
  git \
  curl \
  wget \
  ufw \
  nginx \
  openssl

# ── 3. Install Node.js 20.x LTS ──────────────────────────────────────────────
echo "[3/16] Installing Node.js 20.x..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
echo "   Node.js: $(node --version)"
echo "   npm:     $(npm --version)"

# ── 4. Install PM2 ───────────────────────────────────────────────────────────
echo "[4/16] Installing PM2..."
npm install -g pm2

# ── 5. Install Docker (for coturn TURN server) ───────────────────────────────
echo "[5/16] Installing Docker..."
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker
echo "   Docker: $(docker --version)"

# ── 6. Configure UFW firewall ─────────────────────────────────────────────────
echo "[6/16] Configuring firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow $APP_PORT/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 5349/tcp
ufw allow 5349/udp
ufw allow 40000:49999/udp
ufw --force enable
echo "   Firewall configured."

# ── 7. Clone or update repo ───────────────────────────────────────────────────
echo "[7/16] Setting up repository..."
mkdir -p /var/www
if [ -d "$APP_DIR/.git" ]; then
  echo "   Repo exists, pulling latest..."
  cd "$APP_DIR" && git pull
else
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# ── 8. Install backend dependencies ──────────────────────────────────────────
echo "[8/16] Installing backend dependencies..."
echo "   (mediasoup compiles from source — takes 2-5 minutes)"
npm install

# ── 9. Build React frontend ───────────────────────────────────────────────────
echo "[9/16] Building React frontend..."
cd frontend
npm install
npm run build
cd ..
echo "   Frontend built at: $APP_DIR/frontend/dist"

# ── 10. Get public IP ─────────────────────────────────────────────────────────
echo "[10/16] Detecting public IP..."
PUBLIC_IP=$(curl -s https://api.ipify.org || curl -s ifconfig.me)
echo "   Public IP: $PUBLIC_IP"

# ── 11. Generate TURN secret ──────────────────────────────────────────────────
echo "[11/16] Generating TURN secret..."
TURN_SECRET=$(openssl rand -hex 32)

# ── 12. Create .env file ──────────────────────────────────────────────────────
echo "[12/16] Creating .env file..."
cat > "$APP_DIR/.env" << EOF
PORT=$APP_PORT
NODE_ENV=production
CLIENT_URL=https://$DOMAIN

# mediasoup — must be your VPS public IP
MEDIASOUP_ANNOUNCED_IP=$PUBLIC_IP
MEDIASOUP_RTC_MIN_PORT=40000
MEDIASOUP_RTC_MAX_PORT=49999

# coturn TURN server
TURN_HOST=$PUBLIC_IP
TURN_PORT=3478
TURN_TLS_PORT=5349
TURN_SECRET=$TURN_SECRET
TURN_TTL=86400
TURN_REALM=$DOMAIN
EOF
echo "   .env created."

# ── 13. Start coturn TURN server via Docker ───────────────────────────────────
echo "[13/16] Starting coturn TURN server..."
docker stop meetspace-turn 2>/dev/null || true
docker rm meetspace-turn 2>/dev/null || true
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
  --static-auth-secret="$TURN_SECRET" \
  --realm="$DOMAIN" \
  --external-ip="$PUBLIC_IP" \
  --no-cli \
  --no-tls \
  --no-dtls
echo "   coturn started."

# ── 14. Start app with PM2 ────────────────────────────────────────────────────
echo "[14/16] Starting MeetSpace with PM2..."
cd "$APP_DIR"
pm2 delete "$APP_NAME" 2>/dev/null || true
pm2 start app.js --name "$APP_NAME" --env production
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash || true
echo "   PM2 started."

# ── 15. Configure Nginx reverse proxy ─────────────────────────────────────────
echo "[15/16] Configuring Nginx..."
cat > /etc/nginx/sites-available/meetspace << NGINX
server {
    listen 80;
    server_name $DOMAIN;

    # WebSocket + long-poll timeouts
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;
    proxy_connect_timeout 60;

    # Increase buffer for WebRTC signaling
    proxy_buffer_size 128k;
    proxy_buffers 4 256k;

    location / {
        proxy_pass http://localhost:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
NGINX

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/meetspace /etc/nginx/sites-enabled/meetspace
nginx -t && systemctl reload nginx
echo "   Nginx configured."

# ── 16. Install SSL certificate (Let's Encrypt) ───────────────────────────────
echo "[16/16] Installing SSL certificate..."
apt-get install -y certbot python3-certbot-nginx
certbot --nginx \
  -d "$DOMAIN" \
  --non-interactive \
  --agree-tos \
  --email "$EMAIL" \
  --redirect || echo "   WARNING: SSL failed. Make sure DNS $DOMAIN -> $PUBLIC_IP is set, then run: certbot --nginx -d $DOMAIN"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo "  Setup Complete!"
echo "============================================================"
echo ""
echo "  App URL:      https://$DOMAIN"
echo "  Health check: https://$DOMAIN/health"
echo "  VPS IP:       $PUBLIC_IP"
echo ""
echo "  IMPORTANT — Save your TURN secret:"
echo "  TURN_SECRET=$TURN_SECRET"
echo ""
echo "  PM2 status:"
pm2 status
echo ""
echo "  Docker (coturn):"
docker ps --filter "name=meetspace-turn" --format "  {{.Names}} - {{.Status}}"
echo ""
echo "  Next steps:"
echo "  1. Make sure DNS: $DOMAIN -> $PUBLIC_IP"
echo "  2. Test: curl https://$DOMAIN/health"
echo "  3. For future updates: bash $APP_DIR/deploy-update.sh"
echo ""
