import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Users, LogIn, LogOut, Activity, RefreshCw, Clock, Download, Calendar, Filter, Radio, CalendarDays } from 'lucide-react'

export default function DashboardPage() {
  const { profile } = useAuth()
  const [stats, setStats] = useState({ total: 0, ins: 0, outs: 0, insideNow: 0 })
  const [centreStats, setCentreStats] = useState([])
  const [recentScans, setRecentScans] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(new Date())

  // New filter states
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0])
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])
  const [sessionFilter, setSessionFilter] = useState('')
  const [centreFilter, setCentreFilter] = useState('')
  const [sessions, setSessions] = useState([])
  const [centres, setCentres] = useState([])

  const isSuperAdminOrAdmin = [ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(profile?.role)

  useEffect(() => {
    fetchFilters()
  }, [profile])

  useEffect(() => {
    fetchData()

    // Real-time subscription for new attendance
    const channel = supabase
      .channel('attendance-dashboard')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance' }, () => {
        fetchData()
      })
      .subscribe()

    // Poll every 30s as fallback
    const interval = setInterval(fetchData, 30000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [profile, dateFrom, dateTo, sessionFilter, centreFilter])

  async function fetchFilters() {
    // Load sessions
    const { data: sessionsData } = await supabase
      .from('sessions')
      .select('*')
      .order('session_date', { ascending: false })
      .limit(30)
    setSessions(sessionsData || [])

    // Load centres based on role
    if (isSuperAdminOrAdmin) {
      if (profile?.role === ROLES.SUPER_ADMIN) {
        const { data } = await supabase.from('centres').select('centre_name').order('centre_name')
        setCentres(data?.map(c => c.centre_name) || [])
      } else {
        const { data } = await supabase
          .from('centres')
          .select('centre_name')
          .or(`centre_name.eq.${profile.centre},parent_centre.eq.${profile.centre}`)
        setCentres(data?.map(c => c.centre_name) || [])
      }
    }
  }

  async function fetchData() {
    const start = new Date(dateFrom)
    start.setHours(0, 0, 0, 0)
    const end = new Date(dateTo)
    end.setHours(23, 59, 59, 999)

    let query = supabase
      .from('attendance')
      .select('*')
      .gte('scan_time', start.toISOString())
      .lte('scan_time', end.toISOString())
      .order('scan_time', { ascending: false })

    // Apply session filter
    if (sessionFilter) {
      query = query.eq('session_id', sessionFilter)
    }

    // Apply centre filter based on role
    if (!isSuperAdminOrAdmin && profile?.centre) {
      query = query.eq('centre', profile.centre)
    } else if (centreFilter) {
      query = query.eq('centre', centreFilter)
    }

    const { data } = await query
    if (!data) return

    const ins = data.filter(r => r.type === 'IN').length
    const outs = data.filter(r => r.type === 'OUT').length

    // Calculate "Inside Now" - latest IN scan for each sewadar today
    const latestBySewadar = {}
    data.filter(r => r.type === 'IN').forEach(r => {
      const current = latestBySewadar[r.badge_number]
      if (!current || new Date(r.scan_time) > new Date(current.scan_time)) {
        latestBySewadar[r.badge_number] = r
      }
    })
    // Check if they have an OUT after the latest IN
    let insideNow = 0
    Object.values(latestBySewadar).forEach(inRecord => {
      const laterOuts = data.filter(r =>
        r.badge_number === inRecord.badge_number &&
        r.type === 'OUT' &&
        new Date(r.scan_time) > new Date(inRecord.scan_time)
      )
      if (laterOuts.length === 0) insideNow++
    })

    setStats({ total: data.length, ins, outs, insideNow })
    setRecentScans(data.slice(0, 20))

    // Centre breakdown
    if (isSuperAdminOrAdmin) {
      const centreMap = {}
      data.forEach(r => {
        if (!centreMap[r.centre]) centreMap[r.centre] = { centre: r.centre, in: 0, out: 0 }
        if (r.type === 'IN') centreMap[r.centre].in++
        else centreMap[r.centre].out++
      })
      setCentreStats(Object.values(centreMap).sort((a, b) => (b.in + b.out) - (a.in + a.out)).slice(0, 10))
    }

    setLoading(false)
    setLastRefresh(new Date())
  }

  function timeFmt(iso) {
    return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  function exportToCSV() {
    const csv = [
      ['Time', 'Badge', 'Name', 'Type', 'Centre', 'Scanner'].join(','),
      ...recentScans.map(r => [
        new Date(r.scan_time).toLocaleString('en-IN'),
        r.badge_number, `"${r.sewadar_name}"`, r.type, r.centre, r.scanner_name
      ].join(','))
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `attendance_${dateFrom}_to_${dateTo}.csv`
    a.click()
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div className="text-center">
        <div className="spinner" style={{ margin: '0 auto 1rem' }} />
        <p className="text-muted text-sm">Loading dashboard...</p>
      </div>
    </div>
  )

  return (
    <div className="page-wide pb-nav" style={{ maxWidth: 1000 }}>
      {/* Header */}
      <div className="flex items-center justify-between mt-2 mb-3">
        <div>
          <h2 style={{ fontFamily: 'Outfit, sans-serif', color: 'var(--gold)', fontSize: '1.3rem', fontWeight: 700 }}>
            Dashboard
          </h2>
          <p className="text-muted text-xs mt-1 flex items-center gap-1">
            <Clock size={12} />
            Refreshed {lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <button className="btn btn-ghost" onClick={fetchData} style={{ padding: '0.5rem' }}>
          <RefreshCw size={18} />
        </button>
      </div>

      {/* Date Range & Filters */}
      <div className="filters-bar mb-3">
        <div className="filter-group">
          <Calendar size={14} />
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
          />
          <span style={{ color: 'var(--text-muted)' }}>to</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
          />
        </div>

        {isSuperAdminOrAdmin && (
          <>
            <div className="filter-group">
              <Filter size={14} />
              <select value={centreFilter} onChange={e => setCentreFilter(e.target.value)}>
                <option value="">All Centres</option>
                {centres.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </>
        )}

        <div className="filter-group">
          <CalendarDays size={14} />
          <select value={sessionFilter} onChange={e => setSessionFilter(e.target.value)}>
            <option value="">All Sessions</option>
            {sessions.map(s => (
              <option key={s.id} value={s.id}>
                {s.name} ({new Date(s.session_date).toLocaleDateString('en-IN')})
              </option>
            ))}
          </select>
        </div>

        <button className="btn btn-outline" onClick={exportToCSV} style={{ marginLeft: 'auto' }}>
          <Download size={14} /> Export
        </button>
      </div>

      {/* Stats - 4 cards including Inside Now */}
      <div className="stats-grid-4 mb-3">
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
        <div className="stat-card" style={{ borderColor: 'rgba(147, 197, 253, 0.5)' }}>
          <div className="stat-number" style={{ color: 'var(--blue)' }}>
            <Radio size={16} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
            {stats.insideNow}
          </div>
          <div className="stat-label">Inside Now</div>
        </div>
      </div>

      {/* Centre breakdown chart — admin/super admin */}
      {isSuperAdminOrAdmin && centreStats.length > 0 && (
        <div className="card mb-3">
          <h3 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Centre-wise Attendance
          </h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={centreStats} margin={{ top: 0, right: 0, left: -20, bottom: 40 }}>
              <XAxis dataKey="centre" tick={{ fill: '#5a5570', fontSize: 10 }} angle={-35} textAnchor="end" />
              <YAxis tick={{ fill: '#5a5570', fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8 }}
                labelStyle={{ color: 'var(--text-primary)' }}
              />
              <Bar dataKey="in" name="IN" fill="var(--green)" radius={[4,4,0,0]} />
              <Bar dataKey="out" name="OUT" fill="var(--red)" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Live scan feed */}
      <div className="card">
        <div className="flex items-center gap-2 mb-2">
          <span className="pulse-dot green" />
          <h3 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Live Scan Feed
          </h3>
        </div>

        {recentScans.length === 0 ? (
          <p className="text-muted text-sm text-center" style={{ padding: '2rem 0' }}>No scans in selected range.</p>
        ) : (
          <div className="table-wrap" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Name</th>
                  <th>Badge</th>
                  <th>Centre</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {recentScans.map(r => (
                  <tr key={r.id}>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{timeFmt(r.scan_time)}</td>
                    <td style={{ fontWeight: 500 }}>{r.sewadar_name}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--gold)' }}>{r.badge_number}</td>
                    <td style={{ fontSize: '0.82rem' }}>{r.centre}</td>
                    <td>
                      <span className={`badge ${r.type === 'IN' ? 'badge-green' : 'badge-red'}`}>{r.type}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
