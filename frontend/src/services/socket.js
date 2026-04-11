import { io } from 'socket.io-client'

// In production, the frontend is served by the same Node.js server,
// so we connect to the same origin (empty string = current host).
// In development, we connect to localhost:5001.
// VITE_SOCKET_URL can override both (set in frontend/.env).
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.DEV ? 'http://localhost:5001' : '')

let socket = null

export const getSocket = () => {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ['polling', 'websocket'], // Start with polling (more reliable), upgrade to WS
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      autoConnect: true,
    })

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket.id, '| transport:', socket.io.engine.transport.name)
    })

    socket.on('connect_error', (err) => {
      console.warn('[Socket] Connection error:', err.message)
    })

    socket.on('reconnect', (attempt) => {
      console.log(`[Socket] Reconnected after ${attempt} attempt(s)`)
    })

    socket.on('reconnect_failed', () => {
      console.error('[Socket] Failed to reconnect after maximum attempts')
    })
  }
  return socket
}

export const disconnectSocket = () => {
  if (socket) {
    socket.removeAllListeners()
    socket.disconnect()
    socket = null
  }
}

export default getSocket
