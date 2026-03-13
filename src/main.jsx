import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

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
          <p style={{ color: '#546E7A', textAlign: 'center', marginBottom: '1rem' }}>
            {this.state.error?.message || 'Please refresh the page'}
          </p>
          <button 
            onClick={() => window.location.reload()}
            style={{
              background: '#217346',
              color: 'white',
              border: 'none',
              padding: '0.75rem 1.5rem',
              borderRadius: '8px',
              fontSize: '1rem',
              cursor: 'pointer'
            }}
          >
            Refresh Page
          </button>
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
