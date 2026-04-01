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
function AttendanceTab({ onFlagRaised, onViewFlag }) {
  const { profile } = useAuth()
  const isAso = profile?.role === ROLES.ASO
  const isCentreUser = profile?.role === ROLES.CENTRE
  const canEdit = isAso
  const canFlag = isAso || profile?.can_flags

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
  const [flagModal, setFlagModal] = useState(null)
  const [flagReason, setFlagReason] = useState('')
  const [flagSubmitting, setFlagSubmitting] = useState(false)

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
      if (import.meta.env.DEV) console.warn('[Records] fetch failed:', error)
      return
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
      let q = supabase
        .from('attendance_sessions')
        .select('*')
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
          csvEscape(r.centre),
          csvEscape(r.department || ''),
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
      // Step 1: Clear session_id on attendance records (removes FK reference, allows session delete)
      await supabase.from('attendance').update({ session_id: null }).eq('session_id', id)

      // Step 2: Clear session_id on queries (preserve flags, just unlink the session)
      await supabase.from('queries').update({ session_id: null }).eq('session_id', id)

      // Step 3: Delete the session
      const { error } = await supabase.from('attendance_sessions').delete().eq('id', id)
      if (error) {
        // If still failing (e.g. ON DELETE RESTRICT), try clearing in_id/out_id first
        if (error.code === '23503') {
          await supabase.from('attendance_sessions').update({ in_id: null, out_id: null }).eq('id', id)
          const retry = await supabase.from('attendance_sessions').delete().eq('id', id)
          if (retry.error) throw new Error(retry.error.message)
        } else {
          throw new Error(error.message)
        }
      }

      await supabase.from('logs').insert({
        user_badge: profile.badge_number,
        action: 'DELETE_SESSION',
        details: `Deleted session ${id} for ${badge_number}`,
        timestamp: new Date().toISOString(),
      })

      showSuccess('Session deleted')
      fetchRecords()
    } catch (err) {
      showError('Delete failed: ' + err.message)
    }
    setDeleteConfirm(null)
  }

  async function doFlag() {
    if (!flagModal || !flagReason.trim() || !profile) return
    setFlagSubmitting(true)

    try {
      const { data: existing } = await supabase
        .from('queries')
        .select('id')
        .eq('session_id', flagModal.id)
        .in('status', ['open', 'in_progress'])
        .maybeOne()

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
          issue_description: flagReason.trim(),
          reason: flagReason.trim(),
          status: 'open',
          flag_type: 'session_flag',
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

      showSuccess('Flag raised — view in Flags tab')
      if (onFlagRaised) onFlagRaised()
      fetchRecords()
    } catch (err) {
      showError(err.message)
    }

    setFlagSubmitting(false)
    setFlagModal(null)
    setFlagReason('')
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
      <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.6rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10 }}>
        <div className="search-box" style={{ flex: '1 1 100%', minWidth: 0 }}>
          <Search size={14} />
          <input type="text" placeholder="Search badge or name…" value={searchInput}
            onChange={e => setSearchInput(e.target.value)} style={{ minWidth: 0 }} />
          {searchInput && <button onClick={() => setSearchInput('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}><X size={13} /></button>}
        </div>

        <div style={{ flex: '1 1 auto', display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {isAso && (
            <CentreComboBox value={centreFilter} onChange={val => { setCentreFilter(val); setPage(1) }} centres={centres} includeAll={true} />
          )}

          <DateRangePicker value={dateRange} onChange={val => { setDateRange(val); setPage(1) }} />

          <select value={dutyFilter} onChange={e => { setDutyFilter(e.target.value); setPage(1) }}
            style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.45rem 0.6rem', background: 'var(--bg)', fontSize: '0.8rem', minHeight: 36 }}>
            <option value="">Duty</option>
            <option value="satsang">Satsang</option>
            <option value="gate_entry">Gate</option>
            <option value="watch_ward">W&W</option>
          </select>

          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
            style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '0.45rem 0.6rem', background: 'var(--bg)', fontSize: '0.8rem', minHeight: 36 }}>
            <option value="">Status</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: '0.4rem', flexShrink: 0 }}>
          <button className="btn btn-ghost" onClick={fetchRecords}><RefreshCw size={14} /></button>
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
                <th style={{ width: '90px' }}>Badge</th>
                <th style={{ width: '130px' }}>Name</th>
                {isAso && <th style={{ width: '90px' }}>Centre</th>}
                <th style={{ width: '65px' }}>Duty</th>
                <th style={{ width: '75px' }}>IN Date</th>
                <th style={{ width: '60px' }}>IN</th>
                <th style={{ width: '70px' }}>IN By</th>
                <th style={{ width: '75px' }}>OUT Date</th>
                <th style={{ width: '60px' }}>OUT</th>
                <th style={{ width: '70px' }}>OUT By</th>
                <th style={{ width: '55px' }}>Duration</th>
                <th style={{ width: '60px' }}>Status</th>
                <th style={{ width: '100px' }}>Remarks</th>
                <th style={{ width: '50px' }}></th>
                <th style={{ width: '40px' }}></th>
              </tr>
            </thead>
            <tbody>
              {records.map(r => {
                const inDate = formatDateStr(r.date_ist)
                const outDate = r.out_time ? formatDateStr(scanTimeToISTDate(r.out_time)) : ''
                
                return (
                  <tr key={r.id}>
                    <td style={{ fontFamily: 'monospace', color: 'var(--gold)', fontSize: '0.85rem', fontWeight: 700 }}>{r.badge_number}</td>
                    <td style={{ fontWeight: 500, fontSize: '0.85rem' }}>{r.sewadar_name}</td>
                    {isAso && <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{r.centre}</td>}
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
                    <td style={{ fontSize: '0.78rem', fontFamily: 'monospace' }}>{inDate}</td>
                    <td style={{ fontSize: '0.8rem' }}>{formatTime(r.in_time)}</td>
                    <td style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      {r.in_scanner_name || r.scanner_name || '—'}
                    </td>
                    <td style={{ fontSize: '0.78rem', fontFamily: 'monospace' }}>{outDate}</td>
                    <td style={{ fontSize: '0.8rem' }}>{formatTime(r.out_time)}</td>
                    <td style={{ fontSize: '0.7rem', color: r.out_scanner_name ? 'var(--gold)' : 'var(--text-muted)' }}>
                      {r.out_scanner_name || '—'}
                    </td>
                    <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{formatDuration(r.in_time, r.out_time) || '—'}</td>
                    <td>{getStatusBadge(r)}</td>
                    <td style={{ maxWidth: '120px' }}>
                      {r.flagged ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <span style={{ fontSize: '0.75rem', color: '#dc2626', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            🚩 {r.flag_reason || 'Flagged'}
                          </span>
                          <button onClick={() => onViewFlag && onViewFlag(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: '0.6rem', padding: 0, flexShrink: 0, fontFamily: 'inherit' }} title="View flag details">
                            →
                          </button>
                        </div>
                      ) : (
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {r.manual_in || r.manual_out ? 'Manual' : '—'}
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        {canFlag && !r.flagged && (
                          <button 
                            className="records-delete-btn" 
                            title="Flag this session" 
                            onClick={() => { setFlagModal(r); setFlagReason('') }}
                          >
                            <Flag size={12} color="var(--text-muted)" />
                          </button>
                        )}
                        {canEdit && (
                          <button className="records-delete-btn" title="Delete session" onClick={() => deleteSession(r)}>
                            <Trash2 size={12} />
                          </button>
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
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>{r.centre}</div>
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
                  <span style={{ fontSize: '0.65rem', background: 'rgba(220,38,38,0.1)', color: 'var(--red)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: 5, padding: '2px 6px', fontWeight: 700 }}>
                    🚩 Flagged
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
                {canEdit && (
                  <button
                    onClick={() => deleteSession(r)}
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 10px', fontSize: '0.72rem', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'inherit' }}
                  >
                    <Trash2 size={11} /> Delete
                  </button>
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
                <div style={{ color: 'var(--text-muted)' }}>Centre: <strong style={{ color: 'var(--text-primary)' }}>{flagModal.centre}</strong></div>
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
  const isCentreUser = profile?.role === ROLES.CENTRE

  const [flags, setFlags] = useState([])
  const [loading, setLoading] = useState(true)
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(1)
  const [centres, setCentres] = useState([])
  const [activeFlag, setActiveFlag] = useState(null)
  const [replies, setReplies] = useState([])
  const [auditLog, setAuditLog] = useState([])
  const [replyText, setReplyText] = useState('')
  const [submittingReply, setSubmittingReply] = useState(false)
  const [statusFilter, setStatusFilter] = useState('open')
  const [resolveReason, setResolveReason] = useState('')
  const [submittingResolve, setSubmittingResolve] = useState(false)

  useEffect(() => {
    fetchCentres()
  }, [])

  useEffect(() => {
    fetchFlags()
  }, [page, statusFilter, profile])

  async function fetchCentres() {
    let q = supabase.from('centres').select('centre_name, parent_centre').order('centre_name')
    if (isCentreUser && profile?.centre) {
      q = q.or(`centre_name.eq.${profile.centre},parent_centre.eq.${profile.centre}`)
    }
    const { data } = await q
    setCentres(data || [])
  }

  async function fetchFlags() {
    setLoading(true)
    let q = supabase
      .from('queries')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (statusFilter === 'open') {
      q = q.eq('status', 'open')
    } else if (statusFilter === 'in_progress') {
      q = q.eq('status', 'in_progress')
    } else if (statusFilter === 'resolved') {
      q = q.eq('status', 'resolved')
    }

    if (isCentreUser && profile?.centre) {
      const scope = [profile.centre, ...centres.filter(c => c.parent_centre === profile.centre).map(c => c.centre_name)]
      q = q.in('raised_by_centre', scope)
    }

    const { data: flagsData, count, error } = await q.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
    setLoading(false)

    if (error || !flagsData) {
      setFlags([])
      return
    }

    const sessionIds = flagsData.filter(f => f.session_id).map(f => f.session_id)
    let sessionsMap = {}
    if (sessionIds.length > 0) {
      const { data: sessions } = await supabase
        .from('attendance_sessions')
        .select('*')
        .in('id', sessionIds)
      sessionsMap = Object.fromEntries((sessions || []).map(s => [s.id, s]))
    }

    const merged = flagsData.map(f => ({
      ...f,
      attendance_sessions: f.session_id ? sessionsMap[f.session_id] : null,
    }))

    setFlags(merged)
    setTotalCount(count || 0)
  }

  async function openFlagDetail(flag) {
    setActiveFlag(flag)
    setReplyText('')

    const [repliesRes, auditRes] = await Promise.all([
      supabase.from('query_replies').select('*').eq('query_id', flag.id).order('created_at', { ascending: true }),
      supabase.from('flag_audit_log').select('*').eq('query_id', flag.id).order('created_at', { ascending: true }),
    ])

    setReplies(repliesRes.data || [])
    setAuditLog(auditRes.data || [])
  }

  async function submitReply() {
    if (!replyText.trim() || !activeFlag || !profile) return
    setSubmittingReply(true)

    try {
      await supabase.from('query_replies').insert({
        query_id: activeFlag.id,
        replied_by_badge: profile.badge_number,
        replied_by_name: profile.name,
        replied_by_centre: profile.centre,
        message: replyText.trim(),
      })

      await supabase.from('flag_audit_log').insert({
        query_id: activeFlag.id,
        action: 'REPLY_ADDED',
        actor_badge: profile.badge_number,
        actor_name: profile.name,
        details: `Replied: "${replyText.trim().slice(0, 50)}"`,
      })

      const updatedFlag = { ...activeFlag }
      if (updatedFlag.status === 'open') {
        await supabase.from('queries').update({ status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', activeFlag.id)
        updatedFlag.status = 'in_progress'
      }
      setActiveFlag(updatedFlag)

      const [repliesRes, auditRes] = await Promise.all([
        supabase.from('query_replies').select('*').eq('query_id', activeFlag.id).order('created_at', { ascending: true }),
        supabase.from('flag_audit_log').select('*').eq('query_id', activeFlag.id).order('created_at', { ascending: true }),
      ])
      setReplies(repliesRes.data || [])
      setAuditLog(auditRes.data || [])
      setReplyText('')
      showSuccess('Reply added')
    } catch (err) {
      showError('Failed to add reply: ' + err.message)
    }
    setSubmittingReply(false)
  }

  async function resolveFlag() {
    if (!activeFlag || !profile) return
    setSubmittingResolve(true)

    try {
      await supabase.from('queries').update({
        status: 'resolved',
        resolved_by: profile.badge_number,
        resolved_at: new Date().toISOString(),
        resolved_reason: resolveReason || null,
        updated_at: new Date().toISOString(),
      }).eq('id', activeFlag.id)

      if (activeFlag.session_id) {
        await supabase.from('attendance_sessions').update({
          flagged: false,
        }).eq('id', activeFlag.session_id)
      }

      await supabase.from('flag_audit_log').insert({
        query_id: activeFlag.id,
        action: 'RESOLVED',
        actor_badge: profile.badge_number,
        actor_name: profile.name,
        details: resolveReason ? `Resolved: "${resolveReason}"` : 'Resolved',
      })

      showSuccess('Flag resolved')
      setActiveFlag(null)
      fetchFlags()
    } catch (err) {
      showError('Failed to resolve: ' + err.message)
    }
    setSubmittingResolve(false)
    setResolveReason('')
  }

  const session = activeFlag?.attendance_sessions
  const dutyLabel = session?.duty_type === 'watch_ward' ? 'Watch & Ward' : session?.duty_type === 'satsang' ? 'Satsang' : 'Gate Entry'
  const statusColors = { open: '#dc2626', in_progress: '#f59e0b', resolved: '#16a34a' }
  const statusLabels = { open: 'Open', in_progress: 'In Progress', resolved: 'Resolved' }

  return (
    <div>
      {!activeFlag ? (
        <>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              {['open', 'in_progress', 'resolved'].map(s => (
                <button key={s} className={`btn ${statusFilter === s ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { setStatusFilter(s); setPage(1) }} style={{ fontSize: '0.78rem', padding: '0.35rem 0.65rem' }}>
                  {s === 'in_progress' ? 'In Progress' : statusLabels[s]}
                </button>
              ))}
            </div>
            <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-muted)' }}>{totalCount} flag{totalCount !== 1 ? 's' : ''}</span>
          </div>

          {loading ? (
            <div className="text-center" style={{ padding: '2rem' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
          ) : flags.length === 0 ? (
            <EmptyState icon={Flag} title="No flags" message={statusFilter === 'open' ? 'No open flags — all clear!' : `No ${statusFilter.replace('_', ' ')} flags`} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {flags.map(flag => (
                <div key={flag.id} onClick={() => openFlagDetail(flag)} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem', cursor: 'pointer', transition: 'border-color 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--gold)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColors[flag.status], display: 'inline-block', flexShrink: 0 }} />
                        {flag.attendance_sessions ? (
                          <>
                            <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{flag.attendance_sessions.sewadar_name}</span>
                            <span style={{ fontFamily: 'monospace', color: 'var(--gold)', fontSize: '0.78rem', fontWeight: 700 }}>{flag.attendance_sessions.badge_number}</span>
                          </>
                        ) : (
                          <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                            Session Deleted
                          </span>
                        )}
                      </div>
                      {flag.attendance_sessions ? (
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', paddingLeft: '1.1rem' }}>
                          {flag.attendance_sessions.centre} · {flag.attendance_sessions.duty_type === 'watch_ward' ? 'W&W' : flag.attendance_sessions.duty_type === 'satsang' ? 'Satsang' : 'Gate'} · {formatDateStr(flag.attendance_sessions.date_ist)} · {formatTime(flag.attendance_sessions.in_time)} → {flag.attendance_sessions.out_time ? formatTime(flag.attendance_sessions.out_time) : 'Open'}
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', paddingLeft: '1.1rem' }}>
                          {flag.raised_by_centre}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                      <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: `${statusColors[flag.status]}15`, color: statusColors[flag.status], border: `1px solid ${statusColors[flag.status]}40` }}>
                        {statusLabels[flag.status]}
                      </span>
                      {!flag.attendance_sessions && (
                        <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'rgba(107,114,128,0.15)', color: '#6b7280', border: '1px solid rgba(107,114,128,0.3)' }}>
                          ARCHIVED
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ paddingLeft: '1.1rem', fontSize: '0.82rem', color: '#dc2626', fontWeight: 500 }}>&ldquo;{flag.issue_description}&rdquo;</div>
                  <div style={{ paddingLeft: '1.1rem', fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.35rem' }}>
                    Raised by {flag.raised_by_name} · {new Date(flag.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && totalCount > PAGE_SIZE && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem' }}>
              <button className="btn btn-ghost" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>‹ Prev</button>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', alignSelf: 'center' }}>Page {page} of {Math.ceil(totalCount / PAGE_SIZE)}</span>
              <button className="btn btn-ghost" onClick={() => setPage(p => p + 1)} disabled={page >= Math.ceil(totalCount / PAGE_SIZE)}>Next ›</button>
            </div>
          )}
        </>
      ) : (
        <div>
          <button className="btn btn-ghost" onClick={() => setActiveFlag(null)} style={{ marginBottom: '1rem', fontSize: '0.8rem' }}>← Back to Flags</button>

          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: '1rem' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: statusColors[activeFlag.status], display: 'inline-block' }} />
                {session ? (
                  <>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{session.sewadar_name}</span>
                    <span style={{ fontFamily: 'monospace', color: 'var(--gold)', fontSize: '0.82rem', fontWeight: 700 }}>{session.badge_number}</span>
                  </>
                ) : (
                  <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-muted)' }}>Session Deleted</span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '2px 10px', borderRadius: 6, background: `${statusColors[activeFlag.status]}15`, color: statusColors[activeFlag.status], border: `1px solid ${statusColors[activeFlag.status]}40` }}>
                  {statusLabels[activeFlag.status]}
                </span>
                {!session && (
                  <span style={{ fontSize: '0.6rem', fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'rgba(107,114,128,0.15)', color: '#6b7280', border: '1px solid rgba(107,114,128,0.3)' }}>ARCHIVED</span>
                )}
              </div>
            </div>

            <div style={{ padding: '1rem 1.25rem' }}>
              {session ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div><div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.15rem' }}>Centre</div><div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{session.centre}</div></div>
                  <div><div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.15rem' }}>Duty Type</div><div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{dutyLabel}</div></div>
                  <div><div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.15rem' }}>IN Time</div><div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{session.in_time ? formatTime(session.in_time) : '—'}</div></div>
                  <div><div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.15rem' }}>OUT Time</div><div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{session.out_time ? formatTime(session.out_time) : '—'}</div></div>
                  <div><div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.15rem' }}>Date</div><div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{formatDateStr(session.date_ist)}</div></div>
                  <div><div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.15rem' }}>Status</div><div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{session.is_open ? 'Still Open' : 'Closed'}</div></div>
                </div>
              ) : (
                <div style={{ background: 'rgba(107,114,128,0.08)', border: '1px solid rgba(107,114,128,0.2)', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.82rem', color: '#6b7280' }}>
                  This attendance session was deleted. The flag conversation and replies are preserved below for audit purposes.
                </div>
              )}

              <div style={{ background: 'rgba(198,40,40,0.06)', border: '1px solid rgba(198,40,40,0.2)', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '0.75rem' }}>
                <div style={{ fontSize: '0.68rem', color: '#dc2626', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem', fontWeight: 700 }}>Flag Reason</div>
                <div style={{ fontSize: '0.9rem', fontWeight: 500, color: '#dc2626' }}>{activeFlag.reason}</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                  Raised by <strong>{activeFlag.raised_by_name}</strong> ({activeFlag.raised_by_badge}) from <strong>{activeFlag.raised_by_centre}</strong>
                  {' · '}{new Date(activeFlag.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>

              {activeFlag.resolved_at && (
                <div style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '0.75rem' }}>
                  <div style={{ fontSize: '0.68rem', color: '#16a34a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.35rem', fontWeight: 700 }}>Resolution</div>
                  <div style={{ fontSize: '0.9rem', fontWeight: 500, color: '#16a34a' }}>{activeFlag.resolved_reason || 'Resolved without note'}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                    Resolved by <strong>{activeFlag.resolved_by}</strong>
                    {' · '}{new Date(activeFlag.resolved_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              )}
            </div>
          </div>

          {auditLog.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Activity Trail</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {auditLog.map(entry => (
                  <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem', color: 'var(--text-muted)', padding: '0.25rem 0' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: entry.action === 'RESOLVED' ? '#16a34a' : entry.action === 'REPLY_ADDED' ? '#3b82f6' : '#f59e0b', flexShrink: 0 }} />
                    <span style={{ fontWeight: 600 }}>{entry.actor_name}</span>
                    <span>{entry.details}</span>
                    <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                      {new Date(entry.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {replies.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Replies ({replies.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {replies.map(reply => (
                  <div key={reply.id} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.75rem 1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{reply.replied_by_name}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {new Date(reply.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <div style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>{reply.message}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeFlag.status !== 'resolved' && (
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 12, padding: '1rem' }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>Add Reply</div>
              <textarea className="input" rows={3} placeholder="Write a reply or note..." value={replyText} onChange={e => setReplyText(e.target.value)} style={{ resize: 'none', marginBottom: '0.5rem' }} />
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={submitReply} disabled={!replyText.trim() || submittingReply} style={{ fontSize: '0.82rem' }}>
                  {submittingReply ? 'Sending...' : 'Send Reply'}
                </button>
                {isAso && !resolveReason && (
                  <button className="btn btn-ghost" onClick={() => setResolveReason(' ')} style={{ fontSize: '0.82rem', color: '#16a34a' }}>
                    Mark Resolved
                  </button>
                )}
              </div>
              {isAso && resolveReason !== undefined && (
                <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#16a34a', marginBottom: '0.4rem' }}>Resolution Note (optional)</div>
                  <textarea className="input" rows={2} placeholder="Enter resolution note..." value={resolveReason} onChange={e => setResolveReason(e.target.value)} style={{ resize: 'none', marginBottom: '0.5rem' }} />
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn" style={{ background: '#16a34a', color: 'white', border: 'none', fontSize: '0.82rem' }} onClick={resolveFlag} disabled={submittingResolve}>
                      {submittingResolve ? 'Resolving...' : 'Confirm Resolve'}
                    </button>
                    <button className="btn btn-outline" onClick={() => { setResolveReason(''); setSubmittingResolve(false) }} style={{ fontSize: '0.82rem' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
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

      {activeTab === 'attendance' && <AttendanceTab onFlagRaised={() => setActiveTab('flags')} onViewFlag={() => setActiveTab('flags')} />}
      {activeTab === 'reports' && canReports && <ReportsTab />}
      {activeTab === 'flags' && canFlags && <FlagsTab />}
    </div>
  )
}
