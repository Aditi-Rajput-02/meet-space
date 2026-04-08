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
    // Use dynamic ICE servers from backend (includes TURN if configured)
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current })

    // Initialize ICE candidate queue for this peer
    iceCandidateQueues.current[peerId] = []

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

    peerConnectionsRef.current[peerId] = pc
    return pc
  }, [])

  const closePeerConnection = useCallback((peerId) => {
    if (peerConnectionsRef.current[peerId]) {
      peerConnectionsRef.current[peerId].close()
      delete peerConnectionsRef.current[peerId]
    }
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

        socket.on('connect', () => {
          socket.emit('join-room', { roomId, userName })
        })

        if (socket.connected) {
          socket.emit('join-room', { roomId, userName })
        }

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

          // Create offers for all existing participants
          for (const participant of existingParticipants) {
            const pc = createPeerConnection(participant.id)
            try {
              const offer = await pc.createOffer()
              await pc.setLocalDescription(offer)
              socket.emit('offer', { targetId: participant.id, offer })
            } catch (err) {
              console.error('Error creating offer:', err)
            }
          }
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

        // Receive offer → set remote desc, create answer, flush ICE queue
        socket.on('offer', async ({ fromId, offer }) => {
          if (!mounted) return
          const pc = createPeerConnection(fromId)
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer))
            await flushIceCandidates(fromId, pc)
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            socket.emit('answer', { targetId: fromId, answer })
          } catch (err) {
            console.error('Error handling offer:', err)
          }
        })

        // Receive answer → set remote desc, flush ICE queue
        socket.on('answer', async ({ fromId, answer }) => {
          if (!mounted) return
          const pc = peerConnectionsRef.current[fromId]
          if (pc) {
            try {
              await pc.setRemoteDescription(new RTCSessionDescription(answer))
              await flushIceCandidates(fromId, pc)
            } catch (err) {
              console.error('Error handling answer:', err)
            }
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
    const videoTrack = localStreamRef.current.getVideoTracks()[0]

    if (videoEnabled) {
      // TURN OFF: Stop the track completely to turn off camera hardware light
      if (videoTrack) {
        videoTrack.stop() // This turns off the camera light
        localStreamRef.current.removeTrack(videoTrack)
      }

      // Send a null/black track to peers so connection stays alive
      Object.values(peerConnectionsRef.current).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track?.kind === 'video')
        if (sender) {
          // Replace with a silent black track to keep the connection
          sender.replaceTrack(null).catch(() => {})
        }
      })

      setVideoEnabled(false)
      sessionStorage.setItem('videoEnabled', 'false')
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
      socketRef.current?.emit('media-state-change', { roomId, audioEnabled, videoEnabled: false })
    } else {
      // TURN ON: Request camera access again
      try {
        const newStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        const newVideoTrack = newStream.getVideoTracks()[0]

        // Add new track to local stream
        localStreamRef.current.addTrack(newVideoTrack)
        // Update camera track reference
        cameraTrackRef.current = newVideoTrack

        // Replace null/old sender with new track in all peer connections
        const replacePromises = Object.values(peerConnectionsRef.current).map(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video' || s.track === null)
          if (sender) {
            return sender.replaceTrack(newVideoTrack)
          } else {
            pc.addTrack(newVideoTrack, localStreamRef.current)
            return Promise.resolve()
          }
        })
        await Promise.all(replacePromises)

        setVideoEnabled(true)
        sessionStorage.setItem('videoEnabled', 'true')
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()))
        socketRef.current?.emit('media-state-change', { roomId, audioEnabled, videoEnabled: true })
      } catch (err) {
        console.error('Error enabling video:', err)
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
        // Restore camera track in all peer connections
        const restorePromises = Object.values(peerConnectionsRef.current).map(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video' || s.track === null)
          if (sender) return sender.replaceTrack(cameraTrack)
          return Promise.resolve()
        })
        await Promise.all(restorePromises)
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

        // Replace video track in ALL existing peer connections
        const replacePromises = Object.values(peerConnectionsRef.current).map(pc => {
          const sender = pc.getSenders().find(s => s.track?.kind === 'video' || s.track === null)
          if (sender) {
            return sender.replaceTrack(screenTrack)
          } else {
            // No video sender yet - add the track
            pc.addTrack(screenTrack, localStreamRef.current)
            return Promise.resolve()
          }
        })
        await Promise.all(replacePromises)

        // Replace the video track in localStreamRef so new peer connections get the screen track
        const oldVideoTracks = localStreamRef.current.getVideoTracks()
        oldVideoTracks.forEach(t => localStreamRef.current.removeTrack(t))
        localStreamRef.current.addTrack(screenTrack)

        // Update local stream display to show screen share preview
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
