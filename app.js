require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

// ─── SECURITY HEADERS ────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ─── SIMPLE IN-MEMORY RATE LIMITER ───────────────────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 60; // max 60 requests per minute per IP

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress;
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };

  if (now - entry.start > RATE_LIMIT_WINDOW_MS) {
    entry.count = 1;
    entry.start = now;
  } else {
    entry.count++;
  }

  rateLimitMap.set(ip, entry);

  if (entry.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }
  next();
}

// Clean up rate limit map every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now - entry.start > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitMap.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// ─── SOCKET RATE LIMITER ─────────────────────────────────────────────────────
const socketRateLimitMap = new Map();
const SOCKET_RATE_LIMIT_WINDOW_MS = 10 * 1000; // 10 seconds
// With 10 users: join triggers ~9 offers + 9 answers + ~50 ICE candidates per peer = ~70 events.
// Raised from 30 → 120 to handle multi-peer signaling bursts without silently dropping events.
const SOCKET_RATE_LIMIT_MAX = 120; // max 120 socket events per 10 seconds

function socketRateLimit(socketId) {
  const now = Date.now();
  const entry = socketRateLimitMap.get(socketId) || { count: 0, start: now };

  if (now - entry.start > SOCKET_RATE_LIMIT_WINDOW_MS) {
    entry.count = 1;
    entry.start = now;
  } else {
    entry.count++;
  }

  socketRateLimitMap.set(socketId, entry);
  return entry.count <= SOCKET_RATE_LIMIT_MAX;
}

// iisnode passes a named pipe path via process.env.PORT (e.g. \\.\pipe\...)
// Fall back to numeric port for local development
const PORT = process.env.PORT || 5001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

// Allow production domain + all localhost variants for local development
const ALLOWED_ORIGINS = [
  CLIENT_URL,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

function isOriginAllowed(origin) {
  if (!origin) return true; // allow server-to-server / curl / same-origin
  return ALLOWED_ORIGINS.includes(origin);
}

// ─── SELF-HOSTED COTURN CONFIGURATION ────────────────────────────────────────
// Uses coturn (https://github.com/coturn/coturn) with HMAC-SHA1 time-limited
// credentials (RFC 8489 REST API style). The same shared secret is configured
// in turnserver.conf → static-auth-secret.
//
// Credential format:
//   username = "<unix_timestamp_expiry>:<random_user>"
//   password = base64( HMAC-SHA1( static-auth-secret, username ) )
//
// This means credentials are self-expiring — no external API calls needed.
const crypto = require('crypto');

const TURN_HOST     = process.env.TURN_HOST     || 'YOUR_SERVER_PUBLIC_IP';
const TURN_PORT     = process.env.TURN_PORT     || '3478';
const TURN_TLS_PORT = process.env.TURN_TLS_PORT && process.env.TURN_TLS_PORT.trim() !== '' ? process.env.TURN_TLS_PORT.trim() : null;
const TURN_SECRET   = process.env.TURN_SECRET   || 'CHANGE_THIS_TO_A_LONG_RANDOM_SECRET_STRING';
const TURN_TTL      = parseInt(process.env.TURN_TTL || '86400', 10); // seconds (default 24h)

/**
 * Generate time-limited HMAC-SHA1 TURN credentials.
 * Compatible with coturn's use-auth-secret / static-auth-secret mode.
 *
 * @param {string} userId  - Arbitrary identifier (e.g. socket ID or "meetspace")
 * @returns {{ username: string, credential: string, ttl: number }}
 */
function generateTurnCredentials(userId = 'meetspace') {
  const expiry   = Math.floor(Date.now() / 1000) + TURN_TTL;
  const username = `${expiry}:${userId}`;
  const credential = crypto
    .createHmac('sha1', TURN_SECRET)
    .update(username)
    .digest('base64');
  return { username, credential, ttl: TURN_TTL };
}

/**
 * Build the full ICE server list for a client.
 * Includes STUN servers (free, no auth) + self-hosted TURN (with HMAC creds).
 *
 * @param {string} userId - Used to personalise the TURN username (optional)
 * @returns {Array} ICE server objects ready for RTCPeerConnection
 */
function buildIceServers(userId = 'meetspace') {
  const { username, credential } = generateTurnCredentials(userId);

  const turnServers = [];

  // Only add TURN entries if a real host is configured
  if (TURN_HOST && TURN_HOST !== 'YOUR_SERVER_PUBLIC_IP') {
    turnServers.push(
      // UDP (fastest, preferred)
      {
        urls: `turn:${TURN_HOST}:${TURN_PORT}?transport=udp`,
        username,
        credential,
      },
      // TCP fallback (works through most firewalls)
      {
        urls: `turn:${TURN_HOST}:${TURN_PORT}?transport=tcp`,
        username,
        credential,
      },
      // STUN on same host (no auth needed)
      {
        urls: `stun:${TURN_HOST}:${TURN_PORT}`,
      }
    );

    // TLS variants — only add if TLS port is configured
    if (TURN_TLS_PORT) {
      turnServers.push(
        {
          urls: `turns:${TURN_HOST}:${TURN_TLS_PORT}?transport=tcp`,
          username,
          credential,
        },
        {
          urls: `turns:${TURN_HOST}:${TURN_TLS_PORT}?transport=udp`,
          username,
          credential,
        }
      );
    }
  }

  return [
    // Public STUN servers — always include as first-choice (free, no relay)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    // Self-hosted TURN relay (used only when STUN fails, e.g. symmetric NAT)
    ...turnServers,
  ];
}

// Async wrapper kept for API compatibility with the join-room handler
async function fetchMeteredIceServers(userId = 'meetspace') {
  return buildIceServers(userId);
}

console.log(`[TURN] Self-hosted coturn configured at ${TURN_HOST}:${TURN_PORT}`);
console.log(`[TURN] ICE servers ready: ${buildIceServers().length} total`);

// Configure CORS — allow production domain + localhost for development
app.use(cors({
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST'],
  credentials: true
}));

app.use(express.json({ limit: '10kb' }));
app.use(rateLimit);

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) return callback(null, true);
      callback(new Error(`CORS: origin ${origin} not allowed`));
    },
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// In-memory store for rooms
// Room structure:
// {
//   id, createdAt, messages[],
//   participants: Map<socketId, { id, name, joinedAt, audioEnabled, videoEnabled, isScreenSharing, handRaised }>
// }
const rooms = new Map();

