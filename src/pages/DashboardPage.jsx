import { useState, useEffect, useCallback } from 'react'
import { supabase, ROLES, formatDateIndian, getLocalDate } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { RefreshCw, Users, UserCheck, UserPlus, ChevronDown, ChevronUp, Building, Calendar, Shield, MapPin, ChevronRight, Download } from 'lucide-react'

function StatCard({ icon: Icon, label, value, subValue, color = 'green', loading }) {
  return (
    <div className={`dash-stat ${color}`}>
      <div className="dash-stat-icon"><Icon size={22} /></div>
      <div className="dash-stat-content">
        <div className="dash-stat-value">{loading ? '—' : value}</div>
        <div className="dash-stat-label">{label}</div>
        {subValue && <div className="dash-stat-sub">{subValue}</div>}
      </div>
    </div>
  )
}

function SectionCard({ title, icon: Icon, children, defaultOpen = true }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  return (
    <div className="dash-section">
      <div className="dash-section-header" onClick={() => setIsOpen(!isOpen)}>
        <div className="dash-section-title">{Icon && <Icon size={16} />}{title}</div>
        <button className="dash-section-toggle">{isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
      </div>
      {isOpen && <div className="dash-section-content">{children}</div>}
    </div>
  )
}

function SplitTable({ headers, rows }) {
  const safeNum = (val) => {
    if (val === undefined || val === null || val === '') return '—'
    if (typeof val === 'number' && isNaN(val)) return '—'
    return val
  }
  return (
    <div className="dash-table-wrapper">
      <table className="dash-table">
        <thead>
          <tr>{headers.map((h, i) => <th key={i} className={i >= 1 ? 'num' : ''}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={j >= 1 ? 'num' : ''}>{safeNum(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CentreTreeRow({ centre, data, level = 0, presentSet, insideSet, sessionMap, guestMap, defaultOpen = false }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const hasChildren = data.children && data.children.length > 0
  const hasDepts = data.departments && Object.keys(data.departments).length > 0
  const isExpandable = hasChildren || hasDepts

  const presentCount = data.sewadars ? data.sewadars.filter(s => {
    const session = sessionMap?.[s.badge_number]
    return session && session.scanCentre === centre
  }).length : 0
  const insideCount = data.sewadars ? data.sewadars.filter(s => insideSet.has(s.badge_number)).length : 0

  // Guest sewadars who scanned at this centre but belong elsewhere
  const guests = (guestMap && guestMap[centre]) || []
  const guestPresentCount = guests.filter(g => presentSet.has(g.badge_number)).length
  const guestInsideCount = guests.filter(g => insideSet.has(g.badge_number)).length

  return (
    <div className="centre-tree-item">
      <div 
        className={`centre-tree-row ${isExpandable ? 'clickable' : ''} ${guests.length > 0 ? 'has-guests' : ''}`}
        style={{ paddingLeft: `${12 + level * 20}px` }}
        onClick={() => isExpandable && setIsOpen(!isOpen)}
      >
        {isExpandable ? (
          <span className="centre-tree-toggle">
            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
        ) : (
          <span className="centre-tree-toggle" />
        )}
        <span className="centre-tree-name">
          {level === 0 && <MapPin size={14} />}
          {centre}
          {guests.length > 0 && <span className="guest-badge">+{guests.length} guest{guests.length > 1 ? 's' : ''}</span>}
        </span>
        <span className="centre-tree-stats">
          <span className="centre-stat total">{data.total || 0}</span>
          <span className="centre-stat present">{presentCount + guestPresentCount}</span>
          <span className="centre-stat inside">{insideCount + guestInsideCount}</span>
        </span>
      </div>
      
      {/* Guest list */}
      {isOpen && guests.length > 0 && (
        <div className="guest-list" style={{ paddingLeft: `${28 + level * 20}px` }}>
          <div className="guest-table-header">
            <span>Name</span>
            <span>Badge</span>
            <span>Dept</span>
            <span>Home Centre</span>
            <span>Status</span>
          </div>
          {guests.map(g => {
            const isPresent = presentSet.has(g.badge_number)
            const isInside = insideSet.has(g.badge_number)
            return (
              <div key={g.badge_number} className={`guest-table-row ${isInside ? 'guest-inside' : ''}`}>
                <span className="guest-name" title={g.name}>{g.name || g.badge_number}</span>
                <span className="guest-badge">{g.badge_number}</span>
                <span className="guest-dept">{g.department || '-'}</span>
                <span className="guest-home">{g.homeCentre}</span>
                <span className={`guest-stat ${isInside ? 'inside' : isPresent ? 'present' : 'away'}`}>
                  {isInside ? 'Inside' : isPresent ? 'Present' : 'Away'}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Department breakdown */}
      {isOpen && hasDepts && (
        <div className="centre-depts">
          <div className="dept-header" style={{ paddingLeft: `${28 + level * 20}px` }}>
            <span>Department</span>
            <span>Total</span>
            <span>Present</span>
            <span>Inside</span>
          </div>
          {Object.entries(data.departments).map(([dept, deptData]) => {
            // Count present/inside including cross-centre scans
            const deptPresent = deptData.sewadars.filter(s => {
              const session = sessionMap?.[s.badge_number]
              return session !== undefined && session.scanCentre !== undefined
            }).length
            const deptInside = deptData.sewadars.filter(s => insideSet.has(s.badge_number)).length
            return (
              <div key={dept} className="dept-row" style={{ paddingLeft: `${28 + level * 20}px` }}>
                <span className="dept-name">{dept}</span>
                <span className="dept-stat">{deptData.sewadars?.length || 0}</span>
                <span className="dept-stat">{deptPresent}</span>
                <span className="dept-stat">{deptInside}</span>
              </div>
            )
          })}
        </div>
      )}
      
      {isOpen && hasChildren && (
        <div className="centre-children">
          {data.children.map(child => (
            <CentreTreeRow 
              key={child.name} 
              centre={child.name} 
              data={child} 
              level={level + 1}
              presentSet={presentSet}
              insideSet={insideSet}
              sessionMap={sessionMap}
              guestMap={guestMap}
              defaultOpen={level === 0}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function DashboardPage() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [selectedDate, setSelectedDate] = useState(getLocalDate())
  
  const isASO = profile?.role === ROLES.SUPER_ADMIN || profile?.role === ROLES.ASO
  const userCentre = profile?.centre

  // Only super_admin can view ALL centres. admin/centre_user see their own + children
  const canViewAllCentres = profile?.role === ROLES.SUPER_ADMIN || profile?.role === ROLES.ASO

  const [stats, setStats] = useState({
    totalBadges: 0,
    presentToday: 0,
    currentlyInside: 0,
    permanentBadges: 0,
    openBadges: 0,
    eligibleTotal: 0,
    elderlyCount: 0
  })

  const [deptStats, setDeptStats] = useState([])
  const [genderStats, setGenderStats] = useState({ 
    male: { total: 0, present: 0, inside: 0, permanent: 0, open: 0 }, 
    female: { total: 0, present: 0, inside: 0, permanent: 0, open: 0 } 
  })
  const [jathaStats, setJathaStats] = useState({ total: 0, present: 0 })
  const [centreTree, setCentreTree] = useState([])
  const [centresList, setCentresList] = useState([])
  const [presentSet, setPresentSet] = useState(new Set())
  const [insideSet, setInsideSet] = useState(new Set())
  const [sessionMap, setSessionMap] = useState({})
  const [guestMap, setGuestMap] = useState({})

  const fetchAllSewadars = async () => {
    const all = []
    let page = 0
    const pageSize = 1000
    while (true) {
      const from = page * pageSize
      const { data: batch } = await supabase.from('sewadars').select('badge_number, sewadar_name, centre, department, badge_status, gender').range(from, from + pageSize - 1)
      if (!batch || batch.length === 0) break
      all.push(...batch)
      if (batch.length < pageSize) break
      page++
    }
    return all
  }

  const fetchDashboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      const centreFilter = (!canViewAllCentres && userCentre) ? userCentre : null

      // Run all independent queries in PARALLEL
      const [centresRes, totalRes, permRes, openRes, elderlyRes, maleRes, femaleRes, sessionsRes, openSessionsRes, jathaRes, sewadars] = await Promise.all([
        supabase.from('centres').select('name, parent_centre').order('name'),
        centreFilter
          ? supabase.from('sewadars').select('*', { count: 'exact', head: true }).eq('centre', centreFilter)
          : supabase.from('sewadars').select('*', { count: 'exact', head: true }),
        centreFilter
          ? supabase.from('sewadars').select('*', { count: 'exact', head: true }).eq('badge_status', 'PERMANENT').eq('centre', centreFilter)
          : supabase.from('sewadars').select('*', { count: 'exact', head: true }).eq('badge_status', 'PERMANENT'),
        centreFilter
          ? supabase.from('sewadars').select('*', { count: 'exact', head: true }).eq('badge_status', 'OPEN').eq('centre', centreFilter)
          : supabase.from('sewadars').select('*', { count: 'exact', head: true }).eq('badge_status', 'OPEN'),
        centreFilter
          ? supabase.from('sewadars').select('*', { count: 'exact', head: true }).eq('badge_status', 'ELDERLY').eq('centre', centreFilter)
          : supabase.from('sewadars').select('*', { count: 'exact', head: true }).eq('badge_status', 'ELDERLY'),
        centreFilter
          ? supabase.from('sewadars').select('*', { count: 'exact', head: true }).eq('gender', 'Male').eq('centre', centreFilter)
          : supabase.from('sewadars').select('*', { count: 'exact', head: true }).eq('gender', 'Male'),
        centreFilter
          ? supabase.from('sewadars').select('*', { count: 'exact', head: true }).eq('gender', 'Female').eq('centre', centreFilter)
          : supabase.from('sewadars').select('*', { count: 'exact', head: true }).eq('gender', 'Female'),
        supabase.from('attendance_sessions').select('badge_number, centre, status').eq('in_date', selectedDate),
        supabase.from('attendance_sessions').select('badge_number').eq('status', 'OPEN').eq('in_date', selectedDate),
        supabase.from('jatha_attendance').select('badge_number').or(`and(from_date.lte.${selectedDate},to_date.gte.${selectedDate})`),
        fetchAllSewadars()
      ])

      const centresData = centresRes.data || []
      const totalBadges = totalRes.count || 0
      const permanentBadges = permRes.count || 0
      const openBadgesCount = openRes.count || 0
      const elderlyCount = elderlyRes.count || 0
      const eligibleTotal = totalBadges - elderlyCount
      const maleTotal = maleRes.count || 0
      const femaleTotal = femaleRes.count || 0
      const todaySessions = sessionsRes.data || []
      const openSessions = openSessionsRes.data || []
      const jathaToday = jathaRes.data || []

      setCentresList(centresData)

      // Build session map & sets
      const sMap = {}
      for (const s of todaySessions) sMap[s.badge_number] = { scanCentre: s.centre, status: s.status }
      const localPresentSet = new Set(todaySessions.map(s => s.badge_number))
      const localInsideSet = new Set(openSessions.map(s => s.badge_number))
      const scopeBadges = new Set(sewadars.map(s => s.badge_number))

      const presentInScope = [...localPresentSet].filter(b => scopeBadges.has(b))
      const insideInScope = [...localInsideSet].filter(b => scopeBadges.has(b))

      // Build guest map & sewadar centre map
      const sewadarMap = {}
      for (const s of sewadars) sewadarMap[s.badge_number] = s
      const gMap = {}
      for (const session of todaySessions) {
        const sewadar = sewadarMap[session.badge_number]
        const homeCentre = sewadar?.centre
        if (homeCentre && homeCentre !== session.centre) {
          if (!gMap[session.centre]) gMap[session.centre] = []
          gMap[session.centre].push({ badge_number: session.badge_number, name: sewadar.sewadar_name, department: sewadar.department, homeCentre, status: session.status })
        }
      }

      // Build centre tree (single pass through sewadars)
      const centreMap = {}
      const rootCentres = []
      for (const c of centresData) {
        centreMap[c.name] = { name: c.name, parent: c.parent_centre, total: 0, sewadars: [], departments: {}, children: [] }
      }
      for (const s of sewadars) {
        const centre = centreMap[s.centre]
        if (centre) {
          centre.sewadars.push(s)
          if (s.badge_status !== 'ELDERLY') centre.total++
          const dept = s.department || 'UNKNOWN'
          if (!centre.departments[dept]) centre.departments[dept] = { sewadars: [] }
          centre.departments[dept].sewadars.push(s)
        }
      }
      for (const [, data] of Object.entries(centreMap)) {
        if (data.parent && centreMap[data.parent]) centreMap[data.parent].children.push(data)
        else rootCentres.push(data)
      }
      const sortAZ = (arr) => {
        arr.sort((a, b) => a.name.localeCompare(b.name))
        for (const item of arr) { if (item.children.length > 0) sortAZ(item.children) }
      }
      sortAZ(rootCentres)

      // Department stats (single pass through sewadars)
      const deptMap = {}
      let malePresentCount = 0, femalePresentCount = 0
      let maleInsideCount = 0, femaleInsideCount = 0
      let malePermanentCount = 0, femalePermanentCount = 0
      let maleOpenCount = 0, femaleOpenCount = 0
      let maleEligibleCount = 0, femaleEligibleCount = 0

      for (const s of sewadars) {
        const dept = s.department || 'UNKNOWN'
        if (!deptMap[dept]) deptMap[dept] = { total: 0, present: 0, inside: 0, permanent: 0, open: 0, elderly: 0 }
        if (s.badge_status === 'ELDERLY') {
          deptMap[dept].elderly++
        } else {
          deptMap[dept].total++
          if (s.badge_status === 'PERMANENT') deptMap[dept].permanent++
          else deptMap[dept].open++
        }
        if (localPresentSet.has(s.badge_number)) deptMap[dept].present++
        if (localInsideSet.has(s.badge_number)) deptMap[dept].inside++

        const gender = s.gender?.toUpperCase() || ''
        if (gender === 'MALE') {
          if (s.badge_status !== 'ELDERLY') {
            maleEligibleCount++
            if (s.badge_status === 'PERMANENT') malePermanentCount++
            else maleOpenCount++
          }
          if (localPresentSet.has(s.badge_number)) malePresentCount++
          if (localInsideSet.has(s.badge_number)) maleInsideCount++
        } else {
          if (s.badge_status !== 'ELDERLY') {
            femaleEligibleCount++
            if (s.badge_status === 'PERMANENT') femalePermanentCount++
            else femaleOpenCount++
          }
          if (localPresentSet.has(s.badge_number)) femalePresentCount++
          if (localInsideSet.has(s.badge_number)) femaleInsideCount++
        }
      }

      setStats({ totalBadges, presentToday: presentInScope.length, currentlyInside: insideInScope.length, permanentBadges, openBadges: openBadgesCount, eligibleTotal, elderlyCount })
      setPresentSet(localPresentSet)
      setInsideSet(localInsideSet)
      setSessionMap(sMap)
      setGuestMap(gMap)
      setCentreTree(rootCentres)
      setDeptStats(Object.entries(deptMap).sort((a, b) => b[1].total - a[1].total))
      setGenderStats({
        male: { total: maleEligibleCount, present: malePresentCount, inside: maleInsideCount, permanent: malePermanentCount, open: maleOpenCount },
        female: { total: femaleEligibleCount, present: femalePresentCount, inside: femaleInsideCount, permanent: femalePermanentCount, open: femaleOpenCount }
      })

      // Jatha stats
      const jathaBadges = new Set(jathaToday.map(j => j.badge_number))
      const jathaInScope = [...jathaBadges].filter(b => scopeBadges.has(b))
      const jathaPresent = jathaInScope.filter(b => localPresentSet.has(b))
      setJathaStats({ total: jathaInScope.length, present: jathaPresent.length })

    } catch (err) {
      console.error('Dashboard error:', err)
    }

    setLoading(false)
    setRefreshing(false)
  }, [selectedDate, canViewAllCentres, userCentre])

  useEffect(() => { fetchDashboard() }, [fetchDashboard])

  const totalPercent = stats.eligibleTotal > 0 ? Math.round(stats.presentToday / stats.eligibleTotal * 100) : 0
  const presentPercent = stats.presentToday > 0 ? Math.round(stats.currentlyInside / stats.presentToday * 100) : 0

  const exportDashboard = () => {
    // Centre data
    const centreRows = []
    const addCentreRow = (centre, level = 0) => {
      const deptRows = []
      if (centre.departments) {
        for (const [dept, d] of Object.entries(centre.departments)) {
          const deptPresent = d.sewadars.filter(s => presentSet.has(s.badge_number)).length
          const deptInside = d.sewadars.filter(s => insideSet.has(s.badge_number)).length
          deptRows.push([dept, d.sewadars.length, deptPresent, deptInside])
        }
      }
      centreRows.push([centre.name, centre.total, centre.sewadars.filter(s => presentSet.has(s.badge_number)).length, centre.sewadars.filter(s => insideSet.has(s.badge_number)).length, deptRows])
    }
    for (const c of centreTree) addCentreRow(c)
    
    // Flatten for CSV
    const csvRows = [['Centre', 'Department', 'Total', 'Present', 'Inside']]
    for (const [centreName, total, present, inside, depts] of centreRows) {
      csvRows.push([centreName, '', total, present, inside])
      for (const [dept, t, p, i] of depts) {
        csvRows.push(['', dept, t, p, i])
      }
    }
    
    // Gender section
    csvRows.push([])
    csvRows.push(['Gender', 'Total', 'OPEN', 'PERMANENT', 'Present', 'Inside'])
    csvRows.push(['Male', genderStats.male.total, genderStats.male.open, genderStats.male.permanent, genderStats.male.present, genderStats.male.inside])
    csvRows.push(['Female', genderStats.female.total, genderStats.female.open, genderStats.female.permanent, genderStats.female.present, genderStats.female.inside])
    
    // Badge status
    csvRows.push([])
    csvRows.push(['Badge Status', 'Total'])
    csvRows.push(['OPEN', stats.openBadges])
    csvRows.push(['PERMANENT', stats.permanentBadges])
    
    // Download
    const csv = csvRows.map(r => r.join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `dashboard_${selectedDate}.csv`
    a.click()
  }

  return (
    <div className="page-full pb-nav">
      <div className="header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2>Dashboard</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="refresh-btn" onClick={exportDashboard} title="Export CSV">
                <Download size={14} />
              </button>
              <button className="refresh-btn" onClick={() => fetchDashboard(true)} disabled={refreshing}>
                <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
              </button>
            </div>
          </div>
        <div className="header-date">
          <Calendar size={14} />
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            style={{ border: 'none', background: 'transparent', fontSize: 'inherit', fontWeight: 600, color: 'inherit', outline: 'none', cursor: 'pointer' }}
            max={getLocalDate()}
          />
          {userCentre && !canViewAllCentres && `- ${userCentre}`}
        </div>
      </div>

      {/* Main Stats */}
      <div className="dash-stats-grid">
        <StatCard icon={Users} label="Total Eligible" value={stats.eligibleTotal} subValue={`${stats.elderlyCount} elderly excluded`} color="blue" loading={loading} />
        <StatCard icon={UserCheck} label="Present Today" value={stats.presentToday} subValue={`${totalPercent}%`} color="green" loading={loading} />
        <StatCard icon={UserPlus} label="Currently Inside" value={stats.currentlyInside} subValue={`${presentPercent}% of present`} color="orange" loading={loading} />
        {jathaStats.total > 0 && (
          <StatCard icon={Users} label="On Jatha" value={jathaStats.total} subValue={`${jathaStats.present} present`} color="purple" loading={loading} />
        )}
      </div>

      {/* Centre Wise Breakdown - Only for ASO and Centre Admin */}
      {canViewAllCentres && (
      <SectionCard title="Centre & Department Wise Breakdown" icon={MapPin} defaultOpen={canViewAllCentres}>
        <div className="centre-tree-legend">
          <span>Centre</span>
          <span className="legend-total">Total</span>
          <span className="legend-present">Present</span>
          <span className="legend-inside">Inside</span>
        </div>
        <div className="centre-tree">
          {centreTree.map(centre => (
            <CentreTreeRow 
              key={centre.name} 
              centre={centre.name} 
              data={centre}
              presentSet={presentSet}
              insideSet={insideSet}
              sessionMap={sessionMap}
              guestMap={guestMap}
              defaultOpen={false}
            />
          ))}
          {centreTree.length === 0 && !loading && (
            <div className="centre-tree-empty">No centres found</div>
          )}
        </div>
      </SectionCard>
      )}

      {/* Gender Split */}
      <SectionCard title="Gender Split" icon={Users}>
        <SplitTable
          headers={['Gender', 'Total', 'OPEN', 'PERMANENT', 'Present', 'Inside']}
          rows={[
            ['Male', genderStats.male.total, genderStats.male.open, genderStats.male.permanent, genderStats.male.present, genderStats.male.inside],
            ['Female', genderStats.female.total, genderStats.female.open, genderStats.female.permanent, genderStats.female.present, genderStats.female.inside],
          ]}
        />
      </SectionCard>

      {/* PERMANENT Badge Split */}
      <SectionCard title="Badge Status Split" icon={Shield}>
        <SplitTable
          headers={['Status', 'Total']}
          rows={[
            ['OPEN', stats.openBadges],
            ['PERMANENT', stats.permanentBadges],
          ]}
        />
      </SectionCard>

      {/* Department Split */}
      <SectionCard title="Department Wise Split" icon={Building}>
        <SplitTable
          headers={['Department', 'Total', 'OPEN', 'PERMANENT', 'Present', 'Inside']}
          rows={deptStats.map(([dept, data]) => [
            dept, data.total, data.open, data.permanent, data.present, data.inside
          ])}
        />
      </SectionCard>
    </div>
  )
}
