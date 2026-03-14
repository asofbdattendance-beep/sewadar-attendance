import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES, FLAG_TYPES } from '../lib/supabase'
import { Search, Download, Calendar, Filter, Flag, X, ChevronDown, Trash2 } from 'lucide-react'

export default function RecordsPage() {
  const { profile } = useAuth()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const [centreFilter, setCentreFilter] = useState('')
  const [centres, setCentres] = useState([])
  const [flagModal, setFlagModal] = useState(null)
  const [flagType, setFlagType] = useState('error_entry')
  const [flagNote, setFlagNote] = useState('')
  const [flagSubmitting, setFlagSubmitting] = useState(false)
  const [flagSuccess, setFlagSuccess] = useState(false)
  const [deleteMsg, setDeleteMsg] = useState('')

  const isAdmin = [ROLES.AREA_SECRETARY, ROLES.CENTRE_USER].includes(profile?.role)
  const isAreaSecretary = profile?.role === ROLES.AREA_SECRETARY

  useEffect(() => {
    fetchRecords()
    if (isAdmin) fetchCentres()
  }, [dateFilter, centreFilter])

  async function fetchCentres() {
    if (profile?.role === ROLES.AREA_SECRETARY) {
      const { data } = await supabase.from('centres').select('centre_name').order('centre_name')
      setCentres(data?.map(c => c.centre_name) || [])
    } else if (profile?.role === ROLES.CENTRE_USER) {
      const { data } = await supabase.from('centres').select('centre_name')
        .or(`centre_name.eq.${profile.centre},parent_centre.eq.${profile.centre}`).order('centre_name')
      setCentres(data?.map(c => c.centre_name) || [])
    }
  }

  async function fetchRecords() {
    setLoading(true)
    let query = supabase.from('attendance').select('*').order('scan_time', { ascending: false })

    if (dateFilter) {
      const start = new Date(dateFilter + 'T00:00:00'); const end = new Date(dateFilter + 'T23:59:59.999')
      query = query.gte('scan_time', start.toISOString()).lte('scan_time', end.toISOString())
    }

    if (profile?.role === ROLES.SC_SP_USER && profile?.centre) {
      query = query.eq('centre', profile.centre)
    } else if (profile?.role === ROLES.CENTRE_USER && !centreFilter) {
      const { data: childData } = await supabase.from('centres').select('centre_name')
        .or(`centre_name.eq.${profile.centre},parent_centre.eq.${profile.centre}`)
      const centreNames = childData?.map(c => c.centre_name) || [profile.centre]
      query = query.in('centre', centreNames)
    } else if (centreFilter) {
      query = query.eq('centre', centreFilter)
    }

    const { data } = await query.limit(500)

    // Group by badge + date
    const grouped = {}
    data?.forEach(r => {
      const date = new Date(r.scan_time).toISOString().split('T')[0]
      const key = `${r.badge_number}-${date}`
      if (!grouped[key]) {
        grouped[key] = {
          badge_number: r.badge_number, sewadar_name: r.sewadar_name,
          centre: r.centre, department: r.department, date,
          in_time: null, out_time: null, in_scanner: null, out_scanner: null,
          in_id: null, out_id: null, raw_in: null, raw_out: null,
        }
      }
      if (r.type === 'IN' && !grouped[key].in_time) {
        grouped[key].in_time = r.scan_time; grouped[key].in_scanner = r.scanner_name
        grouped[key].in_id = r.id; grouped[key].raw_in = r
      }
      if (r.type === 'OUT' && !grouped[key].out_time) {
        grouped[key].out_time = r.scan_time; grouped[key].out_scanner = r.scanner_name
        grouped[key].out_id = r.id; grouped[key].raw_out = r
      }
    })

    let filteredRecords = Object.values(grouped)
    if (searchTerm) {
      const term = searchTerm.toUpperCase()
      filteredRecords = filteredRecords.filter(r =>
        r.badge_number.includes(term) || r.sewadar_name.toUpperCase().includes(term)
      )
    }

    setRecords(filteredRecords)
    setLoading(false)
  }

  function exportToCSV() {
    const csv = [
      ['Badge Number','Name','Centre','Department','Date','IN Time','OUT Time','IN By','OUT By'].join(','),
      ...records.map(r => [
        r.badge_number, `"${r.sewadar_name}"`, r.centre, r.department||'', r.date,
        r.in_time ? new Date(r.in_time).toLocaleTimeString('en-IN') : '',
        r.out_time ? new Date(r.out_time).toLocaleTimeString('en-IN') : '',
        r.in_scanner||'', r.out_scanner||''
      ].join(','))
    ].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `attendance_${dateFilter || 'all'}.csv`; a.click()
  }

  async function deleteRecord(id, badge, type) {
    if (!id) return
    if (!confirm(`Delete ${type} record for ${badge}?\n\nThis cannot be undone.`)) return

    setDeleteMsg('')
    const { error, count } = await supabase
      .from('attendance')
      .delete({ count: 'exact' })
      .eq('id', id)

    if (error) {
      const msg = `✗ Delete failed: ${error.message}`
      setDeleteMsg(msg)
      console.error('deleteRecord error:', error)
      return
    }
    if (count === 0) {
      setDeleteMsg('✗ Delete was blocked by a Supabase RLS policy. In the Supabase dashboard go to Authentication → Policies → attendance table and add a DELETE policy for area_secretary role.')
      return
    }

    await supabase.from('logs').insert({
      user_badge: profile.badge_number, action: 'DELETE_ATTENDANCE',
      details: `Deleted ${type} id=${id} badge=${badge} from RecordsPage`,
      timestamp: new Date().toISOString()
    })
    fetchRecords()
  }

  async function submitFlag() {
    if (!flagModal || !profile) return
    setFlagSubmitting(true)
    const record = flagModal.raw_in || flagModal.raw_out
    await supabase.from('queries').insert({
      raised_by_badge: profile.badge_number, raised_by_name: profile.name,
      raised_by_centre: profile.centre, raised_by_role: profile.role,
      attendance_id: record?.id || null,
      issue_description: flagNote.trim() || FLAG_TYPES.find(f => f.value === flagType)?.label || flagType,
      flag_type: flagType, target_centre: flagModal.centre,
      status: 'open', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    await supabase.from('logs').insert({
      user_badge: profile.badge_number, action: 'RAISE_FLAG',
      details: `Flag raised on attendance for ${flagModal.badge_number} (${flagType})`,
      timestamp: new Date().toISOString()
    })
    setFlagSubmitting(false); setFlagSuccess(true)
    setTimeout(() => {
      setFlagModal(null); setFlagSuccess(false); setFlagType('error_entry'); setFlagNote('')
    }, 1500)
  }

  function formatTime(iso) {
    if (!iso) return '—'
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="page-wide pb-nav" style={{ maxWidth: 1100 }}>
      <div className="records-page-header">
        <div>
          <h2 className="records-page-title">Attendance Records</h2>
          <p className="records-page-sub">IN / OUT overview per sewadar per day</p>
        </div>
        <button className="btn-export" onClick={exportToCSV}><Download size={15}/> Export</button>
      </div>

      {/* Delete error banner */}
      {deleteMsg && (
        <div style={{
          background: deleteMsg.startsWith('✗') ? 'rgba(198,40,40,0.08)' : 'rgba(76,175,125,0.08)',
          border: `1px solid ${deleteMsg.startsWith('✗') ? 'rgba(198,40,40,0.3)' : 'rgba(76,175,125,0.3)'}`,
          borderRadius: 'var(--radius)', padding: '0.75rem 1rem', marginBottom: '1rem',
          color: deleteMsg.startsWith('✗') ? 'var(--red)' : 'var(--green)',
          fontSize: '0.84rem', display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'0.5rem'
        }}>
          <span>{deleteMsg}</span>
          <button onClick={() => setDeleteMsg('')} style={{ background:'none', border:'none', cursor:'pointer', color:'inherit', flexShrink:0 }}><X size={14}/></button>
        </div>
      )}

      {/* Filters */}
      <div className="records-filters">
        <div className="search-box">
          <Search size={15}/>
          <input type="text" placeholder="Search badge or name…" value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); fetchRecords() }}/>
        </div>
        <div className="filter-group">
          <Calendar size={15}/>
          <input type="date" value={dateFilter} onChange={e => setDateFilter(e.target.value)}/>
          {dateFilter && (
            <button onClick={() => setDateFilter('')} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', display:'flex' }}>
              <X size={14}/>
            </button>
          )}
        </div>
        {isAdmin && (
          <div className="filter-group">
            <Filter size={15}/>
            <select value={centreFilter} onChange={e => setCentreFilter(e.target.value)}>
              <option value="">All Centres</option>
              {centres.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center" style={{ padding:'3rem 0' }}><div className="spinner" style={{ margin:'0 auto' }}/></div>
      ) : (
        <div className="records-table-wrap">
          <table className="records-table">
            <thead>
              <tr>
                <th>Badge</th>
                <th>Name</th>
                {isAdmin && <th>Centre</th>}
                <th>Date</th>
                <th>IN</th>
                <th>OUT</th>
                <th>Status</th>
                <th style={{ width: isAreaSecretary ? 80 : 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontFamily:'monospace', color:'var(--gold)', fontSize:'0.82rem' }}>{r.badge_number}</td>
                  <td style={{ fontWeight:500 }}>{r.sewadar_name}</td>
                  {isAdmin && <td style={{ fontSize:'0.82rem', color:'var(--text-secondary)' }}>{r.centre}</td>}
                  <td style={{ fontSize:'0.82rem', color:'var(--text-muted)' }}>
                    {new Date(r.date + 'T12:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short' })}
                  </td>
                  <td><span className={`time-cell ${r.in_time ? 'has-time' : ''}`}>{formatTime(r.in_time)}</span></td>
                  <td><span className={`time-cell ${r.out_time ? 'has-time out-time' : ''}`}>{formatTime(r.out_time)}</span></td>
                  <td>
                    {r.in_time && r.out_time
                      ? <span className="status-complete">Complete</span>
                      : r.in_time ? <span className="status-in-only">IN only</span>
                      : r.out_time ? <span className="status-out-only">OUT only</span>
                      : <span className="status-none">—</span>}
                  </td>
                  <td>
                    <div style={{ display:'flex', gap:2, alignItems:'center' }}>
                      <button className="records-flag-btn" title="Raise flag"
                        onClick={() => { setFlagModal(r); setFlagType('error_entry'); setFlagNote('') }}>
                        <Flag size={13}/>
                      </button>
                      {isAreaSecretary && r.in_id && (
                        <button className="records-delete-btn" title="Delete IN record"
                          onClick={() => deleteRecord(r.in_id, r.badge_number, 'IN')}>
                          <Trash2 size={12}/><span style={{ fontSize:'0.65rem', marginLeft:1 }}>IN</span>
                        </button>
                      )}
                      {isAreaSecretary && r.out_id && (
                        <button className="records-delete-btn" title="Delete OUT record"
                          onClick={() => deleteRecord(r.out_id, r.badge_number, 'OUT')}>
                          <Trash2 size={12}/><span style={{ fontSize:'0.65rem', marginLeft:1 }}>OUT</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ textAlign:'center', padding:'2.5rem', color:'var(--text-muted)' }}>
                    No records found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Flag Modal */}
      {flagModal && (
        <div className="overlay" onClick={() => { setFlagModal(null); setFlagSuccess(false) }}>
          <div className="overlay-sheet flag-modal" onClick={e => e.stopPropagation()}>
            {flagSuccess ? (
              <div style={{ textAlign:'center', padding:'1.5rem 0' }}>
                <div style={{ width:52, height:52, background:'var(--green-bg)', borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 1rem' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <p style={{ fontWeight:600, color:'var(--green)' }}>Flag raised successfully</p>
              </div>
            ) : (
              <>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1.25rem' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                    <Flag size={18} color="var(--red)"/><h3 style={{ fontSize:'1rem', fontWeight:700 }}>Raise Flag</h3>
                  </div>
                  <button onClick={() => setFlagModal(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)' }}><X size={18}/></button>
                </div>
                <div className="flag-modal-record">
                  <div className="flag-modal-record-name">{flagModal.sewadar_name}</div>
                  <div className="flag-modal-record-meta">
                    <span style={{ fontFamily:'monospace', color:'var(--gold)' }}>{flagModal.badge_number}</span>
                    <span>·</span>
                    <span>{new Date(flagModal.date + 'T12:00:00').toLocaleDateString('en-IN', { day:'2-digit', month:'short' })}</span>
                    {flagModal.in_time && <><span>·</span><span className="flag-modal-in">IN {formatTime(flagModal.in_time)}</span></>}
                    {flagModal.out_time && <><span>·</span><span className="flag-modal-out">OUT {formatTime(flagModal.out_time)}</span></>}
                  </div>
                </div>
                <div style={{ marginBottom:'1rem' }}>
                  <label className="label">Reason</label>
                  <div style={{ position:'relative' }}>
                    <select className="input" value={flagType} onChange={e => setFlagType(e.target.value)} style={{ appearance:'none', paddingRight:'2.5rem' }}>
                      {FLAG_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    <ChevronDown size={16} style={{ position:'absolute', right:'0.85rem', top:'50%', transform:'translateY(-50%)', pointerEvents:'none', color:'var(--text-muted)' }}/>
                  </div>
                </div>
                <div style={{ marginBottom:'1.25rem' }}>
                  <label className="label">Additional note <span style={{ fontWeight:400, textTransform:'none', letterSpacing:0, color:'var(--text-muted)' }}>(optional)</span></label>
                  <textarea className="input" rows={3} placeholder="Add any extra details…" value={flagNote}
                    onChange={e => setFlagNote(e.target.value)} style={{ resize:'none' }}/>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                  <button className="btn btn-outline btn-full" onClick={() => setFlagModal(null)}>Cancel</button>
                  <button className="btn btn-full flag-submit-btn" onClick={submitFlag} disabled={flagSubmitting}>
                    {flagSubmitting ? 'Submitting…' : 'Submit Flag'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}