// Maximum participants per room — beyond this, new joins are rejected.
// 10 peers = 45 peer connections total (n*(n-1)/2), which is manageable.
const MAX_PARTICIPANTS_PER_ROOM = 10;

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      id: roomId,
      participants: new Map(),
      messages: [],
      createdAt: new Date().toISOString()
    });
  }
  return rooms.get(roomId);
}

// Validate that an SDP object has the required fields
function isValidSdp(sdp) {
  return sdp && typeof sdp.type === 'string' && typeof sdp.sdp === 'string' && sdp.sdp.length > 0;
}

// Validate ICE candidate object
function isValidCandidate(candidate) {
  return candidate && (typeof candidate.candidate === 'string' || candidate.candidate === '');
}

// ─── REST API ────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    rooms: rooms.size,
    iceServers: buildIceServers().length,
  });
});

// Return ICE server config to clients (so TURN credentials stay server-side)
app.get('/api/ice-servers', (req, res) => {
  res.json({ iceServers: buildIceServers() });
});

app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.values()).map(room => ({
    id: room.id,
    participantCount: room.participants.size,
    createdAt: room.createdAt
  }));
  res.json(roomList);
});

app.post('/api/rooms/create', (req, res) => {
  const roomId = uuidv4().substring(0, 8).toUpperCase();
  getOrCreateRoom(roomId);
  res.json({ roomId });
});

app.get('/api/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  const room = rooms.get(roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });

  res.json({
    id: room.id,
    participantCount: room.participants.size,
    participants: Array.from(room.participants.values()).map(p => ({
      id: p.id,
      name: p.name,
      joinedAt: p.joinedAt,
      audioEnabled: p.audioEnabled,
      videoEnabled: p.videoEnabled,
      isScreenSharing: p.isScreenSharing,
      handRaised: p.handRaised,
    })),
    createdAt: room.createdAt
  });
});

