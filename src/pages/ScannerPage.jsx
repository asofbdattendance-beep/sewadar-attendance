import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, ROLES, DUTY_TYPES, SESSION_STATUS, getDutyType, formatTime12Hour } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import BarcodeScanner from '../components/scanner/BarcodeScanner'
import { Wifi, WifiOff, CheckCircle, XCircle, Clock, AlertTriangle, Keyboard, Search, Info } from 'lucide-react'

export default function ScannerPage({ isOnline }) {
  const { profile } = useAuth()
  const [popupState, setPopupState] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [recentScans, setRecentScans] = useState([])
  const [forgotOutData, setForgotOutData] = useState(null)
  const [manualEntryOpen, setManualEntryOpen] = useState(false)
  const [manualSearch, setManualSearch] = useState('')
  const [manualResults, setManualResults] = useState([])
  const [manualLoading, setManualLoading] = useState(false)
  const [manualSelectedSewadar, setManualSelectedSewadar] = useState(null)
  const [manualOpenSession, setManualOpenSession] = useState(null)
  const [manualEntryTime, setManualEntryTime] = useState({ date: '', time: '' })
  const [manualEntryType, setManualEntryType] = useState('in')
  const [manualNoSession, setManualNoSession] = useState(false)
  const [manualHasSession, setManualHasSession] = useState(false)

  const scannerRef = useRef(null)
  const lastScanRef = useRef({ badge: null, time: 0 })
  const manualSearchTimeout = useRef(null)

  const fetchRecentScans = useCallback(async () => {
    if (!profile?.centre) return
    const today = new Date(); today.setHours(0, 0, 0, 0)
    let q = supabase.from('attendance_sessions')
      .select('id,badge_number,sewadar_name,status,in_date,in_time,out_time,duty_type')
      .eq('in_scanner_centre', profile.centre)
      .gte('in_date', today.toISOString().split('T')[0])
      .order('in_time', { ascending: false })
      .limit(10)
    const { data } = await q
    setRecentScans(data || [])
  }, [profile?.centre])

  useEffect(() => {
    if (!profile?.centre) return
    fetchRecentScans()
  }, [profile?.centre, fetchRecentScans])

  useEffect(() => {
    if (!profile?.centre) return
    const channel = supabase.channel('scanner-scans')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance_sessions' }, () => fetchRecentScans())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [profile?.centre, fetchRecentScans])

  const handleScan = useCallback(async (badge) => {
    const now = Date.now()
    if (badge === lastScanRef.current.badge && now - lastScanRef.current.time < 2000) return
    lastScanRef.current = { badge, time: now }
    setProcessing(true)

    let found = null
    if (isOnline) {
      const { data } = await supabase.from('sewadars').select('*').eq('badge_number', badge).maybeSingle()
      found = data
    }

    if (!found) {
      setPopupState({ type: 'not_found', badge }); setProcessing(false); return
    }

    let openSession = null
    if (isOnline) {
      const { data } = await supabase.rpc('get_open_session', { p_badge: badge })
      openSession = data && data.badge_number ? data : null
    }

    const dutyType = getDutyType()
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    const currentTime = today.toTimeString().slice(0, 5)

    if (openSession) {
      const inDate = new Date(openSession.in_date + 'T12:00:00')
      const hoursSinceIn = (today - inDate) / (1000 * 60 * 60)

      if (hoursSinceIn > 12) {
        setPopupState({ type: 'forgot_out', sewadar: found, openSession, dutyType })
      } else {
        setPopupState({ type: 'out', sewadar: found, openSession })
      }
    } else {
      setPopupState({ type: 'in', sewadar: found, dutyType, inDate: todayStr, inTime: currentTime })
    }

    setProcessing(false)
  }, [isOnline, profile])

  const markIN = async (customTime = null) => {
    if (!popupState?.sewadar || !profile) return
    
    const sewadar = popupState.sewadar
    const now = new Date()
    const inDate = customTime?.date || now.toISOString().split('T')[0]
    const inTime = customTime?.time || now.toTimeString().slice(0, 5)
    
    if (isOnline) {
      const { data: existingSession } = await supabase.rpc('get_open_session', { p_badge: sewadar.badge_number })
      if (existingSession && existingSession.badge_number) {
        setPopupState({ type: 'out', sewadar, openSession: existingSession })
        return
      }
    }
    
    const record = {
      badge_number: sewadar.badge_number,
      sewadar_name: sewadar.sewadar_name,
      centre: profile?.centre || sewadar.centre || 'UNKNOWN',
      duty_type: getDutyType(),
      status: SESSION_STATUS.OPEN,
      in_date: inDate,
      in_time: inTime,
      in_scanner_badge: profile?.badge_number,
      in_scanner_name: profile?.name,
      in_scanner_centre: profile?.centre || sewadar.centre || 'UNKNOWN',
    }

    if (navigator.vibrate) navigator.vibrate([40])

    setPopupState({ type: 'success', action: 'IN', sewadar, time: formatTime12Hour(inTime) })

    if (isOnline) {
      try {
        const { error } = await supabase.from('attendance_sessions').insert(record)
        if (error) throw error
      } catch (err) {
        console.error('Failed to insert session:', err)
      }
      fetchRecentScans()
    }

    setTimeout(closePopup, 1500)
  }

  const markOUT = async (forgotDate = null, forgotTime = null) => {
    if (!popupState?.openSession || !profile) return
    const now = new Date()
    const outDate = forgotDate || now.toISOString().split('T')[0]
    const outTime = forgotTime || now.toTimeString().slice(0, 5)

    const updateData = {
      status: SESSION_STATUS.CLOSED,
      out_date: outDate,
      out_time: outTime,
      out_scanner_badge: profile?.badge_number,
      out_scanner_name: profile?.name,
      out_scanner_centre: profile?.centre || popupState?.sewadar?.centre || 'UNKNOWN',
      updated_at: now.toISOString()
    }

    if (navigator.vibrate) navigator.vibrate([40, 30, 40])

    setPopupState({ type: 'success', action: 'OUT', sewadar: popupState.sewadar, time: formatTime12Hour(outTime) })
    
    if (isOnline) {
      await supabase.from('attendance_sessions').update(updateData).eq('id', popupState.openSession.id)
      fetchRecentScans()
    }
    
    setTimeout(closePopup, 1500)
  }

  const closePopup = () => {
    setPopupState(null)
    setForgotOutData(null)
    lastScanRef.current = { badge: null, time: 0 }
    if (scannerRef.current) scannerRef.current.resume()
  }

  const closeManualEntry = () => {
    setManualEntryOpen(false)
    setManualSearch('')
    setManualResults([])
    setManualSelectedSewadar(null)
    setManualOpenSession(null)
    setManualEntryTime({ date: '', time: '' })
    setManualEntryType('in')
    setManualNoSession(false)
    setManualHasSession(false)
  }

  const searchSewadars = async (query) => {
    if (!query || query.length < 2) {
      setManualResults([])
      return
    }

    setManualLoading(true)
    const term = query.replace(/[%_]/g, '').toUpperCase().slice(0, 50)
    
    let q = supabase.from('sewadars')
      .select('*')
      .or(`badge_number.ilike.%${term}%,sewadar_name.ilike.%${term}%`)
      .limit(10)

    if (profile?.role === ROLES.SC_SP_USER && profile?.centre) {
      q = q.eq('centre', profile.centre)
    }

    const { data } = await q
    setManualResults(data || [])
    setManualLoading(false)
  }

  const handleManualSearch = (e) => {
    const val = e.target.value
    setManualSearch(val)
    
    if (manualSearchTimeout.current) clearTimeout(manualSearchTimeout.current)
    manualSearchTimeout.current = setTimeout(() => searchSewadars(val), 300)
  }

  const selectManualSewadar = async (sewadar) => {
    setManualSelectedSewadar(sewadar)
    setManualLoading(true)
    setManualNoSession(false)
    setManualHasSession(false)
    
    const now = new Date()
    setManualEntryTime({
      date: now.toISOString().split('T')[0],
      time: now.toTimeString().slice(0, 5)
    })
    
    // Check for open session
    if (isOnline) {
      const { data } = await supabase.rpc('get_open_session', { p_badge: sewadar.badge_number })
      if (data && data.badge_number) {
        setManualOpenSession(data)
        setManualEntryType('out')
      } else {
        setManualOpenSession(null)
        setManualEntryType('in')
      }
    } else {
      setManualOpenSession(null)
      setManualEntryType('in')
    }
    
    setManualLoading(false)
  }

  const submitManualEntry = async () => {
    if (!manualSelectedSewadar || !manualEntryTime.date || !manualEntryTime.time) return

    const now = new Date()
    
    if (manualEntryType === 'in') {
      // Prevent multiple INs - check if session exists
      if (manualOpenSession) {
        setManualHasSession(true)
        return
      }
      
      const record = {
        badge_number: manualSelectedSewadar.badge_number,
        sewadar_name: manualSelectedSewadar.sewadar_name,
        centre: profile?.centre || manualSelectedSewadar.centre || 'UNKNOWN',
        duty_type: getDutyType(),
        status: SESSION_STATUS.OPEN,
        in_date: manualEntryTime.date,
        in_time: manualEntryTime.time,
        in_scanner_badge: profile?.badge_number,
        in_scanner_name: profile?.name,
        in_scanner_centre: profile?.centre || manualSelectedSewadar.centre || 'UNKNOWN',
        is_manual: true,
        entered_by_badge: profile?.badge_number,
        entered_by_name: profile?.name,
      }

      if (navigator.vibrate) navigator.vibrate([40])

      if (isOnline) {
        await supabase.from('attendance_sessions').insert(record)
        fetchRecentScans()
      }
    } else {
      if (!manualOpenSession) {
        setManualNoSession(true)
        return
      }
      
      const updateData = {
        status: SESSION_STATUS.CLOSED,
        out_date: manualEntryTime.date,
        out_time: manualEntryTime.time,
        out_scanner_badge: profile?.badge_number,
        out_scanner_name: profile?.name,
        out_scanner_centre: profile?.centre || manualSelectedSewadar?.centre || 'UNKNOWN',
        updated_at: now.toISOString()
      }

      if (navigator.vibrate) navigator.vibrate([40, 30, 40])

      if (isOnline) {
        await supabase.from('attendance_sessions').update(updateData).eq('id', manualOpenSession.id)
        fetchRecentScans()
      }
    }

    closeManualEntry()
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return ''
    return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const formatTime = (timeStr) => {
    if (!timeStr) return ''
    return formatTime12Hour(timeStr)
  }

  return (
    <div className="page pb-nav">
      {/* Status bar */}
      <div className="scanner-status-bar">
        <span className="scanner-centre-name">{profile?.centre}</span>
        <div className="scanner-indicators">
          <span className={`scanner-pill ${isOnline ? 'pill-online' : 'pill-offline'}`}>
            {isOnline ? <Wifi size={11} /> : <WifiOff size={11} />}
            {isOnline ? 'Online' : 'Offline'}
          </span>
        </div>
      </div>

      {/* Scanner */}
      <BarcodeScanner ref={scannerRef} onScan={handleScan} />

      {/* Manual Entry Button */}
      <button className="manual-entry-btn" onClick={() => setManualEntryOpen(true)}>
        <Keyboard size={16} />
        Manual Entry
      </button>

      {/* Recent scans */}
      {recentScans.length > 0 && (
        <div style={{ margin: '1rem 0 0' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            Recent Scans
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {recentScans.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.6rem 0.8rem' }}>
                <span style={{ width: 32, height: 22, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', fontWeight: 800, background: r.status === 'OPEN' ? 'rgba(33,150,243,0.15)' : 'rgba(76,175,125,0.15)', color: r.status === 'OPEN' ? 'var(--blue)' : 'var(--green)' }}>
                  {r.status === 'OPEN' ? 'IN' : 'OUT'}
                </span>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sewadar_name}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--gold)' }}>{r.badge_number}</div>
                </div>
                <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {formatTime(r.in_time)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {processing && (
        <div className="scanner-processing">
          <div className="scanner-processing-dot" />Processing…
        </div>
      )}

      {/* Popup */}
      {popupState && (
        <div className="popup-overlay" onClick={closePopup}>
          <div className="popup-card" onClick={e => e.stopPropagation()}>

            {/* IN Button */}
            {popupState.type === 'in' && (
              <>
                <div className="popup-header">
                  <div className="sewadar-info">
                    <div className="name">{popupState.sewadar.sewadar_name}</div>
                    <div className="badge" style={{ fontFamily: 'monospace', fontSize: 13, color: '#6b7280' }}>{popupState.sewadar.badge_number}</div>
                  </div>
                  <span className={`gender-badge ${popupState.sewadar.gender?.toUpperCase() === 'MALE' ? 'male' : 'female'}`}>
                    {popupState.sewadar.gender}
                  </span>
                </div>
                <div className="popup-details">
                  <div className="detail"><span>Centre</span><span>{popupState.sewadar?.centre || '-'}</span></div>
                  <div className="detail"><span>Dept</span><span>{popupState.sewadar?.department || '—'}</span></div>
                  <div className="detail"><span>Badge Status</span><span style={{ fontWeight: 600, color: popupState.sewadar?.badge_status === 'PERMANENT' ? 'var(--green)' : 'var(--gold)' }}>{popupState.sewadar?.badge_status || 'OPEN'}</span></div>
                  <div className="detail"><span>IN Date</span><span>{popupState.inDate}</span></div>
                  <div className="detail"><span>IN Time</span><span>{popupState.inTime}</span></div>
                  <div className="detail"><span>Duty</span><span style={{ color: 'var(--excel-green)', fontWeight: 700 }}>{popupState.dutyType}</span></div>
                </div>
                <div className="popup-actions">
                  <button className="btn-in" onClick={markIN}>IN</button>
                </div>
                <button className="btn-cancel" onClick={closePopup}>Cancel</button>
              </>
            )}

            {/* OUT Button (normal) */}
            {popupState.type === 'out' && (
              <>
                <div className="popup-header">
                  <div className="sewadar-info">
                    <div className="name">{popupState.sewadar.sewadar_name}</div>
                    <div className="badge" style={{ fontFamily: 'monospace', fontSize: 13, color: '#6b7280' }}>{popupState.sewadar.badge_number}</div>
                  </div>
                  <span className={`gender-badge ${popupState.sewadar.gender?.toUpperCase() === 'MALE' ? 'male' : 'female'}`}>
                    {popupState.sewadar.gender}
                  </span>
                </div>
                <div className="popup-details">
                  <div className="detail"><span>Centre</span><span>{popupState.sewadar?.centre || '-'}</span></div>
                  <div className="detail"><span>Dept</span><span>{popupState.sewadar?.department || '—'}</span></div>
                  <div className="detail"><span>Badge Status</span><span style={{ fontWeight: 600, color: popupState.sewadar?.badge_status === 'PERMANENT' ? 'var(--green)' : 'var(--gold)' }}>{popupState.sewadar?.badge_status || 'OPEN'}</span></div>
                  <div className="detail"><span>IN Date</span><span>{formatDate(popupState.openSession?.in_date)}</span></div>
                  <div className="detail"><span>IN Time</span><span>{formatTime(popupState.openSession?.in_time)}</span></div>
                  <div className="detail"><span>Duty</span><span style={{ color: 'var(--excel-green)', fontWeight: 700 }}>{popupState.openSession?.duty_type}</span></div>
                </div>
                <div className="popup-actions">
                  <button className="btn-out" onClick={() => markOUT()}>OUT</button>
                </div>
                <button className="btn-cancel" onClick={closePopup}>Cancel</button>
              </>
            )}

            {/* Forgot OUT - Ask when they left */}
            {popupState.type === 'forgot_out' && (
              <>
                <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
                  <AlertTriangle size={32} color="#f59e0b" style={{ margin: '0 auto 8px', display: 'block' }} />
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: '#f59e0b' }}>Previous Session Still Open</div>
                  <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '4px' }}>
                    From {formatDate(popupState.openSession.in_date)} at {formatTime(popupState.openSession.in_time)}
                  </div>
                </div>
                <div className="popup-header">
                  <div className="sewadar-info">
                    <div className="name">{popupState.sewadar.sewadar_name}</div>
                    <div className="badge" style={{ fontFamily: 'monospace', fontSize: 13, color: '#6b7280' }}>{popupState.sewadar.badge_number}</div>
                  </div>
                  <span className={`gender-badge ${popupState.sewadar.gender?.toUpperCase() === 'MALE' ? 'male' : 'female'}`}>
                    {popupState.sewadar.gender}
                  </span>
                </div>
                <div className="popup-details">
                  <div className="detail"><span>Centre</span><span>{popupState.sewadar?.centre || '-'}</span></div>
                  <div className="detail"><span>Dept</span><span>{popupState.sewadar?.department || '—'}</span></div>
                  <div className="detail"><span>Badge Status</span><span style={{ fontWeight: 600, color: popupState.sewadar?.badge_status === 'PERMANENT' ? 'var(--green)' : 'var(--gold)' }}>{popupState.sewadar?.badge_status || 'OPEN'}</span></div>
                </div>
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>When did you leave?</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <input type="date" className="input" value={forgotOutData?.date || ''} onChange={e => setForgotOutData(f => ({ ...f, date: e.target.value }))} />
                    <input type="time" className="input" value={forgotOutData?.time || ''} onChange={e => setForgotOutData(f => ({ ...f, time: e.target.value }))} />
                  </div>
                </div>
                <div className="popup-actions">
                  <button className="btn-out" onClick={() => markOUT(forgotOutData?.date, forgotOutData?.time)} disabled={!forgotOutData?.date || !forgotOutData?.time}>Close Session</button>
                </div>
                <button className="btn-cancel" onClick={closePopup}>Cancel</button>
              </>
            )}



            {/* Not Found */}
            {popupState.type === 'not_found' && (
              <div className="popup-error">
                <XCircle size={32} color="#dc2626" style={{ margin: '0 auto 12px', display: 'block' }} />
                <div className="error-title">Badge Not Found</div>
                <div className="error-badge">{popupState.badge}</div>
                <div className="error-msg">This badge is not registered</div>
                <button className="btn-cancel" onClick={closePopup}>Try Again</button>
              </div>
            )}

            {/* Success */}
            {popupState.type === 'success' && (
              <div className="popup-success">
                <div className={`success-icon-ring ${popupState.action === 'IN' ? 'ring-green' : 'ring-red'}`}>
                  <CheckCircle size={36} color={popupState.action === 'IN' ? '#16a34a' : '#dc2626'} />
                </div>
                <div className="success-title" style={{ color: popupState.action === 'IN' ? '#16a34a' : '#dc2626' }}>
                  {popupState.action}
                </div>
                <div className="success-name">{popupState.sewadar.sewadar_name}</div>
                <div className="success-type">{popupState.time}</div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* Manual Entry Modal */}
      {manualEntryOpen && (
        <div className="popup-overlay" onClick={closeManualEntry}>
          <div className="popup-card manual-entry-modal" onClick={e => e.stopPropagation()}>
            <div className="manual-entry-header">
              <Keyboard size={20} />
              <span>Manual Entry</span>
            </div>

            {!manualSelectedSewadar ? (
              <>
                <div className="manual-search-box">
                  <Search size={16} />
                  <input
                    type="text"
                    placeholder="Search by name or badge..."
                    value={manualSearch}
                    onChange={handleManualSearch}
                    autoFocus
                  />
                </div>

                <div className="manual-results">
                  {manualLoading ? (
                    <div className="manual-loading">
                      <div className="spinner" style={{ width: 24, height: 24 }} />
                    </div>
                  ) : manualResults.length > 0 ? (
                    manualResults.map(s => (
                      <div key={s.badge_number} className="manual-result-item" onClick={() => selectManualSewadar(s)}>
                        <div className="result-info">
                          <div className="result-name">{s.sewadar_name}</div>
                          <div className="result-badge">{s.badge_number}</div>
                        </div>
                        <div className="result-meta">
                          <span className="result-centre">{s.centre || '-'}</span>
                        </div>
                      </div>
                    ))
                  ) : manualSearch.length >= 2 ? (
                    <div className="no-results">No sewadar found</div>
                  ) : (
                    <div className="search-hint">Type at least 2 characters to search</div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="selected-sewadar">
                  <div className="selected-info">
                    <div className="selected-name">{manualSelectedSewadar?.sewadar_name}</div>
                    <div className="selected-badge">{manualSelectedSewadar?.badge_number}</div>
                    <div className="selected-centre">{manualSelectedSewadar?.centre || '-'}</div>
                  </div>
                  <button className="change-btn" onClick={() => {
                    setManualSelectedSewadar(null)
                    setManualOpenSession(null)
                    setManualNoSession(false)
                    setManualHasSession(false)
                  }}>Change</button>
                </div>

                {manualLoading ? (
                  <div className="manual-loading">
                    <div className="spinner" style={{ width: 24, height: 24 }} />
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Checking session...</span>
                  </div>
                ) : (
                  <>
                    {manualEntryType === 'out' && manualOpenSession && (
                      <div className="session-info-box">
                        <Info size={14} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>Open Session Found</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                            IN: {manualOpenSession.in_date} at {formatTime12Hour(manualOpenSession.in_time)}
                          </div>
                        </div>
                      </div>
                    )}

                    {manualNoSession && (
                      <div className="warning-box">
                        <AlertTriangle size={14} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>No Open Session</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                            This sewadar doesn't have an open session. Mark IN first.
                          </div>
                        </div>
                      </div>
                    )}

                    {manualHasSession && (
                      <div className="warning-box">
                        <AlertTriangle size={14} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 12 }}>Session Already Open</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                            IN: {manualOpenSession?.in_date} at {formatTime12Hour(manualOpenSession?.in_time)}. Mark OUT first.
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="entry-type-toggle">
                      <button
                        className={`type-btn ${manualEntryType === 'in' ? 'active-in' : ''}`}
                        onClick={() => {
                          setManualEntryType('in')
                          setManualNoSession(false)
                          setManualHasSession(false)
                        }}
                      >
                        IN
                      </button>
                      <button
                        className={`type-btn ${manualEntryType === 'out' ? 'active-out' : ''}`}
                        onClick={() => {
                          setManualEntryType('out')
                          setManualNoSession(false)
                          setManualHasSession(false)
                          if (!manualOpenSession) setManualNoSession(true)
                        }}
                      >
                        OUT
                      </button>
                    </div>

                    <div className="time-inputs">
                      <div className="time-field">
                        <label>Date</label>
                        <input
                          type="date"
                          value={manualEntryTime.date}
                          onChange={e => setManualEntryTime(t => ({ ...t, date: e.target.value }))}
                        />
                      </div>
                      <div className="time-field">
                        <label>Time</label>
                        <input
                          type="time"
                          value={manualEntryTime.time}
                          onChange={e => setManualEntryTime(t => ({ ...t, time: e.target.value }))}
                        />
                      </div>
                    </div>

                    <button
                      className={manualEntryType === 'in' ? 'btn-in' : 'btn-out'}
                      onClick={submitManualEntry}
                      disabled={
                        !manualEntryTime.date || 
                        !manualEntryTime.time || 
                        (manualEntryType === 'out' && !manualOpenSession) ||
                        (manualEntryType === 'in' && manualOpenSession)
                      }
                    >
                      Mark {manualEntryType.toUpperCase()}
                    </button>
                  </>
                )}
              </>
            )}

            <button className="btn-cancel" onClick={closeManualEntry}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}
