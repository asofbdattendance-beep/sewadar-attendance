import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Users, LogIn, LogOut, Activity, RefreshCw, Clock, Calendar, Download, Filter } from 'lucide-react'

export default function DashboardPage() {
  const { profile } = useAuth()
  const [stats, setStats] = useState({ total: 0, ins: 0, outs: 0, insideNow: 0 })
  const [centreStats, setCentreStats] = useState([])
  const [recentScans, setRecentScans] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(new Date())

  // Filters
  const today = new Date().toISOString().split('T')[0]
  const [dateFrom, setDateFrom] = useState(today)
  const [dateTo, setDateTo] = useState(today)
  const [sessionFilter, setSessionFilter] = useState('')
  const [centreFilter, setCentreFilter] = useState('')
  const [sessions, setSessions] = useState([])
  const [viewableCentres, setViewableCentres] = useState([])

  const isSuperAdmin = profile?.role === ROLES.SUPER_ADMIN
  const isAdmin = profile?.role === ROLES.ADMIN
  const isAdminOrAbove = isSuperAdmin || isAdmin

  useEffect(() => {
    if (isAdminOrAbove) fetchSessions()
    if (isAdminOrAbove) fetchViewableCentres()
  }, [profile])

  useEffect(() => {
    fetchData()
    // Realtime subscription
    const channel = supabase.channel('dashboard-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance' }, fetchData)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'attendance' }, fetchData)
      .subscribe()
    const interval = setInterval(fetchData, 30000)
    return () => { supabase.removeChannel(channel); clearInterval(interval) }
  }, [profile, dateFrom, dateTo, sessionFilter, centreFilter])

  async function fetchSessions() {
    const { data } = await supabase.from('sessions').select('id,name,date').order('date', { ascending: false }).limit(30)
    setSessions(data || [])
  }

  async function fetchViewableCentres() {
    if (isSuperAdmin) {
      const { data } = await supabase.from('centres').select('centre_name').order('centre_name')
      setViewableCentres(data?.map(c => c.centre_name) || [])
    } else if (isAdmin) {
      const { data } = await supabase.from('centres').select('centre_name')
        .or(`centre_name.eq.${profile.centre},parent_centre.eq.${profile.centre}`)
      setViewableCentres(data?.map(c => c.centre_name) || [])
    }
  }

  async function fetchData() {
    const start = new Date(dateFrom); start.setHours(0, 0, 0, 0)
    const end = new Date(dateTo); end.setHours(23, 59, 59, 999)

    let query = supabase.from('attendance').select('*')
      .gte('scan_time', start.toISOString())
      .lte('scan_time', end.toISOString())
      .order('scan_time', { ascending: false })

    // Scope by role
    if (!isAdminOrAbove && profile?.centre) {
      query = query.eq('centre', profile.centre)
    } else if (isAdmin && !centreFilter) {
      const { data: childData } = await supabase.from('centres').select('centre_name')
        .or(`centre_name.eq.${profile.centre},parent_centre.eq.${profile.centre}`)
      const centreNames = childData?.map(c => c.centre_name) || [profile.centre]
      query = query.in('centre', centreNames)
    } else if (centreFilter) {
      query = query.eq('centre', centreFilter)
    }

    if (sessionFilter) query = query.eq('session_id', sessionFilter)

    const { data } = await query.limit(1000)
    if (!data) { setLoading(false); return }

    const ins = data.filter(r => r.type === 'IN')
    const outs = data.filter(r => r.type === 'OUT')

    // "Currently inside" = for each badge, if latest record today is IN
    const latestByBadge = {}
    data.forEach(r => {
      if (!latestByBadge[r.badge_number] || new Date(r.scan_time) > new Date(latestByBadge[r.badge_number].scan_time)) {
        latestByBadge[r.badge_number] = r
      }
    })
    const insideNow = Object.values(latestByBadge).filter(r => r.type === 'IN').length

    setStats({ total: data.length, ins: ins.length, outs: outs.length, insideNow })
    setRecentScans(data.slice(0, 30))

    if (isAdminOrAbove) {
      const centreMap = {}
      data.forEach(r => {
        if (!centreMap[r.centre]) centreMap[r.centre] = { centre: r.centre, in: 0, out: 0 }
        if (r.type === 'IN') centreMap[r.centre].in++
        else centreMap[r.centre].out++
      })
      setCentreStats(Object.values(centreMap).sort((a, b) => (b.in + b.out) - (a.in + a.out)).slice(0, 12))
    }

    setLoading(false)
    setLastRefresh(new Date())
  }

  function exportCSV() {
    const rows = recentScans.map(r => [
      `"${r.sewadar_name}"`, r.badge_number, r.centre, r.department||'', r.type,
      new Date(r.scan_time).toLocaleString('en-IN'), r.scanner_name||''
    ].join(','))
    const csv = ['Name,Badge,Centre,Dept,Type,Time,Scanned By', ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `attendance_${dateFrom}_to_${dateTo}.csv`; a.click()
  }

  function timeFmt(iso) {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  function dateFmt(iso) {
    return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
  }

  const isMultiDay = dateFrom !== dateTo

  return (
    <div className="page-wide pb-nav" style={{ maxWidth: 960 }}>
      {/* Header */}
      <div className="flex items-center justify-between mt-2 mb-3">
        <div>
          <h2 style={{ fontFamily: 'Cinzel, serif', color: 'var(--gold)', fontSize: '1.2rem' }}>Dashboard</h2>
          <p className="text-muted text-xs mt-1 flex items-center gap-1">
            <Clock size={12} /> Refreshed {lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-ghost" onClick={exportCSV} style={{ padding: '0.4rem 0.75rem', fontSize: '0.82rem' }}>
            <Download size={14} /> Export
          </button>
          <button className="btn btn-ghost" onClick={fetchData} style={{ padding: '0.5rem' }}>
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.35rem 0.75rem' }}>
          <Calendar size={13} color="var(--text-muted)" />
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            style={{ border: 'none', background: 'none', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none' }} />
          <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>→</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            style={{ border: 'none', background: 'none', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none' }} />
        </div>

        {isAdminOrAbove && sessions.length > 0 && (
          <select value={sessionFilter} onChange={e => setSessionFilter(e.target.value)}
            style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.35rem 0.75rem', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: '0.82rem' }}>
            <option value="">All Sessions</option>
            {sessions.map(s => <option key={s.id} value={s.id}>{s.name} ({new Date(s.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })})</option>)}
          </select>
        )}

        {isAdminOrAbove && viewableCentres.length > 1 && (
          <select value={centreFilter} onChange={e => setCentreFilter(e.target.value)}
            style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.35rem 0.75rem', background: 'var(--bg)', color: 'var(--text-primary)', fontSize: '0.82rem' }}>
            <option value="">All Centres</option>
            {viewableCentres.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}>
          <div className="text-center"><div className="spinner" style={{ margin: '0 auto 1rem' }} /><p className="text-muted text-sm">Loading…</p></div>
        </div>
      ) : (
        <>
          {/* Stats cards */}
          <div className="stats-grid-3 mb-3" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="stat-card" style={{ borderColor: 'rgba(201,168,76,0.3)' }}>
              <div className="stat-number">{stats.total}</div>
              <div className="stat-label">Total Scans</div>
            </div>
            <div className="stat-card" style={{ borderColor: 'rgba(76,175,125,0.3)' }}>
              <div className="stat-number" style={{ color: 'var(--green)' }}>{stats.ins}</div>
              <div className="stat-label">IN</div>
            </div>
            <div className="stat-card" style={{ borderColor: 'rgba(224,92,92,0.3)' }}>
              <div className="stat-number" style={{ color: 'var(--red)' }}>{stats.outs}</div>
              <div className="stat-label">OUT</div>
            </div>
            <div className="stat-card" style={{ borderColor: 'rgba(100,149,237,0.3)' }}>
              <div className="stat-number" style={{ color: 'var(--blue)' }}>{stats.insideNow}</div>
              <div className="stat-label">Inside Now</div>
            </div>
          </div>

          {/* Centre chart */}
          {isAdminOrAbove && centreStats.length > 0 && (
            <div className="card mb-3">
              <h3 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Centre-wise · {isMultiDay ? `${dateFmt(dateFrom)} – ${dateFmt(dateTo)}` : dateFmt(dateFrom)}
                {sessionFilter && sessions.find(s => s.id === sessionFilter) && ` · ${sessions.find(s => s.id === sessionFilter).name}`}
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={centreStats} margin={{ top: 0, right: 0, left: -20, bottom: 40 }}>
                  <XAxis dataKey="centre" tick={{ fill: '#5a5570', fontSize: 10 }} angle={-35} textAnchor="end" />
                  <YAxis tick={{ fill: '#5a5570', fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8 }} labelStyle={{ color: 'var(--text-primary)' }} />
                  <Bar dataKey="in" name="IN" fill="var(--green)" radius={[4,4,0,0]} />
                  <Bar dataKey="out" name="OUT" fill="var(--red)" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Live feed */}
          <div className="card">
            <div className="flex items-center gap-2 mb-2">
              <span className="pulse-dot green" />
              <h3 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Scan Feed {recentScans.length >= 30 && <span style={{ fontWeight: 400, textTransform: 'none', fontSize: '0.75rem', color: 'var(--text-muted)' }}>(latest 30)</span>}
              </h3>
            </div>
            {recentScans.length === 0 ? (
              <p className="text-muted text-sm text-center" style={{ padding: '2rem 0' }}>No scans in this range.</p>
            ) : (
              <div className="table-wrap" style={{ border: 'none' }}>
                <table>
                  <thead>
                    <tr>
                      {isMultiDay && <th>Date</th>}
                      <th>Time</th>
                      <th>Name</th>
                      <th>Badge</th>
                      {isAdminOrAbove && <th>Centre</th>}
                      <th>Dept</th>
                      <th>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentScans.map(r => (
                      <tr key={r.id}>
                        {isMultiDay && <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{dateFmt(r.scan_time)}</td>}
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{timeFmt(r.scan_time)}</td>
                        <td style={{ fontWeight: 500 }}>{r.sewadar_name}</td>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--gold)' }}>{r.badge_number}</td>
                        {isAdminOrAbove && <td style={{ fontSize: '0.82rem' }}>{r.centre}</td>}
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{r.department}</td>
                        <td><span className={`badge ${r.type === 'IN' ? 'badge-green' : 'badge-red'}`}>{r.type}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}