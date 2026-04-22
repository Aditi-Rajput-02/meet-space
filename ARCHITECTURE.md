# MeetSpace — Architecture Diagrams

---

## Diagram 1 — How the System Works (Data Flow)

```mermaid
flowchart TD
    subgraph BROWSER["🌐 Browser (Each User)"]
        UI["React UI\n(VideoGrid, Controls, Chat)"]
        MS_CLIENT["mediasoup-client\n(WebRTC Producer/Consumer)"]
        SOCKET_CLIENT["Socket.IO Client\n(Signaling)"]
        UI --> MS_CLIENT
        UI --> SOCKET_CLIENT
    end

    subgraph SERVER["🖥️ Node.js Server (app.js)"]
        EXPRESS["Express HTTP\n(serves frontend/dist)"]
        SOCKET_IO["Socket.IO Server\n(Signaling & Room Management)"]
        MS_ROUTER["mediasoup Router\n(per Room)"]
        MS_WORKER["mediasoup Worker\n(C++ native process)"]
        SOCKET_IO --> MS_ROUTER
        MS_ROUTER --> MS_WORKER
    end

    subgraph TURN["📡 coturn TURN Server\n(Docker)"]
        STUN["STUN\n(port 3478)"]
        TURN_RELAY["TURN Relay\n(UDP 49152-65535)"]
    end

    %% Signaling flow
    SOCKET_CLIENT -- "WebSocket\n(join-room, produce,\nconsume, chat)" --> SOCKET_IO

    %% Media flow
    MS_CLIENT -- "WebRTC Media\n(UDP 40000-49999)" --> MS_WORKER

    %% TURN relay (when direct UDP blocked)
    MS_CLIENT -. "If NAT/Firewall\nblocks direct UDP" .-> TURN_RELAY
    TURN_RELAY -. "Relayed Media" .-> MS_WORKER

    %% ICE negotiation
    MS_CLIENT -- "ICE/STUN\n(port 3478)" --> STUN

    %% Frontend served
    EXPRESS -- "HTTPS\n(index.html + JS)" --> UI

    style BROWSER fill:#dbeafe,stroke:#3b82f6
    style SERVER fill:#dcfce7,stroke:#16a34a
    style TURN fill:#fef9c3,stroke:#ca8a04
```

---

## Diagram 2 — Step-by-Step Join Flow (Sequence)

```mermaid
sequenceDiagram
    participant U1 as User 1 (Browser)
    participant U2 as User 2 (Browser)
    participant SRV as Node.js Server
    participant MS as mediasoup Worker
    participant TURN as coturn TURN

    Note over U1,TURN: User 1 joins the room

    U1->>SRV: socket.emit('join-room', {roomId, userName})
    SRV->>MS: createRouter() if room is new
    MS-->>SRV: router with RTP capabilities
    SRV-->>U1: room-joined {routerRtpCapabilities, participants:[]}

    U1->>SRV: create-transport (send)
    SRV->>MS: router.createWebRtcTransport()
    MS-->>SRV: transport params
    SRV-->>U1: transport params (id, iceParameters, dtlsParameters)

    U1->>SRV: create-transport (recv)
    SRV-->>U1: recv transport params

    U1->>SRV: connect-transport (DTLS handshake)
    U1->>SRV: produce {kind:audio, rtpParameters}
    SRV->>MS: transport.produce()
    MS-->>SRV: producerId
    SRV-->>U1: {id: producerId}

    U1->>SRV: produce {kind:video, rtpParameters}
    SRV-->>U1: {id: producerId}

    Note over U1,TURN: User 2 joins the room

    U2->>SRV: socket.emit('join-room', {roomId, userName})
    SRV-->>U2: room-joined {routerRtpCapabilities, participants:[User1]}
    SRV-->>U1: user-joined {userId: U2.id, userName}

    Note over U2: U2 sets up transports + produces (same as U1)

    SRV-->>U1: new-producer {producerId, producerSocketId: U2.id}
    SRV-->>U2: new-producer {producerId, producerSocketId: U1.id}

    Note over U1: U1 consumes U2's producers
    U1->>SRV: consume {producerId, rtpCapabilities}
    SRV->>MS: router.createConsumer()
    MS-->>SRV: consumer params
    SRV-->>U1: consumer params
    U1->>MS: WebRTC media stream (via TURN if needed)
    MS-->>U1: U2's audio+video stream

    Note over U2: U2 consumes U1's producers (same flow)

    Note over U1,U2: ✅ Both users see each other's video/audio

    Note over U1,TURN: ICE/TURN negotiation (if behind NAT)
    U1->>TURN: STUN binding request (port 3478)
    TURN-->>U1: public IP:port (reflexive address)
    U1->>TURN: TURN allocate (if direct UDP blocked)
    TURN-->>MS: relay media between U1 and mediasoup
```

