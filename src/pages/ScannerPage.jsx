import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, getDistanceMetres, ROLES, isExceptionDept } from '../lib/supabase'
import {
  lookupBadgeOffline, addToAttendanceCache, addToOfflineQueue,
  getOfflineQueueCount, syncOfflineQueue, getAttendanceCache,
  getCacheAge, getTodayEntriesForBadge, checkDuplicateInCache, checkDuplicateInOfflineQueue
} from '../lib/offline'
import { useAuth } from '../context/AuthContext'
import BarcodeScanner from '../components/scanner/BarcodeScanner'
import { Wifi, WifiOff, MapPin, AlertTriangle, CheckCircle, XCircle, Clock, RefreshCw, Activity, PenLine, Map } from 'lucide-react'
import { showSuccess, showError, showInfo } from '../components/Toast'

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
  const [manualModal, setManualModal] = useState(false)
  const soundEnabled = localStorage.getItem('sa_sound') !== 'false'

  const scannerRef = useRef(null)
  const lastScanRef = useRef({ badge: null, time: 0 })
  const watchIdRef = useRef(null)
  const audioCtxRef = useRef(null)

  const isAso = profile?.role === ROLES.ASO
  const isCentreUser = profile?.role === ROLES.CENTRE_USER

  // Load centre config + child centres
  useEffect(() => {
    if (!profile?.centre) return
    Promise.all([
      supabase.from('centres').select('latitude,longitude,geo_radius,geo_enabled').eq('centre_name', profile.centre).maybeSingle(),
      supabase.from('centres').select('centre_name').eq('parent_centre', profile.centre)
    ]    ).then(([centreRes, childRes]) => {
      setCentreConfig(centreRes.data)
      setChildCentres(childRes.data?.map(c => c.centre_name) || [])
    }).catch(e => console.warn('Failed to load centre config:', e))
  }, [profile?.centre])

  // GPS watch
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

  // Live IN count — centre filter for CENTRE_USER too
  useEffect(() => {
    fetchTodayCount().catch(console.error)
    const channel = supabase.channel('scanner-count')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance' }, () => fetchTodayCount().catch(console.error))
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [profile?.centre, profile?.role])

  async function fetchTodayCount() {
    // Use UTC start of today for consistency with DB timestamps
    const today = new Date()
    const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0))
    let q = supabase.from('attendance').select('id', { count: 'exact', head: true })
      .gte('scan_time', todayUTC.toISOString()).eq('type', 'IN')

    if (profile?.role === ROLES.SC_SP_USER && profile?.centre) {
      q = q.eq('centre', profile.centre)
    } else if (profile?.role === ROLES.CENTRE_USER && profile?.centre) {
      const scope = [profile.centre, ...childCentres]
      q = q.in('centre', scope)
    }

    const { data, count, error } = await q
    if (!error) setTodayCount(count || 0)
  }

  // Offline queue + recent scans
  useEffect(() => {
    setPendingSync(getOfflineQueueCount())
    const id = setInterval(() => setPendingSync(getOfflineQueueCount()), 5000)
    setRecentScans(getAttendanceCache().slice(0, 5))
    return () => clearInterval(id)
  }, [])

  async function handleManualSync() {
    if (!isOnline) { showInfo('Cannot sync while offline'); return }
    setSyncing(true)
    await syncOfflineQueue(supabase)
    setPendingSync(getOfflineQueueCount())
    setSyncing(false)
    fetchTodayCount()
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
    } catch (e) { console.warn('Beep failed:', e) }
    if (navigator.vibrate) navigator.vibrate(type === 'IN' ? [40] : [40, 30, 40])
  }

  // Ladder logic
  function computeAllowedTypes(todayEntries) {
    if (!todayEntries || todayEntries.length === 0) return ['IN']
    const last = todayEntries[todayEntries.length - 1]
    return last.type === 'IN' ? ['OUT'] : ['IN']
  }

  // FIX #7: Complete dependency array for handleScan
  // busyRef prevents any new scan from being processed while a popup is open
  // or while an existing scan is in-flight. Using a ref avoids stale closure issues.
  const busyRef = useRef(false)

  const handleScan = useCallback(async (badge) => {
    // Drop scan immediately if popup is open or scan is in-flight
    if (busyRef.current) return

    const now = Date.now()
    // Also debounce exact same badge within 2 seconds
    if (badge === lastScanRef.current.badge && now - lastScanRef.current.time < 2000) return

    busyRef.current = true
    lastScanRef.current = { badge, time: now }
    setProcessing(true)

    let found = null
    try {
      if (isOnline) {
        const { data, error } = await supabase.from('sewadars').select('*').eq('badge_number', badge).maybeSingle()
        if (error) throw error
        found = data
      } else {
        found = lookupBadgeOffline(badge)
      }
    } catch (e) { console.warn('Sewadar lookup failed:', e) }

    if (!found) {
      setPopupState({ type: 'not_found', badge })
      setProcessing(false)
      // busyRef stays true — popup is now open, block further scans
      return
    }

    await processSewadar(found, badge)
  }, [isOnline, profile, userLocation, centreConfig, childCentres, isAso, isCentreUser])

  async function processSewadar(found, badge) {
    const now = Date.now()
    setProcessing(true)
    const b = badge || found.badge_number

    let todayEntries = []
    if (isOnline) {
      // Use UTC start of today for consistency with DB timestamps
      const today = new Date()
      const todayUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0))
      let q = supabase.from('attendance').select('*').eq('badge_number', b)
        .gte('scan_time', todayUTC.toISOString()).order('scan_time', { ascending: true })

      // Exception-dept sewadars travel cross-centre — their attendance is always stored
      // under their HOME centre. Query by their centre, not the scanner's centre,
      // so IN/OUT ladder works correctly regardless of where they're scanned.
      const isExceptionSewadar = isExceptionDept(found.department)

      if (isExceptionSewadar) {
        // No centre filter — query all of today's records for this badge across all centres
        // (they could have been scanned IN at one centre and OUT at another)
      } else if (profile?.role === ROLES.SC_SP_USER && profile?.centre) {
        q = q.eq('centre', profile.centre)
      } else if (profile?.role === ROLES.CENTRE_USER && profile?.centre) {
        const scope = [profile.centre, ...childCentres]
        q = q.in('centre', scope)
      }

      const { data, error } = await q
      if (!error) todayEntries = data || []
    } else {
      // Offline mode — cache holds all of today's entries regardless of centre
      todayEntries = getTodayEntriesForBadge(b)
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
    const isSameCentre = found.centre === profile?.centre
    const isChildCentre = isCentreUser && childCentres.includes(found.centre)
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

    const ALLOWED_STATUSES = ['open', 'permanent', 'elderly']
    const badgeStatus = (found.badge_status || '').toLowerCase().trim()
    if (!ALLOWED_STATUSES.includes(badgeStatus)) {
      setPopupState({ type: 'invalid_status', sewadar: found, badge: b }); setProcessing(false); return
    }

    // Authorization scope check
    const scopeCentres = [profile?.centre, ...childCentres]
    const inScope = scopeCentres.includes(found.centre)

    // 1. Exception dept sewadar — always show confirmation, even if in scope
    if (isException) {
      setPopupState({ type: 'exception_confirm', sewadar: found, badge: b, allowedTypes, scanCount })
    }
    // 2. ASO — unrestricted
    else if (isAso) {
      setPopupState({ type: 'found', sewadar: found, badge: b, allowedTypes, scanCount })
    }
    // 3. Centre User — scoped to own + child centres
    else if (isCentreUser) {
      if (inScope) {
        setPopupState({ type: 'found', sewadar: found, badge: b, allowedTypes, scanCount })
      } else {
        setPopupState({ type: 'auth_fail', sewadar: found, badge: b, message: `${found.centre} — not in your scope` }); setProcessing(false); return
      }
    }
    // 4. SC_SP User — scoped to own centre only
    else if (isSameCentre) {
      setPopupState({ type: 'found', sewadar: found, badge: b, allowedTypes, scanCount })
    }
    // 5. Out of scope / not authorised
    else {
      setPopupState({ type: 'auth_fail', sewadar: found, badge: b }); setProcessing(false); return
    }
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
      manual_entry: false,
      submitted_by: profile.badge_number || 'UNKNOWN',
      submitted_at: scanTime,
    }

    addToAttendanceCache({ ...record, id: Date.now() })
    setRecentScans(getAttendanceCache().slice(0, 5))
    playBeep(type)
    setPopupState({ type: 'success', sewadar: popupState.sewadar, attendanceType: type, time: scanTime })
    setTimeout(closePopup, 1200)

    if (isOnline) {
      supabase.from('attendance').insert(record).then(({ error }) => {
        if (error) {
          console.warn('Insert failed, saving offline:', error.message)
          addToOfflineQueue(record)
          setPendingSync(getOfflineQueueCount())
          showInfo('Saved offline — will sync when connection returns')
        }
      })
      supabase.from('logs').insert({
        user_badge: profile.badge_number,
        action: overrideNote ? 'MARK_ATTENDANCE_OVERRIDE' : 'MARK_ATTENDANCE',
        details: `${type} for ${popupState.sewadar.badge_number}${overrideNote ? ` [${overrideNote}]` : ''}`,
        timestamp: scanTime,
        device_id: navigator.userAgent.slice(0, 50),
      }).catch(e => console.warn('Log insert failed:', e))
      fetchTodayCount()
    } else {
      addToOfflineQueue(record)
      setPendingSync(getOfflineQueueCount())
      showInfo('Saved offline — will sync when connection returns')
    }
  }

  const closePopup = () => {
    setPopupState(null)
    lastScanRef.current = { badge: null, time: 0 }
    busyRef.current = false   // unblock scanner for next badge
    if (scannerRef.current) scannerRef.current.resume()
  }

  return (
    <div className="page pb-nav">
      <div className="scanner-status-bar">
        <span className="scanner-centre-name">{profile?.centre}</span>
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
            onClick={gpsStatus === 'failed' ? () => {
              setGpsStatus('loading')
              navigator.geolocation?.getCurrentPosition(
                p => { setUserLocation({ lat: p.coords.latitude, lng: p.coords.longitude }); setGpsStatus('success') },
                () => setGpsStatus('failed'),
                { enableHighAccuracy: true, timeout: 15000 }
              )
            } : undefined}
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
        {(isAso || isCentreUser) && (
          <button className="scanner-manual-btn" onClick={() => setManualModal(true)}>
            <PenLine size={13} /> Manual Entry
          </button>
        )}
      </div>

      <BarcodeScanner ref={scannerRef} onScan={handleScan} />

      {recentScans.length > 0 && (
        <div style={{ margin: '0.85rem 0 0', padding: '0 0.1rem' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: '0.45rem' }}>Recent Scans</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
            {recentScans.map((r, i) => (
              <div key={r.id || i} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.4rem 0.7rem' }}>
                <span style={{ width: 32, height: 20, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.68rem', fontWeight: 800, background: r.type === 'IN' ? 'rgba(76,175,125,0.15)' : 'rgba(224,92,92,0.15)', color: r.type === 'IN' ? 'var(--green)' : 'var(--red)', flexShrink: 0 }}>{r.type}</span>
                <span style={{ fontWeight: 600, fontSize: '0.82rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sewadar_name}</span>
                <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                  {new Date(r.scan_time || r.queued_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </span>
                {r.manual_entry && (
                  <span style={{ fontSize: '0.6rem', background: 'var(--gold-bg)', color: 'var(--gold)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 999, padding: '1px 5px', fontWeight: 700 }}>M</span>
                )}
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
              <SewadarFoundCard
                sewadar={popupState.sewadar}
                allowedTypes={popupState.allowedTypes}
                scanCount={popupState.scanCount}
                onMark={markAttendance}
                onClose={closePopup}
              />
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
              <RecentPopup
                popupState={popupState}
                onOverride={(t) => markAttendance(t, 'duplicate_override')}
                onClose={closePopup}
                isAso={isAso}
              />
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
                <div className="error-msg">{popupState.message || `${popupState.sewadar.centre} — Different centre`}</div>
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

            {popupState.type === 'manual_success' && (
              <div className="popup-success">
                <div className={`success-icon-ring ${popupState.attendanceType === 'IN' ? 'ring-green' : 'ring-red'}`}>
                  <CheckCircle size={36} color={popupState.attendanceType === 'IN' ? '#16a34a' : '#dc2626'} />
                </div>
                <div className="success-title" style={{ color: popupState.attendanceType === 'IN' ? '#16a34a' : '#dc2626' }}>
                  {popupState.attendanceType} — Recorded
                </div>
                <div className="success-name">{popupState.sewadar.sewadar_name}</div>
                <div style={{ fontSize: '0.72rem', background: 'rgba(201,168,76,0.15)', color: 'var(--gold)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 6, padding: '2px 10px', fontWeight: 700, marginTop: '0.35rem', display: 'inline-block' }}>MANUAL ENTRY</div>
                <div className="success-type">
                  {new Date(popupState.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </div>
                <button className="btn-cancel" onClick={closePopup} style={{ marginTop: '1rem' }}>Dismiss</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Manual Entry Modal — Centre Admins + ASO */}
      {manualModal && (
        <ManualEntryModal
          profile={profile}
          isOnline={isOnline}
          childCentres={childCentres}
          onClose={() => setManualModal(false)}
          onSuccess={(record) => {
            setManualModal(false)
            playBeep(record.type)
            setPopupState({ type: 'manual_success', sewadar: { badge_number: record.badge_number, sewadar_name: record.sewadar_name }, attendanceType: record.type, time: record.scan_time })
            fetchTodayCount()
            setRecentScans(getAttendanceCache().slice(0, 5))
            // Longer timeout for manual entries so user can clearly see confirmation
            setTimeout(closePopup, 3000)
          }}
        />
      )}
    </div>
  )
}

function SewadarFoundCard({ sewadar, allowedTypes, scanCount, onMark, onClose }) {
  const statusStyle = (s) => {
    const status = (s || '').toLowerCase()
    if (status === 'permanent') return { bg: 'rgba(33,115,70,0.12)', color: 'var(--green)' }
    if (status === 'open') return { bg: 'rgba(37,99,235,0.12)', color: 'var(--blue)' }
    if (status === 'elderly') return { bg: 'rgba(201,168,76,0.15)', color: 'var(--gold)' }
    return { bg: 'rgba(198,40,40,0.1)', color: 'var(--red)' }
  }
  const st = statusStyle(sewadar.badge_status)

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
          <span style={{ background: st.bg, color: st.color, border: '1px solid currentColor', borderRadius: 5, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>
            {sewadar.badge_status || 'Unknown'}
          </span>
        </div>
      </div>
      {scanCount > 0 && (
        <div className="popup-scan-history">
          {Array.from({ length: Math.min(scanCount, 20) }).map((_, i) => (
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

// ─────────────────────────────────────────────
//  MANUAL ENTRY MODAL — Centre Admin + ASO
// ─────────────────────────────────────────────
function ManualEntryModal({ profile, isOnline, childCentres, onClose, onSuccess }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState(null)
  const [attendanceType, setAttendanceType] = useState('IN')
  const [scanDate, setScanDate] = useState(new Date().toISOString().split('T')[0])
  const [scanTime, setScanTime] = useState(() => {
    const now = new Date()
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  })
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const searchRef = useRef(null)

  useEffect(() => { searchRef.current?.focus() }, [])

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (search.length < 2) { setResults([]); return }
      setSearching(true)
      try {
        let q = supabase.from('sewadars')
          .select('*')
          .or(`badge_number.ilike.%${search.toUpperCase()}%,sewadar_name.ilike.%${search}%`)
          .limit(10)

        if (profile.role === 'sc_sp_user') q = q.eq('centre', profile.centre)
        else if (profile.role === 'centre_user') {
          const scope = [profile.centre, ...childCentres]
          q = q.in('centre', scope)
        }

        const { data } = await q
        setResults(data || [])
      } catch (e) { setResults([]) }
      setSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [search, profile, childCentres])

  const canSubmit = selected && remark.trim().length >= 3

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError('')

    const scanTimeISO = new Date(`${scanDate}T${scanTime}:00`).toISOString()
    const record = {
      badge_number: selected.badge_number,
      sewadar_name: selected.sewadar_name,
      centre: selected.centre,
      department: selected.department || null,
      type: attendanceType,
      scan_time: scanTimeISO,
      scanner_badge: profile.badge_number,
      scanner_name: profile.name,
      scanner_centre: profile.centre,
      device_id: navigator.userAgent.slice(0, 50),
      manual_entry: true,
      submitted_by: profile.badge_number,
      submitted_at: new Date().toISOString(),
    }

    if (isOnline) {
      const { error: dbErr } = await supabase.from('attendance').insert(record)
      if (dbErr) { setError(dbErr.message); setSubmitting(false); return }

      try {
        await supabase.from('logs').insert({
          user_badge: profile.badge_number,
          action: 'MANUAL_ENTRY',
          details: `Manual ${attendanceType} for ${selected.badge_number} — "${remark.trim()}"`,
          timestamp: scanTimeISO,
          device_id: navigator.userAgent.slice(0, 50),
        })
      } catch (e) {
        console.warn('Log insert failed:', e)
      }
    } else {
      addToOfflineQueue(record)
    }

    // Update local cache so recent scans list reflects manual entry immediately
    addToAttendanceCache({ ...record, id: Date.now() })

    setSubmitting(false)
    // Call onSuccess — parent closes modal and shows confirmation popup
    onSuccess(record)
    // Do NOT call onClose() here — onSuccess already handles modal teardown
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-sheet" onClick={e => e.stopPropagation()} style={{ maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <PenLine size={18} color="var(--gold)" />
            <h3 style={{ fontFamily: 'Cinzel, serif', color: 'var(--gold)', fontSize: '1rem', fontWeight: 700 }}>Manual Entry</h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.3rem', lineHeight: 1 }}>×</button>
        </div>

        {/* Badge search */}
        <label className="label">Find Sewadar *</label>
        <div style={{ position: 'relative', marginBottom: '1rem' }}>
          <input
            ref={searchRef}
            type="text"
            placeholder="Search by name or badge number…"
            value={search}
            onChange={e => { setSearch(e.target.value); setSelected(null) }}
            className="input"
            style={{ paddingRight: search ? '2.5rem' : '1rem' }}
          />
          {search && (
            <button onClick={() => { setSearch(''); setResults([]); setSelected(null) }}
              style={{ position: 'absolute', right: '0.85rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
              ×
            </button>
          )}
        </div>

        {searching && <div className="spinner" style={{ margin: '0.5rem auto', width: 28, height: 28 }} />}

        {results.length > 0 && !selected && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '1rem', maxHeight: 200, overflowY: 'auto' }}>
            {results.map(s => (
              <button key={s.badge_number} onClick={() => { setSelected(s); setResults([]); setSearch(s.badge_number) }}
                style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 0.85rem', background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--text-primary)' }}>{s.sewadar_name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.centre} · {s.department || '—'}</div>
                </div>
                <span style={{ fontFamily: 'monospace', fontSize: '0.78rem', color: 'var(--gold)', fontWeight: 700 }}>{s.badge_number}</span>
              </button>
            ))}
          </div>
        )}

        {search.length >= 2 && !searching && results.length === 0 && (
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center', marginBottom: '1rem' }}>No sewadars found</p>
        )}

        {selected && (
          <div style={{ background: 'var(--gold-bg)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: '0.2rem' }}>{selected.sewadar_name}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{selected.badge_number} · {selected.centre} · {selected.department || '—'}</div>
            <button onClick={() => { setSelected(null); setSearch('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.35rem', fontFamily: 'inherit' }}>
              Change
            </button>
          </div>
        )}

        {/* Attendance type */}
        <label className="label">Attendance Type *</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
          {['IN', 'OUT'].map(t => (
            <button key={t} onClick={() => setAttendanceType(t)}
              style={{ padding: '0.65rem', border: `2px solid ${attendanceType === t ? (t === 'IN' ? 'var(--green)' : 'var(--red)') : 'var(--border)'}`, borderRadius: 8, background: attendanceType === t ? (t === 'IN' ? 'var(--green-bg)' : 'var(--red-bg)') : 'white', color: attendanceType === t ? (t === 'IN' ? 'var(--green)' : 'var(--red)') : 'var(--text-secondary)', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'inherit' }}>
              {t}
            </button>
          ))}
        </div>

        {/* Date & Time */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
          <div>
            <label className="label">Date *</label>
            <input type="date" className="input" value={scanDate}
              max={new Date().toISOString().split('T')[0]}
              onChange={e => setScanDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Time *</label>
            <input type="time" className="input" value={scanTime}
              onChange={e => setScanTime(e.target.value)} />
          </div>
        </div>

        {/* Remark — MANDATORY */}
        <label className="label">Reason for Manual Entry * <span style={{ color: 'var(--red)', fontWeight: 700 }}>(Required)</span></label>
        <textarea
          className="input"
          rows={2}
          placeholder="Why is this being entered manually? (e.g. badge lost, scanner error, special case)…"
          value={remark}
          onChange={e => setRemark(e.target.value)}
          style={{ resize: 'none', marginBottom: '0.5rem' }}
        />
        <p style={{ fontSize: '0.72rem', color: remark.trim().length < 3 ? 'var(--text-muted)' : 'var(--green)', marginBottom: '1rem' }}>
          {remark.trim().length < 3 ? 'Minimum 3 characters required' : `✓ ${remark.trim().length} characters`}
        </p>

        {error && (
          <div style={{ background: 'var(--red-bg)', border: '1px solid rgba(198,40,40,0.3)', borderRadius: 8, padding: '0.6rem 0.85rem', color: 'var(--red)', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
            {error}
          </div>
        )}

        {!isOnline && (
          <div style={{ background: 'var(--amber-bg)', border: '1px solid rgba(230,81,0,0.2)', borderRadius: 8, padding: '0.5rem 0.75rem', color: 'var(--amber)', fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.75rem', display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <Map size={13} /> Offline — entry will be saved locally and synced later
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <button className="btn btn-outline btn-full" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-gold btn-full"
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
          >
            {submitting ? 'Saving…' : 'Submit Entry'}
          </button>
        </div>
      </div>
    </div>
  )
}