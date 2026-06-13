import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase, ROLES, formatTime12Hour, formatDateIndian, getLocalDate } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/Toast'
import { logAction } from '../lib/logger'
import { Search, Download, Filter, Calendar, Clock, Scan, Timer, Edit3, DoorOpen, RefreshCw, Truck, MapPin, Briefcase, ArrowRight, LayoutGrid, Table2, Trash2, ChevronLeft, ChevronRight, AlertTriangle, Plus } from 'lucide-react'

const PAGE_SIZE = 50

function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
        <div style={{ flex: 1 }}>
          <div className="skeleton skeleton-line medium" style={{ height: 16, marginBottom: 6 }} />
          <div className="skeleton skeleton-line short" style={{ height: 12 }} />
        </div>
        <div className="skeleton skeleton-circle" />
      </div>
      <div className="skeleton skeleton-line full" style={{ height: 12, marginBottom: '0.75rem' }} />
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
        <div className="skeleton" style={{ width: 60, height: 24, borderRadius: 4 }} />
        <div className="skeleton" style={{ width: 60, height: 24, borderRadius: 4 }} />
      </div>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <div className="skeleton" style={{ flex: 1, height: 40, borderRadius: 6 }} />
        <div className="skeleton" style={{ flex: 1, height: 40, borderRadius: 6 }} />
      </div>
    </div>
  )
}

function calculateDuration(inDate, inTime, outDate, outTime) {
  if (!inDate || !inTime || !outDate || !outTime) return null
  const [inH, inM] = (inTime || '').split(':').map(Number)
  const [outH, outM] = (outTime || '').split(':').map(Number)
  if (isNaN(inH) || isNaN(inM) || isNaN(outH) || isNaN(outM)) return null
  const inDateTime = new Date(`${inDate}T${String(inH).padStart(2,'0')}:${String(inM).padStart(2,'0')}:00`)
  const outDateTime = new Date(`${outDate}T${String(outH).padStart(2,'0')}:${String(outM).padStart(2,'0')}:00`)
  if (isNaN(inDateTime.getTime()) || isNaN(outDateTime.getTime())) return null
  const diffMs = outDateTime - inDateTime
  if (diffMs < 0) return 'invalid'
  const hours = Math.floor(diffMs / (1000 * 60 * 60))
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60))
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

function getPageNumbers(current, total) {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1)
  const pages = [1]
  if (current > 3) pages.push('...')
  const start = Math.max(2, current - 1)
  const end = Math.min(total - 1, current + 1)
  for (let i = start; i <= end; i++) {
    if (i !== 1 && i !== total) pages.push(i)
  }
  if (current < total - 2) pages.push('...')
  if (total > 1) pages.push(total)
  return pages
}

function getJathaTypeLabel(type) {
  const labels = { beas: 'BEAS', major_centre: 'Major Centre', jatha_home: 'Jatha Home' }
  return labels[type] || type
}

function jathaDays(fromDate, toDate) {
  if (!fromDate || !toDate) return null
  const from = new Date(fromDate + 'T12:00:00')
  const to = new Date(toDate + 'T12:00:00')
  if (isNaN(from.getTime()) || isNaN(to.getTime())) return null
  return Math.floor((to - from) / (1000 * 60 * 60 * 24)) + 1
}

