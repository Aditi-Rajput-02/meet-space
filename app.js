 
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const crypto     = require('crypto');
const mediasoup  = require('mediasoup');

const app    = express();
const server = http.createServer(app);

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const PORT       = process.env.PORT       || 5001;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

const ALLOWED_ORIGINS = [
  CLIENT_URL,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:4173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
];

function isOriginAllowed(origin) {
  return true; // Allow all origins
}

// ─── TURN / ICE CONFIG ───────────────────────────────────────────────────────
const TURN_HOST     = process.env.TURN_HOST     || null;
const TURN_PORT_NUM = process.env.TURN_PORT     || '3478';
const TURN_TLS_PORT = process.env.TURN_TLS_PORT && process.env.TURN_TLS_PORT.trim() !== ''
  ? process.env.TURN_TLS_PORT.trim() : null;
const TURN_SECRET   = process.env.TURN_SECRET   || null;
const TURN_TTL      = parseInt(process.env.TURN_TTL || '86400', 10);

function generateTurnCredentials(userId = 'meetspace') {
  if (!TURN_SECRET) return null;
  const expiry   = Math.floor(Date.now() / 1000) + TURN_TTL;
  const username = `${expiry}:${userId}`;
  const credential = crypto.createHmac('sha1', TURN_SECRET).update(username).digest('base64');
  return { username, credential };
}

function buildIceServers(userId = 'meetspace') {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  if (TURN_HOST && TURN_SECRET) {
    const creds = generateTurnCredentials(userId);
    servers.push(
      { urls: `turn:${TURN_HOST}:${TURN_PORT_NUM}?transport=udp`, ...creds },
      { urls: `turn:${TURN_HOST}:${TURN_PORT_NUM}?transport=tcp`, ...creds },
      { urls: `stun:${TURN_HOST}:${TURN_PORT_NUM}` }
    );
    if (TURN_TLS_PORT) {
      servers.push(
        { urls: `turns:${TURN_HOST}:${TURN_TLS_PORT}?transport=tcp`, ...creds },
        { urls: `turns:${TURN_HOST}:${TURN_TLS_PORT}?transport=udp`, ...creds }
      );
    }
  }
  return servers;
}

// ─── MEDIASOUP SETUP ─────────────────────────────────────────────────────────
// mediasoup media codecs supported by the SFU router
const mediaCodecs = [
  { kind: 'audio', mimeType: 'audio/opus',   clockRate: 48000, channels: 2 },
  { kind: 'video', mimeType: 'video/VP8',    clockRate: 90000, parameters: {} },
  { kind: 'video', mimeType: 'video/VP9',    clockRate: 90000, parameters: { 'profile-id': 2 } },
  { kind: 'video', mimeType: 'video/h264',   clockRate: 90000,
    parameters: { 'packetization-mode': 1, 'profile-level-id': '42e01f', 'level-asymmetry-allowed': 1 } },
];

// WebRtcTransport options — used for both send and recv transports
const webRtcTransportOptions = {
  listenIps: [
    { ip: '0.0.0.0', announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1' },
  ],
  enableUdp: true,
  enableTcp: true,
  preferUdp: true,
  initialAvailableOutgoingBitrate: 1000000,
};

let worker; // single mediasoup Worker

async function createWorker() {
  worker = await mediasoup.createWorker({
    logLevel: 'warn',
    rtcMinPort: parseInt(process.env.MEDIASOUP_RTC_MIN_PORT || '40000', 10),
    rtcMaxPort: parseInt(process.env.MEDIASOUP_RTC_MAX_PORT || '49999', 10),
  });
  worker.on('died', () => {
    console.error('[mediasoup] Worker died — restarting in 2s');
    setTimeout(createWorker, 2000);
  });
  console.log('[mediasoup] Worker created, pid:', worker.pid);
}

// ─── ROOM STATE ──────────────────────────────────────────────────────────────
// rooms: Map<roomId, {
//   id, createdAt, messages[],
//   router: mediasoup.Router,
//   peers: Map<socketId, {
//     id, name, audioEnabled, videoEnabled, isScreenSharing, handRaised,
//     joinedAt,
//     sendTransport: Transport|null,
//     recvTransport: Transport|null,
//     producers: Map<producerId, Producer>,
//     consumers: Map<consumerId, Consumer>,
//   }>
// }>
const rooms = new Map();
const MAX_PEERS = 10;

async function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    const router = await worker.createRouter({ mediaCodecs });
    rooms.set(roomId, {
      id: roomId,
      createdAt: new Date().toISOString(),
      messages: [],
      router,
      peers: new Map(),
    });
    console.log(`[Room] Created room ${roomId}, routerId=${router.id}`);
  }
  return rooms.get(roomId);
}

