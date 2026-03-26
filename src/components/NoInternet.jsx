import { WifiOff, RefreshCw } from 'lucide-react'

export default function NoInternet({ onRetry }) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'var(--bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 9999,
      padding: '2rem',
    }}>
      <div style={{ textAlign: 'center', maxWidth: 340 }}>
        <div style={{
          width: 72,
          height: 72,
          background: 'var(--red-bg)',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 1.5rem',
        }}>
          <WifiOff size={36} color="var(--red)" />
        </div>
        <h2 style={{ color: 'var(--red)', marginBottom: '0.5rem', fontSize: '1.4rem' }}>
          No Internet Connection
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.5, marginBottom: '1.5rem' }}>
          This app requires an active internet connection. Please check your network and try again.
        </p>
        <button
          onClick={onRetry}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.75rem 1.5rem',
            background: 'var(--excel-green)',
            color: 'white',
            border: 'none',
            borderRadius: 8,
            fontSize: '0.95rem',
            fontWeight: 700,
            cursor: 'pointer',
            fontFamily: 'Inter, sans-serif',
          }}
        >
          <RefreshCw size={16} />
          Retry Connection
        </button>
      </div>
    </div>
  )
}
