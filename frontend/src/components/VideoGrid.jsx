import React, { useRef, useEffect } from 'react'
import './VideoGrid.css'

const VideoTile = ({ stream, userName, isLocal, isScreenSharing, audioEnabled, videoEnabled, handRaised }) => {
  const videoRef = useRef(null)

  useEffect(() => {
    if (!videoRef.current) return

    if (stream) {
      // Always reassign srcObject to pick up track replacements (screen share)
      videoRef.current.srcObject = stream
      videoRef.current.play().catch(() => {})
    } else {
      videoRef.current.srcObject = null
    }
  }, [stream])

  // When videoEnabled or isScreenSharing changes, ensure play is triggered
  useEffect(() => {
    if (!videoRef.current || !stream) return
    const videoTracks = stream.getVideoTracks()
    if (videoTracks.length > 0 && (videoEnabled || isScreenSharing)) {
      videoRef.current.play().catch(() => {})
    }
  }, [videoEnabled, isScreenSharing, stream])

  const initials = userName
    ? userName.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)
    : '?'

  // Show video if: stream exists AND (video is enabled OR currently screen sharing)
  // This ensures screen share is visible even if the participant had video off before sharing
  const showVideo = stream && (videoEnabled !== false || isScreenSharing)

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
  const remoteEntries = Object.entries(remoteStreams)
  const totalCount = 1 + remoteEntries.length

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

      {/* Remote videos */}
      {remoteEntries.map(([peerId, stream]) => {
        const participant = participants.find(p => p.id === peerId) || {}
        return (
          <VideoTile
            key={peerId}
            stream={stream}
            userName={participant.name || 'Participant'}
            isLocal={false}
            isScreenSharing={participant.isScreenSharing}
            audioEnabled={participant.audioEnabled}
            videoEnabled={participant.videoEnabled}
            handRaised={participant.handRaised}
          />
        )
      })}
    </div>
  )
}

export default VideoGrid
