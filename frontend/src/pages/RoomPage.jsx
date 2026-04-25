import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import useWebRTC from '../hooks/useWebRTC.js'
import VideoGrid from '../components/VideoGrid.jsx'
import Controls from '../components/Controls.jsx'
import ChatPanel from '../components/ChatPanel.jsx'
import ParticipantsList from '../components/ParticipantsList.jsx'
import Notifications from '../components/Notifications.jsx'
import './RoomPage.css'

const RoomPage = () => {
  const { roomId } = useParams()
  const navigate = useNavigate()

  // If no name in sessionStorage, show name prompt before joining
  const storedName = sessionStorage.getItem('userName')
  const [userName, setUserName] = useState(storedName || '')
  const [nameInput, setNameInput] = useState('')
  const [nameConfirmed, setNameConfirmed] = useState(!!storedName)

  const [showChat, setShowChat] = useState(false)
  const [showParticipants, setShowParticipants] = useState(false)
  const [unreadMessages, setUnreadMessages] = useState(0)

  const handleNameConfirm = () => {
    const trimmed = nameInput.trim()
    if (!trimmed) return
    sessionStorage.setItem('userName', trimmed)
    setUserName(trimmed)
    setNameConfirmed(true)
  }

  // Only connect to WebRTC after name is confirmed
  const {
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
    toggleAudio,
    toggleVideo,
    toggleScreenShare,
    toggleRaiseHand,
    sendMessage,
    leaveRoom,
  } = useWebRTC(nameConfirmed ? roomId : null, userName)

  // Track unread messages
  useEffect(() => {
    if (!showChat && messages.length > 0) {
      const lastMsg = messages[messages.length - 1]
      if (lastMsg.userName !== userName) {
        setUnreadMessages(prev => prev + 1)
      }
    }
  }, [messages, showChat, userName])

  useEffect(() => {
    if (showChat) setUnreadMessages(0)
  }, [showChat])

  const handleLeave = () => {
    leaveRoom()
    navigate('/')
  }

  const handleToggleChat = () => {
    setShowChat(prev => !prev)
    if (showParticipants) setShowParticipants(false)
  }

  const handleToggleParticipants = () => {
    setShowParticipants(prev => !prev)
    if (showChat) setShowChat(false)
  }

  // Show name prompt modal if name not yet confirmed
  if (!nameConfirmed) {
    return (
      <div className="room-name-prompt-overlay">
        <div className="room-name-prompt-modal">
          <div className="room-name-prompt-logo">📹</div>
          <h2>Join Meeting</h2>
          <p className="room-name-prompt-room">Room: <strong>{roomId}</strong></p>
          <p className="room-name-prompt-sub">Enter your name to join this meeting</p>
          <div className="room-name-prompt-field">
            <label>Your Display Name</label>
            <input
              autoFocus
              type="text"
              placeholder="e.g. John Doe"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleNameConfirm()}
              maxLength={30}
            />
          </div>
          <div className="room-name-prompt-actions">
            <button className="btn-prompt-back" onClick={() => navigate('/')}>← Back</button>
            <button
              className="btn-prompt-join"
              onClick={handleNameConfirm}
              disabled={!nameInput.trim()}
            >
              🚀 Join Meeting
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="room-page">
      {/* Header */}
      <div className="room-header">
        <div className="room-info">
          <span className="room-logo">📹</span>
          <span className="room-name">MeetNow</span>
        </div>
        <div className="room-status">
          <div className={`status-dot ${connectionStatus}`} />
          <span className="status-text">
            {connectionStatus === 'connected' ? 'Connected' :
             connectionStatus === 'connecting' ? 'Connecting...' : 'Error'}
          </span>
          <span className="participant-count">
            👥 {participants.length + 1}
          </span>
        </div>
      </div>

      {/* Main Area */}
      <div className="room-main">
        {/* Video Area */}
        <div className="video-area">
          <VideoGrid
            localStream={localStream}
            remoteStreams={remoteStreams}
            participants={participants}
            localUserName={userName}
            audioEnabled={audioEnabled}
            videoEnabled={videoEnabled}
            isScreenSharing={isScreenSharing}
            handRaised={handRaised}
          />
        </div>

        {/* Side Panel */}
        {(showChat || showParticipants) && (
          <div className="side-panel">
            {showChat && (
              <ChatPanel
                messages={messages}
                onSendMessage={sendMessage}
                userName={userName}
                onClose={() => setShowChat(false)}
              />
            )}
            {showParticipants && (
              <ParticipantsList
                participants={participants}
                localUserName={userName}
                onClose={() => setShowParticipants(false)}
              />
            )}
          </div>
        )}
      </div>

      {/* Controls */}
      <Controls
        audioEnabled={audioEnabled}
        videoEnabled={videoEnabled}
        isScreenSharing={isScreenSharing}
        handRaised={handRaised}
        showChat={showChat}
        showParticipants={showParticipants}
        unreadMessages={unreadMessages}
        participantCount={participants.length + 1}
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onToggleScreenShare={toggleScreenShare}
        onToggleRaiseHand={toggleRaiseHand}
        onToggleChat={handleToggleChat}
        onToggleParticipants={handleToggleParticipants}
        onLeave={handleLeave}
        roomId={roomId}
        hostName={userName}
      />

      {/* Notifications */}
      <Notifications notifications={notifications} />
    </div>
  )
}

export default RoomPage
