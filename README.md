# 📹 MeetNow - WebRTC Video Conferencing

A full-featured video conferencing application built with **React** (frontend) and **Node.js + Socket.io** (backend), similar to Jitsi Meet.

---

## ✨ Features

- 🎥 **HD Video Calls** — Real-time peer-to-peer video using WebRTC
- 🎤 **Audio Controls** — Mute/unmute microphone
- 📹 **Video Controls** — Turn camera on/off
- 🖥️ **Screen Sharing** — Share your screen with one click
- 💬 **Live Chat** — Real-time messaging during calls
- 👥 **Participants List** — See who's in the meeting
- ✋ **Raise Hand** — Signal to others you want to speak
- 🔔 **Notifications** — Join/leave alerts
- 🔗 **Room Links** — Share room ID to invite others
- 📱 **Responsive** — Works on desktop and mobile browsers

---

## 🏗️ Architecture

```
WebRTC/
├── backend/              # Node.js + Express + Socket.io
│   ├── server.js         # Signaling server
│   ├── package.json
│   └── .env
├── frontend/             # React application
│   ├── src/
│   │   ├── App.js
│   │   ├── pages/
│   │   │   ├── HomePage.js     # Landing page
│   │   │   └── RoomPage.js     # Video conference room
│   │   ├── components/
│   │   │   ├── VideoGrid.js    # Video tiles layout
│   │   │   ├── Controls.js     # Meeting controls bar
│   │   │   ├── ChatPanel.js    # Chat sidebar
│   │   │   ├── ParticipantsList.js
│   │   │   └── Notifications.js
│   │   ├── hooks/
│   │   │   └── useWebRTC.js    # WebRTC + Socket.io logic
│   │   └── services/
│   │       └── socket.js       # Socket.io client
│   └── .env
├── start.bat             # Windows startup script
└── README.md
```

---

## 🚀 Quick Start

### Option 1: Use the startup script (Windows)
```
Double-click start.bat
```

### Option 2: Manual start

**Terminal 1 — Backend:**
```bash
cd backend
npm install
node server.js
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

---

## 🔧 Configuration

### Backend (`backend/.env`)
```
PORT=5000
CLIENT_URL=http://localhost:3000
```

### Frontend (`frontend/.env`)
```
REACT_APP_SOCKET_URL=http://localhost:5000
```

---

## 📡 How It Works

1. **Signaling** — Socket.io handles WebRTC signaling (offer/answer/ICE candidates)
2. **Peer Connection** — Each participant creates a direct P2P connection via WebRTC
3. **Media** — Video/audio streams are sent directly between browsers (no server relay)
4. **Chat** — Messages are relayed through the Socket.io server

### WebRTC Flow
```
User A joins room → Server notifies User B
User A creates Offer → sends via Socket.io → User B
User B creates Answer → sends via Socket.io → User A
Both exchange ICE candidates → Direct P2P connection established
```

---

## 🌐 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Server health check |
| GET | `/api/rooms` | List all active rooms |
| POST | `/api/rooms/create` | Create a new room |
| GET | `/api/rooms/:roomId` | Get room details |

---

## 🔌 Socket.io Events

### Client → Server
| Event | Payload | Description |
|-------|---------|-------------|
| `join-room` | `{ roomId, userName }` | Join a meeting room |
| `offer` | `{ targetId, offer }` | Send WebRTC offer |
| `answer` | `{ targetId, answer }` | Send WebRTC answer |
| `ice-candidate` | `{ targetId, candidate }` | Send ICE candidate |
| `chat-message` | `{ roomId, message }` | Send chat message |
| `media-state-change` | `{ roomId, audioEnabled, videoEnabled }` | Notify media state |
| `screen-share-state` | `{ roomId, isSharing }` | Notify screen share |
| `raise-hand` | `{ roomId, raised }` | Raise/lower hand |

### Server → Client
| Event | Description |
|-------|-------------|
| `room-joined` | Existing participants + chat history |
| `user-joined` | New user joined notification |
| `user-left` | User left notification |
| `offer` | Incoming WebRTC offer |
| `answer` | Incoming WebRTC answer |
| `ice-candidate` | Incoming ICE candidate |
| `chat-message` | New chat message |
| `user-media-state-change` | Participant muted/unmuted |
| `user-screen-share-state` | Participant screen share state |
| `user-raise-hand` | Participant raised hand |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, React Router v6 |
| Styling | Pure CSS with CSS Variables |
| Real-time | Socket.io Client |
| Video/Audio | WebRTC (native browser API) |
| Backend | Node.js, Express |
| Signaling | Socket.io Server |
| Room IDs | UUID |

---

## 📋 Requirements

- Node.js v16+
- Modern browser (Chrome, Firefox, Edge, Safari)
- Camera and microphone access

---

## 🔒 Security Notes

- WebRTC connections are encrypted by default (DTLS/SRTP)
- For production, use HTTPS and WSS (required for camera/mic access)
- Consider adding TURN servers for users behind strict NAT/firewalls

---

## 🌍 Production Deployment

For production, you'll need:
1. **HTTPS** — Required for camera/microphone access
2. **TURN Server** — For users behind NAT (e.g., Coturn)
3. **Environment variables** — Update `CLIENT_URL` and `REACT_APP_SOCKET_URL`

Example TURN server config in `useWebRTC.js`:
```js
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:your-turn-server.com:3478',
      username: 'your-username',
      credential: 'your-password'
    }
  ]
};
```