// ─── RATE LIMITER ─────────────────────────────────────────────────────────────
const rateLimitMap = new Map();
function rateLimit(req, res, next) {
  const ip  = req.ip || req.socket.remoteAddress;
  const now = Date.now();
  const e   = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - e.start > 60000) { e.count = 1; e.start = now; }
  else e.count++;
  rateLimitMap.set(ip, e);
  if (e.count > 60) return res.status(429).json({ error: 'Too many requests' });
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of rateLimitMap) if (now - e.start > 120000) rateLimitMap.delete(ip);
}, 300000);

// ─── EXPRESS MIDDLEWARE ───────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});
app.use(cors({
  origin: (origin, cb) => isOriginAllowed(origin) ? cb(null, true) : cb(new Error('CORS blocked')),
  methods: ['GET', 'POST'], credentials: true,
}));
app.use(express.json({ limit: '10kb' }));
app.use(rateLimit);

// ─── REST API ─────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({
  status: 'ok', timestamp: new Date().toISOString(),
  rooms: rooms.size, mediasoup: !!worker,
}));

app.get('/api/ice-servers', (req, res) => res.json({ iceServers: buildIceServers() }));

app.post('/api/rooms/create', (req, res) => {
  const roomId = uuidv4().substring(0, 8).toUpperCase();
  res.json({ roomId });
});

app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({
    id: room.id, createdAt: room.createdAt,
    participantCount: room.peers.size,
    participants: Array.from(room.peers.values()).map(p => ({
      id: p.id, name: p.name, audioEnabled: p.audioEnabled,
      videoEnabled: p.videoEnabled, isScreenSharing: p.isScreenSharing,
    })),
  });
});

// ─── SOCKET.IO ────────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: (origin, cb) => isOriginAllowed(origin) ? cb(null, true) : cb(new Error('CORS blocked')),
    methods: ['GET', 'POST'], credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Helper: close and clean up all mediasoup resources for a peer
async function cleanupPeer(room, socketId) {
  const peer = room.peers.get(socketId);
  if (!peer) return;
  for (const consumer of peer.consumers.values()) { try { consumer.close(); } catch (_) {} }
  for (const producer of peer.producers.values()) { try { producer.close(); } catch (_) {} }
  if (peer.recvTransport) { try { peer.recvTransport.close(); } catch (_) {} }
  if (peer.sendTransport) { try { peer.sendTransport.close(); } catch (_) {} }
  room.peers.delete(socketId);
}

