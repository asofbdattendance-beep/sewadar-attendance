import { useState, useEffect, useCallback } from 'react'
import { supabase, ROLES, formatDateIndian, formatTime12Hour } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { 
  ChevronDown, Calendar, Download, FileSpreadsheet, FileText, 
  Users, UserCheck, Clock, AlertTriangle, UserX, Building, MapPin, RefreshCw, Settings, CheckCircle
} from 'lucide-react'

const REPORTS = {
  GATE: {
    id: 'gate',
    label: 'Gate',
    icon: Users,
    subReports: [
      { id: 'absenteeism', label: 'Absenteeism List', icon: UserX },
      { id: 'currently_inside', label: 'Currently Inside', icon: UserCheck },
      { id: 'late_coming', label: 'Late Coming', icon: AlertTriangle },
    ]
  },
  JATHA: {
    id: 'jatha',
    label: 'Jatha',
    icon: Users,
    subReports: [
      { id: 'jatha_attendance', label: 'Jatha Attendance', icon: Calendar },
    ]
  }
}

const LATE_THRESHOLD_DEFAULT = '10:00'

function DateRangePicker({ dateFrom, dateTo, onDateFromChange, onDateToChange }) {
  return (
    <div className="report-date-range">
      <div className="date-input-group">
        <label>From</label>
        <input 
          type="date" 
          value={dateFrom} 
          onChange={(e) => onDateFromChange(e.target.value)}
        />
      </div>
      <span className="date-separator">to</span>
      <div className="date-input-group">
        <label>To</label>
        <input 
          type="date" 
          value={dateTo} 
          onChange={(e) => onDateToChange(e.target.value)}
        />
      </div>
    </div>
  )
}

function ExportDropdown({ onExport, loading }) {
  const [open, setOpen] = useState(false)
  
  return (
    <div className="export-dropdown">
      <button 
        className="export-btn" 
        onClick={() => setOpen(!open)}
        disabled={loading}
      >
        <Download size={16} />
        Export
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="export-menu">
          <button onClick={() => { onExport('csv'); setOpen(false) }}>
            <FileSpreadsheet size={16} /> CSV
          </button>
          <button onClick={() => { onExport('excel'); setOpen(false) }}>
            <FileSpreadsheet size={16} /> Excel
          </button>
          <button onClick={() => { onExport('pdf'); setOpen(false) }}>
            <FileText size={16} /> PDF
          </button>
        </div>
      )}
    </div>
  )
}

