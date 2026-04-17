#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# start-turn-local.sh — Run coturn TURN server locally on Linux VM
# GitHub: https://github.com/coturn/coturn
#
# Works on: Ubuntu, Debian, Fedora, CentOS, WSL2, VirtualBox VM, VMware VM
#
# Usage:
#   chmod +x start-turn-local.sh
#   ./start-turn-local.sh
#
# Requirements: Docker must be installed
#   curl -fsSL https://get.docker.com | sh
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

echo ""
echo "  ╔══════════════════════════════════════════════════════╗"
echo "  ║    MeetSpace — Local coturn TURN Server (Linux)     ║"
echo "  ║    GitHub: github.com/coturn/coturn                 ║"
echo "  ╚══════════════════════════════════════════════════════╝"
echo ""

# ── Check Docker ──────────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  error "Docker is not installed."
  echo ""
  echo "  Install Docker with one command:"
  echo "  curl -fsSL https://get.docker.com | sh"
  echo ""
  exit 1
fi

if ! docker info &>/dev/null; then
  error "Docker daemon is not running. Start it with:"
  echo "  sudo systemctl start docker"
  exit 1
fi

info "Docker is running ✓"

# ── Detect local IP ───────────────────────────────────────────────────────────
# Try multiple methods to get the primary non-loopback IP
LOCAL_IP=""

# Method 1: hostname -I (most Linux distros)
if command -v hostname &>/dev/null; then
  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || true)
fi

# Method 2: ip route (fallback)
if [[ -z "$LOCAL_IP" ]] && command -v ip &>/dev/null; then
  LOCAL_IP=$(ip route get 8.8.8.8 2>/dev/null | awk '{print $7; exit}' || true)
fi

# Method 3: ifconfig (older systems)
if [[ -z "$LOCAL_IP" ]] && command -v ifconfig &>/dev/null; then
  LOCAL_IP=$(ifconfig | grep "inet " | grep -v "127.0.0.1" | awk '{print $2}' | head -1 || true)
fi

# Fallback to localhost
if [[ -z "$LOCAL_IP" ]]; then
  LOCAL_IP="127.0.0.1"
  warn "Could not detect local IP — using 127.0.0.1 (same-machine testing only)"
fi

info "Detected local IP: ${GREEN}$LOCAL_IP${NC}"

# ── Update external-ip in config ──────────────────────────────────────────────
CONFIG_FILE="$SCRIPT_DIR/turnserver-local.conf"

if [[ ! -f "$CONFIG_FILE" ]]; then
  error "Config file not found: $CONFIG_FILE"
  exit 1
fi

# Replace external-ip line with detected IP
sed -i "s/^external-ip=.*/external-ip=$LOCAL_IP/" "$CONFIG_FILE"
info "Updated turnserver-local.conf: external-ip=$LOCAL_IP"

# ── Stop any existing container ───────────────────────────────────────────────
info "Stopping any existing TURN server container..."
docker stop meetspace-turn-local 2>/dev/null || true
docker rm   meetspace-turn-local 2>/dev/null || true

# ── Pull latest coturn image ──────────────────────────────────────────────────
info "Pulling latest coturn image..."
docker pull coturn/coturn:latest

# ── Start coturn ──────────────────────────────────────────────────────────────
info "Starting coturn TURN server..."

# Use --network host on Linux for proper IP binding (better than port mapping)
docker run -d \
  --name meetspace-turn-local \
  --restart unless-stopped \
  --network host \
  -v "$CONFIG_FILE:/etc/coturn/turnserver.conf:ro" \
  coturn/coturn:latest \
  -c /etc/coturn/turnserver.conf

# ── Verify it started ─────────────────────────────────────────────────────────
sleep 2
if docker ps --filter "name=meetspace-turn-local" --filter "status=running" | grep -q meetspace-turn-local; then
  echo ""
  echo "  ╔══════════════════════════════════════════════════════╗"
  echo "  ║   ✅  Local TURN Server is RUNNING!                 ║"
  echo "  ╚══════════════════════════════════════════════════════╝"
  echo ""
  success "STUN/TURN address : ${GREEN}$LOCAL_IP:3478${NC}"
  success "Container name    : meetspace-turn-local"
  success "Config file       : turnserver-local.conf"
  echo ""
  echo "  ── Update your .env (on your dev machine): ─────────────"
  echo -e "  ${YELLOW}TURN_HOST=$LOCAL_IP${NC}"
  echo -e "  ${YELLOW}TURN_PORT=3478${NC}"
  echo -e "  ${YELLOW}TURN_SECRET=localdevelopmentsecret123${NC}"
  echo ""
  echo "  ── Useful commands: ────────────────────────────────────"
  echo "  docker logs -f meetspace-turn-local   # Live logs"
  echo "  docker stop meetspace-turn-local      # Stop server"
  echo "  docker ps                             # Check status"
  echo ""
  echo "  ── Test credentials: ───────────────────────────────────"
  echo "  node 'TURN Server/test-credentials.js'"
  echo ""
  echo "  ── Trickle ICE test: ───────────────────────────────────"
  echo "  https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/"
  echo "  URI: turn:$LOCAL_IP:3478"
  echo ""
else
  error "coturn failed to start! Check logs:"
  docker logs meetspace-turn-local 2>&1 | tail -20
  exit 1
fi

# ── Show live logs ────────────────────────────────────────────────────────────
info "Showing live logs (Ctrl+C to exit — server keeps running)..."
echo ""
docker logs -f meetspace-turn-local
