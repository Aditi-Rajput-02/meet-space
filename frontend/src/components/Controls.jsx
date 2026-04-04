import React from 'react'
import './Controls.css'

// ── SVG Icons ────────────────────────────────────────────────────────────────

const MicIcon = ({ muted }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {muted ? (
      <>
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </>
    ) : (
      <>
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
        <line x1="12" y1="19" x2="12" y2="23" />
        <line x1="8" y1="23" x2="16" y2="23" />
      </>
    )}
  </svg>
)

const VideoIcon = ({ off }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {off ? (
      <>
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M15 10l4.553-2.069A1 1 0 0 1 21 8.845v6.31a1 1 0 0 1-1.447.894L15 14" />
        <rect x="1" y="6" width="14" height="12" rx="2" ry="2" />
      </>
    ) : (
      <>
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
      </>
    )}
  </svg>
)

const ShareIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
    <polyline points="8 10 12 6 16 10" />
    <line x1="12" y1="6" x2="12" y2="14" />
  </svg>
)

const HandIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
    <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
    <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
    <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
  </svg>
)

const ChatIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

const PeopleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)

const MoreIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.5" />
    <circle cx="12" cy="12" r="1.5" />
    <circle cx="12" cy="19" r="1.5" />
  </svg>
)

const LeaveIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.42 19.42 0 0 1 4.43 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.34 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.32 9.9" />
    <line x1="23" y1="1" x2="1" y2="23" />
  </svg>
)

const HostControlIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
)

const InfoIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="8" x2="12" y2="8.01" />
    <line x1="12" y1="12" x2="12" y2="16" />
  </svg>
)

const ChevronUp = () => (
  <svg className="chevron-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15" />
  </svg>
)

// ── Button component ─────────────────────────────────────────────────────────

const CtrlBtn = ({ onClick, active, danger, label, children, badge, hasChevron }) => (
  <div className="ctrl-wrap">
    <button
      className={`ctrl-btn${active ? ' active' : ''}${danger ? ' danger' : ''}`}
      onClick={onClick}
      title={label}
    >
      <span className="ctrl-icon">{children}</span>
      {badge > 0 && <span className="ctrl-badge">{badge}</span>}
    </button>
    {hasChevron && (
      <button className="ctrl-chevron" title="More options">
        <ChevronUp />
      </button>
    )}
    <span className="ctrl-label">{label}</span>
  </div>
)

// ── Controls Bar ─────────────────────────────────────────────────────────────

const Controls = ({
  audioEnabled, videoEnabled, isScreenSharing, handRaised,
  showChat, showParticipants, unreadMessages, participantCount,
  onToggleAudio, onToggleVideo, onToggleScreenShare, onToggleRaiseHand,
  onToggleChat, onToggleParticipants, onLeave,
  roomId, hostName,
}) => {
  const [showInfo, setShowInfo] = React.useState(false)
  const [currentTime, setCurrentTime] = React.useState(() => {
    const now = new Date()
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  })

  React.useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date()
      setCurrentTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const meetingLink = typeof window !== 'undefined'
    ? `${window.location.origin}/room/${roomId}`
    : ''

  return (
    <div className="controls-bar">

      {/* Left: Time + Room Code */}
      <div className="ctrl-left-info">
        <span className="ctrl-time">{currentTime}</span>
        {roomId && <span className="ctrl-room-code">{roomId}</span>}
      </div>

      {/* Mute / Unmute */}
      <CtrlBtn
        onClick={onToggleAudio}
        active={!audioEnabled}
        label={audioEnabled ? 'Mute' : 'Unmute'}
        hasChevron
      >
        <MicIcon muted={!audioEnabled} />
      </CtrlBtn>

      {/* Stop / Start Video */}
      <CtrlBtn
        onClick={onToggleVideo}
        active={!videoEnabled && !isScreenSharing}
        label={videoEnabled || isScreenSharing ? 'Stop Video' : 'Start Video'}
        hasChevron
      >
        <VideoIcon off={!videoEnabled && !isScreenSharing} />
      </CtrlBtn>

      {/* Share Screen */}
      <CtrlBtn
        onClick={onToggleScreenShare}
        active={isScreenSharing}
        label={isScreenSharing ? 'Stop Share' : 'Share'}
      >
        <ShareIcon />
      </CtrlBtn>

      {/* Raise Hand */}
      <div className="ctrl-wrap">
        <button
          className={`ctrl-btn${handRaised ? ' hand-active' : ''}`}
          onClick={onToggleRaiseHand}
          title={handRaised ? 'Lower Hand' : 'Raise Hand'}
        >
          <span className="ctrl-icon"><HandIcon /></span>
        </button>
        <span className="ctrl-label">{handRaised ? 'Lower Hand' : 'Raise Hand'}</span>
      </div>

      {/* Chat */}
      <CtrlBtn
        onClick={onToggleChat}
        active={showChat}
        label="Chat"
        badge={!showChat ? unreadMessages : 0}
      >
        <ChatIcon />
      </CtrlBtn>

      {/* Participants */}
      <CtrlBtn
        onClick={onToggleParticipants}
        active={showParticipants}
        label={`People (${participantCount})`}
      >
        <PeopleIcon />
      </CtrlBtn>

      {/* More */}
      <CtrlBtn label="More">
        <MoreIcon />
      </CtrlBtn>

      {/* Small gap before Leave */}
      <div className="ctrl-spacer" />

      {/* Leave */}
      <CtrlBtn onClick={onLeave} danger label="Leave">
        <LeaveIcon />
      </CtrlBtn>

      {/* Right-side group */}
      <div className="ctrl-right-group">
        {/* Host Controls */}
        <CtrlBtn label="Host Controls">
          <HostControlIcon />
        </CtrlBtn>

        {/* Info */}
        <CtrlBtn onClick={() => setShowInfo(v => !v)} active={showInfo} label="Info">
          <InfoIcon />
        </CtrlBtn>
      </div>

      {/* Info Panel */}
      {showInfo && (
        <div className="info-panel">
          <button className="info-panel-close" onClick={() => setShowInfo(false)}>✕</button>
          <h3 className="info-panel-title">📹 Meeting Info</h3>
          <div className="info-row">
            <span className="info-key">Room ID</span>
            <span className="info-val">{roomId}</span>
          </div>
          {hostName && (
            <div className="info-row">
              <span className="info-key">Host</span>
              <span className="info-val">{hostName}</span>
            </div>
          )}
          <div className="info-row">
            <span className="info-key">Link</span>
            <span className="info-val info-link">{meetingLink}</span>
          </div>
          <button
            className="info-copy-btn"
            onClick={() => navigator.clipboard.writeText(meetingLink)}
          >
            📋 Copy Link
          </button>
        </div>
      )}

    </div>
  )
}

export default Controls
