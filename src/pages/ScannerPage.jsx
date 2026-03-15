import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, getDistanceMetres, ROLES, isExceptionDept } from '../lib/supabase'
import { lookupBadgeOffline, addToOfflineQueue, getOfflineQueueCount, syncOfflineQueue, getCacheAge, getCachedSewadars } from '../lib/offline'
import { useAuth } from '../context/AuthContext'
import BarcodeScanner from '../components/scanner/BarcodeScanner'
import { Wifi, WifiOff, MapPin, AlertTriangle, CheckCircle, XCircle, Clock, RefreshCw, Activity, PenLine } from 'lucide-react'

export default function ScannerPage({ isOnline }) {
  const { profile } = useAuth()
  const [userLocation, setUserLocation] = useState(null)
  const [centreConfig, setCentreConfig] = useState(null)
  const [childCentres, setChildCentres] = useState([])
  const [gpsStatus, setGpsStatus] = useState('loading')
  const [popupState, setPopupState] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [todayCount, setTodayCount] = useState(0)
  const [pendingSync, setPendingSync] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [recentScans, setRecentScans] = useState([])
  const [liveStats, setLiveStats] = useState({ total: 0, male: 0, female: 0 })
  const [manualModal, setManualModal] = useState(false)
  const [manualSearch, setManualSearch] = useState('')
  const [manualResults, setManualResults] = useState([])
  const [manualSearching, setManualSearching] = useState(false)
  const soundEnabled = localStorage.getItem('sa_sound') !== 'false'

  const scannerRef = useRef(null)
  const lastScanRef = useRef({ badge: null, time: 0 })
  const watchIdRef = useRef(null)
  const audioCtxRef = useRef(null)

  useEffect(() => {
    if (!profile?.centre) return
    Promise.all([
      supabase.from('centres').select('latitude,longitude,geo_radius,geo_enabled').eq('centre_name', profile.centre).maybeSingle(),
      supabase.from('centres').select('centre_name').eq('parent_centre', profile.centre)
    ]).then(([centreRes, childRes]) => {
      setCentreConfig(centreRes.data)
      setChildCentres(childRes.data?.map(c => c.centre_name) || [])
    })
  }, [profile?.centre])


  // GPS: watchPosition for continuous refresh
  useEffect(() => {
    if (!navigator.geolocation) { setGpsStatus('failed'); return }
    const success = (pos) => {
      setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      setGpsStatus('success')
    }
    const fail = () => setGpsStatus(s => s !== 'success' ? 'failed' : s)
    const opts = { enableHighAccuracy: true, timeout: 20000, maximumAge: 30000 }
    navigator.geolocation.getCurrentPosition(success, fail, opts)
    watchIdRef.current = navigator.geolocation.watchPosition(success, fail, opts)
    return () => { if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current) }
  }, [])

  // Live IN count subscription
  useEffect(() => {
    fetchTodayCount()
    const channel = supabase.channel('scanner-count')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance' }, fetchTodayCount)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [profile?.centre, profile?.role])

  async function fetchTodayCount() {
    // Guard: profile must be loaded before we can scope the query correctly
    if (!profile?.centre && profile?.role !== ROLES.ASO) return
    const today = new Date(); today.setHours(0, 0, 0, 0) // local midnight → correct for IST
    let q = supabase.from('attendance')
      .select('badge_number, type, scan_time, centre, sewadar_name')
      .gte('scan_time', today.toISOString())
    // Scope to centre for non-ASO users
    if (profile?.role === ROLES.SC_SP_USER && profile?.centre) {
      q = q.eq('centre', profile.centre)
    } else if (profile?.role === ROLES.CENTRE_USER && profile?.centre) {
      q = q.eq('centre', profile.centre)
    }
    const { data, error } = await q
    if (error || !data) return
    const ins = data.filter(r => r.type === 'IN')
    setTodayCount(ins.length)
    // Who is currently inside = badge whose latest scan today is IN
    const latest = {}
    data.forEach(r => {
      if (!latest[r.badge_number] || new Date(r.scan_time) > new Date(latest[r.badge_number].scan_time))
        latest[r.badge_number] = r
    })
    const inside = Object.values(latest).filter(r => r.type === 'IN')
    const sewadars = getCachedSewadars() || []
    let male = 0, female = 0
    inside.forEach(r => {
      const s = sewadars.find(sw => sw.badge_number === r.badge_number)
      const g = (s?.gender || '').toUpperCase()
      if (g === 'MALE' || g === 'M') male++
      else if (g === 'FEMALE' || g === 'F') female++
    })
    setLiveStats({ total: inside.length, male, female })
  }

  useEffect(() => {
    setPendingSync(getOfflineQueueCount())
    const id = setInterval(() => setPendingSync(getOfflineQueueCount()), 5000)
    return () => clearInterval(id)
  }, [])

  // Load recent scans from DB once profile is available
  useEffect(() => {
    if (!profile?.centre) return
    fetchRecentScans()
  }, [profile?.centre])

  async function fetchRecentScans() {
    if (!profile?.centre) return
    const today = new Date(); today.setHours(0, 0, 0, 0)
    let q = supabase.from('attendance')
      .select('id,badge_number,sewadar_name,type,scan_time,centre,scanner_centre')
      .gte('scan_time', today.toISOString())
      .order('scan_time', { ascending: false })
      .limit(5)
    if (profile.role !== 'aso') q = q.eq('centre', profile.centre)
    const { data } = await q
    setRecentScans(data || [])
  }

  async function handleManualSync() {
    if (!isOnline) return
    setSyncing(true)
    await syncOfflineQueue(supabase)
    setPendingSync(getOfflineQueueCount())
    setSyncing(false)
  }

  function playBeep(type) {
    if (!soundEnabled) return
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
      const ctx = audioCtxRef.current
      const osc = ctx.createOscillator(); const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.frequency.value = type === 'IN' ? 880 : 440
      osc.type = 'sine'
      gain.gain.setValueAtTime(0.3, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25)
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.25)
    } catch {}
    if (navigator.vibrate) navigator.vibrate(type === 'IN' ? [40] : [40, 30, 40])
  }

  async function searchSewadars(term) {
    if (!term || term.length < 2) { setManualResults([]); return }
    setManualSearching(true)
    const { data } = await supabase.from('sewadars')
      .select('*').or(`badge_number.ilike.%${term.toUpperCase()}%,sewadar_name.ilike.%${term}%`).limit(10)
    setManualResults(data || [])
    setManualSearching(false)
  }

  async function selectManualSewadar(sewadar) {
    setManualModal(false); setManualSearch(''); setManualResults([])
    await processSewadar(sewadar)
  }

  // Ladder: strictly alternate IN→OUT→IN→OUT...
  // First scan of day: ONLY IN allowed (must check in first before out)
  // After that: must follow last type.
  function computeAllowedTypes(todayEntries) {
    if (todayEntries.length === 0) return ['IN']  // First scan MUST be IN
    const last = todayEntries[todayEntries.length - 1]
    return last.type === 'IN' ? ['OUT'] : ['IN']
  }

  const handleScan = useCallback(async (badge) => {
    const now = Date.now()
    if (badge === lastScanRef.current.badge && now - lastScanRef.current.time < 2000) return
    lastScanRef.current = { badge, time: now }
    setProcessing(true)
    let found = null
    try {
      if (isOnline) {
        const { data } = await supabase.from('sewadars').select('*').eq('badge_number', badge).maybeSingle()
        found = data
      } else {
        found = lookupBadgeOffline(badge)
      }
    } catch {}
    if (!found) {
      setPopupState({ type: 'not_found', badge }); setProcessing(false); return
    }
    await processSewadar(found, badge)
  }, [isOnline, profile, userLocation, centreConfig, childCentres])

  async function processSewadar(found, badge) {
    const now = Date.now()
    setProcessing(true)
    const b = badge || found.badge_number
    let todayEntries = []
    if (isOnline) {
      const today = new Date(); today.setHours(0, 0, 0, 0)
      const { data } = await supabase.from('attendance').select('*').eq('badge_number', b)
        .gte('scan_time', today.toISOString()).order('scan_time', { ascending: true })
      todayEntries = data || []
    }

    const lastEntry = todayEntries.length > 0 ? todayEntries[todayEntries.length - 1] : null
    if (lastEntry?.scan_time) {
      const diff = now - new Date(lastEntry.scan_time).getTime()
      if (diff < 120000) {
        setPopupState({ type: 'recent', sewadar: found, lastEntry, badge: b, todayEntries })
        setProcessing(false); return
      }
    }

    const allowedTypes = computeAllowedTypes(todayEntries)
    const scanCount = todayEntries.length
    const isAso = profile?.role === ROLES.ASO
    const isCentreUserRole = profile?.role === ROLES.CENTRE_USER
    const isSameCentre = found.centre === profile?.centre
    const isChildCentre = isCentreUserRole && childCentres.includes(found.centre)
    const isException = isExceptionDept(found.department)

    if (found.geo_required && userLocation && centreConfig?.geo_enabled) {
      if (centreConfig.latitude && centreConfig.longitude) {
        const dist = getDistanceMetres(userLocation.lat, userLocation.lng, centreConfig.latitude, centreConfig.longitude)
        if (dist > (centreConfig.geo_radius || 200)) {
          setPopupState({ type: 'geo_fail', sewadar: found, message: `${Math.round(dist)}m away`, badge: b })
          setProcessing(false); return
        }
      }
    }

    // Block ineligible badge statuses — only Open, Permanent, Elderly allowed
    const ALLOWED_STATUSES = ['open', 'permanent', 'elderly']
    const badgeStatus = (found.badge_status || '').toLowerCase().trim()
    if (!ALLOWED_STATUSES.includes(badgeStatus)) {
      setPopupState({ type: 'invalid_status', sewadar: found, badge: b }); setProcessing(false); return
    }

    if (!isAso && !isCentreUserRole && !isSameCentre && !isException) {
      setPopupState({ type: 'auth_fail', sewadar: found, badge: b }); setProcessing(false); return
    }
    if (!isAso && !isCentreUserRole && !isSameCentre && isException) {
      setPopupState({ type: 'exception_confirm', sewadar: found, badge: b, allowedTypes, scanCount }); setProcessing(false); return
    }

    setPopupState({ type: 'found', sewadar: found, badge: b, allowedTypes, scanCount })
    setProcessing(false)
  }

  const markAttendance = async (type, overrideNote = null) => {
    if (!popupState?.sewadar || !profile) return
    const scanTime = new Date().toISOString()
    const record = {
      badge_number: popupState.sewadar.badge_number,
      sewadar_name: popupState.sewadar.sewadar_name,
      centre: popupState.sewadar.centre,
      department: popupState.sewadar.department,
      type, scan_time: scanTime,
      scanner_badge: profile.badge_number || 'UNKNOWN',
      scanner_name: profile.name || 'Unknown',
      scanner_centre: profile.centre || 'UNKNOWN',
      latitude: userLocation?.lat || null,
      longitude: userLocation?.lng || null,
      device_id: navigator.userAgent.slice(0, 50),
    }
    // Show success immediately
    playBeep(type)
    // Optimistically prepend to recent scans feed (DB write is fire-and-forget)
    setRecentScans(prev => [{
      id: Date.now(), badge_number: record.badge_number,
      sewadar_name: record.sewadar_name, type, scan_time: scanTime,
      centre: record.centre, scanner_centre: record.scanner_centre
    }, ...prev].slice(0, 5))
    setPopupState({ type: 'success', sewadar: popupState.sewadar, attendanceType: type, time: scanTime })
    setTimeout(closePopup, 1200)

    // FIX #4: fire-and-forget with offline fallback on failure
    if (isOnline) {
      supabase.from('attendance').insert(record).then(({ error }) => {
        if (error) { console.warn('Insert failed, saving offline:', error.message); addToOfflineQueue(record) }
        else { fetchTodayCount(); fetchRecentScans() }
      })
      supabase.from('logs').insert({
        user_badge: profile.badge_number,
        action: overrideNote ? 'MARK_ATTENDANCE_OVERRIDE' : 'MARK_ATTENDANCE',
        details: `${type} for ${popupState.sewadar.badge_number}${overrideNote ? ` [${overrideNote}]` : ''}`,
        timestamp: scanTime
      })
    } else {
      addToOfflineQueue(record)
    }
  }

  const closePopup = () => {
    setPopupState(null)
    lastScanRef.current = { badge: null, time: 0 }
    if (scannerRef.current) scannerRef.current.resume()
  }

  const isAso = profile?.role === ROLES.ASO

  return (
    <div className="page pb-nav">
      <div className="scanner-status-bar">
        <span className="scanner-centre-name">
          {profile?.centre}
        </span>
        <div className="scanner-indicators">
          {pendingSync > 0 && (
            <button className="scanner-pill pill-pending" onClick={handleManualSync} disabled={!isOnline || syncing} title="Tap to sync offline records">
              {syncing ? <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Activity size={11} />}
              {pendingSync} pending
            </button>
          )}
          <span className={`scanner-pill ${isOnline ? 'pill-online' : 'pill-offline'}`}>
            {isOnline ? <Wifi size={11} /> : <WifiOff size={11} />}
            {isOnline ? 'Online' : 'Offline'}
          </span>
          <span
            className={`scanner-pill ${gpsStatus === 'success' ? 'pill-gps-ok' : gpsStatus === 'failed' ? 'pill-gps-fail' : 'pill-gps-loading'}`}
            onClick={gpsStatus === 'failed' ? () => { setGpsStatus('loading'); navigator.geolocation?.getCurrentPosition(p => { setUserLocation({ lat: p.coords.latitude, lng: p.coords.longitude }); setGpsStatus('success') }, () => setGpsStatus('failed'), { enableHighAccuracy: true, timeout: 15000 }) } : undefined}
            style={gpsStatus === 'failed' ? { cursor: 'pointer' } : {}}
          >
            <MapPin size={11} />
            GPS {gpsStatus === 'success' ? '✓' : gpsStatus === 'failed' ? '✗' : '…'}
          </span>
          {(() => { const age = getCacheAge(); return age !== null ? (
            <span className="scanner-pill pill-gps-ok" title="Sewadar data cache age">
              ⚡ {age === 0 ? 'fresh' : `${age}m`}
            </span>
          ) : null })()}
        </div>
      </div>

      <div className="scanner-live-strip">
        <span className="pulse-dot green" />
        <span className="scanner-live-count">{todayCount} IN today</span>
        {(isAso || profile?.role === ROLES.CENTRE_USER) && (
          <button className="scanner-manual-btn" onClick={() => setManualModal(true)}>
            <PenLine size={13} /> Manual
          </button>
        )}
      </div>

      {/* Live centre stats */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.45rem 0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Inside Now</span>
          <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--green)' }}>{liveStats.total}</span>
        </div>
        <div style={{ flex: 1, background: 'rgba(33,100,200,0.07)', border: '1px solid rgba(33,100,200,0.18)', borderRadius: 8, padding: '0.45rem 0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--blue)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Male</span>
          <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--blue)' }}>{liveStats.male}</span>
        </div>
        <div style={{ flex: 1, background: 'rgba(220,80,120,0.07)', border: '1px solid rgba(220,80,120,0.18)', borderRadius: 8, padding: '0.45rem 0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.72rem', color: '#dc5078', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Female</span>
          <span style={{ fontSize: '1.1rem', fontWeight: 800, color: '#dc5078' }}>{liveStats.female}</span>
        </div>
      </div>

      <BarcodeScanner ref={scannerRef} onScan={handleScan} />

      {/* Last 5 scans mini feed */}
      {recentScans.length > 0 && (
        <div style={{ margin: '0.85rem 0 0', padding: '0 0.1rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.45rem' }}>Recent Scans</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {recentScans.map((r, i) => (
              <div key={r.id || i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.4rem 0.7rem' }}>
                <span style={{ width: 32, height: 20, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', fontWeight: 800, background: r.type === 'IN' ? 'rgba(76,175,125,0.15)' : 'rgba(224,92,92,0.15)', color: r.type === 'IN' ? 'var(--green)' : 'var(--red)', flexShrink: 0 }}>{r.type}</span>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sewadar_name}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: 'var(--gold)' }}>{r.badge_number}</div>
                </div>
                <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                  {new Date(r.scan_time || r.queued_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
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

      {popupState && (
        <div className="popup-overlay" onClick={closePopup}>
          <div className="popup-card" onClick={e => e.stopPropagation()}>

            {popupState.type === 'found' && (
              <SewadarFoundCard sewadar={popupState.sewadar} allowedTypes={popupState.allowedTypes}
                scanCount={popupState.scanCount} onMark={markAttendance} onClose={closePopup} />
            )}

            {popupState.type === 'exception_confirm' && (
              <div className="popup-exception">
                <div className="popup-exception-banner"><AlertTriangle size={18} /><span>Sewadar from another centre</span></div>
                <div className="popup-exception-name">{popupState.sewadar.sewadar_name}</div>
                <div className="popup-exception-badge">{popupState.sewadar.badge_number}</div>
                <div className="popup-exception-detail"><span>Centre</span><strong>{popupState.sewadar.centre}</strong></div>
                <div className="popup-exception-detail"><span>Dept</span><strong>{popupState.sewadar.department}</strong></div>
                <p className="popup-exception-note">Exception department. Confirm to mark attendance here.</p>
                <div className="popup-actions">
                  {popupState.allowedTypes?.includes('IN') && <button className="btn-in" onClick={() => markAttendance('IN')}>IN</button>}
                  {popupState.allowedTypes?.includes('OUT') && <button className="btn-out" onClick={() => markAttendance('OUT')}>OUT</button>}
                </div>
                <button className="btn-cancel" onClick={closePopup}>Cancel</button>
              </div>
            )}

            {popupState.type === 'recent' && (
              <RecentPopup popupState={popupState} onOverride={(t) => markAttendance(t, 'duplicate_override')} onClose={closePopup} isAso={isAso} />
            )}

            {popupState.type === 'not_found' && (
              <div className="popup-error">
                <XCircle size={32} color="#dc2626" style={{ margin: '0 auto 12px', display: 'block' }} />
                <div className="error-title">Badge Not Found</div>
                <div className="error-badge">{popupState.badge}</div>
                <div className="error-msg">This badge is not registered in the system</div>
                <button className="btn-cancel" onClick={closePopup}>Try Again</button>
              </div>
            )}

            {popupState.type === 'invalid_status' && (
              <div className="popup-error">
                <XCircle size={32} color="#dc2626" style={{ margin: '0 auto 12px', display: 'block' }} />
                <div className="error-title">Badge Ineligible</div>
                <div className="error-name">{popupState.sewadar.sewadar_name}</div>
                <div className="error-badge">{popupState.badge}</div>
                <div style={{ margin: '8px auto', display: 'inline-block', background: 'rgba(198,40,40,0.1)', border: '1px solid rgba(198,40,40,0.3)', borderRadius: 6, padding: '3px 12px', fontSize: 13, fontWeight: 700, color: '#dc2626' }}>
                  Status: {popupState.sewadar.badge_status || 'Unknown'}
                </div>
                <div className="error-msg">Only Open, Permanent &amp; Elderly badges can be marked</div>
                <button className="btn-cancel" onClick={closePopup}>Dismiss</button>
              </div>
            )}

            {popupState.type === 'auth_fail' && (
              <div className="popup-error">
                <XCircle size={32} color="#dc2626" style={{ margin: '0 auto 12px', display: 'block' }} />
                <div className="error-title">Not Authorised</div>
                <div className="error-name">{popupState.sewadar.sewadar_name}</div>
                <div className="error-msg">{popupState.sewadar.centre} — Different centre</div>
                <button className="btn-cancel" onClick={closePopup}>Try Another</button>
              </div>
            )}

            {popupState.type === 'geo_fail' && (
              <div className="popup-error">
                <MapPin size={32} color="#dc2626" style={{ margin: '0 auto 12px', display: 'block' }} />
                <div className="error-title">Outside Area</div>
                <div className="error-msg">{popupState.message} from centre</div>
                <div className="error-hint">Move closer and try again</div>
                <button className="btn-cancel" onClick={closePopup}>Try Again</button>
              </div>
            )}

            {popupState.type === 'success' && (
              <div className="popup-success">
                <div className={`success-icon-ring ${popupState.attendanceType === 'IN' ? 'ring-green' : 'ring-red'}`}>
                  <CheckCircle size={36} color={popupState.attendanceType === 'IN' ? '#16a34a' : '#dc2626'} />
                </div>
                <div className="success-title" style={{ color: popupState.attendanceType === 'IN' ? '#16a34a' : '#dc2626' }}>
                  {popupState.attendanceType}
                </div>
                <div className="success-name">{popupState.sewadar.sewadar_name}</div>
                <div className="success-type">
                  {new Date(popupState.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            )}

            {popupState.type === 'error' && (
              <div className="popup-error">
                <div className="error-title">Error</div>
                <div className="error-msg">Something went wrong. Please try again.</div>
                <button className="btn-cancel" onClick={closePopup}>Try Again</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Manual entry modal — super_admin only */}
      {manualModal && (
        <div className="overlay" onClick={() => setManualModal(false)}>
          <div className="overlay-sheet" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 style={{ fontFamily: 'Cinzel, serif', color: 'var(--gold)', fontSize: '1rem' }}>Manual Entry</h3>
              <button onClick={() => setManualModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.3rem', lineHeight: 1 }}>×</button>
            </div>
            <input
              type="text" placeholder="Search by name or badge…" value={manualSearch} autoFocus
              onChange={e => { setManualSearch(e.target.value); searchSewadars(e.target.value) }}
              className="input" style={{ width: '100%', marginBottom: '0.75rem' }}
            />
            {manualSearching && <div className="spinner" style={{ margin: '1rem auto' }} />}
            <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
              {manualResults.map(s => (
                <button key={s.badge_number} onClick={() => selectManualSewadar(s)}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', padding: '0.7rem 0.85rem', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{s.sewadar_name}</div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{s.centre} · {s.department || '—'}</div>
                  </div>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--gold)' }}>{s.badge_number}</span>
                </button>
              ))}
              {manualSearch.length >= 2 && !manualSearching && manualResults.length === 0 && (
                <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', padding: '1rem 0' }}>No sewadars found</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SewadarFoundCard({ sewadar, allowedTypes, scanCount, onMark, onClose }) {
  return (
    <>
      <div className="popup-header">
        <div className="sewadar-info">
          <div className="name">{sewadar.sewadar_name}</div>
          <div className="badge" style={{ fontFamily: 'monospace', fontSize: 13, color: '#6b7280' }}>{sewadar.badge_number}</div>
        </div>
        <span className={`gender-badge ${sewadar.gender?.toUpperCase() === 'MALE' ? 'male' : 'female'}`}>{sewadar.gender}</span>
      </div>
      <div className="popup-details">
        <div className="detail"><span>Centre</span><span>{sewadar.centre}</span></div>
        <div className="detail"><span>Dept</span><span>{sewadar.department || '—'}</span></div>
        <div className="detail">
          <span>Status</span>
          <span style={{
            background: (() => { const s = (sewadar.badge_status||'').toLowerCase(); return s==='permanent'?'rgba(33,115,70,0.12)':s==='open'?'rgba(33,100,200,0.12)':s==='elderly'?'rgba(201,168,76,0.15)':'rgba(198,40,40,0.1)' })(),
            color: (() => { const s = (sewadar.badge_status||'').toLowerCase(); return s==='permanent'?'var(--green)':s==='open'?'var(--blue)':s==='elderly'?'var(--gold)':'var(--red)' })(),
            border: '1px solid currentColor', borderRadius: 5, padding: '1px 8px',
            fontSize: 12, fontWeight: 700, opacity: 0.9
          }}>
            {sewadar.badge_status || 'Unknown'}
          </span>
        </div>
      </div>
      {scanCount > 0 && (
        <div className="popup-scan-history">
          {Array.from({ length: scanCount }).map((_, i) => (
            <span key={i} className={`scan-dot ${i % 2 === 0 ? 'dot-in' : 'dot-out'}`} />
          ))}
          <span className="scan-history-label">
            {scanCount} scan{scanCount !== 1 ? 's' : ''} today · next: {allowedTypes[0]}
          </span>
        </div>
      )}
      <div className="popup-actions">
        {allowedTypes?.includes('IN') && <button className="btn-in" onClick={() => onMark('IN')}>IN</button>}
        {allowedTypes?.includes('OUT') && <button className="btn-out" onClick={() => onMark('OUT')}>OUT</button>}
      </div>
      <button className="btn-cancel" onClick={onClose}>Cancel</button>
    </>
  )
}

function RecentPopup({ popupState, onOverride, onClose, isAso }) {
  const last = popupState.todayEntries?.length > 0 ? popupState.todayEntries[popupState.todayEntries.length - 1] : null
  const overrideTypes = last ? (last.type === 'IN' ? ['OUT'] : ['IN']) : ['IN', 'OUT']
  return (
    <div className="popup-recent">
      <div className="popup-recent-icon"><Clock size={28} color="#b45309" /></div>
      <div className="recent-name">{popupState.sewadar.sewadar_name}</div>
      <div className="recent-badge">{popupState.sewadar.badge_number}</div>
      <div className="recent-entry">
        <span className={popupState.lastEntry.type === 'IN' ? 'text-green' : 'text-red'}>{popupState.lastEntry.type}</span>
        <span>{new Date(popupState.lastEntry.scan_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      <div className="recent-msg">Scanned within 2 minutes</div>
      {isAso && (
        <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textAlign: 'center' }}>ASO Override</p>
          <div className="popup-actions" style={{ marginTop: 0 }}>
            {overrideTypes.includes('IN') && <button className="btn-in" style={{ fontSize: '0.85rem' }} onClick={() => onOverride('IN')}>Force IN</button>}
            {overrideTypes.includes('OUT') && <button className="btn-out" style={{ fontSize: '0.85rem' }} onClick={() => onOverride('OUT')}>Force OUT</button>}
          </div>
        </div>
      )}
      <button className="btn-cancel" onClick={onClose} style={{ marginTop: '0.5rem' }}>Dismiss</button>
    </div>
  )
}