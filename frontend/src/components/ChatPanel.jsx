import React, { useState, useRef, useEffect } from 'react'
import './ChatPanel.css'

const ChatPanel = ({ messages, onSendMessage, userName, onClose }) => {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = (e) => {
    e.preventDefault()
    if (!input.trim()) return
    onSendMessage(input.trim())
    setInput('')
  }

  const formatTime = (ts) => {
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="chat-panel">
      <div className="panel-header">
        <span className="panel-title">💬 Chat</span>
        <button className="panel-close" onClick={onClose}>✕</button>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <span>💬</span>
            <p>No messages yet. Say hello!</p>
          </div>
        )}
        {messages.map((msg, i) => {
          const isOwn = msg.userName === userName
          return (
            <div key={i} className={`chat-msg ${isOwn ? 'own' : 'other'}`}>
              {!isOwn && <div className="msg-sender">{msg.userName}</div>}
              <div className="msg-bubble">{msg.message}</div>
              <div className="msg-time">{formatTime(msg.timestamp)}</div>
            </div>
          )
        })}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-row" onSubmit={handleSend}>
        <input
          className="chat-input"
          type="text"
          placeholder="Type a message..."
          value={input}
          onChange={e => setInput(e.target.value)}
          maxLength={500}
        />
        <button type="submit" className="chat-send" disabled={!input.trim()}>
          ➤
        </button>
      </form>
    </div>
  )
}

export default ChatPanel
