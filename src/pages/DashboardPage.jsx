import { useState, useEffect, useCallback } from 'react'
import { supabase, ROLES, formatDateIndian } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { RefreshCw, Users, UserCheck, UserPlus, ChevronDown, ChevronUp, Building, Calendar, Shield, MapPin, ChevronRight } from 'lucide-react'

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
          <tr>{headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
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

function CentreTreeRow({ centre, data, level = 0, presentSet, insideSet, defaultOpen = false }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const hasChildren = data.children && data.children.length > 0
  const hasDepts = data.departments && Object.keys(data.departments).length > 0
  const isExpandable = hasChildren || hasDepts

  const presentCount = data.sewadars ? data.sewadars.filter(s => presentSet.has(s.badge_number)).length : 0
  const insideCount = data.sewadars ? data.sewadars.filter(s => insideSet.has(s.badge_number)).length : 0

  return (
    <div className="centre-tree-item">
      <div 
        className={`centre-tree-row ${isExpandable ? 'clickable' : ''}`}
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
        </span>
        <span className="centre-tree-stats">
          <span className="centre-stat total">{data.total || 0}</span>
          <span className="centre-stat present">{presentCount}</span>
          <span className="centre-stat inside">{insideCount}</span>
        </span>
      </div>
      
      {isOpen && hasDepts && (
        <div className="centre-depts">
          <div className="dept-header" style={{ paddingLeft: `${28 + level * 20}px` }}>
            <span>Department</span>
            <span>Total</span>
            <span>Present</span>
            <span>Inside</span>
          </div>
          {Object.entries(data.departments).map(([dept, deptData]) => (
            <div key={dept} className="dept-row" style={{ paddingLeft: `${28 + level * 20}px` }}>
              <span className="dept-name">{dept}</span>
              <span className="dept-stat">{deptData.sewadars?.length || 0}</span>
              <span className="dept-stat">{deptData.sewadars?.filter(s => presentSet.has(s.badge_number)).length || 0}</span>
              <span className="dept-stat">{deptData.sewadars?.filter(s => insideSet.has(s.badge_number)).length || 0}</span>
            </div>
          ))}
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
  const [today] = useState(new Date().toISOString().split('T')[0])
  
  const isASO = profile?.role === ROLES.SUPER_ADMIN
  const isCentreAdmin = profile?.role === ROLES.CENTRE_ADMIN
  const userCentre = profile?.centre

  const canViewAllCentres = profile?.role === ROLES.SUPER_ADMIN || profile?.role === ROLES.CENTRE_ADMIN

  const [stats, setStats] = useState({
    totalBadges: 0,
    presentToday: 0,
    currentlyInside: 0,
    permanentBadges: 0,
    openBadges: 0
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

  const fetchDashboard = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    try {
      // 1. Fetch centres
      const { data: centresData } = await supabase.from('centres').select('name, parent_centre').order('name')
      setCentresList(centresData || [])

      // 2. Get counts directly using count queries
      let countQuery = supabase.from('sewadars').select('badge_number', { count: 'exact', head: true })
      if (!canViewAllCentres && userCentre) {
        countQuery = countQuery.eq('centre', userCentre)
      }
      const { count: totalBadges } = await countQuery

      let permQuery = supabase.from('sewadars').select('badge_number', { count: 'exact', head: true })
        .eq('badge_status', 'PERMANENT')
      if (!canViewAllCentres && userCentre) {
        permQuery = permQuery.eq('centre', userCentre)
      }
      const { count: permanentBadges } = await permQuery

      let maleQuery = supabase.from('sewadars').select('badge_number', { count: 'exact', head: true }).eq('gender', 'Male')
      if (!canViewAllCentres && userCentre) {
        maleQuery = maleQuery.eq('centre', userCentre)
      }
      const { count: maleTotal } = await maleQuery

      let femaleQuery = supabase.from('sewadars').select('badge_number', { count: 'exact', head: true }).eq('gender', 'Female')
      if (!canViewAllCentres && userCentre) {
        femaleQuery = femaleQuery.eq('centre', userCentre)
      }
      const { count: femaleTotal } = await femaleQuery

      // 3. Today's sessions
      const { data: todaySessions } = await supabase
        .from('attendance_sessions')
        .select('badge_number')
        .eq('in_date', today)

      // 4. Open sessions
      const { data: openSessions } = await supabase
        .from('attendance_sessions')
        .select('badge_number')
        .eq('status', 'OPEN')

      // 5. Get all sewadars
      let sewadarQuery = supabase.from('sewadars').select('*')
      if (!canViewAllCentres && userCentre) {
        sewadarQuery = sewadarQuery.eq('centre', userCentre)
      }
      const { data: sewadars } = await sewadarQuery

      const localPresentSet = new Set((todaySessions || []).map(s => s.badge_number))
      const localInsideSet = new Set((openSessions || []).map(s => s.badge_number))
      const scopeBadges = new Set(sewadars?.map(s => s.badge_number) || [])

      const presentInScope = [...localPresentSet].filter(b => scopeBadges.has(b))
      const insideInScope = [...localInsideSet].filter(b => scopeBadges.has(b))

      // 6. Build centre tree
      const centreMap = {}
      const rootCentres = []
      
      // Initialize all centres
      for (const c of (centresData || [])) {
        centreMap[c.name] = {
          name: c.name,
          parent: c.parent_centre,
          total: 0,
          sewadars: [],
          departments: {},
          children: []
        }
      }

      // Assign sewadars to centres
      for (const s of (sewadars || [])) {
        const centre = centreMap[s.centre]
        if (centre) {
          centre.sewadars.push(s)
          centre.total++
          
          const dept = s.department || 'UNKNOWN'
          if (!centre.departments[dept]) {
            centre.departments[dept] = { sewadars: [] }
          }
          centre.departments[dept].sewadars.push(s)
        }
      }

      // Build hierarchy
      for (const [name, data] of Object.entries(centreMap)) {
        if (data.parent && centreMap[data.parent]) {
          centreMap[data.parent].children.push(data)
        } else {
          rootCentres.push(data)
        }
      }

      // Sort A-Z by name
      const sortAZ = (arr) => {
        arr.sort((a, b) => a.name.localeCompare(b.name))
        for (const item of arr) {
          if (item.children.length > 0) sortAZ(item.children)
        }
      }
      sortAZ(rootCentres)

      // Department stats
      const deptMap = {}
      for (const s of (sewadars || [])) {
        const dept = s.department || 'UNKNOWN'
        if (!deptMap[dept]) {
          deptMap[dept] = { total: 0, present: 0, inside: 0, permanent: 0, open: 0 }
        }
        deptMap[dept].total++
        if (s.badge_status === 'PERMANENT') deptMap[dept].permanent++
        else deptMap[dept].open++
        if (localPresentSet.has(s.badge_number)) deptMap[dept].present++
        if (localInsideSet.has(s.badge_number)) deptMap[dept].inside++
      }

      // Gender stats
      let malePresentCount = 0, femalePresentCount = 0
      let maleInsideCount = 0, femaleInsideCount = 0
      let malePermanentCount = 0, femalePermanentCount = 0
      let maleOpenCount = 0, femaleOpenCount = 0

      for (const s of (sewadars || [])) {
        const gender = s.gender?.toUpperCase() || ''
        if (gender === 'MALE') {
          if (localPresentSet.has(s.badge_number)) malePresentCount++
          if (localInsideSet.has(s.badge_number)) maleInsideCount++
          if (s.badge_status === 'PERMANENT') malePermanentCount++
          else maleOpenCount++
        } else {
          if (localPresentSet.has(s.badge_number)) femalePresentCount++
          if (localInsideSet.has(s.badge_number)) femaleInsideCount++
          if (s.badge_status === 'PERMANENT') femalePermanentCount++
          else femaleOpenCount++
        }
      }

      setStats({
        totalBadges: totalBadges || 0,
        presentToday: presentInScope.length,
        currentlyInside: insideInScope.length,
        permanentBadges: permanentBadges || 0,
        openBadges: (totalBadges || 0) - (permanentBadges || 0)
      })

      setPresentSet(localPresentSet)
      setInsideSet(localInsideSet)
      setCentreTree(rootCentres)
      setDeptStats(Object.entries(deptMap).sort((a, b) => b[1].total - a[1].total))

      setGenderStats({
        male: { total: maleTotal || 0, present: malePresentCount, inside: maleInsideCount, permanent: malePermanentCount, open: maleOpenCount },
        female: { total: femaleTotal || 0, present: femalePresentCount, inside: femaleInsideCount, permanent: femalePermanentCount, open: femaleOpenCount }
      })

      // Jatha stats
      const { data: jathaToday } = await supabase
        .from('jatha_attendance')
        .select('badge_number')
        .or(`and(from_date.lte.${today},to_date.gte.${today})`)

      const jathaBadges = new Set(jathaToday?.map(j => j.badge_number) || [])
      const jathaInScope = [...jathaBadges].filter(b => scopeBadges.has(b))
      const jathaPresent = jathaInScope.filter(b => localPresentSet.has(b))

      setJathaStats({ total: jathaInScope.length, present: jathaPresent.length })

    } catch (err) {
      console.error('Dashboard error:', err)
    }

    setLoading(false)
    setRefreshing(false)
  }, [today, canViewAllCentres, userCentre])

  useEffect(() => { fetchDashboard() }, [fetchDashboard])

  const totalPercent = stats.totalBadges > 0 ? Math.round(stats.presentToday / stats.totalBadges * 100) : 0
  const presentPercent = stats.presentToday > 0 ? Math.round(stats.currentlyInside / stats.presentToday * 100) : 0

  return (
    <div className="page-full pb-nav">
      <div className="header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2>Dashboard</h2>
          <button className="refresh-btn" onClick={() => fetchDashboard(true)} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
          </button>
        </div>
        <div className="header-date"><Calendar size={14} />{formatDateIndian(today)} {userCentre && !canViewAllCentres && `- ${userCentre}`}</div>
      </div>

      {/* Main Stats */}
      <div className="dash-stats-grid">
        <StatCard icon={Users} label="Total Badges" value={stats.totalBadges} color="blue" loading={loading} />
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
          headers={['Status', 'Total', 'OPEN', 'PERMANENT']}
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
