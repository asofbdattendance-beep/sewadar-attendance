import { useState, useEffect, useRef } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'

export default function CentreComboBox({ value, onChange, centres = [], includeAll = true, allowClear = false }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const ref = useRef(null)
  const searchRef = useRef(null)

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    if (open && searchRef.current) {
      searchRef.current.focus()
    }
  }, [open])

  const parents = [...new Set(centres.filter(c => !c.parent_centre).map(c => c.centre_name))]
  const childrenMap = {}
  centres.forEach(c => {
    if (c.parent_centre) {
      if (!childrenMap[c.parent_centre]) childrenMap[c.parent_centre] = []
      childrenMap[c.parent_centre].push(c)
    }
  })

  const filteredParents = parents.filter(p =>
    p.toLowerCase().includes(search.toLowerCase())
  )

  const flatOptions = []
  if (includeAll) flatOptions.push({ label: 'All Centres', value: '__all__', isAll: true })
  filteredParents.forEach(p => {
    flatOptions.push({ label: p, value: p, isParent: true })
    if (childrenMap[p] && search === '') {
      childrenMap[p].forEach(c => {
        flatOptions.push({ label: c.centre_name, value: c.centre_name, parent: p })
      })
    }
  })

  const handleSelect = (val) => {
    onChange(val === '__all__' ? null : val)
    setOpen(false)
    setSearch('')
    setHighlighted(0)
  }

  const handleKeyDown = (e) => {
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted(h => Math.min(h + 1, flatOptions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (flatOptions[highlighted]) {
        handleSelect(flatOptions[highlighted].value)
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
      setSearch('')
    }
  }

  const displayLabel = () => {
    if (!value) return 'All Centres'
    const found = centres.find(c => c.centre_name === value)
    if (!found) return value
    return found.centre_name
  }

  return (
    <div ref={ref} style={{ position: 'relative', flex: 1, minWidth: 160 }}>
      <button
        onClick={() => setOpen(o => !o)}
        onKeyDown={handleKeyDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          width: '100%',
          padding: '0.5rem 0.75rem',
          background: 'white',
          border: `1.5px solid ${open ? 'var(--excel-green)' : 'var(--border)'}`,
          borderRadius: 'var(--radius)',
          fontFamily: 'inherit',
          fontSize: '0.85rem',
          color: value ? 'var(--text-primary)' : 'var(--text-muted)',
          fontWeight: value ? 600 : 400,
          cursor: 'pointer',
          boxShadow: open ? '0 0 0 3px rgba(33,115,70,0.1)' : 'none',
          transition: 'all 0.15s',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {displayLabel()}
        </span>
        <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
          {allowClear && value && (
            <span
              onClick={e => { e.stopPropagation(); onChange(null); setOpen(false) }}
              style={{ color: 'var(--text-muted)', display: 'flex' }}
            >
              <X size={13} />
            </span>
          )}
          <ChevronDown size={14} style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </div>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          right: 0,
          background: 'white',
          border: '1.5px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 300,
          maxHeight: 320,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 0.75rem',
            borderBottom: '1px solid var(--border)',
            position: 'sticky',
            top: 0,
            background: 'white',
            zIndex: 1,
          }}>
            <Search size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search centres…"
              value={search}
              onChange={e => { setSearch(e.target.value); setHighlighted(0) }}
              onKeyDown={handleKeyDown}
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                outline: 'none',
                fontSize: '0.85rem',
                fontFamily: 'inherit',
                color: 'var(--text-primary)',
              }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                <X size={12} />
              </button>
            )}
          </div>

          {flatOptions.length === 0 && (
            <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              No centres found
            </div>
          )}

          {flatOptions.map((opt, i) => (
            <div key={opt.value} style={{ position: 'relative' }}>
              <button
                onClick={() => handleSelect(opt.value)}
                onMouseEnter={() => setHighlighted(i)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  width: '100%',
                  padding: opt.isParent ? '0.55rem 0.75rem' : '0.45rem 0.75rem 0.45rem 1.75rem',
                  background: highlighted === i ? 'var(--bg)' : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'inherit',
                  fontSize: '0.85rem',
                  fontWeight: opt.isAll || opt.isParent ? 700 : 400,
                  color: opt.isAll ? 'var(--excel-green)' : opt.isParent ? 'var(--text-primary)' : 'var(--text-secondary)',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                {opt.isParent && (
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700, minWidth: 16 }}>
                    {childrenMap[opt.label]?.length > 0 ? `+${childrenMap[opt.label].length}` : ''}
                  </span>
                )}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {opt.label}
                </span>
                {value === opt.value && (
                  <span style={{ marginLeft: 'auto', color: 'var(--excel-green)', fontSize: '0.7rem', fontWeight: 700 }}>Selected</span>
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
