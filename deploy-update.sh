#!/bin/bash
# =============================================================================
# MeetSpace — Update/Redeploy Script
# Ubuntu 22.04 LTS (Hostinger VPS)
#
# Run this after pushing new code to GitHub:
#   bash /var/www/meetspace/deploy-update.sh
# =============================================================================
set -e

APP_DIR="/var/www/meetspace"
APP_NAME="meetspace"

echo ""
echo "============================================================"
echo "  MeetSpace — Updating deployment"
echo "============================================================"
echo ""

cd "$APP_DIR"

# 1. Pull latest code
echo "[1/4] Pulling latest code from GitHub..."
git pull
echo "   Done."

# 2. Install any new backend dependencies
echo "[2/4] Installing backend dependencies..."
npm install
echo "   Done."

# 3. Rebuild frontend
echo "[3/4] Rebuilding React frontend..."
cd frontend
npm install
npm run build
cd ..
echo "   Frontend rebuilt."

# 4. Restart app
echo "[4/4] Restarting app with PM2..."
pm2 restart "$APP_NAME"
pm2 save
echo "   App restarted."

echo ""
echo "============================================================"
echo "  Update Complete!"
echo "============================================================"
echo ""
pm2 status
echo ""
echo "  Health check: curl https://meetconnect.swiftcampus.com/health"
echo ""
