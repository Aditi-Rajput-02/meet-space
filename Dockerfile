# ─────────────────────────────────────────────────────────────────────────────
# MeetSpace — Dockerfile (Linux container)
#
# ⚠️  Windows Docker must be in LINUX container mode (not Windows containers)
#     Right-click Docker tray icon → "Switch to Linux containers"
#
# Multi-stage build:
#   Stage 1: Build React frontend (node:20-alpine)
#   Stage 2: Run Node.js backend with mediasoup (node:20-slim)
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Build React frontend ────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /build/frontend

# Copy frontend package files first (layer cache)
COPY frontend/package*.json ./
RUN npm install

# Copy frontend source
COPY frontend/ ./

# Build production bundle
# VITE_SOCKET_URL can be overridden at build time:
#   docker compose build --build-arg VITE_SOCKET_URL=https://yourdomain.com
ARG VITE_SOCKET_URL=""
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL

RUN npm run build

# ── Stage 2: Production Node.js app ──────────────────────────────────────────
FROM node:20-slim AS production

# Install build tools required by mediasoup (compiles native C++ Worker)
RUN apt-get update && apt-get install -y \
    build-essential \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy backend package files and install production deps
# mediasoup will compile its C++ worker here
COPY package*.json ./
RUN npm install --omit=dev

# Copy backend source
COPY app.js ./

# Copy built frontend from Stage 1
COPY --from=frontend-builder /build/frontend/dist ./frontend/dist

# App port (WebSocket + HTTP)
EXPOSE 5001

# mediasoup WebRTC UDP ports (must match docker-compose port mapping)
EXPOSE 40000-49999/udp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:5001/health || exit 1

# Start the app
CMD ["node", "app.js"]
