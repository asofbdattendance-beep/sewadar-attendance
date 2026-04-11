import { useState, useEffect } from 'react'
import { supabase, ROLES } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { todayDateStr } from '../lib/dateUtils'
import { Users, UserCheck, UserX, Clock, Activity, Building2, Home, ChevronDown, ChevronRight } from 'lucide-react'

const ALLOWED_STATUSES = ['open', 'permanent', 'elderly']

export default function DashboardPage() {
  const { profile } = useAuth()
  const isAso = profile?.role === ROLES.ASO
  const isCentreUser = profile?.role === ROLES.CENTRE || profile?.role === ROLES.SC_SP_USER

  const [loading, setLoading] = useState(true)
  const [dateFilter, setDateFilter] = useState(todayDateStr())
  const [stats, setStats] = useState({ 
    totalEligible: 0, 
    present: 0, 
    inside: 0, 
    outside: 0,
    satsang: 0, 
    gateEntry: 0, 
    watchWard: 0 
  })
  const [centreStats, setCentreStats] = useState([])
  const [deptStats, setDeptStats] = useState([])
  const [childCentres, setChildCentres] = useState([])
  const [childCentreStats, setChildCentreStats] = useState([])
  const [childCentresLoaded, setChildCentresLoaded] = useState(false)
  const [expandedCentres, setExpandedCentres] = useState({})

  useEffect(() => {
    if (!profile?.centre) return

    supabase.from('centres').select('centre_name')
      .eq('parent_centre', profile.centre)
      .then(({ data }) => {
        setChildCentres(data?.map(c => c.centre_name) || [])
        setChildCentresLoaded(true)
      })
      .catch(e => { if (import.meta.env.DEV) console.warn('Failed to load child centres:', e) })
  }, [profile?.centre])

  useEffect(() => {
    if (!profile || !childCentresLoaded) return
    
    fetchDashboard()
  }, [profile, dateFilter, childCentresLoaded])

  // Realtime subscription - separate effect to avoid re-subscribing on data changes
  useEffect(() => {
    if (!profile) return
    
    let timer = null
    const channel = supabase.channel('dashboard-realtime-v2')
    
    channel.on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'attendance_sessions' 
    }, (payload) => {
      if (import.meta.env.DEV) console.log('[RT-DASH] sessions event:', payload.eventType, payload.new)
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (import.meta.env.DEV) console.log('[RT-DASH] Refreshing dashboard...')
        fetchDashboard()
      }, 100) // Reduced from 300ms to 100ms
    })
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'attendance' 
    }, (payload) => {
      if (import.meta.env.DEV) console.log('[RT-DASH] attendance event:', payload.eventType, payload.new)
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (import.meta.env.DEV) console.log('[RT-DASH] Refreshing dashboard...')
        fetchDashboard()
      }, 100) // Reduced from 300ms to 100ms
    })
    .subscribe((status, err) => {
      if (import.meta.env.DEV) console.log('[RT-DASH] Channel status:', status, err || '')
    })
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'attendance' 
    }, (payload) => {
      console.log('[RT-DASH] attendance event:', payload.eventType, payload.new)
      clearTimeout(timer)
      timer = setTimeout(() => {
        console.log('[RT-DASH] Refreshing dashboard...')
        fetchDashboard()
      }, 300)
    })
    .subscribe((status, err) => {
      console.log('[RT-DASH] Channel status:', status, err || '')
    })

    return () => { 
      console.log('[RT-DASH] Cleaning up')
      clearTimeout(timer)
      supabase.removeChannel(channel) 
    }
  }, [profile?.centre, profile?.role])

  async function fetchDashboard() {
    setLoading(true)
    const start = `${dateFilter}T00:00:00+05:30`
    const end = `${dateFilter}T23:59:59+05:30`

    // Get eligible sewadars (scoped)
    let sewadarQ = supabase
      .from('sewadars')
      .select('badge_number, badge_status, centre')
    
    // For centre users, only count their centre + sub-centres
    if (isCentreUser && profile?.centre) {
      const allScope = [profile.centre, ...childCentres]
      sewadarQ = sewadarQ.in('centre', allScope)
    }
    
    const { data: scopedSewadars } = await sewadarQ
    
    const eligibleCount = (scopedSewadars || []).filter(s => {
      const status = (s.badge_status || s.status || '').toLowerCase().trim()
      return ALLOWED_STATUSES.includes(status)
    }).length

    let scope = []
    if (isCentreUser && profile?.centre) {
      scope = [profile.centre, ...childCentres]
    }

    // Get all sessions for the date (both open and closed)
    let sessionsQ = supabase
      .from('v_sessions')
      .select('badge_number, duty_type, sewadar_department, sewadar_centre, is_open')
      .gte('in_time', start)
      .lte('in_time', end)

    if (scope.length > 0) {
      sessionsQ = sessionsQ.in('sewadar_centre', scope)
    }

    const { data: sessions } = await sessionsQ
    
    const uniquePresent = new Set(sessions?.map(s => s.badge_number) || [])
    const presentCount = uniquePresent.size
    
    const inside = sessions?.filter(s => s.is_open).length || 0
    const outside = presentCount - inside

    const dutyCounts = { satsang: 0, gate_entry: 0, watch_ward: 0 }
    sessions?.forEach(s => {
      if (s.duty_type === 'satsang') dutyCounts.satsang++
      else if (s.duty_type === 'gate_entry') dutyCounts.gate_entry++
      else if (s.duty_type === 'watch_ward') dutyCounts.watch_ward++
    })

    setStats({
      totalEligible: eligibleCount,
      present: presentCount,
      inside,
      outside,
      satsang: dutyCounts.satsang,
      gateEntry: dutyCounts.gate_entry,
      watchWard: dutyCounts.watch_ward
    })

    // Get eligible sewadars grouped by department for centre user
    let deptEligible = {}
    if (isCentreUser && profile?.centre) {
      const { data: deptSewadars } = await supabase
        .from('sewadars')
        .select('badge_number, badge_status, department')
        .in('centre', scope)
      
      deptSewadars?.forEach(s => {
        const status = (s.badge_status || s.status || '').toLowerCase().trim()
        if (ALLOWED_STATUSES.includes(status)) {
          const dept = s.department || 'Unassigned'
          if (!deptEligible[dept]) deptEligible[dept] = 0
          deptEligible[dept]++
        }
      })
    }

    // Fetch centres data for ASO
    if (isAso) {
      const { data: centres } = await supabase
        .from('centres')
        .select('centre_name, parent_centre')
        .order('centre_name')

      const centreData = []
      const parentCentres = [...new Set((centres || []).filter(c => !c.parent_centre).map(c => c.centre_name))]

      for (const parent of parentCentres) {
        const childNames = (centres || []).filter(c => c.parent_centre === parent).map(c => c.centre_name)
        const allCentresInGroup = [parent, ...childNames]

        const { data: centreSessions } = await supabase
          .from('v_sessions')
          .select('badge_number, duty_type, sewadar_department, is_open')
          .gte('in_time', start)
          .lte('in_time', end)
          .in('sewadar_centre', allCentresInGroup)

        const presentSet = new Set(centreSessions?.map(s => s.badge_number) || [])
        const insideCount = centreSessions?.filter(s => s.is_open).length || 0

        // Get eligible sewadars for this centre
        const { data: centreSewadars } = await supabase
          .from('sewadars')
          .select('badge_number, badge_status')
          .in('centre', allCentresInGroup)
        
        const eligible = (centreSewadars || []).filter(s => {
          const status = (s.badge_status || s.status || '').toLowerCase().trim()
          return ALLOWED_STATUSES.includes(status)
        }).length

        // Get departments for this centre group
        const deptCounts = {}
        centreSessions?.forEach(s => {
          const dept = s.sewadar_department || 'Unassigned'
          if (!deptCounts[dept]) deptCounts[dept] = { name: dept, present: 0, inside: 0 }
          deptCounts[dept].present++
          if (s.is_open) deptCounts[dept].inside++
        })

        centreData.push({
          centre: parent,
          subCentres: childNames,
          eligible,
          present: presentSet.size,
          inside: insideCount,
          departments: Object.values(deptCounts).sort((a, b) => b.present - a.present)
        })
      }

      setCentreStats(centreData)
    } else if (isCentreUser) {
      // For centre user - get department breakdown with eligible count
      const deptCounts = {}
      sessions?.forEach(s => {
        const dept = s.sewadar_department || 'Unassigned'
        if (!deptCounts[dept]) deptCounts[dept] = { name: dept, eligible: deptEligible[dept] || 0, present: 0, inside: 0 }
        deptCounts[dept].present++
        if (s.is_open) deptCounts[dept].inside++
      })

      setDeptStats(Object.values(deptCounts).sort((a, b) => b.present - a.present))

      // Fetch sub-centre stats for centre user
      const childCentreStatsData = []
      for (const child of childCentres) {
        const { data: childSessions } = await supabase
          .from('v_sessions')
          .select('badge_number, is_open')
          .eq('sewadar_centre', child)
          .gte('in_time', start)
          .lte('in_time', end)
        
        const presentSet = new Set(childSessions?.map(s => s.badge_number) || [])
        const insideCount = childSessions?.filter(s => s.is_open).length || 0
        
        childCentreStatsData.push({
          name: child,
          present: presentSet.size,
          inside: insideCount
        })
      }
      setChildCentreStats(childCentreStatsData.sort((a, b) => b.present - a.present))
    }

    setLoading(false)
  }

  function toggleCentreExpand(centre) {
    setExpandedCentres(prev => ({ ...prev, [centre]: !prev[centre] }))
  }

  const presentPercent = stats.totalEligible > 0 ? Math.round((stats.present / stats.totalEligible) * 100) : 0

  return (
    <div className="page pb-nav">
      {/* Date Filter */}
      <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <input 
          type="date" 
          value={dateFilter} 
          onChange={e => setDateFilter(e.target.value)}
          className="input"
          style={{ padding: '0.4rem 0.6rem', fontSize: '0.85rem' }}
        />
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {new Date(dateFilter + 'T00:00:00+05:30').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}
        </span>
      </div>

      {/* Header Stats */}
      <div style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
          {isAso ? 'All Centres Overview' : profile?.centre}
        </h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {isAso 
            ? `${centreStats.length} centres` 
            : childCentres.length > 0 
              ? `${childCentres.length} sub-centres` 
              : 'Main centre only'}
        </p>
      </div>

      {/* Quick Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.75rem', marginBottom: '1rem' }}>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(59,130,246,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Users size={16} color="#3b82f6" />
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>ELIGIBLE SEWADARS</span>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--text-primary)' }}>{stats.totalEligible}</div>
        </div>

        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(34,197,94,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <UserCheck size={16} color="#16a34a" />
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>PRESENT TODAY</span>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--green)' }}>{stats.present}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{presentPercent}% of eligible</div>
        </div>

        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(168,85,247,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Clock size={16} color="#9333ea" />
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>CURRENTLY IN</span>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#9333ea' }}>{stats.inside}</div>
        </div>

        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(220,38,38,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <UserX size={16} color="#dc2626" />
            </div>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>COMPLETED</span>
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--red)' }}>{stats.outside}</div>
        </div>
      </div>

      {/* Duty Type Breakdown */}
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <Activity size={14} color="var(--text-muted)" />
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Duty Type Breakdown</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <div style={{ flex: 1, textAlign: 'center', padding: '0.5rem', background: 'rgba(168,85,247,0.1)', borderRadius: 8 }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#9333ea' }}>{stats.satsang}</div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Satsang</div>
          </div>
          <div style={{ flex: 1, textAlign: 'center', padding: '0.5rem', background: 'rgba(107,114,128,0.1)', borderRadius: 8 }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#6b7280' }}>{stats.gateEntry}</div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Gate Entry</div>
          </div>
          <div style={{ flex: 1, textAlign: 'center', padding: '0.5rem', background: 'rgba(59,130,246,0.1)', borderRadius: 8 }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#3b82f6' }}>{stats.watchWard}</div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>W&W</div>
          </div>
        </div>
      </div>

      {/* Centre-wise (ASO) or Department-wise (Centre User) */}
      {isAso ? (
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Building2 size={14} color="var(--text-muted)" />
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Centre-wise Breakdown</span>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '1rem' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
          ) : centreStats.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No data</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {centreStats.map((c, i) => (
                <div key={i}>
                  <div 
                    onClick={() => toggleCentreExpand(c.centre)}
                    style={{ 
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', 
                      padding: '0.65rem 0.75rem', background: 'var(--bg)', borderRadius: 8,
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {expandedCentres[c.centre] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{c.centre}</span>
                      {c.subCentres.length > 0 && (
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>({c.subCentres.length} sub-centres)</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.eligible} eligible</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--green)', fontWeight: 600 }}>{c.present} present</span>
                      <span style={{ fontSize: '0.75rem', color: '#9333ea', fontWeight: 600 }}>{c.inside} in</span>
                    </div>
                  </div>
                  
                  {expandedCentres[c.centre] && (
                    <div style={{ paddingLeft: '1.5rem', marginTop: '0.5rem' }}>
                      {c.departments.length > 0 ? (
                        c.departments.map((d, j) => (
                          <div key={j} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.75rem', background: 'var(--bg-elevated)', borderRadius: 6, marginBottom: '0.25rem' }}>
                            <div>
                              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)' }}>{d.name}</span>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>{d.eligible || 0} total</span>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              <span style={{ fontSize: '0.75rem', color: 'var(--green)', fontWeight: 600 }}>{d.present} ({d.inside} in)</span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.5rem' }}>No attendance</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Building2 size={14} color="var(--text-muted)" />
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Department-wise (Inside Now)</span>
          </div>

          {loading ? (
            <div style={{ textAlign: 'center', padding: '1rem' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
          ) : deptStats.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>No sewadars inside</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {deptStats.map((d, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.75rem', background: 'var(--bg)', borderRadius: 8 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{d.name}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {d.eligible} total
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <div style={{ textAlign: 'center', padding: '0.35rem 0.6rem', background: 'rgba(34,197,94,0.1)', borderRadius: 6 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--green)' }}>{d.present}</div>
                      <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>({d.inside} in)</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sub-centres stats for centre user */}
      {isCentreUser && childCentreStats.length > 0 && (
        <div style={{ background: 'var(--gold-bg)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 12, padding: '1rem', marginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <Home size={14} color="var(--gold)" />
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--gold)' }}>Sub-centre Attendance</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {childCentreStats.map((c, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.5rem 0.75rem', background: 'var(--bg)', borderRadius: 8 }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{c.name}</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--green)', fontWeight: 600 }}>
                  {c.present} ({c.inside} in)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}