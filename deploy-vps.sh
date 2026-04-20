#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# MeetSpace — VPS Deploy Script
# Run this on your Hostinger VPS after first-time setup.
# Usage:  bash deploy-vps.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

APP_DIR="/var/www/meetspace"
APP_NAME="meetspace"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   MeetSpace — Deploying to VPS           ║"
echo "╚══════════════════════════════════════════╝"
echo ""

cd "$APP_DIR"

echo "📥 Pulling latest code..."
git pull

echo "📦 Installing backend dependencies..."
npm install

echo "🔨 Building frontend..."
cd frontend
npm install
npm run build
cd ..

echo "♻️  Restarting app with PM2..."
pm2 restart "$APP_NAME" 2>/dev/null || pm2 start app.js --name "$APP_NAME"
pm2 save

echo ""
echo "✅ Deployment complete!"
echo "🔗 Health check: curl https://meetconnect.swiftcampus.com/health"
echo ""
pm2 status
