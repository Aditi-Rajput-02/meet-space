#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# MeetSpace — First-Time VPS Setup Script
# Run this ONCE on a fresh Hostinger VPS (Ubuntu 20.04 / 22.04)
#
# Usage:
#   ssh root@YOUR_VPS_IP
#   curl -fsSL https://raw.githubusercontent.com/YOUR_REPO/main/setup-vps.sh | bash
#   OR copy this file to the VPS and run: bash setup-vps.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

# ── CONFIG — edit these before running ───────────────────────────────────────
DOMAIN="meetconnect.swiftcampus.com"
REPO_URL="https://github.com/Aditi-Rajput-02/meet-space.git"
APP_DIR="/var/www/meetspace"
APP_NAME="meetspace"
APP_PORT=5001
# ─────────────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   MeetSpace — VPS First-Time Setup                   ║"
echo "║   Domain: $DOMAIN"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── 1. System update ─────────────────────────────────────────────────────────
echo "🔄 Updating system packages..."
apt-get update -y
apt-get upgrade -y

# ── 2. Install build tools (required for mediasoup) ──────────────────────────
echo "🔧 Installing build tools..."
apt-get install -y build-essential python3 python3-pip git curl wget ufw nginx

# ── 3. Install Node.js 20.x ──────────────────────────────────────────────────
echo "📦 Installing Node.js 20.x..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
echo "   Node.js: $(node --version)"
echo "   npm:     $(npm --version)"

# ── 4. Install PM2 ───────────────────────────────────────────────────────────
echo "⚙️  Installing PM2..."
npm install -g pm2

# ── 5. Install Docker (for coturn) ───────────────────────────────────────────
echo "🐳 Installing Docker..."
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# ── 6. Configure firewall ─────────────────────────────────────────────────────
echo "🔒 Configuring firewall..."
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
echo "   Firewall rules applied."

# ── 7. Clone the repo ─────────────────────────────────────────────────────────
echo "📥 Cloning repository..."
mkdir -p /var/www
if [ -d "$APP_DIR" ]; then
  echo "   Directory exists, pulling latest..."
  cd "$APP_DIR" && git pull
else
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"

# ── 8. Install backend dependencies ──────────────────────────────────────────
echo "📦 Installing backend dependencies (mediasoup will compile ~2-3 min)..."
npm install

# ── 9. Build frontend ─────────────────────────────────────────────────────────
echo "🔨 Building React frontend..."
cd frontend
npm install
npm run build
cd ..

# ── 10. Get public IP ─────────────────────────────────────────────────────────
PUBLIC_IP=$(curl -s ifconfig.me)
echo ""
echo "🌐 Your VPS public IP: $PUBLIC_IP"

# ── 11. Generate TURN secret ──────────────────────────────────────────────────
TURN_SECRET=$(openssl rand -hex 32)
echo "🔑 Generated TURN secret: $TURN_SECRET"

# ── 12. Create .env ───────────────────────────────────────────────────────────
echo "📝 Creating .env file..."
cat > "$APP_DIR/.env" << EOF
PORT=$APP_PORT
CLIENT_URL=https://$DOMAIN

# mediasoup — your VPS public IP
MEDIASOUP_ANNOUNCED_IP=$PUBLIC_IP

# coturn TURN server
TURN_HOST=$PUBLIC_IP
TURN_PORT=3478
TURN_TLS_PORT=5349
TURN_SECRET=$TURN_SECRET
TURN_TTL=86400
EOF
echo "   .env created at $APP_DIR/.env"
echo "   ⚠️  Save your TURN secret: $TURN_SECRET"

# ── 13. Start coturn TURN server ──────────────────────────────────────────────
echo "📡 Starting coturn TURN server..."
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
  --no-cli \
  --no-tls \
  --no-dtls
echo "   coturn started."

# ── 14. Start app with PM2 ────────────────────────────────────────────────────
echo "🚀 Starting MeetSpace with PM2..."
cd "$APP_DIR"
pm2 delete "$APP_NAME" 2>/dev/null || true
pm2 start app.js --name "$APP_NAME"
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash || true

# ── 15. Configure Nginx ───────────────────────────────────────────────────────
echo "🌐 Configuring Nginx..."
cat > /etc/nginx/sites-available/meetspace << EOF
server {
    listen 80;
    server_name $DOMAIN;

    # Increase timeouts for WebSocket/long-polling
    proxy_read_timeout 86400;
    proxy_send_timeout 86400;

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
EOF

# Remove default nginx site
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/meetspace /etc/nginx/sites-enabled/meetspace
nginx -t
systemctl reload nginx

# ── 16. Get SSL certificate ───────────────────────────────────────────────────
echo "🔐 Getting SSL certificate..."
apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email admin@swiftcampus.com --redirect || \
  echo "⚠️  SSL cert failed — make sure DNS is pointing to $PUBLIC_IP first, then run: certbot --nginx -d $DOMAIN"

# ── 17. Final status ──────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║   ✅  Setup Complete!                                 ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "  App URL:      https://$DOMAIN"
echo "  Health check: https://$DOMAIN/health"
echo "  VPS IP:       $PUBLIC_IP"
echo "  TURN secret:  $TURN_SECRET  ← save this!"
echo ""
echo "  PM2 status:"
pm2 status
echo ""
echo "  Docker (coturn):"
docker ps --filter "name=meetspace-turn" --format "  {{.Names}} — {{.Status}}"
echo ""
echo "  Next steps:"
echo "  1. Point DNS: $DOMAIN → $PUBLIC_IP"
echo "  2. Visit https://$DOMAIN/health"
echo "  3. For future deploys: bash $APP_DIR/deploy-vps.sh"
echo ""
