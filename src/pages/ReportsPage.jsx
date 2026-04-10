import React, { useState, useEffect, useMemo } from 'react'
import { supabase, ROLES } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { todayDateStr } from '../lib/dateUtils'
import { Download, FileText, TrendingUp, Users, Clock, AlertTriangle, BarChart2, ChevronDown, Calendar } from 'lucide-react'
import { showError } from '../components/Toast'

const ALLOWED_STATUSES = ['open', 'permanent', 'elderly']

function getLastSatsangDay() {
  const today = new Date()
  const dayOfWeek = today.getDay()
  
  const daysSinceSunday = dayOfWeek
  const daysSinceWednesday = (dayOfWeek + 5) % 7
  
  if (daysSinceWednesday <= daysSinceSunday && daysSinceWednesday > 0) {
    const lastWed = new Date(today)
    lastWed.setDate(today.getDate() - daysSinceWednesday)
    return lastWed.toISOString().split('T')[0]
  } else {
    const lastSun = new Date(today)
    lastSun.setDate(today.getDate() - daysSinceSunday)
    return lastSun.toISOString().split('T')[0]
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatTime(isoStr) {
  if (!isoStr) return '—'
  return new Date(isoStr).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
}

function getWeekDates(dateStr) {
  const today = new Date(dateStr + 'T00:00:00')
  const dates = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const dayStr = d.toISOString().split('T')[0]
    dates.push(dayStr)
  }
  return dates
}

export default function ReportsPage() {
  const { profile } = useAuth()
  const isAso = profile?.role === ROLES.ASO
  const isCentreUser = profile?.role === ROLES.CENTRE || profile?.role === ROLES.SC_SP_USER

  const [activeTab, setActiveTab] = useState(isAso ? 'aso' : 'centre')
  const [activeReport, setActiveReport] = useState('summary')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState(null)
  const [centres, setCentres] = useState([])
  const [childCentres, setChildCentres] = useState([])
  
  const [dateFrom, setDateFrom] = useState(getLastSatsangDay())
  const [dateTo, setDateTo] = useState(todayDateStr())
  const [lateThreshold, setLateThreshold] = useState('10:00')
  const [selectedCentre, setSelectedCentre] = useState(isCentreUser ? profile.centre : '')

  useEffect(() => {
    fetchCentres()
  }, [])

  async function fetchCentres() {
    const { data } = await supabase.from('centres').select('*').order('centre_name')
    setCentres(data || [])
    
    if (isCentreUser && profile?.centre) {
      const { data: children } = await supabase
        .from('centres')
        .select('centre_name')
        .eq('parent_centre', profile.centre)
      setChildCentres([profile.centre, ...(children?.map(c => c.centre_name) || [])])
    }
  }

  const scopeCentres = useMemo(() => {
    if (isAso) {
      return selectedCentre ? [selectedCentre] : centres.map(c => c.centre_name)
    }
    return childCentres.length > 0 ? childCentres : [profile?.centre].filter(Boolean)
  }, [isAso, selectedCentre, centres, childCentres, profile])

  async function runReport() {
    setLoading(true)
    setData(null)
    
    try {
      switch (activeReport) {
        case 'summary':
          await fetchDailySummary()
          break
        case 'absentees':
          await fetchAbsentees()
          break
        case 'raw':
          await fetchRawSessions()
          break
        case 'duration':
          await fetchDurationAnalysis()
          break
        case 'centrewise':
          await fetchCentreWise()
          break
        case 'flags':
          await fetchFlagsReport()
          break
        case 'late':
          await fetchLateArrivals()
          break
        case 'trend':
          await fetchWeeklyTrend()
          break
      }
    } catch (err) {
      showError(err.message || 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab && activeReport) {
      runReport()
    }
  }, [activeReport, dateFrom, dateTo, scopeCentres])

  async function fetchDailySummary() {
    const { data: sewadars, error: sewadarError } = await supabase
      .from('sewadars')
      .select('badge_number, sewadar_name, centre, department, badge_status')
      .in('centre', scopeCentres)
    
    if (sewadarError) {
      console.error('fetchDailySummary: sewadar error', sewadarError)
      throw new Error('Failed to fetch sewadars')
    }

    const eligible = (sewadars || []).filter(s => 
      ALLOWED_STATUSES.includes((s.badge_status || '').toLowerCase().trim())
    )
    const eligibleBadges = eligible.map(s => s.badge_number)

    const { data: sessions, error: sessionError } = await supabase
      .from('v_sessions')
      .select('badge_number')
      .in('badge_number', eligibleBadges.length > 0 ? eligibleBadges : [''])
      .gte('date_ist', dateFrom)
      .lte('date_ist', dateTo)

    if (sessionError) {
      console.error('fetchDailySummary: session error', sessionError)
      throw new Error('Failed to fetch sessions')
    }
    
    const presentSet = new Set(sessions?.map(s => s.badge_number) || [])
    
    const deptStats = {}
    for (const s of eligible) {
      const dept = s.department || 'Unassigned'
      if (!deptStats[dept]) {
        deptStats[dept] = { eligible: 0, present: 0, eligibleList: [], presentList: [] }
      }
      deptStats[dept].eligible++
      deptStats[dept].eligibleList.push(s)
      if (presentSet.has(s.badge_number)) {
        deptStats[dept].present++
        deptStats[dept].presentList.push(s)
      }
    }

    setData({
      type: 'summary',
      totalEligible: eligible.length,
      totalPresent: presentSet.size,
      departments: deptStats,
      sessions
    })
  }

  async function fetchAbsentees() {
    const { data: sewadars, error: sewadarError } = await supabase
      .from('sewadars')
      .select('badge_number, sewadar_name, centre, department, badge_status')
      .in('centre', scopeCentres)
    
    if (sewadarError) {
      console.error('fetchAbsentees: sewadar error', sewadarError)
      throw new Error('Failed to fetch sewadars')
    }

    const eligible = (sewadars || []).filter(s => 
      ALLOWED_STATUSES.includes((s.badge_status || '').toLowerCase().trim())
    )
    const eligibleBadges = eligible.map(s => s.badge_number)

    const { data: sessions, error: sessionError } = await supabase
      .from('v_sessions')
      .select('badge_number')
      .in('badge_number', eligibleBadges.length > 0 ? eligibleBadges : [''])
      .gte('date_ist', dateFrom)
      .lte('date_ist', dateTo)

    if (sessionError) {
      console.error('fetchAbsentees: session error', sessionError)
      throw new Error('Failed to fetch sessions')
    }

    const presentSet = new Set(sessions?.map(s => s.badge_number) || [])
    const absentees = eligible.filter(s => !presentSet.has(s.badge_number))

    setData({
      type: 'absentees',
      totalEligible: eligible.length,
      totalAbsent: absentees.length,
      absentees,
      dateRange: { from: dateFrom, to: dateTo }
    })
  }

  async function fetchRawSessions() {
    const [sessionsRes, sewadarsRes] = await Promise.all([
      supabase
        .from('v_sessions')
        .select('*')
        .in('sewadar_centre', scopeCentres)
        .gte('date_ist', dateFrom)
        .lte('date_ist', dateTo)
        .order('date_ist', { ascending: false })
        .order('in_time', { ascending: false }),
      supabase
        .from('sewadars')
        .select('badge_number, sewadar_name, centre, department')
        .in('centre', scopeCentres)
    ])

    if (sessionsRes.error) {
      console.error('fetchRawSessions: sessions error', sessionsRes.error)
      throw new Error('Failed to fetch sessions')
    }
    if (sewadarsRes.error) {
      console.error('fetchRawSessions: sewadars error', sewadarsRes.error)
      throw new Error('Failed to fetch sewadars')
    }
    
    const sewadarMap = Object.fromEntries((sewadarsRes.data || []).map(s => [s.badge_number, s]))

    const enrichedSessions = (sessionsRes.data || []).map(s => ({
      ...s,
      centre: s.sewadar_centre,
      sewadar_name: sewadarMap[s.badge_number]?.sewadar_name || '—',
      department: sewadarMap[s.badge_number]?.department || '—'
    }))

    setData({
      type: 'raw',
      sessions: enrichedSessions,
      totalCount: enrichedSessions.length
    })
  }

  async function fetchDurationAnalysis() {
    const { data: sessions, error } = await supabase
      .from('v_sessions')
      .select('badge_number, in_time, out_time, duty_type, is_open')
      .in('sewadar_centre', scopeCentres)
      .gte('date_ist', dateFrom)
      .lte('date_ist', dateTo)
      .eq('is_open', false)

    if (error) {
      console.error('fetchDurationAnalysis error:', error)
      throw new Error('Failed to fetch data')
    }

    const groups = { '< 2h': 0, '2-4h': 0, '4-8h': 0, '8-12h': 0, '> 12h': 0, details: [] }

    for (const s of (sessions || [])) {
      if (s.in_time && s.out_time) {
        const duration = (new Date(s.out_time) - new Date(s.in_time)) / (1000 * 60 * 60)
        let group
        if (duration < 2) group = '< 2h'
        else if (duration < 4) group = '2-4h'
        else if (duration < 8) group = '4-8h'
        else if (duration < 12) group = '8-12h'
        else group = '> 12h'
        
        groups[group]++
        groups.details.push({ ...s, duration: duration.toFixed(1) })
      }
    }

    setData({
      type: 'duration',
      groups,
      total: Object.values(groups).filter(v => typeof v === 'number').reduce((a, b) => a + b, 0)
    })
  }

  async function fetchCentreWise() {
    const centreNames = isAso && selectedCentre ? [selectedCentre] : scopeCentres
    
    if (!centreNames || centreNames.length === 0) {
      setData({ type: 'centrewise', stats: [], dateRange: { from: dateFrom, to: dateTo } })
      return
    }

    const [sewadarsRes, sessionsRes] = await Promise.all([
      supabase
        .from('sewadars')
        .select('badge_number, centre, badge_status')
        .in('centre', centreNames),
      supabase
        .from('v_sessions')
        .select('badge_number, sewadar_centre')
        .in('sewadar_centre', centreNames)
        .gte('date_ist', dateFrom)
        .lte('date_ist', dateTo)
    ])

    // Filter sewadars by status client-side (case-insensitive)
    const eligible = (sewadarsRes.data || []).filter(s => 
      ALLOWED_STATUSES.includes((s.badge_status || '').toLowerCase().trim())
    )

    if (sewadarsRes.error || sessionsRes.error) {
      console.error('fetchCentreWise errors:', sewadarsRes.error, sessionsRes.error)
      throw new Error('Failed to fetch data')
    }

    const eligibleByCentre = {}
    for (const s of eligible) {
      eligibleByCentre[s.centre] = (eligibleByCentre[s.centre] || 0) + 1
    }

    const presentByCentre = {}
    for (const s of (sessionsRes.data || [])) {
      presentByCentre[s.sewadar_centre] = (presentByCentre[s.sewadar_centre] || new Set()).add(s.badge_number)
    }

    const stats = centreNames.map(c => ({
      centre: c,
      eligible: eligibleByCentre[c] || 0,
      present: presentByCentre[c] ? presentByCentre[c].size : 0,
      pct: eligibleByCentre[c] ? Math.round((presentByCentre[c]?.size || 0) / eligibleByCentre[c] * 100) : 0
    })).filter(c => c.eligible > 0).sort((a, b) => b.pct - a.pct)

    setData({
      type: 'centrewise',
      stats,
      dateRange: { from: dateFrom, to: dateTo }
    })
  }

  async function fetchFlagsReport() {
    let q = supabase
      .from('queries')
      .select('*')
      .gte('created_at', dateFrom + 'T00:00:00')
      .lte('created_at', dateTo + 'T23:59:59')
      .order('created_at', { ascending: false })

    if (isCentreUser && profile?.centre) {
      q = q.in('raised_by_centre', scopeCentres)
    }

    const { data: flags, error } = await q
    
    if (error) {
      console.error('fetchFlagsReport error:', error)
      throw new Error('Failed to fetch flags')
    }

    const stats = { open: 0, in_progress: 0, resolved: 0 }
    for (const f of (flags || [])) {
      stats[f.status] = (stats[f.status] || 0) + 1
    }

    setData({
      type: 'flags',
      flags: flags || [],
      stats,
      dateRange: { from: dateFrom, to: dateTo }
    })
  }

  async function fetchLateArrivals() {
    const threshold = lateThreshold + ':00'
    
    const [sessionsRes, sewadarsRes] = await Promise.all([
      supabase
        .from('v_sessions')
        .select('badge_number, in_time, sewadar_centre, duty_type, date_ist')
        .in('sewadar_centre', scopeCentres)
        .gte('date_ist', dateFrom)
        .lte('date_ist', dateTo),
      supabase
        .from('sewadars')
        .select('badge_number, sewadar_name, centre, department')
        .in('centre', scopeCentres)
    ])

    if (sessionsRes.error || sewadarsRes.error) {
      console.error('fetchLateArrivals errors:', sessionsRes.error, sewadarsRes.error)
      throw new Error('Failed to fetch data')
    }
    
    const sewadarMap = Object.fromEntries((sewadarsRes.data || []).map(s => [s.badge_number, s]))

    const lateSessions = (sessionsRes.data || []).filter(s => {
      if (!s.in_time) return false
      const inTime = s.in_time.split('T')[1]?.substring(0, 8)
      return inTime > threshold
    }).map(s => ({
      ...s,
      sewadar_name: sewadarMap[s.badge_number]?.sewadar_name || '—',
      department: sewadarMap[s.badge_number]?.department || '—'
    }))

    setData({
      type: 'late',
      lateSessions,
      threshold: lateThreshold,
      dateRange: { from: dateFrom, to: dateTo }
    })
  }

  async function fetchWeeklyTrend() {
    const weekDates = getWeekDates(dateTo)
    
    if (import.meta.env.DEV) {
      console.log('[fetchWeeklyTrend] weekDates:', weekDates, 'scopeCentres:', scopeCentres)
    }
    
    const [sessionsRes, eligibleRes] = await Promise.all([
      supabase
        .from('v_sessions')
        .select('date_ist, badge_number')
        .in('sewadar_centre', scopeCentres)
        .gte('date_ist', weekDates[0])
        .lte('date_ist', weekDates[6]),
      supabase
        .from('sewadars')
        .select('badge_number, badge_status')
        .in('centre', scopeCentres)
    ])

    const eligible = (eligibleRes.data || []).filter(s => 
      ALLOWED_STATUSES.includes((s.badge_status || '').toLowerCase().trim())
    )

    if (sessionsRes.error || eligibleRes.error) {
      console.error('fetchWeeklyTrend errors:', sessionsRes.error, eligibleRes.error)
      throw new Error('Failed to fetch data')
    }

    const totalEligible = eligible.length

    const dailyCounts = {}
    for (const d of weekDates) {
      dailyCounts[d] = new Set()
    }
    for (const s of (sessionsRes.data || [])) {
      if (dailyCounts[s.date_ist]) {
        dailyCounts[s.date_ist].add(s.badge_number)
      }
    }

    const trend = weekDates.map(d => ({
      date: d,
      label: new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }),
      present: dailyCounts[d]?.size || 0,
      eligible: totalEligible,
      pct: totalEligible ? Math.round((dailyCounts[d]?.size || 0) / totalEligible * 100) : 0
    }))

    setData({
      type: 'trend',
      trend,
      weekDates
    })
  }

  function exportToExcel() {
    if (!data) return
    
    let csv = ''
    const headers = []
    const rows = []

    switch (data.type) {
      case 'summary':
        headers.push('Department', 'Eligible', 'Present', 'Absent', 'Percentage')
        for (const [dept, stats] of Object.entries(data.departments)) {
          rows.push([dept, stats.eligible, stats.present, stats.eligible - stats.present, 
            stats.eligible ? Math.round(stats.present / stats.eligible * 100) + '%' : '0%'])
        }
        rows.push(['TOTAL', data.totalEligible, data.totalPresent, data.totalEligible - data.totalPresent, 
          data.totalEligible ? Math.round(data.totalPresent / data.totalEligible * 100) + '%' : '0%'])
        break
        
      case 'absentees':
        headers.push('Badge', 'Name', 'Centre', 'Department')
        for (const s of data.absentees) {
          rows.push([s.badge_number, s.sewadar_name, s.centre, s.department || '—'])
        }
        break
        
      case 'raw':
        headers.push('Date', 'Badge', 'Name', 'Department', 'Duty Type', 'IN Time', 'OUT Time', 'Duration', 'Status')
        for (const s of data.sessions) {
          const duration = s.out_time && s.in_time 
            ? ((new Date(s.out_time) - new Date(s.in_time)) / (1000 * 60 * 60)).toFixed(1) + 'h' 
            : '—'
          rows.push([s.date_ist, s.badge_number, s.sewadar_name, s.department, s.duty_type, 
            formatTime(s.in_time), formatTime(s.out_time), duration, s.is_open ? 'Open' : 'Closed'])
        }
        break
        
      case 'duration':
        headers.push('Duration Group', 'Count', 'Percentage')
        const total = data.total
        for (const [group, count] of Object.entries(data.groups)) {
          if (group === 'details') continue
          rows.push([group, count, total ? Math.round(count / total * 100) + '%' : '0%'])
        }
        break
        
      case 'centrewise':
        headers.push('Centre', 'Eligible', 'Present', 'Percentage')
        for (const s of data.stats) {
          rows.push([s.centre, s.eligible, s.present, s.pct + '%'])
        }
        break
        
      case 'flags':
        headers.push('Badge', 'Issue', 'Status', 'Raised By', 'Date')
        for (const f of data.flags) {
          rows.push([f.badge_number || '—', f.issue_description?.substring(0, 50), f.status, f.raised_by_name, formatDate(f.created_at)])
        }
        break
        
      case 'late':
        headers.push('Date', 'Badge', 'Name', 'Department', 'IN Time', 'Centre')
        for (const s of data.lateSessions) {
          rows.push([s.date_ist, s.badge_number, s.sewadar_name, s.department, formatTime(s.in_time), s.centre])
        }
        break
        
      case 'trend':
        headers.push('Date', 'Day', 'Present', 'Eligible', 'Percentage')
        for (const t of data.trend) {
          rows.push([t.date, t.label, t.present, t.eligible, t.pct + '%'])
        }
        break
    }

    csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `report_${data.type}_${dateFrom}_to_${dateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const reportTabsCentre = [
    { id: 'summary', label: 'Daily Summary', icon: BarChart2 },
    { id: 'absentees', label: 'Absentees', icon: Users },
    { id: 'raw', label: 'Raw Sessions', icon: FileText },
    { id: 'duration', label: 'Duration Analysis', icon: Clock },
  ]

  const reportTabsAso = [
    { id: 'centrewise', label: 'Centre Comparison', icon: TrendingUp },
    { id: 'flags', label: 'Flags & Issues', icon: AlertTriangle },
    { id: 'late', label: 'Late Arrivals', icon: Clock },
    { id: 'trend', label: 'Weekly Trend', icon: TrendingUp },
  ]

  const currentTabs = isAso && activeTab === 'centre' ? reportTabsCentre 
    : isAso && activeTab === 'aso' ? reportTabsAso 
    : reportTabsCentre

  return (
    <div className="page pb-nav">
      <div style={{ padding: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>Reports</h2>
        
        {isAso && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
            <button
              onClick={() => { setActiveTab('centre'); setActiveReport('summary') }}
              style={{
                padding: '0.5rem 1rem',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.85rem',
                background: activeTab === 'centre' ? 'var(--gold)' : 'var(--bg-elevated)',
                color: activeTab === 'centre' ? 'var(--bg)' : 'var(--text-secondary)',
              }}
            >
              Centre Reports
            </button>
            <button
              onClick={() => { setActiveTab('aso'); setActiveReport('centrewise') }}
              style={{
                padding: '0.5rem 1rem',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: '0.85rem',
                background: activeTab === 'aso' ? 'var(--gold)' : 'var(--bg-elevated)',
                color: activeTab === 'aso' ? 'var(--bg)' : 'var(--text-secondary)',
              }}
            >
              ASO Reports
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <Calendar size={14} color="var(--text-muted)" />
            <input
              type="date"
              className="input"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              style={{ padding: '0.5rem', fontSize: '0.85rem' }}
            />
            <span style={{ color: 'var(--text-muted)' }}>to</span>
            <input
              type="date"
              className="input"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              style={{ padding: '0.5rem', fontSize: '0.85rem' }}
            />
          </div>
          
          {activeReport === 'late' && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Late after:</span>
              <input
                type="time"
                className="input"
                value={lateThreshold}
                onChange={e => setLateThreshold(e.target.value)}
                style={{ padding: '0.5rem', fontSize: '0.85rem' }}
              />
            </div>
          )}

          {isAso && (activeTab === 'centre' || activeReport === 'centrewise') && (
            <select
              className="input"
              value={selectedCentre}
              onChange={e => setSelectedCentre(e.target.value)}
              style={{ padding: '0.5rem', fontSize: '0.85rem' }}
            >
              <option value="">All Centres</option>
              {centres.map(c => (
                <option key={c.centre_name} value={c.centre_name}>{c.centre_name}</option>
              ))}
            </select>
          )}

          <button
            onClick={exportToExcel}
            disabled={!data}
            style={{
              padding: '0.5rem 1rem',
              border: 'none',
              borderRadius: 8,
              cursor: data ? 'pointer' : 'not-allowed',
              fontWeight: 600,
              fontSize: '0.85rem',
              background: data ? 'var(--excel-green)' : 'var(--bg-elevated)',
              color: data ? 'white' : 'var(--text-muted)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.35rem',
              marginLeft: 'auto'
            }}
          >
            <Download size={14} /> Export
          </button>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', overflowX: 'auto', paddingBottom: '0.5rem' }}>
          {currentTabs.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveReport(tab.id)}
                style={{
                  padding: '0.5rem 0.75rem',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.78rem',
                  background: activeReport === tab.id ? 'var(--bg-elevated)' : 'transparent',
                  color: activeReport === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
                  borderBottom: activeReport === tab.id ? '2px solid var(--gold)' : '2px solid transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  whiteSpace: 'nowrap'
                }}
              >
                <Icon size={14} /> {tab.label}
              </button>
            )
          })}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Loading...</div>
        ) : data ? (
          <div>
            {data.type === 'summary' && <SummaryReport data={data} dateFrom={dateFrom} dateTo={dateTo} />}
            {data.type === 'absentees' && <AbsenteesReport data={data} />}
            {data.type === 'raw' && <RawSessionsReport data={data} />}
            {data.type === 'duration' && <DurationReport data={data} />}
            {data.type === 'centrewise' && <CentreWiseReport data={data} />}
            {data.type === 'flags' && <FlagsReport data={data} />}
            {data.type === 'late' && <LateReport data={data} />}
            {data.type === 'trend' && <TrendReport data={data} />}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>Select a report to view</div>
        )}
      </div>
    </div>
  )
}

function SummaryReport({ data, dateFrom, dateTo }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: 'var(--bg-elevated)', padding: '1rem', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>{data.totalEligible}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Eligible</div>
        </div>
        <div style={{ background: 'rgba(34,197,94,0.1)', padding: '1rem', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--green)' }}>{data.totalPresent}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Present</div>
        </div>
        <div style={{ background: 'var(--bg-elevated)', padding: '1rem', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            {data.totalEligible ? Math.round(data.totalPresent / data.totalEligible * 100) : 0}%
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Attendance</div>
        </div>
      </div>
      
      <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: '0.9rem' }}>
          Department-wise Breakdown
        </div>
        {Object.entries(data.departments).map(([dept, stats]) => (
          <div key={dept} style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{dept}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{stats.eligible} eligible</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontWeight: 700, color: 'var(--green)', fontSize: '0.95rem' }}>{stats.present} present</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {stats.eligible - stats.present} absent · {stats.eligible ? Math.round(stats.present / stats.eligible * 100) : 0}%
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AbsenteesReport({ data }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: 'var(--bg-elevated)', padding: '1rem', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{data.totalEligible}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Eligible</div>
        </div>
        <div style={{ background: 'rgba(220,38,38,0.1)', padding: '1rem', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--red)' }}>{data.totalAbsent}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Absent</div>
        </div>
        <div style={{ background: 'var(--bg-elevated)', padding: '1rem', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>
            {data.totalEligible ? Math.round(data.totalAbsent / data.totalEligible * 100) : 0}%
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Absent Rate</div>
        </div>
      </div>
      
      <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', fontWeight: 600, fontSize: '0.9rem' }}>
          Absentees List ({data.absentees.length})
        </div>
        {data.absentees.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No absentees!</div>
        ) : (
          data.absentees.map((s, i) => (
            <div key={s.badge_number} style={{ padding: '0.6rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <span style={{ fontFamily: 'monospace', color: 'var(--gold)', fontWeight: 600, fontSize: '0.85rem', width: 120 }}>{s.badge_number}</span>
              <span style={{ fontWeight: 500, flex: 1 }}>{s.sewadar_name}</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{s.department || '—'}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function RawSessionsReport({ data }) {
  return (
    <div>
      <div style={{ background: 'var(--bg-elevated)', padding: '0.75rem 1rem', borderRadius: 12, marginBottom: '1rem', fontWeight: 600 }}>
        Total Sessions: {data.totalCount}
      </div>
      
      <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '0.5rem 1rem', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '100px 100px 1fr 80px 80px 80px', gap: '0.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
          <span>Date</span><span>Badge</span><span>Name</span><span>Duty</span><span>IN</span><span>OUT</span>
        </div>
        {data.sessions.map((s, i) => (
          <div key={s.id || i} style={{ padding: '0.5rem 1rem', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '100px 100px 1fr 80px 80px 80px', gap: '0.5rem', fontSize: '0.82rem', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)' }}>{s.date_ist}</span>
            <span style={{ fontFamily: 'monospace', color: 'var(--gold)' }}>{s.badge_number}</span>
            <span style={{ fontWeight: 500 }}>{s.sewadar_name}</span>
            <span style={{ fontSize: '0.75rem', color: s.duty_type === 'watch_ward' ? '#9333ea' : 'var(--text-muted)' }}>
              {s.duty_type === 'watch_ward' ? 'W&W' : s.duty_type === 'satsang' ? 'Sat' : 'GE'}
            </span>
            <span>{formatTime(s.in_time)}</span>
            <span style={{ color: s.is_open ? 'var(--amber)' : 'var(--text-primary)' }}>
              {s.is_open ? 'Open' : formatTime(s.out_time)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function DurationReport({ data }) {
  const colors = { '< 2h': '#ef4444', '2-4h': '#f97316', '4-8h': '#eab308', '8-12h': '#22c55e', '> 12h': '#3b82f6' }
  const maxVal = Math.max(...Object.entries(data.groups).filter(([k]) => k !== 'details').map(([, v]) => v))
  
  return (
    <div>
      <div style={{ background: 'var(--bg-elevated)', padding: '1rem', borderRadius: 12, marginBottom: '1rem' }}>
        <div style={{ fontSize: '1.5rem', fontWeight: 700, textAlign: 'center' }}>{data.total}</div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>Total Closed Sessions</div>
      </div>
      
      <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: '1rem' }}>
        {Object.entries(data.groups).filter(([k]) => k !== 'details').map(([group, count]) => (
          <div key={group} style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}>
              <span style={{ fontWeight: 500 }}>{group}</span>
              <span style={{ fontWeight: 700 }}>{count}</span>
            </div>
            <div style={{ height: 24, background: 'var(--bg)', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ 
                height: '100%', 
                width: maxVal ? (count / maxVal * 100) + '%' : '0%',
                background: colors[group],
                borderRadius: 6,
                transition: 'width 0.3s'
              }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CentreWiseReport({ data }) {
  return (
    <div>
      <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '0.5rem 1rem', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 80px 80px 80px', gap: '0.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
          <span>Centre</span><span>Eligible</span><span>Present</span><span>%</span>
        </div>
        {(!data.stats || data.stats.length === 0) ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No centre data found for the selected date range
          </div>
        ) : (
          data.stats.map((s, i) => (
            <div key={s.centre} style={{ 
              padding: '0.6rem 1rem', 
              borderBottom: '1px solid var(--border)', 
              display: 'grid', 
              gridTemplateColumns: '1fr 80px 80px 80px', 
              gap: '0.5rem', 
              fontSize: '0.85rem', 
              alignItems: 'center',
              background: i === 0 ? 'rgba(34,197,94,0.05)' : 'transparent'
            }}>
              <span style={{ fontWeight: 500 }}>{s.centre}</span>
              <span style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{s.eligible}</span>
              <span style={{ textAlign: 'center', color: 'var(--green)', fontWeight: 600 }}>{s.present}</span>
              <span style={{ textAlign: 'center', fontWeight: 700, color: s.pct >= 50 ? 'var(--green)' : 'var(--red)' }}>{s.pct}%</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function FlagsReport({ data }) {
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ background: 'rgba(220,38,38,0.1)', padding: '1rem', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--red)' }}>{data.stats.open || 0}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Open</div>
        </div>
        <div style={{ background: 'rgba(234,179,8,0.1)', padding: '1rem', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#ca8a04' }}>{data.stats.in_progress || 0}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>In Progress</div>
        </div>
        <div style={{ background: 'rgba(34,197,94,0.1)', padding: '1rem', borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--green)' }}>{data.stats.resolved || 0}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Resolved</div>
        </div>
      </div>
      
      <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, overflow: 'hidden' }}>
        {data.flags.map((f, i) => (
          <div key={f.id} style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
              <span style={{ fontFamily: 'monospace', color: 'var(--gold)', fontWeight: 600, fontSize: '0.85rem' }}>{f.badge_number || '—'}</span>
              <span style={{ 
                fontSize: '0.7rem', 
                padding: '2px 8px', 
                borderRadius: 4,
                background: f.status === 'open' ? 'rgba(220,38,38,0.1)' : f.status === 'in_progress' ? 'rgba(234,179,8,0.1)' : 'rgba(34,197,94,0.1)',
                color: f.status === 'open' ? 'var(--red)' : f.status === 'in_progress' ? '#ca8a04' : 'var(--green)'
              }}>{f.status}</span>
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{f.issue_description?.substring(0, 80)}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              {f.raised_by_name} · {formatDate(f.created_at)}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function LateReport({ data }) {
  return (
    <div>
      <div style={{ background: 'var(--bg-elevated)', padding: '0.75rem 1rem', borderRadius: 12, marginBottom: '1rem', fontSize: '0.9rem' }}>
        Showing arrivals after <strong>{data.threshold}</strong> · {data.lateSessions.length} late entries
      </div>
      
      <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, overflow: 'hidden' }}>
        {data.lateSessions.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No late arrivals!</div>
        ) : (
          data.lateSessions.map((s, i) => (
            <div key={s.id || i} style={{ padding: '0.6rem 1rem', borderBottom: '1px solid var(--border)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', width: 100 }}>{s.date_ist}</span>
              <span style={{ fontFamily: 'monospace', color: 'var(--gold)', fontWeight: 600, fontSize: '0.85rem' }}>{s.badge_number}</span>
              <span style={{ fontWeight: 500, flex: 1 }}>{s.sewadar_name}</span>
              <span style={{ fontWeight: 700, color: 'var(--red)' }}>{formatTime(s.in_time)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function TrendReport({ data }) {
  const maxPresent = Math.max(...data.trend.map(t => t.present))
  
  return (
    <div>
      <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '0.5rem' }}>
          {data.trend.map((t, i) => (
            <div key={t.date} style={{ flex: 1, textAlign: 'center' }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.25rem' }}>{t.present}</div>
              <div style={{ height: 100, background: 'var(--bg)', borderRadius: 6, display: 'flex', alignItems: 'flex-end' }}>
                <div style={{ 
                  width: '100%', 
                  background: i === data.trend.length - 1 ? 'var(--gold)' : 'var(--green)',
                  borderRadius: 6,
                  height: maxPresent ? (t.present / maxPresent * 100) + '%' : '0%',
                  transition: 'height 0.3s'
                }} />
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>{t.label}</div>
            </div>
          ))}
        </div>
      </div>
      
      <div style={{ background: 'var(--bg-elevated)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '0.5rem 1rem', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 80px 80px 60px', gap: '0.5rem', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)' }}>
          <span>Day</span><span>Present</span><span>Eligible</span><span>%</span>
        </div>
        {data.trend.map((t, i) => (
          <div key={t.date} style={{ padding: '0.5rem 1rem', borderBottom: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr 80px 80px 60px', gap: '0.5rem', fontSize: '0.85rem', alignItems: 'center' }}>
            <span style={{ fontWeight: 500 }}>{t.label}</span>
            <span style={{ textAlign: 'center', fontWeight: 600 }}>{t.present}</span>
            <span style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{t.eligible}</span>
            <span style={{ textAlign: 'center', fontWeight: 700, color: t.pct >= 50 ? 'var(--green)' : 'var(--red)' }}>{t.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
