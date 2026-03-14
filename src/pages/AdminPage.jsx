// AdminPage.jsx — Unified Sewadar History
// Search once, see both daily attendance and jatha history in one place with combined export

import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES, JATHA_TYPE_LABEL } from '../lib/supabase'
import { Search, Calendar, Download, User, LogIn, LogOut, Flag, MapPin, Plane, Activity } from 'lucide-react'

export default function AdminPage() {
  const { profile } = useAuth()

  const [searchTerm, setSearchTerm]       = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching]         = useState(false)
  const [selected, setSelected]           = useState(null)

  const [dateRange, setDateRange]         = useState({ from: '', to: '' })

  // Both datasets loaded together
  const [history, setHistory]             = useState([])      // daily attendance rows
  const [jathaHistory, setJathaHistory]   = useState([])      // jatha_attendance rows
  const [loadingData, setLoadingData]     = useState(false)

  const isAdminOrAbove = [ROLES.ASO, ROLES.CENTRE_USER].includes(profile?.role)
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

  async function loadBothHistories(sewadar) {
    setSelected(sewadar)
    setSearchResults([])
    setLoadingData(true)
    setHistory([])
    setJathaHistory([])

    // Attendance query
    let attQ = supabase.from('attendance').select('*')
      .eq('badge_number', sewadar.badge_number)
      .order('scan_time', { ascending: false }).limit(500)
    if (dateRange.from) { const s = new Date(dateRange.from); s.setHours(0,0,0,0); attQ = attQ.gte('scan_time', s.toISOString()) }
    if (dateRange.to)   { const e = new Date(dateRange.to);   e.setHours(23,59,59,999); attQ = attQ.lte('scan_time', e.toISOString()) }

    // Jatha query
    let jathaQ = supabase.from('jatha_attendance').select('*')
      .eq('badge_number', sewadar.badge_number)
      .order('date_from', { ascending: false }).limit(200)
    if (dateRange.from) jathaQ = jathaQ.gte('date_from', dateRange.from)
    if (dateRange.to)   jathaQ = jathaQ.lte('date_to', dateRange.to)

    const [attRes, jathaRes] = await Promise.all([attQ, jathaQ])
    setHistory(attRes.data || [])
    setJathaHistory(jathaRes.data || [])
    setLoadingData(false)
  }

  function exportCombined() {
    if (!selected) return
    const rows = []

    // Daily attendance section
    rows.push(['=== DAILY ATTENDANCE ==='])
    rows.push(['Date','Time','Type','Scanned At','Scanned By','Scanner Centre'])
    history.forEach(r => {
      rows.push([
        new Date(r.scan_time).toLocaleDateString('en-IN'),
        new Date(r.scan_time).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }),
        r.type, r.centre, r.scanner_name || '', r.scanner_centre || ''
      ])
    })

    rows.push([])  // blank separator

    // Jatha section
    rows.push(['=== JATHA HISTORY ==='])
    rows.push(['Jatha Type','Destination','Department','From','To','Days Total','Satsang Days','Remarks','Flagged','Flag Reason','Submitted By'])
    jathaHistory.forEach(r => {
      const from = new Date(r.date_from + 'T12:00:00')
      const to   = new Date(r.date_to   + 'T12:00:00')
      const totalDays = Math.round((to - from) / 86400000) + 1
      rows.push([
        JATHA_TYPE_LABEL[r.jatha_type] || r.jatha_type,
        r.jatha_centre, r.jatha_dept,
        r.date_from, r.date_to,
        totalDays, r.satsang_days,
        `"${r.remarks || ''}"`,
        r.flag ? 'Yes' : 'No',
        `"${r.flag_reason || ''}"`,
        r.submitted_name || r.submitted_by
      ])
    })

    const csv = rows.map(r => Array.isArray(r) ? r.join(',') : r).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type:'text/csv' }))
    a.download = `sewadar_history_${selected.badge_number}.csv`; a.click()
  }

  // ── Derived stats ──
  const byDate = {}
  history.forEach(r => {
    const d = new Date(r.scan_time).toISOString().split('T')[0]
    if (!byDate[d]) byDate[d] = []
    byDate[d].push(r)
  })
  const dates = Object.keys(byDate).sort((a,b) => b.localeCompare(a))

  // Count distinct satsang days (Sun/Wed) in daily attendance
  const satsangDaysAttended = dates.filter(d => {
    const day = new Date(d + 'T12:00:00').getDay()
    return day === 0 || day === 3
  }).length

  const totalJathas = jathaHistory.length
  const totalJathaSatsangDays = jathaHistory.reduce((acc, r) => acc + (r.satsang_days || 0), 0)
  const combinedSatsangDays = satsangDaysAttended + totalJathaSatsangDays

  function fmt(iso)    { return new Date(iso).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }) }
  function fmtD(d)     { return new Date(d+'T12:00:00').toLocaleDateString('en-IN', { weekday:'short', day:'2-digit', month:'short', year:'numeric' }) }
  function fmtShort(d) { return new Date(d+'T12:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) }
  function isSatsang(d) { const day = new Date(d+'T12:00:00').getDay(); return day === 0 || day === 3 }

  return (
    <div className="page-wide pb-nav" style={{ maxWidth: 860 }}>
      <div className="mt-2 mb-3">
        <h2 style={{ fontFamily:'Cinzel, serif', color:'var(--gold)', fontSize:'1.2rem' }}>Sewadar History</h2>
        <p className="text-muted text-xs mt-1">Full trail — daily attendance + jatha combined</p>
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

      {/* Search results */}
      {searchResults.length > 0 && (
        <div className="card mb-3" style={{ padding:0, overflow:'hidden' }}>
          {searchResults.map((s,i) => (
            <button key={s.badge_number} onClick={() => loadBothHistories(s)}
              style={{
                display:'flex', width:'100%', alignItems:'center', justifyContent:'space-between',
                padding:'0.75rem 1rem', background: selected?.badge_number === s.badge_number ? 'var(--gold-bg)' : 'none',
                border:'none', borderBottom: i < searchResults.length-1 ? '1px solid var(--border)' : 'none',
                cursor:'pointer', textAlign:'left', fontFamily:'Inter, sans-serif'
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

      {/* Date range filter */}
      {selected && (
        <div style={{ display:'flex', gap:'0.6rem', marginBottom:'1rem', flexWrap:'wrap', alignItems:'center' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', background:'var(--bg)', border:'1px solid var(--border)', borderRadius:'var(--radius)', padding:'0.35rem 0.75rem', flex:1 }}>
            <Calendar size={13} color="var(--text-muted)" />
            <input type="date" value={dateRange.from} onChange={e => setDateRange({...dateRange, from:e.target.value})}
              style={{ border:'none', background:'none', color:'var(--text-primary)', fontSize:'0.82rem', outline:'none' }} />
            <span style={{ color:'var(--text-muted)', fontSize:'0.82rem' }}>→</span>
            <input type="date" value={dateRange.to} onChange={e => setDateRange({...dateRange, to:e.target.value})}
              style={{ border:'none', background:'none', color:'var(--text-primary)', fontSize:'0.82rem', outline:'none' }} />
          </div>
          <button className="btn btn-outline" onClick={() => loadBothHistories(selected)} style={{ fontSize:'0.82rem' }}>Apply</button>
          <button className="btn btn-ghost" onClick={exportCombined} style={{ padding:'0.4rem 0.75rem', fontSize:'0.82rem' }}>
            <Download size={14} /> Export All
          </button>
        </div>
      )}

      {/* Profile + Combined stats strip */}
      {selected && (
        <div className="card mb-3" style={{ padding:'0.85rem 1rem' }}>
          <div style={{ display:'flex', alignItems:'center', gap:'1rem', marginBottom: (dates.length > 0 || totalJathas > 0) ? '0.85rem' : 0 }}>
            <div style={{ width:44, height:44, borderRadius:'50%', background:'var(--gold-bg)', border:'1px solid var(--gold-border)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <User size={20} color="var(--gold)" />
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, fontSize:'1rem' }}>{selected.sewadar_name}</div>
              <div style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>{selected.badge_number} · {selected.centre} · {selected.department || '—'}</div>
            </div>
          </div>

          {!loadingData && (dates.length > 0 || totalJathas > 0) && (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'0.6rem' }}>
              <div style={{ background:'var(--bg)', borderRadius:8, padding:'0.6rem', textAlign:'center', border:'1px solid var(--border)' }}>
                <div style={{ fontSize:'1.3rem', fontWeight:800, color:'var(--text-primary)' }}>{dates.length}</div>
                <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>Duty Days</div>
              </div>
              <div style={{ background:'var(--bg)', borderRadius:8, padding:'0.6rem', textAlign:'center', border:'1px solid var(--border)' }}>
                <div style={{ fontSize:'1.3rem', fontWeight:800, color:'var(--green)' }}>{satsangDaysAttended}</div>
                <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>Satsang Days</div>
              </div>
              <div style={{ background:'var(--bg)', borderRadius:8, padding:'0.6rem', textAlign:'center', border:'1px solid var(--border)' }}>
                <div style={{ fontSize:'1.3rem', fontWeight:800, color:'var(--gold)' }}>{totalJathas}</div>
                <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>Jathas</div>
              </div>
              <div style={{ background:'var(--gold-bg)', borderRadius:8, padding:'0.6rem', textAlign:'center', border:'1px solid rgba(201,168,76,0.3)' }}>
                <div style={{ fontSize:'1.3rem', fontWeight:800, color:'var(--gold)' }}>{combinedSatsangDays}</div>
                <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em' }}>Total Satsang</div>
              </div>
            </div>
          )}
        </div>
      )}

      {loadingData && <div className="spinner" style={{ margin:'2rem auto' }} />}

      {/* ── Daily Attendance Timeline ── */}
      {!loadingData && selected && (
        <>
          {dates.length > 0 && (
            <div style={{ marginBottom:'1.5rem' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.75rem' }}>
                <Activity size={14} color="var(--text-muted)" />
                <span style={{ fontSize:'0.8rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-muted)' }}>Daily Attendance</span>
                <span style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>({dates.length} days)</span>
              </div>
              {dates.map(date => {
                const entries = byDate[date]
                const hasIn = entries.some(r => r.type === 'IN')
                const hasOut = entries.some(r => r.type === 'OUT')
                const isSat = isSatsang(date)
                return (
                  <div key={date} className="card mb-2" style={{ padding:'0.75rem 1rem', borderLeft: isSat ? '3px solid var(--green)' : '3px solid transparent' }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.5rem' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                        <Calendar size={13} color="var(--text-muted)" />
                        <span style={{ fontWeight:600, fontSize:'0.88rem' }}>{fmtD(date)}</span>
                        {isSat && <span style={{ fontSize:'0.68rem', background:'rgba(76,175,125,0.12)', color:'var(--green)', border:'1px solid rgba(76,175,125,0.3)', borderRadius:999, padding:'1px 6px', fontWeight:700 }}>Satsang</span>}
                      </div>
                      <div style={{ display:'flex', gap:'0.3rem' }}>
                        {hasIn  && <span className="badge badge-green">IN</span>}
                        {hasOut && <span className="badge badge-red">OUT</span>}
                      </div>
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem' }}>
                      {entries.map(r => (
                        <div key={r.id} style={{ display:'flex', alignItems:'center', gap:'0.75rem', fontSize:'0.82rem' }}>
                          {r.type === 'IN' ? <LogIn size={13} color="var(--green)" /> : <LogOut size={13} color="var(--red)" />}
                          <span style={{ fontWeight:600, color: r.type === 'IN' ? 'var(--green)' : 'var(--red)', minWidth:28 }}>{r.type}</span>
                          <span style={{ color:'var(--text-primary)' }}>{fmt(r.scan_time)}</span>
                          {r.scanner_centre && r.scanner_centre !== selected.centre && (
                            <span style={{ color:'var(--text-muted)', fontSize:'0.78rem' }}>at {r.scanner_centre}</span>
                          )}
                          <span style={{ color:'var(--text-muted)', marginLeft:'auto', fontSize:'0.78rem' }}>by {r.scanner_name || '—'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Jatha History ── */}
          {jathaHistory.length > 0 && (
            <div>
              <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.75rem' }}>
                <Plane size={14} color="var(--text-muted)" />
                <span style={{ fontSize:'0.8rem', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.08em', color:'var(--text-muted)' }}>Jatha History</span>
                <span style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>({totalJathas} jathas · {totalJathaSatsangDays} satsang days)</span>
              </div>
              {jathaHistory.map(r => {
                const from = new Date(r.date_from + 'T12:00:00')
                const to   = new Date(r.date_to   + 'T12:00:00')
                const totalDays = Math.round((to - from) / 86400000) + 1
                return (
                  <div key={r.id} className="card mb-2" style={{ padding:'0.85rem 1rem', borderLeft:'3px solid var(--gold)' }}>
                    <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:'0.4rem' }}>
                      <div>
                        <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', marginBottom:'0.2rem' }}>
                          <MapPin size={13} color="var(--gold)" />
                          <span style={{ fontWeight:700, fontSize:'0.92rem' }}>{r.jatha_centre}</span>
                          <span style={{ fontSize:'0.7rem', background:'var(--gold-bg)', color:'var(--gold)', border:'1px solid rgba(201,168,76,0.3)', borderRadius:999, padding:'1px 7px', fontWeight:700 }}>
                            {JATHA_TYPE_LABEL[r.jatha_type] || r.jatha_type}
                          </span>
                          {r.flag && (
                            <span style={{ fontSize:'0.7rem', background:'rgba(198,40,40,0.08)', color:'var(--red)', border:'1px solid rgba(198,40,40,0.25)', borderRadius:999, padding:'1px 7px', fontWeight:700, display:'flex', alignItems:'center', gap:3 }}>
                              <Flag size={10} /> Flagged
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize:'0.8rem', color:'var(--text-muted)' }}>{r.jatha_dept}</div>
                      </div>
                      <div style={{ textAlign:'right', flexShrink:0 }}>
                        <div style={{ fontSize:'0.82rem', fontWeight:600 }}>{fmtShort(r.date_from)} → {fmtShort(r.date_to)}</div>
                        <div style={{ fontSize:'0.75rem', color:'var(--text-muted)' }}>{totalDays} days total</div>
                        <div style={{ fontSize:'0.75rem', color:'var(--green)', fontWeight:700 }}>{r.satsang_days} satsang {r.satsang_days === 1 ? 'day' : 'days'}</div>
                      </div>
                    </div>
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
                    <div style={{ fontSize:'0.74rem', color:'var(--text-muted)', marginTop:'0.4rem' }}>
                      Submitted by {r.submitted_name || r.submitted_by} · {r.submitted_centre}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {dates.length === 0 && jathaHistory.length === 0 && (
            <div className="card" style={{ textAlign:'center', padding:'2.5rem', color:'var(--text-muted)' }}>
              No records found for this sewadar in the selected range.
            </div>
          )}
        </>
      )}

      {!selected && !searchResults.length && (
        <div style={{ textAlign:'center', padding:'3rem 0', color:'var(--text-muted)' }}>
          <User size={36} style={{ margin:'0 auto 0.75rem', opacity:0.3 }} />
          <p style={{ fontSize:'0.9rem' }}>Search for a sewadar to view their complete history</p>
        </div>
      )}
    </div>
  )
}