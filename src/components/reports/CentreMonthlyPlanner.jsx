import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase, getLocalDate } from '../../lib/supabase'
import { ChevronLeft, ChevronRight, ChevronDown, Printer, Calendar, MapPin } from 'lucide-react'
import { getDeptColor, getDeptAbbr, getCentreAbbr } from '../../lib/deptColors'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month - 1, 1).getDay()
}

function centreMatches(entryCentre, filterCentre) {
  if (entryCentre === filterCentre) return true
  return (entryCentre || '').split(' & ').includes(filterCentre)
}

function buildDayMap(bhatiData, specificData, month, year) {
  const dayMap = new Map()
  const daysInMonth = getDaysInMonth(year, month)

  const push = (dateStr, entry) => {
    if (!dayMap.has(dateStr)) dayMap.set(dateStr, [])
    dayMap.get(dateStr).push(entry)
  }

  for (const sched of bhatiData) {
    const entries = sched.jatha_schedule_entries || []
    for (const e of entries) {
      if (e.day_of_week == null) continue
      for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(year, month - 1, d)
        if (date.getDay() === e.day_of_week) {
          push(getLocalDate(date), {
            department: e.department,
            centre: e.centre,
            count: e.count,
            kind: 'bhati',
            title: sched.title,
          })
        }
      }
    }
  }

  for (const sched of specificData) {
    const entries = sched.jatha_schedule_entries || []
    const fromDate = sched.from_date
    const toDate = sched.to_date
    if (!fromDate || !toDate) continue
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      if (dateStr >= fromDate && dateStr <= toDate) {
        for (const e of entries) {
          if (e.day_of_week != null && new Date(year, month - 1, d).getDay() !== e.day_of_week) continue
          push(dateStr, {
            department: e.department,
            centre: e.centre,
            count: e.count,
            kind: 'specific',
            location: sched.location,
            title: sched.title,
          })
        }
      }
    }
  }

  return dayMap
}

