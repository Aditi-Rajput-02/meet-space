#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# start-turn.sh — Start the self-hosted coturn TURN server via Docker Compose
# GitHub: https://github.com/coturn/coturn
#
# Usage (on your Linux server):
#   chmod +x start-turn.sh
#   ./start-turn.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[TURN]${NC} $*"; }
success() { echo -e "${GREEN}[TURN]${NC} $*"; }
warn()    { echo -e "${YELLOW}[TURN]${NC} $*"; }
error()   { echo -e "${RED}[TURN]${NC} $*" >&2; }

# ── Pre-flight checks ─────────────────────────────────────────────────────────
info "Checking prerequisites..."

if ! command -v docker &>/dev/null; then
  error "Docker is not installed. Install it from https://docs.docker.com/get-docker/"
  exit 1
fi

if ! docker compose version &>/dev/null 2>&1 && ! docker-compose version &>/dev/null 2>&1; then
  error "Docker Compose is not installed."
  exit 1
fi

# Detect compose command (v2 plugin vs standalone)
COMPOSE_CMD="docker compose"
if ! docker compose version &>/dev/null 2>&1; then
  COMPOSE_CMD="docker-compose"
fi

# ── Validate config ───────────────────────────────────────────────────────────
if grep -q "YOUR_SERVER_PUBLIC_IP" turnserver.conf 2>/dev/null; then
  warn "⚠️  turnserver.conf still has placeholder 'YOUR_SERVER_PUBLIC_IP'."
  warn "   Edit TURN Server/turnserver.conf and set external-ip= to your real public IP."
  warn "   Find your public IP: curl -s ifconfig.me"
fi

if grep -q "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET_STRING" turnserver.conf 2>/dev/null; then
  warn "⚠️  turnserver.conf still has the default static-auth-secret."
  warn "   Generate a real secret: openssl rand -hex 32"
  warn "   Then update both turnserver.conf AND your .env TURN_SECRET."
fi

# ── Start coturn ──────────────────────────────────────────────────────────────
info "Pulling latest coturn image..."
$COMPOSE_CMD pull

info "Starting coturn TURN server..."
$COMPOSE_CMD up -d

success "✅ coturn TURN server started!"
echo ""
info "Container: meetspace-turn"
info "STUN/TURN:  UDP/TCP port 3478"
info "TLS TURN:   UDP/TCP port 5349"
info "Relay ports: 49152-65535 (UDP)"
echo ""
info "Useful commands:"
echo "  $COMPOSE_CMD logs -f        # Follow logs"
echo "  $COMPOSE_CMD ps             # Check status"
echo "  $COMPOSE_CMD restart        # Restart after config changes"
echo "  $COMPOSE_CMD down           # Stop the server"
echo ""

# ── Quick connectivity test ───────────────────────────────────────────────────
info "Testing STUN connectivity on localhost:3478..."
sleep 2
if command -v nc &>/dev/null; then
  if nc -zu localhost 3478 2>/dev/null; then
    success "✅ Port 3478 UDP is open and reachable."
  else
    warn "⚠️  Port 3478 UDP test inconclusive (nc may not support UDP well). Check logs."
  fi
fi

info "Run '$COMPOSE_CMD logs -f' to monitor the TURN server."
