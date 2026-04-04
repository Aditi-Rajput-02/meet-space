import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import HomePage from './pages/HomePage.jsx'
import RoomPage from './pages/RoomPage.jsx'
import SchedulePage from './pages/SchedulePage.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/room/:roomId" element={
            <ErrorBoundary>
              <RoomPage />
            </ErrorBoundary>
          } />
          <Route path="/schedule" element={<SchedulePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