export default function CentreMonthlyPlanner({ profile, refreshTrigger }) {
  const isAsoView = profile?.role === 'aso' || profile?.role === 'super_admin'
  const userCentre = profile?.centre
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [loading, setLoading] = useState(true)
  const [bhatiData, setBhatiData] = useState([])
  const [specificData, setSpecificData] = useState([])
  const [allCentres, setAllCentres] = useState([])
  const [centreTab, setCentreTab] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')
  const [centreFilter, setCentreFilter] = useState(null)
  const [deptFilter, setDeptFilter] = useState(null)
  const [tooltip, setTooltip] = useState({ show: false, items: [], color: '', x: 0, y: 0 })
  const [filtersVisible, setFiltersVisible] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
      const monthEnd = getLocalDate(new Date(year, month, 0))

      const [{ data: bhati }, { data: specific }] = await Promise.all([
        supabase
          .from('jatha_schedules')
          .select('*, jatha_schedule_entries(*)')
          .eq('schedule_type', 'bhati')
          .eq('month', month)
          .eq('year', year),
        supabase
          .from('jatha_schedules')
          .select('*, jatha_schedule_entries(*)')
          .eq('schedule_type', 'specific')
          .lte('from_date', monthEnd)
          .gte('to_date', monthStart),
      ])

      setBhatiData(bhati || [])
      setSpecificData(specific || [])
    } catch (err) {
      console.error('Failed to fetch planner data:', err)
    }
    setLoading(false)
  }, [month, year, refreshTrigger])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    if (isAsoView && allCentres.length === 0) {
      supabase.rpc('get_user_accessible_centres').then(({ data }) => {
        setAllCentres((data || []).map(c => c.centre_name).sort())
      })
    }
  }, [isAsoView])

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }

  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  const dayMap = useMemo(() => buildDayMap(bhatiData, specificData, month, year), [bhatiData, specificData, month, year])

  const centreNamesInData = [...new Set([...dayMap.values()].flat().map(e => e.centre).filter(Boolean))].sort()

  const filteredDayMap = new Map()
  for (const [dateStr, entries] of dayMap) {
    let filtered = entries
    if (centreTab) filtered = filtered.filter(e => centreMatches(e.centre || e.location, centreTab))
    if (typeFilter !== 'all') filtered = filtered.filter(e => e.kind === typeFilter)
    if (centreFilter) filtered = filtered.filter(e => centreMatches(e.centre || e.location, centreFilter))
    if (deptFilter) filtered = filtered.filter(e => e.department === deptFilter)
    if (!isAsoView && userCentre) filtered = filtered.filter(e => centreMatches(e.centre, userCentre))
    if (filtered.length > 0) filteredDayMap.set(dateStr, filtered)
  }

  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfMonth(year, month)

  const calendarCells = []
  const leadingEmpty = firstDay
  for (let i = 0; i < leadingEmpty; i++) {
    calendarCells.push({ date: null, entries: null })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    calendarCells.push({ date: new Date(year, month - 1, d), entries: filteredDayMap.get(dateStr) || [] })
  }
  while (calendarCells.length % 7 !== 0) {
    calendarCells.push({ date: null, entries: null })
  }

  const allDepartments = new Set()
  for (const [, entries] of filteredDayMap) {
    for (const e of entries) {
      if (e.department) allDepartments.add(e.department)
    }
  }
  const activeDepartments = [...allDepartments].sort()

  let totalSewadars = 0
  for (const [, entries] of filteredDayMap) {
    for (const e of entries) totalSewadars += e.count || 0
  }

  const hasData = filteredDayMap.size > 0

  const allPlannerDepts = [...new Set([...bhatiData, ...specificData].flatMap(s => (s.jatha_schedule_entries || []).map(e => e.department).filter(Boolean)))].sort()

  function buildCentreDayMap(entriesByDate, centreName) {
    const cm = new Map()
    for (const [dateStr, entries] of entriesByDate) {
      const filtered = entries.filter(e => centreMatches(e.centre, centreName))
      if (filtered.length > 0) cm.set(dateStr, filtered)
    }
    return cm
  }

  function renderGridFromDayMap(sourceMap) {
    const cells = []
    for (let i = 0; i < firstDay; i++) cells.push({ date: null, entries: null })
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      cells.push({ date: new Date(year, month - 1, d), entries: sourceMap.get(dateStr) || [] })
    }
    while (cells.length % 7 !== 0) cells.push({ date: null, entries: null })
    return cells
  }

  const centrePrintSections = centreNamesInData.map(cn => {
    const cm = buildCentreDayMap(filteredDayMap, cn)
    const totalForCentre = [...cm.values()].reduce((s, ee) => s + ee.reduce((a, e) => a + (e.count || 0), 0), 0)
    const depts = [...new Set([...cm.values()].flat().map(e => e.department).filter(Boolean))].sort()
    const gridCells = renderGridFromDayMap(cm)
    const centreHasData = cm.size > 0
    return { centre: cn, dayMap: cm, total: totalForCentre, departments: depts, gridCells, hasData: centreHasData }
  }).filter(cs => cs.hasData)

  function renderCompactEntries(entries) {
    const deptMap = {}
    const centreMap = {}
    for (const e of entries) {
      const d = e.department || 'General'
      if (!deptMap[d]) { deptMap[d] = 0; centreMap[d] = [] }
      deptMap[d] += e.count || 0
      const c = e.centre || 'Unknown'
      const existing = centreMap[d].find(x => x.centre === c)
      if (existing) existing.count += e.count || 0
      else centreMap[d].push({ centre: c, count: e.count || 0 })
    }
    return Object.entries(deptMap).map(([dept, count]) => {
      const color = getDeptColor(dept)
      return (
        <span key={dept} className="compact-dept" style={{ color }}
          onMouseEnter={e => setTooltip({ show: true, items: centreMap[dept], color, x: e.clientX, y: e.clientY })}
          onMouseLeave={() => setTooltip({ show: false, items: [], color: '', x: 0, y: 0 })}>
          {getDeptAbbr(dept)}:{count}
        </span>
      )
    })
  }

  function renderGroupedEntries(entries) {
    const groups = {}
    for (const e of entries) {
      const label = e.kind === 'specific' ? (e.location || '—') : ((e.title || '').split(' - ')[0] || '—')
      if (!groups[label]) groups[label] = { label, depts: {} }
      const d = e.department || 'General'
      if (!groups[label].depts[d]) groups[label].depts[d] = { abbr: getDeptAbbr(d), dept: d, count: 0, centres: [] }
      groups[label].depts[d].count += e.count || 0
      const c = e.centre || 'Unknown'
      const existing = groups[label].depts[d].centres.find(x => x.centre === c)
      if (existing) existing.count += e.count || 0
      else groups[label].depts[d].centres.push({ centre: c, count: e.count || 0 })
    }
    return Object.values(groups).map((g, i) => {
      const color = getDeptColor(g.label)
      return (
        <div key={i} className="planner-entry" style={{ borderLeftColor: color }}>
          <span className="entry-label" style={{ color }}>{g.label.toUpperCase()}</span>
          {Object.values(g.depts).map(d => {
            const dc = getDeptColor(d.dept)
            return (
              <span key={d.dept} className="compact-dept" style={{ color: dc }}
                onMouseEnter={e => setTooltip({ show: true, items: d.centres, color: dc, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setTooltip({ show: false, items: [], color: '', x: 0, y: 0 })}>
                {d.abbr}:{d.count}
              </span>
            )
          })}
        </div>
      )
    })
  }

  return (
    <div className="monthly-planner">
      <div className="planner-header-bar">
        <div className="planner-nav">
          <button className="planner-nav-btn" onClick={prevMonth}><ChevronLeft size={18} /></button>
          <h3 className="planner-nav-label">{MONTHS[month - 1]} {year}</h3>
          <button className="planner-nav-btn" onClick={nextMonth}><ChevronRight size={18} /></button>
        </div>
        <div className="planner-actions">
          <button className="planner-print-btn" onClick={() => window.print()}>
            <Printer size={16} /> Print / PDF
          </button>
        </div>
      </div>

      {isAsoView && (
        <>
          <button className="planner-filter-toggle" onClick={() => setFiltersVisible(v => !v)}>
            {filtersVisible ? 'Hide' : 'Show'} Filters
            <ChevronDown size={14} className={`filter-chevron${filtersVisible ? ' open' : ''}`} />
          </button>
          {filtersVisible && (
            <div className="planner-filters">
              <div className="planner-filter-group">
                <span className="filter-label">Type</span>
                <button className={`filter-chip${typeFilter === 'all' ? ' active' : ''}`} onClick={() => setTypeFilter('all')}>All</button>
                <button className={`filter-chip${typeFilter === 'bhati' ? ' active' : ''}`} onClick={() => setTypeFilter('bhati')}>BHATI</button>
                <button className={`filter-chip${typeFilter === 'specific' ? ' active' : ''}`} onClick={() => setTypeFilter('specific')}>SPECIFIC</button>
              </div>
              <div className="planner-filter-group">
                <span className="filter-label">Centre</span>
                <button className={`filter-chip${!centreFilter ? ' active' : ''}`} onClick={() => setCentreFilter(null)}>All</button>
                {allCentres.map(c => (
                  <button key={c} className={`filter-chip${centreFilter === c ? ' active' : ''}`} onClick={() => setCentreFilter(centreFilter === c ? null : c)}>{getCentreAbbr(c)}</button>
                ))}
              </div>
              {allPlannerDepts.length > 0 && (
                <div className="planner-filter-group">
                  <span className="filter-label">Dept</span>
                  <button className={`filter-chip${!deptFilter ? ' active' : ''}`} onClick={() => setDeptFilter(null)}>All</button>
                  {allPlannerDepts.map(d => (
                    <button key={d} className={`filter-chip${deptFilter === d ? ' active' : ''}`} onClick={() => setDeptFilter(deptFilter === d ? null : d)}>{getDeptAbbr(d)}</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {loading ? (
        <div className="report-loading">
          <div className="spin" style={{ width: 24, height: 24, border: '3px solid var(--border)', borderTopColor: 'var(--excel-green)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <p>Loading planner...</p>
        </div>
      ) : !hasData ? (
        <div className="planner-empty">
          <Calendar size={32} />
          <p>No duties scheduled for {MONTHS[month - 1]} {year}</p>
        </div>
      ) : (<>
        {!isAsoView && userCentre && (
          <div className="planner-centre-header">
            <MapPin size={14} /> {userCentre}
          </div>
        )}

        <div className="planner-grid">
          {WEEKDAYS.map(d => <div key={d} className="planner-weekday">{d}</div>)}
          {calendarCells.map((cell, i) => (
            <div key={i} className={`planner-day${!cell.date || !cell.entries?.length ? ' empty' : ''}`}>
              {cell.date && <div className="planner-date-num">{cell.date.getDate()}</div>}
              {cell.entries?.length > 0 && (isAsoView ? renderGroupedEntries(cell.entries) : renderCompactEntries(cell.entries))}
            </div>
          ))}
        </div>

      </>)}

      {hasData && (
        <div className="planner-footer">
          {totalSewadars} sewadars assigned across {activeDepartments.length} department{activeDepartments.length !== 1 ? 's' : ''}
        </div>
      )}

      {centrePrintSections.length > 0 && (
        <div className="planner-print-sections">
          {centrePrintSections.map((cs, idx) => (
            <div key={idx} className="planner-print-section">
              <h4 className="print-centre-header">{cs.centre}</h4>
              {cs.departments.length > 0 && (
                <div className="print-legend">
                  {cs.departments.map(dept => (
                    <span key={dept} className="legend-item">
                      <span className="legend-swatch" style={{ background: getDeptColor(dept) }} />
                      {dept}
                    </span>
                  ))}
                </div>
              )}
              <div className="print-grid">
                {WEEKDAYS.map(d => <div key={d} className="planner-weekday">{d}</div>)}
                {cs.gridCells.map((cell, i) => (
                  <div key={i} className={`planner-day${!cell.date || !cell.entries?.length ? ' empty' : ''}`}>
                    {cell.date && <div className="planner-date-num">{cell.date.getDate()}</div>}
                    {cell.entries?.length > 0 && renderCompactEntries(cell.entries)}
                  </div>
                ))}
              </div>
              {cs.total > 0 && (
                <div className="planner-total-bar">{cs.total} sewadars — {cs.departments.length} department{cs.departments.length !== 1 ? 's' : ''}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {tooltip.show && (
        <div className="planner-tooltip" style={{ left: tooltip.x + 10, top: tooltip.y - 10 }}>
          <div className="planner-tooltip-header" style={{ backgroundColor: tooltip.color }}>
            Centre Details
          </div>
          <div className="planner-tooltip-list">
            {tooltip.items.map((item, i) => (
              <div key={i} className="planner-tooltip-row">
                <span className="planner-tooltip-name">{item.centre}</span>
                <span className="planner-tooltip-count" style={{ color: tooltip.color }}>{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
