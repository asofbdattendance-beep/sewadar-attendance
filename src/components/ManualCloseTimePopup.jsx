import { useState, useEffect } from 'react'
import { X, AlertTriangle, Moon, Clock } from 'lucide-react'

function formatISTDate(date) {
  return date.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata'
  })
}

export default function ManualCloseTimePopup({ 
  sessionData, 
  sewadar, 
  badge, 
  isSatsangDay,
  oldInDate,
  mode,
  onSubmit, 
  onClose 
}) {
  const inTime = sessionData?.in_time ? new Date(sessionData.in_time) : null
  
  // Calculate min and max dates
  const getMinDate = () => {
    if (!inTime) return ''
    const d = new Date(inTime)
    return d.toISOString().split('T')[0]
  }
  
  const getMaxDate = () => {
    if (!inTime) return ''
    const d = new Date(inTime)
    d.setDate(d.getDate() + 1)
    const max = d.toISOString().split('T')[0]
    const today = new Date().toISOString().split('T')[0]
    return max < today ? max : today
  }
  
  const [dateStr, setDateStr] = useState(getMinDate)
  const [timeStr, setTimeStr] = useState('')
  const [isWW, setIsWW] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [showWWConfirm, setShowWWConfirm] = useState(false)
  const [durationText, setDurationText] = useState('')
  const [exceeds12h, setExceeds12h] = useState(false)
  const [durationMins, setDurationMins] = useState(0)

  useEffect(() => {
    if (dateStr && timeStr && inTime) {
      const outTime = new Date(`${dateStr}T${timeStr}:00+05:30`)
      if (outTime >= inTime) {
        const durationMs = outTime - inTime
        const durationMinsCalc = Math.round(durationMs / (1000 * 60))
        const hours = Math.floor(durationMinsCalc / 60)
        const mins = durationMinsCalc % 60
        
        setDurationMins(durationMinsCalc)
        setDurationText(`${hours}h ${mins}m`)
        setExceeds12h(durationMinsCalc > 12 * 60)
      } else {
        setDurationMins(0)
        setDurationText('')
        setExceeds12h(false)
      }
    } else {
      setDurationMins(0)
      setDurationText('')
      setExceeds12h(false)
    }
  }, [dateStr, timeStr, inTime])

  const validateAndProceed = () => {
    if (!dateStr || !timeStr) {
      setError('Please enter both date and time')
      return false
    }
    
    const dateTime = new Date(`${dateStr}T${timeStr}:00+05:30`)
    
    if (inTime && dateTime < inTime) {
      setError('OUT time cannot be before IN time')
      return false
    }
    
    if (!reason.trim() || reason.trim().length < 3) {
      setError('Please provide a reason (min 3 characters')
      return false
    }
    
    if (inTime) {
      const durationMs = dateTime - inTime
      const MIN_MS = 10 * 60 * 1000
      const MAX_MS = 20 * 60 * 60 * 1000
      
      if (durationMs < MIN_MS) {
        setError(`Session must be at least 10 minutes (current: ${durationMins} mins)`)
        return false
      }
      
      if (durationMs > MAX_MS) {
        setError(`Duration cannot exceed 20 hours`)
        return false
      }
      
      if (durationMins > 12 * 60 && !isWW) {
        setShowWWConfirm(true)
        return false
      }
    }
    
    return true
  }

  const handleSubmit = () => {
    if (showWWConfirm) {
      if (!isWW) {
        setError('Long durations require Watch & Ward confirmation')
        return
      }
    }
    
    if (!validateAndProceed()) return
    
    const outTimeISO = new Date(`${dateStr}T${timeStr}:00+05:30`).toISOString()
    
    onSubmit({
      outTimeISO,
      isWatchWard: isWW || exceeds12h,
      reason: reason.trim(),
    })
  }

  const handleConfirmWW = () => {
    setIsWW(true)
    setShowWWConfirm(false)
    setError('')
    handleSubmit()
  }

  const handleDenyWW = () => {
    setShowWWConfirm(false)
    setError('Long durations require Watch & Ward confirmation')
  }

  const handleDateChange = (e) => {
    setDateStr(e.target.value)
    setTimeStr('')
    setError('')
    setIsWW(false)
  }

  const handleTimeChange = (e) => {
    setTimeStr(e.target.value)
    setError('')
  }

  const handleReasonChange = (e) => {
    setReason(e.target.value)
    if (error.includes('reason')) setError('')
  }

  const minDate = getMinDate()
  const maxDate = getMaxDate()

  if (showWWConfirm) {
    return (
      <div className="popup-card" style={{ maxWidth: 380 }}>
        <div style={{ padding: '1.5rem', textAlign: 'center' }}>
          <div style={{ width: 56, height: 56, background: 'rgba(59,130,246,0.15)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
            <AlertTriangle size={28} color="#3b82f6" />
          </div>
          <h3 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Duration Exceeds 12 Hours</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
            The session duration is {durationText}. Was this a Watch & Ward duty?
          </p>
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem', marginBottom: '1rem', textAlign: 'left' }}>
            <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{sewadar?.sewadar_name || 'Unknown'}</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{badge}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--gold)', marginTop: '0.25rem' }}>
              Duration: {durationText}
            </div>
          </div>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <button className="btn btn-primary btn-full" onClick={handleConfirmWW}>
              <Moon size={16} style={{ marginRight: '0.5rem' }} />
              Yes - Watch & Ward
            </button>
            <button className="btn btn-outline btn-full" onClick={handleDenyWW}>
              No - Cancel
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="popup-card" style={{ maxWidth: 380 }}>
      <div style={{ padding: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
            {mode === 'forgot_out' ? 'Enter When You Left' : 'Enter OUT Time'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
            <X size={20} color="var(--text-muted)" />
          </button>
        </div>
        
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem', marginBottom: '1rem', textAlign: 'left' }}>
          <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{sewadar?.sewadar_name || 'Unknown'}</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{badge}</div>
          {inTime && (
            <div style={{ fontSize: '0.78rem', color: 'var(--gold)', marginTop: '0.25rem' }}>
              IN: {inTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })} on {formatISTDate(inTime)}
            </div>
          )}
        </div>
        
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
          {mode === 'watch_ward' 
            ? 'When did the Watch & Ward shift end?' 
            : mode === 'forgot_out'
              ? 'You forgot to scan OUT last time. When did you leave?' 
              : 'Session exceeds 20 hours. Please enter the OUT time manually.'
          }
        </p>
        
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={dateStr} onChange={handleDateChange} min={minDate} max={maxDate} />
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              Select {minDate === maxDate ? formatISTDate(new Date(minDate)) : `${formatISTDate(new Date(minDate))} or ${formatISTDate(new Date(maxDate))}`}
            </div>
          </div>
          
          <div>
            <label className="label">Time</label>
            <input 
              type="time" 
              className="input" 
              value={timeStr} 
              onChange={handleTimeChange}
            />
          </div>

          {durationText && (
            <div style={{ 
              padding: '0.5rem 0.75rem', 
              background: exceeds12h ? 'rgba(234,179,8,0.15)' : 'rgba(34,197,94,0.1)', 
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Duration</span>
              <span style={{ 
                fontSize: '0.85rem', 
                fontWeight: 700, 
                color: exceeds12h ? '#ca8a04' : 'var(--green)'
              }}>
                {durationText}
                {exceeds12h && <span style={{ fontSize: '0.7rem', marginLeft: '0.5rem' }}>(W&W needed)</span>}
              </span>
            </div>
          )}

          {durationText && durationMins > 0 && durationMins < 10 && (
            <div style={{ color: 'var(--red)', fontSize: '0.82rem', padding: '0.5rem', background: 'rgba(220,38,38,0.1)', borderRadius: 6 }}>
              Minimum session duration is 10 minutes
            </div>
          )}
          
          <div>
            <label className="label">Reason <span style={{ color: 'var(--red)' }}>*</span></label>
            <textarea
              className="input"
              rows={2}
              placeholder="Why did you forget to scan OUT?"
              value={reason}
              onChange={handleReasonChange}
              style={{ resize: 'none' }}
            />
          </div>
          
          {error && (
            <div style={{ color: 'var(--red)', fontSize: '0.85rem', padding: '0.5rem', background: 'rgba(220,38,38,0.1)', borderRadius: 6, border: '1px solid rgba(220,38,38,0.3)' }}>
              {error}
            </div>
          )}
          
          <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.5rem' }}>
            <button 
              className="btn btn-primary btn-full" 
              onClick={handleSubmit}
              disabled={!dateStr || !timeStr}
            >
              <Clock size={16} style={{ marginRight: '0.5rem' }} />
              Close Session
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