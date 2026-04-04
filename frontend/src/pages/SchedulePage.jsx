import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import './SchedulePage.css'

// Allow body/root to scroll when this page is mounted
function useBodyScroll() {
  useEffect(() => {
    const root = document.getElementById('root')
    const prev = { body: document.body.style.overflow, root: root?.style.overflow || '' }
    document.body.style.overflow = 'auto'
    document.documentElement.style.overflow = 'auto'
    if (root) root.style.overflow = 'auto'
    return () => {
      document.body.style.overflow = prev.body
      document.documentElement.style.overflow = ''
      if (root) root.style.overflow = prev.root
    }
  }, [])
}

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DURATIONS = ['15 min','30 min','45 min','1 hour','1.5 hours','2 hours']
const STORAGE_KEY = 'webrtc_scheduled_meetings'

function genRoomId() {
  return Math.random().toString(36).substring(2,6).toUpperCase() +
         Math.random().toString(36).substring(2,6).toUpperCase()
}

function loadMeetings() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}
function saveMeetings(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
}

function getMeetingStatus(meeting) {
  const now = new Date()
  const meetDate = new Date(`${meeting.date}T${meeting.time}`)
  const diffMin = (meetDate - now) / 60000
  if (diffMin < -60) return 'past'
  if (diffMin <= 60 && diffMin >= -60) return 'today'
  return 'upcoming'
}