io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  // ── JOIN ROOM ──────────────────────────────────────────────────────────────
  socket.on('join-room', async ({ roomId, userName, audioEnabled: initAudio, videoEnabled: initVideo }) => {
    try {
      if (!roomId || !userName) return;
      const safeRoomId   = String(roomId).trim().substring(0, 50).replace(/[^a-zA-Z0-9_-]/g, '');
      const safeUserName = String(userName).trim().substring(0, 30);
      if (!safeRoomId || !safeUserName) return;

      const room = await getOrCreateRoom(safeRoomId);

      if (room.peers.size >= MAX_PEERS) {
        socket.emit('room-full', { roomId: safeRoomId, max: MAX_PEERS });
        return;
      }

      // Prevent duplicate joins from same socket
      if (socket.roomId === safeRoomId && room.peers.has(socket.id)) {
        console.warn(`[join-room] Duplicate join ignored for socket ${socket.id} in room ${safeRoomId}`);
        return;
      }

      // Clean up stale entry if reconnecting from a different room
      if (room.peers.has(socket.id)) await cleanupPeer(room, socket.id);

      const peer = {
        id: socket.id,
        name: safeUserName,
        joinedAt: new Date().toISOString(),
        audioEnabled: initAudio !== false,
        videoEnabled: initVideo !== false,
        isScreenSharing: false,
        handRaised: false,
        sendTransport: null,
        recvTransport: null,
        producers: new Map(),
        consumers: new Map(),
      };
      room.peers.set(socket.id, peer);
      socket.join(safeRoomId);
      socket.roomId   = safeRoomId;
      socket.userName = safeUserName;

      // Existing peers info for the new joiner
      const existingPeers = Array.from(room.peers.values())
        .filter(p => p.id !== socket.id)
        .map(p => ({
          id: p.id, name: p.name,
          audioEnabled: p.audioEnabled, videoEnabled: p.videoEnabled,
          isScreenSharing: p.isScreenSharing, handRaised: p.handRaised,
          producers: Array.from(p.producers.values()).map(pr => ({
            producerId: pr.id, kind: pr.kind,
          })),
        }));

      socket.emit('room-joined', {
        roomId: safeRoomId,
        routerRtpCapabilities: room.router.rtpCapabilities,
        participants: existingPeers,
        chatHistory: room.messages.slice(-50),
        iceServers: buildIceServers(socket.id),
      });

      socket.to(safeRoomId).emit('user-joined', {
        userId: socket.id, userName: safeUserName,
        audioEnabled: peer.audioEnabled, videoEnabled: peer.videoEnabled,
        isScreenSharing: false, handRaised: false,
      });

      console.log(`[Room] "${safeUserName}" joined ${safeRoomId} (${room.peers.size} peers)`);
    } catch (err) {
      console.error('[join-room] error:', err);
    }
  });

  // ── CREATE TRANSPORT ───────────────────────────────────────────────────────
  // direction: 'send' | 'recv'
  socket.on('create-transport', async ({ direction }, callback) => {
    try {
      const room = rooms.get(socket.roomId);
      if (!room) { console.error(`[create-transport] Room not found for socket ${socket.id}, roomId=${socket.roomId}`); return callback({ error: 'Room not found' }); }
      const peer = room.peers.get(socket.id);
      if (!peer) { console.error(`[create-transport] Peer not found for socket ${socket.id}`); return callback({ error: 'Peer not found' }); }

      const transport = await room.router.createWebRtcTransport(webRtcTransportOptions);

      transport.on('dtlsstatechange', (state) => {
        if (state === 'closed') transport.close();
      });

      // Store in per-socket map for instant lookup by ID
      if (!socket._transports) socket._transports = new Map();
      socket._transports.set(transport.id, transport);

      if (direction === 'send') {
        if (peer.sendTransport) peer.sendTransport.close();
        peer.sendTransport = transport;
      } else {
        if (peer.recvTransport) peer.recvTransport.close();
        peer.recvTransport = transport;
      }

      callback({
        id: transport.id,
        iceParameters:  transport.iceParameters,
        iceCandidates:  transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
    } catch (err) {
      console.error('[create-transport] error:', err);
      callback({ error: err.message });
    }
  });

  // ── CONNECT TRANSPORT ──────────────────────────────────────────────────────
  socket.on('connect-transport', async ({ transportId, dtlsParameters }, callback) => {
    try {
      // Look up transport in the global transports map (avoids peer timing issues)
      const transport = socket._transports?.get(transportId);
      if (!transport) {
        console.error(`[connect-transport] Transport ${transportId} not found for socket ${socket.id}`);
        return callback({ error: 'Transport not found' });
      }
      await transport.connect({ dtlsParameters });
      callback({});
    } catch (err) {
      console.error('[connect-transport] error:', err);
      callback({ error: err.message });
    }
  });

  // ── PRODUCE ────────────────────────────────────────────────────────────────
  socket.on('produce', async ({ transportId, kind, rtpParameters, appData }, callback) => {
    try {
      const room = rooms.get(socket.roomId);
      if (!room) return callback({ error: 'Room not found' });
      const peer = room.peers.get(socket.id);
      if (!peer) return callback({ error: 'Peer not found' });

      // Look up send transport from socket's transport map
      const transport = socket._transports?.get(transportId);
      if (!transport) return callback({ error: 'Send transport not found' });

      const producer = await transport.produce({ kind, rtpParameters, appData });
      peer.producers.set(producer.id, producer);

      producer.on('transportclose', () => {
        producer.close();
        peer.producers.delete(producer.id);
      });

      // Notify all other peers in the room about the new producer
      socket.to(socket.roomId).emit('new-producer', {
        producerId: producer.id,
        producerSocketId: socket.id,
        kind,
        appData,
      });

      callback({ id: producer.id });
    } catch (err) {
      console.error('[produce] error:', err);
      callback({ error: err.message });
    }
  });

  // ── CONSUME ────────────────────────────────────────────────────────────────
  socket.on('consume', async ({ producerId, producerSocketId, rtpCapabilities }, callback) => {
    try {
      const room = rooms.get(socket.roomId);
      if (!room) return callback({ error: 'Room not found' });
      const peer = room.peers.get(socket.id);
      if (!peer || !peer.recvTransport) return callback({ error: 'Recv transport not found' });

      if (!room.router.canConsume({ producerId, rtpCapabilities }))
        return callback({ error: 'Cannot consume' });

      const consumer = await peer.recvTransport.consume({
        producerId, rtpCapabilities, paused: false,
      });
      peer.consumers.set(consumer.id, consumer);

      consumer.on('transportclose', () => { consumer.close(); peer.consumers.delete(consumer.id); });
      consumer.on('producerclose', () => {
        consumer.close();
        peer.consumers.delete(consumer.id);
        socket.emit('producer-closed', { consumerId: consumer.id, producerSocketId });
      });

      callback({
        id:            consumer.id,
        producerId:    consumer.producerId,
        kind:          consumer.kind,
        rtpParameters: consumer.rtpParameters,
      });
    } catch (err) {
      console.error('[consume] error:', err);
      callback({ error: err.message });
    }
  });

  // ── PRODUCER CLOSED (client side) ─────────────────────────────────────────
  socket.on('producer-closed', ({ producerId }) => {
    const room = rooms.get(socket.roomId);
    if (!room) return;
    const peer = room.peers.get(socket.id);
    if (!peer) return;
    const producer = peer.producers.get(producerId);
    if (producer) { producer.close(); peer.producers.delete(producerId); }
  });

  // ── MEDIA STATE ────────────────────────────────────────────────────────────
  socket.on('media-state-change', ({ roomId, audioEnabled, videoEnabled }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const peer = room.peers.get(socket.id);
    if (peer) { peer.audioEnabled = audioEnabled; peer.videoEnabled = videoEnabled; }
    socket.to(roomId).emit('user-media-state-change', {
      userId: socket.id, userName: socket.userName, audioEnabled, videoEnabled,
    });
  });

  socket.on('screen-share-state', ({ roomId, isSharing }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const peer = room.peers.get(socket.id);
    if (peer) peer.isScreenSharing = isSharing;
    socket.to(roomId).emit('user-screen-share-state', {
      userId: socket.id, userName: socket.userName, isSharing,
    });
  });

  socket.on('raise-hand', ({ roomId, raised }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const peer = room.peers.get(socket.id);
    if (peer) peer.handRaised = raised;
    socket.to(roomId).emit('user-raise-hand', {
      userId: socket.id, userName: socket.userName, raised,
    });
  });

  // ── CHAT ───────────────────────────────────────────────────────────────────
  socket.on('chat-message', ({ roomId, message }) => {
    const room = rooms.get(roomId);
    if (!room || !message?.trim()) return;
    const safeMsg = String(message).trim().substring(0, 500);
    if (!safeMsg) return;
    const msgObj = {
      id: uuidv4(), userId: socket.id, userName: socket.userName,
      message: safeMsg, timestamp: new Date().toISOString(),
    };
    room.messages.push(msgObj);
    if (room.messages.length > 200) room.messages = room.messages.slice(-200);
    io.to(roomId).emit('chat-message', msgObj);
  });

  // ── DISCONNECT ─────────────────────────────────────────────────────────────
  socket.on('disconnect', async (reason) => {
    console.log(`[Socket] Disconnected: ${socket.id} (${reason})`);
    const roomId = socket.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    await cleanupPeer(room, socket.id);
    socket.to(roomId).emit('user-left', { userId: socket.id, userName: socket.userName });
    console.log(`[Room] "${socket.userName}" left ${roomId} (${room.peers.size} remaining)`);
    if (room.peers.size === 0) {
      setTimeout(() => {
        const r = rooms.get(roomId);
        if (r && r.peers.size === 0) {
          r.router.close();
          rooms.delete(roomId);
          console.log(`[Room] Cleaned up empty room: ${roomId}`);
        }
      }, 300000);
    }
  });
});

