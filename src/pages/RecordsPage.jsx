import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, ROLES, formatTime12Hour, formatDateIndian, getLocalDate } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../components/Toast'
import { logAction } from '../lib/logger'
import { Search, Download, Filter, Calendar, Clock, Scan, Timer, Edit3, DoorOpen, RefreshCw, Truck, MapPin, Briefcase, ArrowRight, LayoutGrid, Table2, Trash2, ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react'

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

function isTimeInvalid(record) {
  const d = calculateDuration(record.in_date, record.in_time, record.out_date, record.out_time)
  return d === 'invalid'
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
  const isSuperAdmin = session.role === ROLES.SUPER_ADMIN
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
            <MapPin size={14} />
            <div>
              <span className="jatha-detail-label">Destination</span>
              <span className="jatha-detail-value">{session.centre || 'Unknown'}</span>
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
            <span className="jatha-date">{formatDateIndian(session.in_date)}</span>
          </div>
          <ArrowRight size={14} />
          <div className="jatha-date-item">
            <span className="jatha-date-label">TO DATE</span>
            <span className="jatha-date">{formatDateIndian(session.out_date)}</span>
          </div>
          {jathaDays(session.in_date, session.out_date) && (
            <div className="jatha-days-badge">{jathaDays(session.in_date, session.out_date)} days</div>
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
        <div className="jatha-record-date">{session.entered_at ? formatDateIndian(session.entered_at.split('T')[0]) : formatDateIndian(session.in_date)}</div>
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
  const sameDate = session.in_date === session.out_date && session.out_date
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
            <span className="guest-centre-chip">{session.centre}</span>
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
          {records.map((r, idx) => {
            const isOpen = r.status === 'OPEN'
            const isManual = r.is_manual === true
            const isGateEntry = r.is_gate_entry === true
            const isCrossScan = r.is_cross_scan === true
            const duration = calculateDuration(r.in_date, r.in_time, r.out_date, r.out_time)
            const sameDate = r.in_date === r.out_date && r.out_date
            return (
              <tr key={r.id || idx} className={isCrossScan ? 'row-guest' : ''}>
                <td><span className={`status-pill ${isOpen ? 'status-pill-open' : 'status-pill-closed'}`}>{isOpen ? 'IN' : 'OUT'}</span></td>
                <td className="cell-badge">{r.badge_number || 'N/A'}</td>
                <td className="cell-name">{r.sewadar_name || 'Unknown'}</td>
                <td className="cell-centre">
                  <div className="centre-cell-content">
                    {isCrossScan ? (
                      <><span className="guest-centre-tag">From {r.centre}</span> at {r.scan_centre}</>
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
            <th>Badge</th><th>Name</th><th>Sewadar Centre</th><th>Destination</th><th>Type</th><th>Department</th><th>From Date</th><th>To Date</th><th>Days</th><th>Remarks</th><th>Entered By</th><th style={{width:50}}></th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, idx) => (
            <tr key={r.id || idx}>
              <td className="cell-badge">{r.badge_number || 'N/A'}</td>
              <td className="cell-name">{r.sewadar_name || 'Unknown'}</td>
              <td className="cell-centre">{r.sewadar_centre || '-'}</td>
              <td className="cell-centre">{r.centre || '-'}</td>
              <td><span className={`type-pill ${r.jatha_type}`}>{getJathaTypeLabel(r.jatha_type)}</span></td>
              <td className="cell-centre">{r.jatha_department || '-'}</td>
              <td className="cell-date">{formatDateIndian(r.in_date)}</td>
              <td className="cell-date">{formatDateIndian(r.out_date)}</td>
              <td className="cell-days">{jathaDays(r.in_date, r.out_date) || '-'}</td>
              <td className="cell-remarks" style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.remarks || '-'}</td>
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
  const [gateRecords, setGateRecords] = useState([])
  const [jathaRecords, setJathaRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [quickFilter, setQuickFilter] = useState('all')
  const [jathaQuickFilter, setJathaQuickFilter] = useState('all')
  const [refreshing, setRefreshing] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [dateFrom, setDateFrom] = useState(getLocalDate())
  const [dateTo, setDateTo] = useState(getLocalDate())
  const [dutyFilter, setDutyFilter] = useState('')
  const [viewMode, setViewMode] = useState('auto')
  const [centresList, setCentresList] = useState([])
  const [centreFilter, setCentreFilter] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50
  const pullStartY = useRef(0)
  const realtimeDebounceRef = useRef(null)

  useEffect(() => {
    if (profile?.role === ROLES.SUPER_ADMIN || profile?.role === ROLES.ASO) {
      supabase.from('centres').select('name').order('name').then(({ data }) => setCentresList(data || []))
    } else if (profile?.centre) {
      supabase.from('centres').select('name, parent_centre').then(({ data }) => {
        const visible = (data || []).filter(c => c.name === profile.centre || c.parent_centre === profile.centre)
        setCentresList(visible)
        setCentreFilter(profile.centre)
      })
    }
  }, [profile?.role, profile?.centre])

  const isMobile = () => window.innerWidth < 768

  const handleDelete = async (table, id) => {
    const label = table === 'attendance_sessions' ? 'attendance' : 'jatha'
    if (!window.confirm(`Delete this ${label} record?`)) return
    const { data: deletedRecord } = await supabase.from(table).select('*').eq('id', id).single()

    if (!deletedRecord) { toast.error('Record not found'); return }

    // Non-super_admin cannot delete records from previous months
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
    fetchRecords()
  }

  const fetchRecords = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)

    const isASO = profile?.role === ROLES.SUPER_ADMIN || profile?.role === ROLES.ASO
    const targetCentre = centreFilter || (isASO ? null : profile?.centre)

    let sessions = []

    // Step 1: Fetch sessions based on role
    if (isASO) {
      let q = supabase.from('attendance_sessions')
        .select('*')
        .gte('in_date', dateFrom)
        .lte('in_date', dateTo)
        .order('in_time', { ascending: false })
        .limit(10000)
      if (targetCentre) q = q.eq('centre', targetCentre)
      const { data } = await q
      sessions = data || []
    } else if (targetCentre) {
      // Fetch sessions AT the user's centre
      let q = supabase.from('attendance_sessions')
        .select('*')
        .gte('in_date', dateFrom)
        .lte('in_date', dateTo)
        .order('in_time', { ascending: false })
        .limit(10000)

      if (profile?.role === ROLES.SC_SP_USER) {
        q = q.eq('in_scanner_centre', targetCentre)
      } else {
        q = q.eq('centre', targetCentre)
      }

      const { data: localSessions } = await q
      sessions = localSessions || []

      // Also fetch sessions where sewadars from this centre scanned ELSEWHERE
      const { data: centreSewadars } = await supabase
        .from('sewadars')
        .select('badge_number')
        .eq('centre', targetCentre)

      if (centreSewadars && centreSewadars.length > 0) {
        const centreBadges = centreSewadars.map(s => s.badge_number)
        const badgeBatches = []
        for (let i = 0; i < centreBadges.length; i += 1000) {
          badgeBatches.push(centreBadges.slice(i, i + 1000))
        }

        let outboundSessions = []
        for (const batch of badgeBatches) {
          let q = supabase.from('attendance_sessions')
            .select('*')
            .gte('in_date', dateFrom)
            .lte('in_date', dateTo)
            .in('badge_number', batch)
            .limit(10000)
          if (profile?.role === ROLES.SC_SP_USER) {
            // SC_SP_USER only sees sessions scanned by their centre
          } else {
            q = q.neq('centre', targetCentre)
          }
          const { data: crossData } = await q
          if (crossData) outboundSessions = outboundSessions.concat(crossData)
        }

        // Merge and deduplicate by id
        const existingIds = new Set(sessions.map(s => s.id))
        for (const os of outboundSessions) {
          if (!existingIds.has(os.id)) {
            sessions.push(os)
          }
        }
      }
    }

    // Step 2: Detect cross-scans (sewadar scanned at a different centre than their home)
    // Uses SECURITY DEFINER RPC to bypass RLS, so any role can look up any sewadar's home centre
    // When homeCentre != scanCentre: tag as cross_scan, store scan centre, show home centre
    if (sessions.length > 0) {
      const badgeNumbers = [...new Set(sessions.map(s => s.badge_number))]
      const homeCentreMap = {}
      const deptMap = {}
      const { data: sewadars } = await supabase.rpc('get_sewadar_details', { p_badge_numbers: badgeNumbers })
      for (const s of (sewadars || [])) {
        homeCentreMap[s.badge_number] = s.centre
        deptMap[s.badge_number] = s.department
      }

      sessions = sessions.map(s => {
        const homeCentre = homeCentreMap[s.badge_number]
        return { ...s, sewadar_dept: deptMap[s.badge_number] || null, ...(homeCentre && homeCentre !== s.centre ? { is_cross_scan: true, scan_centre: s.centre, centre: homeCentre } : {}) }
      })
    }

    // Step 3: Apply filters
    let gateFiltered = sessions.filter(r => r.is_jatha_entry !== true)
    if (dutyFilter && dutyFilter !== 'JATHA') {
      gateFiltered = gateFiltered.filter(r => r.duty_type === dutyFilter)
    }
    if (searchTerm) {
      const term = searchTerm.toUpperCase()
      gateFiltered = gateFiltered.filter(r => r.badge_number?.includes(term) || r.sewadar_name?.toUpperCase().includes(term))
    }
    setGateRecords(gateFiltered)

    // Fetch Jatha Records
    if (!dutyFilter || dutyFilter === 'JATHA') {
      const { data: jathaData } = await supabase
        .from('jatha_attendance')
        .select(`*, jatha_master:jatha_id (jatha_type, centre_name, department)`)
        .gte('from_date', dateFrom)
        .lte('from_date', dateTo)
        .order('entered_at', { ascending: false })
        .limit(10000)

      // Look up sewadar home centres for jatha records
      const jathaBadges = [...new Set((jathaData || []).map(j => j.badge_number).filter(Boolean))]
      const sewadarCentreMap = {}
      const jathaDeptMap = {}
      if (jathaBadges.length > 0) {
        const { data: jathaSewadars } = await supabase.rpc('get_sewadar_details', { p_badge_numbers: jathaBadges })
        for (const s of (jathaSewadars || [])) {
          sewadarCentreMap[s.badge_number] = s.centre
          jathaDeptMap[s.badge_number] = s.department
        }
      }

      let jathaFiltered = (jathaData || []).map(j => ({
        ...j,
        is_jatha_entry: true,
        duty_type: 'JATHA',
        in_date: j.from_date,
        out_date: j.to_date,
        centre: j.jatha_master?.centre_name,
        sewadar_centre: sewadarCentreMap[j.badge_number] || 'Unknown',
        sewadar_dept: jathaDeptMap[j.badge_number] || null,
        jatha_type: j.jatha_master?.jatha_type,
        jatha_department: j.jatha_master?.department
      }))

      // For non-super-admin users, jatha_attendance RLS already restricts
      // by sewadar's home centre. centreFilter applies to DESTINATION centre
      // (jatha_master.centre_name), so only apply it for super_admin or
      // when the user explicitly selects a destination centre.
      if (centreFilter && (profile?.role === ROLES.SUPER_ADMIN || profile?.role === ROLES.ASO)) {
        jathaFiltered = jathaFiltered.filter(r => r.centre === centreFilter)
      }

      if (searchTerm) {
        const term = searchTerm.toUpperCase()
        jathaFiltered = jathaFiltered.filter(r => r.badge_number?.includes(term) || r.sewadar_name?.toUpperCase().includes(term))
      }

      if (jathaQuickFilter !== 'all') {
        jathaFiltered = jathaFiltered.filter(r => r.jatha_type === jathaQuickFilter)
      }

      setJathaRecords(jathaFiltered)
    } else {
      setJathaRecords([])
    }

    setLoading(false)
    setRefreshing(false)
  }, [dateFrom, dateTo, dutyFilter, profile?.centre, profile?.role, searchTerm, centreFilter, jathaQuickFilter])

  const fetchRecordsRef = useRef(fetchRecords)
  fetchRecordsRef.current = fetchRecords

  useEffect(() => { setPage(1) }, [dateFrom, dateTo, dutyFilter, centreFilter, searchTerm, quickFilter, jathaQuickFilter])
  useEffect(() => { fetchRecords() }, [fetchRecords])

  useEffect(() => {
    const channel = supabase
      .channel('attendance_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance_sessions' }, () => {
        if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
        realtimeDebounceRef.current = setTimeout(() => fetchRecordsRef.current(), 500)
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'jatha_attendance' }, () => {
        if (realtimeDebounceRef.current) clearTimeout(realtimeDebounceRef.current)
        realtimeDebounceRef.current = setTimeout(() => fetchRecordsRef.current(), 500)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [])

  const handleTouchStart = (e) => {
    if (window.scrollY === 0) pullStartY.current = e.touches[0].clientY
  }
  const handleTouchMove = (e) => {
    const diff = e.touches[0].clientY - pullStartY.current
    if (diff > 60 && window.scrollY === 0) e.preventDefault()
  }
  const handleTouchEnd = (e) => {
    const diff = e.changedTouches[0].clientY - pullStartY.current
    if (diff > 80 && window.scrollY === 0) fetchRecords(true)
    pullStartY.current = 0
  }

  function exportCSV() {
    const records = activeTab === 'gate' ? gateRecords : jathaRecords
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
      headers = ['Badge', 'Name', 'Sewadar Centre', 'Destination', 'Type', 'Department', 'From Date', 'To Date', 'Remarks', 'Entered By']
      rows = records.map(r => [
        r.badge_number, `"${r.sewadar_name}"`, r.sewadar_centre || '', r.centre || '',
        getJathaTypeLabel(r.jatha_type), r.jatha_department || '',
        r.in_date, r.out_date, r.remarks || '', r.entered_by_name || ''
      ])
    }

    const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `${activeTab}_records_${dateFrom}_to_${dateTo}.csv`
    a.click()
  }

  let filteredRecords = activeTab === 'gate' ? gateRecords : jathaRecords

  if (activeTab === 'gate' && quickFilter !== 'all') {
    if (quickFilter === 'open') {
      filteredRecords = filteredRecords.filter(r => r.status === 'OPEN')
    } else if (quickFilter === 'guests') {
      filteredRecords = filteredRecords.filter(r => r.is_cross_scan === true)
    } else if (quickFilter === 'manual') {
      filteredRecords = filteredRecords.filter(r => r.is_manual === true && !r.is_gate_entry)
    } else if (quickFilter === 'gate_entry') {
      filteredRecords = filteredRecords.filter(r => r.is_gate_entry === true)
    }
  }

  const currentRecords = filteredRecords
  const openCount = gateRecords.filter(r => r.status === 'OPEN').length
  const closedCount = gateRecords.filter(r => r.status === 'CLOSED').length
  const guestCount = gateRecords.filter(r => r.is_cross_scan === true).length
  const jathaBeasCount = jathaRecords.filter(r => r.jatha_type === 'beas').length
  const jathaMajorCount = jathaRecords.filter(r => r.jatha_type === 'major_centre').length
  const jathaHomeCount = jathaRecords.filter(r => r.jatha_type === 'jatha_home').length
  const showTable = viewMode === 'table' || (viewMode === 'auto' && !isMobile())
  const showCards = viewMode === 'cards' || (viewMode === 'auto' && isMobile())
  const totalPages = Math.ceil(currentRecords.length / PAGE_SIZE) || 1
  const safePage = Math.min(page, totalPages)
  const paginatedRecords = currentRecords.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  return (
    <div className="page-full pb-nav" onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      <div className="header">
        <h2>Records</h2>
        <div className="status-row">
          <span>{currentRecords.length} {activeTab === 'gate' ? 'sessions' : 'jatha records'}</span>
          {activeTab === 'gate' && openCount > 0 && <span className="stat-open">{openCount} IN</span>}
          {activeTab === 'gate' && closedCount > 0 && <span className="stat-closed">{closedCount} OUT</span>}
        </div>
      </div>

      {/* Tabs */}
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

      {showFilters && (
        <div className="filters-panel">
          <div className="filter-row">
            <Calendar size={14} />
            <span className="filter-label">From</span>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input-v2" />
            <span className="filter-label">to</span>
            <input type="date" value={dateTo} min={dateFrom} onChange={e => setDateTo(e.target.value)} className="input-v2" />
          </div>
          {profile?.role !== ROLES.SC_SP_USER && centresList.length > 0 && (
            <div className="filter-row">
              <MapPin size={14} />
              <span className="filter-label">Centre</span>
              <select value={centreFilter} onChange={e => setCentreFilter(e.target.value)} className="input-v2 centre-select">
                <option value="">All Centres</option>
                {centresList.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          )}
          {activeTab === 'gate' && (
            <div className="filter-row">
              <span className="filter-label">Duty</span>
              <div className="duty-filters">
                {['', 'SATSCAN', 'DAILY', 'NIGHT', 'WATCH_AND_WARD'].map(duty => (
                  <button key={duty} className={`chip ${dutyFilter === duty ? 'active' : ''}`} onClick={() => setDutyFilter(duty)}>{duty || 'All'}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'gate' && (
        <div className="quick-filters">
          <button className={`chip ${quickFilter === 'all' ? 'active' : ''}`} onClick={() => setQuickFilter('all')}>
            All <span className="chip-count">{gateRecords.length}</span>
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
            All <span className="chip-count">{jathaRecords.length}</span>
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

      {refreshing && <div className="pull-refresh"><RefreshCw size={16} className="spin" /><span>Refreshing...</span></div>}

      {loading ? (
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
      ) : paginatedRecords.length === 0 ? (
        <div className="empty-state"><Calendar size={48} /><p>No {activeTab === 'gate' ? 'sessions' : 'jatha records'} found</p></div>
      ) : showTable ? (
        activeTab === 'gate' ? <SessionTable records={paginatedRecords} onDelete={canWrite ? handleDelete : null} /> : <JathaTable records={paginatedRecords} onDelete={canWrite ? handleDelete : null} />
      ) : (
        <div className="cards-grid">
          {paginatedRecords.map(r => activeTab === 'gate' ? <SessionCard key={r.id} session={r} onDelete={canWrite ? handleDelete : null} /> : <JathaCard key={r.id} session={r} onDelete={canWrite ? handleDelete : null} />)}
        </div>
      )}
      {totalPages > 1 && (
        <div className="pagination">
          <button className="pagination-btn" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
            <ChevronLeft size={16} /> Prev
          </button>
          <div className="pagination-pages">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
              <button key={p} className={`pagination-page ${p === safePage ? 'active' : ''}`} onClick={() => setPage(p)}>
                {p}
              </button>
            ))}
          </div>
          <button className="pagination-btn" disabled={safePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
            Next <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  )
}
