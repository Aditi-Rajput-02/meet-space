import { useEffect, useRef, useState, useCallback } from 'react'
import { getSocket, disconnectSocket } from '../services/socket.js'

// ICE servers — STUN only as fallback; real TURN credentials come from server via room-joined
// The server generates time-limited HMAC credentials for Metered.ca TURN
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
]

const useWebRTC = (roomId, userName) => {
  // Restore media preferences from sessionStorage so refresh keeps the same state
  const [localStream, setLocalStream] = useState(null)
  const [remoteStreams, setRemoteStreams] = useState({})
  const [participants, setParticipants] = useState([])
  const [messages, setMessages] = useState([])
  const [audioEnabled, setAudioEnabled] = useState(() => {
    const saved = sessionStorage.getItem('audioEnabled')
    return saved === null ? true : saved === 'true'
  })
  // Camera is ON by default on first join.
  // sessionStorage persists the choice across refreshes within the same session.
  const [videoEnabled, setVideoEnabled] = useState(() => {
    const saved = sessionStorage.getItem('videoEnabled')
    return saved === null ? true : saved === 'true'
  })
  const [isScreenSharing, setIsScreenSharing] = useState(false)
  const [handRaised, setHandRaised] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [connectionStatus, setConnectionStatus] = useState('connecting')
  const [iceDebug, setIceDebug] = useState({}) // peerId -> { iceState, connState, candidates }

  const localStreamRef = useRef(null)
  const screenStreamRef = useRef(null)
  const cameraTrackRef = useRef(null)        // Keep reference to original camera track
  const videoEnabledBeforeScreenShare = useRef(true) // Track video state before screen share
  const peerConnectionsRef = useRef({})
  const iceCandidateQueues = useRef({})      // Queue ICE candidates until remote desc is set
  const iceServersRef = useRef(DEFAULT_ICE_SERVERS) // Dynamic ICE servers from backend
  const socketRef = useRef(null)
  const notifIdRef = useRef(0)

  const addNotification = useCallback((message, type = 'info') => {
    const id = ++notifIdRef.current
    setNotifications(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id))
    }, 4000)
  }, [])

  const createPeerConnection = useCallback((peerId) => {
    // Close and clean up any existing PC for this peer before creating a new one
    // (prevents leaking RTCPeerConnection objects on reconnect/renegotiation)
    if (peerConnectionsRef.current[peerId]) {
      peerConnectionsRef.current[peerId].ontrack = null
      peerConnectionsRef.current[peerId].onicecandidate = null
      peerConnectionsRef.current[peerId].onnegotiationneeded = null
      peerConnectionsRef.current[peerId].onconnectionstatechange = null
      peerConnectionsRef.current[peerId].oniceconnectionstatechange = null
      peerConnectionsRef.current[peerId].onsignalingstatechange = null
      peerConnectionsRef.current[peerId].close()
      delete peerConnectionsRef.current[peerId]
    }

    // Use dynamic ICE servers from backend (includes TURN if configured)
    const pc = new RTCPeerConnection({
      iceServers: iceServersRef.current,
      iceCandidatePoolSize: 10, // Pre-gather candidates for faster connection
    })

    // Initialize ICE candidate queue for this peer
    iceCandidateQueues.current[peerId] = []

    // Track whether the initial offer has been sent manually.
    // onnegotiationneeded is suppressed until the initial offer is sent,
    // then allowed for all subsequent renegotiations (camera on/off, etc.)
    // Stored as a property on pc so the room-joined handler can set it externally.
    pc._initialOfferSent = false

    // Add local tracks (always use localStreamRef which has the real camera stream)
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current)
      })
    }

    // Handle remote stream - fires for each incoming track
    pc.ontrack = (event) => {
      const incomingTrack = event.track
      const incomingStream = event.streams[0]
      console.log(`[WebRTC] ontrack from ${peerId}: kind=${incomingTrack.kind}`)
      setRemoteStreams(prev => {
        let newStream
        if (prev[peerId]) {
          const existingTracks = prev[peerId].getTracks().filter(t => t.kind !== incomingTrack.kind)
          newStream = new MediaStream([...existingTracks, incomingTrack])
        } else if (incomingStream) {
          newStream = new MediaStream(incomingStream.getTracks())
        } else {
          newStream = new MediaStream([incomingTrack])
        }
        return { ...prev, [peerId]: newStream }
      })
    }

    // Trickle ICE: send candidates to the remote peer via signaling server
    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', {
          targetId: peerId,
          candidate: event.candidate,
        })
      }
    }

    pc.onicegatheringstatechange = () => {
      console.log(`[ICE] Gathering state for ${peerId}: ${pc.iceGatheringState}`)
      setIceDebug(prev => ({ ...prev, [peerId]: { ...prev[peerId], gatherState: pc.iceGatheringState } }))
    }

    pc.oniceconnectionstatechange = () => {
      console.log(`[ICE] Connection state for ${peerId}: ${pc.iceConnectionState}`)
      setIceDebug(prev => ({ ...prev, [peerId]: { ...prev[peerId], iceState: pc.iceConnectionState } }))
    }

    pc.onicecandidateerror = (e) => {
      console.warn(`[ICE] Candidate error for ${peerId}: ${e.errorCode} ${e.errorText} url=${e.url}`)
    }

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection state for ${peerId}: ${pc.connectionState}`)
      setIceDebug(prev => ({ ...prev, [peerId]: { ...prev[peerId], connState: pc.connectionState } }))
      if (pc.connectionState === 'failed') {
        console.warn(`[WebRTC] Connection failed for ${peerId}, attempting ICE restart`)
        pc.restartIce()
        // Don't delete stream on failure — ICE restart may recover it
      }
      if (pc.connectionState === 'closed') {
        // Only remove stream when connection is fully closed (not just failed)
        setRemoteStreams(prev => {
          const updated = { ...prev }
          delete updated[peerId]
          return updated
        })
      }
    }

    pc.onsignalingstatechange = () => {
      // Flush queued ICE candidates once remote description is set
      if (pc.signalingState === 'stable' || pc.signalingState === 'have-remote-offer') {
        const queue = iceCandidateQueues.current[peerId] || []
        if (queue.length > 0) {
          console.log(`[ICE] Flushing ${queue.length} queued candidates for ${peerId}`)
          queue.forEach(candidate => {
            pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(err =>
              console.warn('[ICE] Failed to add queued candidate:', err)
            )
          })
          iceCandidateQueues.current[peerId] = []
        }
      }
    }

    // onnegotiationneeded: fired automatically when tracks are added/removed mid-call.
    // This is the standard WebRTC renegotiation trigger — handles both:
    //   • A late joiner turning their own camera ON (their side fires this)
    //   • An existing user turning camera ON after a late joiner connected (their side fires this)
    pc._negotiationPending = false
    pc.onnegotiationneeded = async () => {
      // Skip until the initial offer has been sent manually (from room-joined handler).
      // After that, allow all renegotiations (camera on/off, screen share, etc.)
      if (!pc._initialOfferSent) {
        console.log(`[WebRTC] onnegotiationneeded suppressed (initial offer not yet sent) for ${peerId}`)
        return
      }
      // If not stable, mark pending and wait — the answer handler will trigger a retry
      if (pc.signalingState !== 'stable') {
        console.log(`[WebRTC] onnegotiationneeded deferred for ${peerId} (state=${pc.signalingState})`)
        pc._negotiationPending = true
        return
      }
      pc._negotiationPending = false
      console.log(`[WebRTC] onnegotiationneeded for ${peerId} — sending renegotiation offer`)
      try {
        const offer = await pc.createOffer()
        // Guard: state may have changed while awaiting
        if (pc.signalingState !== 'stable') {
          pc._negotiationPending = true
          return
        }
        await pc.setLocalDescription(offer)
        socketRef.current?.emit('offer', { targetId: peerId, offer })
      } catch (err) {
        console.error(`[WebRTC] onnegotiationneeded offer failed for ${peerId}:`, err)
      }
    }

    peerConnectionsRef.current[peerId] = pc
    return pc
  }, [])

  const closePeerConnection = useCallback((peerId) => {
    if (peerConnectionsRef.current[peerId]) {
      const pc = peerConnectionsRef.current[peerId]
      // Null all handlers before closing to prevent stale callbacks firing
      pc.ontrack = null
      pc.onicecandidate = null
      pc.onnegotiationneeded = null
      pc.onconnectionstatechange = null
      pc.oniceconnectionstatechange = null
      pc.onicegatheringstatechange = null
      pc.onsignalingstatechange = null
      pc.close()
      delete peerConnectionsRef.current[peerId]
    }
    // Clear any queued ICE candidates for this peer
    delete iceCandidateQueues.current[peerId]
    setRemoteStreams(prev => {
      const updated = { ...prev }
      delete updated[peerId]
      return updated
    })
  }, [])

  // Initialize media and socket
  useEffect(() => {
    if (!roomId || !userName) return

    let mounted = true

    const init = async () => {
      try {
        // Get user media
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: { echoCancellation: true, noiseSuppression: true },
        })

        if (!mounted) {
          stream.getTracks().forEach(t => t.stop())
          return
        }

        localStreamRef.current = stream
        // Store camera track reference for screen share restore
        cameraTrackRef.current = stream.getVideoTracks()[0] || null

        // Restore saved media state: disable audio/video tracks if they were off before refresh
        const savedAudio = sessionStorage.getItem('audioEnabled')
        const savedVideo = sessionStorage.getItem('videoEnabled')

        if (savedAudio === 'false') {
          const audioTrack = stream.getAudioTracks()[0]
          if (audioTrack) audioTrack.enabled = false
        }

        // Video is ON by default on first join (savedVideo === null → true).
        // Only stop the video track if the user explicitly turned it OFF in this session.
        if (savedVideo === 'false') {
          // Stop the video track entirely so camera light turns off
          const videoTrack = stream.getVideoTracks()[0]
          if (videoTrack) {
            videoTrack.stop()
            stream.removeTrack(videoTrack)
            cameraTrackRef.current = null
          }
        }

        setLocalStream(new MediaStream(stream.getTracks()))
        setConnectionStatus('connected')

        // Connect socket
        const socket = getSocket()
        socketRef.current = socket

        // Emit join-room exactly once:
        // - If already connected, emit immediately
        // - Otherwise wait for the 'connect' event
        // Using a flag prevents double-emit if socket connects synchronously
        let joinedRoom = false
        const doJoinRoom = () => {
          if (joinedRoom) return
          joinedRoom = true
          // Send actual initial media state so the server stores the correct values.
          // Late joiners will see the correct camera/mic state in the participant list.
          // Audio defaults to true (null → true), video defaults to true (null → true).
          const initAudio = sessionStorage.getItem('audioEnabled') !== 'false'
          const initVideo = sessionStorage.getItem('videoEnabled') !== 'false'
          socket.emit('join-room', { roomId, userName, audioEnabled: initAudio, videoEnabled: initVideo })
        }

        socket.on('connect', doJoinRoom)

        if (socket.connected) {
          doJoinRoom()
        }

        // Handle socket reconnect: close all stale peer connections and re-join the room.
        // The server will send a fresh room-joined with the current participant list,
        // and we'll create new peer connections for everyone.
        socket.on('reconnect', () => {
          if (!mounted) return
          console.log('[Socket] Reconnected — closing stale peer connections and re-joining room')
          // Close all existing peer connections (they're dead after a reconnect)
          Object.keys(peerConnectionsRef.current).forEach(peerId => {
            const pc = peerConnectionsRef.current[peerId]
            pc.ontrack = null
            pc.onicecandidate = null
            pc.onnegotiationneeded = null
            pc.onconnectionstatechange = null
            pc.oniceconnectionstatechange = null
            pc.onicegatheringstatechange = null
            pc.onsignalingstatechange = null
            pc.close()
          })
          peerConnectionsRef.current = {}
          iceCandidateQueues.current = {}
          setRemoteStreams({})
          setParticipants([])
          // Re-join: reset the flag so doJoinRoom can fire again
          joinedRoom = false
          doJoinRoom()
        })

        // Room full — notify user and redirect them out
        socket.on('room-full', ({ max }) => {
          if (!mounted) return
          addNotification(`Room is full (max ${max} participants)`, 'error')
          setConnectionStatus('error')
        })

        // Room joined - existing participants + ICE server config from backend
        socket.on('room-joined', async ({ participants: existingParticipants, chatHistory, iceServers }) => {
          if (!mounted) return

          // Use server-provided ICE config (server generates HMAC TURN credentials)
          if (iceServers && iceServers.length > 0) {
            iceServersRef.current = iceServers
            console.log('[ICE] Using server ICE config:', iceServersRef.current.length, 'servers')
            iceServers.forEach(s => {
              const url = Array.isArray(s.urls) ? s.urls[0] : s.urls
              console.log('[ICE] Server:', url)
            })
          }

          setParticipants(existingParticipants)
          setMessages(chatHistory || [])

          // Create offers for all existing participants IN PARALLEL for faster connection
          // Each offer is independently error-handled so one failure doesn't block others
          await Promise.all(existingParticipants.map(async (participant) => {
            const pc = createPeerConnection(participant.id)
            try {
              const offer = await pc.createOffer()
              await pc.setLocalDescription(offer)
              socket.emit('offer', { targetId: participant.id, offer })
              // Mark initial offer as sent — onnegotiationneeded can now fire for renegotiations
              pc._initialOfferSent = true
            } catch (err) {
              console.error(`[WebRTC] Error creating offer for ${participant.id}:`, err)
              // Still mark as sent so renegotiation isn't permanently blocked
              pc._initialOfferSent = true
            }
          }))
        })

        // New user joined - include their initial state
        socket.on('user-joined', ({ userId, userName: newUserName, audioEnabled: audio, videoEnabled: video, isScreenSharing: sharing, handRaised: hand }) => {
          if (!mounted) return
          setParticipants(prev => [...prev, {
            id: userId,
            name: newUserName,
            audioEnabled: audio !== undefined ? audio : true,
            videoEnabled: video !== undefined ? video : true,
            isScreenSharing: sharing || false,
            handRaised: hand || false,
          }])
          addNotification(`${newUserName} joined the meeting`, 'success')
        })

        // User left
        socket.on('user-left', ({ userId, userName: leftUserName }) => {
          if (!mounted) return
          closePeerConnection(userId)
          setParticipants(prev => prev.filter(p => p.id !== userId))
          addNotification(`${leftUserName} left the meeting`, 'info')
        })

        // Helper: flush queued ICE candidates after remote desc is set
        const flushIceCandidates = async (peerId, pc) => {
          const queue = iceCandidateQueues.current[peerId] || []
          if (queue.length > 0) {
            console.log(`[ICE] Flushing ${queue.length} queued candidates for ${peerId}`)
            for (const candidate of queue) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate))
              } catch (err) {
                console.warn('[ICE] Failed to add queued candidate:', err.message)
              }
            }
            iceCandidateQueues.current[peerId] = []
          }
        }

        // Receive offer → perfect negotiation pattern
        // Reuse existing PC for renegotiation; handle glare (simultaneous offers) with rollback.
        // "Polite" peer = the one who joined later (higher socket ID lexicographically).
        // Polite peer rolls back its own offer when it receives a remote offer during glare.
        socket.on('offer', async ({ fromId, offer }) => {
          if (!mounted) return
          const existingPc = peerConnectionsRef.current[fromId]
          const pc = existingPc || createPeerConnection(fromId)

          // Detect glare: we already sent an offer and remote also sent one
          const offerCollision = pc.signalingState !== 'stable'
          // Polite peer: determined by socket ID comparison (consistent across both sides)
          const isPolite = socket.id > fromId

          if (offerCollision && !isPolite) {
            // Impolite peer ignores the incoming offer — our offer takes precedence
            console.log(`[WebRTC] Glare: impolite peer ignoring offer from ${fromId}`)
            return
          }

          try {
            if (offerCollision && isPolite) {
              // Polite peer rolls back its own offer to accept the remote one
              console.log(`[WebRTC] Glare: polite peer rolling back for ${fromId}`)
              await pc.setLocalDescription({ type: 'rollback' })
            }
            await pc.setRemoteDescription(new RTCSessionDescription(offer))
            await flushIceCandidates(fromId, pc)
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            socket.emit('answer', { targetId: fromId, answer })
            // Mark as ready for renegotiation — answerer side is now fully connected
            pc._initialOfferSent = true
          } catch (err) {
            console.error(`[WebRTC] Error handling offer from ${fromId}:`, err)
          }
        })

        // Receive answer → set remote desc, flush ICE queue
        socket.on('answer', async ({ fromId, answer }) => {
          if (!mounted) return
          const pc = peerConnectionsRef.current[fromId]
          if (!pc) return
          // Guard: only accept answer when we're in have-local-offer state
          if (pc.signalingState !== 'have-local-offer') {
            console.warn(`[WebRTC] Ignoring answer from ${fromId} in state ${pc.signalingState}`)
            return
          }
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(answer))
            await flushIceCandidates(fromId, pc)
            // If a renegotiation was deferred while we were waiting for this answer,
            // trigger it now that we're back in stable state
            if (pc._negotiationPending) {
              console.log(`[WebRTC] Triggering deferred negotiation for ${fromId}`)
              pc._negotiationPending = false
              if (pc.signalingState === 'stable') {
                try {
                  const offer = await pc.createOffer()
                  if (pc.signalingState !== 'stable') return
                  await pc.setLocalDescription(offer)
                  socketRef.current?.emit('offer', { targetId: fromId, offer })
                  console.log(`[WebRTC] Deferred renegotiation offer sent to ${fromId}`)
                } catch (err) {
                  console.error(`[WebRTC] Deferred renegotiation failed for ${fromId}:`, err)
                }
              }
            }
          } catch (err) {
            console.error(`[WebRTC] Error handling answer from ${fromId}:`, err)
          }
        })

        // Receive ICE candidate - queue if remote description not yet set
        socket.on('ice-candidate', async ({ fromId, candidate }) => {
          if (!mounted) return
          const pc = peerConnectionsRef.current[fromId]
          if (!pc) return

          // If remote description is not set yet, queue the candidate
          if (!pc.remoteDescription || !pc.remoteDescription.type) {
            if (!iceCandidateQueues.current[fromId]) {
              iceCandidateQueues.current[fromId] = []
            }
            iceCandidateQueues.current[fromId].push(candidate)
            console.log(`[ICE] Queued candidate for ${fromId} (no remote desc yet)`)
          } else {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate))
            } catch (err) {
              console.warn('[ICE] Error adding candidate:', err.message)
            }
          }
        })

        // Chat message
        socket.on('chat-message', (msg) => {
          if (!mounted) return
          setMessages(prev => [...prev, msg])
        })

        // Media state change
        socket.on('user-media-state-change', ({ userId, audioEnabled: audio, videoEnabled: video }) => {
          if (!mounted) return
          setParticipants(prev =>
            prev.map(p => p.id === userId ? { ...p, audioEnabled: audio, videoEnabled: video } : p)
          )
        })

        // Screen share state
        socket.on('user-screen-share-state', ({ userId, isSharing }) => {
          if (!mounted) return
          setParticipants(prev =>
            prev.map(p => p.id === userId ? { ...p, isScreenSharing: isSharing } : p)
          )
        })

        // Raise hand
        socket.on('user-raise-hand', ({ userId, userName: raisedUserName, raised }) => {
          if (!mounted) return
          setParticipants(prev =>
            prev.map(p => p.id === userId ? { ...p, handRaised: raised } : p)
          )
          if (raised && raisedUserName) {
            addNotification(`${raisedUserName} raised their hand ✋`, 'info')
          }
        })

      } catch (err) {
        console.error('Media error:', err)
        setConnectionStatus('error')
        addNotification('Could not access camera/microphone', 'error')
      }
    }

    init()

    return () => {
      mounted = false
      // Cleanup peer connections
      Object.values(peerConnectionsRef.current).forEach(pc => pc.close())
      peerConnectionsRef.current = {}
      // Stop local stream
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop())
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach(t => t.stop())
      }
      disconnectSocket()
    }
  }, [roomId, userName])

  // Toggle audio
  const toggleAudio = useCallback(() => {
    if (!localStreamRef.current) return
    const audioTrack = localStreamRef.current.getAudioTracks()[0]
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled
      setAudioEnabled(audioTrack.enabled)
      sessionStorage.setItem('audioEnabled', String(audioTrack.enabled))
      socketRef.current?.emit('media-state-change', {
        roomId,
        audioEnabled: audioTrack.enabled,
        videoEnabled,
      })
    }
  }, [roomId, videoEnabled])

  // Toggle video - properly stops/starts camera hardware (turns off camera light)
  const toggleVideo = useCallback(async () => {
    if (!localStreamRef.current) return
    // Don't allow toggling camera while screen sharing is active
    if (isScreenSharing) return

    if (videoEnabled) {
      // ── TURN OFF ──────────────────────────────────────────────────────────
      const videoTrack = localStreamRef.current.getVideoTracks()[0]
      if (videoTrack) {
        videoTrack.stop() // Turns off camera hardware light
        localStreamRef.current.removeTrack(videoTrack)
      }

      // Null out the video sender in all peer connections.
      // replaceTrack(null) keeps the transceiver alive so we can restore later.
      Object.values(peerConnectionsRef.current).forEach(pc => {
        const videoSender = pc.getSenders().find(s =>
          (s.track && s.track.kind === 'video') || s.track === null
        )
        if (videoSender) {
          videoSender.replaceTrack(null).catch(() => {})
        }
      })

      setVideoEnabled(false)
      sessionStorage.setItem('videoEnabled', 'false')
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
      socketRef.current?.emit('media-state-change', { roomId, audioEnabled, videoEnabled: false })

    } else {
      // ── TURN ON ───────────────────────────────────────────────────────────
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        const newVideoTrack = newStream.getVideoTracks()[0]

        // Add to local stream reference and update camera track ref
        localStreamRef.current.addTrack(newVideoTrack)
        cameraTrackRef.current = newVideoTrack

        // Update all peer connections
        for (const [peerId, pc] of Object.entries(peerConnectionsRef.current)) {
          // Find any existing video sender — including ones with track === null
          // (from a previous replaceTrack(null) call when camera was turned off)
          const videoSender = pc.getSenders().find(s =>
            (s.track && s.track.kind === 'video') || s.track === null
          )

          if (videoSender) {
            // ── Case 1: Sender exists (possibly with null track) ──
            // replaceTrack does NOT trigger renegotiation — remote side
            // already has a video transceiver and will start receiving frames.
            try {
              await videoSender.replaceTrack(newVideoTrack)
              console.log(`[WebRTC] replaceTrack video → ${peerId}`)
            } catch (e) {
              console.warn(`[WebRTC] replaceTrack failed for ${peerId}:`, e.message)
            }
          } else {
            // ── Case 2: No video sender at all ──
            // Peer connected while camera was completely off (no video transceiver).
            // addTrack will trigger onnegotiationneeded which sends the renegotiation offer.
            // The onnegotiationneeded handler in createPeerConnection handles this correctly.
            console.log(`[WebRTC] addTrack video for ${peerId} — onnegotiationneeded will renegotiate`)
            pc.addTrack(newVideoTrack, localStreamRef.current)
            // onnegotiationneeded fires asynchronously and sends the offer automatically
          }
        }

        setVideoEnabled(true)
        sessionStorage.setItem('videoEnabled', 'true')
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
        socketRef.current?.emit('media-state-change', { roomId, audioEnabled, videoEnabled: true })
      } catch (err) {
        console.error('[WebRTC] Error enabling video:', err)
      }
    }
  }, [roomId, audioEnabled, videoEnabled, isScreenSharing])

  // Helper to restore camera after screen share ends
  const restoreCameraAfterScreenShare = useCallback(async () => {
    // Stop the screen capture stream
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop())
      screenStreamRef.current = null
    }

    // Remove any screen track that was added to localStreamRef during screen share
    const screenTracks = localStreamRef.current?.getVideoTracks() || []
    screenTracks.forEach(t => {
      if (t !== cameraTrackRef.current) {
        localStreamRef.current.removeTrack(t)
        t.stop()
      }
    })

    // Determine if we had video enabled before screen share started
    const hadVideoEnabled = videoEnabledBeforeScreenShare.current

    if (hadVideoEnabled) {
      // Try to use the stored camera track if it's still alive
      let cameraTrack = cameraTrackRef.current && cameraTrackRef.current.readyState !== 'ended'
        ? cameraTrackRef.current
        : null

      // If camera track is gone/ended, re-acquire from getUserMedia
      if (!cameraTrack) {
        try {
          const newStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          })
          cameraTrack = newStream.getVideoTracks()[0]
          cameraTrackRef.current = cameraTrack
        } catch (err) {
          console.error('[ScreenShare] Failed to re-acquire camera after screen share:', err)
        }
      }

      if (cameraTrack) {
        // Ensure the camera track is in localStreamRef
        if (!localStreamRef.current.getTracks().includes(cameraTrack)) {
          localStreamRef.current.addTrack(cameraTrack)
        }
        // Restore camera track in all peer connections SEQUENTIALLY to avoid
        // concurrent signalingState conflicts when multiple peers need renegotiation.
        for (const [peerId, pc] of Object.entries(peerConnectionsRef.current)) {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video' || s.track === null)
          if (sender) {
            try { await sender.replaceTrack(cameraTrack) } catch (e) { /* ignore */ }
          } else {
            pc.addTrack(cameraTrack, localStreamRef.current)
            try {
              if (pc.signalingState === 'stable') {
                const offer = await pc.createOffer()
                if (pc.signalingState !== 'stable') continue
                await pc.setLocalDescription(offer)
                socketRef.current?.emit('offer', { targetId: peerId, offer })
                console.log(`[WebRTC] Sent renegotiation offer to ${peerId} after screen share restore`)
              }
            } catch (err) {
              console.error(`[WebRTC] Renegotiation offer failed for ${peerId} (screen restore):`, err)
            }
          }
        }
      }

      setVideoEnabled(true)
    } else {
      // Video was off before screen share — restore null/off state in peers
      Object.values(peerConnectionsRef.current).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video' || s.track === null)
        if (sender) sender.replaceTrack(null).catch(() => {})
      })
      setVideoEnabled(false)
    }

    setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
    setIsScreenSharing(false)
    socketRef.current?.emit('screen-share-state', { roomId, isSharing: false })
    addNotification('Screen sharing stopped', 'info')
  }, [roomId, addNotification])

  // Toggle screen share
  const toggleScreenShare = useCallback(async () => {
    if (isScreenSharing) {
      await restoreCameraAfterScreenShare()
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        screenStreamRef.current = screenStream
        const screenTrack = screenStream.getVideoTracks()[0]

        // Save video state before screen share so we can restore it correctly
        videoEnabledBeforeScreenShare.current = videoEnabled

        // Step 1: Update localStreamRef FIRST so the screen track is in the stream
        // before we reference it in addTrack calls below.
        const oldVideoTracks = localStreamRef.current.getVideoTracks()
        oldVideoTracks.forEach(t => localStreamRef.current.removeTrack(t))
        localStreamRef.current.addTrack(screenTrack)

        // Step 2: Replace/add video track in ALL existing peer connections SEQUENTIALLY
        // (sequential avoids concurrent signalingState conflicts when multiple peers
        //  need addTrack + createOffer at the same time)
        for (const [peerId, pc] of Object.entries(peerConnectionsRef.current)) {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video' || s.track === null)
          if (sender) {
            // Existing video sender — replaceTrack swaps without renegotiation
            try { await sender.replaceTrack(screenTrack) } catch (e) { /* ignore */ }
          } else {
            // No video sender (camera was off when this peer connected).
            // addTrack + manual renegotiation.
            pc.addTrack(screenTrack, localStreamRef.current)
            try {
              if (pc.signalingState === 'stable') {
                const offer = await pc.createOffer()
                if (pc.signalingState !== 'stable') continue
                await pc.setLocalDescription(offer)
                socketRef.current?.emit('offer', { targetId: peerId, offer })
                console.log(`[WebRTC] Sent renegotiation offer to ${peerId} for screen share start`)
              }
            } catch (err) {
              console.error(`[WebRTC] Renegotiation offer failed for ${peerId} (screen share):`, err)
            }
          }
        }

        // Step 3: Update local stream display to show screen share preview
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
        setIsScreenSharing(true)
        setVideoEnabled(true) // Screen share counts as "video on" for display purposes
        socketRef.current?.emit('screen-share-state', { roomId, isSharing: true })
        addNotification('Screen sharing started', 'success')

        // Handle user stopping screen share via browser's built-in "Stop sharing" button
        screenTrack.onended = () => {
          restoreCameraAfterScreenShare()
        }
      } catch (err) {
        if (err.name !== 'NotAllowedError') {
          console.error('Screen share error:', err)
          addNotification('Could not start screen sharing', 'error')
        }
        // If user cancelled (NotAllowedError), do nothing silently
      }
    }
  }, [isScreenSharing, videoEnabled, roomId, addNotification, restoreCameraAfterScreenShare])

  // Toggle raise hand
  const toggleRaiseHand = useCallback(() => {
    const newState = !handRaised
    setHandRaised(newState)
    socketRef.current?.emit('raise-hand', { roomId, raised: newState })
    if (newState) addNotification('You raised your hand ✋', 'info')
  }, [handRaised, roomId, addNotification])

  // Send chat message
  const sendMessage = useCallback((message) => {
    if (!socketRef.current || !message.trim()) return
    socketRef.current.emit('chat-message', { roomId, message })
  }, [roomId])

  // Leave room — clear saved media prefs so next join starts fresh
  const leaveRoom = useCallback(() => {
    Object.values(peerConnectionsRef.current).forEach(pc => pc.close())
    peerConnectionsRef.current = {}
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop())
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(t => t.stop())
    }
    sessionStorage.removeItem('audioEnabled')
    sessionStorage.removeItem('videoEnabled')
    disconnectSocket()
  }, [])

  return {
    localStream,
    remoteStreams,
    participants,
    messages,
    audioEnabled,
    videoEnabled,
    isScreenSharing,
    handRaised,
    notifications,
    connectionStatus,
    iceDebug,
    peerConnectionsRef,
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    toggleRaiseHand,
    sendMessage,
    leaveRoom,
  }
}

export default useWebRTC
