import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, getDistanceMetres, ROLES, isExceptionDept, DUTY_TYPES } from '../lib/supabase'
import { nowIST, todayDateStr, scanTimeToISTDate } from '../lib/dateUtils'
import { useAuth } from '../context/AuthContext'
import BarcodeScanner from '../components/scanner/BarcodeScanner'
import { MapPin, AlertTriangle, CheckCircle, XCircle, Clock, PenLine, Moon } from 'lucide-react'
import { showError, showInfo } from '../components/Toast'
import {
  evaluateScan,
  executeScan,
  computeDutyType,
  isLateNightScan,
  getSessionsForDate,
  getOpenSession,
  formatDuration,
  asoForceCloseSession,
  executeStandaloneOut,
} from '../lib/sessionLogic'

export default function ScannerPage() {
  const { profile } = useAuth()
  const [userLocation, setUserLocation] = useState(null)
  const [centreConfig, setCentreConfig] = useState(null)
  const [childCentres, setChildCentres] = useState([])
  const [gpsStatus, setGpsStatus] = useState('loading')
  const [popupState, setPopupState] = useState(null)
  const busyRef = useRef(false)
  const [processing, setProcessing] = useState(false)
  const [todayCount, setTodayCount] = useState(0)
  const [recentScans, setRecentScans] = useState([])
  const [manualModal, setManualModal] = useState(false)
  const [watchWardConfirm, setWatchWardConfirm] = useState(null)
  const soundEnabled = localStorage.getItem('sa_sound') !== 'false'

  const scannerRef = useRef(null)
  const lastScanRef = useRef({ badge: null, time: 0 })
  const watchIdRef = useRef(null)
  const audioCtxRef = useRef(null)
  const childCentresRef = useRef([])
  const pendingScanRef = useRef(null)

  const isAso = profile?.role === ROLES.ASO
  const isCentreUser = profile?.role === ROLES.CENTRE

  useEffect(() => {
    if (!profile?.centre) return
    Promise.all([
      supabase.from('centres').select('latitude,longitude,geo_radius,geo_enabled').eq('centre_name', profile.centre).maybeSingle(),
      supabase.from('centres').select('centre_name').eq('parent_centre', profile.centre)
    ]).then(([centreRes, childRes]) => {
      setCentreConfig(centreRes.data)
      const children = childRes.data?.map(c => c.centre_name) || []
      setChildCentres(children)
      childCentresRef.current = children
    }).catch(e => console.warn('Failed to load centre config:', e))
  }, [profile?.centre])

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

  useEffect(() => {
    fetchTodayCount().catch(console.error)
    const channel = supabase.channel('scanner-count')
      .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'attendance',
      }, () => fetchTodayCount().catch(console.error))
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [profile?.centre, profile?.role])

  async function fetchTodayCount() {
    const today = todayDateStr()
    const start = `${today}T00:00:00+05:30`
    let q = supabase.from('attendance_sessions').select('id', { count: 'exact', head: true })
      .gte('in_time', start)
      .eq('is_open', true)

    if (profile?.role === ROLES.CENTRE && profile?.centre) {
      const scope = [profile.centre, ...childCentresRef.current]
      q = q.in('centre', scope)
    }

    const { count, error } = await q
    if (!error) setTodayCount(count || 0)
  }

  async function fetchRecentScans() {
    const today = todayDateStr()
    const start = `${today}T00:00:00+05:30`
    let q = supabase.from('attendance')
      .select('id,badge_number,sewadar_name,type,scan_time,manual_entry')
      .gte('scan_time', start)
      .order('scan_time', { ascending: false })
      .limit(5)

    if (profile?.role === ROLES.CENTRE && profile?.centre) {
      const scope = [profile.centre, ...childCentresRef.current]
      q = q.in('centre', scope)
    }

    const { data } = await q
    if (data) setRecentScans(data)
  }

  useEffect(() => {
    fetchRecentScans().catch(console.error)
  }, [profile?.centre, profile?.role])

  useEffect(() => {
    return () => {
      if (audioCtxRef.current) {
        audioCtxRef.current.close()
        audioCtxRef.current = null
      }
    }
  }, [])

  function playBeep(type) {
    if (!soundEnabled) return
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
      const ctx = audioCtxRef.current
      
      if (type === 'IN') {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.frequency.value = 880
        osc.type = 'sine'
        gain.gain.setValueAtTime(0.3, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15)
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.15)
      } else {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain); gain.connect(ctx.destination)
        osc.frequency.value = 440
        osc.type = 'sine'
        gain.gain.setValueAtTime(0.3, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2)
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.25)
      }
    } catch (e) { console.warn('Beep failed:', e) }
    if (navigator.vibrate) {
      navigator.vibrate(type === 'IN' ? [30] : [30, 50, 30])
    }
  }

  const handleScan = useCallback(async (badge) => {
    if (busyRef.current) return

    const now = Date.now()
    if (now - lastScanRef.current.time < 800) return
    if (badge === lastScanRef.current.badge && now - lastScanRef.current.time < 2000) return

    busyRef.current = true

    setTimeout(() => {
      if (busyRef.current && !popupState) {
        busyRef.current = false
      }
    }, 3000)

    const { profile: userProfile, userLocation: location, centreConfig: cfg } = { profile, userLocation, centreConfig }

    let found = null
    try {
      const { data, error } = await supabase.from('sewadars').select('*').eq('badge_number', badge).maybeSingle()
      if (error) throw error
      found = data
    } catch (e) { console.warn('Sewadar lookup failed:', e) }

    if (!found) {
      setPopupState({ type: 'not_found', badge })
      setProcessing(false)
      return
    }

    // Check badge status
    const ALLOWED_STATUSES = ['open', 'permanent', 'elderly']
    const badgeStatus = (found.badge_status || '').toLowerCase().trim()
    if (!ALLOWED_STATUSES.includes(badgeStatus)) {
      setPopupState({ type: 'invalid_status', sewadar: found, badge })
      setProcessing(false)
      return
    }

    // Check centre scope
    const scopeCentres = [profile?.centre, ...childCentresRef.current]
    const inScope = scopeCentres.includes(found.centre)
    const isException = isExceptionDept(found.department)

    if (!isException && !inScope && !isAso) {
      setPopupState({ type: 'auth_fail', sewadar: found, badge, message: `${found.centre} — not in your scope` })
      setProcessing(false)
      return
    }

    // Geo check
    if (location && cfg?.geo_enabled === true && cfg?.latitude != null && cfg?.longitude != null) {
      const dist = getDistanceMetres(location.lat, location.lng, cfg.latitude, cfg.longitude)
      const radius = cfg.geo_radius || 200
      if (dist > radius) {
        setPopupState({ type: 'geo_fail', sewadar: found, message: `${Math.round(dist)}m away (limit: ${radius}m)`, badge })
        setProcessing(false)
        return
      }
    }

    // Check if late night (Watch & Ward detection)
    const scanTime = nowIST()
    const isLateNight = isLateNightScan(scanTime)

    if (isLateNight) {
      // Store pending scan and ask Watch & Ward confirmation
      pendingScanRef.current = { found, badge: badge, scanTime }
      setWatchWardConfirm({ sewadar: found, badge })
      setProcessing(false)
      busyRef.current = false
      return
    }

    // Proceed with normal evaluation
    await processSewadar(found, badge, scanTime)
  }, [profile, userLocation, centreConfig, childCentres])

  async function handleWatchWardConfirm(isWatchWard) {
    if (!pendingScanRef.current) return
    
    const { found, badge, scanTime } = pendingScanRef.current
    pendingScanRef.current = null
    setWatchWardConfirm(null)
    
    await processSewadar(found, badge, scanTime, isWatchWard)
  }

  async function processSewadar(found, badge, scanTime, watchWardConfirm = false) {
    const scanTimeISO = new Date(scanTime.replace(' ', 'T')).toISOString()
    
    // Evaluate the scan
    const result = await evaluateScan(supabase, {
      badgeNumber: badge,
      type: 'IN', // Default to IN, will update based on session
      scanTimeISO,
      watchWard: watchWardConfirm,
      isAso,
      isCentreUser,
    })

    // Get today's sessions for display
    const today = todayDateStr()
    const todaySessions = await getSessionsForDate(supabase, badge, today)

    // Determine next action based on open session
    const openSession = todaySessions.find(s => s.is_open)
    const nextType = openSession ? 'OUT' : 'IN'

    const geoEnabled = centreConfig?.geo_enabled === true
    const hasGeoCoords = centreConfig?.latitude != null && centreConfig?.longitude != null

    if (result.status === 'blocked') {
      if (result.reason === 'jatha_active') {
        setPopupState({ 
          type: 'jatha_block', 
          sewadar: found, 
          badge, 
          jatha: result.jatha 
        })
        return
      }

      if (result.reason === 'open_session_exists') {
        if (!result.canOverride) {
          // Centre user - hard block
          setPopupState({ 
            type: 'open_session_block', 
            sewadar: found, 
            badge, 
            openSession: result.openSession,
            todaySessions 
          })
        } else {
          // ASO - can override
          setPopupState({ 
            type: 'open_session_override', 
            sewadar: found, 
            badge, 
            openSession: result.openSession,
            todaySessions,
            dutyType: result.dutyType
          })
        }
        return
      }

      if (result.reason === 'no_open_session') {
        if (!result.canOverride) {
          setPopupState({ type: 'no_session_block', sewadar: found, badge, todaySessions })
        } else {
          setPopupState({ type: 'no_session_override', sewadar: found, badge, todaySessions })
        }
        return
      }
    }

    // Allowed - show confirmation
    setPopupState({ 
      type: 'found', 
      sewadar: found, 
      badge, 
      allowedAction: nextType,
      todaySessions,
      dutyType: result.dutyType,
      watchWard: watchWardConfirm,
    })
  }

  const markAttendance = async (type, overrideData = null) => {
    try {
      if (!popupState?.sewadar || !profile) {
        console.warn('markAttendance: no sewadar or profile')
        return
      }

      const scanTime = nowIST()
      const scanTimeISO = new Date(scanTime.replace(' ', 'T')).toISOString()
      const { found, badge, openSession, dutyType, todaySessions } = popupState

      // If override, handle it first
      if (overrideData?.isOverride) {
        const { asobadge, reason, overrideType } = overrideData
        
        if (overrideType === 'force_close_and_new_in') {
          await asoForceCloseSession(supabase, {
            sessionId: openSession.id,
            asobadge,
            reason,
          })
        } else if (overrideType === 'standalone_out') {
          // Create standalone OUT
          await executeStandaloneOut(supabase, {
            badge_number: found.badge_number,
            sewadar_name: found.sewadar_name,
            centre: found.centre,
            department: found.department,
            scanTimeISO,
            scanner_badge: profile.badge_number,
            scanner_name: profile.name,
            scanner_centre: profile.centre,
            latitude: userLocation?.lat || null,
            longitude: userLocation?.lng || null,
            reason,
            asobadge,
          })
          
          playBeep('OUT')
          setPopupState({ type: 'success', sewadar: found, attendanceType: 'OUT', time: scanTime })
          setTimeout(closePopup, 1200)
          fetchTodayCount()
          fetchRecentScans()
          return
        }
      }

      // Get open session for OUT
      let currentOpenSession = null
      if (type === 'OUT') {
        currentOpenSession = await getOpenSession(supabase, found.badge_number)
      }

      // Determine duty type
      const finalDutyType = overrideData?.dutyType || 
        (popupState.watchWard ? DUTY_TYPES.WATCH_WARD : computeDutyType(scanTimeISO, popupState.watchWard))

      // Execute the scan
      const result = await executeScan(supabase, {
        badge_number: found.badge_number,
        sewadar_name: found.sewadar_name,
        centre: found.centre,
        department: found.department,
        type,
        scanTimeISO,
        dutyType: finalDutyType,
        openSession: currentOpenSession,
        scanner_badge: profile.badge_number || 'UNKNOWN',
        scanner_name: profile.name || 'Unknown',
        scanner_centre: profile.centre || 'UNKNOWN',
        latitude: userLocation?.lat || null,
        longitude: userLocation?.lng || null,
        manual_entry: false,
        submitted_by: profile.badge_number || 'UNKNOWN',
      })

      playBeep(type)
      setPopupState({ type: 'success', sewadar: found, attendanceType: type, time: scanTime })
      setTimeout(closePopup, 1200)

      // Log the action
      await supabase.from('logs').insert({
        user_badge: profile.badge_number,
        action: type === 'IN' ? 'MARK_IN' : 'MARK_OUT',
        details: `${type} for ${found.badge_number}`,
        timestamp: scanTimeISO,
        device_id: navigator.userAgent.slice(0, 50),
      }).catch(console.warn)

      fetchTodayCount()
      fetchRecentScans()

    } catch (err) {
      console.error('markAttendance error:', err)
      showError('Error: ' + err.message)
    }
  }

  const closePopup = () => {
    setPopupState(null)
    lastScanRef.current = { badge: null, time: 0 }
    busyRef.current = false
    if (scannerRef.current) scannerRef.current.resume()
  }

  return (
    <div className="page pb-nav">
      <div className="scanner-status-bar">
        <span className="scanner-centre-name">{profile?.centre}</span>
        <div className="scanner-indicators">
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
            GPS {gpsStatus === 'success' ? '✓' : gpsStatus === 'failed' ? '✕' : '…'}
          </span>
          <span className={`scanner-pill ${centreConfig?.geo_enabled ? 'pill-gps-ok' : 'pill-offline'}`} title={centreConfig?.geo_enabled ? `Geo fencing active (${centreConfig?.geo_radius || 200}m radius)` : 'Geo fencing not enabled for this centre'}>
            <MapPin size={11} />
            GEO {centreConfig?.geo_enabled ? 'ON' : 'OFF'}
          </span>
        </div>
      </div>

      <div className="scanner-live-strip">
        <span className="pulse-dot green" />
        <span className="scanner-live-count">{todayCount} inside now</span>
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
                  {new Date(r.scan_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
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

      {/* Watch & Ward Confirmation Popup */}
      {watchWardConfirm && (
        <div className="popup-overlay" onClick={() => { setWatchWardConfirm(null); pendingScanRef.current = null }}>
          <div className="popup-card" onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: 'center', padding: '1rem' }}>
              <div style={{ width: 56, height: 56, background: 'rgba(59,130,246,0.15)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                <Moon size={28} color="#3b82f6" />
              </div>
              <h3 style={{ marginBottom: '0.5rem', color: 'var(--blue)' }}>Late Night Scan</h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>
                It is past 9 PM. Is this a Watch & Ward Sewadar entry?
              </p>
              <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem', marginBottom: '1rem' }}>
                <div style={{ fontWeight: 600 }}>{watchWardConfirm.sewadar.sewadar_name}</div>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{watchWardConfirm.badge}</div>
              </div>
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <button className="btn btn-primary btn-full" onClick={() => handleWatchWardConfirm(true)}>
                  Yes - Watch & Ward
                </button>
                <button className="btn btn-outline btn-full" onClick={() => handleWatchWardConfirm(false)}>
                  No - Regular Entry
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {popupState && (
        <div className="popup-overlay" onClick={closePopup}>
          <div className="popup-card" onClick={e => e.stopPropagation()}>

            {popupState.type === 'found' && (
              <SewadarFoundCard
                sewadar={popupState.sewadar}
                allowedAction={popupState.allowedAction}
                todaySessions={popupState.todaySessions}
                dutyType={popupState.dutyType}
                onMark={markAttendance}
                onClose={closePopup}
              />
            )}

            {popupState.type === 'jatha_block' && (
              <div className="popup-error">
                <AlertTriangle size={32} color="#f59e0b" style={{ margin: '0 auto 12px', display: 'block' }} />
                <div className="error-title">On Jatha Duty</div>
                <div className="error-name">{popupState.sewadar.sewadar_name}</div>
                <div className="error-badge">{popupState.jatha?.jatha_centre}</div>
                <div className="error-msg">
                  Cannot mark attendance. Sewadar is on {popupState.jatha?.jatha_type} from {popupState.jatha?.date_from} to {popupState.jatha?.date_to}
                </div>
                <button className="btn-cancel" onClick={closePopup}>Dismiss</button>
              </div>
            )}

            {popupState.type === 'open_session_block' && (
              <div className="popup-error">
                <AlertTriangle size={32} color="#f59e0b" style={{ margin: '0 auto 12px', display: 'block' }} />
                <div className="error-title">Already Checked In</div>
                <div className="error-name">{popupState.sewadar.sewadar_name}</div>
                <div className="error-msg">
                  Already has an open session. Scan OUT first before a new IN.
                </div>
                <button className="btn-cancel" onClick={closePopup}>Dismiss</button>
              </div>
            )}

            {popupState.type === 'open_session_override' && (
              <OverridePopup
                type="open_session"
                sewadar={popupState.sewadar}
                badge={popupState.badge}
                openSession={popupState.openSession}
                todaySessions={popupState.todaySessions}
                onMark={markAttendance}
                onClose={closePopup}
                isAso={isAso}
                profile={profile}
              />
            )}

            {popupState.type === 'no_session_block' && (
              <div className="popup-error">
                <AlertTriangle size={32} color="#f59e0b" style={{ margin: '0 auto 12px', display: 'block' }} />
                <div className="error-title">Not Checked In</div>
                <div className="error-name">{popupState.sewadar.sewadar_name}</div>
                <div className="error-msg">
                  No open session found. Scan IN first.
                </div>
                <button className="btn-cancel" onClick={closePopup}>Dismiss</button>
              </div>
            )}

            {popupState.type === 'no_session_override' && (
              <OverridePopup
                type="no_session"
                sewadar={popupState.sewadar}
                badge={popupState.badge}
                todaySessions={popupState.todaySessions}
                onMark={markAttendance}
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
                <div className="error-msg">Only Open, Permanent & Elderly badges can be marked</div>
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
                  {new Date(popupState.time.replace(' ', 'T')).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {manualModal && (
        <ManualEntryModal
          profile={profile}
          childCentres={childCentres}
          userLocation={userLocation}
          centreConfig={centreConfig}
          onClose={() => setManualModal(false)}
          onSuccess={(record) => {
            setManualModal(false)
            playBeep(record.type)
            setPopupState({ type: 'success', sewadar: { badge_number: record.badge_number, sewadar_name: record.sewadar_name }, attendanceType: record.type, time: record.scan_time })
            fetchTodayCount()
            fetchRecentScans()
            setTimeout(closePopup, 3000)
          }}
        />
      )}
    </div>
  )
}

function SewadarFoundCard({ sewadar, allowedAction, todaySessions, dutyType, onMark, onClose }) {
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
      {todaySessions && todaySessions.length > 0 && (
        <div className="popup-scan-history">
          {todaySessions.slice(0, 20).map((s, i) => (
            <span key={i} className={`scan-dot ${s.is_open ? 'dot-in' : s.out_time ? (s.force_closed ? 'dot-out' : 'dot-in') : 'dot-in'}`} />
          ))}
          <span className="scan-history-label">
            {todaySessions.length} session{todaySessions.length !== 1 ? 's' : ''} today · next: {allowedAction}
          </span>
        </div>
      )}
      <div className="popup-actions">
        {allowedAction === 'IN' && (
          <button type="button" className="btn-in" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMark('IN') }}>
            IN
          </button>
        )}
        {allowedAction === 'OUT' && (
          <button type="button" className="btn-out" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMark('OUT') }}>
            OUT
          </button>
        )}
      </div>
      <button className="btn-cancel" onClick={onClose}>Cancel</button>
    </>
  )
}

function OverridePopup({ type, sewadar, badge, openSession, todaySessions, onMark, onClose, isAso, profile }) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!isAso) {
    return (
      <div className="popup-error">
        <AlertTriangle size={32} color="#f59e0b" style={{ margin: '0 auto 12px', display: 'block' }} />
        <div className="error-title">{type === 'open_session' ? 'Already Checked In' : 'Not Checked In'}</div>
        <div className="error-name">{sewadar.sewadar_name}</div>
        <div className="error-msg">
          {type === 'open_session' 
            ? 'Cannot mark IN. Already has open session. Contact ASO for help.'
            : 'Cannot mark OUT. No open session found. Contact ASO for help.'
          }
        </div>
        <button className="btn-cancel" onClick={onClose}>Dismiss</button>
      </div>
    )
  }

  async function handleOverride() {
    if (!reason.trim()) return
    setSubmitting(true)

    const overrideData = {
      isOverride: true,
      asobadge: profile?.badge_number || 'UNKNOWN',
      reason: reason.trim(),
      overrideType: type === 'open_session' ? 'force_close_and_new_in' : 'standalone_out',
    }

    await onMark(type === 'open_session' ? 'IN' : 'OUT', overrideData)
    setSubmitting(false)
  }

  return (
    <div className="popup-recent">
      <div className="popup-recent-icon"><AlertTriangle size={28} color="#f59e0b" /></div>
      <div className="recent-name">{sewadar.sewadar_name}</div>
      <div className="recent-badge">{badge}</div>
      <div className="recent-msg">
        {type === 'open_session' 
          ? 'Open session exists. Provide reason to force close and create new IN.'
          : 'No open session. Provide reason to create standalone OUT.'
        }
      </div>
      <div style={{ marginTop: '1rem' }}>
        <label className="label">Reason for override *</label>
        <textarea
          className="input"
          rows={2}
          placeholder="Why are you overriding the rule?..."
          value={reason}
          onChange={e => setReason(e.target.value)}
          style={{ resize: 'none' }}
        />
      </div>
      <div className="popup-actions" style={{ marginTop: '0.75rem' }}>
        <button 
          className="btn btn-primary" 
          onClick={handleOverride}
          disabled={!reason.trim() || submitting}
        >
          {submitting ? 'Processing...' : 'Confirm Override'}
        </button>
        <button className="btn-cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

function ManualEntryModal({ profile, childCentres, userLocation, centreConfig, onClose, onSuccess }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState(null)
  const [attendanceType, setAttendanceType] = useState('IN')
  const [scanDate, setScanDate] = useState(todayDateStr())
  const [scanTime, setScanTime] = useState(() => {
    const now = new Date()
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  })
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const searchRef = useRef(null)

  const isAso = profile?.role === ROLES.ASO

  useEffect(() => { searchRef.current?.focus() }, [])

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (search.length < 2) { setResults([]); return }
      setSearching(true)
      try {
        let q = supabase.from('sewadars')
          .select('*')
          .or(`badge_number.ilike.%${search.toUpperCase()}%,sewadar_name.ilike.%${search.toUpperCase()}%`)
          .limit(10)

        if (profile?.role === ROLES.CENTRE) {
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

    const scanTimeISO = new Date(`${scanDate}T${scanTime}:00+05:30`).toISOString()

    // Check open session
    const openSession = await getOpenSession(supabase, selected.badge_number)

    // Evaluate according to rules
    if (attendanceType === 'IN' && openSession) {
      if (!isAso) {
        setError('Cannot create new IN. Open session exists. Scan OUT first.')
        setSubmitting(false)
        return
      }
      // ASO override
      // Force close old session
      await asoForceCloseSession(supabase, {
        sessionId: openSession.id,
        asobadge: profile.badge_number,
        reason: remark.trim(),
      })
    }

    if (attendanceType === 'OUT' && !openSession) {
      if (!isAso) {
        setError('Cannot create OUT. No open session found. Scan IN first.')
        setSubmitting(false)
        return
      }
      // ASO creates standalone OUT
executeStandaloneOut(supabase, {
        badge_number: selected.badge_number,
        sewadar_name: selected.sewadar_name,
        centre: selected.centre,
        department: selected.department,
        scanTimeISO,
        scanner_badge: profile.badge_number,
        scanner_name: profile.name,
        scanner_centre: profile.centre,
        latitude: userLocation?.lat || null,
        longitude: userLocation?.lng || null,
        reason: remark.trim(),
        asobadge: profile.badge_number,
      })

      setSubmitting(false)
      onSuccess({
        badge_number: selected.badge_number,
        sewadar_name: selected.sewadar_name,
        type: 'OUT',
        scan_time: scanTimeISO,
      })
      return
    }

    // Normal flow
    const dutyType = computeDutyType(scanTimeISO, attendanceType === 'WATCH_WARD')

    try {
      const result = await executeScan(supabase, {
        badge_number: selected.badge_number,
        sewadar_name: selected.sewadar_name,
        centre: selected.centre,
        department: selected.department || null,
        type: attendanceType,
        scanTimeISO,
        dutyType,
        openSession,
        scanner_badge: profile.badge_number,
        scanner_name: profile.name,
        scanner_centre: profile.centre,
        latitude: userLocation?.lat || null,
        longitude: userLocation?.lng || null,
        manual_entry: true,
        submitted_by: profile.badge_number,
      })

      await supabase.from('logs').insert({
        user_badge: profile.badge_number,
        action: 'MANUAL_ENTRY',
        details: `Manual ${attendanceType} for ${selected.badge_number} — "${remark.trim()}"`,
        timestamp: scanTimeISO,
        device_id: navigator.userAgent.slice(0, 50),
      })

      setSubmitting(false)
      onSuccess({
        badge_number: selected.badge_number,
        sewadar_name: selected.sewadar_name,
        type: attendanceType,
        scan_time: scanTimeISO,
      })
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
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

        {selected && (
          <div style={{ background: 'var(--gold-bg)', border: '1px solid rgba(201,168,76,0.3)', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem' }}>
            <div style={{ fontWeight: 700, color: 'var(--gold)', marginBottom: '0.2rem' }}>{selected.sewadar_name}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{selected.badge_number} · {selected.centre} · {selected.department || '—'}</div>
            <button onClick={() => { setSelected(null); setSearch('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.35rem', fontFamily: 'inherit' }}>
              Change
            </button>
          </div>
        )}

        <label className="label">Attendance Type *</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
          {['IN', 'OUT'].map(t => (
            <button key={t} onClick={() => setAttendanceType(t)}
              style={{ padding: '0.65rem', border: `2px solid ${attendanceType === t ? (t === 'IN' ? 'var(--green)' : 'var(--red)') : 'var(--border)'}`, borderRadius: 8, background: attendanceType === t ? (t === 'IN' ? 'var(--green-bg)' : 'var(--red-bg)') : 'white', color: attendanceType === t ? (t === 'IN' ? 'var(--green)' : 'var(--red)') : 'var(--text-secondary)', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'inherit' }}>
              {t}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1rem' }}>
          <div>
            <label className="label">Date *</label>
            <input type="date" className="input" value={scanDate}
              onChange={e => setScanDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Time *</label>
            <input type="time" className="input" value={scanTime}
              onChange={e => setScanTime(e.target.value)} />
          </div>
        </div>

        <label className="label">Reason for Manual Entry * <span style={{ color: 'var(--red)', fontWeight: 700 }}>(Required)</span></label>
        <textarea
          className="input"
          rows={2}
          placeholder="Why is this being entered manually?..."
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
