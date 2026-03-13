import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { ROLES } from '../lib/supabase'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Users, LogIn, LogOut, Activity, RefreshCw, Clock } from 'lucide-react'

export default function DashboardPage() {
  const { profile } = useAuth()
  const [stats, setStats] = useState({ total: 0, ins: 0, outs: 0 })
  const [centreStats, setCentreStats] = useState([])
  const [recentScans, setRecentScans] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(new Date())

  const isSuperAdminOrAdmin = [ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(profile?.role)

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
  }, [profile])

  async function fetchData() {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayISO = today.toISOString()

    let query = supabase
      .from('attendance')
      .select('*')
      .gte('scan_time', todayISO)
      .order('scan_time', { ascending: false })

    if (!isSuperAdminOrAdmin && profile?.centre) {
      query = query.eq('centre', profile.centre)
    }

    const { data } = await query
    if (!data) return

    const ins = data.filter(r => r.type === 'IN').length
    const outs = data.filter(r => r.type === 'OUT').length
    setStats({ total: data.length, ins, outs })
    setRecentScans(data.slice(0, 20))

    // Centre breakdown (admin/super admin only)
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

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
      <div className="text-center">
        <div className="spinner" style={{ margin: '0 auto 1rem' }} />
        <p className="text-muted text-sm">Loading dashboard...</p>
      </div>
    </div>
  )

  return (
    <div className="page-wide pb-nav" style={{ maxWidth: 900 }}>
      {/* Header */}
      <div className="flex items-center justify-between mt-2 mb-3">
        <div>
          <h2 style={{ fontFamily: 'Cinzel, serif', color: 'var(--gold)', fontSize: '1.2rem' }}>
            Dashboard
          </h2>
          <p className="text-muted text-xs mt-1 flex items-center gap-1">
            <Clock size={12} />
            Today · Refreshed {lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <button className="btn btn-ghost" onClick={fetchData} style={{ padding: '0.5rem' }}>
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Stats */}
      <div className="stats-grid-3 mb-3">
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
      </div>

      {/* Centre breakdown chart — admin/super admin */}
      {isSuperAdminOrAdmin && centreStats.length > 0 && (
        <div className="card mb-3">
          <h3 style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Centre-wise Attendance (Today)
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
          <p className="text-muted text-sm text-center" style={{ padding: '2rem 0' }}>No scans today yet.</p>
        ) : (
          <div className="table-wrap" style={{ border: 'none' }}>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Name</th>
                  <th>Badge</th>
                  <th>Centre</th>
                  <th>Dept</th>
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
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{r.department}</td>
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
