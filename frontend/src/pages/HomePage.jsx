import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './HomePage.css'

const generateRoomId = () => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const segments = [4, 4, 4].map(len =>
    Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
  )
  return segments.join('-')
}

const HomePage = () => {
  const navigate = useNavigate()
  const [userName, setUserName] = useState('')
  const [roomId, setRoomId] = useState('')
  const [activeTab, setActiveTab] = useState('create')
  const [error, setError] = useState('')

  const handleCreateRoom = (e) => {
    e.preventDefault()
    if (!userName.trim()) {
      setError('Please enter your name')
      return
    }
    const newRoomId = generateRoomId()
    sessionStorage.setItem('userName', userName.trim())
    navigate(`/room/${newRoomId}`)
  }

  const handleJoinRoom = (e) => {
    e.preventDefault()
    if (!userName.trim()) {
      setError('Please enter your name')
      return
    }
    if (!roomId.trim()) {
      setError('Please enter a room ID')
      return
    }
    sessionStorage.setItem('userName', userName.trim())
    navigate(`/room/${roomId.trim()}`)
  }

  const handleInputChange = (setter) => (e) => {
    setter(e.target.value)
    setError('')
  }

  return (
    <div className="home-page">
      {/* Background */}
      <div className="home-bg">
        <div className="bg-orb orb-1" />
        <div className="bg-orb orb-2" />
        <div className="bg-orb orb-3" />
      </div>

      <div className="home-content">
        {/* Logo */}
        <div className="home-logo">
          <div className="logo-icon">📹</div>
          <h1 className="logo-text">MeetNow</h1>
          <p className="logo-tagline">Free, secure video conferencing for everyone</p>
        </div>

        {/* Card */}
        <div className="home-card">
          {/* Tabs */}
          <div className="tab-bar">
            <button
              className={`tab-btn ${activeTab === 'create' ? 'active' : ''}`}
              onClick={() => { setActiveTab('create'); setError('') }}
            >
              ✨ New Meeting
            </button>
            <button
              className={`tab-btn ${activeTab === 'join' ? 'active' : ''}`}
              onClick={() => { setActiveTab('join'); setError('') }}
            >
              🔗 Join Meeting
            </button>
          </div>

          {/* Name Input (shared) */}
          <div className="form-group">
            <label className="form-label">Your Name</label>
            <input
              type="text"
              className="form-input"
              placeholder="Enter your display name"
              value={userName}
              onChange={handleInputChange(setUserName)}
              maxLength={30}
              autoFocus
            />
          </div>

          {/* Create Room */}
          {activeTab === 'create' && (
            <form onSubmit={handleCreateRoom}>
              <p className="form-hint">
                A unique room ID will be generated automatically. Share it with others to invite them.
              </p>
              {error && <div className="form-error">{error}</div>}
              <button type="submit" className="btn-primary">
                <span>🚀</span> Start Meeting
              </button>
            </form>
          )}

          {/* Join Room */}
          {activeTab === 'join' && (
            <form onSubmit={handleJoinRoom}>
              <div className="form-group">
                <label className="form-label">Room ID</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="e.g. abcd-efgh-ijkl"
                  value={roomId}
                  onChange={handleInputChange(setRoomId)}
                />
              </div>
              {error && <div className="form-error">{error}</div>}
              <button type="submit" className="btn-primary">
                <span>🔗</span> Join Meeting
              </button>
            </form>
          )}
        </div>

        {/* Features */}
        <div className="features-row">
          <div className="feature-item">
            <span>🔒</span>
            <span>End-to-end encrypted</span>
          </div>
          <div className="feature-item">
            <span>🌐</span>
            <span>No downloads needed</span>
          </div>
          <div className="feature-item">
            <span>⚡</span>
            <span>Ultra-low latency</span>
          </div>
        </div>

        {/* Schedule Meeting */}
        <button
          className="btn-schedule-home"
          onClick={() => navigate('/schedule')}
        >
          📅 Schedule a Meeting
        </button>
      </div>
    </div>
  )
}

export default HomePage
