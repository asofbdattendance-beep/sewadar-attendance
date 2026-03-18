const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'in', label: 'IN only' },
  { key: 'out', label: 'OUT only' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'manual', label: 'Manual Entry' },
]

export default function QuickFilterChips({ value, onChange, counts = {} }) {
  return (
    <div style={{
      display: 'flex',
      gap: '0.4rem',
      flexWrap: 'wrap',
    }}>
      {FILTERS.map(f => {
        const isActive = value === f.key
        const count = counts[f.key]
        return (
          <button
            key={f.key}
            onClick={() => onChange(f.key)}
            title={f.key === 'all' ? 'Show all records' : `Filter by ${f.label}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '0.3rem 0.7rem',
              borderRadius: 999,
              border: `1.5px solid ${isActive ? (
                f.key === 'in' ? 'var(--green)' :
                f.key === 'out' ? 'var(--red)' :
                f.key === 'flagged' ? 'rgba(198,40,40,0.5)' :
                f.key === 'manual' ? 'var(--gold)' :
                'var(--excel-green)'
              ) : 'var(--border)'}`,
              background: isActive ? (
                f.key === 'in' ? 'var(--green-bg)' :
                f.key === 'out' ? 'var(--red-bg)' :
                f.key === 'flagged' ? 'rgba(198,40,40,0.08)' :
                f.key === 'manual' ? 'var(--gold-bg)' :
                'var(--green-bg)'
              ) : 'white',
              color: isActive ? (
                f.key === 'in' ? 'var(--green)' :
                f.key === 'out' ? 'var(--red)' :
                f.key === 'flagged' ? 'var(--red)' :
                f.key === 'manual' ? 'var(--gold)' :
                'var(--excel-green)'
              ) : 'var(--text-muted)',
              fontFamily: 'inherit',
              fontSize: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.15s',
              letterSpacing: '0.02em',
              whiteSpace: 'nowrap',
            }}
          >
            {f.label}
            {count !== undefined && count > 0 && (
              <span style={{
                background: isActive ? 'currentColor' : 'var(--bg)',
                color: isActive ? 'white' : 'var(--text-muted)',
                borderRadius: 999,
                padding: '0 5px',
                fontSize: '0.65rem',
                minWidth: 18,
                textAlign: 'center',
                fontWeight: 800,
              }}>
                {count > 99 ? '99+' : count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