export default function SchedulePage() {
  useBodyScroll()   // ← unlock scroll for this page
  const navigate = useNavigate()
  const today = new Date()

  const [currentYear, setCurrentYear] = useState(today.getFullYear())
  const [currentMonth, setCurrentMonth] = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState(null)
  const [meetings, setMeetings] = useState(loadMeetings)
  const [toast, setToast] = useState(null)
  // Join modal state
  const [joinModal, setJoinModal] = useState(null) // { meeting }
  const [joinName, setJoinName] = useState('')

  const [form, setForm] = useState({
    title: '', time: '10:00', duration: '1 hour',
    description: '', hostName: '', roomId: genRoomId()
  })

  const showToast = useCallback((msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  // Days in month grid
  const firstDay = new Date(currentYear, currentMonth, 1).getDay()
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate()

  const prevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1) }
    else setCurrentMonth(m => m - 1)
  }
  const nextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1) }
    else setCurrentMonth(m => m + 1)
  }

  const toDateStr = (y, m, d) =>
    `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`

  const meetingDates = new Set(meetings.map(m => m.date))

  const handleDayClick = (day) => {
    const dateStr = toDateStr(currentYear, currentMonth, day)
    const clickedDate = new Date(currentYear, currentMonth, day)
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    if (clickedDate < todayMidnight) return
    setSelectedDate(dateStr)
  }

  const handleFormChange = (e) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSchedule = (e) => {
    e.preventDefault()
    if (!selectedDate) { showToast('Please select a date on the calendar', 'error'); return }
    if (!form.title.trim()) { showToast('Please enter a meeting title', 'error'); return }
    if (!form.hostName.trim()) { showToast('Please enter your name', 'error'); return }

    const newMeeting = {
      id: Date.now().toString(),
      ...form,
      title: form.title.trim(),
      hostName: form.hostName.trim(),
      date: selectedDate,
      createdAt: new Date().toISOString(),
    }
    const updated = [...meetings, newMeeting].sort((a,b) =>
      new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`)
    )
    setMeetings(updated)
    saveMeetings(updated)
    showToast('Meeting scheduled successfully! 🎉')
    setForm({ title:'', time:'10:00', duration:'1 hour', description:'', hostName: form.hostName, roomId: genRoomId() })
  }

  const handleDelete = (id) => {
    const updated = meetings.filter(m => m.id !== id)
    setMeetings(updated)
    saveMeetings(updated)
    showToast('Meeting removed', 'success')
  }

  // Open join modal instead of directly joining
  const handleJoinClick = (meeting) => {
    setJoinName('')
    setJoinModal(meeting)
  }

  // Confirm join from modal
  const handleJoinConfirm = () => {
    if (!joinName.trim()) return
    const meeting = joinModal
    sessionStorage.setItem('userName', joinName.trim())
    navigate(`/room/${meeting.roomId}`)
    setJoinModal(null)
  }

  // Copy meeting link to clipboard
  const handleCopyLink = (meeting) => {
    const link = `${window.location.origin}/room/${meeting.roomId}`
    navigator.clipboard.writeText(link).then(() => {
      showToast('Meeting link copied! 📋', 'success')
    }).catch(() => {
      // Fallback for older browsers
      const el = document.createElement('textarea')
      el.value = link
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      showToast('Meeting link copied! 📋', 'success')
    })
  }

  const filteredMeetings = selectedDate
    ? meetings.filter(m => m.date === selectedDate)
    : meetings

  const formatDate = (dateStr) => {
    const [y,m,d] = dateStr.split('-')
    return `${MONTHS[parseInt(m)-1]} ${parseInt(d)}, ${y}`
  }

  return (
    <div className="schedule-page">
      {/* Header */}
      <header className="schedule-header">
        <a href="/" className="logo">📹 <span>WebRTC</span> Meet</a>
        <button className="btn-back" onClick={() => navigate('/')}>← Back to Home</button>
      </header>

      <div className="schedule-body">
        {/* Calendar */}
        <div className="calendar-panel">
          <div className="calendar-nav">
            <button className="cal-nav-btn" onClick={prevMonth}>‹</button>
            <h2>{MONTHS[currentMonth]} {currentYear}</h2>
            <button className="cal-nav-btn" onClick={nextMonth}>›</button>
          </div>
          <div className="calendar-grid">
            {DAYS.map(d => <div key={d} className="cal-day-header">{d}</div>)}
            {Array.from({ length: firstDay }, (_, i) => (
              <div key={`e${i}`} className="cal-day empty" />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1
              const dateStr = toDateStr(currentYear, currentMonth, day)
              const isToday = dateStr === toDateStr(today.getFullYear(), today.getMonth(), today.getDate())
              const isPast = new Date(currentYear, currentMonth, day) < new Date(today.getFullYear(), today.getMonth(), today.getDate())
              const isSelected = dateStr === selectedDate
              const hasMeeting = meetingDates.has(dateStr)
              let cls = 'cal-day'
              if (isPast) cls += ' past'
              else if (isSelected) cls += ' selected'
              else if (isToday) cls += ' today'
              if (hasMeeting) cls += ' has-meeting'
              return (
                <div key={day} className={cls} onClick={() => !isPast && handleDayClick(day)}>
                  {day}
                </div>
              )
            })}
          </div>
          {selectedDate && (
            <div style={{marginTop:16,textAlign:'center',color:'rgba(255,255,255,0.5)',fontSize:'0.85rem'}}>
              Showing meetings for <strong style={{color:'#a89cf7'}}>{formatDate(selectedDate)}</strong>
              <button onClick={() => setSelectedDate(null)}
                style={{marginLeft:8,background:'none',border:'none',color:'#7c6af7',cursor:'pointer',fontSize:'0.85rem'}}>
                (show all)
              </button>
            </div>
          )}
        </div>

        {/* Right Panel */}
        <div className="right-panel">
          {/* Schedule Form */}
          <div className="schedule-form-card">
            <h3>📅 Schedule a Meeting</h3>
            <form onSubmit={handleSchedule}>
              <div className="form-group">
                <label>Selected Date</label>
                <div className="selected-date-display">
                  {selectedDate ? formatDate(selectedDate) : 'Click a date on the calendar →'}
                </div>
              </div>
              <div className="form-group">
                <label>Meeting Title *</label>
                <input name="title" value={form.title} onChange={handleFormChange}
                  placeholder="e.g. Team Standup" required />
              </div>
              <div className="form-group">
                <label>Your Name *</label>
                <input name="hostName" value={form.hostName} onChange={handleFormChange}
                  placeholder="e.g. John Doe" required />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Time</label>
                  <input type="time" name="time" value={form.time} onChange={handleFormChange} />
                </div>
                <div className="form-group">
                  <label>Duration</label>
                  <select name="duration" value={form.duration} onChange={handleFormChange}>
                    {DURATIONS.map(d => <option key={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Description (optional)</label>
                <textarea name="description" value={form.description} onChange={handleFormChange}
                  placeholder="Meeting agenda or notes..." />
              </div>
              <div className="form-group">
                <label>Room ID (auto-generated)</label>
                <input name="roomId" value={form.roomId} onChange={handleFormChange}
                  placeholder="Room ID" />
              </div>
              <button type="submit" className="btn-schedule">📅 Schedule Meeting</button>
            </form>
          </div>

          {/* Meetings List */}
          <div className="meetings-list-card">
            <h3>🗓️ {selectedDate ? `Meetings on ${formatDate(selectedDate)}` : 'All Meetings'}
              <span style={{marginLeft:'auto',fontSize:'0.8rem',color:'rgba(255,255,255,0.4)',fontWeight:400}}>
                {filteredMeetings.length} meeting{filteredMeetings.length !== 1 ? 's' : ''}
              </span>
            </h3>
            {filteredMeetings.length === 0 ? (
              <div className="meetings-empty">
                <div className="empty-icon">📭</div>
                <div>{selectedDate ? 'No meetings on this day' : 'No meetings scheduled yet'}</div>
                <div style={{fontSize:'0.8rem',marginTop:4}}>Select a date and schedule one!</div>
              </div>
            ) : (
              filteredMeetings.map(meeting => {
                const status = getMeetingStatus(meeting)
                return (
                  <div key={meeting.id} className={`meeting-item ${status === 'today' ? 'today-meeting' : status === 'past' ? 'past-meeting' : 'upcoming'}`}>
                    <div className="meeting-title">
                      {meeting.title}
                      <span className={`meeting-badge badge-${status === 'today' ? 'today' : status === 'past' ? 'past' : 'upcoming'}`}>
                        {status === 'today' ? 'Today' : status === 'past' ? 'Past' : 'Upcoming'}
                      </span>
                    </div>
                    <div className="meeting-meta">
                      <span>📅 {formatDate(meeting.date)}</span>
                      <span>🕐 {meeting.time}</span>
                      <span>⏱ {meeting.duration}</span>
                      <span>👤 {meeting.hostName}</span>
                      <span>🔑 {meeting.roomId}</span>
                    </div>
                    {meeting.description && (
                      <div style={{marginTop:6,fontSize:'0.8rem',color:'rgba(255,255,255,0.5)'}}>
                        {meeting.description}
                      </div>
                    )}
                    <div className="meeting-actions">
                      <button className="btn-copy-link" onClick={() => handleCopyLink(meeting)} title="Copy meeting link">📋</button>
                      {status !== 'past' && (
                        <button className="btn-join-meeting" onClick={() => handleJoinClick(meeting)}>Join</button>
                      )}
                      <button className="btn-delete-meeting" onClick={() => handleDelete(meeting.id)}>✕</button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>

      {/* Join Name Modal */}
      {joinModal && (
        <div className="join-modal-overlay" onClick={() => setJoinModal(null)}>
          <div className="join-modal" onClick={e => e.stopPropagation()}>
            <h3>Join Meeting</h3>
            <p className="join-modal-title">"{joinModal.title}"</p>
            <p className="join-modal-meta">📅 {formatDate(joinModal.date)} &nbsp;🕐 {joinModal.time}</p>
            <div className="join-modal-field">
              <label>Your Name</label>
              <input
                autoFocus
                type="text"
                placeholder="Enter your display name"
                value={joinName}
                onChange={e => setJoinName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleJoinConfirm()}
                maxLength={30}
              />
            </div>
            <div className="join-modal-actions">
              <button className="btn-modal-cancel" onClick={() => setJoinModal(null)}>Cancel</button>
              <button className="btn-modal-join" onClick={handleJoinConfirm} disabled={!joinName.trim()}>
                🚀 Join Now
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`schedule-toast ${toast.type}`}>{toast.msg}</div>}
    </div>
  )
}