// ─── SERVE FRONTEND ───────────────────────────────────────────────────────────
const frontendDist = [
  path.join(__dirname, 'frontend', 'dist'),
  path.join(__dirname, 'dist'),
  path.join(__dirname, '..', 'frontend', 'dist'),
].find(p => fs.existsSync(p));

if (frontendDist) {
  app.use(express.static(frontendDist));
  console.log(`📁 Serving frontend from: ${frontendDist}`);
}

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path === '/health') return next();
  const idx = frontendDist ? path.join(frontendDist, 'index.html') : null;
  if (idx && fs.existsSync(idx)) return res.sendFile(idx);
  res.status(404).json({ error: 'Not found' });
});

// ─── START ────────────────────────────────────────────────────────────────────
async function start() {
  await createWorker();
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ Port ${PORT} is already in use.\n`);
    } else {
      console.error('Server error:', err);
    }
    process.exit(1);
  });
  server.listen(PORT, () => {
    console.log(`\n🚀 MeetSpace SFU (mediasoup) running on port ${PORT}`);
    console.log(`📡 Client URL: ${CLIENT_URL}`);
    console.log(`🔗 Health: http://localhost:${PORT}/health\n`);
  });
}

start().catch(err => { console.error('Fatal startup error:', err); process.exit(1); });