function JathaCard({ session, onDelete }) {
  return (
    <div className="jatha-record-card">
      <div className="jatha-record-header">
        <div className="jatha-record-left">
          <div className="jatha-badge"><Truck size={12} />JATHA</div>
          <div className="jatha-record-name">{session.sewadar_name || 'Unknown'}</div>
          <div className="jatha-record-badge">{session.badge_number || 'N/A'}</div>
        </div>
        <div className="jatha-type-pill-lg">{getJathaTypeLabel(session.jatha_type)}</div>
      </div>
      <div className="jatha-record-body">
        <div className="jatha-destination-dept">
          <div className="jatha-detail">
            <MapPin size={14} />
            <div>
              <span className="jatha-detail-label">Home Centre</span>
              <span className="jatha-detail-value">{session.sewadar_centre || 'Unknown'}</span>
            </div>
          </div>
          <div className="jatha-detail">
            <Briefcase size={14} />
            <div>
              <span className="jatha-detail-label">Department</span>
              <span className="jatha-detail-value">{session.jatha_department || 'Jatha'}</span>
            </div>
          </div>
        </div>
        <div className="jatha-date-range">
          <Calendar size={14} />
          <div className="jatha-date-item">
            <span className="jatha-date-label">FROM DATE</span>
            <span className="jatha-date">{formatDateIndian(session.from_date)}</span>
          </div>
          <ArrowRight size={14} />
          <div className="jatha-date-item">
            <span className="jatha-date-label">TO DATE</span>
            <span className="jatha-date">{formatDateIndian(session.to_date)}</span>
          </div>
          {jathaDays(session.from_date, session.to_date) && (
            <div className="jatha-days-badge">{jathaDays(session.from_date, session.to_date)} days</div>
          )}
        </div>
      </div>
      <div className="jatha-record-footer">
        <div className="jatha-scanner-row">
          <Scan size={10} />
          <span>Entered by: {session.entered_by_name || 'Unknown'}</span>
          <span className="jatha-scanner-badge">{session.entered_by_badge || 'N/A'}</span>
        </div>
        {session.remarks && (
          <div className="jatha-remarks-row">
            <span>Remarks: {session.remarks}</span>
          </div>
        )}
        <div className="jatha-record-date">{session.entered_at ? formatDateIndian(session.entered_at.split('T')[0]) : formatDateIndian(session.from_date)}</div>
        {onDelete && (
          <button className="btn-icon btn-delete" style={{ marginLeft: 8 }} title="Delete entry" onClick={() => onDelete('jatha_attendance', session.id)}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

function SessionCard({ session, onDelete }) {
  const isOpen = session.status === 'OPEN'
  const isManual = session.is_manual === true
  const isGateEntry = session.is_gate_entry === true
  const isCrossScan = session.is_cross_scan === true
  const duration = calculateDuration(session.in_date, session.in_time, session.out_date, session.out_time)
  const timeInvalid = duration === 'invalid'

  return (
    <div className={`session-card ${isCrossScan ? 'session-card-guest' : ''}`}>
      <div className="session-card-header">
        <div className="session-name">{session.sewadar_name || 'Unknown'}</div>
        <div className="session-badges">
          {isCrossScan && <span className="guest-badge"><MapPin size={10} />Guest</span>}
          {isGateEntry && <span className="gate-badge"><DoorOpen size={9} />Gate</span>}
          {!isGateEntry && isManual && <span className="manual-badge"><Edit3 size={9} />Manual</span>}
          {timeInvalid && <span className="error-badge"><AlertTriangle size={9} />Invalid</span>}
          <span className={`status-badge ${isOpen ? 'status-open' : 'status-closed'}`}>{isOpen ? 'IN' : 'OUT'}</span>
        </div>
      </div>
      <div className="session-badge">{session.badge_number || 'N/A'}</div>
      <div className="session-grid">
        <div className="session-info">
          <span className="info-label">Centre</span>
          <span className="info-value">{isCrossScan ? session.scan_centre : (session.centre || 'Unknown')}</span>
        </div>
        {isCrossScan && (
          <div className="session-info guest-from">
            <span className="info-label">From</span>
            <span className="guest-centre-chip">{session.sewadar_centre}</span>
          </div>
        )}
        <div className="session-info"><span className="info-label">Duty</span><span className={`duty-badge ${session.duty_type}`}>{session.duty_type || 'N/A'}</span></div>
        <div className="session-info"><span className="info-label">Dept</span><span className="info-value">{session.sewadar_dept || '-'}</span></div>
      </div>
      <div className="session-time-row">
        <div className="time-box">
          <Clock size={12} /><span className="time-label">IN</span>
          <span className="time-value">{formatTime12Hour(session.in_time)}</span>
          {session.in_date && <span className="date-badge in">{formatDateIndian(session.in_date)}</span>}
        </div>
        {isOpen ? (
          <div className="time-box out" style={{ opacity: 0.5 }}>
            <Clock size={12} /><span className="time-label">OUT</span><span className="time-value">—</span>
          </div>
        ) : (
          <div className="time-box out">
            <Clock size={12} /><span className="time-label">OUT</span>
            <span className="time-value">{formatTime12Hour(session.out_time)}</span>
            {session.out_date && <span className="date-badge out">{formatDateIndian(session.out_date)}</span>}
          </div>
        )}
      </div>
      {duration && duration !== 'invalid' && <div className="duration-badge"><Timer size={12} /><span>{duration}</span></div>}
      {timeInvalid && <div className="duration-badge invalid"><AlertTriangle size={12} /><span>Invalid times</span></div>}
      <div className="scanner-info">
        <div className="scanner-row"><Scan size={11} /><span>IN by:</span><span className="scanner-name">{session.in_scanner_name || 'Unknown'}</span><span className="scanner-badge">{session.in_scanner_badge || 'N/A'}</span></div>
        {session.out_scanner_badge && <div className="scanner-row"><Scan size={11} /><span>OUT by:</span><span className="scanner-name">{session.out_scanner_name || 'Unknown'}</span><span className="scanner-badge">{session.out_scanner_badge}</span></div>}
      </div>
      <div className="session-footer">
        <span className="session-date">{formatDateIndian(session.in_date)}</span>
        {onDelete && (
          <button className="btn-icon btn-delete" style={{ marginLeft: 'auto' }} title="Delete entry" onClick={() => onDelete('attendance_sessions', session.id)}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

function SessionTable({ records, onDelete }) {
  return (
    <div className="records-table-wrapper">
      <table className="records-table">
        <thead>
          <tr>
            <th>Status</th><th>Badge</th><th>Name</th><th>Centre</th><th>Dept</th><th>Type</th><th>Duty</th><th>IN Date</th><th>IN Time</th><th>OUT Date</th><th>OUT Time</th><th>Duration</th><th>IN By</th><th>OUT By</th><th style={{width:50}}></th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => {
            const isOpen = r.status === 'OPEN'
            const isManual = r.is_manual === true
            const isGateEntry = r.is_gate_entry === true
            const isCrossScan = r.is_cross_scan === true
            const duration = calculateDuration(r.in_date, r.in_time, r.out_date, r.out_time)
            return (
              <tr key={r.id} className={isCrossScan ? 'row-guest' : ''}>
                <td><span className={`status-pill ${isOpen ? 'status-pill-open' : 'status-pill-closed'}`}>{isOpen ? 'IN' : 'OUT'}</span></td>
                <td className="cell-badge">{r.badge_number || 'N/A'}</td>
                <td className="cell-name">{r.sewadar_name || 'Unknown'}</td>
                <td className="cell-centre">
                  <div className="centre-cell-content">
                    {isCrossScan ? (
                      <><span className="guest-centre-tag">From {r.sewadar_centre}</span> at {r.scan_centre}</>
                    ) : (r.centre || '-')}
                  </div>
                </td>
                <td className="cell-dept">{r.sewadar_dept || '-'}</td>
                <td><span className={`duty-badge-sm ${r.duty_type}`}>{r.duty_type || 'N/A'}</span></td>
                <td><span className="entry-type-pill">{isGateEntry ? 'GATE' : isManual ? 'MANUAL' : 'SCAN'}</span></td>
                <td className="cell-date">{r.in_date ? formatDateIndian(r.in_date) : '-'}</td>
                <td className="cell-time">{r.in_time ? formatTime12Hour(r.in_time) : '-'}</td>
                <td className="cell-date">{r.out_date ? formatDateIndian(r.out_date) : (isOpen ? '-' : '-')}</td>
                <td className="cell-time">{isOpen ? '-' : (r.out_time ? formatTime12Hour(r.out_time) : '-')}</td>
                <td className="cell-duration">{duration === 'invalid' ? <span className="duration-invalid">Invalid</span> : (duration || (isOpen ? 'In progress' : '-'))}</td>
                <td className="cell-scanner">{r.in_scanner_name || '-'}</td>
                <td className="cell-scanner">{r.out_scanner_name || '-'}</td>
                <td>{onDelete && <button className="btn-icon btn-delete" onClick={() => onDelete('attendance_sessions', r.id)} title="Delete"><Trash2 size={13} /></button>}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function JathaTable({ records, onDelete }) {
  return (
    <div className="records-table-wrapper">
      <table className="records-table">
        <thead>
          <tr>
            <th>Badge</th><th>Name</th><th>Sewadar Centre</th><th>Type</th><th>Department</th><th>From Date</th><th>To Date</th><th>Days</th><th>Remarks</th><th>Entered By</th><th style={{width:50}}></th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={r.id}>
              <td className="cell-badge">{r.badge_number || 'N/A'}</td>
              <td className="cell-name">{r.sewadar_name || 'Unknown'}</td>
              <td className="cell-centre">{r.sewadar_centre || '-'}</td>
              <td><span className={`type-pill ${r.jatha_type}`}>{getJathaTypeLabel(r.jatha_type)}</span></td>
              <td className="cell-centre">{r.jatha_department || '-'}</td>
              <td className="cell-date">{formatDateIndian(r.from_date)}</td>
              <td className="cell-date">{formatDateIndian(r.to_date)}</td>
              <td className="cell-days">{jathaDays(r.from_date, r.to_date) || '-'}</td>
              <td className="cell-remarks">{r.remarks || '-'}</td>
              <td className="cell-scanner">{r.entered_by_name || '-'}</td>
              <td>{onDelete && <button className="btn-icon btn-delete" onClick={() => onDelete('jatha_attendance', r.id)} title="Delete"><Trash2 size={13} /></button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function RecordsPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const canWrite = profile?.role === ROLES.SUPER_ADMIN || profile?.role === ROLES.ADMIN

  const [activeTab, setActiveTab] = useState('gate')

  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchDebounceRef = useRef(null)

  const [dateFrom, setDateFrom] = useState(getLocalDate())
  const [dateTo, setDateTo] = useState(getLocalDate())
  const [centreFilter, setCentreFilter] = useState('')
  const [centresList, setCentresList] = useState([])
  const [showFilters, setShowFilters] = useState(false)

  const [dutyFilter, setDutyFilter] = useState('')
  const [quickFilter, setQuickFilter] = useState('all')
  const [jathaQuickFilter, setJathaQuickFilter] = useState('all')
  const [viewMode, setViewMode] = useState('auto')

  const [gateRecords, setGateRecords] = useState([])
  const [gatePage, setGatePage] = useState(1)
  const [gateTotalCount, setGateTotalCount] = useState(0)
  const [gateHasMore, setGateHasMore] = useState(true)
  const [gateLoading, setGateLoading] = useState(false)

  const [jathaRecords, setJathaRecords] = useState([])
  const [jathaPage, setJathaPage] = useState(1)
  const [jathaTotalCount, setJathaTotalCount] = useState(0)
  const [jathaHasMore, setJathaHasMore] = useState(true)
  const [jathaLoading, setJathaLoading] = useState(false)

  const [refreshing, setRefreshing] = useState(false)
  const pullStartY = useRef(0)
  const realtimeDebounceRef = useRef(null)

  const isMobile = () => window.innerWidth < 768
  const showTable = viewMode === 'table' || (viewMode === 'auto' && !isMobile())
  const showCards = viewMode === 'cards' || (viewMode === 'auto' && isMobile())

  useEffect(() => {
    if (profile?.centre) {
      supabase.rpc('get_user_accessible_centres').then(({ data }) => {
        setCentresList((data || []).map(r => ({ name: r.centre_name })))
      }).catch(() => {})
    }
  }, [profile?.role, profile?.centre])

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(searchTerm), 300)
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current) }
  }, [searchTerm])

  const gateFilterKey = `${dateFrom}|${dateTo}|${centreFilter}|${dutyFilter}|${debouncedSearch}|${quickFilter}`
  const jathaFilterKey = `${dateFrom}|${dateTo}|${centreFilter}|${debouncedSearch}|${jathaQuickFilter}`
  const gateFilterKeyRef = useRef(gateFilterKey)
  const jathaFilterKeyRef = useRef(jathaFilterKey)

  const [gateCounts, setGateCounts] = useState({ open_count: 0, closed_count: 0, guest_count: 0 })

  const fetchGateRecords = useCallback(async (page = 1, { append = false } = {}) => {
    setGateLoading(true)
    try {
      const { data, error } = await supabase.rpc('get_session_records', {
        p_page: page,
        p_page_size: PAGE_SIZE,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_centre: centreFilter || null,
        p_duty_type: dutyFilter || null,
        p_search: debouncedSearch || null,
        p_status: null,
        p_quick_filter: quickFilter !== 'all' ? quickFilter : null,
      })
      if (error) throw error
      const records = (data.records || []).map(r => ({
        ...r,
        is_jatha_entry: false,
        is_cross_scan: r.is_cross_scan || false,
      }))
      if (append) {
        setGateRecords(prev => [...prev, ...records])
      } else {
        setGateRecords(records)
      }
      setGateTotalCount(data.total_count || 0)
      setGateHasMore(data.has_more || false)
      setGateCounts({
        open_count: data.open_count || 0,
        closed_count: data.closed_count || 0,
        guest_count: data.guest_count || 0,
      })
      setGatePage(page)
    } catch (err) {
      console.error('Failed to fetch gate records:', err)
      toast?.error('Failed to load records')
    } finally {
      setGateLoading(false)
    }
  }, [dateFrom, dateTo, centreFilter, dutyFilter, debouncedSearch, quickFilter, toast])

  const fetchJathaRecords = useCallback(async (page = 1, { append = false } = {}) => {
    setJathaLoading(true)
    try {
      const { data, error } = await supabase.rpc('get_jatha_records', {
        p_page: page,
        p_page_size: PAGE_SIZE,
        p_date_from: dateFrom || null,
        p_date_to: dateTo || null,
        p_centre: centreFilter || null,
        p_search: debouncedSearch || null,
        p_jatha_type: jathaQuickFilter !== 'all' ? jathaQuickFilter : null,
      })
      if (error) throw error
      const records = (data.records || []).map(r => ({
        ...r,
        is_jatha_entry: true,
        duty_type: 'JATHA',
        in_date: r.from_date,
        out_date: r.to_date,
        sewadar_centre: r.sewadar_centre || 'Unknown',
        jatha_type: r.jatha_type,
        jatha_department: r.jatha_department,
      }))
      if (append) {
        setJathaRecords(prev => [...prev, ...records])
      } else {
        setJathaRecords(records)
      }
      setJathaTotalCount(data.total_count || 0)
      setJathaHasMore(data.has_more || false)
      setJathaPage(page)
    } catch (err) {
      console.error('Failed to fetch jatha records:', err)
      toast?.error('Failed to load jatha records')
    } finally {
      setJathaLoading(false)
    }
  }, [dateFrom, dateTo, centreFilter, debouncedSearch, jathaQuickFilter, toast])

  useEffect(() => {
    if (gateFilterKey !== gateFilterKeyRef.current) {
      gateFilterKeyRef.current = gateFilterKey
      fetchGateRecords(1)
    }
  }, [gateFilterKey, fetchGateRecords])

  useEffect(() => {
    if (jathaFilterKey !== jathaFilterKeyRef.current) {
      jathaFilterKeyRef.current = jathaFilterKey
      fetchJathaRecords(1)
    }
  }, [jathaFilterKey, fetchJathaRecords])

  useEffect(() => {
    if (activeTab === 'gate') {
      if (gateRecords.length === 0) fetchGateRecords(1)
    } else {
      if (jathaRecords.length === 0) fetchJathaRecords(1)
    }
  }, [activeTab])

  useEffect(() => {
    const channel = supabase
      .channel('attendance_records')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance_sessions' }, () => {
        if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
        realtimeDebounceRef.current = setTimeout(() => {
          fetchGateRecords(1)
        }, 1000)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jatha_attendance' }, () => {
        if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
        realtimeDebounceRef.current = setTimeout(() => {
          if (activeTab === 'jatha') fetchJathaRecords(1)
        }, 1000)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [activeTab, fetchGateRecords, fetchJathaRecords])

  const handleDelete = useCallback(async (table, id) => {
    const label = table === 'attendance_sessions' ? 'attendance' : 'jatha'
    if (!window.confirm(`Delete this ${label} record?`)) return
    try {
      const { data: deletedRecord } = await supabase.from(table).select('*').eq('id', id).single()
      if (!deletedRecord) { toast.error('Record not found'); return }

      if (profile?.role !== ROLES.SUPER_ADMIN) {
        const recordDate = table === 'attendance_sessions' ? deletedRecord.in_date : deletedRecord.from_date
        if (recordDate) {
          const recordMonth = new Date(recordDate + 'T12:00:00')
          const now = new Date()
          if (recordMonth.getFullYear() < now.getFullYear() || (recordMonth.getFullYear() === now.getFullYear() && recordMonth.getMonth() < now.getMonth())) {
            toast.error('Cannot delete entries from previous months')
            return
          }
        }
      }

      const { error } = await supabase.from(table).delete().eq('id', id)
      if (error) { toast.error(error.message); return }
      toast.success(`${label} record deleted`)
      logAction(profile?.badge_number, profile?.name, 'RECORD_DELETE', { table, record_id: id, type: label, deleted_record: deletedRecord || null })
      if (table === 'attendance_sessions') fetchGateRecords(gatePage)
      else fetchJathaRecords(jathaPage)
    } catch (err) {
      toast.error('Failed to delete record')
      console.error('Delete error:', err)
    }
  }, [profile, toast, fetchGateRecords, fetchJathaRecords, gatePage, jathaPage])

  const handleRefresh = useCallback(() => {
    setRefreshing(true)
    if (activeTab === 'gate') {
      fetchGateRecords(1).finally(() => setRefreshing(false))
    } else {
      fetchJathaRecords(1).finally(() => setRefreshing(false))
    }
  }, [activeTab, fetchGateRecords, fetchJathaRecords])

  const handleLoadMore = () => {
    if (activeTab === 'gate') {
      if (!gateLoading && gateHasMore) fetchGateRecords(gatePage + 1, { append: true })
    } else {
      if (!jathaLoading && jathaHasMore) fetchJathaRecords(jathaPage + 1, { append: true })
    }
  }

  const handleTouchStart = (e) => {
    if (window.scrollY === 0) pullStartY.current = e.touches[0].clientY
  }
  const handleTouchMove = (e) => {
    const diff = e.touches[0].clientY - pullStartY.current
    if (diff > 60 && window.scrollY === 0) e.preventDefault()
  }
  const handleTouchEnd = (e) => {
    const diff = e.changedTouches[0].clientY - pullStartY.current
    if (diff > 80 && window.scrollY === 0) handleRefresh()
    pullStartY.current = 0
  }

  const exportCSV = async () => {
    let records = []
    if (activeTab === 'gate') {
      const { data } = await supabase.rpc('get_session_records', {
        p_page: 0, p_page_size: 50,
        p_date_from: dateFrom || null, p_date_to: dateTo || null,
        p_centre: centreFilter || null, p_duty_type: dutyFilter || null,
        p_search: null, p_status: null,
        p_quick_filter: quickFilter !== 'all' ? quickFilter : null,
      })
      records = (data?.records || []).map(r => ({ ...r, is_cross_scan: r.is_cross_scan || false }))
    } else {
      const { data } = await supabase.rpc('get_jatha_records', {
        p_page: 0, p_page_size: 50,
        p_date_from: dateFrom || null, p_date_to: dateTo || null,
        p_centre: centreFilter || null,
        p_search: null, p_jatha_type: jathaQuickFilter !== 'all' ? jathaQuickFilter : null,
      })
      records = (data?.records || []).map(r => ({
        ...r, duty_type: 'JATHA', in_date: r.from_date, out_date: r.to_date,
        sewadar_centre: r.sewadar_centre,
        jatha_type: r.jatha_type, jatha_department: r.jatha_department,
      }))
    }

    let headers, rows
    if (activeTab === 'gate') {
      headers = ['Badge', 'Name', 'Centre', 'Duty', 'Type', 'Status', 'IN Date', 'IN Time', 'OUT Date', 'OUT Time', 'Duration', 'IN By', 'OUT By']
      rows = records.map(r => [
        r.badge_number, `"${r.sewadar_name}"`, r.centre || '', r.duty_type || '',
        r.is_gate_entry ? 'GATE' : r.is_manual ? 'MANUAL' : 'SCAN', r.status,
        r.in_date, r.in_time || '', r.out_date || '', r.out_time || '',
        calculateDuration(r.in_date, r.in_time, r.out_date, r.out_time) || '',
        r.in_scanner_name || 'Admin', r.out_scanner_name || ''
      ])
    } else {
      headers = ['Badge', 'Name', 'Sewadar Centre', 'Type', 'Department', 'From Date', 'To Date', 'Remarks', 'Entered By']
      rows = records.map(r => [
        r.badge_number, `"${r.sewadar_name}"`, r.sewadar_centre || '',
        getJathaTypeLabel(r.jatha_type), r.jatha_department || '',
        r.in_date, r.out_date, r.remarks || '', r.entered_by_name || ''
      ])
    }

    const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n')
    const a = document.createElement('a')
    const blobUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.href = blobUrl
    a.download = `${activeTab}_records_${dateFrom}_to_${dateTo}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
  }

  const isLoading = activeTab === 'gate' ? gateLoading : jathaLoading
  const currentRecords = activeTab === 'gate' ? gateRecords : jathaRecords
  const currentHasMore = activeTab === 'gate' ? gateHasMore : jathaHasMore
  const totalPages = Math.ceil((activeTab === 'gate' ? gateTotalCount : jathaTotalCount) / PAGE_SIZE) || 1
  const currentPage = activeTab === 'gate' ? gatePage : jathaPage
  const pageNumbers = useMemo(() => getPageNumbers(currentPage, totalPages), [currentPage, totalPages])

  const openCount = gateCounts.open_count
  const closedCount = gateCounts.closed_count
  const guestCount = gateCounts.guest_count
  const jathaBeasCount = jathaRecords.filter(r => r.jatha_type === 'beas').length
  const jathaMajorCount = jathaRecords.filter(r => r.jatha_type === 'major_centre').length
  const jathaHomeCount = jathaRecords.filter(r => r.jatha_type === 'jatha_home').length

  return (
    <div className="page-full pb-nav" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      <div className="header">
        <h2>Records</h2>
        <div className="status-row">
          <span>{activeTab === 'gate' ? gateTotalCount : jathaTotalCount} {activeTab === 'gate' ? 'sessions' : 'jatha records'}</span>
          {activeTab === 'gate' && openCount > 0 && <span className="stat-open">{openCount} IN</span>}
          {activeTab === 'gate' && closedCount > 0 && <span className="stat-closed">{closedCount} OUT</span>}
        </div>
      </div>

      <div className="records-tabs">
        <button className={`records-tab ${activeTab === 'gate' ? 'active' : ''}`} onClick={() => setActiveTab('gate')}>
          <DoorOpen size={14} /> Gate Records
        </button>
        <button className={`records-tab ${activeTab === 'jatha' ? 'active' : ''}`} onClick={() => setActiveTab('jatha')}>
          <Truck size={14} /> Jatha Records
        </button>
      </div>

      <div className="records-toolbar">
        <div className="search-box-v2">
          <Search size={15} />
          <input type="text" placeholder="Search name or badge..." value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)} />
        </div>
        <button className={`btn-icon ${showFilters ? 'active' : ''}`} onClick={() => setShowFilters(!showFilters)}>
          <Filter size={16} />
        </button>
        {activeTab === 'gate' && (
          <>
            <button className={`btn-icon ${showCards && !showTable ? 'active' : ''}`} onClick={() => setViewMode(showCards && !showTable ? 'auto' : 'cards')} title="Card View">
              <LayoutGrid size={16} />
            </button>
            <button className={`btn-icon ${showTable && !showCards ? 'active' : ''}`} onClick={() => setViewMode(showTable && !showCards ? 'auto' : 'table')} title="Table View">
              <Table2 size={16} />
            </button>
          </>
        )}
        <button className="btn-icon export" onClick={exportCSV}><Download size={16} /></button>
      </div>

      {refreshing && <div className="pull-refresh"><RefreshCw size={16} className="spin" /><span>Refreshing...</span></div>}

      <div className="pinned-filter-bar">
        <Calendar size={14} />
        <span className="filter-label">From</span>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input-v2 pinned-date" />
        <span className="filter-label">to</span>
        <input type="date" value={dateTo} min={dateFrom} onChange={e => setDateTo(e.target.value)} className="input-v2 pinned-date" />
        {profile?.role !== ROLES.SC_SP_USER && centresList.length > 0 && (
          <>
            <MapPin size={14} />
            <select value={centreFilter} onChange={e => setCentreFilter(e.target.value)} className="input-v2 centre-select" style={{ minWidth: 120 }}>
              <option value="">All Centres</option>
              {centresList.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
            </select>
          </>
        )}
      </div>

      {showFilters && activeTab === 'gate' && (
        <div className="filters-panel">
          <div className="filter-row">
            <span className="filter-label">Duty</span>
            <div className="duty-filters">
              {['', 'SATSCAN', 'DAILY', 'NIGHT', 'WATCH_AND_WARD'].map(duty => (
                <button key={duty} className={`chip ${dutyFilter === duty ? 'active' : ''}`} onClick={() => setDutyFilter(duty)}>{duty || 'All'}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'gate' && (
        <div className="quick-filters">
          <button className={`chip ${quickFilter === 'all' ? 'active' : ''}`} onClick={() => setQuickFilter('all')}>
            All <span className="chip-count">{gateTotalCount}</span>
          </button>
          <button className={`chip ${quickFilter === 'open' ? 'active' : ''}`} onClick={() => setQuickFilter('open')}>
            <span className="chip-dot open" /> In <span className="chip-count">{openCount}</span>
          </button>
          <button className={`chip ${quickFilter === 'guests' ? 'active' : ''}`} onClick={() => setQuickFilter('guests')}>
            <span className="chip-dot guest" /> Guests <span className="chip-count">{guestCount}</span>
          </button>
          <button className={`chip ${quickFilter === 'manual' ? 'active' : ''}`} onClick={() => setQuickFilter('manual')}>
            Manual
          </button>
          <button className={`chip ${quickFilter === 'gate_entry' ? 'active' : ''}`} onClick={() => setQuickFilter('gate_entry')}>
            Gate Entry
          </button>
        </div>
      )}

      {activeTab === 'jatha' && (
        <div className="quick-filters">
          <button className={`chip ${jathaQuickFilter === 'all' ? 'active' : ''}`} onClick={() => setJathaQuickFilter('all')}>
            All <span className="chip-count">{jathaTotalCount}</span>
          </button>
          <button className={`chip ${jathaQuickFilter === 'beas' ? 'active' : ''}`} onClick={() => setJathaQuickFilter('beas')}>
            <span className="chip-dot beas" /> BEAS <span className="chip-count">{jathaBeasCount}</span>
          </button>
          <button className={`chip ${jathaQuickFilter === 'major_centre' ? 'active' : ''}`} onClick={() => setJathaQuickFilter('major_centre')}>
            <span className="chip-dot major" /> Major Centre <span className="chip-count">{jathaMajorCount}</span>
          </button>
          <button className={`chip ${jathaQuickFilter === 'jatha_home' ? 'active' : ''}`} onClick={() => setJathaQuickFilter('jatha_home')}>
            <span className="chip-dot home" /> Jatha Home <span className="chip-count">{jathaHomeCount}</span>
          </button>
        </div>
      )}

      {isLoading && currentRecords.length === 0 ? (
        showTable ? (
          <div className="records-table-wrapper">
            <table className="records-table">
              <thead><tr>{[...Array(activeTab === 'gate' ? 13 : 8)].map((_,j) => <th key={j}></th>)}</tr></thead>
              <tbody>{[1,2,3,4,5].map(i => <tr key={i}>{[...Array(activeTab === 'gate' ? 13 : 8)].map((_,j) => <td key={j}><div className="skeleton" style={{height:16,width:'80%'}} /></td>)}</tr>)}</tbody>
            </table>
          </div>
        ) : (
          <div className="cards-grid">{[1, 2, 3, 4].map(i => <SkeletonCard key={i} />)}</div>
        )
      ) : currentRecords.length === 0 ? (
        <div className="empty-state"><Calendar size={48} /><p>No {activeTab === 'gate' ? 'sessions' : 'jatha records'} found</p></div>
      ) : showTable ? (
        <>
          {activeTab === 'gate' ? <SessionTable records={currentRecords} onDelete={canWrite ? handleDelete : null} /> : <JathaTable records={currentRecords} onDelete={canWrite ? handleDelete : null} />}
          {totalPages > 1 && (
            <div className="pagination">
              <button className="pagination-btn" disabled={currentPage <= 1} onClick={() => fetchGateRecords(currentPage - 1)}>
                <ChevronLeft size={16} /> Prev
              </button>
              <div className="pagination-pages">
                {pageNumbers.map((p, i) =>
                  p === '...' ? (
                    <span key={`e${i}`} className="pagination-ellipsis">…</span>
                  ) : (
                    <button key={p} className={`pagination-page ${p === currentPage ? 'active' : ''}`} onClick={() => activeTab === 'gate' ? fetchGateRecords(p) : fetchJathaRecords(p)}>
                      {p}
                    </button>
                  )
                )}
              </div>
              <button className="pagination-btn" disabled={currentPage >= totalPages} onClick={() => activeTab === 'gate' ? fetchGateRecords(currentPage + 1) : fetchJathaRecords(currentPage + 1)}>
                Next <ChevronRight size={16} />
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="cards-grid">
            {currentRecords.map(r => activeTab === 'gate' ? <SessionCard key={r.id} session={r} onDelete={canWrite ? handleDelete : null} /> : <JathaCard key={r.id} session={r} onDelete={canWrite ? handleDelete : null} />)}
          </div>
          {currentHasMore && (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <button className="btn btn-secondary load-more-btn" onClick={handleLoadMore} disabled={isLoading}>
                {isLoading ? 'Loading...' : <><Plus size={16} /> Load More</>}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
