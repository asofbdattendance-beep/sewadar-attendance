import { useState, useEffect, useCallback } from 'react'
import { supabase, getLocalDate } from '../../lib/supabase'
import { ChevronLeft, ChevronRight, Printer, MapPin, Calendar } from 'lucide-react'
import { getDeptColor } from '../../lib/deptColors'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

function getFirstDayOfMonth(year, month) {
  return new Date(year, month - 1, 1).getDay()
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
            jatha_type: e.jatha_type || 'major_centre',
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

export default function CentreMonthlyPlanner({ profile }) {
  const isAsoView = profile?.role === 'aso' || profile?.role === 'super_admin'
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [loading, setLoading] = useState(true)
  const [bhatiData, setBhatiData] = useState([])
  const [specificData, setSpecificData] = useState([])

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
  }, [month, year])

  useEffect(() => { fetchData() }, [fetchData])

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }

  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  const dayMap = buildDayMap(bhatiData, specificData, month, year)
  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfMonth(year, month)

  const calendarCells = []
  const leadingEmpty = firstDay === 0 ? 6 : firstDay - 1
  for (let i = 0; i < leadingEmpty; i++) {
    calendarCells.push({ date: null, entries: null })
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    calendarCells.push({ date: new Date(year, month - 1, d), entries: dayMap.get(dateStr) || [] })
  }
  while (calendarCells.length % 7 !== 0) {
    calendarCells.push({ date: null, entries: null })
  }

  const allDepartments = new Set()
  for (const [, entries] of dayMap) {
    for (const e of entries) {
      if (e.department) allDepartments.add(e.department)
    }
  }
  const activeDepartments = [...allDepartments].sort()

  let totalSewadars = 0
  for (const [, entries] of dayMap) {
    for (const e of entries) totalSewadars += e.count || 0
  }

  const hasData = bhatiData.length > 0 || specificData.length > 0

  function renderCentreEntries(entries) {
    return entries.map((e, j) => (
      <div
        key={j}
        className="planner-entry"
        style={{ borderLeftColor: getDeptColor(e.department || '') }}
      >
        {e.kind === 'specific' && (
          <span className="entry-tag"><MapPin size={10} /> {e.location || 'Specific'}</span>
        )}
        <div className="entry-dept">{e.department || 'General'}</div>
        <div className="entry-detail">{e.count}</div>
      </div>
    ))
  }

  function renderAsoEntries(entries) {
    const groups = {}
    for (const e of entries) {
      const dept = e.department || 'General'
      if (!groups[dept]) groups[dept] = {}
      const loc = e.centre || e.location || 'Unknown'
      if (!groups[dept][loc]) groups[dept][loc] = { count: 0, kind: e.kind, location: e.location }
      groups[dept][loc].count += e.count || 0
    }
    return Object.entries(groups).map(([dept, centres]) => (
      <div
        key={dept}
        className="planner-entry-group"
        style={{ borderLeftColor: getDeptColor(dept) }}
      >
        <div className="entry-dept">{dept}</div>
        {Object.entries(centres).map(([loc, data]) => (
          <div key={loc} className="entry-centre-row">
            <span className="entry-centre-name">{loc}</span>
            <span className="entry-centre-count">{data.count}</span>
          </div>
        ))}
      </div>
    ))
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
      ) : (
        <div className="planner-grid">
          {WEEKDAYS.map(d => (
            <div key={d} className="planner-weekday">{d}</div>
          ))}
          {calendarCells.map((cell, i) => {
            const isEmpty = !cell.date || !cell.entries?.length
            return (
              <div
                key={i}
                className={`planner-day${isEmpty ? ' empty' : ''}`}
              >
                {cell.date && <div className="planner-date-num">{cell.date.getDate()}</div>}
                {!isEmpty && (isAsoView ? renderAsoEntries(cell.entries) : renderCentreEntries(cell.entries))}
              </div>
            )
          })}
        </div>
      )}

      {hasData && (
        <div className="planner-footer">
          {totalSewadars} sewadars assigned this month across {activeDepartments.length} department{activeDepartments.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  )
}