function ReportTabs({ activeTab, onTabChange, tabs }) {
  return (
    <div className="report-main-tabs">
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={`report-tab ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function SubReportTabs({ activeSub, onSubChange, subReports }) {
  return (
    <div className="report-sub-tabs">
      {subReports.map(report => (
        <button
          key={report.id}
          className={`report-sub-tab ${activeSub === report.id ? 'active' : ''}`}
          onClick={() => onSubChange(report.id)}
        >
          {report.label}
        </button>
      ))}
    </div>
  )
}

function ReportTable({ headers, rows, emptyMessage = 'No data found' }) {
  if (rows.length === 0) {
    return (
      <div className="report-empty">
        <CheckCircle size={48} />
        <p>{emptyMessage}</p>
      </div>
    )
  }
  
  return (
    <div className="report-table-wrapper">
      <table className="report-table">
        <thead>
          <tr>
            {headers.map((h, i) => <th key={i}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {Array.isArray(row) ? (
                row.map((cell, j) => (
                  <td key={j} className={typeof cell === 'object' ? cell.className || '' : ''}>
                    {typeof cell === 'object' ? cell.value ?? cell : cell}
                  </td>
                ))
              ) : (
                Object.values(row).map((cell, j) => (
                  <td key={j} className={typeof cell === 'object' ? cell.className || '' : ''}>
                    {typeof cell === 'object' ? cell.value ?? cell : cell}
                  </td>
                ))
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SummaryCard({ title, value, subtitle, icon: Icon, color = 'blue' }) {
  return (
    <div className={`summary-card ${color}`}>
      <div className="summary-card-icon"><Icon size={24} /></div>
      <div className="summary-card-content">
        <div className="summary-card-value">{value}</div>
        <div className="summary-card-title">{title}</div>
        {subtitle && <div className="summary-card-sub">{subtitle}</div>}
      </div>
    </div>
  )
}

function ConfigModal({ open, onClose, title, children, onSave }) {
  if (!open) return null
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">{children}</div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={onSave}>Save</button>
        </div>
      </div>
    </div>
  )
}

export default function ReportsPage() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  
  const canViewAllCentres = profile?.role === ROLES.SUPER_ADMIN
  const userCentre = profile?.centre
  
  const today = new Date().toISOString().split('T')[0]
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  
  const [activeCategory, setActiveCategory] = useState('gate')
  const [activeReport, setActiveReport] = useState('absenteeism')
  const [dateFrom, setDateFrom] = useState(weekAgo)
  const [dateTo, setDateTo] = useState(today)
  
  const [reportData, setReportData] = useState([])
  const [reportSummary, setReportSummary] = useState({})
  
  const [lateThreshold, setLateThreshold] = useState(LATE_THRESHOLD_DEFAULT)
  const [showSettings, setShowSettings] = useState(false)

  const currentCategory = Object.values(REPORTS).find(c => c.id === activeCategory)
  const currentSubReports = currentCategory?.subReports || []

  const handleCategoryChange = (catId) => {
    setActiveCategory(catId)
    const cat = Object.values(REPORTS).find(c => c.id === catId)
    if (cat?.subReports[0]) {
      setActiveReport(cat.subReports[0].id)
    }
  }

  const handleSubReportChange = (reportId) => {
    setActiveReport(reportId)
  }

  const getWeekRange = (offset = 0) => {
    const now = new Date()
    const dayOfWeek = now.getDay()
    const startOfWeek = new Date(now)
    startOfWeek.setDate(now.getDate() - dayOfWeek + (offset * 7))
    const endOfWeek = new Date(startOfWeek)
    endOfWeek.setDate(startOfWeek.getDate() + 6)
    return {
      from: startOfWeek.toISOString().split('T')[0],
      to: endOfWeek.toISOString().split('T')[0]
    }
  }

  const fetchReport = useCallback(async () => {
const canViewAllCentres = profile?.role === ROLES.SUPER_ADMIN || profile?.role === ROLES.CENTRE_ADMIN
    const userCentre = profile?.centre
    
    setLoading(true)
    try {
      switch (activeReport) {
        case 'absenteeism':
          await fetchAbsenteeism(canViewAllCentres, userCentre)
          break
        case 'currently_inside':
          await fetchCurrentlyInside(canViewAllCentres, userCentre)
          break
        case 'gate_summary':
          await fetchGateSummary(canViewAllCentres, userCentre)
          break
        case 'late_coming':
          await fetchLateComing(canViewAllCentres, userCentre)
          break
        case 'missing_out':
          await fetchMissingOut(canViewAllCentres, userCentre)
          break
        case 'jatha_attendance':
          await fetchJathaAttendance(canViewAllCentres, userCentre)
          break
        case 'jatha_summary':
          await fetchJathaSummary(canViewAllCentres, userCentre)
          break
        case 'weekly_summary':
          await fetchWeeklySummary(canViewAllCentres, userCentre)
          break
        case 'department_wise':
          await fetchDepartmentWise(canViewAllCentres, userCentre)
          break
        case 'centre_wise':
          await fetchCentreWise(canViewAllCentres, userCentre)
          break
        default:
          setReportData([])
      }
    } catch (err) {
      console.error('Report fetch error:', err)
    }
    setLoading(false)
  }, [activeReport, dateFrom, dateTo, lateThreshold, profile])

  useEffect(() => { fetchReport() }, [fetchReport])

  // Query builders
  const buildSewadarQuery = (query) => {
    if (!canViewAllCentres && userCentre) {
      query = query.eq('centre', userCentre)
    }
    return query
  }

  const buildCentreQuery = (query) => {
    if (!canViewAllCentres && userCentre) {
      query = query.eq('centre', userCentre)
    }
    return query
  }

  // Absenteeism: All sewadars - present today
  const fetchAbsenteeism = async (canViewAllCentres, userCentre) => {
    const pageSize = 1000
    let allSewadars = []
    let page = 0
    
    while (true) {
      const from = page * pageSize
      const to = from + pageSize - 1
      let query = supabase
        .from('sewadars')
        .select('badge_number, sewadar_name, centre, department, badge_status, gender')
        .order('centre')
        .order('sewadar_name')
        .range(from, to)

      if (!canViewAllCentres && userCentre) {
        query = query.eq('centre', userCentre)
      }

      const { data: batch } = await query
      if (!batch || batch.length === 0) break
      allSewadars = [...allSewadars, ...batch]
      if (batch.length < pageSize) break
      page++
    }

    const { data: todaySessions } = await supabase
      .from('attendance_sessions')
      .select('badge_number')
      .eq('in_date', today)

    const presentBadges = new Set(todaySessions?.map(s => s.badge_number) || [])
    
    const filtered = allSewadars.filter(s => !presentBadges.has(s.badge_number))

    setReportData(filtered.map(s => ({
      badge_number: { value: s.badge_number, className: 'cell-badge' },
      name: { value: s.sewadar_name, className: 'cell-name' },
      centre: s.centre,
      department: s.department || '—',
      status: { value: s.badge_status, className: `cell-status ${s.badge_status.toLowerCase()}` },
    })))

    setReportSummary({
      total: filtered.length,
      permanent: filtered.filter(s => s.badge_status === 'PERMANENT').length,
      open: filtered.filter(s => s.badge_status === 'OPEN').length,
    })
  }

  // Currently Inside: Open sessions
  const fetchCurrentlyInside = async (canViewAllCentres, userCentre) => {
    let query = supabase
      .from('attendance_sessions')
      .select('*')
      .eq('status', 'OPEN')
      .order('in_time', { ascending: false })

    if (!canViewAllCentres && userCentre) {
      query = query.eq('centre', userCentre)
    }

    const { data: sessions } = await query

    const rows = (sessions || []).map(s => {
      const inDateTime = new Date(`${s.in_date}T${s.in_time}`)
      const duration = Math.floor((Date.now() - inDateTime.getTime()) / (1000 * 60))
      const hours = Math.floor(duration / 60)
      const mins = duration % 60
      const durationStr = `${hours}h ${mins}m`

      return {
        badge_number: { value: s.badge_number, className: 'cell-badge' },
        name: { value: s.sewadar_name, className: 'cell-name' },
        in_time: { value: `${formatDateIndian(s.in_date)} ${formatTime12Hour(s.in_time)}`, className: 'cell-date' },
        duration: { value: durationStr, className: 'cell-duration' },
        centre: s.centre,
        duty_type: { value: s.duty_type, className: `duty-badge-sm ${s.duty_type}` },
      }
    })

    setReportData(rows)
    setReportSummary({ total: rows.length })
  }

  // Gate Summary: Full log
  const fetchGateSummary = async (canViewAllCentres, userCentre) => {
    let query = supabase
      .from('attendance_sessions')
      .select('*')
      .gte('in_date', dateFrom)
      .lte('in_date', dateTo)
      .order('in_time', { ascending: false })
      .limit(1000)

    if (!canViewAllCentres && userCentre) {
      query = query.eq('centre', userCentre)
    }

    const { data: sessions } = await query

    const rows = (sessions || []).map(s => ({
      badge_number: { value: s.badge_number, className: 'cell-badge' },
      name: { value: s.sewadar_name, className: 'cell-name' },
      date: { value: formatDateIndian(s.in_date), className: 'cell-date' },
      in_time: formatTime12Hour(s.in_time),
      out_time: s.out_time ? formatTime12Hour(s.out_time) : '—',
      status: { value: s.status, className: `status-pill status-pill-${s.status.toLowerCase()}` },
      centre: s.centre,
      duty_type: { value: s.duty_type, className: `duty-badge-sm ${s.duty_type}` },
    }))

    setReportData(rows)
    setReportSummary({
      total: rows.length,
      closed: rows.filter(r => r.status.value === 'CLOSED').length,
      open: rows.filter(r => r.status.value === 'OPEN').length,
    })
  }

  // Late Coming: Present but after threshold time
  const fetchLateComing = async (canViewAllCentres, userCentre) => {
    const pageSize = 1000
    let allSessions = []
    let page = 0
    
    while (true) {
      const from = page * pageSize
      const to = from + pageSize - 1
      let query = supabase
        .from('attendance_sessions')
        .select('*')
        .gte('in_date', dateFrom)
        .lte('in_date', dateTo)
        .eq('status', 'CLOSED')
        .order('in_time', { ascending: false })
        .range(from, to)

      if (!canViewAllCentres && userCentre) {
        query = query.eq('centre', userCentre)
      }

      const { data: batch } = await query
      if (!batch || batch.length === 0) break
      allSessions = [...allSessions, ...batch]
      if (batch.length < pageSize) break
      page++
    }

    const [thresholdHour, thresholdMin] = lateThreshold.split(':').map(Number)
    const thresholdMins = thresholdHour * 60 + thresholdMin

    const lateSessions = allSessions.filter(s => {
      const [h, m] = s.in_time.split(':').map(Number)
      const sessionMins = h * 60 + m
      return sessionMins > thresholdMins
    })

    const rows = lateSessions.map(s => {
      const [h, m] = s.in_time.split(':').map(Number)
      const delayMins = (h * 60 + m) - thresholdMins
      const delayStr = `${Math.floor(delayMins / 60)}h ${delayMins % 60}m late`
      return {
        badge_number: { value: s.badge_number, className: 'cell-badge' },
        name: { value: s.sewadar_name, className: 'cell-name' },
        date: { value: formatDateIndian(s.in_date), className: 'cell-date' },
        in_time: formatTime12Hour(s.in_time),
        delay: { value: delayStr, className: 'cell-delay' },
        centre: s.centre,
      }
    })

    setReportData(rows)
    setReportSummary({ total: rows.length })
  }

  // Missing OUT: Open sessions from before today
  const fetchMissingOut = async (canViewAllCentres, userCentre) => {
    let query = supabase
      .from('attendance_sessions')
      .select('*')
      .eq('status', 'OPEN')
      .lt('in_date', today)
      .order('in_time', { ascending: false })

    if (!canViewAllCentres && userCentre) {
      query = query.eq('centre', userCentre)
    }

    const { data: sessions } = await query

    const rows = (sessions || []).map(s => {
      const daysSince = Math.floor((Date.now() - new Date(s.in_date).getTime()) / (1000 * 60 * 60 * 24))
      return {
        badge_number: { value: s.badge_number, className: 'cell-badge' },
        name: { value: s.sewadar_name, className: 'cell-name' },
        in_date: { value: formatDateIndian(s.in_date), className: 'cell-date' },
        in_time: formatTime12Hour(s.in_time),
        days_open: { value: `${daysSince} day${daysSince > 1 ? 's' : ''}`, className: 'cell-warning' },
        centre: s.centre,
        duty_type: { value: s.duty_type, className: `duty-badge-sm ${s.duty_type}` },
      }
    })

    setReportData(rows)
    setReportSummary({ total: rows.length })
  }

  // Jatha Attendance: Currently active jatha entries (to_date >= today)
  const fetchJathaAttendance = async (canViewAllCentres, userCentre) => {
    const today = new Date().toISOString().split('T')[0]
    
    let query = supabase
      .from('jatha_attendance')
      .select('*, jatha_master(jatha_type, centre_name, department)')
      .gte('to_date', today) // Only ongoing or future jathas
      .order('entered_at', { ascending: false })

    const { data: records } = await query

    const { data: sewadars } = await supabase
      .from('sewadars')
      .select('badge_number, centre')

    const sewadarMap = {}
    ;(sewadars || []).forEach(s => { sewadarMap[s.badge_number] = s.centre })

    let filtered = (records || []).filter(r => {
      if (canViewAllCentres) return true
      const centre = sewadarMap[r.badge_number] || ''
      return centre === userCentre
    })

    const rows = filtered.map(r => ({
      badge_number: { value: r.badge_number, className: 'cell-badge' },
      name: { value: r.sewadar_name, className: 'cell-name' },
      jatha_type: { value: r.jatha_master?.jatha_type || '—', className: `type-pill ${r.jatha_master?.jatha_type || ''}` },
      centre: r.jatha_master?.centre_name || '—',
      department: r.jatha_master?.department || '—',
      dates: `${formatDateIndian(r.from_date)} - ${formatDateIndian(r.to_date)}`,
    }))

    setReportData(rows)
    setReportSummary({ total: rows.length, active: rows.length })
  }

  // Jatha Summary: Grouped by jatha type
  const fetchJathaSummary = async (canViewAllCentres, userCentre) => {
    let query = supabase
      .from('jatha_attendance')
      .select('jatha_id, badge_number, jatha_master(jatha_type, centre_name, department)')

    const { data: records } = await query

    const { data: todaySessions } = await supabase
      .from('attendance_sessions')
      .select('badge_number')
      .eq('in_date', today)

    const presentBadges = new Set(todaySessions?.map(s => s.badge_number) || [])

    const groupMap = {}
    ;(records || []).forEach(r => {
      const key = `${r.jatha_master?.jatha_type || 'unknown'}|${r.jatha_master?.centre_name || 'unknown'}|${r.jatha_master?.department || 'unknown'}`
      if (!groupMap[key]) {
        groupMap[key] = {
          jatha_type: r.jatha_master?.jatha_type || 'unknown',
          centre: r.jatha_master?.centre_name || 'unknown',
          department: r.jatha_master?.department || 'unknown',
          total: 0,
          present: 0,
          badges: []
        }
      }
      groupMap[key].total++
      groupMap[key].badges.push(r.badge_number)
      if (presentBadges.has(r.badge_number)) groupMap[key].present++
    })

    const rows = Object.values(groupMap)
      .sort((a, b) => b.total - a.total)
      .map(g => ({
        jatha_type: { value: g.jatha_type, className: `type-pill ${g.jatha_type}` },
        centre: g.centre,
        department: g.department,
        total: g.total,
        present: g.present,
        percentage: { value: `${Math.round(g.present / g.total * 100)}%`, className: 'cell-percent' },
      }))

    setReportData(rows)
    setReportSummary({ total: rows.length })
  }

  // Weekly Summary: Day-wise
  const fetchWeeklySummary = async (canViewAllCentres, userCentre) => {
    let query = supabase
      .from('attendance_sessions')
      .select('in_date')
      .gte('in_date', dateFrom)
      .lte('in_date', dateTo)

    if (!canViewAllCentres && userCentre) {
      query = query.eq('centre', userCentre)
    }

    const { data: sessions } = await query

    const { data: sewadars } = await supabase
      .from('sewadars')
      .select('badge_number', { count: 'exact', head: true })

    const { count: totalSewadars } = sewadars || { count: 0 }

    const dayMap = {}
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    
    ;(sessions || []).forEach(s => {
      const date = s.in_date
      if (!dayMap[date]) {
        const d = new Date(date + 'T12:00:00')
        dayMap[date] = {
          date,
          dayName: dayNames[d.getDay()],
          count: 0
        }
      }
      dayMap[date].count++
    })

    const rows = Object.values(dayMap)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({
        date: { value: formatDateIndian(d.date), className: 'cell-date' },
        day: d.dayName,
        present: d.count,
        percentage: { value: `${Math.round(d.count / (totalSewadars || 1) * 100)}%`, className: 'cell-percent' },
      }))

    setReportData(rows)
    setReportSummary({ 
      totalDays: rows.length,
      totalPresent: rows.reduce((sum, r) => sum + r.present, 0)
    })
  }

  // Department Wise
  const fetchDepartmentWise = async (canViewAllCentres, userCentre) => {
    const { data: sewadars } = await supabase
      .from('sewadars')
      .select('*')

    const { data: sessions } = await supabase
      .from('attendance_sessions')
      .select('badge_number')
      .eq('in_date', today)

    const presentBadges = new Set(sessions?.map(s => s.badge_number) || [])

    let filteredSewadars = sewadars || []
    if (!canViewAllCentres && userCentre) {
      filteredSewadars = filteredSewadars.filter(s => s.centre === userCentre)
    }

    const deptMap = {}
    filteredSewadars.forEach(s => {
      const dept = s.department || 'UNKNOWN'
      if (!deptMap[dept]) {
        deptMap[dept] = { total: 0, present: 0, permanent: 0, open: 0 }
      }
      deptMap[dept].total++
      if (s.badge_status === 'PERMANENT') deptMap[dept].permanent++
      else deptMap[dept].open++
      if (presentBadges.has(s.badge_number)) deptMap[dept].present++
    })

    const rows = Object.entries(deptMap)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([dept, d]) => ({
        department: dept,
        total: d.total,
        present: d.present,
        percentage: { value: `${Math.round(d.present / d.total * 100)}%`, className: 'cell-percent' },
        permanent: d.permanent,
        open: d.open,
      }))

    setReportData(rows)
    setReportSummary({ totalDepts: rows.length })
  }

  // Centre Wise
  const fetchCentreWise = async (canViewAllCentres, userCentre) => {
    const { data: sewadars } = await supabase
      .from('sewadars')
      .select('*')

    const { data: sessions } = await supabase
      .from('attendance_sessions')
      .select('badge_number')
      .eq('in_date', today)

    const { data: centres } = await supabase
      .from('centres')
      .select('name, parent_centre')

    const presentBadges = new Set(sessions?.map(s => s.badge_number) || [])

    let filteredSewadars = sewadars || []
    if (!canViewAllCentres && userCentre) {
      filteredSewadars = filteredSewadars.filter(s => s.centre === userCentre)
    }

    const centreMap = {}
    ;(centres || []).forEach(c => {
      centreMap[c.name] = { name: c.name, parent: c.parent_centre, children: [] }
    })

    filteredSewadars.forEach(s => {
      if (!centreMap[s.centre]) {
        centreMap[s.centre] = { name: s.centre, parent: null, children: [] }
      }
      if (!centreMap[s.centre].data) {
        centreMap[s.centre].data = { total: 0, present: 0 }
      }
      centreMap[s.centre].data.total++
      if (presentBadges.has(s.badge_number)) centreMap[s.centre].data.present++
    })

    const rootCentres = Object.values(centreMap).filter(c => !c.parent)
    const rows = rootCentres
      .sort((a, b) => (b.data?.total || 0) - (a.data?.total || 0))
      .map(c => ({
        centre: c.name,
        total: c.data?.total || 0,
        present: c.data?.present || 0,
        percentage: { 
          value: c.data?.total ? `${Math.round(c.data.present / c.data.total * 100)}%` : '—', 
          className: 'cell-percent' 
        },
      }))

    setReportData(rows)
    setReportSummary({ totalCentres: rows.length })
  }

  // Export handlers
  const handleExport = (format) => {
    if (reportData.length === 0) return

    const headers = getReportHeaders()
    const rows = reportData.map(row => {
      if (Array.isArray(row)) {
        return row.map(cell => typeof cell === 'object' ? cell.value : cell)
      }
      return Object.values(row).map(cell => typeof cell === 'object' ? cell.value : cell)
    })

    if (format === 'csv') {
      exportCSV(headers, rows)
    } else if (format === 'excel') {
      exportExcel(headers, rows)
    } else if (format === 'pdf') {
      exportPDF(headers, rows)
    }
  }

  const getReportHeaders = () => {
    const reportHeaders = {
      absenteeism: ['Badge', 'Name', 'Centre', 'Department', 'Status'],
      currently_inside: ['Badge', 'Name', 'IN Time', 'Duration', 'Centre', 'Duty'],
      gate_summary: ['Badge', 'Name', 'Date', 'IN', 'OUT', 'Status', 'Centre', 'Duty'],
      late_coming: ['Badge', 'Name', 'Date', 'IN Time', 'Delay', 'Centre'],
      missing_out: ['Badge', 'Name', 'IN Date', 'IN Time', 'Days Open', 'Centre', 'Duty'],
      jatha_attendance: ['Badge', 'Name', 'Jatha Type', 'Centre', 'Department', 'Dates'],
      jatha_summary: ['Jatha Type', 'Centre', 'Department', 'Total', 'Present', '%'],
      weekly_summary: ['Date', 'Day', 'Present', '%'],
      department_wise: ['Department', 'Total', 'Present', '%', 'PERMANENT', 'OPEN'],
      centre_wise: ['Centre', 'Total', 'Present', '%'],
    }
    return reportHeaders[activeReport] || []
  }

  const escapeCSV = (val) => {
    if (val === null || val === undefined) return ''
    const str = String(val)
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const exportCSV = (headers, rows) => {
    const csv = [headers.map(escapeCSV).join(','), ...rows.map(r => r.map(escapeCSV).join(','))].join('\n')
    downloadFile(csv, `${activeReport}_${dateFrom}_${dateTo}.csv`, 'text/csv')
  }

  const exportExcel = (headers, rows) => {
    const csv = [headers.map(escapeCSV).join(','), ...rows.map(r => r.map(escapeCSV).join(','))].join('\n')
    downloadFile(csv, `${activeReport}_${dateFrom}_${dateTo}.csv`, 'text/csv')
  }

  const exportPDF = (headers, rows) => {
    const tableRows = rows.map(r => `<tr>${r.map(c => `<td>${escapeCSV(c)}</td>`).join('')}</tr>`).join('')
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>${currentSubReports.find(r => r.id === activeReport)?.label || 'Report'}</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    h2 { color: #217346; margin-bottom: 5px; }
    p { color: #666; margin-top: 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 12px; }
    th { background: #217346; color: white; }
    @media print {
      body { padding: 0; }
      button { display: none; }
    }
  </style>
</head>
<body>
  <h2>${currentSubReports.find(r => r.id === activeReport)?.label || 'Report'}</h2>
  <p>Date Range: ${formatDateIndian(dateFrom)} - ${formatDateIndian(dateTo)}</p>
  <button onclick="window.print()" style="padding: 8px 16px; background: #217346; color: white; border: none; border-radius: 4px; cursor: pointer; margin-bottom: 15px;">Print / Save as PDF</button>
  <table>
    <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
</body>
</html>`
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const win = window.open(url, '_blank')
    if (win) win.onload = () => win.print()
  }

  const downloadFile = (content, filename, type) => {
    const blob = new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const saveSettings = () => {
    localStorage.setItem('reportSettings', JSON.stringify({ lateThreshold }))
    setShowSettings(false)
  }

  const getReportTitle = () => {
    const report = currentSubReports.find(r => r.id === activeReport)
    return report?.label || 'Report'
  }

  const getTableHeaders = () => getReportHeaders()

  return (
    <div className="page-full pb-nav">
      <div className="header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h2>Reports</h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            {activeReport === 'late_coming' && (
              <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings">
                <Settings size={16} />
              </button>
            )}
            <button 
              className="refresh-btn" 
              onClick={() => { setRefreshing(true); fetchReport().finally(() => setRefreshing(false)) }}
              disabled={refreshing}
            >
              <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* Date Range */}
      <div className="report-filters">
        <DateRangePicker
          dateFrom={dateFrom}
          dateTo={dateTo}
          onDateFromChange={setDateFrom}
          onDateToChange={setDateTo}
        />
        <ExportDropdown onExport={handleExport} loading={loading} />
      </div>

      {/* Main Tabs */}
      <ReportTabs
        activeTab={activeCategory}
        onTabChange={handleCategoryChange}
        tabs={Object.values(REPORTS)}
      />

      {/* Sub Tabs */}
      <SubReportTabs
        activeSub={activeReport}
        onSubChange={handleSubReportChange}
        subReports={currentSubReports}
      />

      {/* Report Title */}
      <div className="report-title-bar">
        <h3>{getReportTitle()}</h3>
        <span className="report-count">{reportData.length} records</span>
      </div>

      {/* Summary Cards */}
      {Object.keys(reportSummary).length > 0 && (
        <div className="report-summary-grid">
          {activeReport === 'absenteeism' && (
            <>
              <SummaryCard title="Absent" value={reportSummary.total} icon={UserX} color="red" />
              <SummaryCard title="PERMANENT" value={reportSummary.permanent} icon={CheckCircle} color="blue" />
              <SummaryCard title="OPEN" value={reportSummary.open} icon={Users} color="gold" />
            </>
          )}
          {activeReport === 'currently_inside' && (
            <SummaryCard title="Currently Inside" value={reportSummary.total} icon={UserCheck} color="green" />
          )}
          {activeReport === 'gate_summary' && (
            <>
              <SummaryCard title="Total Records" value={reportSummary.total} icon={Clock} color="blue" />
              <SummaryCard title="Closed" value={reportSummary.closed} icon={CheckCircle} color="green" />
              <SummaryCard title="Open" value={reportSummary.open} icon={AlertTriangle} color="orange" />
            </>
          )}
          {activeReport === 'late_coming' && (
            <SummaryCard title="Late Comers" value={reportSummary.total} icon={AlertTriangle} color="orange" />
          )}
          {activeReport === 'missing_out' && (
            <SummaryCard title="Missing OUT" value={reportSummary.total} icon={AlertTriangle} color="red" />
          )}
          {(activeReport === 'jatha_attendance' || activeReport === 'jatha_summary') && (
            <SummaryCard title="Total Records" value={reportSummary.total} icon={Users} color="purple" />
          )}
          {(activeReport === 'weekly_summary') && (
            <>
              <SummaryCard title="Days" value={reportSummary.totalDays} icon={Calendar} color="blue" />
              <SummaryCard title="Total Present" value={reportSummary.totalPresent} icon={Users} color="green" />
            </>
          )}
          {activeReport === 'department_wise' && (
            <SummaryCard title="Departments" value={reportSummary.totalDepts} icon={Building} color="blue" />
          )}
          {activeReport === 'centre_wise' && (
            <SummaryCard title="Centres" value={reportSummary.totalCentres} icon={MapPin} color="blue" />
          )}
        </div>
      )}

      {/* Report Content */}
      {loading ? (
        <div className="report-loading">
          <RefreshCw size={24} className="spin" />
          <p>Loading report...</p>
        </div>
      ) : (
        <ReportTable
          headers={getTableHeaders()}
          rows={reportData}
          emptyMessage="No data available for selected filters"
        />
      )}

      {/* Settings Modal */}
      <ConfigModal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        title="Late Coming Settings"
        onSave={saveSettings}
      >
        <div className="setting-row">
          <label>Late Threshold Time</label>
          <input
            type="time"
            value={lateThreshold}
            onChange={(e) => setLateThreshold(e.target.value)}
          />
          <span className="setting-hint">Sewadars checking in after this time will be marked as late</span>
        </div>
      </ConfigModal>
    </div>
  )
}
