import { useState, useEffect } from 'react'
import { AlertTriangle, Trash2, X } from 'lucide-react'

export default function ConfirmModal({ open, onConfirm, onCancel, title, message, confirmLabel, cancelLabel, danger = false, loading = false }) {
  const [countdown, setCountdown] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!open) {
      setCountdown(false)
      setConfirming(false)
    }
  }, [open])

  if (!open) return null

  const handleConfirmClick = () => {
    if (danger && !countdown) {
      setCountdown(true)
      setConfirming(true)
      setTimeout(() => {
        setCountdown(false)
        setConfirming(false)
      }, 3000)
    } else {
      onConfirm()
    }
  }

  return (
    <div className="overlay" onClick={onCancel}>
      <div className="overlay-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 380, textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.25rem' }}>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: '0.25rem' }}>
            <X size={18} />
          </button>
        </div>

        <div style={{
          width: 52, height: 52, borderRadius: '50%',
          background: danger ? 'rgba(198,40,40,0.1)' : 'rgba(33,115,70,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 1rem',
        }}>
          {danger ? <Trash2 size={24} color="var(--red)" /> : <AlertTriangle size={24} color={danger ? 'var(--red)' : 'var(--amber)'} />}
        </div>

        <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.5rem' }}>{title}</h3>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem', lineHeight: 1.5 }}>{message}</p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <button className="btn btn-outline btn-full" onClick={onCancel} disabled={loading}>
            {cancelLabel || 'Cancel'}
          </button>
          <button
            onClick={handleConfirmClick}
            disabled={loading}
            style={{
              padding: '0.65rem',
              border: 'none',
              borderRadius: 8,
              background: danger
                ? (countdown ? 'rgba(198,40,40,0.7)' : '#dc2626')
                : 'var(--excel-green)',
              color: 'white',
              fontWeight: 700,
              fontSize: '0.9rem',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              opacity: loading ? 0.6 : 1,
              transition: 'all 0.15s',
            }}
          >
            {loading ? '…' : countdown ? 'Tap again to confirm' : (confirmLabel || 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
