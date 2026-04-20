 
import { useEffect, useRef, useState, useCallback } from 'react'
import * as mediasoupClient from 'mediasoup-client'
import { getSocket, disconnectSocket } from '../services/socket.js'

const useWebRTC = (roomId, userName) => {
  const [localStream, setLocalStream]         = useState(null)
  const [remoteStreams, setRemoteStreams]      = useState({})   // socketId -> MediaStream
  const [participants, setParticipants]        = useState([])
  const [messages, setMessages]               = useState([])
  const [audioEnabled, setAudioEnabled]       = useState(() => sessionStorage.getItem('audioEnabled') !== 'false')
  const [videoEnabled, setVideoEnabled]       = useState(() => sessionStorage.getItem('videoEnabled') !== 'false')
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [handRaised, setHandRaised]           = useState(false)
  const [notifications, setNotifications]     = useState([])
  const [connectionStatus, setConnectionStatus] = useState('connecting')

  // mediasoup refs
  const deviceRef        = useRef(null)   // mediasoup Device
  const sendTransportRef = useRef(null)   // send WebRtcTransport
  const recvTransportRef = useRef(null)   // recv WebRtcTransport
  const producersRef     = useRef({})     // kind -> Producer  (audio/video)
  const consumersRef     = useRef({})     // consumerId -> Consumer
  const rtpCapRef        = useRef(null)   // router RTP capabilities

  // media refs
  const localStreamRef   = useRef(null)
  const screenStreamRef  = useRef(null)
  const cameraTrackRef   = useRef(null)
  const videoBeforeShare = useRef(true)

  const socketRef   = useRef(null)
  const notifIdRef  = useRef(0)
  const mountedRef  = useRef(true)

  // ── NOTIFICATIONS ──────────────────────────────────────────────────────────
  const addNotification = useCallback((message, type = 'info') => {
    const id = ++notifIdRef.current
    setNotifications(prev => [...prev, { id, message, type }])
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 4000)
  }, [])

  // ── SOCKET EMIT HELPER (promise wrapper) ───────────────────────────────────
  const socketEmit = useCallback((event, data) => new Promise((resolve, reject) => {
    if (!socketRef.current) return reject(new Error('No socket'))
    socketRef.current.emit(event, data, (response) => {
      if (response?.error) reject(new Error(response.error))
      else resolve(response)
    })
  }), [])

  // ── LOAD MEDIASOUP DEVICE ──────────────────────────────────────────────────
  const loadDevice = useCallback(async (routerRtpCapabilities) => {
    const device = new mediasoupClient.Device()
    await device.load({ routerRtpCapabilities })
    deviceRef.current = device
    rtpCapRef.current = device.rtpCapabilities
    return device
  }, [])

  // ── CREATE SEND TRANSPORT ──────────────────────────────────────────────────
  const createSendTransport = useCallback(async (device) => {
    const params = await socketEmit('create-transport', { direction: 'send' })
    const transport = device.createSendTransport(params)

    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      // Fire connect-transport and immediately call callback so mediasoup-client
      // can proceed to produce without waiting for server round-trip
      socketRef.current?.emit('connect-transport', { transportId: transport.id, dtlsParameters }, (res) => {
        if (res?.error) errback(new Error(res.error))
        else callback()
      })
    })

    transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
      socketRef.current?.emit('produce', { transportId: transport.id, kind, rtpParameters, appData }, (res) => {
        if (res?.error) errback(new Error(res.error))
        else callback({ id: res.id })
      })
    })

    transport.on('connectionstatechange', (state) => {
      console.log('[SendTransport] state:', state)
      if (state === 'failed') transport.close()
    })

    sendTransportRef.current = transport
    return transport
  }, [socketEmit])

  // ── CREATE RECV TRANSPORT ──────────────────────────────────────────────────
  const createRecvTransport = useCallback(async (device) => {
    const params = await socketEmit('create-transport', { direction: 'recv' })
    const transport = device.createRecvTransport(params)

    transport.on('connect', ({ dtlsParameters }, callback, errback) => {
      socketRef.current?.emit('connect-transport', { transportId: transport.id, dtlsParameters }, (res) => {
        if (res?.error) errback(new Error(res.error))
        else callback()
      })
    })

    transport.on('connectionstatechange', (state) => {
      console.log('[RecvTransport] state:', state)
    })

    recvTransportRef.current = transport
    return transport
  }, [socketEmit])

  // ── PRODUCE TRACK ──────────────────────────────────────────────────────────
  const produceTrack = useCallback(async (track, appData = {}) => {
    if (!sendTransportRef.current || !track) return null
    // Don't try to produce an ended/stopped track
    if (track.readyState === 'ended') return null
    try {
      const producer = await sendTransportRef.current.produce({ track, appData })
      producersRef.current[track.kind] = producer
      producer.on('transportclose', () => { delete producersRef.current[track.kind] })
      producer.on('trackended', () => {
        socketRef.current?.emit('producer-closed', { producerId: producer.id })
        producer.close()
        delete producersRef.current[track.kind]
      })
      return producer
    } catch (err) {
      console.error('[produce] error:', err)
      return null
    }
  }, [])

  // ── CONSUME PRODUCER ───────────────────────────────────────────────────────
  const consumeProducer = useCallback(async (producerId, producerSocketId) => {
    if (!recvTransportRef.current || !deviceRef.current) return
    try {
      const params = await socketEmit('consume', {
        producerId,
        producerSocketId,
        rtpCapabilities: deviceRef.current.rtpCapabilities,
      })
      const consumer = await recvTransportRef.current.consume(params)
      consumersRef.current[consumer.id] = consumer

      const track = consumer.track
      setRemoteStreams(prev => {
        const existing = prev[producerSocketId]
        let stream
        if (existing) {
          // Replace track of same kind
          const kept = existing.getTracks().filter(t => t.kind !== track.kind)
          stream = new MediaStream([...kept, track])
        } else {
          stream = new MediaStream([track])
        }
        return { ...prev, [producerSocketId]: stream }
      })

      consumer.on('transportclose', () => {
        delete consumersRef.current[consumer.id]
      })
      return consumer
    } catch (err) {
      console.error('[consume] error:', err)
    }
  }, [socketEmit])

  // ── MAIN EFFECT ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!roomId || !userName) return
    mountedRef.current = true

    const init = async () => {
      try {
        // 1. Get user media
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        })
        if (!mountedRef.current) { stream.getTracks().forEach(t => t.stop()); return }

        localStreamRef.current = stream
        cameraTrackRef.current = stream.getVideoTracks()[0] || null

        // Restore saved media state
        if (sessionStorage.getItem('audioEnabled') === 'false') {
          const t = stream.getAudioTracks()[0]
          if (t) t.enabled = false
        }
        if (sessionStorage.getItem('videoEnabled') === 'false') {
          const t = stream.getVideoTracks()[0]
          if (t) { t.stop(); stream.removeTrack(t); cameraTrackRef.current = null }
        }
        setLocalStream(new MediaStream(stream.getTracks()))

        // 2. Connect socket
        const socket = getSocket()
        socketRef.current = socket

        const doJoin = () => {
          const initAudio = sessionStorage.getItem('audioEnabled') !== 'false'
          const initVideo = sessionStorage.getItem('videoEnabled') !== 'false'
          socket.emit('join-room', { roomId, userName, audioEnabled: initAudio, videoEnabled: initVideo })
        }
        // Only register connect handler OR call immediately — never both
        if (socket.connected) {
          doJoin()
        } else {
          socket.once('connect', doJoin)
        }

        // 3. room-joined → load device, create transports, produce, consume existing
        socket.once('room-joined', async ({ routerRtpCapabilities, participants: existing, chatHistory }) => {
          if (!mountedRef.current) return
          setParticipants(existing)
          setMessages(chatHistory || [])
          setConnectionStatus('connected')

          // Load mediasoup device
          const device = await loadDevice(routerRtpCapabilities)

          // Create send + recv transports in parallel
          const [, ] = await Promise.all([
            createSendTransport(device),
            createRecvTransport(device),
          ])

          // Produce local tracks
          const audioTrack = localStreamRef.current?.getAudioTracks()[0]
          const videoTrack = localStreamRef.current?.getVideoTracks()[0]
          if (audioTrack) await produceTrack(audioTrack, { kind: 'audio' })
          if (videoTrack) await produceTrack(videoTrack, { kind: 'video' })

          // Consume all existing producers
          for (const peer of existing) {
            for (const { producerId } of (peer.producers || [])) {
              await consumeProducer(producerId, peer.id)
            }
          }
        })

        // 4. New user joined
        socket.on('user-joined', ({ userId, userName: n, audioEnabled: a, videoEnabled: v, isScreenSharing: s, handRaised: h }) => {
          if (!mountedRef.current) return
          setParticipants(prev => [...prev, { id: userId, name: n, audioEnabled: a !== false, videoEnabled: v !== false, isScreenSharing: s || false, handRaised: h || false }])
          addNotification(`${n} joined the meeting`, 'success')
        })

        // 5. New producer from existing peer
        socket.on('new-producer', async ({ producerId, producerSocketId }) => {
          if (!mountedRef.current) return
          await consumeProducer(producerId, producerSocketId)
        })

        // 6. Producer closed (remote peer stopped track)
        socket.on('producer-closed', ({ producerSocketId }) => {
          if (!mountedRef.current) return
          setRemoteStreams(prev => {
            const updated = { ...prev }
            delete updated[producerSocketId]
            return updated
          })
        })

        // 7. User left
        socket.on('user-left', ({ userId, userName: n }) => {
          if (!mountedRef.current) return
          setParticipants(prev => prev.filter(p => p.id !== userId))
          setRemoteStreams(prev => { const u = { ...prev }; delete u[userId]; return u })
          addNotification(`${n} left the meeting`, 'info')
        })

        // 8. State sync events
        socket.on('user-media-state-change', ({ userId, audioEnabled: a, videoEnabled: v }) => {
          if (!mountedRef.current) return
          setParticipants(prev => prev.map(p => p.id === userId ? { ...p, audioEnabled: a, videoEnabled: v } : p))
        })
        socket.on('user-screen-share-state', ({ userId, isSharing }) => {
          if (!mountedRef.current) return
          setParticipants(prev => prev.map(p => p.id === userId ? { ...p, isScreenSharing: isSharing } : p))
        })
        socket.on('user-raise-hand', ({ userId, userName: n, raised }) => {
          if (!mountedRef.current) return
          setParticipants(prev => prev.map(p => p.id === userId ? { ...p, handRaised: raised } : p))
          if (raised && n) addNotification(`${n} raised their hand ✋`, 'info')
        })
        socket.on('chat-message', (msg) => { if (mountedRef.current) setMessages(prev => [...prev, msg]) })
        socket.on('room-full', ({ max }) => { addNotification(`Room is full (max ${max})`, 'error'); setConnectionStatus('error') })

      } catch (err) {
        console.error('[useWebRTC] init error:', err)
        setConnectionStatus('error')
        addNotification('Could not access camera/microphone', 'error')
      }
    }

    init()

    return () => {
      mountedRef.current = false
      // Close mediasoup resources
      Object.values(producersRef.current).forEach(p => { try { p.close() } catch (_) {} })
      Object.values(consumersRef.current).forEach(c => { try { c.close() } catch (_) {} })
      if (sendTransportRef.current) { try { sendTransportRef.current.close() } catch (_) {} }
      if (recvTransportRef.current) { try { recvTransportRef.current.close() } catch (_) {} }
      producersRef.current = {}
      consumersRef.current = {}
      sendTransportRef.current = null
      recvTransportRef.current = null
      deviceRef.current = null
      // Stop local media
      localStreamRef.current?.getTracks().forEach(t => t.stop())
      screenStreamRef.current?.getTracks().forEach(t => t.stop())
      disconnectSocket()
    }
  }, [roomId, userName, loadDevice, createSendTransport, createRecvTransport, produceTrack, consumeProducer, addNotification])

  // ── TOGGLE AUDIO ───────────────────────────────────────────────────────────
  const toggleAudio = useCallback(() => {
    const audioProducer = producersRef.current['audio']
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    const newEnabled = !track.enabled
    track.enabled = newEnabled
    if (audioProducer) {
      newEnabled ? audioProducer.resume() : audioProducer.pause()
    }
    setAudioEnabled(newEnabled)
    sessionStorage.setItem('audioEnabled', String(newEnabled))
    socketRef.current?.emit('media-state-change', { roomId, audioEnabled: newEnabled, videoEnabled })
  }, [roomId, videoEnabled])

  // ── TOGGLE VIDEO ───────────────────────────────────────────────────────────
  const toggleVideo = useCallback(async () => {
    if (isScreenSharing) return
    const videoProducer = producersRef.current['video']

    if (videoEnabled) {
      // Turn OFF — stop track, close producer
      const track = localStreamRef.current?.getVideoTracks()[0]
      if (track) { track.stop(); localStreamRef.current.removeTrack(track) }
      if (videoProducer) {
        socketRef.current?.emit('producer-closed', { producerId: videoProducer.id })
        videoProducer.close()
        delete producersRef.current['video']
      }
      setVideoEnabled(false)
      sessionStorage.setItem('videoEnabled', 'false')
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
      socketRef.current?.emit('media-state-change', { roomId, audioEnabled, videoEnabled: false })
    } else {
      // Turn ON — get new track, produce it
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } })
        const newTrack = newStream.getVideoTracks()[0]
        localStreamRef.current.addTrack(newTrack)
        cameraTrackRef.current = newTrack
        await produceTrack(newTrack, { kind: 'video' })
        setVideoEnabled(true)
        sessionStorage.setItem('videoEnabled', 'true')
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
        socketRef.current?.emit('media-state-change', { roomId, audioEnabled, videoEnabled: true })
      } catch (err) { console.error('[toggleVideo] error:', err) }
    }
  }, [roomId, audioEnabled, videoEnabled, isScreenSharing, produceTrack])

  // ── TOGGLE SCREEN SHARE ────────────────────────────────────────────────────
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      // Stop screen share, restore camera
      screenStreamRef.current?.getTracks().forEach(t => t.stop())
      screenStreamRef.current = null
      const videoProducer = producersRef.current['video']
      if (videoProducer) { videoProducer.close(); delete producersRef.current['video'] }

      if (videoBeforeShare.current) {
        try {
          const ns = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } })
          const nt = ns.getVideoTracks()[0]
          localStreamRef.current.getVideoTracks().forEach(t => { localStreamRef.current.removeTrack(t); t.stop() })
          localStreamRef.current.addTrack(nt)
          cameraTrackRef.current = nt
          await produceTrack(nt, { kind: 'video' })
          setVideoEnabled(true)
        } catch (_) { setVideoEnabled(false) }
      } else {
        localStreamRef.current.getVideoTracks().forEach(t => { localStreamRef.current.removeTrack(t); t.stop() })
        setVideoEnabled(false)
      }
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
      setIsScreenSharing(false)
      socketRef.current?.emit('screen-share-state', { roomId, isSharing: false })
      addNotification('Screen sharing stopped', 'info')
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
        screenStreamRef.current = screenStream
        const screenTrack = screenStream.getVideoTracks()[0]
        videoBeforeShare.current = videoEnabled

        // Close existing video producer
        const videoProducer = producersRef.current['video']
        if (videoProducer) { videoProducer.close(); delete producersRef.current['video'] }

        // Swap video track in local stream
        localStreamRef.current.getVideoTracks().forEach(t => { localStreamRef.current.removeTrack(t); t.stop() })
        localStreamRef.current.addTrack(screenTrack)
        await produceTrack(screenTrack, { kind: 'video', screen: true })

        setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
        setIsScreenSharing(true)
        setVideoEnabled(true)
        socketRef.current?.emit('screen-share-state', { roomId, isSharing: true })
        addNotification('Screen sharing started', 'success')

        screenTrack.onended = () => toggleScreenShare()
      } catch (err) {
        if (err.name !== 'NotAllowedError') {
          console.error('[screenShare] error:', err)
          addNotification('Could not start screen sharing', 'error')
        }
      }
    }
  }, [isScreenSharing, videoEnabled, roomId, addNotification, produceTrack])

  // ── RAISE HAND ─────────────────────────────────────────────────────────────
  const toggleRaiseHand = useCallback(() => {
    const newState = !handRaised
    setHandRaised(newState)
    socketRef.current?.emit('raise-hand', { roomId, raised: newState })
    if (newState) addNotification('You raised your hand ✋', 'info')
  }, [handRaised, roomId, addNotification])

  // ── CHAT ───────────────────────────────────────────────────────────────────
  const sendMessage = useCallback((message) => {
    if (!socketRef.current || !message?.trim()) return
    socketRef.current.emit('chat-message', { roomId, message })
  }, [roomId])

  // ── LEAVE ──────────────────────────────────────────────────────────────────
  const leaveRoom = useCallback(() => {
    Object.values(producersRef.current).forEach(p => { try { p.close() } catch (_) {} })
    Object.values(consumersRef.current).forEach(c => { try { c.close() } catch (_) {} })
    if (sendTransportRef.current) { try { sendTransportRef.current.close() } catch (_) {} }
    if (recvTransportRef.current) { try { recvTransportRef.current.close() } catch (_) {} }
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    screenStreamRef.current?.getTracks().forEach(t => t.stop())
    sessionStorage.removeItem('audioEnabled')
    sessionStorage.removeItem('videoEnabled')
    disconnectSocket()
  }, [])

  return {
    localStream, remoteStreams, participants, messages,
    audioEnabled, videoEnabled, isScreenSharing, handRaised,
    notifications, connectionStatus,
    iceDebug: {},   // mediasoup handles ICE internally; kept for API compatibility
    toggleAudio, toggleVideo, toggleScreenShare, toggleRaiseHand,
    sendMessage, leaveRoom,
  }
}

export default useWebRTC
