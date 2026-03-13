import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES } from '../lib/supabase'
import { Search, Calendar, Download, User, LogIn, LogOut, Clock } from 'lucide-react'

export default function AdminPage() {
  const { profile } = useAuth()
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [dateRange, setDateRange] = useState({ from: '', to: '' })

  const isAdminOrAbove = [ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(profile?.role)
  if (!isAdminOrAbove) {
    return <div className="page text-center mt-3"><p className="text-muted">Access denied.</p></div>
  }

  async function searchSewadars() {
    if (!searchTerm.trim()) return
    setSearching(true)
    const term = searchTerm.trim()
    const { data } = await supabase.from('sewadars')
      .select('*')
      .or(`sewadar_name.ilike.%${term}%,badge_number.ilike.%${term.toUpperCase()}%`)
      .limit(15)
    setSearchResults(data || [])
    setSearching(false)
  }

  async function loadHistory(sewadar) {
    setSelected(sewadar)
    setHistoryLoading(true)
    setHistory([])
    let q = supabase.from('attendance')
      .select('*')
      .eq('badge_number', sewadar.badge_number)
      .order('scan_time', { ascending: false })
      .limit(200)
    if (dateRange.from) { const s = new Date(dateRange.from); s.setHours(0,0,0,0); q = q.gte('scan_time', s.toISOString()) }
    if (dateRange.to) { const e = new Date(dateRange.to); e.setHours(23,59,59,999); q = q.lte('scan_time', e.toISOString()) }
    const { data } = await q
    setHistory(data || [])
    setHistoryLoading(false)
  }

  function exportHistory() {
    if (!selected || !history.length) return
    const csv = [
      ['Date','Time','Type','Scanned At','Scanned By','Scanner Centre'].join(','),
      ...history.map(r => [
        new Date(r.scan_time).toLocaleDateString('en-IN'),
        new Date(r.scan_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
        r.type, r.centre, r.scanner_name || '', r.scanner_centre || ''
      ].join(','))
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `history_${selected.badge_number}.csv`; a.click()
  }

  // Group history by date
  const byDate = {}
  history.forEach(r => {
    const d = new Date(r.scan_time).toISOString().split('T')[0]
    if (!byDate[d]) byDate[d] = []
    byDate[d].push(r)
  })
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a))

  // Stats
  const totalDays = dates.length
  const totalIns = history.filter(r => r.type === 'IN').length

  function fmt(iso) { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) }
  function fmtDate(d) { return new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) }

  return (
    <div className="page-wide pb-nav" style={{ maxWidth: 860 }}>
      <div className="mt-2 mb-3">
        <h2 style={{ fontFamily: 'Cinzel, serif', color: 'var(--gold)', fontSize: '1.2rem' }}>Sewadar History</h2>
        <p className="text-muted text-xs mt-1">Look up attendance history for any sewadar</p>
      </div>

      {/* Search */}
      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div className="search-box" style={{ flex: 1, minWidth: 200 }}>
          <Search size={15} />
          <input
            type="text" placeholder="Name or badge number…" value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchSewadars()}
          />
        </div>
        <button className="btn btn-gold" onClick={searchSewadars} disabled={searching}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

      {/* Results */}
      {searchResults.length > 0 && (
        <div className="card mb-3" style={{ padding: 0, overflow: 'hidden' }}>
          {searchResults.map((s, i) => (
            <button
              key={s.badge_number}
              onClick={() => loadHistory(s)}
              style={{
                display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between',
                padding: '0.75rem 1rem', background: selected?.badge_number === s.badge_number ? 'var(--gold-bg)' : 'none',
                border: 'none', borderBottom: i < searchResults.length - 1 ? '1px solid var(--border)' : 'none',
                cursor: 'pointer', textAlign: 'left'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--gold-bg)', border: '1px solid var(--gold-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <User size={16} color="var(--gold)" />
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{s.sewadar_name}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{s.centre} · {s.department || '—'} · {s.gender || '—'}</div>
                </div>
              </div>
              <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--gold)' }}>{s.badge_number}</span>
            </button>
          ))}
        </div>
      )}

      {/* Selected sewadar history */}
      {selected && (
        <div>
          {/* Profile strip */}
          <div className="card mb-3" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.85rem 1rem' }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--gold-bg)', border: '1px solid var(--gold-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <User size={20} color="var(--gold)" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: '1rem' }}>{selected.sewadar_name}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{selected.badge_number} · {selected.centre} · {selected.department || '—'}</div>
            </div>
            <div style={{ display: 'flex', gap: '1rem', flexShrink: 0 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--gold)' }}>{totalDays}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Days</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--green)' }}>{totalIns}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Satsangs</div>
              </div>
            </div>
          </div>

          {/* Date range filter + export */}
          <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.35rem 0.75rem', flex: 1 }}>
              <Calendar size={13} color="var(--text-muted)" />
              <input type="date" value={dateRange.from} onChange={e => setDateRange({...dateRange, from: e.target.value})}
                style={{ border: 'none', background: 'none', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none' }} />
              <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>→</span>
              <input type="date" value={dateRange.to} onChange={e => setDateRange({...dateRange, to: e.target.value})}
                style={{ border: 'none', background: 'none', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none' }} />
            </div>
            <button className="btn btn-outline" onClick={() => loadHistory(selected)} style={{ fontSize: '0.82rem' }}>Apply</button>
            <button className="btn btn-ghost" onClick={exportHistory} style={{ padding: '0.4rem 0.75rem', fontSize: '0.82rem' }}>
              <Download size={14} /> Export
            </button>
          </div>

          {historyLoading ? (
            <div className="spinner" style={{ margin: '2rem auto' }} />
          ) : dates.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No attendance records found.</div>
          ) : (
            dates.map(date => {
              const entries = byDate[date]
              const hasIn = entries.some(r => r.type === 'IN')
              const hasOut = entries.some(r => r.type === 'OUT')
              return (
                <div key={date} className="card mb-2" style={{ padding: '0.85rem 1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Calendar size={14} color="var(--text-muted)" />
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{fmtDate(date)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.4rem' }}>
                      {hasIn && <span className="badge badge-green">IN</span>}
                      {hasOut && <span className="badge badge-red">OUT</span>}
                      {!hasIn && !hasOut && <span className="badge" style={{ background: 'var(--bg-muted)', color: 'var(--text-muted)' }}>—</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {entries.map(r => (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.82rem' }}>
                        {r.type === 'IN'
                          ? <LogIn size={13} color="var(--green)" />
                          : <LogOut size={13} color="var(--red)" />}
                        <span style={{ fontWeight: 500, color: r.type === 'IN' ? 'var(--green)' : 'var(--red)', minWidth: 28 }}>{r.type}</span>
                        <span style={{ color: 'var(--text-primary)' }}>{fmt(r.scan_time)}</span>
                        {r.scanner_centre && r.scanner_centre !== selected.centre && (
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>at {r.scanner_centre}</span>
                        )}
                        <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>by {r.scanner_name || '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}