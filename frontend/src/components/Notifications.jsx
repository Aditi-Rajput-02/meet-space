import React from 'react'
import './Notifications.css'

const Notifications = ({ notifications }) => {
  if (!notifications || notifications.length === 0) return null

  return (
    <div className="notifications-container">
      {notifications.map(notif => (
        <div key={notif.id} className={`notification ${notif.type}`}>
          <span className="notif-icon">
            {notif.type === 'success' ? '✅' :
             notif.type === 'error' ? '❌' :
             notif.type === 'warning' ? '⚠️' : 'ℹ️'}
          </span>
          <span className="notif-message">{notif.message}</span>
        </div>
      ))}
    </div>
  )
}

export default Notifications
