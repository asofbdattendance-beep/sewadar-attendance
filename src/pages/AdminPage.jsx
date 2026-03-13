import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES } from '../lib/supabase'
import { Search, Flag, CheckCircle, Clock, AlertCircle } from 'lucide-react'

export default function AdminPage() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('queries')
  const [queries, setQueries] = useState([])
  const [searchBadge, setSearchBadge] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [selectedRecord, setSelectedRecord] = useState(null)
  const [queryNote, setQueryNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [flaggedAttendance, setFlaggedAttendance] = useState([])

  const isAdmin = [ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(profile?.role)

  useEffect(() => {
    if (tab === 'queries') fetchQueries()
  }, [tab])

  async function fetchQueries() {
    setLoading(true)
    const { data: queriesData } = await supabase
      .from('queries')
      .select(`*, attendance(*)`)
      .order('created_at', { ascending: false })

    let filteredQueries = queriesData || []
    
    if (profile.role === ROLES.ADMIN && profile.centre) {
      filteredQueries = filteredQueries.filter(q => q.attendance?.centre === profile.centre)
    }

    setQueries(filteredQueries)
    setLoading(false)
  }

  async function searchAttendance() {
    if (!searchBadge.trim()) return
    setLoading(true)
    const { data } = await supabase
      .from('attendance')
      .select('*')
      .eq('badge_number', searchBadge.trim().toUpperCase())
      .order('scan_time', { ascending: false })
      .limit(50)
    setSearchResults(data || [])
    setLoading(false)
  }

  async function raiseQuery(attendanceId) {
    if (!queryNote.trim()) return
    await supabase.from('queries').insert({
      raised_by_badge: profile.badge_number,
      raised_by_name: profile.name,
      attendance_id: attendanceId,
      issue_description: queryNote,
      status: 'open',
      created_at: new Date().toISOString()
    })
    await supabase.from('logs').insert({
      user_badge: profile.badge_number,
      action: 'RAISE_QUERY',
      details: `Query raised on attendance ${attendanceId}: ${queryNote}`,
      timestamp: new Date().toISOString()
    })
    setQueryNote('')
    setSelectedRecord(null)
    alert('Query raised successfully.')
  }

  async function resolveQuery(queryId) {
    await supabase.from('queries').update({ status: 'resolved', resolved_at: new Date().toISOString(), resolved_by: profile.badge_number }).eq('id', queryId)
    fetchQueries()
  }

  function timeFmt(iso) {
    return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="page-wide pb-nav" style={{ maxWidth: 800 }}>
      <div className="mt-2 mb-3">
        <h2 style={{ fontFamily: 'Cinzel, serif', color: 'var(--gold)', fontSize: '1.2rem' }}>
          Admin Panel
        </h2>
      </div>

      <div className="tab-nav">
        <button className={`tab-btn ${tab === 'queries' ? 'active' : ''}`} onClick={() => setTab('queries')}>
          <Flag size={14} /> Queries
        </button>
        <button className={`tab-btn ${tab === 'search' ? 'active' : ''}`} onClick={() => setTab('search')}>
          <Search size={14} /> Search Badge
        </button>
        {profile?.role === ROLES.SUPER_ADMIN && (
          <button className={`tab-btn ${tab === 'logs' ? 'active' : ''}`} onClick={() => setTab('logs')}>
            <Clock size={14} /> Logs
          </button>
        )}
      </div>

      {/* Queries Tab */}
      {tab === 'queries' && (
        <div>
          {queries.length === 0 ? (
            <div className="card text-center" style={{ padding: '3rem' }}>
              <CheckCircle size={40} color="var(--green)" style={{ margin: '0 auto 1rem' }} />
              <p className="text-secondary">No open queries</p>
            </div>
          ) : (
            queries.map(q => (
              <div key={q.id} className="card mb-2" style={{ borderColor: q.status === 'open' ? 'rgba(224,92,92,0.3)' : 'var(--border)' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`badge ${q.status === 'open' ? 'badge-red' : 'badge-green'}`}>
                    {q.status}
                  </span>
                  <span className="text-muted text-xs">{timeFmt(q.created_at)}</span>
                </div>
                <p style={{ fontWeight: 500, marginBottom: '0.5rem' }}>{q.issue_description}</p>
                <p className="text-muted text-xs">Raised by: {q.raised_by_name} ({q.raised_by_badge})</p>
                {q.attendance && (
                  <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '0.75rem', marginTop: '0.75rem' }}>
                    <p className="text-xs text-secondary">
                      {q.attendance.sewadar_name} · {q.attendance.badge_number} · {q.attendance.type} · {timeFmt(q.attendance.scan_time)}
                    </p>
                  </div>
                )}
                {q.status === 'open' && isAdmin && (
                  <button className="btn btn-outline mt-2" style={{ fontSize: '0.8rem', padding: '0.4rem 1rem' }} onClick={() => resolveQuery(q.id)}>
                    Mark Resolved
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Search Tab */}
      {tab === 'search' && (
        <div>
          <div className="flex gap-1 mb-3">
            <input
              className="input"
              placeholder="Enter badge number e.g. FB5978GA0001"
              value={searchBadge}
              onChange={e => setSearchBadge(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && searchAttendance()}
              style={{ textTransform: 'uppercase' }}
            />
            <button className="btn btn-gold" onClick={searchAttendance}>
              <Search size={16} />
            </button>
          </div>

          {loading && <div className="text-center mt-3"><div className="spinner" style={{ margin: '0 auto' }} /></div>}

          {searchResults.length > 0 && (
            <>
              <p className="text-muted text-xs mb-2">{searchResults.length} records found for {searchBadge.toUpperCase()}</p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date/Time</th>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Scanner</th>
                      {isAdmin && <th>Flag</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {searchResults.map(r => (
                      <tr key={r.id}>
                        <td style={{ fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{timeFmt(r.scan_time)}</td>
                        <td style={{ fontWeight: 500 }}>{r.sewadar_name}</td>
                        <td><span className={`badge ${r.type === 'IN' ? 'badge-green' : 'badge-red'}`}>{r.type}</span></td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{r.scanner_name}</td>
                        {isAdmin && (
                          <td>
                            <button
                              className="btn btn-ghost"
                              style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: 'var(--red)' }}
                              onClick={() => setSelectedRecord(r)}
                            >
                              <Flag size={12} /> Flag
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {searchResults.length === 0 && searchBadge && !loading && (
            <div className="card text-center" style={{ padding: '2rem' }}>
              <p className="text-muted">No attendance records found for this badge.</p>
            </div>
          )}
        </div>
      )}

      {/* Logs Tab (Super Admin only) */}
      {tab === 'logs' && profile?.role === ROLES.SUPER_ADMIN && (
        <LogsTab />
      )}

      {/* Raise Query Modal */}
      {selectedRecord && (
        <div className="overlay" onClick={() => setSelectedRecord(null)}>
          <div className="overlay-sheet" onClick={e => e.stopPropagation()}>
            <h3 style={{ fontFamily: 'Cinzel, serif', color: 'var(--gold)', marginBottom: '1rem' }}>Raise Query</h3>
            <div className="card mb-2" style={{ padding: '1rem' }}>
              <p style={{ fontWeight: 500 }}>{selectedRecord.sewadar_name}</p>
              <p className="text-muted text-sm">{selectedRecord.badge_number} · {selectedRecord.type} · {timeFmt(selectedRecord.scan_time)}</p>
            </div>
            <label className="label">Describe the issue</label>
            <textarea
              className="input"
              rows={3}
              placeholder="e.g. Sewadar was not present, badge may have been misused..."
              value={queryNote}
              onChange={e => setQueryNote(e.target.value)}
              style={{ resize: 'none', marginBottom: '1rem' }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <button className="btn btn-outline btn-full" onClick={() => setSelectedRecord(null)}>Cancel</button>
              <button className="btn btn-gold btn-full" onClick={() => raiseQuery(selectedRecord.id)}>Submit Query</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LogsTab() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('logs').select('*').order('timestamp', { ascending: false }).limit(100)
      .then(({ data }) => { setLogs(data || []); setLoading(false) })
  }, [])

  if (loading) return <div className="spinner" style={{ margin: '2rem auto' }} />

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>User</th>
            <th>Action</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {logs.map(l => (
            <tr key={l.id}>
              <td style={{ fontSize: '0.78rem', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                {new Date(l.timestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </td>
              <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--gold)' }}>{l.user_badge}</td>
              <td><span className="badge badge-muted" style={{ fontSize: '0.7rem' }}>{l.action}</span></td>
              <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{l.details}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
