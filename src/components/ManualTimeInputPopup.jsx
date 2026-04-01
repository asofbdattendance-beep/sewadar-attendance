import { useState } from 'react'
import { Clock, X } from 'lucide-react'

export default function ManualTimeInputPopup({ sessionData, sewadar, badge, onSubmit, onClose }) {
  const inTime = sessionData?.in_time ? new Date(sessionData.in_time) : null
  const maxHours = sessionData?.max_hours || 12
  const mode = sessionData?.mode || 'exceeded_duration'
  
  // For Satsang day: default to 23:59 on same day
  // For regular day: default to IN time + max hours
  const getDefaultDateTime = () => {
    if (mode === 'satsang' && sessionData?.inDate) {
      const date = sessionData.inDate
      return { date, time: '23:59' }
    } else {
      const defaultDateTime = inTime 
        ? new Date(inTime.getTime() + maxHours * 60 * 60 * 1000)
        : new Date()
      return { 
        date: defaultDateTime.toISOString().split('T')[0],
        time: defaultDateTime.toTimeString().slice(0, 5)
      }
    }
  }
  
  const defaults = getDefaultDateTime()
  
  const [dateStr, setDateStr] = useState(defaults.date)
  const [timeStr, setTimeStr] = useState(defaults.time)
  const [error, setError] = useState('')
  
  const handleSubmit = () => {
    const dateTime = new Date(`${dateStr}T${timeStr}:00+05:30`)
    
    // Validate: OUT time must be after IN time
    if (inTime && dateTime < inTime) {
      setError('OUT time cannot be before IN time')
      return
    }
    
    // Validate: duration - min 10 mins, max 12 hours
    if (inTime) {
      const durationMs = dateTime - inTime
      const MIN_MS = 10 * 60 * 1000   // 10 minutes minimum
      const MAX_MS = 12 * 60 * 60 * 1000 // 12 hours max
      
      if (durationMs < MIN_MS) {
        setError('Session must be at least 10 minutes')
        return
      }
      
      if (durationMs > MAX_MS) {
        setError('Duration cannot exceed 12 hours')
        return
      }
    }
    
    onSubmit(dateTime.toISOString())
  }
  
  return (
    <div className="popup-card" style={{ maxWidth: 380 }}>
      <div style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Enter OUT Time</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={20} color="var(--text-muted)" />
          </button>
        </div>
        
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem', marginBottom: '1rem', textAlign: 'left' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{sewadar?.sewadar_name || 'Unknown'}</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{badge}</div>
          {inTime && (
            <div style={{ fontSize: '0.78rem', color: 'var(--gold)', marginTop: '0.25rem' }}>
              IN at {inTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
            </div>
          )}
        </div>
        
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
          This session exceeds {maxHours} hours. Please enter the OUT time manually.
        </p>
        
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.35rem' }}>Date</label>
            <input
              type="date"
              className="input"
              value={dateStr}
              onChange={e => setDateStr(e.target.value)}
            />
          </div>
          
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 500, marginBottom: '0.35rem' }}>Time</label>
            <input
              type="time"
              className="input"
              value={timeStr}
              onChange={e => setTimeStr(e.target.value)}
            />
          </div>
          
          {error && (
            <div style={{ color: 'var(--red)', fontSize: '0.85rem', padding: '0.5rem', background: 'var(--red-bg)', borderRadius: 6 }}>
              {error}
            </div>
          )}
          
          <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button className="btn btn-primary btn-full" onClick={handleSubmit}>
              <Clock size={16} style={{ marginRight: '0.5rem' }} />
              Confirm OUT Time
            </button>
            <button className="btn btn-ghost btn-full" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