---

## Diagram 3 — Deployment Architecture

```mermaid
flowchart TD
    subgraph INTERNET["🌍 Internet"]
        USER1["👤 User 1\n(Browser)"]
        USER2["👤 User 2\n(Browser)"]
        USER3["👤 User 3\n(Browser)"]
    end

    subgraph VPS["🖥️ Hostinger VPS / Plesk VPS\n(Ubuntu 22.04 — Public IP: x.x.x.x)"]
        NGINX["Nginx\n(port 80/443)\nReverse Proxy + SSL"]

        subgraph DOCKER["🐳 Docker Containers"]
            APP["meetspace-app\n(Node.js + mediasoup)\nport 5001"]
            COTURN["meetspace-turn\n(coturn)\nport 3478 UDP/TCP"]
        end

        PM2["PM2\n(process manager)\nauto-restart on crash/reboot"]

        NGINX -- "proxy_pass\nlocalhost:5001" --> APP
        PM2 -- "manages" --> APP
    end

    subgraph DNS["🌐 DNS (your domain registrar)"]
        ARECORD["A Record\nmeetconnect.swiftcampus.com\n→ VPS Public IP"]
    end

    subgraph PLESK_PANEL["🎛️ Plesk Panel (optional)"]
        SSL["Let's Encrypt SSL"]
        NGINX_CFG["Nginx Config\n(reverse proxy settings)"]
        GIT["Git Integration\n(auto-deploy on push)"]
    end

    USER1 -- "HTTPS 443\n(React app + WebSocket)" --> NGINX
    USER2 -- "HTTPS 443" --> NGINX
    USER3 -- "HTTPS 443" --> NGINX

    USER1 -- "WebRTC UDP\n40000-49999" --> APP
    USER2 -- "WebRTC UDP\n40000-49999" --> APP
    USER3 -- "WebRTC UDP\n40000-49999" --> APP

    USER1 -. "TURN relay\nUDP/TCP 3478\n(if NAT blocks direct)" .-> COTURN
    USER2 -. "TURN relay" .-> COTURN
    COTURN -. "relayed media" .-> APP

    DNS --> NGINX
    PLESK_PANEL --> NGINX

    style INTERNET fill:#dbeafe,stroke:#3b82f6
    style VPS fill:#dcfce7,stroke:#16a34a
    style DOCKER fill:#f0fdf4,stroke:#86efac
    style DNS fill:#fef3c7,stroke:#f59e0b
    style PLESK_PANEL fill:#fce7f3,stroke:#ec4899
```

---

## Diagram 4 — Port Map

```mermaid
flowchart LR
    subgraph PORTS["Ports that must be open on VPS firewall"]
        P80["80/TCP\nHTTP → redirects to HTTPS"]
        P443["443/TCP\nHTTPS (Nginx)\nWebSocket (Socket.IO)"]
        P3478["3478 UDP+TCP\ncoturn STUN/TURN"]
        P5349["5349 UDP+TCP\ncoturn TURNS/TLS (optional)"]
        P40000["40000-49999/UDP\nmediasoup WebRTC media\n⚠️ CRITICAL"]
    end

    BROWSER["Browser"] --> P80
    BROWSER --> P443
    BROWSER --> P3478
    BROWSER --> P40000

    P80 --> NGINX_BOX["Nginx"]
    P443 --> NGINX_BOX
    NGINX_BOX --> APP_BOX["app.js :5001"]
    P3478 --> COTURN_BOX["coturn"]
    P40000 --> APP_BOX

    style P40000 fill:#fecaca,stroke:#ef4444
    style P443 fill:#bbf7d0,stroke:#16a34a
```
