import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, ROLES, DUTY_TYPE_LABEL } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { todayDateStr, formatDateStr, scanTimeToISTDate } from '../lib/dateUtils'
import { detectTimeConflict, hasTimeConflict, hasTimeConflictForOut, hasSessionOverlap } from '../lib/sessionLogic'
import {
  Search, Download, Flag, X, RefreshCw,
  Trash2, FileText, PenLine, BarChart2
} from 'lucide-react'
import DateRangePicker from '../components/DateRangePicker'
import CentreComboBox from '../components/CentreComboBox'
import SkeletonRows from '../components/SkeletonRows'
import EmptyState from '../components/EmptyState'
import ConfirmModal from '../components/ConfirmModal'
import { showSuccess, showError } from '../components/Toast'
import { deleteSessionWithAttendance, syncSessionWithAttendance } from '../lib/sessionLogic'

const PAGE_SIZE = 50

function formatTime(iso) {
  if (!iso) return '—'
  // Handle both full ISO timestamps and just time strings (HH:mm:ss)
  if (iso.includes('T')) {
    return new Date(iso).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata'
    })
  }
  // Just time string - return as-is
  if (iso.match(/^\d{2}:\d{2}/)) {
    const [h, m] = iso.split(':')
    const hour = parseInt(h)
    const ampm = hour >= 12 ? 'pm' : 'am'
    const hour12 = hour % 12 || 12
    return `${hour12}:${m} ${ampm}`
  }
  return iso
}

function extractISTDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

function extractISTTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
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
  const navigate = useNavigate()
  const { profile } = useAuth()
  const isAso = profile?.role === ROLES.ASO
  const isCentreUser = profile?.role === ROLES.CENTRE || profile?.role === ROLES.SC_SP_USER
  const canEdit = !!isAso
  const canFlag = !!isAso || !!profile?.can_flags

  function goToFlag(flagId) {
    navigate(`/flags?id=${flagId}`)
  }

  // Helper to check if session is within 40 min edit window (for centre users only)
  // Uses created_at (timestamp when record was created) not IN time
  function canEditSession(session) {
    const timeRef = session?.created_at || session?.in_time
    if (!timeRef) return false
    
    const refTime = new Date(timeRef)
    const now = new Date()
    const diffMs = now - refTime
    const diffMins = diffMs / (1000 * 60)
    
    return diffMins <= 40
  }

  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [dateRange, setDateRange] = useState({ from: todayDateStr(), to: todayDateStr() })
  const [dateRangeAdvanced, setDateRangeAdvanced] = useState(false)
  const [centreFilter, setCentreFilter] = useState(null)
  const [dutyFilter, setDutyFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [centres, setCentres] = useState([])
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [flagModal, setFlagModal] = useState(null)
  const [flagReason, setFlagReason] = useState('')
  const [flagSubmitting, setFlagSubmitting] = useState(false)
  const [editingSession, setEditingSession] = useState(null)
  const [editInTime, setEditInTime] = useState('')
  const [editOutTime, setEditOutTime] = useState('')
  const [editInDate, setEditInDate] = useState('')
  const [editOutDate, setEditOutDate] = useState('')

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
  }, [page, dateRange, centreFilter, dutyFilter, statusFilter, searchTerm])

  const fetchRecordsRef = useRef(null)
  fetchRecordsRef.current = fetchRecords

  // Real-time updates
  useEffect(() => {
    let timer = null
    const channel = supabase.channel('records-realtime-v3')
    
    channel.on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'attendance_sessions' 
    }, (payload) => {
      if (import.meta.env.DEV) console.log('[RT-RECORDS] sessions event:', payload.eventType)
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (fetchRecordsRef.current) fetchRecordsRef.current()
      }, 100) // Reduced from 300ms to 100ms
    })
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'attendance' 
    }, (payload) => {
      if (import.meta.env.DEV) console.log('[RT-RECORDS] attendance event:', payload.eventType)
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (fetchRecordsRef.current) fetchRecordsRef.current()
      }, 100) // Reduced from 300ms to 100ms
    })
    .subscribe((status, err) => {
      if (import.meta.env.DEV) console.log('[RT-RECORDS] Channel status:', status)
    })

    return () => { 
      if (import.meta.env.DEV) console.log('[RT-RECORDS] Cleanup')
      clearTimeout(timer)
      supabase.removeChannel(channel) 
    }
  }, [])

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

    const isSingleDay = dateRange.from === dateRange.to
    const fromDate = dateRange.from
    const toDate = dateRange.to

    let q = supabase
      .from('v_sessions_full')
      .select('*', { count: 'exact' })
    
    if (isSingleDay) {
      q = q.eq('date_ist', fromDate)
    } else {
      q = q.gte('date_ist', fromDate).lte('date_ist', toDate)
    }
    
    q = q.order('date_ist', { ascending: false }).order('in_time', { ascending: false })

    // Centre scope
    if (centreFilter) {
      q = q.eq('sewadar_centre', centreFilter)
      if (import.meta.env.DEV) console.log('[Records] Centre filter:', centreFilter)
    } else if (isCentreUser && profile?.centre) {
      let childCentres = centres.filter(c => c.parent_centre === profile.centre).map(c => c.centre_name)
      if (childCentres.length === 0 && centres.length === 0) {
        const { data: childData } = await supabase
          .from('centres')
          .select('centre_name')
          .eq('parent_centre', profile.centre)
        childCentres = (childData || []).map(c => c.centre_name)
      }
      const scope = [profile.centre, ...childCentres]
      q = q.in('sewadar_centre', scope)
      if (import.meta.env.DEV) console.log('[Records] Centre scope (user):', scope)
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
      if (import.meta.env.DEV) console.warn('[Records] fetch failed:', error)
      return
    }
    
    if (import.meta.env.DEV) {
      console.log('[Records] Fetched:', data?.length, 'records, total:', count)
      if (data?.length > 0) {
        console.log('[Records] Sample centre values:', [...new Set(data.map(r => r.sewadar_centre))].slice(0, 5))
      }
    }

    const sessions = data || []
    const flaggedIds = sessions.filter(s => s.flagged).map(s => s.id)

    if (flaggedIds.length > 0) {
      const { data: flagsData } = await supabase
        .from('queries')
        .select('id, session_id, issue_description, status')
        .in('session_id', flaggedIds)
        .neq('status', 'resolved')

      const flagsMap = Object.fromEntries((flagsData || []).map(f => [f.session_id, f]))

      for (const session of sessions) {
        if (session.flagged && flagsMap[session.id]) {
          session.flag_reason = flagsMap[session.id].issue_description
          session.flag_status = flagsMap[session.id].status
          session.flag_id = flagsMap[session.id].id
        }
      }
    }

    setRecords(sessions)
    setTotalCount(count || 0)
  }

  async function deleteSession(record) {
    setDeleteConfirm(record)
  }

  async function exportAttendanceCSV() {
    showSuccess('Preparing export...')
    
    try {
      const isSingleDay = dateRange.from === dateRange.to
      const fromDate = dateRange.from
      const toDate = dateRange.to
      
      let q = supabase
        .from('v_sessions')
        .select('badge_number, sewadar_name, sewadar_centre, sewadar_department, date_ist, in_time, in_scanner_name, out_time, out_scanner_name, duty_type, is_open')
      
      if (isSingleDay) {
        q = q.eq('date_ist', fromDate)
      } else {
        q = q.gte('date_ist', fromDate).lte('date_ist', toDate)
      }
      
      q = q.order('date_ist', { ascending: false }).order('in_time', { ascending: false })

      // Centre scope
      if (isCentreUser && profile?.centre) {
        const scope = [profile.centre, ...centres.filter(c => c.parent_centre === profile.centre).map(c => c.centre_name)]
        q = q.in('sewadar_centre', scope)
      } else if (centreFilter) {
        q = q.eq('sewadar_centre', centreFilter)
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

      const { data: allSessions } = await q

      if (!allSessions?.length) {
        showError('No data to export')
        return
      }

      const header = ['Badge', 'Name', 'Centre', 'Department', 'Duty Type', 'IN Date', 'IN Time', 'IN Scanner', 'OUT Date', 'OUT Time', 'OUT Scanner', 'Duration', 'Status']
      const rows = allSessions.map(r => {
        const inDate = formatDateStr(r.date_ist)
        const outDate = r.out_time ? formatDateStr(scanTimeToISTDate(r.out_time)) : ''
        return [
          csvEscape(r.badge_number),
          csvEscape(r.sewadar_name),
          csvEscape(r.sewadar_centre),
          csvEscape(r.sewadar_department || ''),
          csvEscape(DUTY_TYPE_LABEL[r.duty_type] || r.duty_type),
          csvEscape(inDate),
          formatTime(r.in_time),
          csvEscape(r.in_scanner_name || r.scanner_name || ''),
          csvEscape(outDate),
          formatTime(r.out_time),
          csvEscape(r.out_scanner_name || ''),
          formatDuration(r.in_time, r.out_time) || '',
          r.is_open ? 'Open' : r.force_closed ? 'Corrected' : 'Complete',
        ]
      })
      const csv = [header, ...rows].map(r => r.join(',')).join('\n')
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
      a.download = `attendance_${dateRange.from}_${dateRange.to}.csv`
      a.click()
      showSuccess(`Exported ${allSessions.length} records`)
    } catch (err) {
      showError('Export failed: ' + err.message)
    }
  }

  async function doDelete() {
    if (!deleteConfirm || !profile) return
    const { id, badge_number } = deleteConfirm

    try {
      await deleteSessionWithAttendance(supabase, {
        sessionId: id,
        deletedByBadge: profile.badge_number,
        reason: 'Manual deletion from records page'
      })

      showSuccess('Session deleted')
      fetchRecords()
    } catch (err) {
      showError('Delete failed: ' + err.message)
    }
    setDeleteConfirm(null)
  }

  async function doFlag() {
    if (!flagModal) {
      showError('No session selected')
      return
    }
    if (!flagReason.trim()) {
      showError('Please enter a reason for flagging')
      return
    }
    if (!profile) {
      showError('Profile not loaded. Please refresh the page.')
      return
    }
    setFlagSubmitting(true)

    try {
      const { data: existing } = await supabase
        .from('queries')
        .select('id')
        .eq('session_id', flagModal.id)
        .in('status', ['open', 'in_progress'])
        .maybeSingle()

      if (existing) {
        setFlagSubmitting(false)
        showError('This session already has an open flag')
        return
      }

      const { data: flag, error: flagError } = await supabase
        .from('queries')
        .insert({
          session_id: flagModal.id,
          raised_by_badge: profile.badge_number,
          raised_by_name: profile.name,
          raised_by_centre: profile.centre,
          raised_by_role: profile.role,
          issue_description: flagReason.trim(),
          reason: flagReason.trim(),
          status: 'open',
          flag_type: 'session_flag',
          badge_number: flagModal.badge_number,
        })
        .select()
        .single()

      if (flagError) throw new Error('Flag failed: ' + flagError.message)

      await supabase.from('attendance_sessions').update({
        flagged: true,
        flag_reason: flagReason.trim(),
        flagged_by: profile.badge_number,
        flagged_at: new Date().toISOString(),
      }).eq('id', flagModal.id)

      await supabase.from('flag_audit_log').insert({
        flag_id: flag.id,
        action: 'FLAG_RAISED',
        actor_badge: profile.badge_number,
        actor_name: profile.name,
        details: `Flag raised: "${flagReason.trim()}"`,
      })

      showSuccess('Query raised — check Queries tab')
      fetchRecords()
    } catch (err) {
      console.error('Flag error:', err)
      showError(err.message || 'Failed to raise flag')
    }

    setFlagSubmitting(false)
    setFlagModal(null)
    setFlagReason('')
  }

  async function saveSessionEdit() {
    if (!editingSession) return

    try {
      // If session is open, only allow editing IN time
      const isOpenSession = editingSession.is_open

      const updates = {}
      let newInTimeISO = null
      let newOutTimeISO = null

      if (editInDate && editInTime) {
        const inDateTime = new Date(`${editInDate}T${editInTime}:00+05:30`)
        if (isNaN(inDateTime.getTime())) {
          showError('Invalid IN date/time')
          return
        }
        newInTimeISO = inDateTime.toISOString()
        updates.in_time = newInTimeISO
        updates.date_ist = editInDate
      } else if (editingSession.in_time) {
        newInTimeISO = editingSession.in_time
      }

      // Only allow OUT time editing if session is not open
      if (!isOpenSession && editOutDate && editOutTime) {
        const outDateTime = new Date(`${editOutDate}T${editOutTime}:00+05:30`)
        if (isNaN(outDateTime.getTime())) {
          showError('Invalid OUT date/time')
          return
        }
        newOutTimeISO = outDateTime.toISOString()
        updates.out_time = newOutTimeISO
      }

      if (!newInTimeISO) {
        showError('IN time is required')
        return
      }

      // If open session, don't check OUT time conflicts
      const checkOutTime = !isOpenSession && newOutTimeISO

      // Check time conflict before saving
      const badgeNumber = editingSession.badge_number
      
      // Fetch existing sessions for this badge (exclude current session)
      const { data: existingSessions } = await supabase
        .from('v_sessions')
        .select('id, badge_number, in_time, out_time, date_ist, duty_type')
        .eq('badge_number', badgeNumber)
        .neq('id', editingSession.id)
        .eq('is_open', false)

      // Fetch jatha records for this person (any jatha that overlaps with proposed time)
      const { data: jathaRecords } = await supabase
        .from('jatha_attendance')
        .select('id, date_from, date_to')
        .eq('badge_number', badgeNumber)
        .lte('date_from', isOpenSession ? newInTimeISO.substring(0, 10) : newOutTimeISO.substring(0, 10))
        .gte('date_to', newInTimeISO.substring(0, 10))

      // Detect conflicts
      const conflictResult = detectTimeConflict({
        sessions: existingSessions || [],
        jathas: jathaRecords || [],
        proposedInISO: newInTimeISO,
        proposedOutISO: newOutTimeISO,
        excludeSessionId: editingSession.id,
        badgeNumber
      })

      if (conflictResult.hasConflict) {
        if (conflictResult.type === 'jatha') {
          showError(`Cannot save: ${conflictResult.message}`)
        } else {
          showError(`Time conflict: ${conflictResult.message}`)
        }
        return
      }

      if (Object.keys(updates).length === 0) {
        setEditingSession(null)
        return
      }

      // Use sync function to keep session and attendance consistent
      await syncSessionWithAttendance(supabase, {
        sessionId: editingSession.id,
        updates,
        updatedBy: profile?.badge_number,
        reason: 'Manual edit from Records page',
      })

      showSuccess('Session and attendance updated')
      setEditingSession(null)
      fetchRecords()
    } catch (err) {
      showError('Update failed: ' + err.message)
    }
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
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.6rem 0.75rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <div className="search-box" style={{ flex: '1 1 220px', minWidth: 180 }}>
          <Search size={14} />
          <input type="text" placeholder="Search badge or name…" value={searchInput}
            onChange={e => setSearchInput(e.target.value)} style={{ minWidth: 0 }} />
          {searchInput && <button onClick={() => setSearchInput('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}><X size={13} /></button>}
        </div>

        {isAso && (
          <CentreComboBox value={centreFilter} onChange={val => { setCentreFilter(val); setPage(1) }} centres={centres} includeAll={true} grouped={true} />
        )}

        {isCentreUser && (
          <CentreComboBox value={centreFilter} onChange={val => { setCentreFilter(val); setPage(1) }} centres={centres.filter(c => c.centre_name === profile?.centre || c.parent_centre === profile?.centre)} includeAll={true} grouped={false} />
        )}

        <DateRangePicker value={dateRange} onChange={val => { setDateRange(val); setPage(1) }} showAdvanced={dateRangeAdvanced} onAdvancedChange={setDateRangeAdvanced} />

        <div style={{ display: 'flex', gap: '0.35rem' }}>
          {['', 'satsang', 'gate_entry', 'watch_ward'].map(d => (
            <button key={d} className={`btn ${dutyFilter === d ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setDutyFilter(d); setPage(1) }} style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem' }}>
              {d === '' ? 'All' : d === 'satsang' ? 'Satsang' : d === 'gate_entry' ? 'Gate' : 'W&W'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '0.35rem' }}>
          {['', 'open', 'closed'].map(s => (
            <button key={s} className={`btn ${statusFilter === s ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setStatusFilter(s); setPage(1) }} style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem' }}>
              {s === '' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0, marginLeft: 'auto' }}>
          <button className="btn btn-ghost" onClick={fetchRecords} title="Refresh"><RefreshCw size={14} /></button>
          <button className="btn btn-excel" onClick={exportAttendanceCSV} disabled={!records.length}><Download size={14} /></button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.4rem 0.85rem', fontSize: '0.8rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>Showing </span><strong>{records.length}</strong><span style={{ color: 'var(--text-muted)' }}> of </span><strong>{totalCount}</strong><span style={{ color: 'var(--text-muted)' }}> sessions</span>
        </div>
      </div>

      {/* Table */}
      <div className="records-table-wrap" style={{ width: "100%" }}>
        {loading ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody><SkeletonRows rows={15} cols={7} /></tbody>
          </table>
        ) : records.length === 0 ? (
          <EmptyState icon={FileText} title={searchTerm ? `No results for "${searchTerm}"` : 'No records found'} message="No attendance sessions in selected date range" />
        ) : (
          <table className="records-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Badge</th>
                <th>Name</th>
                {isAso && <th>Centre</th>}
                <th>Duty</th>
                <th>Date</th>
                <th>IN</th>
                <th>OUT</th>
                <th>Dur</th>
                <th>Status</th>
                <th>Remarks</th>
                <th style={{ width: '90px' }}></th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => {
                const inDate = formatDateStr(r.date_ist)
                const outDateIST = r.out_time ? scanTimeToISTDate(r.out_time) : ''
                const outDate = outDateIST ? formatDateStr(outDateIST) : ''
                const sameDay = outDateIST && r.date_ist === outDateIST
                
                return (
                  <tr key={r.id}>
                    <td style={{ fontFamily: 'monospace', color: 'var(--gold)', fontSize: '0.82rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.badge_number}</td>
                    <td style={{ fontWeight: 600, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sewadar_name}</td>
                    {isAso && <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sewadar_centre}</td>}
                    <td>
                      <span style={{ 
                        fontSize: '0.6rem', 
                        background: r.duty_type === 'satsang' ? 'rgba(168,85,247,0.15)' : r.duty_type === 'watch_ward' ? 'rgba(59,130,246,0.15)' : 'rgba(107,114,128,0.15)',
                        color: r.duty_type === 'satsang' ? '#9333ea' : r.duty_type === 'watch_ward' ? '#3b82f6' : '#6b7280',
                        border: '1px solid',
                        borderColor: r.duty_type === 'satsang' ? 'rgba(168,85,247,0.3)' : r.duty_type === 'watch_ward' ? 'rgba(59,130,246,0.3)' : 'rgba(107,114,128,0.3)',
                        borderRadius: 6, padding: '2px 6px', fontWeight: 700 
                      }}>
                        {r.duty_type === 'watch_ward' ? 'W&W' : r.duty_type === 'satsang' ? 'Satsang' : 'Gate'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.7rem', fontFamily: 'monospace', lineHeight: 1.3 }}>
                      {sameDay ? (
                        <span>{inDate}</span>
                      ) : outDate ? (
                        <span style={{ color: r.duty_type === 'watch_ward' ? '#3b82f6' : 'var(--text-primary)' }}>
                          {inDate} → {outDate}
                        </span>
                      ) : (
                        <span>{inDate}</span>
                      )}
                    </td>
                    <td style={{ fontSize: '0.82rem', lineHeight: 1.35 }}>
                      <div style={{ fontWeight: 500 }}>{formatTime(r.in_time)}</div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.in_scanner_name || r.scanner_name || ''}</div>
                    </td>
                    <td style={{ fontSize: '0.82rem', lineHeight: 1.35 }}>
                      <div style={{ fontWeight: 500 }}>{formatTime(r.out_time)}</div>
                      <div style={{ fontSize: '0.68rem', color: r.out_scanner_name ? 'var(--gold)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.out_scanner_name || ''}</div>
                    </td>
                    <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{formatDuration(r.in_time, r.out_time) || '—'}</td>
                    <td>{getStatusBadge(r)}</td>
                    <td style={{ maxWidth: '120px' }}>
                      {r.flagged ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <span style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            🚩 {r.flag_reason || 'Flagged'}
                          </span>
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {r.remark || (r.manual_in || r.manual_out ? 'Manual' : '—')}
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                        {canFlag && !r.flagged && (
                          <button 
                            className="records-delete-btn" 
                            title="Flag this session" 
                            onClick={() => { setFlagModal(r); setFlagReason('') }}
                          >
                            <Flag size={13} color="var(--text-muted)" />
                          </button>
                        )}
                        {canEditSession(r) && (
                          <>
                            <button className="records-delete-btn" title="Edit session (within 40 min)" onClick={() => { 
                              setEditingSession(r)
                              setEditInDate(extractISTDate(r.in_time))
                              setEditInTime(extractISTTime(r.in_time))
                              setEditOutDate(extractISTDate(r.out_time))
                              setEditOutTime(extractISTTime(r.out_time))
                            }}>
                              <PenLine size={13} color="var(--blue)" />
                            </button>
                            <button className="records-delete-btn" title="Delete session" onClick={() => deleteSession(r)}>
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Mobile card view */}
      <div className="rec-mobile-cards" style={{ marginTop: '0.75rem' }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {[1,2,3].map(i => (
              <div key={i} style={{ height: 100, background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)' }} />
            ))}
          </div>
        ) : records.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '2rem 1rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            No records found
          </div>
        ) : (
          records.map(r => (
            <div key={r.id} className="rec-mobile-card" style={{ marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{r.sewadar_name}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--gold)', fontWeight: 700 }}>{r.badge_number}</div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {r.is_open ? '🟡 OPEN' : r.force_closed ? '⚪ CORRECTED' : '🟢 COMPLETE'}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>{r.sewadar_centre}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '0.7rem', background: r.duty_type === 'satsang' ? 'rgba(168,85,247,0.15)' : r.duty_type === 'watch_ward' ? 'rgba(59,130,246,0.15)' : 'rgba(107,114,128,0.15)', color: r.duty_type === 'satsang' ? '#9333ea' : r.duty_type === 'watch_ward' ? '#3b82f6' : '#6b7280', border: '1px solid', borderColor: r.duty_type === 'satsang' ? 'rgba(168,85,247,0.3)' : r.duty_type === 'watch_ward' ? 'rgba(59,130,246,0.3)' : 'rgba(107,114,128,0.3)', borderRadius: 6, padding: '2px 6px', fontWeight: 700 }}>
                  {r.duty_type === 'watch_ward' ? 'W&W' : r.duty_type === 'satsang' ? 'Satsang' : 'Gate'}
                </span>
                <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', background: 'var(--bg)', color: 'var(--text-muted)', border: '1px solid var(--border)', borderRadius: 5, padding: '2px 8px' }}>
                  IN {formatTime(r.in_time)}
                </span>
                {r.out_time && (
                  <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', background: 'rgba(220,38,38,0.08)', color: 'var(--red)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 5, padding: '2px 8px' }}>
                    OUT {formatTime(r.out_time)}
                  </span>
                )}
                {r.flagged && (
                  <span 
                    onClick={() => r.flag_id && goToFlag(r.flag_id)}
                    style={{ 
                      fontSize: '0.65rem', 
                      background: r.flag_status === 'resolved' ? 'rgba(34,197,94,0.1)' : 'rgba(220,38,38,0.1)', 
                      color: r.flag_status === 'resolved' ? 'var(--green)' : 'var(--red)', 
                      border: `1px solid ${r.flag_status === 'resolved' ? 'rgba(34,197,94,0.3)' : 'rgba(220,38,38,0.25)'}`, 
                      borderRadius: 5, 
                      padding: '2px 6px', 
                      fontWeight: 700,
                      cursor: r.flag_id ? 'pointer' : 'default',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    🚩 {r.flag_status === 'resolved' ? 'Flag Resolved' : (r.flag_id ? 'View Flag' : 'Flagged')}{r.flag_reason && r.flag_status !== 'resolved' && <span style={{ marginLeft: 4, fontWeight: 400, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>: {r.flag_reason}</span>}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.5rem' }}>
                {canFlag && !r.flagged && (
                  <button
                    onClick={() => { setFlagModal(r); setFlagReason('') }}
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: '0.72rem', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}
                  >
                    <Flag size={11} /> Flag
                  </button>
                )}
                {canEditSession(r) && (
                  <>
                    <button
                      onClick={() => { 
                        if (import.meta.env.DEV) console.log(`Edit: created=${r.created_at}, in=${r.in_time}, canEdit=${canEditSession(r)}`)
                        setEditingSession(r)
                        setEditInDate(r.in_time ? r.in_time.split('T')[0] : '')
                        setEditInTime(r.in_time ? r.in_time.slice(11, 16) : '')
                        setEditOutDate(r.out_time ? r.out_time.split('T')[0] : '')
                        setEditOutTime(r.out_time ? r.out_time.slice(11, 16) : '')
                      }}
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: '0.72rem', color: 'var(--blue)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}
                    >
                      <PenLine size={11} /> Edit
                    </button>
                    <button
                      onClick={() => deleteSession(r)}
                      style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: '0.72rem', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}
                    >
                      <Trash2 size={11} /> Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
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

      {editingSession && (
        <div className="overlay" onClick={() => setEditingSession(null)}>
          <div className="overlay-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <PenLine size={18} color="var(--blue)" />
                <h3 style={{ fontWeight: 700, color: 'var(--blue)' }}>
                  {editingSession.is_open ? 'Edit IN Time' : 'Edit Session Times'}
                </h3>
              </div>
              <button onClick={() => setEditingSession(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.2rem' }}>×</button>
            </div>

            <div style={{ background: 'var(--blue-bg)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: 8, padding: '0.6rem 0.85rem', marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--blue)' }}>
              {editingSession.is_open 
                ? "⚠️ Session is still open. You can only edit the IN time. OUT will be set when the person scans OUT."
                : "⏱️ You can edit this session within 40 minutes of IN time"
              }
            </div>

            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.85rem 1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{editingSession.sewadar_name}</span>
                <span style={{ fontFamily: 'monospace', color: 'var(--gold)', fontSize: '0.78rem', fontWeight: 700 }}>{editingSession.badge_number}</span>
              </div>
            </div>

            <div style={{ display: 'grid', gap: '1rem', marginBottom: '1.5rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--text-primary)' }}>IN Time</label>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input type="date" value={editInDate} onChange={e => setEditInDate(e.target.value)} style={{ width: '180px', padding: '0.6rem 0.75rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text-primary)', fontSize: '1rem' }} />
                  <input type="time" value={editInTime} onChange={e => setEditInTime(e.target.value)} style={{ width: '150px', padding: '0.6rem 0.75rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text-primary)', fontSize: '1rem' }} />
                </div>
              </div>

              {editingSession.is_open ? (
                <div style={{ opacity: 0.5, pointerEvents: 'none' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--text-muted)' }}>OUT Time</label>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input type="text" value="Session still open" disabled style={{ width: '180px', padding: '0.6rem 0.75rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text-muted)', fontSize: '1rem' }} />
                    <input type="text" value="--" disabled style={{ width: '150px', padding: '0.6rem 0.75rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text-muted)', fontSize: '1rem' }} />
                  </div>
                </div>
              ) : (
                <div>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--text-primary)' }}>OUT Time</label>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input type="date" value={editOutDate} onChange={e => setEditOutDate(e.target.value)} style={{ width: '180px', padding: '0.6rem 0.75rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text-primary)', fontSize: '1rem' }} />
                    <input type="time" value={editOutTime} onChange={e => setEditOutTime(e.target.value)} style={{ width: '150px', padding: '0.6rem 0.75rem', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)', color: 'var(--text-primary)', fontSize: '1rem' }} />
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button onClick={() => setEditingSession(null)} className="btn btn-secondary" style={{ padding: '0.5rem 1rem' }}>Cancel</button>
              <button onClick={saveSessionEdit} className="btn btn-primary" style={{ padding: '0.5rem 1rem' }}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {flagModal && (
        <div className="overlay" onClick={() => setFlagModal(null)}>
          <div className="overlay-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Flag size={18} color="#dc2626" />
                <h3 style={{ fontWeight: 700, color: '#dc2626' }}>Raise Flag</h3>
              </div>
              <button onClick={() => setFlagModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.2rem' }}>×</button>
            </div>

            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.85rem 1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{flagModal.sewadar_name}</span>
                <span style={{ fontFamily: 'monospace', color: 'var(--gold)', fontSize: '0.78rem', fontWeight: 700 }}>{flagModal.badge_number}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem', fontSize: '0.78rem' }}>
                <div style={{ color: 'var(--text-muted)' }}>Centre: <strong style={{ color: 'var(--text-primary)' }}>{flagModal.sewadar_centre}</strong></div>
                <div style={{ color: 'var(--text-muted)' }}>Duty: <strong style={{ color: 'var(--text-primary)' }}>
                  {flagModal.duty_type === 'watch_ward' ? 'W&W' : flagModal.duty_type === 'satsang' ? 'Satsang' : 'Gate Entry'}
                </strong></div>
                <div style={{ color: 'var(--text-muted)' }}>Date: <strong style={{ color: 'var(--text-primary)' }}>{formatDateStr(flagModal.date_ist)}</strong></div>
                <div style={{ color: 'var(--text-muted)' }}>IN: <strong style={{ color: 'var(--text-primary)' }}>{formatTime(flagModal.in_time)}</strong></div>
                <div style={{ color: 'var(--text-muted)' }}>OUT: <strong style={{ color: 'var(--text-primary)' }}>{flagModal.out_time ? formatTime(flagModal.out_time) : '—'}</strong></div>
                <div style={{ color: 'var(--text-muted)' }}>Status: <strong style={{ color: 'var(--text-primary)' }}>{flagModal.is_open ? 'Open' : 'Closed'}</strong></div>
              </div>
            </div>

            <label style={{ fontWeight: 600, fontSize: '0.8rem', display: 'block', marginBottom: '0.5rem' }}>
              Why are you flagging this entry? *
            </label>
            <textarea
              className="input"
              rows={3}
              placeholder="Describe the issue clearly (e.g. Wrong time, duplicate entry, wrong duty type, etc.)..."
              value={flagReason}
              onChange={e => setFlagReason(e.target.value)}
              style={{ resize: 'none', marginBottom: '0.75rem' }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <button className="btn btn-outline" onClick={() => setFlagModal(null)}>Cancel</button>
              <button className="btn" style={{ background: '#dc2626', color: 'white', border: 'none' }} onClick={doFlag} disabled={!flagReason.trim() || flagSubmitting}>
                {flagSubmitting ? 'Raising...' : 'Raise Flag'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// =====================================================
// REPORTS TAB
// =====================================================
function ReportsTab() {
  const { profile } = useAuth()
  const isAso = profile?.role === ROLES.ASO
  const isCentreUser = profile?.role === ROLES.CENTRE || profile?.role === ROLES.SC_SP_USER

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

  // Real-time updates
  useEffect(() => {
    let timer = null
    const channel = supabase.channel('reports-realtime')
    
    channel.on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'attendance_sessions' 
    }, (payload) => {
      if (import.meta.env.DEV) console.log('[RT] sessions changed', payload)
      clearTimeout(timer)
      timer = setTimeout(() => fetchReport(), 300)
    })
    .subscribe((status) => {
      if (import.meta.env.DEV) console.log('[RT] Reports channel status:', status)
    })

    return () => { 
      clearTimeout(timer)
      supabase.removeChannel(channel) 
    }
  }, [])

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
        .from('v_sessions')
        .select('badge_number, sewadar_name, sewadar_centre, date_ist, duty_type')
        .eq('duty_type', 'satsang')
        .eq('is_open', false)
        .gte('date_ist', `${year}-01-01`)
        .lte('date_ist', `${year}-12-31`)
        .order('sewadar_name')

      if (isCentreUser && profile?.centre) {
        const scope = [profile.centre, ...centres.filter(c => c.parent_centre === profile.centre).map(c => c.centre_name)]
        q = q.in('sewadar_centre', scope)
      } else if (centreFilter) {
        q = q.eq('sewadar_centre', centreFilter)
      }

      const { data: sessions } = await q

      // Group by badge and count unique dates
      const badgeMap = {}
      sessions?.forEach(s => {
        if (!badgeMap[s.badge_number]) {
          badgeMap[s.badge_number] = { badge_number: s.badge_number, name: s.sewadar_name, centre: s.sewadar_centre, days: new Set() }
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
        .from('v_sessions')
        .select('badge_number, sewadar_name, sewadar_centre, duty_type, is_open')
        .gte('date_ist', `${year}-01-01`)
        .lte('date_ist', `${year}-12-31`)
        .order('sewadar_name')

      if (isCentreUser && profile?.centre) {
        const scope = [profile.centre, ...centres.filter(c => c.parent_centre === profile.centre).map(c => c.centre_name)]
        q = q.in('sewadar_centre', scope)
      } else if (centreFilter) {
        q = q.eq('sewadar_centre', centreFilter)
      }

      const { data: sessions } = await q

      const badgeMap = {}
      sessions?.forEach(s => {
        if (!badgeMap[s.badge_number]) {
          badgeMap[s.badge_number] = { badge_number: s.badge_number, name: s.sewadar_name, centre: s.sewadar_centre, satsang: 0, gate_entry: 0, watch_ward: 0, open: 0 }
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
        .from('v_sessions')
        .select('badge_number, sewadar_name, sewadar_centre, sewadar_department, in_time, duty_type')
        .eq('is_open', true)
        .order('in_time', { ascending: false })

      if (isCentreUser && profile?.centre) {
        const scope = [profile.centre, ...centres.filter(c => c.parent_centre === profile.centre).map(c => c.centre_name)]
        q = q.in('sewadar_centre', scope)
      }

      const { data: sessions } = await q
      setData((sessions || []).map(s => ({ ...s, centre: s.sewadar_centre, department: s.sewadar_department })))
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

        {reportType !== 'open_now' && isAso && (
          <CentreComboBox value={centreFilter} onChange={setCentreFilter} centres={centres} includeAll={true} grouped={true} />
        )}

        {reportType !== 'open_now' && isCentreUser && (
          <CentreComboBox value={centreFilter} onChange={setCentreFilter} centres={centres.filter(c => c.centre_name === profile?.centre || c.parent_centre === profile?.centre)} includeAll={true} grouped={false} />
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
        <div className="records-table-wrap" style={{ width: "100%" }}>
          <table className="records-table" style={{ width: "100%" }}>
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

export default function RecordsPage() {
  return (
    <div className="page-wide pb-nav">
      <AttendanceTab />
    </div>
  )
}