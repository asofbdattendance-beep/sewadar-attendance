import { useState } from 'react'
import { Calendar } from 'lucide-react'

export default function DateRangePicker({ value, onChange, maxDays = 365 }) {
  const [focusedInput, setFocusedInput] = useState(null)

  const today = () => {
    // Use UTC date for consistency with DB timestamps
    return new Date().toISOString().split('T')[0]
  }

  const handleFromChange = (val) => {
    const newFrom = val
    const newTo = value.to && val > value.to ? val : value.to
    onChange({ from: newFrom, to: newTo || newFrom })
  }

  const handleToChange = (val) => {
    if (val < value.from) return
    const fromDate = new Date(value.from + 'T00:00:00')
    const toDate = new Date(val + 'T00:00:00')
    const diffDays = Math.round((toDate - fromDate) / 86400000)
    if (diffDays > maxDays) return
    onChange({ from: value.from, to: val })
  }

  const clearDates = () => {
    onChange({ from: today(), to: today() })
  }

  const isToday = (val) => val === today()

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      background: 'white',
      border: '1.5px solid var(--border)',
      borderRadius: 'var(--radius)',
      padding: '0.4rem 0.75rem',
      flexShrink: 0,
    }}>
      <Calendar size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
      
      <input
        type="date"
        value={value.from || ''}
        max={value.to || undefined}
        onChange={e => handleFromChange(e.target.value)}
        onFocus={() => setFocusedInput('from')}
        onBlur={() => setFocusedInput(null)}
        title="From date"
        style={{
          border: 'none',
          background: 'transparent',
          outline: 'none',
          fontSize: '0.82rem',
          fontFamily: 'inherit',
          color: isToday(value.from) ? 'var(--text-muted)' : 'var(--text-primary)',
          fontWeight: isToday(value.from) ? 400 : 600,
          minWidth: '95px',
          cursor: 'pointer',
        }}
      />

      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', flexShrink: 0 }}>to</span>

      <input
        type="date"
        value={value.to || ''}
        min={value.from || undefined}
        onChange={e => handleToChange(e.target.value)}
        onFocus={() => setFocusedInput('to')}
        onBlur={() => setFocusedInput(null)}
        title="To date"
        style={{
          border: 'none',
          background: 'transparent',
          outline: 'none',
          fontSize: '0.82rem',
          fontFamily: 'inherit',
          color: isToday(value.to) ? 'var(--text-muted)' : 'var(--text-primary)',
          fontWeight: isToday(value.to) ? 400 : 600,
          minWidth: '95px',
          cursor: 'pointer',
        }}
      />

      {value.from && value.to && (value.from !== today() || value.to !== today()) && (
        <button
          onClick={clearDates}
          title="Reset to today"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text-muted)',
            padding: '2px',
            display: 'flex',
            alignItems: 'center',
            fontSize: '0.7rem',
            fontWeight: 600,
          }}
        >
          Today
        </button>
      )}
    </div>
  )
}
