import React, { useRef, useEffect, useState } from 'react'
import './VideoGrid.css'

const VideoTile = ({ stream, userName, isLocal, isScreenSharing, audioEnabled, videoEnabled, handRaised }) => {
  const videoRef = useRef(null)
  const [trackMuted, setTrackMuted] = useState(false)

  useEffect(() => {
    if (!videoRef.current) return

    if (stream) {
      videoRef.current.srcObject = stream
      videoRef.current.play().catch(() => {})

      const checkMuteState = () => {
        const vt = stream.getVideoTracks()
        setTrackMuted(vt.length === 0 || vt.every(t => t.muted))
      }

      // Initial mute state
      checkMuteState()

      // Listen for track-level mute/unmute events
      const attachTrackListeners = (track) => {
        track.addEventListener('mute', checkMuteState)
        track.addEventListener('unmute', checkMuteState)
        track.addEventListener('ended', checkMuteState)
      }
      const detachTrackListeners = (track) => {
        track.removeEventListener('mute', checkMuteState)
        track.removeEventListener('unmute', checkMuteState)
        track.removeEventListener('ended', checkMuteState)
      }

      // Attach to all current video tracks
      stream.getVideoTracks().forEach(attachTrackListeners)

      // When tracks are added/removed, re-check and re-attach listeners
      const onAddTrack = (e) => {
        if (e.track.kind === 'video') {
          attachTrackListeners(e.track)
        }
        checkMuteState()
      }
      const onRemoveTrack = (e) => {
        if (e.track.kind === 'video') {
          detachTrackListeners(e.track)
        }
        checkMuteState()
      }

      stream.addEventListener('addtrack', onAddTrack)
      stream.addEventListener('removetrack', onRemoveTrack)

      return () => {
        stream.removeEventListener('addtrack', onAddTrack)
        stream.removeEventListener('removetrack', onRemoveTrack)
        stream.getVideoTracks().forEach(detachTrackListeners)
      }
    } else {
      videoRef.current.srcObject = null
      setTrackMuted(true)
    }
  }, [stream])

  // Poll mute state every 500ms as a fallback for missed unmute events.
  // replaceTrack(null→track) should fire 'unmute' but some browsers are unreliable.
  useEffect(() => {
    if (!stream || isLocal) return
    const interval = setInterval(() => {
      const vt = stream.getVideoTracks()
      const muted = vt.length === 0 || vt.every(t => t.muted)
      setTrackMuted(prev => prev !== muted ? muted : prev)
    }, 500)
    return () => clearInterval(interval)
  }, [stream, isLocal])

  // When videoEnabled or isScreenSharing changes, trigger play
  useEffect(() => {
    if (!videoRef.current || !stream) return
    if ((videoEnabled !== false || isScreenSharing) && !trackMuted) {
      videoRef.current.play().catch(() => {})
    }
  }, [videoEnabled, isScreenSharing, trackMuted, stream])

  const initials = userName
    ? userName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)
    : '?'

  // showVideo logic:
  // - Local: controlled by videoEnabled prop (user's own toggle state)
  // - Remote: use videoEnabled prop (from server participant state via socket)
  //           AND track must not be muted (replaceTrack(null) mutes the receiver track)
  //   Screen sharing always shows video.
  const showVideo = isScreenSharing
    ? !!stream
    : isLocal
      ? !!(stream && videoEnabled !== false)
      : !!(stream && videoEnabled !== false && !trackMuted)

  return (
    <div className={`video-tile ${isLocal ? 'local' : 'remote'} ${isScreenSharing ? 'screen-sharing' : ''} ${handRaised ? 'hand-raised' : ''}`}>
      {handRaised && (
        <div className="hand-raised-badge">✋ Hand Raised</div>
      )}
      {/* Always keep video element mounted to avoid srcObject loss */}
      <video
        ref={videoRef}
        className="video-element"
        autoPlay
        playsInline
        muted={isLocal}
        style={{ display: showVideo ? 'block' : 'none' }}
      />

      {/* Show avatar when video is off */}
      {!showVideo && (
        <div className="video-avatar">
          <div className="avatar-circle">
            <span className="avatar-initials">{initials}</span>
          </div>
        </div>
      )}

      <div className="tile-overlay">
        <span className="tile-name">
          {userName}{isLocal ? ' (You)' : ''}
          {isScreenSharing && <span className="screen-badge">Screen</span>}
        </span>
        <div className="tile-indicators">
          {handRaised && <span className="indicator">✋</span>}
          {audioEnabled === false && <span className="indicator muted">🔇</span>}
          {!isScreenSharing && videoEnabled === false && <span className="indicator">📷</span>}
        </div>
      </div>
    </div>
  )
}

const VideoGrid = ({
  localStream,
  remoteStreams,
  participants,
  localUserName,
  audioEnabled,
  videoEnabled,
  isScreenSharing,
  handRaised,
}) => {
  // Show a tile for EVERY remote participant, even if they have no stream yet.
  // Server already excludes the local user from the participants list.
  // This fixes the bug where users with video/audio OFF don't appear in the grid.
  const remotePeers = participants   // all entries are remote peers
  const totalCount = 1 + remotePeers.length

  const getGridClass = () => {
    if (totalCount === 1) return 'grid-1'
    if (totalCount === 2) return 'grid-2'
    if (totalCount <= 4) return 'grid-4'
    if (totalCount <= 6) return 'grid-6'
    return 'grid-many'
  }

  return (
    <div className={`video-grid ${getGridClass()}`}>
      {/* Local video */}
      <VideoTile
        stream={localStream}
        userName={localUserName}
        isLocal={true}
        isScreenSharing={isScreenSharing}
        audioEnabled={audioEnabled}
        videoEnabled={videoEnabled}
        handRaised={handRaised}
      />

      {/* Remote videos — one tile per participant, stream may be null if they have no producers */}
      {remotePeers.map((participant) => {
        const stream = remoteStreams[participant.id] || null
        const pVideoEnabled = participant.videoEnabled !== undefined ? participant.videoEnabled : true
        const pAudioEnabled = participant.audioEnabled !== undefined ? participant.audioEnabled : true
        return (
          <VideoTile
            key={participant.id}
            stream={stream}
            userName={participant.name || 'Participant'}
            isLocal={false}
            isScreenSharing={participant.isScreenSharing || false}
            audioEnabled={pAudioEnabled}
            videoEnabled={pVideoEnabled}
            handRaised={participant.handRaised || false}
          />
        )
      })}
    </div>
  )
}

export default VideoGrid
