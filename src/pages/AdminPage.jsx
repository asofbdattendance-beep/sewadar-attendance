import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES, JATHA_TYPE_LABEL } from '../lib/supabase'
import { Search, Calendar, Download, User, LogIn, LogOut, Flag, MapPin } from 'lucide-react'

const TABS = [
  { id: 'attendance', label: 'Attendance History' },
  { id: 'jatha', label: 'Jatha History' },
]

export default function AdminPage() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('attendance')

  // ── shared sewadar search ──
  const [searchTerm, setSearchTerm]     = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching]       = useState(false)
  const [selected, setSelected]         = useState(null)

  // ── attendance history ──
  const [history, setHistory]           = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [dateRange, setDateRange]       = useState({ from: '', to: '' })

  // ── jatha history ──
  const [jathaHistory, setJathaHistory] = useState([])
  const [jathaLoading, setJathaLoading] = useState(false)
  const [jathaDateRange, setJathaDateRange] = useState({ from: '', to: '' })

  const isAdminOrAbove = [ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(profile?.role)
  if (!isAdminOrAbove) {
    return <div className="page text-center mt-3"><p className="text-muted">Access denied.</p></div>
  }

  async function searchSewadars() {
    if (!searchTerm.trim()) return
    setSearching(true)
    const { data } = await supabase.from('sewadars')
      .select('*')
      .or(`sewadar_name.ilike.%${searchTerm.trim()}%,badge_number.ilike.%${searchTerm.trim().toUpperCase()}%`)
      .limit(15)
    setSearchResults(data || [])
    setSearching(false)
  }

  async function loadHistory(sewadar) {
    setSelected(sewadar)
    setHistoryLoading(true); setHistory([])
    let q = supabase.from('attendance').select('*')
      .eq('badge_number', sewadar.badge_number)
      .order('scan_time', { ascending: false }).limit(300)
    if (dateRange.from) { const s = new Date(dateRange.from); s.setHours(0,0,0,0); q = q.gte('scan_time', s.toISOString()) }
    if (dateRange.to)   { const e = new Date(dateRange.to);   e.setHours(23,59,59,999); q = q.lte('scan_time', e.toISOString()) }
    const { data } = await q
    setHistory(data || [])
    setHistoryLoading(false)
  }

  async function loadJathaHistory(sewadar) {
    setSelected(sewadar)
    setJathaLoading(true); setJathaHistory([])
    let q = supabase.from('jatha_attendance').select('*')
      .eq('badge_number', sewadar.badge_number)
      .order('date_from', { ascending: false }).limit(100)
    if (jathaDateRange.from) q = q.gte('date_from', jathaDateRange.from)
    if (jathaDateRange.to)   q = q.lte('date_to',   jathaDateRange.to)
    const { data } = await q
    setJathaHistory(data || [])
    setJathaLoading(false)
  }

  function selectSewadar(s) {
    setSearchResults([])
    if (tab === 'attendance') loadHistory(s)
    else loadJathaHistory(s)
  }

  function exportAttendance() {
    if (!selected || !history.length) return
    const csv = [
      ['Date','Time','Type','Scanned At','Scanned By','Scanner Centre'].join(','),
      ...history.map(r => [
        new Date(r.scan_time).toLocaleDateString('en-IN'),
        new Date(r.scan_time).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }),
        r.type, r.centre, r.scanner_name || '', r.scanner_centre || ''
      ].join(','))
    ].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv' }))
    a.download = `attendance_${selected.badge_number}.csv`; a.click()
  }

  function exportJatha() {
    if (!selected || !jathaHistory.length) return
    const csv = [
      ['Badge','Name','Centre','Jatha Type','Jatha Centre','Dept','From','To','Satsang Days','Remarks','Flagged','Flag Reason','Submitted By'].join(','),
      ...jathaHistory.map(r => [
        r.badge_number, `"${r.sewadar_name}"`, r.centre,
        JATHA_TYPE_LABEL[r.jatha_type] || r.jatha_type,
        r.jatha_centre, r.jatha_dept,
        r.date_from, r.date_to, r.satsang_days,
        `"${r.remarks || ''}"`, r.flag ? 'Yes' : 'No',
        `"${r.flag_reason || ''}"`, r.submitted_by
      ].join(','))
    ].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv' }))
    a.download = `jatha_${selected.badge_number}.csv`; a.click()
  }

  // Attendance grouping
  const byDate = {}
  history.forEach(r => {
    const d = new Date(r.scan_time).toISOString().split('T')[0]
    if (!byDate[d]) byDate[d] = []
    byDate[d].push(r)
  })
  const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a))
  const totalDays = dates.length
  const totalIns  = history.filter(r => r.type === 'IN').length

  // Jatha stats
  const totalJathas = jathaHistory.length
  const totalSatsangDays = jathaHistory.reduce((acc, r) => acc + (r.satsang_days || 0), 0)

  function fmt(iso)  { return new Date(iso).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }) }
  function fmtD(d)   { return new Date(d+'T12:00:00').toLocaleDateString('en-IN', { weekday:'short', day:'2-digit', month:'short', year:'numeric' }) }
  function fmtShort(d) { return new Date(d+'T12:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) }

  return (
    <div className="page-wide pb-nav" style={{ maxWidth: 860 }}>
      <div className="mt-2 mb-3">
        <h2 style={{ fontFamily:'Cinzel, serif', color:'var(--gold)', fontSize:'1.2rem' }}>Sewadar History</h2>
        <p className="text-muted text-xs mt-1">Look up attendance &amp; jatha history for any sewadar</p>
      </div>

      {/* Tab switcher */}
      <div style={{ display:'flex', gap:'0.4rem', marginBottom:'1.25rem', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:10, padding:4 }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              flex:1, padding:'0.45rem 0', border:'none', borderRadius:8,
              background: tab === t.id ? 'white' : 'transparent',
              boxShadow: tab === t.id ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
              fontWeight: tab === t.id ? 700 : 500,
              fontSize:'0.85rem', color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor:'pointer', fontFamily:'Inter, sans-serif', transition:'all 0.12s'
            }}>{t.label}</button>
        ))}
      </div>

      {/* Search */}
      <div style={{ display:'flex', gap:'0.6rem', marginBottom:'1rem' }}>
        <div className="search-box" style={{ flex:1 }}>
          <Search size={15} />
          <input type="text" placeholder="Name or badge number…" value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchSewadars()} />
        </div>
        <button className="btn btn-gold" onClick={searchSewadars} disabled={searching}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

      {/* Results list */}
      {searchResults.length > 0 && (
        <div className="card mb-3" style={{ padding:0, overflow:'hidden' }}>
          {searchResults.map((s,i) => (
            <button key={s.badge_number} onClick={() => selectSewadar(s)}
              style={{
                display:'flex', width:'100%', alignItems:'center', justifyContent:'space-between',
                padding:'0.75rem 1rem', background: selected?.badge_number === s.badge_number ? 'var(--gold-bg)' : 'none',
                border:'none', borderBottom: i < searchResults.length-1 ? '1px solid var(--border)' : 'none',
                cursor:'pointer', textAlign:'left'
              }}>
              <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
                <div style={{ width:36, height:36, borderRadius:'50%', background:'var(--gold-bg)', border:'1px solid var(--gold-border)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <User size={16} color="var(--gold)" />
                </div>
                <div>
                  <div style={{ fontWeight:600, fontSize:'0.9rem' }}>{s.sewadar_name}</div>
                  <div style={{ fontSize:'0.78rem', color:'var(--text-muted)' }}>{s.centre} · {s.department || '—'} · {s.gender || '—'}</div>
                </div>
              </div>
              <span style={{ fontFamily:'monospace', fontSize:'0.82rem', color:'var(--gold)' }}>{s.badge_number}</span>
            </button>
          ))}
        </div>
      )}

      {/* ══════════════════════════════════
           TAB: ATTENDANCE HISTORY
         ══════════════════════════════════ */}
      {tab === 'attendance' && selected && (
        <div>
          {/* Profile strip + stats */}
          <div className="card mb-3" style={{ display:'flex', alignItems:'center', gap:'1rem', padding:'0.85rem 1rem' }}>
            <div style={{ width:44, height:44, borderRadius:'50%', background:'var(--gold-bg)', border:'1px solid var(--gold-border)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <User size={20} color="var(--gold)" />
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:600, fontSize:'1rem' }}>{selected.sewadar_name}</div>
              <div style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>{selected.badge_number} · {selected.centre} · {selected.department || '—'}</div>
            </div>
            <div style={{ display:'flex', gap:'1rem', flexShrink:0 }}>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:'1.2rem', fontWeight:700, color:'var(--gold)' }}>{totalDays}</div>
                <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', textTransform:'uppercase' }}>Days</div>
              </div>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:'1.2rem', fontWeight:700, color:'var(--green)' }}>{totalIns}</div>
                <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', textTransform:'uppercase' }}>Satsangs</div>
              </div>
            </div>
          </div>

          {/* Date filter + export */}
          <div style={{ display:'flex', gap:'0.6rem', marginBottom:'1rem', flexWrap:'wrap', alignItems:'center' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'0.35rem 0.75rem', flex:1 }}>
              <Calendar size={13} color="var(--text-muted)" />
              <input type="date" value={dateRange.from} onChange={e => setDateRange({...dateRange, from:e.target.value})}
                style={{ border:'none', background:'none', color:'var(--text-primary)', fontSize:'0.82rem', outline:'none' }} />
              <span style={{ color:'var(--text-muted)', fontSize:'0.82rem' }}>→</span>
              <input type="date" value={dateRange.to} onChange={e => setDateRange({...dateRange, to:e.target.value})}
                style={{ border:'none', background:'none', color:'var(--text-primary)', fontSize:'0.82rem', outline:'none' }} />
            </div>
            <button className="btn btn-outline" onClick={() => loadHistory(selected)} style={{ fontSize:'0.82rem' }}>Apply</button>
            <button className="btn btn-ghost" onClick={exportAttendance} style={{ padding:'0.4rem 0.75rem', fontSize:'0.82rem' }}>
              <Download size={14} /> Export
            </button>
          </div>

          {historyLoading ? (
            <div className="spinner" style={{ margin:'2rem auto' }} />
          ) : dates.length === 0 ? (
            <div className="card" style={{ textAlign:'center', padding:'2rem', color:'var(--text-muted)' }}>No attendance records found.</div>
          ) : dates.map(date => {
            const entries = byDate[date]
            const hasIn = entries.some(r => r.type === 'IN')
            const hasOut = entries.some(r => r.type === 'OUT')
            return (
              <div key={date} className="card mb-2" style={{ padding:'0.85rem 1rem' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.6rem' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                    <Calendar size={14} color="var(--text-muted)" />
                    <span style={{ fontWeight:600, fontSize:'0.9rem' }}>{fmtD(date)}</span>
                  </div>
                  <div style={{ display:'flex', gap:'0.4rem' }}>
                    {hasIn  && <span className="badge badge-green">IN</span>}
                    {hasOut && <span className="badge badge-red">OUT</span>}
                    {!hasIn && !hasOut && <span className="badge" style={{ background:'var(--bg-muted)', color:'var(--text-muted)' }}>—</span>}
                  </div>
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:'0.35rem' }}>
                  {entries.map(r => (
                    <div key={r.id} style={{ display:'flex', alignItems:'center', gap:'0.75rem', fontSize:'0.82rem' }}>
                      {r.type === 'IN' ? <LogIn size={13} color="var(--green)" /> : <LogOut size={13} color="var(--red)" />}
                      <span style={{ fontWeight:500, color: r.type === 'IN' ? 'var(--green)' : 'var(--red)', minWidth:28 }}>{r.type}</span>
                      <span style={{ color:'var(--text-primary)' }}>{fmt(r.scan_time)}</span>
                      {r.scanner_centre && r.scanner_centre !== selected.centre && (
                        <span style={{ color:'var(--text-muted)', fontSize:'0.78rem' }}>at {r.scanner_centre}</span>
                      )}
                      <span style={{ color:'var(--text-muted)', marginLeft:'auto' }}>by {r.scanner_name || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ══════════════════════════════════
           TAB: JATHA HISTORY
         ══════════════════════════════════ */}
      {tab === 'jatha' && selected && (
        <div>
          {/* Profile strip + stats */}
          <div className="card mb-3" style={{ display:'flex', alignItems:'center', gap:'1rem', padding:'0.85rem 1rem' }}>
            <div style={{ width:44, height:44, borderRadius:'50%', background:'var(--gold-bg)', border:'1px solid var(--gold-border)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <User size={20} color="var(--gold)" />
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:600, fontSize:'1rem' }}>{selected.sewadar_name}</div>
              <div style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>{selected.badge_number} · {selected.centre} · {selected.department || '—'}</div>
            </div>
            <div style={{ display:'flex', gap:'1rem', flexShrink:0 }}>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:'1.2rem', fontWeight:700, color:'var(--gold)' }}>{totalJathas}</div>
                <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', textTransform:'uppercase' }}>Jathas</div>
              </div>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:'1.2rem', fontWeight:700, color:'var(--green)' }}>{totalSatsangDays}</div>
                <div style={{ fontSize:'0.72rem', color:'var(--text-muted)', textTransform:'uppercase' }}>Satsang Days</div>
              </div>
            </div>
          </div>

          {/* Date filter + export */}
          <div style={{ display:'flex', gap:'0.6rem', marginBottom:'1rem', flexWrap:'wrap', alignItems:'center' }}>
            <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'0.35rem 0.75rem', flex:1 }}>
              <Calendar size={13} color="var(--text-muted)" />
              <input type="date" value={jathaDateRange.from} onChange={e => setJathaDateRange({...jathaDateRange, from:e.target.value})}
                style={{ border:'none', background:'none', color:'var(--text-primary)', fontSize:'0.82rem', outline:'none' }} />
              <span style={{ color:'var(--text-muted)', fontSize:'0.82rem' }}>→</span>
              <input type="date" value={jathaDateRange.to} onChange={e => setJathaDateRange({...jathaDateRange, to:e.target.value})}
                style={{ border:'none', background:'none', color:'var(--text-primary)', fontSize:'0.82rem', outline:'none' }} />
            </div>
            <button className="btn btn-outline" onClick={() => loadJathaHistory(selected)} style={{ fontSize:'0.82rem' }}>Apply</button>
            <button className="btn btn-ghost" onClick={exportJatha} style={{ padding:'0.4rem 0.75rem', fontSize:'0.82rem' }}>
              <Download size={14} /> Export
            </button>
          </div>

          {jathaLoading ? (
            <div className="spinner" style={{ margin:'2rem auto' }} />
          ) : jathaHistory.length === 0 ? (
            <div className="card" style={{ textAlign:'center', padding:'2rem', color:'var(--text-muted)' }}>No jatha records found.</div>
          ) : jathaHistory.map(r => (
            <div key={r.id} className="card mb-2" style={{ padding:'0.85rem 1rem' }}>
              {/* Header row */}
              <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:'0.5rem' }}>
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.25rem' }}>
                    <MapPin size={13} color="var(--gold)" />
                    <span style={{ fontWeight:700, fontSize:'0.92rem' }}>{r.jatha_centre}</span>
                    <span style={{ fontSize:'0.72rem', background:'var(--gold-bg)', color:'var(--gold)', border:'1px solid rgba(201,168,76,0.3)', borderRadius:999, padding:'1px 7px', fontWeight:700 }}>
                      {JATHA_TYPE_LABEL[r.jatha_type] || r.jatha_type}
                    </span>
                    {r.flag && (
                      <span style={{ fontSize:'0.72rem', background:'rgba(198,40,40,0.08)', color:'var(--red)', border:'1px solid rgba(198,40,40,0.25)', borderRadius:999, padding:'1px 7px', fontWeight:700, display:'flex', alignItems:'center', gap:3 }}>
                        <Flag size={10} /> Flagged
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>{r.jatha_dept}</div>
                </div>
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  <div style={{ fontSize:'0.82rem', fontWeight:600 }}>{fmtShort(r.date_from)} → {fmtShort(r.date_to)}</div>
                  <div style={{ fontSize:'0.75rem', color:'var(--green)', fontWeight:700 }}>{r.satsang_days} satsang {r.satsang_days === 1 ? 'day' : 'days'}</div>
                </div>
              </div>

              {/* Remarks & flag reason */}
              {r.remarks && (
                <div style={{ fontSize:'0.8rem', color:'var(--text-secondary)', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:6, padding:'0.4rem 0.65rem', marginTop:'0.4rem' }}>
                  {r.remarks}
                </div>
              )}
              {r.flag && r.flag_reason && (
                <div style={{ fontSize:'0.8rem', color:'var(--red)', background:'rgba(198,40,40,0.05)', border:'1px solid rgba(198,40,40,0.2)', borderRadius:6, padding:'0.4rem 0.65rem', marginTop:'0.4rem', display:'flex', gap:'0.4rem', alignItems:'flex-start' }}>
                  <Flag size={12} style={{ marginTop:2, flexShrink:0 }} /> {r.flag_reason}
                </div>
              )}

              {/* Submitted by */}
              <div style={{ fontSize:'0.74rem', color:'var(--text-muted)', marginTop:'0.5rem' }}>
                Submitted by {r.submitted_name || r.submitted_by} · {r.submitted_centre}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}