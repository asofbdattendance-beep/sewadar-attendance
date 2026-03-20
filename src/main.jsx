import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// ── PWA update notification — production only ──
let swRegistration = null
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      swRegistration = reg
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            window.__pwaUpdateAvailable = true
            window.dispatchEvent(new Event('pwa-update-available'))
          }
        })
      })
    }).catch(() => { /* SW registration failed — ignore */ })
  })
}

// Error boundary to prevent white screen
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '2rem',
          background: '#F0F4F8',
          fontFamily: 'Inter, sans-serif'
        }}>
          <h2 style={{ color: '#C62828', marginBottom: '1rem' }}>Something went wrong</h2>
          <p style={{ color: '#546E7A', textAlign: 'center', marginBottom: '1.5rem', maxWidth: 400 }}>
            {this.state.error?.message || 'An unexpected error occurred. Your data is safe.'}
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: '#217346',
                color: 'white',
                border: 'none',
                padding: '0.75rem 1.5rem',
                borderRadius: '8px',
                fontSize: '1rem',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              Refresh Page
            </button>
            <button
              onClick={() => {
                localStorage.clear()
                window.location.href = '/'
              }}
              style={{
                background: '#E65100',
                color: 'white',
                border: 'none',
                padding: '0.75rem 1.5rem',
                borderRadius: '8px',
                fontSize: '1rem',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              Clear Local Data &amp; Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)