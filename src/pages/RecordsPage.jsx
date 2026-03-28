import React, { useState, useEffect, useRef } from 'react'
import { supabase, ROLES, DUTY_TYPE_LABEL } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { todayDateStr, formatDateStr, scanTimeToISTDate } from '../lib/dateUtils'
import {
  Search, Download, Flag, X, RefreshCw,
  Trash2, FileText, BarChart2
} from 'lucide-react'
import DateRangePicker from '../components/DateRangePicker'
import CentreComboBox from '../components/CentreComboBox'
import SkeletonRows from '../components/SkeletonRows'
import EmptyState from '../components/EmptyState'
import ConfirmModal from '../components/ConfirmModal'
import { showSuccess, showError } from '../components/Toast'

const PAGE_SIZE = 50

function formatTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata'
  })
}

function formatDuration(inTime, outTime) {
  if (!inTime || !outTime) return null
  const mins = Math.round((new Date(outTime) - new Date(inTime)) / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function csvEscape(val) {
  if (val === null || val === undefined) return ''
  const str = String(val)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

// =====================================================
// ATTENDANCE TAB - SESSION BASED
// =====================================================
function AttendanceTab() {
  const { profile } = useAuth()
  const isAso = profile?.role === ROLES.ASO
  const isCentreUser = profile?.role === ROLES.CENTRE
  const canEdit = isAso

  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [dateRange, setDateRange] = useState({ from: todayDateStr(), to: todayDateStr() })
  const [centreFilter, setCentreFilter] = useState(null)
  const [dutyFilter, setDutyFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [centres, setCentres] = useState([])
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  const searchTimerRef = useRef(null)

  useEffect(() => {
    fetchCentres()
  }, [])

  useEffect(() => {
    clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setSearchTerm(searchInput)
      setPage(1)
    }, 300)
    return () => clearTimeout(searchTimerRef.current)
  }, [searchInput])

  useEffect(() => {
    fetchRecords()
  }, [page, dateRange, centreFilter, dutyFilter, statusFilter])

  async function fetchCentres() {
    let q = supabase.from('centres').select('centre_name, parent_centre').order('centre_name')
    if (isCentreUser && profile?.centre) {
      q = q.or(`centre_name.eq.${profile.centre},parent_centre.eq.${profile.centre}`)
    }
    const { data } = await q
    setCentres(data || [])
  }

  async function fetchRecords() {
    setLoading(true)

    let q = supabase
      .from('attendance_sessions')
      .select('*', { count: 'exact' })
      .gte('date_ist', dateRange.from)
      .lte('date_ist', dateRange.to)
      .order('date_ist', { ascending: false })
      .order('in_time', { ascending: false })

    // Centre scope
    if (isCentreUser && profile?.centre) {
      const scope = [profile.centre, ...centres.filter(c => c.parent_centre === profile.centre).map(c => c.centre_name)]
      q = q.in('centre', scope)
    } else if (centreFilter) {
      q = q.eq('centre', centreFilter)
    }

    // Search
    if (searchTerm.trim()) {
      q = q.or(`badge_number.ilike.%${searchTerm.trim()}%,sewadar_name.ilike.%${searchTerm.trim()}%`)
    }

    // Duty type filter
    if (dutyFilter) {
      q = q.eq('duty_type', dutyFilter)
    }

    // Status filter
    if (statusFilter === 'open') {
      q = q.eq('is_open', true)
    } else if (statusFilter === 'closed') {
      q = q.eq('is_open', false)
    }

    const { data, count, error } = await q.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    setLoading(false)
    if (error) {
      console.warn('[Records] fetch failed:', error)
      return
    }
    setRecords(data || [])
    setTotalCount(count || 0)
  }

  async function deleteSession(record) {
    setDeleteConfirm(record)
  }

  async function doDelete() {
    if (!deleteConfirm) return
    const { id, badge_number } = deleteConfirm
    
    const { error } = await supabase.from('attendance_sessions').delete().eq('id', id)
    if (error) {
      showError('Delete failed: ' + error.message)
    } else {
      // Also delete associated attendance records
      await supabase.from('attendance').delete().eq('session_id', id)
      
      await supabase.from('logs').insert({
        user_badge: profile.badge_number,
        action: 'DELETE_SESSION',
        details: `Deleted session ${id} for ${badge_number}`,
        timestamp: new Date().toISOString(),
      }).catch(console.warn)
      
      showSuccess('Session deleted')
      fetchRecords()
    }
    setDeleteConfirm(null)
  }

  function getStatusBadge(session) {
    if (session.is_open) {
      return <span style={{ fontSize: '0.7rem', background: 'rgba(234,179,8,0.15)', color: '#ca8a04', border: '1px solid rgba(234,179,8,0.3)', borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>OPEN</span>
    }
    if (session.force_closed) {
      return <span style={{ fontSize: '0.7rem', background: 'rgba(156,163,175,0.15)', color: '#6b7280', border: '1px solid rgba(156,163,175,0.3)', borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>CORRECTED</span>
    }
    return <span style={{ fontSize: '0.7rem', background: 'rgba(34,197,94,0.15)', color: '#16a34a', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>COMPLETE</span>
  }

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.75rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <div className="search-box" style={{ flex: 1, minWidth: 200 }}>
          <Search size={14} />
          <input type="text" placeholder="Search badge or name…" value={searchInput}
            onChange={e => setSearchInput(e.target.value)} />
          {searchInput && <button onClick={() => setSearchInput('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}><X size={13} /></button>}
        </div>

        {isAso && (
          <CentreComboBox value={centreFilter} onChange={val => { setCentreFilter(val); setPage(1) }} centres={centres} includeAll={true} />
        )}

        <DateRangePicker value={dateRange} onChange={val => { setDateRange(val); setPage(1) }} />

        <select value={dutyFilter} onChange={e => { setDutyFilter(e.target.value); setPage(1) }}
          style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.4rem 0.6rem', background: 'var(--bg)', fontSize: '0.8rem' }}>
          <option value="">All Duty Types</option>
          <option value="satsang">Satsang Duty</option>
          <option value="gate_entry">Gate Entry</option>
          <option value="watch_ward">Watch & Ward</option>
        </select>

        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
          style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.4rem 0.6rem', background: 'var(--bg)', fontSize: '0.8rem' }}>
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>

        <button className="btn btn-ghost" onClick={fetchRecords}><RefreshCw size={14} /></button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.4rem 0.85rem', fontSize: '0.8rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>Showing </span><strong>{records.length}</strong><span style={{ color: 'var(--text-muted)' }}> of </span><strong>{totalCount}</strong><span style={{ color: 'var(--text-muted)' }}> sessions</span>
        </div>
      </div>

      {/* Table */}
      <div className="records-table-wrap">
        {loading ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody><SkeletonRows rows={15} cols={7} /></tbody>
          </table>
        ) : records.length === 0 ? (
          <EmptyState icon={FileText} title={searchTerm ? `No results for "${searchTerm}"` : 'No records found'} message="No attendance sessions in selected date range" />
        ) : (
          <table className="records-table">
            <thead>
              <tr>
                <th style={{ width: '110px' }}>Badge</th>
                <th style={{ width: '180px' }}>Name</th>
                {isAso && <th style={{ width: '150px' }}>Centre</th>}
                <th style={{ width: '130px' }}>Duty Type</th>
                <th style={{ width: '100px' }}>Date</th>
                <th style={{ width: '80px' }}>IN</th>
                <th style={{ width: '80px' }}>OUT</th>
                <th style={{ width: '80px' }}>Duration</th>
                <th style={{ width: '100px' }}>Status</th>
                <th style={{ width: '60px' }}></th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => {
                const dateLabel = r.out_time && scanTimeToISTDate(r.out_time) !== r.date_ist
                  ? `${formatDateStr(r.date_ist)} → ${formatDateStr(scanTimeToISTDate(r.out_time))}`
                  : formatDateStr(r.date_ist)
                
                return (
                  <tr key={r.id}>
                    <td style={{ fontFamily: 'monospace', color: 'var(--gold)', fontSize: '0.85rem', fontWeight: 700 }}>{r.badge_number}</td>
                    <td style={{ fontWeight: 500, fontSize: '0.9rem' }}>{r.sewadar_name}</td>
                    {isAso && <td style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{r.centre}</td>}
                    <td>
                      <span style={{ 
                        fontSize: '0.7rem', 
                        background: r.duty_type === 'satsang' ? 'rgba(168,85,247,0.15)' : r.duty_type === 'watch_ward' ? 'rgba(59,130,246,0.15)' : 'rgba(107,114,128,0.15)',
                        color: r.duty_type === 'satsang' ? '#9333ea' : r.duty_type === 'watch_ward' ? '#3b82f6' : '#6b7280',
                        border: '1px solid',
                        borderColor: r.duty_type === 'satsang' ? 'rgba(168,85,247,0.3)' : r.duty_type === 'watch_ward' ? 'rgba(59,130,246,0.3)' : 'rgba(107,114,128,0.3)',
                        borderRadius: 6, padding: '2px 8px', fontWeight: 700 
                      }}>
                        {DUTY_TYPE_LABEL[r.duty_type] || r.duty_type}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.82rem', fontFamily: 'monospace' }}>{dateLabel}</td>
                    <td style={{ fontSize: '0.82rem' }}>{formatTime(r.in_time)}</td>
                    <td style={{ fontSize: '0.82rem' }}>{formatTime(r.out_time)}</td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{formatDuration(r.in_time, r.out_time) || '—'}</td>
                    <td>{getStatusBadge(r)}</td>
                    <td>
                      {canEdit && (
                        <button className="records-delete-btn" title="Delete session" onClick={() => deleteSession(r)}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {!loading && totalCount > PAGE_SIZE && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', marginTop: '1rem' }}>
          <button className="btn btn-ghost" onClick={() => setPage(1)} disabled={page === 1} style={{ padding: '0.35rem 0.6rem' }}>«</button>
          <button className="btn btn-ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ padding: '0.35rem 0.6rem' }}>‹</button>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Page {page} of {Math.ceil(totalCount / PAGE_SIZE)}</span>
          <button className="btn btn-ghost" onClick={() => setPage(p => Math.min(Math.ceil(totalCount / PAGE_SIZE), p + 1))} disabled={page >= Math.ceil(totalCount / PAGE_SIZE)} style={{ padding: '0.35rem 0.6rem' }}>›</button>
          <button className="btn btn-ghost" onClick={() => setPage(Math.ceil(totalCount / PAGE_SIZE))} disabled={page >= Math.ceil(totalCount / PAGE_SIZE)} style={{ padding: '0.35rem 0.6rem' }}>»</button>
        </div>
      )}

      <ConfirmModal open={!!deleteConfirm} onConfirm={doDelete} onCancel={() => setDeleteConfirm(null)}
        title="Delete Session?" message={`Delete attendance session for ${deleteConfirm?.sewadar_name}? This will also delete all associated attendance records.`} confirmLabel="Delete" danger />
    </div>
  )
}

// =====================================================
// REPORTS TAB
// =====================================================
function ReportsTab() {
  const { profile } = useAuth()
  const isAso = profile?.role === ROLES.ASO
  const isCentreUser = profile?.role === ROLES.CENTRE

  const [loading, setLoading] = useState(false)
  const [year, setYear] = useState(new Date().getFullYear().toString())
  const [reportType, setReportType] = useState('satsang')
  const [data, setData] = useState([])
  const [centres, setCentres] = useState([])
  const [centreFilter, setCentreFilter] = useState(null)

  useEffect(() => {
    fetchCentres()
  }, [])

  useEffect(() => {
    fetchReport()
  }, [year, reportType, centreFilter, profile])

  async function fetchCentres() {
    let q = supabase.from('centres').select('centre_name, parent_centre').order('centre_name')
    if (isCentreUser && profile?.centre) {
      q = q.or(`centre_name.eq.${profile.centre},parent_centre.eq.${profile.centre}`)
    }
    const { data } = await q
    setCentres(data || [])
  }

  async function fetchReport() {
    setLoading(true)
    
    if (reportType === 'satsang') {
      // Satsang days by sewadar
      let q = supabase
        .from('attendance_sessions')
        .select('badge_number, sewadar_name, centre, date_ist, duty_type')
        .eq('duty_type', 'satsang')
        .eq('is_open', false)
        .gte('date_ist', `${year}-01-01`)
        .lte('date_ist', `${year}-12-31`)
        .order('sewadar_name')

      if (isCentreUser && profile?.centre) {
        const scope = [profile.centre, ...centres.filter(c => c.parent_centre === profile.centre).map(c => c.centre_name)]
        q = q.in('centre', scope)
      } else if (centreFilter) {
        q = q.eq('centre', centreFilter)
      }

      const { data: sessions } = await q

      // Group by badge and count unique dates
      const badgeMap = {}
      sessions?.forEach(s => {
        if (!badgeMap[s.badge_number]) {
          badgeMap[s.badge_number] = { badge_number: s.badge_number, name: s.sewadar_name, centre: s.centre, days: new Set() }
        }
        badgeMap[s.badge_number].days.add(s.date_ist)
      })

      setData(Object.values(badgeMap).map(b => ({
        badge_number: b.badge_number,
        sewadar_name: b.name,
        centre: b.centre,
        count: b.days.size
      })).sort((a, b) => b.count - a.count))

    } else if (reportType === 'duty_summary') {
      // Duty summary by sewadar
      let q = supabase
        .from('attendance_sessions')
        .select('badge_number, sewadar_name, centre, duty_type, is_open')
        .gte('date_ist', `${year}-01-01`)
        .lte('date_ist', `${year}-12-31`)
        .order('sewadar_name')

      if (isCentreUser && profile?.centre) {
        const scope = [profile.centre, ...centres.filter(c => c.parent_centre === profile.centre).map(c => c.centre_name)]
        q = q.in('centre', scope)
      } else if (centreFilter) {
        q = q.eq('centre', centreFilter)
      }

      const { data: sessions } = await q

      const badgeMap = {}
      sessions?.forEach(s => {
        if (!badgeMap[s.badge_number]) {
          badgeMap[s.badge_number] = { badge_number: s.badge_number, name: s.sewadar_name, centre: s.centre, satsang: 0, gate_entry: 0, watch_ward: 0, open: 0 }
        }
        if (s.duty_type === 'satsang') badgeMap[s.badge_number].satsang++
        else if (s.duty_type === 'gate_entry') badgeMap[s.badge_number].gate_entry++
        else if (s.duty_type === 'watch_ward') badgeMap[s.badge_number].watch_ward++
        if (s.is_open) badgeMap[s.badge_number].open++
      })

      setData(Object.values(badgeMap))

    } else if (reportType === 'open_now') {
      // Who's inside now
      let q = supabase
        .from('attendance_sessions')
        .select('badge_number, sewadar_name, centre, department, in_time, duty_type')
        .eq('is_open', true)
        .order('in_time', { ascending: false })

      if (isCentreUser && profile?.centre) {
        const scope = [profile.centre, ...centres.filter(c => c.parent_centre === profile.centre).map(c => c.centre_name)]
        q = q.in('centre', scope)
      }

      const { data: sessions } = await q
      setData(sessions || [])
    }

    setLoading(false)
  }

  function exportCSV() {
    if (!data.length) return

    let header, rows
    if (reportType === 'satsang') {
      header = ['Badge', 'Name', 'Centre', 'Satsang Days']
      rows = data.map(r => [r.badge_number, csvEscape(r.sewadar_name), csvEscape(r.centre), r.count])
    } else if (reportType === 'duty_summary') {
      header = ['Badge', 'Name', 'Centre', 'Satsang', 'Gate Entry', 'Watch & Ward', 'Open']
      rows = data.map(r => [r.badge_number, csvEscape(r.sewadar_name), csvEscape(r.centre), r.satsang, r.gate_entry, r.watch_ward, r.open])
    } else {
      header = ['Badge', 'Name', 'Centre', 'Department', 'IN Time', 'Duty Type']
      rows = data.map(r => [r.badge_number, csvEscape(r.sewadar_name), csvEscape(r.centre), csvEscape(r.department || ''), formatTime(r.in_time), r.duty_type])
    }

    const csv = [header, ...rows].map(r => r.join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `${reportType}_${year}.csv`
    a.click()
  }

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.75rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <select value={reportType} onChange={e => setReportType(e.target.value)}
          style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.4rem 0.6rem', background: 'var(--bg)', fontSize: '0.85rem' }}>
          <option value="satsang">Satsang Days</option>
          <option value="duty_summary">Duty Summary</option>
          <option value="open_now">Who&apos;s Inside Now</option>
        </select>

        {reportType !== 'open_now' && (
          <select value={year} onChange={e => setYear(e.target.value)}
            style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.4rem 0.6rem', background: 'var(--bg)', fontSize: '0.85rem' }}>
            {[2024, 2025, 2026].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        )}

        {isAso && reportType !== 'open_now' && (
          <CentreComboBox value={centreFilter} onChange={setCentreFilter} centres={centres} includeAll={true} />
        )}

        <button className="btn btn-excel" onClick={exportCSV} disabled={!data.length}><Download size={14} /> Export</button>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.4rem 0.85rem', fontSize: '0.8rem' }}>
          <strong>{data.length}</strong> records
        </div>
        {reportType === 'satsang' && (
          <div style={{ background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', borderRadius: 8, padding: '0.4rem 0.85rem', fontSize: '0.8rem', color: '#9333ea' }}>
            Total: <strong>{data.reduce((a, b) => a + b.count, 0)}</strong> satsang days
          </div>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-center" style={{ padding: '2rem' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
      ) : data.length === 0 ? (
        <EmptyState icon={BarChart2} title="No data" message="No records found for selected filters" />
      ) : (
        <div className="records-table-wrap">
          <table className="records-table">
            <thead>
              <tr>
                <th>Badge</th>
                <th>Name</th>
                {isAso && <th>Centre</th>}
                {reportType === 'satsang' && <th>Satsang Days</th>}
                {reportType === 'duty_summary' && <th>Satsang</th>}
                {reportType === 'duty_summary' && <th>Gate Entry</th>}
                {reportType === 'duty_summary' && <th>Watch & Ward</th>}
                {reportType === 'duty_summary' && <th>Open</th>}
                {reportType === 'open_now' && <th>Department</th>}
                {reportType === 'open_now' && <th>IN Time</th>}
                {reportType === 'open_now' && <th>Duty Type</th>}
              </tr>
            </thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={i}>
                  <td style={{ fontFamily: 'monospace', color: 'var(--gold)', fontWeight: 700 }}>{r.badge_number}</td>
                  <td>{r.sewadar_name}</td>
                  {isAso && <td>{r.centre}</td>}
                  {reportType === 'satsang' && <td style={{ fontWeight: 700, color: '#9333ea' }}>{r.count}</td>}
                  {reportType === 'duty_summary' && <td>{r.satsang}</td>}
                  {reportType === 'duty_summary' && <td>{r.gate_entry}</td>}
                  {reportType === 'duty_summary' && <td>{r.watch_ward}</td>}
                  {reportType === 'duty_summary' && <td>{r.open}</td>}
                  {reportType === 'open_now' && <td>{r.department || '—'}</td>}
                  {reportType === 'open_now' && <td>{formatTime(r.in_time)}</td>}
                  {reportType === 'open_now' && <td>{DUTY_TYPE_LABEL[r.duty_type]}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// =====================================================
// FLAGS TAB
// =====================================================
function FlagsTab() {
  const { profile } = useAuth()
  const isAso = profile?.role === ROLES.ASO

  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [_totalCount, setTotalCount] = useState(0)
  const [page, _setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('open')

  useEffect(() => {
    fetchFlags()
  }, [page, statusFilter])

  async function fetchFlags() {
    setLoading(true)
    let q = supabase
      .from('queries')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (statusFilter === 'open') {
      q = q.eq('status', 'open')
    } else if (statusFilter === 'resolved') {
      q = q.eq('status', 'resolved')
    }

    const { data, count, error } = await q.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    setLoading(false)
    if (!error) {
      setRecords(data || [])
      setTotalCount(count || 0)
    }
  }

  async function resolveFlag(id) {
    await supabase.from('queries').update({ status: 'resolved', updated_at: new Date().toISOString() }).eq('id', id)
    fetchFlags()
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button className={`btn ${statusFilter === 'open' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setStatusFilter('open')}>Open</button>
        <button className={`btn ${statusFilter === 'resolved' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setStatusFilter('resolved')}>Resolved</button>
      </div>

      {loading ? (
        <div className="text-center" style={{ padding: '2rem' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
      ) : records.length === 0 ? (
        <EmptyState icon={Flag} title="No flags" message={statusFilter === 'open' ? 'No open flags' : 'No resolved flags'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {records.map(r => (
            <div key={r.id} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{r.issue_description}</div>
                  <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                    {r.raised_by_name} · {r.raised_by_centre} · {new Date(r.created_at).toLocaleDateString('en-IN')}
                  </div>
                </div>
                {statusFilter === 'open' && isAso && (
                  <button className="btn btn-ghost" onClick={() => resolveFlag(r.id)}>Resolve</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// =====================================================
// MAIN RECORDS PAGE
// =====================================================
export default function RecordsPage() {
  const { profile } = useAuth()
  const isAso = profile?.role === ROLES.ASO

  const [activeTab, setActiveTab] = useState('attendance')

  const canReports = isAso || profile?.can_reports
  const canFlags = isAso || profile?.can_flags

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
        <button
          onClick={() => setActiveTab('attendance')}
          style={{
            padding: '0.5rem 1rem',
            background: activeTab === 'attendance' ? 'var(--gold-bg)' : 'transparent',
            border: 'none',
            borderRadius: '8px 8px 0 0',
            color: activeTab === 'attendance' ? 'var(--gold)' : 'var(--text-muted)',
            fontWeight: 600,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <FileText size={14} style={{ marginRight: '0.35rem', verticalAlign: 'middle' }} />
          Attendance
        </button>

        {canReports && (
          <button
            onClick={() => setActiveTab('reports')}
            style={{
              padding: '0.5rem 1rem',
              background: activeTab === 'reports' ? 'var(--gold-bg)' : 'transparent',
              border: 'none',
              borderRadius: '8px 8px 0 0',
              color: activeTab === 'reports' ? 'var(--gold)' : 'var(--text-muted)',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <BarChart2 size={14} style={{ marginRight: '0.35rem', verticalAlign: 'middle' }} />
            Reports
          </button>
        )}

        {canFlags && (
          <button
            onClick={() => setActiveTab('flags')}
            style={{
              padding: '0.5rem 1rem',
              background: activeTab === 'flags' ? 'var(--gold-bg)' : 'transparent',
              border: 'none',
              borderRadius: '8px 8px 0 0',
              color: activeTab === 'flags' ? 'var(--gold)' : 'var(--text-muted)',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
          <Flag size={14} style={{ marginRight: '0.35rem', verticalAlign: 'middle' }} />
          Flags
          </button>
        )}
      </div>

      {activeTab === 'attendance' && <AttendanceTab />}
      {activeTab === 'reports' && canReports && <ReportsTab />}
      {activeTab === 'flags' && canFlags && <FlagsTab />}
    </div>
  )
}
