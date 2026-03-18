import { useState, useEffect, useCallback, useRef } from 'react'
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react'

const addToastRef = { current: null }
export function showToast(message, type = 'info', duration = 4000) {
  if (addToastRef.current) addToastRef.current({ message, type, id: Date.now(), duration })
}
export function showSuccess(msg) { showToast(msg, 'success') }
export function showError(msg) { showToast(msg, 'error') }
export function showInfo(msg) { showToast(msg, 'info') }

export default function ToastContainer() {
  const [toasts, setToasts] = useState([])
  const timeoutRefs = useRef({})

  const addToast = useCallback((toast) => {
    setToasts(prev => [...prev, toast])
    const tid = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== toast.id))
      delete timeoutRefs.current[toast.id]
    }, toast.duration || 4000)
    timeoutRefs.current[toast.id] = tid
  }, [])

  useEffect(() => {
    addToastRef.current = addToast
    return () => { addToastRef.current = null }
  }, [addToast])

  const removeToast = (id) => {
    clearTimeout(timeoutRefs.current[id])
    delete timeoutRefs.current[id]
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'fixed',
      top: 60,
      right: 16,
      left: 16,
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
      maxWidth: 480,
      margin: '0 auto',
      pointerEvents: 'none',
    }}>
      {toasts.map(toast => {
        const configs = {
          success: { bg: '#dcfce7', border: 'rgba(22,163,74,0.4)', color: '#16a34a', Icon: CheckCircle },
          error: { bg: '#fee2e2', border: 'rgba(220,38,38,0.4)', color: '#dc2626', Icon: AlertCircle },
          info: { bg: '#dbeafe', border: 'rgba(37,99,235,0.4)', color: '#2563eb', Icon: Info },
        }
        const cfg = configs[toast.type] || configs.info
        const Icon = cfg.Icon

        return (
          <div
            key={toast.id}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.6rem',
              padding: '0.75rem 1rem',
              background: cfg.bg,
              border: `1.5px solid ${cfg.border}`,
              borderRadius: 10,
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
              color: cfg.color,
              fontSize: '0.85rem',
              fontWeight: 500,
              lineHeight: 1.4,
              pointerEvents: 'all',
              animation: 'toastSlideIn 0.25s ease',
            }}
          >
            <Icon size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ flex: 1 }}>{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: cfg.color,
                display: 'flex',
                padding: 0,
                opacity: 0.6,
                flexShrink: 0,
              }}
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
      <style>{`
        @keyframes toastSlideIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}
