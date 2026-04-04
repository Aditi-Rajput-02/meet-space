import React from 'react'
import './ParticipantsList.css'

const ParticipantItem = ({ name, isLocal, audioEnabled, videoEnabled, handRaised, isScreenSharing }) => {
  const initials = name
    ? name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2)
    : '?'

  return (
    <div className="participant-item">
      <div className="participant-avatar">
        <span>{initials}</span>
      </div>
      <div className="participant-info">
        <span className="participant-name">
          {name}
          {isLocal && <span className="you-badge">You</span>}
        </span>
        <div className="participant-status">
          {isScreenSharing && <span className="status-chip screen">🖥️ Sharing</span>}
          {handRaised && <span className="status-chip hand">✋ Hand raised</span>}
        </div>
      </div>
      <div className="participant-indicators">
        {audioEnabled === false && <span className="p-indicator muted" title="Muted">🔇</span>}
        {videoEnabled === false && <span className="p-indicator" title="Camera off">📷</span>}
      </div>
    </div>
  )
}

const ParticipantsList = ({ participants, localUserName, onClose }) => {
  return (
    <div className="participants-panel">
      <div className="panel-header">
        <span className="panel-title">👥 People ({participants.length + 1})</span>
        <button className="panel-close" onClick={onClose}>✕</button>
      </div>

      <div className="participants-list">
        {/* Local user */}
        <ParticipantItem
          name={localUserName}
          isLocal={true}
        />

        {/* Remote participants */}
        {participants.map(p => (
          <ParticipantItem
            key={p.id}
            name={p.name}
            isLocal={false}
            audioEnabled={p.audioEnabled}
            videoEnabled={p.videoEnabled}
            handRaised={p.handRaised}
            isScreenSharing={p.isScreenSharing}
          />
        ))}

        {participants.length === 0 && (
          <div className="participants-empty">
            <p>You're the only one here.</p>
            <p>Share the room ID to invite others!</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default ParticipantsList