// ─── SOCKET.IO SIGNALING ─────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // Middleware: rate limit all socket events
  socket.use(([event, ...args], next) => {
    if (!socketRateLimit(socket.id)) {
      console.warn(`[RateLimit] Socket ${socket.id} exceeded event rate limit`);
      return; // silently drop
    }
    next();
  });

  // ── JOIN ROOM ──────────────────────────────────────────────────────────────
  socket.on('join-room', async ({ roomId, userName, audioEnabled: initAudio, videoEnabled: initVideo }) => {
    if (!roomId || !userName) return;
    // Sanitize inputs
    const safeRoomId = String(roomId).trim().substring(0, 50).replace(/[^a-zA-Z0-9_-]/g, '');
    const safeUserName = String(userName).trim().substring(0, 30);
    if (!safeRoomId || !safeUserName) return;
    roomId = safeRoomId;
    userName = safeUserName;

    const room = getOrCreateRoom(roomId);

    // If this socket is already in the room (reconnect scenario), remove the old entry first
    // so the participant list stays clean and the new socket ID is used.
    if (room.participants.has(socket.id)) {
      room.participants.delete(socket.id);
      console.log(`[Room] Re-join detected for ${socket.id} in room ${roomId} — refreshing entry`);
    }

    // Enforce room size limit to keep peer connections manageable
    if (room.participants.size >= MAX_PARTICIPANTS_PER_ROOM) {
      socket.emit('room-full', { roomId, max: MAX_PARTICIPANTS_PER_ROOM });
      console.warn(`[Room] Room ${roomId} is full (${room.participants.size}/${MAX_PARTICIPANTS_PER_ROOM}), rejecting ${socket.id}`);
      return;
    }

    const participant = {
      id: socket.id,
      name: userName.trim() || `User-${socket.id.substring(0, 4)}`,
      joinedAt: new Date().toISOString(),
      // Accept actual initial media state from client so the participant list
      // shown to late joiners reflects the real camera/mic state at join time.
      audioEnabled: initAudio !== false, // default true unless explicitly false
      videoEnabled: initVideo !== false, // default true unless explicitly false
      isScreenSharing: false,
      handRaised: false,
    };

    room.participants.set(socket.id, participant);
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = participant.name;

    console.log(`[Room] "${participant.name}" joined room ${roomId} (${room.participants.size} total)`);

    // Send existing participants + chat history + ICE config to the new user
    const existingParticipants = Array.from(room.participants.values())
      .filter(p => p.id !== socket.id)
      .map(p => ({
        id: p.id,
        name: p.name,
        audioEnabled: p.audioEnabled,
        videoEnabled: p.videoEnabled,
        isScreenSharing: p.isScreenSharing,
        handRaised: p.handRaised,
      }));

    // Fetch fresh TURN credentials from Metered.ca (cached after first call)
    const iceServers = await fetchMeteredIceServers();

    socket.emit('room-joined', {
      roomId,
      participants: existingParticipants,
      chatHistory: room.messages.slice(-50),
      iceServers,   // ← send real TURN credentials on join
    });

    // Notify everyone else that a new user joined (with their initial state)
    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      userName: participant.name,
      audioEnabled: participant.audioEnabled,
      videoEnabled: participant.videoEnabled,
      isScreenSharing: participant.isScreenSharing,
      handRaised: participant.handRaised,
    });
  });

  // ── WEBRTC SIGNALING ───────────────────────────────────────────────────────

  // Offer: caller → callee (validate SDP before relaying)
  socket.on('offer', ({ targetId, offer }) => {
    if (!targetId || !isValidSdp(offer)) return;
    if (offer.type !== 'offer') return; // must be an offer SDP
    console.log(`[WebRTC] Offer: ${socket.id} → ${targetId}`);
    io.to(targetId).emit('offer', {
      fromId: socket.id,
      fromName: socket.userName,
      offer,
    });
  });

  // Answer: callee → caller (validate SDP before relaying)
  socket.on('answer', ({ targetId, answer }) => {
    if (!targetId || !isValidSdp(answer)) return;
    if (answer.type !== 'answer') return; // must be an answer SDP
    console.log(`[WebRTC] Answer: ${socket.id} → ${targetId}`);
    io.to(targetId).emit('answer', {
      fromId: socket.id,
      answer,
    });
  });

  // ICE Candidate: trickle ICE relay (validate candidate before relaying)
  socket.on('ice-candidate', ({ targetId, candidate }) => {
    if (!targetId || !isValidCandidate(candidate)) return;
    io.to(targetId).emit('ice-candidate', {
      fromId: socket.id,
      candidate,
    });
  });

  // ── STATE SYNC ─────────────────────────────────────────────────────────────

  // Mute / unmute / video on / off
  socket.on('media-state-change', ({ roomId, audioEnabled, videoEnabled }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    // Persist state on server
    const participant = room.participants.get(socket.id);
    if (participant) {
      participant.audioEnabled = audioEnabled;
      participant.videoEnabled = videoEnabled;
    }

    // Broadcast to everyone else in the room
    socket.to(roomId).emit('user-media-state-change', {
      userId: socket.id,
      userName: socket.userName,
      audioEnabled,
      videoEnabled,
    });

    console.log(`[State] ${socket.userName} audio=${audioEnabled} video=${videoEnabled}`);
  });

  // Screen share started / stopped
  socket.on('screen-share-state', ({ roomId, isSharing }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const participant = room.participants.get(socket.id);
    if (participant) participant.isScreenSharing = isSharing;

    socket.to(roomId).emit('user-screen-share-state', {
      userId: socket.id,
      userName: socket.userName,
      isSharing,
    });

    console.log(`[State] ${socket.userName} screen-share=${isSharing}`);
  });

  // Raise / lower hand
  socket.on('raise-hand', ({ roomId, raised }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    const participant = room.participants.get(socket.id);
    if (participant) participant.handRaised = raised;

    socket.to(roomId).emit('user-raise-hand', {
      userId: socket.id,
      userName: socket.userName,
      raised,
    });

    console.log(`[State] ${socket.userName} hand-raised=${raised}`);
  });

  // ── CHAT ───────────────────────────────────────────────────────────────────

  socket.on('chat-message', ({ roomId, message }) => {
    const room = rooms.get(roomId);
    if (!room || !message?.trim()) return;

    // Sanitize message
    const safeMessage = String(message).trim().substring(0, 500);
    if (!safeMessage) return;

    const msgObj = {
      id: uuidv4(),
      userId: socket.id,
      userName: socket.userName,
      message: safeMessage,
      timestamp: new Date().toISOString(),
    };

    room.messages.push(msgObj);
    if (room.messages.length > 200) {
      room.messages = room.messages.slice(-200);
    }

    // Broadcast to ALL in room (including sender for confirmation)
    io.to(roomId).emit('chat-message', msgObj);
  });

  // ── DISCONNECT ─────────────────────────────────────────────────────────────

  socket.on('disconnect', (reason) => {
    socketRateLimitMap.delete(socket.id);
    console.log(`[Socket] Disconnected: ${socket.id} (${reason})`);

    const roomId = socket.roomId;
    if (!roomId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    room.participants.delete(socket.id);

    // Notify remaining participants
    socket.to(roomId).emit('user-left', {
      userId: socket.id,
      userName: socket.userName,
    });

    console.log(`[Room] "${socket.userName}" left room ${roomId} (${room.participants.size} remaining)`);

    // Clean up empty rooms after 5 minutes
    if (room.participants.size === 0) {
      setTimeout(() => {
        const r = rooms.get(roomId);
        if (r && r.participants.size === 0) {
          rooms.delete(roomId);
          console.log(`[Room] Cleaned up empty room: ${roomId}`);
        }
      }, 5 * 60 * 1000);
    }
  });
});

