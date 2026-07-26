import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { supabase, getLocalDate } from '../../lib/supabase'
import { ChevronLeft, ChevronRight, ChevronDown, Printer, Calendar, MapPin, Edit3 } from 'lucide-react'
import { getDeptColor, getDeptAbbr, getCentreAbbr, getLabelColor } from '../../lib/deptColors'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const fmtDate = (d) => { if (!d) return ''; const [y, m, day] = d.split('-'); return `${parseInt(day)}-${m}-${y}` }

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
            schedule_type: 'bhati',
            schedule_id: sched.id,
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
    const monthStart = `${year}-${String(month).padStart(2, '0')}-01`
    const monthEnd = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`
    const effectiveStart = fromDate < monthStart ? monthStart : fromDate
    if (effectiveStart > monthEnd) continue
    const dateObj = new Date(`${effectiveStart}T00:00:00`)
    for (const e of entries) {
      if (e.day_of_week != null && dateObj.getDay() !== e.day_of_week) continue
      push(effectiveStart, {
        department: e.department,
        centre: e.centre,
        count: e.count,
        kind: 'specific',
        location: sched.location,
        title: sched.title,
        schedule_type: 'specific',
        from_date: fromDate,
        to_date: toDate,
        schedule_id: sched.id,
      })
    }
  }

  return dayMap
}

export default function CentreMonthlyPlanner({ profile, refreshTrigger, onEditSchedule }) {
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
  const [destFilter, setDestFilter] = useState('all')
  const [centreFilter, setCentreFilter] = useState(null)
  const [deptFilter, setDeptFilter] = useState(null)
  const [tooltip, setTooltip] = useState({ show: false, items: [], color: '', x: 0, y: 0, header: '', key: '', from_date: null, to_date: null, total: 0, scheduleId: null })
  const [filtersVisible, setFiltersVisible] = useState(true)
  const [touchStartX, setTouchStartX] = useState(0)
  const [touchStartY, setTouchStartY] = useState(0)
  const agendaRef = useRef(null)

  const clampTooltip = useCallback(node => {
    if (!node) return
    const rect = node.getBoundingClientRect()
    let left = parseInt(node.style.left, 10) || 0
    let top = parseInt(node.style.top, 10) || 0

    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8
    if (left < 8) left = 8

    const visibleTop = top - rect.height
    if (visibleTop < 8) top = 8 + rect.height
    if (top > window.innerHeight - 8) top = window.innerHeight - 8

    node.style.left = left + 'px'
    node.style.top = top + 'px'
  }, [])

  const clearTooltip = useCallback(() => setTooltip({ show: false, items: [], color: '', x: 0, y: 0, header: '', key: '', from_date: null, to_date: null, total: 0, scheduleId: null }), [])

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
      supabase.from('centres').select('name').is('parent_centre', null).order('name').then(({ data }) => {
        setAllCentres((data || []).map(c => c.name))
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

  const destLabels = useMemo(() => {
    const labels = new Set()
    for (const [, entries] of dayMap) {
      for (const e of entries) {
        labels.add(e.kind === 'specific' ? (e.location || '—') : ((e.title || '').split(' - ')[0] || '—'))
      }
    }
    return [...labels].sort()
  }, [dayMap])

  const filteredDayMap = new Map()
  for (const [dateStr, entries] of dayMap) {
    let filtered = entries
    if (centreTab) filtered = filtered.filter(e => centreMatches(e.centre || e.location, centreTab))
    if (destFilter !== 'all') {
      filtered = filtered.filter(e => {
        const label = e.kind === 'specific' ? (e.location || '—') : ((e.title || '').split(' - ')[0] || '—')
        return label === destFilter
      })
    }
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

  function renderGroupedEntries(entries) {
    const groups = {}
    for (const e of entries) {
      const label = e.kind === 'specific' ? (e.location || '—') : ((e.title || '').split(' - ')[0] || '—')
      if (!groups[label]) groups[label] = { label, depts: {}, from_date: null, to_date: null, title: e.title || label, scheduleId: e.schedule_id }
      const d = e.department || 'General'
      if (!groups[label].depts[d]) groups[label].depts[d] = { abbr: getDeptAbbr(d), dept: d, count: 0, entries: [] }
      groups[label].depts[d].count += e.count || 0
      groups[label].depts[d].entries.push(e)
      if (e.from_date) groups[label].from_date = e.from_date
      if (e.to_date) groups[label].to_date = e.to_date
      if (e.schedule_id) groups[label].scheduleId = e.schedule_id
    }
    return Object.values(groups).map((g, i) => {
      const color = getLabelColor(g.label)
      const groupTotal = Object.values(g.depts).reduce((s, d) => s + d.count, 0)
      const groupTooltipItems = Object.values(g.depts).map(d => ({ centre: isAsoView ? `${d.abbr}` : `${g.label} - ${d.dept}`, count: d.count, from_date: g.from_date, to_date: g.to_date }))
      const isSpecificGroup = g.from_date != null
      const groupHeader = isSpecificGroup
        ? `${g.label}${g.from_date ? ` (${fmtDate(g.from_date)} – ${fmtDate(g.to_date)})` : ''}`
        : (g.title || g.label)
      return (
        <div key={i} className="planner-entry-group" style={{ borderLeftColor: color, background: `${color}18` }}
          onClick={e => {
            const k = `group-${g.label}`
            if (tooltip.show && tooltip.key === k) { clearTooltip(); return }
            setTooltip({ show: true, items: groupTooltipItems, color, x: e.clientX, y: e.clientY, header: groupHeader, key: k, from_date: g.from_date, to_date: g.to_date, total: groupTotal, scheduleId: g.scheduleId })
          }}>
          <div className="planner-group-label" style={{ color }}>{g.label.toUpperCase()}</div>
          <div className="planner-group-depts">
            {Object.values(g.depts).map(d => {
              const dc = getDeptColor(d.dept)
              const deptTotal = d.entries.reduce((s, e) => s + (e.count || 0), 0)
              const tooltipItems = isAsoView
                ? Object.entries(d.entries.reduce((acc, e) => {
                    const key = e.centre || '—'
                    acc[key] = (acc[key] || 0) + (e.count || 0)
                    return acc
                  }, {})).map(([centre, count]) => ({ centre, count, from_date: g.from_date, to_date: g.to_date }))
                : [{ centre: `${g.label} - ${d.dept}`, count: d.count, from_date: g.from_date, to_date: g.to_date }]
              return (
                <span key={d.dept} className="dept-pill" style={{ background: `${dc}18`, color: dc }}
                  onMouseEnter={e => setTooltip({ show: true, items: tooltipItems, color: dc, x: e.clientX, y: e.clientY, header: `${groupHeader} — ${d.dept}`, key: '', from_date: g.from_date, to_date: g.to_date, total: deptTotal })}
                  onMouseLeave={clearTooltip}
                  onClick={e => {
                    e.stopPropagation()
                    const k = `${g.label}-${d.dept}`
                    if (tooltip.show && tooltip.key === k) { clearTooltip(); return }
                    setTooltip({ show: true, items: tooltipItems, color: dc, x: e.clientX, y: e.clientY, header: `${groupHeader} — ${d.dept}`, key: k, from_date: g.from_date, to_date: g.to_date, total: deptTotal })
                  }}>
                  {d.abbr}:{d.count}
                </span>
              )
            })}
          </div>
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

      <button className="planner-filter-toggle" onClick={() => setFiltersVisible(v => !v)}>
        {filtersVisible ? 'Hide' : 'Show'} Filters
        <ChevronDown size={14} className={`filter-chevron${filtersVisible ? ' open' : ''}`} />
      </button>
      {filtersVisible && (
        <div className="planner-filters">
          <div className="planner-filter-group">
            <span className="filter-label">Destination</span>
            <button className={`filter-chip${destFilter === 'all' ? ' active' : ''}`} onClick={() => setDestFilter('all')}>All</button>
            {destLabels.map(label => (
              <button key={label} className={`filter-chip${destFilter === label ? ' active' : ''}`} onClick={() => setDestFilter(destFilter === label ? 'all' : label)}>{label}</button>
            ))}
          </div>
          {isAsoView && (
            <div className="planner-filter-group">
              <span className="filter-label">Centre</span>
              <button className={`filter-chip${!centreFilter ? ' active' : ''}`} onClick={() => setCentreFilter(null)}>All</button>
              {allCentres.map(c => (
                <button key={c} className={`filter-chip${centreFilter === c ? ' active' : ''}`} onClick={() => setCentreFilter(centreFilter === c ? null : c)}>{getCentreAbbr(c)}</button>
              ))}
            </div>
          )}
          {activeDepartments.length > 0 && (
            <div className="planner-filter-group">
              <span className="filter-label">Dept</span>
              <button className={`filter-chip${!deptFilter ? ' active' : ''}`} onClick={() => setDeptFilter(null)}>All</button>
              {activeDepartments.map(d => (
                <button key={d} className={`filter-chip${deptFilter === d ? ' active' : ''}`} onClick={() => setDeptFilter(deptFilter === d ? null : d)}>{getDeptAbbr(d)}</button>
              ))}
            </div>
          )}
        </div>
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

        <div className="planner-grid-wrapper">
          {activeDepartments.length > 0 && (
            <div className="planner-legend">
              {activeDepartments.map(dept => (
                <span key={dept} className="legend-item">
                  <span className="legend-swatch" style={{ background: getDeptColor(dept) }} />
                  {dept}
                </span>
              ))}
            </div>
          )}
          <div className="planner-grid">
            {WEEKDAYS.map(d => <div key={d} className="planner-weekday">{d}</div>)}
            {calendarCells.map((cell, i) => (
              <div key={i} className={`planner-day${!cell.date || !cell.entries?.length ? ' empty' : ''}`}>
                {cell.date && <div className="planner-date-num">{cell.date.getDate()}</div>}
                {cell.entries?.length > 0 && renderGroupedEntries(cell.entries)}
              </div>
            ))}
          </div>
        </div>

        <div className="planner-agenda" ref={agendaRef}
          onTouchStart={e => { setTouchStartX(e.touches[0].clientX); setTouchStartY(e.touches[0].clientY) }}
          onTouchEnd={e => {
            const dx = e.changedTouches[0].clientX - touchStartX
            const dy = e.changedTouches[0].clientY - touchStartY
            if (Math.abs(dx) > 50 && Math.abs(dy) < 100) {
              clearTooltip()
              dx > 0 ? prevMonth() : nextMonth()
            }
          }}>
          {calendarCells.filter(c => c.date && c.entries?.length > 0).map(cell => {
            const dayName = WEEKDAYS[cell.date.getDay()]
            const dayTotal = cell.entries.reduce((s, e) => s + (e.count || 0), 0)
            const today = new Date()
            const isToday = cell.date.getDate() === today.getDate() &&
              cell.date.getMonth() === today.getMonth() &&
              cell.date.getFullYear() === today.getFullYear()
            return (
              <div key={cell.date.toISOString()} className={`agenda-day${isToday ? ' agenda-day--today' : ''}`}>
                <div className="agenda-day-label">
                  <span>{dayName} {cell.date.getDate()} {MONTHS[month - 1]}</span>
                  <span className="agenda-day-total">{dayTotal}</span>
                </div>
                <div className="agenda-entries">
                  {renderGroupedEntries(cell.entries)}
                </div>
              </div>
            )
          })}
        </div>

      </>)}

      {hasData && (
        <div className="planner-footer">
          {totalSewadars} sewadars assigned across {activeDepartments.length} department{activeDepartments.length !== 1 ? 's' : ''}
        </div>
      )}

      {tooltip.show && (
        <>
          {tooltip.key && <div className="planner-tooltip-backdrop" onClick={() => setTooltip({ show: false, items: [], color: '', x: 0, y: 0, header: '', key: '', from_date: null, to_date: null, total: 0, scheduleId: null })} />}
          <div className="planner-tooltip" ref={clampTooltip} style={{ left: tooltip.x + 10, top: tooltip.y - 10 }}>
            <div className="planner-tooltip-header" style={{ backgroundColor: tooltip.color }}>
              {tooltip.header}
              {tooltip.scheduleId && onEditSchedule && (
                <button className="tooltip-edit-btn" onClick={(e) => { e.stopPropagation(); clearTooltip(); onEditSchedule(tooltip.scheduleId) }} title="Edit schedule">
                  <Edit3 size={12} />
                </button>
              )}
            </div>
            {(tooltip.from_date || tooltip.to_date) && (
              <div className="planner-tooltip-dates">
                <span className="tooltip-date-row">
                  {tooltip.from_date && <span>From: <strong>{fmtDate(tooltip.from_date)}</strong></span>}
                  {tooltip.to_date && <span>To: <strong>{fmtDate(tooltip.to_date)}</strong></span>}
                  {tooltip.total > 0 && <span className="tooltip-total-badge">Total: <strong>{tooltip.total}</strong></span>}
                </span>
              </div>
            )}
            <div className="planner-tooltip-list">
              {tooltip.items.map((item, i) => (
                <div key={i} className="planner-tooltip-row">
                  <span className="planner-tooltip-name">{item.name || item.centre}</span>
                  <span className="planner-tooltip-count" style={{ color: tooltip.color }}>{item.count}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
