import React from 'react'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught error:', error, info)
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null })
    window.location.href = '/'
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', background: '#0a0a14',
          color: '#fff', fontFamily: 'sans-serif', gap: '16px', padding: '24px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '3rem' }}>⚠️</div>
          <h2 style={{ margin: 0, fontSize: '1.4rem' }}>Something went wrong</h2>
          <p style={{ color: 'rgba(255,255,255,0.5)', maxWidth: '400px', margin: 0 }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={this.handleReload}
            style={{
              marginTop: '8px', padding: '10px 28px', background: '#6c63ff',
              border: 'none', borderRadius: '10px', color: '#fff',
              fontSize: '0.95rem', cursor: 'pointer', fontWeight: 600,
            }}
          >
            Return to Home
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default ErrorBoundary