// ─── SERVE FRONTEND STATIC FILES (Production) ────────────────────────────────
// Supports multiple deployment layouts:
//   1. app.js at repo root → frontend/dist/ (new Plesk Git layout)
//   2. app.js in backend/  → dist/ next to app.js (old flat layout)
//   3. app.js in backend/  → ../frontend/dist/ (old nested layout)
const frontendDistInline  = path.join(__dirname, 'frontend', 'dist');  // layout 1
const frontendDistFlat    = path.join(__dirname, 'dist');               // layout 2
const frontendDistNested  = path.join(__dirname, '..', 'frontend', 'dist'); // layout 3

const frontendDist = fs.existsSync(frontendDistInline)
  ? frontendDistInline
  : fs.existsSync(frontendDistFlat)
    ? frontendDistFlat
    : frontendDistNested;

if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  console.log(`📁 Serving frontend static files from: ${frontendDist}`);
}

// SPA fallback: serve index.html for all non-API, non-health routes (must be last)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/health') return next();
  const indexFile = path.join(frontendDist, 'index.html');
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// ─── START SERVER ─────────────────────────────────────────────────────────────

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use.`);
    console.error(`   → Kill the existing process: npx kill-port ${PORT}`);
    console.error(`   → Or set a different PORT in your .env file.\n`);
  } else {
    console.error('Server error:', err);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`\n🚀 WebRTC Signaling Server running on port ${PORT}`);
  console.log(`📡 Accepting connections from: ${CLIENT_URL}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🧊 TURN server: self-hosted coturn at ${TURN_HOST}:${TURN_PORT} (HMAC-SHA1 credentials)\n`);
});
