import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, getDistanceMetres, ROLES, isExceptionDept, DUTY_TYPES } from '../lib/supabase'
import { nowIST, todayDateStr } from '../lib/dateUtils'
import { useAuth } from '../context/AuthContext'
import BarcodeScanner from '../components/scanner/BarcodeScanner'
import ManualTimeInputPopup from '../components/ManualTimeInputPopup'
import ManualCloseTimePopup from '../components/ManualCloseTimePopup'
import { MapPin, AlertTriangle, CheckCircle, XCircle, PenLine, Moon } from 'lucide-react'
import { showError, showSuccess } from '../components/Toast'
import {
  evaluateScan,
  executeScan,
  computeDutyType,
  isLateNightScan,
  getSessionsForDate,
  getOpenSession,
 asoForceCloseSession,
  executeStandaloneOut,
  closeSessionWithTime,
  closeForgottenSession,
  hasTimeConflict,
  hasSessionOverlap,
  detectTimeConflict,
  syncSessionWithAttendance,
  deleteSessionWithAttendance,
} from '../lib/sessionLogic'

export default function ScannerPage() {
  const { profile } = useAuth()
  const [userLocation, setUserLocation] = useState(null)
  const [centreConfig, setCentreConfig] = useState(null)
  const [childCentres, setChildCentres] = useState([])
  const [gpsStatus, setGpsStatus] = useState('loading')
  const [popupState, setPopupState] = useState(null)
  const busyRef = useRef(false)
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
  const safetyTimerRef = useRef(null)
  const sewadarCacheRef = useRef(new Map())
  const popupStateRef = useRef(null)
  const lastScanBadgeRef = useRef(null)
  const lastScanTimeRef = useRef(0)

  const isAso = profile?.role === ROLES.ASO
  const isCentreUser = profile?.role === ROLES.CENTRE || profile?.role === ROLES.SC_SP_USER

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
    }).catch(e => { if (import.meta.env.DEV) console.warn('Failed to load centre config:', e) })
  }, [profile?.centre, isAso])

  useEffect(() => {
    if (!navigator.geolocation) { setGpsStatus('failed'); return }
    const success = (pos) => {
      setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      setGpsStatus('success')
    }
    const fail = () => setGpsStatus(s => s !== 'success' ? 'failed' : s)
    const opts = { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 }
    navigator.geolocation.getCurrentPosition(success, fail, opts)
    watchIdRef.current = navigator.geolocation.watchPosition(success, fail, opts)
    return () => { if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current) }
  }, [])

  useEffect(() => {
    fetchTodayCount().catch(() => {})
    fetchRecentScans().catch(() => {})
    let debounceTimer = null
    const channel = supabase.channel('scanner-realtime-v3')
    
    channel.on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'attendance',
    }, (payload) => {
      console.log('[RT-SCANNER] attendance event:', payload.eventType, payload.new?.badge_number || '')
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        console.log('[RT-SCANNER] Refreshing...')
        fetchTodayCount().catch(() => {})
        fetchRecentScans().catch(() => {})
      }, 500)
    })
    .on('postgres_changes', { 
      event: '*', 
      schema: 'public', 
      table: 'attendance_sessions',
    }, (payload) => {
      console.log('[RT-SCANNER] sessions event:', payload.eventType, payload.new?.badge_number || '')
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        console.log('[RT-SCANNER] Refreshing...')
        fetchTodayCount().catch(() => {})
        fetchRecentScans().catch(() => {})
      }, 500)
    })
    .subscribe((status, err) => {
      console.log('[RT-SCANNER] Channel status:', status, err || '')
    })
    
    return () => {
      console.log('[RT-SCANNER] Cleanup')
      clearTimeout(debounceTimer)
      supabase.removeChannel(channel)
    }
  }, [profile?.centre, profile?.role, profile])

  useEffect(() => {
    if (import.meta.env.DEV) console.log('[POPUP STATE UPDATED]', popupState?.type || 'null')
    popupStateRef.current = popupState
    if (popupState && safetyTimerRef.current) {
      clearTimeout(safetyTimerRef.current)
      safetyTimerRef.current = null
    }
  }, [popupState])

  async function fetchTodayCount() {
    const today = todayDateStr()
    const start = `${today}T00:00:00+05:30`
    let q = supabase.from('attendance_sessions').select('id', { count: 'exact', head: true })
      .gte('in_time', start)
      .eq('is_open', true)

    if ((profile?.role === ROLES.CENTRE || profile?.role === ROLES.SC_SP_USER) && profile?.centre) {
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

    if ((profile?.role === ROLES.CENTRE || profile?.role === ROLES.SC_SP_USER) && profile?.centre) {
      const scope = [profile.centre, ...childCentresRef.current]
      q = q.in('centre', scope)
    }

    const { data } = await q
    if (data) setRecentScans(data)
  }

  useEffect(() => {
    const warmup = () => {
      if (!audioCtxRef.current) {
        try { audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)() } catch (_) { /* AudioContext not available */ }
      }
    }
    document.addEventListener('click', warmup, { once: true })
    document.addEventListener('touchstart', warmup, { once: true })
    return () => {
      document.removeEventListener('click', warmup)
      document.removeEventListener('touchstart', warmup)
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
    } catch (e) { if (import.meta.env.DEV) console.warn('Beep failed:', e) }
    if (navigator.vibrate) {
      navigator.vibrate(type === 'IN' ? [30] : [30, 50, 30])
    }
  }

  const handleScan = useCallback(async (badge) => {
    if (import.meta.env.DEV) console.log('[SCAN FIRED]', badge)
    if (busyRef.current) { if (import.meta.env.DEV) console.log('[BLOCKED] busyRef'); return }

    // Check for duplicate scan (same badge within 3 seconds)
    const now = Date.now()
    if (lastScanBadgeRef.current === badge && now - lastScanTimeRef.current < 3000) {
      if (import.meta.env.DEV) console.log('[BLOCKED] duplicate scan')
      return
    }

    busyRef.current = true
    lastScanBadgeRef.current = badge
    lastScanTimeRef.current = now
    
    if (safetyTimerRef.current) clearTimeout(safetyTimerRef.current)
    safetyTimerRef.current = setTimeout(() => {
      if (import.meta.env.DEV) console.log('[TIMEOUT] releasing busyRef')
      if (busyRef.current) busyRef.current = false
      safetyTimerRef.current = null
    }, 5000)

    const openPopup = (state) => {
      if (import.meta.env.DEV) console.log('[POPUP]', state.type)
      if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null }
      if (scannerRef.current) scannerRef.current.stop()
      lastScanRef.current = { badge, time: Date.now() }
      setPopupState(state)
    }

    const release = () => {
      if (import.meta.env.DEV) console.log('[RELEASE]')
      busyRef.current = false
      if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null }
    }

    try {
      const location = userLocation
      const cfg = centreConfig

      let found = sewadarCacheRef.current.get(badge)
      let lookupError = null

      if (!found) {
        try {
          const { data, error } = await supabase.from('sewadars').select('*').eq('badge_number', badge).maybeSingle()
          if (error) throw error
          found = data
          if (found) sewadarCacheRef.current.set(badge, found)
        } catch (e) {
          lookupError = e?.message || 'Database error'
        }
      }

      if (!found) {
        release()
        openPopup({ type: 'not_found', badge, message: lookupError ? `Lookup failed: ${lookupError}` : null })
        return
      }

      const ALLOWED_STATUSES = ['open', 'permanent', 'elderly']
      const badgeStatus = (found.badge_status || '').toLowerCase().trim()
      if (!ALLOWED_STATUSES.includes(badgeStatus)) {
        release()
        openPopup({ type: 'invalid_status', sewadar: found, badge })
        return
      }

      const scopeCentres = [profile?.centre, ...childCentresRef.current]
      const inScope = scopeCentres.includes(found.centre)
      const isException = isExceptionDept(found.department)

      if (!isException && !inScope && !isAso) {
        release()
        openPopup({ type: 'auth_fail', sewadar: found, badge, message: `${found.centre} — not in your scope` })
        return
      }

      if (!isAso && location && cfg?.geo_enabled === true && cfg?.latitude != null && cfg?.longitude != null) {
        const dist = getDistanceMetres(location.lat, location.lng, cfg.latitude, cfg.longitude)
        const radius = cfg.geo_radius || 200
        if (dist > radius) {
          release()
          openPopup({ type: 'geo_fail', sewadar: found, message: `${Math.round(dist)}m away (limit: ${radius}m)`, badge })
          return
        }
      }

      const scanTime = nowIST()
      const isLateNight = isLateNightScan(scanTime)

      // Check for open sessions BEFORE showing W&W confirmation
      // If there's a previous-day open session, we need to handle that first
      const openSession = await getOpenSession(supabase, badge)
      const today = todayDateStr()
      const openSessionDate = openSession?.date_ist ? String(openSession.date_ist).substring(0, 10) : null
      const isPreviousDayOpen = openSession && openSessionDate && openSessionDate !== today

      if (isLateNight && !isPreviousDayOpen) {
        pendingScanRef.current = { found, badge, scanTime, release }
        release()
        setWatchWardConfirm({ sewadar: found, badge })
        return
      }

      await processSewadar(found, badge, scanTime, isPreviousDayOpen, release)
    } catch (e) {
      if (import.meta.env.DEV) console.error('[HANDLE SCAN ERROR]', e?.message || e, e?.stack)
      release()
      openPopup({ type: 'not_found', badge, message: 'System error: ' + (e?.message || String(e)) })
    }
  }, [profile, userLocation, centreConfig, childCentres, isAso])

  async function handleWatchWardConfirm(isWatchWard) {
    if (!pendingScanRef.current) return
    
    const { found, badge, scanTime, release } = pendingScanRef.current
    pendingScanRef.current = null
    setWatchWardConfirm(null)
    
    await processSewadar(found, badge, scanTime, isWatchWard, release)
  }

  async function processSewadar(found, badge, scanTime, watchWardConfirm = false, release = null) {
    if (import.meta.env.DEV) console.log('[PROC] start', { badge, scanTime, found: !!found, release: !!release })
    let scanTimeISO
    try {
      const parsed = new Date(scanTime.replace(' ', 'T'))
      if (isNaN(parsed.getTime())) throw new Error('Invalid scanTime: ' + scanTime)
      scanTimeISO = parsed.toISOString()
    } catch (e) {
      if (import.meta.env.DEV) console.error('[PROC] scanTime parse failed:', e)
      openPopup({ type: 'not_found', badge, message: 'System error: bad scan time' })
      return
    }
    if (import.meta.env.DEV) console.log('[PROC] scanTimeISO =', scanTimeISO)
    const today = todayDateStr()

    const openPopup = (state) => {
      if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null }
      if (scannerRef.current) scannerRef.current.stop()
      lastScanRef.current = { badge, time: Date.now() }
      setPopupState(state)
    }

    try {
      const [openSession, todaySessions] = await Promise.all([
        getOpenSession(supabase, badge),
        getSessionsForDate(supabase, badge, today),
      ])

      const actionType = openSession ? 'OUT' : 'IN'
      if (import.meta.env.DEV) console.log('[PROC] actionType =', actionType, '| openSession =', !!openSession)

      let evalResult
      try {
        evalResult = await evaluateScan(supabase, {
          badgeNumber: badge,
          type: actionType,
          scanTimeISO,
          watchWard: watchWardConfirm,
          isAso,
          isCentreUser,
        })
        if (import.meta.env.DEV) console.log('[PROC] evaluateScan result:', evalResult)
      } catch (e) {
        if (import.meta.env.DEV) console.error('[PROC] evaluateScan threw:', e)
        openPopup({ type: 'not_found', badge, message: 'System error: ' + (e?.message || String(e)) })
        return
      }

      const result = evalResult

      if (result.status === 'blocked') {
        if (result.reason === 'duplicate_scan') {
          release?.()
          openPopup({ type: 'error', badge, message: result.message || 'Duplicate scan detected. Please wait.' })
          return
        }
        if (result.reason === 'time_conflict') {
          release?.()
          openPopup({ type: 'time_conflict', sewadar: found, badge, conflictSession: result.conflictSession, todaySessions })
          return
        }
        if (result.reason === 'jatha_active') {
          release?.()
          openPopup({ type: 'jatha_block', sewadar: found, badge, jatha: result.jatha })
          return
        }
        if (result.reason === 'cross_midnight_session') {
          release?.()
          openPopup({ type: 'open_session_block', sewadar: found, badge, openSession: result.openSession, todaySessions })
          return
        }
        if (result.reason === 'open_session_same_day') {
          if (!result.canOverride) {
            openPopup({ type: 'open_session_block', sewadar: found, badge, openSession: result.openSession, todaySessions })
          } else {
            openPopup({ type: 'open_session_override', sewadar: found, badge, openSession: result.openSession, todaySessions, dutyType: result.dutyType })
          }
          return
        }
        if (result.reason === 'no_open_session') {
          if (!result.canOverride) {
            openPopup({ type: 'no_session_block', sewadar: found, badge, todaySessions })
          } else {
            openPopup({ type: 'no_session_override', sewadar: found, badge, todaySessions })
          }
          return
        }
        if (result.reason === 'system_error') {
          openPopup({ type: 'not_found', badge, message: result.message })
        } else {
          openPopup({ type: 'open_session_block', sewadar: found, badge, openSession: result.openSession || null, todaySessions })
        }
        return
      }

      if (result.status === 'needs_watch_ward_confirmation') {
        // New behavior: Show popup asking if this is Watch & Ward or forgot to scan OUT
        const oldSessionDate = result.openSession?.date_ist 
          ? new Date(result.openSession.date_ist + 'T12:00:00+05:30').toLocaleDateString('en-IN', { 
              day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' 
            })
          : 'previous day'
          
        openPopup({ 
          type: 'watch_ward_confirm', 
          sewadar: found, 
          badge, 
          openSession: result.openSession,
          todaySessions,
          oldSessionDate,
          reason: result.reason,
          oldSessionWasSatsang: result.oldSessionWasSatsang || false,
          oldSessionInDate: result.oldSessionInDate || null,
        })
        return
      }

      if (result.status === 'allowed') {
        openPopup({ type: 'found', sewadar: found, badge, allowedAction: actionType, todaySessions, dutyType: result.dutyType, watchWard: watchWardConfirm, openSession })
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('[Scanner] processSewadar threw:', err)
      openPopup({ type: 'not_found', badge, message: err.message })
    }
  }

  const markAttendance = async (type, data, overrideData = null) => {
    if (!data?.found) {
      if (import.meta.env.DEV) console.warn('[markAttendance] no data.found, data:', data)
      showError('Something went wrong. Please try again.')
      return
    }
    const found = data.found
    const badge = data.badge || found.badge_number
    const openSession = data.openSession || null
    const watchWard = data.watchWard || false

    try {
      const scanTime = nowIST()
      const scanTimeISO = new Date(scanTime.replace(' ', 'T')).toISOString()

      if (overrideData?.isOverride) {
        const { asobadge, reason, overrideType } = overrideData
        if (overrideType === 'force_close_and_new_in') {
          await asoForceCloseSession(supabase, { sessionId: openSession.id, asobadge, reason })
        } else if (overrideType === 'standalone_out') {
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

      let currentOpenSession = null
      if (type === 'OUT') {
        currentOpenSession = await getOpenSession(supabase, found.badge_number)
      }

      const finalDutyType = overrideData?.dutyType ||
        (watchWard ? DUTY_TYPES.WATCH_WARD : computeDutyType(scanTimeISO, watchWard))

      await executeScan(supabase, {
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
        // Note: closePreviousSession is handled in ManualCloseTimePopup now
      })

      playBeep(type)
      setPopupState({ type: 'success', sewadar: found, attendanceType: type, time: scanTime })
      setTimeout(closePopup, 1200)

      try {
        await supabase.from('logs').insert({
          user_badge: profile.badge_number,
          action: type === 'IN' ? 'MARK_IN' : 'MARK_OUT',
          details: `${type} for ${found.badge_number}`,
          timestamp: scanTimeISO,
          device_id: navigator.userAgent.slice(0, 50),
        })
      } catch (_) { /* logging failure is non-critical */ }

      fetchTodayCount()
      fetchRecentScans()
    } catch (err) {
      if (import.meta.env.DEV) console.error('[markAttendance]', err?.message || err, err?.stack)
      
      // Check for special error that needs manual time input
      const errMsg = err?.message || String(err)
      if (errMsg.startsWith('SESSION_EXCEEDS_LIMIT:')) {
        try {
          const data = JSON.parse(errMsg.replace('SESSION_EXCEEDS_LIMIT:', ''))
          // Show popup to ask for manual OUT time
          // Need to get current open session for the popup
          const sessionData = type === 'OUT' 
            ? await getOpenSession(supabase, found.badge_number)
            : null
          
          setPopupState({
            type: 'manual_time_input',
            sewadar: found,
            badge: badge,
            sessionData: {
              sessionId: sessionData?.id,
              in_time: data.in_time,
              max_hours: data.max_hours,
            },
          })
          return
        } catch (_) {
          // If parsing fails, show generic error
        }
      }
      
      showError('Error: ' + errMsg)
    }
  }

  const closePopup = () => {
    if (safetyTimerRef.current) { clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null }
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
                badge={popupState.badge}
                allowedAction={popupState.allowedAction}
                todaySessions={popupState.todaySessions}
                dutyType={popupState.dutyType}
                watchWard={popupState.watchWard}
                openSession={popupState.openSession}
                onMark={markAttendance}
                onClose={closePopup}
              />
            )}

            {/* Watch & Ward Confirmation - for previous day open session */}
            {popupState.type === 'watch_ward_confirm' && (
              <div className="popup-card" style={{ maxWidth: 380 }}>
                <div style={{ textAlign: 'center', padding: '1.5rem' }}>
                  <div style={{ width: 56, height: 56, background: 'rgba(59,130,246,0.15)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                    <AlertTriangle size={28} color="#3b82f6" />
                  </div>
                  <h3 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Open Session Found</h3>
                  <p style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>
                    You have an open session from <strong>{popupState.oldSessionDate}</strong>. What would you like to do?
                  </p>
                  <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '0.75rem', marginBottom: '1rem', textAlign: 'left' }}>
                    <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>{popupState.sewadar?.sewadar_name}</div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{popupState.badge}</div>
                    {popupState.openSession?.in_time && (
                      <div style={{ fontSize: '0.78rem', color: 'var(--gold)', marginTop: '0.25rem' }}>
                        IN at {new Date(popupState.openSession.in_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'grid', gap: '0.75rem' }}>
                    {/* For OUT scans (action=close_and_confirm) */}
                    {popupState.action === 'close_and_confirm' ? (
                      <>
                        <button 
                          className="btn btn-primary btn-full" 
                          onClick={async () => {
                            // Yes - W&W - close old session as W&W only, no new session
                            closePopup()
                            try {
                              const outTime = nowIST()
                              const outTimeISO = new Date(outTime.replace(' ', 'T')).toISOString()
                              
                              await closeSessionWithTime(supabase, {
                                sessionId: popupState.openSession?.id,
                                badge_number: popupState.badge,
                                outTimeISO,
                                scanner_badge: profile.badge_number,
                                scanner_name: profile.name,
                                scanner_centre: profile.centre,
                                reason: 'Watch & Ward session closed',
                              })
                              playBeep('OUT')
                              setPopupState({ type: 'success', sewadar: popupState.sewadar, attendanceType: 'OUT', time: outTime })
                              setTimeout(closePopup, 1200)
                              fetchTodayCount()
                              fetchRecentScans()
                            } catch (err) {
                              showError('Error: ' + (err?.message || String(err)))
                            }
                          }}
                        >
                          Yes - Watch & Ward
                        </button>
                        <button 
                          className="btn btn-outline btn-full" 
                          onClick={() => {
                            setPopupState({
                              type: 'manual_close_time',
                              sewadar: popupState.sewadar,
                              badge: popupState.badge,
                              openSession: popupState.openSession,
                              isSatsangDay: popupState.oldSessionWasSatsang,
                              oldInDate: popupState.oldSessionInDate,
                              mode: 'forgot_out',
                              createNewSession: false,
                            })
                          }}
                        >
                          I Forgot
                        </button>
                      </>
                    ) : (
                      /* For IN scans (action not set = default IN flow) */
                      <>
                        <button 
                          className="btn btn-primary btn-full" 
                          onClick={async () => {
                            // Yes - Watch & Ward - auto-close old session and create new W&W session
                            closePopup()
                            try {
                              const newInTime = nowIST()
                              const newInTimeISO = new Date(newInTime.replace(' ', 'T')).toISOString()
                              const newDutyType = computeDutyType(newInTimeISO, true)
                              
                              await executeScan(supabase, {
                                badge_number: popupState.badge,
                                sewadar_name: popupState.sewadar?.sewadar_name,
                                centre: popupState.sewadar?.centre,
                                department: popupState.sewadar?.department,
                                type: 'IN',
                                scanTimeISO: newInTimeISO,
                                dutyType: newDutyType,
                                openSession: popupState.openSession,
                                scanner_badge: profile.badge_number,
                                scanner_name: profile.name,
                                scanner_centre: profile.centre,
                                latitude: userLocation?.lat || null,
                                longitude: userLocation?.lng || null,
                                manual_entry: false,
                                submitted_by: profile.badge_number,
                              })
                              playBeep('IN')
                              setPopupState({ type: 'success', sewadar: popupState.sewadar, attendanceType: 'IN', time: newInTime })
                              setTimeout(closePopup, 1200)
                              fetchTodayCount()
                              fetchRecentScans()
                            } catch (err) {
                              showError('Error: ' + (err?.message || String(err)))
                            }
                          }}
                        >
                          Yes - Watch & Ward (Overnight)
                        </button>
                        <button 
                          className="btn btn-outline btn-full" 
                          onClick={() => {
                            setPopupState({
                              type: 'manual_close_time',
                              sewadar: popupState.sewadar,
                              badge: popupState.badge,
                              openSession: popupState.openSession,
                              isSatsangDay: popupState.oldSessionWasSatsang,
                              oldInDate: popupState.oldSessionInDate,
                              mode: 'forgot_out',
                              createNewSession: true,
                            })
                          }}
                        >
                          No - Forgot to Scan OUT
                        </button>
                      </>
                    )}
                    <button 
                      className="btn btn-ghost" 
                      onClick={closePopup}
                      style={{ fontSize: '0.85rem' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {popupState.type === 'jatha_block' && (
              <div className="popup-error">
                <AlertTriangle size={32} color="#f59e0b" style={{ margin: '0 auto 12px', display: 'block' }} />
                <div className="error-title">On Jatha Duty</div>
                <div className="error-name">{popupState.sewadar?.sewadar_name || 'Unknown'}</div>
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
                <div className="error-name">{popupState.sewadar?.sewadar_name || 'Unknown'}</div>
                <div className="error-msg">
                  Already has an open session. Scan OUT first before a new IN.
                </div>
                <button className="btn-cancel" onClick={closePopup}>Dismiss</button>
              </div>
            )}

            {popupState.type === 'time_conflict' && (
              <div className="popup-error">
                <AlertTriangle size={32} color="#f59e0b" style={{ margin: '0 auto 12px', display: 'block' }} />
                <div className="error-title">Time Overlap</div>
                <div className="error-name">{popupState.sewadar?.sewadar_name || 'Unknown'}</div>
                <div className="error-msg">
                  Cannot scan IN. This sewadar already has an entry from {
                    popupState.conflictSession?.in_time 
                      ? new Date(popupState.conflictSession.in_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
                      : '—'
                  } to {
                    popupState.conflictSession?.out_time 
                      ? new Date(popupState.conflictSession.out_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
                      : 'Open'
                  } on this date. Time cannot overlap.
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
                <div className="error-name">{popupState.sewadar?.sewadar_name || 'Unknown'}</div>
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
                <div className="error-msg">{popupState.message || 'This badge is not registered in the system'}</div>
                <button className="btn-cancel" onClick={closePopup}>Try Again</button>
              </div>
            )}

            {popupState.type === 'invalid_status' && (
              <div className="popup-error">
                <XCircle size={32} color="#dc2626" style={{ margin: '0 auto 12px', display: 'block' }} />
                <div className="error-title">Badge Ineligible</div>
                <div className="error-name">{popupState.sewadar?.sewadar_name || 'Unknown'}</div>
                <div className="error-badge">{popupState.badge}</div>
                <div style={{ margin: '8px auto', display: 'inline-block', background: 'rgba(198,40,40,0.1)', border: '1px solid rgba(198,40,40,0.3)', borderRadius: 6, padding: '3px 12px', fontSize: 13, fontWeight: 700, color: '#dc2626' }}>
                  Status: {popupState.sewadar?.badge_status || 'Unknown'}
                </div>
                <div className="error-msg">Only Open, Permanent & Elderly badges can be marked</div>
                <button className="btn-cancel" onClick={closePopup}>Dismiss</button>
              </div>
            )}

            {popupState.type === 'auth_fail' && (
              <div className="popup-error">
                <XCircle size={32} color="#dc2626" style={{ margin: '0 auto 12px', display: 'block' }} />
                <div className="error-title">Not Authorised</div>
                <div className="error-name">{popupState.sewadar?.sewadar_name || 'Unknown'}</div>
                <div className="error-msg">{popupState.message || `${popupState.sewadar?.centre || 'Unknown'} — Different centre`}</div>
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
                <div className="success-name">{popupState.sewadar?.sewadar_name || 'Unknown'}</div>
                <div className="success-type">
                  {popupState.time ? new Date(popupState.time.replace(' ', 'T')).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : ''}
                </div>
              </div>
            )}

            {/* Manual Time Input Popup */}
            {popupState.type === 'manual_time_input' && (
              <ManualTimeInputPopup
                sessionData={popupState.sessionData}
                sewadar={popupState.sewadar}
                badge={popupState.badge}
                action={popupState.action}
                onSubmit={async (outTime) => {
                  try {
                    await closeSessionWithTime(supabase, {
                      sessionId: popupState.sessionData.sessionId,
                      badge_number: popupState.badge,
                      outTimeISO: outTime,
                      scanner_badge: profile.badge_number,
                      scanner_name: profile.name,
                      scanner_centre: profile.centre,
                      reason: 'Session exceeded ' + popupState.sessionData.max_hours + ' hours',
                    })
                    playBeep('OUT')
                    setPopupState({ type: 'success', sewadar: popupState.sewadar, attendanceType: 'OUT', time: outTime })
                    setTimeout(closePopup, 1200)
                    fetchTodayCount()
                    fetchRecentScans()
                  } catch (err) {
                    showError('Error: ' + (err?.message || String(err)))
                  }
                }}
                onClose={closePopup}
              />
            )}

            {/* Manual Close Time Popup - Forgot to Scan OUT */}
            {popupState.type === 'manual_close_time' && (
              <ManualCloseTimePopup
                sessionData={{
                  in_time: popupState.openSession?.in_time,
                }}
                sewadar={popupState.sewadar}
                badge={popupState.badge}
                isSatsangDay={popupState.isSatsangDay}
                oldInDate={popupState.oldInDate}
                mode={popupState.mode}
                onSubmit={async (data) => {
                  try {
                    const { outTimeISO, isWatchWard, reason } = data
                    
                    // Close the previous session with user-provided time
                    if (popupState.mode === 'forgot_out') {
                      await closeForgottenSession(supabase, {
                        sessionId: popupState.openSession?.id,
                        outTimeISO,
                        isWatchWard,
                        reason,
                        scanner_badge: profile.badge_number,
                        scanner_name: profile.name,
                        scanner_centre: profile.centre,
                      })
                    } else {
                      // For watch_ward mode, always treat as W&W
                      await closeSessionWithTime(supabase, {
                        sessionId: popupState.openSession?.id,
                        badge_number: popupState.badge,
                        outTimeISO,
                        scanner_badge: profile.badge_number,
                        scanner_name: profile.name,
                        scanner_centre: profile.centre,
                        reason: 'Watch & Ward session closed',
                      })
                    }
                    
                    // Only create new session if explicitly requested (IN scans)
                    if (popupState.createNewSession) {
                      const newInTime = nowIST()
                      const newInTimeISO = new Date(newInTime.replace(' ', 'T')).toISOString()
                      const newDutyType = computeDutyType(newInTimeISO, false)
                      
                      await executeScan(supabase, {
                        badge_number: popupState.badge,
                        sewadar_name: popupState.sewadar?.sewadar_name,
                        centre: popupState.sewadar?.centre,
                        department: popupState.sewadar?.department,
                        type: 'IN',
                        scanTimeISO: newInTimeISO,
                        dutyType: newDutyType,
                        openSession: null,
                        scanner_badge: profile.badge_number,
                        scanner_name: profile.name,
                        scanner_centre: profile.centre,
                        latitude: userLocation?.lat || null,
                        longitude: userLocation?.lng || null,
                        manual_entry: false,
                        submitted_by: profile.badge_number,
                      })
                      playBeep('IN')
                      setPopupState({ type: 'success', sewadar: popupState.sewadar, attendanceType: 'IN', time: newInTime })
                    } else {
                      // Just show OUT success
                      playBeep('OUT')
                      setPopupState({ type: 'success', sewadar: popupState.sewadar, attendanceType: 'OUT', time: outTimeISO })
                    }
                    showSuccess('Session closed successfully')
                    setTimeout(closePopup, 1200)
                    fetchTodayCount()
                    fetchRecentScans()
                  } catch (err) {
                    showError('Error: ' + (err?.message || String(err)))
                  }
                }}
                onClose={closePopup}
              />
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

function SewadarFoundCard({ sewadar, badge, allowedAction, todaySessions, dutyType, watchWard, openSession, onMark, onClose }) {
  const statusStyle = (s) => {
    const status = (s || '').toLowerCase()
    if (status === 'permanent') return { bg: 'rgba(33,115,70,0.12)', color: 'var(--green)' }
    if (status === 'open') return { bg: 'rgba(37,99,235,0.12)', color: 'var(--blue)' }
    if (status === 'elderly') return { bg: 'rgba(201,168,76,0.15)', color: 'var(--gold)' }
    return { bg: 'rgba(198,40,40,0.1)', color: 'var(--red)' }
  }
  const st = statusStyle(sewadar?.badge_status)

  const data = { found: sewadar, badge, openSession, dutyType, todaySessions, watchWard }

  return (
    <>
      <div className="popup-header">
        <div className="sewadar-info">
          <div className="name">{sewadar?.sewadar_name}</div>
          <div className="badge" style={{ fontFamily: 'monospace', fontSize: 13, color: '#6b7280' }}>{sewadar?.badge_number}</div>
        </div>
        <span className={`gender-badge ${sewadar?.gender?.toUpperCase() === 'MALE' ? 'male' : 'female'}`}>{sewadar?.gender}</span>
      </div>
      <div className="popup-details">
        <div className="detail"><span>Centre</span><span>{sewadar?.centre}</span></div>
        <div className="detail"><span>Dept</span><span>{sewadar?.department || '—'}</span></div>
        <div className="detail">
          <span>Status</span>
          <span style={{ background: st.bg, color: st.color, border: '1px solid currentColor', borderRadius: 5, padding: '1px 8px', fontSize: 12, fontWeight: 700 }}>
            {sewadar?.badge_status || 'Unknown'}
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
          <button type="button" className="btn-in" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMark('IN', data) }}>
            IN
          </button>
        )}
        {allowedAction === 'OUT' && (
          <button type="button" className="btn-out" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMark('OUT', data) }}>
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
        <div className="error-name">{sewadar?.sewadar_name || 'Unknown'}</div>
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

    const data = { found: sewadar, badge, openSession, dutyType: null, todaySessions, watchWard: false }
    await onMark(type === 'open_session' ? 'IN' : 'OUT', data, overrideData)
    setSubmitting(false)
  }

  return (
    <div className="popup-recent">
      <div className="popup-recent-icon"><AlertTriangle size={28} color="#f59e0b" /></div>
      <div className="recent-name">{sewadar?.sewadar_name || 'Unknown'}</div>
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

function ManualEntryModal({ profile, childCentres, userLocation, centreConfig: _centreConfig, onClose, onSuccess }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState(null)
  const [dutyType, setDutyType] = useState('satsang') // satsang, gate_entry, watch_ward
  const [satsangType, setSatsangType] = useState('IN') // For satsang: IN or OUT
  const [inDate, setInDate] = useState(todayDateStr())
  const [inTime, setInTime] = useState(() => {
    const now = new Date()
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  })
  const [outDate, setOutDate] = useState(todayDateStr())
  const [outTime, setOutTime] = useState(() => {
    const now = new Date()
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  })
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [otherCentre, setOtherCentre] = useState(false)
  const searchRef = useRef(null)

  const isAso = profile?.role === ROLES.ASO
  const isCentreUser = profile?.role === ROLES.CENTRE || profile?.role === ROLES.SC_SP_USER

  useEffect(() => { searchRef.current?.focus() }, [])

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (search.length < 2) { setResults([]); return }
      setSearching(true)
      try {
        let q = supabase.from('sewadars')
          .select('*')
          .or(`badge_number.ilike.%${search.toUpperCase()}%,sewadar_name.ilike.%${search.toUpperCase()}%`)
          .limit(15)

        if (!otherCentre && (profile?.role === ROLES.CENTRE || profile?.role === ROLES.SC_SP_USER)) {
          const scope = [profile.centre, ...childCentres]
          q = q.in('centre', scope)
        }

        const { data } = await q
        setResults(data || [])
      } catch (_e) { setResults([]) }
      setSearching(false)
    }, 300)
    return () => clearTimeout(timer)
  }, [search, profile, childCentres, otherCentre])

  // Real-time validation check
  useEffect(() => {
    if (!selected) {
      setError('')
      return
    }

    const validateTime = async () => {
      // Validate IN time format
      if (!inDate || !inTime) {
        setError('')
        return
      }
      
      const inTimeISO = new Date(`${inDate}T${inTime}:00+05:30`)
      if (isNaN(inTimeISO.getTime())) {
        setError('Invalid IN time format')
        return
      }

      // For GATE_ENTRY/WATCH_WARD: validate OUT time
      if (dutyType !== 'satsang') {
        if (!outDate || !outTime) {
          setError('')
          return
        }

        const outTimeISO = new Date(`${outDate}T${outTime}:00+05:30`)
        if (isNaN(outTimeISO.getTime())) {
          setError('Invalid OUT time format')
          return
        }

        // OUT must be after IN
        if (outTimeISO <= inTimeISO) {
          setError('OUT time must be after IN time')
          return
        }

        const durationMs = outTimeISO - inTimeISO
        const MIN_MS = 10 * 60 * 1000
        const MAX_MS_NORMAL = 12 * 60 * 60 * 1000
        const MAX_MS_WW = 20 * 60 * 60 * 1000

        const inDateIST = inTimeISO.toISOString().split('T')[0]
        const outDateIST = outTimeISO.toISOString().split('T')[0]

        // Minimum duration (only for same-day)
        if (inDateIST === outDateIST && durationMs < MIN_MS) {
          setError('Session must be at least 10 minutes')
          return
        }

        // Maximum duration
        const maxMs = dutyType === DUTY_TYPES.WATCH_WARD ? MAX_MS_WW : MAX_MS_NORMAL
        if (durationMs > maxMs) {
          setError(`Session cannot exceed ${dutyType === DUTY_TYPES.WATCH_WARD ? 20 : 12} hours`)
          return
        }
      }

      // Check for database time conflicts
      if (dutyType === 'satsang' && inDate && inTime) {
        const { data: existingSessions } = await supabase
          .from('attendance_sessions')
          .select('id, in_time, out_time, duty_type, date_ist')
          .eq('badge_number', selected.badge_number)
          .eq('date_ist', inDate)

        if (existingSessions?.length > 0) {
          const inTimeMs = inTimeISO.getTime()
          for (const session of existingSessions) {
            const sessionInMs = new Date(session.in_time).getTime()
            const sessionOutMs = session.out_time ? new Date(session.out_time).getTime() : Date.now() + 86400000

            if (inTimeMs >= sessionInMs && inTimeMs < sessionOutMs) {
              const inStr = new Date(session.in_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
              const outStr = session.out_time
                ? new Date(session.out_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })
                : 'Open'
              setError(`Time conflict: ${session.duty_type} session from ${inStr} to ${outStr}. Choose different time.`)
              return
            }
          }
        }
      }

      setError('')
    }

    validateTime()
  }, [selected, inDate, inTime, outDate, outTime, dutyType])

  const canSubmit = selected && (dutyType === 'satsang' ? remark.trim().length >= 3 : true) && (!otherCentre || remark.trim().length >= 3) && !error

  const ALLOWED_STATUSES = ['open', 'permanent', 'elderly']

  async function handleSubmit() {
    if (!canSubmit) return

    const badgeStatus = (selected.badge_status || '').toLowerCase().trim()
    if (!ALLOWED_STATUSES.includes(badgeStatus)) {
      setError(`Cannot add ${selected.sewadar_name}. Badge status is "${selected.badge_status || 'unknown'}" - only Open, Permanent & Elderly allowed.`)
      return
    }
    setSubmitting(true)
    setError('')

    const inTimeISO = new Date(`${inDate}T${inTime}:00+05:30`).toISOString()
    const outTimeISO = new Date(`${outDate}T${outTime}:00+05:30`).toISOString()

    // Validate IN time
    if (isNaN(new Date(inTimeISO).getTime())) {
      setError('Invalid IN time')
      setSubmitting(false)
      return
    }

    // For GATE_ENTRY/WATCH_WARD: validate duration
    if (dutyType !== 'satsang') {
      const outDateObj = new Date(outTimeISO)
      const inDateObj = new Date(inTimeISO)

      // OUT must be after IN
      if (outDateObj <= inDateObj) {
        setError('OUT time must be after IN time')
        setSubmitting(false)
        return
      }

      const durationMs = outDateObj - inDateObj
      const MIN_MS = 10 * 60 * 1000
      const MAX_MS_NORMAL = 12 * 60 * 60 * 1000
      const MAX_MS_WW = 20 * 60 * 60 * 1000

      // Minimum duration (only for same-day)
      const inDateIST = inTimeISO.split('T')[0]
      const outDateIST = outTimeISO.split('T')[0]
      if (inDateIST === outDateIST && durationMs < MIN_MS) {
        setError('Session must be at least 10 minutes')
        setSubmitting(false)
        return
      }

      // Maximum duration
      const maxMs = dutyType === DUTY_TYPES.WATCH_WARD ? MAX_MS_WW : MAX_MS_NORMAL
      if (durationMs > maxMs) {
        setError(`Session cannot exceed ${dutyType === DUTY_TYPES.WATCH_WARD ? 20 : 12} hours`)
        setSubmitting(false)
        return
      }
    }

    try {
      // For SATSANG: handle IN or OUT separately
      if (dutyType === 'satsang') {
        if (satsangType === 'IN') {
          // Check for existing open satsang session
          const { data: existingOpen } = await supabase
            .from('attendance_sessions')
            .select('id, in_time')
            .eq('badge_number', selected.badge_number)
            .eq('duty_type', 'satsang')
            .eq('is_open', true)
            .limit(1)

          if (existingOpen?.length > 0) {
            setError(`Cannot mark IN. Open satsang session exists from ${new Date(existingOpen[0].in_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}. Mark OUT first.`)
            setSubmitting(false)
            return
          }

          // Check for time conflict with any existing session on same day
          const { data: sameDaySessions } = await supabase
            .from('attendance_sessions')
            .select('id, in_time, out_time, duty_type')
            .eq('badge_number', selected.badge_number)
            .eq('date_ist', inDate)
            .order('in_time', { ascending: false })

          if (sameDaySessions?.length > 0) {
            const newInMs = new Date(inTimeISO).getTime()
            for (const session of sameDaySessions) {
              const sessionInMs = new Date(session.in_time).getTime()
              const sessionOutMs = session.out_time ? new Date(session.out_time).getTime() : Date.now()
              
              if (newInMs >= sessionInMs && newInMs < sessionOutMs) {
                setError(`Cannot mark IN. Time overlaps with existing ${session.duty_type} session from ${new Date(session.in_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })} to ${session.out_time ? new Date(session.out_time).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : 'Open'}.`)
                setSubmitting(false)
                return
              }
            }
          }

          // Check Jatha overlap
          const { data: jathaRecords } = await supabase
            .from('jatha_attendance')
            .select('id, date_from, date_to')
            .eq('badge_number', selected.badge_number)
            .lte('date_from', inTimeISO)
            .gte('date_to', inTimeISO)
          
          if (jathaRecords?.length > 0) {
            const jatha = jathaRecords[0]
            setError(`Cannot mark IN. Person is assigned to Jatha from ${new Date(jatha.date_from).toLocaleDateString('en-IN')} to ${new Date(jatha.date_to).toLocaleDateString('en-IN')}`)
            setSubmitting(false)
            return
          }

          // Create session + IN
          const { data: session, error: sessionError } = await supabase
            .from('attendance_sessions')
            .insert({
              badge_number: selected.badge_number,
              duty_type: 'satsang',
              in_time: inTimeISO,
              date_ist: inDate,
              is_open: true,
              manual_in: true,
              scanner_badge: profile.badge_number,
              scanner_name: profile.name,
              scanner_centre: profile.centre,
              in_scanner_name: profile.name,
              remark: otherCentre ? `[Other Centre] ${remark.trim()}` : (remark.trim() || null),
            })
            .select('id')
            .single()

          if (sessionError) throw new Error('Failed to create session: ' + sessionError.message)

          const { data: inAtt, error: inError } = await supabase
            .from('attendance')
            .insert({
              badge_number: selected.badge_number,
              type: 'IN',
              scan_time: inTimeISO,
              duty_type: 'satsang',
              session_id: session.id,
              scanner_badge: profile.badge_number,
              scanner_name: profile.name,
              scanner_centre: profile.centre,
              latitude: userLocation?.lat || null,
              longitude: userLocation?.lng || null,
              manual_entry: true,
              submitted_by: profile.badge_number,
              submitted_at: new Date().toISOString(),
            })
            .select('id')
            .single()

          if (inError) {
            await deleteSessionWithAttendance(supabase, { sessionId: session.id, deletedByBadge: profile.badge_number, reason: 'Failed to create IN attendance - rolling back' })
            throw new Error('Failed to record IN: ' + inError.message)
          }

          await supabase.from('attendance_sessions').update({ in_id: inAtt.id }).eq('id', session.id)

          setSuccessMsg(`✓ IN marked for ${selected.sewadar_name}`)
          setSubmitting(false)
          setRemark('')
          setTimeout(() => onClose(), 1500)
          return

        } else {
          // OUT: Find open session and add OUT
          try {
            const { data: sessions } = await supabase
              .from('attendance_sessions')
              .select('id, in_time')
              .eq('badge_number', selected.badge_number)
              .eq('is_open', true)
              .eq('duty_type', 'satsang')
              .order('in_time', { ascending: false })
              .limit(1)

            if (!sessions?.length) throw new Error('No open satsang session found. Mark IN first.')

            const openSession = sessions[0]

            // Validate OUT time for same-day sessions
            if (openSession.in_time) {
              const inTime = new Date(openSession.in_time)
              const outTime = new Date(outTimeISO)
              const inDateIST = openSession.in_time.split('T')[0]
              const outDateIST = outTimeISO.split('T')[0]
              const durationMs = outTime - inTime

              // Same-day: minimum 10 minutes
              if (inDateIST === outDateIST && durationMs < 10 * 60 * 1000) {
                setError('Session must be at least 10 minutes')
                setSubmitting(false)
                return
              }

              // Maximum 12 hours for satsang
              if (durationMs > 12 * 60 * 60 * 1000) {
                setError('Satsang session cannot exceed 12 hours')
                setSubmitting(false)
                return
              }
            }

            const { data: outAtt, error: outError } = await supabase
              .from('attendance')
              .insert({
                badge_number: selected.badge_number,
                type: 'OUT',
                scan_time: outTimeISO,
                duty_type: 'satsang',
                session_id: openSession.id,
                scanner_badge: profile.badge_number,
                scanner_name: profile.name,
                scanner_centre: profile.centre,
                latitude: userLocation?.lat || null,
                longitude: userLocation?.lng || null,
                manual_entry: true,
                submitted_by: profile.badge_number,
                submitted_at: new Date().toISOString(),
              })
              .select('id')
              .single()

            if (outError) throw new Error('Failed to record OUT: ' + outError.message)

            await supabase
              .from('attendance_sessions')
              .update({
                out_id: outAtt.id,
                out_time: outTimeISO,
                is_open: false,
                manual_out: true,
                out_scanner_name: profile.name,
                updated_at: new Date().toISOString(),
              })
              .eq('id', openSession.id)

            setSuccessMsg(`✓ OUT marked for ${selected.sewadar_name}`)
            setSubmitting(false)
            setRemark('')
            setTimeout(() => onClose(), 1500)
            return
          } catch (err) {
            setError(err.message)
            setSubmitting(false)
            return
          }
        }
      } else {
        // For GATE_ENTRY and WATCH_WARD: Create session + IN + OUT together
        
        // Step 0: Check for time conflicts and Jatha overlap
        const { data: existingSessions } = await supabase
          .from('v_sessions')
          .select('id, badge_number, in_time, out_time, date_ist, duty_type')
          .eq('badge_number', selected.badge_number)
          .neq('is_open', true)
        
        const { data: jathaRecords } = await supabase
          .from('jatha_attendance')
          .select('id, date_from, date_to')
          .eq('badge_number', selected.badge_number)
          .lte('date_from', outTimeISO)
          .gte('date_to', inTimeISO)
        
        const conflictResult = detectTimeConflict({
          sessions: existingSessions || [],
          jathas: jathaRecords || [],
          proposedInISO: inTimeISO,
          proposedOutISO: outTimeISO,
          excludeSessionId: null,
          badgeNumber: selected.badge_number
        })
        
        if (conflictResult.hasConflict) {
          setError(conflictResult.message)
          setSubmitting(false)
          return
        }

        // Step 1: Create session with IN
        const { data: session, error: sessionError } = await supabase
          .from('attendance_sessions')
          .insert({
            badge_number: selected.badge_number,
            duty_type: dutyType,
            in_time: inTimeISO,
            date_ist: inDate,
            is_open: true,
            manual_in: true,
            scanner_badge: profile.badge_number,
            scanner_name: profile.name,
            scanner_centre: profile.centre,
            in_scanner_name: profile.name,
            remark: otherCentre ? `[Other Centre] ${remark.trim()}` : (remark.trim() || null),
          })
          .select('id')
          .single()

        if (sessionError) throw new Error('Failed to create session: ' + sessionError.message)

        // Step 2: Create IN attendance record
        const { data: inAtt, error: inError } = await supabase
          .from('attendance')
          .insert({
            badge_number: selected.badge_number,
            type: 'IN',
            scan_time: inTimeISO,
            duty_type: dutyType,
            session_id: session.id,
            scanner_badge: profile.badge_number,
            scanner_name: profile.name,
            scanner_centre: profile.centre,
            latitude: userLocation?.lat || null,
            longitude: userLocation?.lng || null,
            manual_entry: true,
            submitted_by: profile.badge_number,
            submitted_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (inError) {
          await deleteSessionWithAttendance(supabase, { sessionId: session.id, deletedByBadge: profile.badge_number, reason: 'Failed to create IN attendance - rolling back' })
          throw new Error('Failed to record IN: ' + inError.message)
        }

        // Step 3: Update session with in_id
        await supabase.from('attendance_sessions').update({ in_id: inAtt.id }).eq('id', session.id)

        // Step 4: Create OUT attendance record
        const { data: outAtt, error: outError } = await supabase
          .from('attendance')
          .insert({
            badge_number: selected.badge_number,
            type: 'OUT',
            scan_time: outTimeISO,
            duty_type: dutyType,
            session_id: session.id,
            scanner_badge: profile.badge_number,
            scanner_name: profile.name,
            scanner_centre: profile.centre,
            latitude: userLocation?.lat || null,
            longitude: userLocation?.lng || null,
            manual_entry: true,
            submitted_by: profile.badge_number,
            submitted_at: new Date().toISOString(),
          })
          .select('id')
          .single()

        if (outError) {
          await deleteSessionWithAttendance(supabase, { sessionId: session.id, deletedByBadge: profile.badge_number, reason: 'Failed to create OUT attendance - rolling back' })
          throw new Error('Failed to record OUT: ' + outError.message)
        }

        // Step 5: Close session with OUT
        const { error: closeError } = await supabase
          .from('attendance_sessions')
          .update({
            out_id: outAtt.id,
            out_time: outTimeISO,
            is_open: false,
            manual_out: true,
            out_scanner_name: profile.name,
            updated_at: new Date().toISOString(),
          })
          .eq('id', session.id)

        if (closeError) throw new Error('Failed to close session: ' + closeError.message)

        // Log
        try {
          await supabase.from('logs').insert({
            user_badge: profile.badge_number,
            action: 'MANUAL_ATTENDANCE',
            details: `Manual ${dutyType} for ${selected.badge_number} (${inDate} ${inTime} → ${outDate} ${outTime}) — "${remark.trim()}"`,
            timestamp: new Date().toISOString(),
            device_id: navigator.userAgent.slice(0, 50),
          })
        } catch (_) { /* logging non-critical */ }

        const dutyLabel = dutyType === 'gate_entry' ? 'Gate Entry' : 'Watch & Ward'
        setSuccessMsg(`✓ ${dutyLabel} recorded for ${selected.sewadar_name}`)
        
        setSubmitting(false)
        setTimeout(() => onClose(), 1500)
      }
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

        {successMsg && (
          <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', color: '#16a34a', fontWeight: 600, fontSize: '0.88rem' }}>
            ✓ {successMsg}
          </div>
        )}

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

        {isCentreUser && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', cursor: 'pointer', padding: '0.5rem', background: otherCentre ? 'rgba(59,130,246,0.1)' : 'transparent', borderRadius: 6, border: otherCentre ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent' }}>
            <input type="checkbox" checked={otherCentre} onChange={e => { setOtherCentre(e.target.checked); setSelected(null); setSearch('') }} style={{ width: 18, height: 18, accentColor: '#3b82f6' }} />
            <span style={{ fontSize: '0.85rem', color: otherCentre ? '#3b82f6' : 'var(--text-secondary)', fontWeight: otherCentre ? 600 : 400 }}>
              Search sewadars from other centres
            </span>
          </label>
        )}

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
          <div style={{ background: otherCentre ? 'rgba(59,130,246,0.1)' : 'var(--gold-bg)', border: `1px solid ${otherCentre ? 'rgba(59,130,246,0.3)' : 'rgba(201,168,76,0.3)'}`, borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem' }}>
            {otherCentre && (
              <div style={{ fontSize: '0.7rem', color: '#3b82f6', fontWeight: 700, marginBottom: '0.35rem' }}>
                ⚠ Out-of-centre sewadar
              </div>
            )}
            <div style={{ fontWeight: 700, color: otherCentre ? '#3b82f6' : 'var(--gold)', marginBottom: '0.2rem' }}>{selected.sewadar_name}</div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{selected.badge_number} · {selected.centre} · {selected.department || '—'}</div>
            <button onClick={() => { setSelected(null); setSearch('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.35rem', fontFamily: 'inherit' }}>
              Change
            </button>
          </div>
        )}

        <label className="label">Duty Type *</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
          {[
            { value: 'satsang', label: 'Satsang', color: '#9333ea', bg: 'rgba(168,85,247,0.1)' },
            { value: 'gate_entry', label: 'Gate Entry', color: '#6b7280', bg: 'rgba(107,114,128,0.1)' },
            { value: 'watch_ward', label: 'Watch & Ward', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
          ].map(dt => (
            <button key={dt.value} onClick={() => setDutyType(dt.value)}
              style={{ padding: '0.6rem 0.25rem', border: `2px solid ${dutyType === dt.value ? dt.color : 'var(--border)'}`, borderRadius: 8, background: dutyType === dt.value ? dt.bg : 'transparent', color: dutyType === dt.value ? dt.color : 'var(--text-secondary)', fontWeight: 700, fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}>
              {dt.label}
            </button>
          ))}
        </div>

        {dutyType === 'satsang' ? (
          <>
            <label className="label">Mark *</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
              {['IN', 'OUT'].map(t => (
                <button key={t} onClick={() => setSatsangType(t)}
                  style={{ padding: '0.65rem', border: `2px solid ${satsangType === t ? (t === 'IN' ? '#16a34a' : '#dc2626') : 'var(--border)'}`, borderRadius: 8, background: satsangType === t ? (t === 'IN' ? 'rgba(34,197,94,0.1)' : 'rgba(220,38,38,0.1)') : 'transparent', color: satsangType === t ? (t === 'IN' ? '#16a34a' : '#dc2626') : 'var(--text-secondary)', fontWeight: 700, fontSize: '0.9rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {t}
                </button>
              ))}
            </div>

            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label className="label">Date</label>
                  <input type="date" className="input" value={satsangType === 'IN' ? inDate : outDate} onChange={e => satsangType === 'IN' ? setInDate(e.target.value) : setOutDate(e.target.value)} />
                </div>
                <div>
                  <label className="label">Time</label>
                  <input type="time" className="input" value={satsangType === 'IN' ? inTime : outTime} onChange={e => satsangType === 'IN' ? setInTime(e.target.value) : setOutTime(e.target.value)} />
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }}></span>
                <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#16a34a' }}>IN</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label className="label">Date</label>
                  <input type="date" className="input" value={inDate} onChange={e => setInDate(e.target.value)} />
                </div>
                <div>
                  <label className="label">Time</label>
                  <input type="time" className="input" value={inTime} onChange={e => setInTime(e.target.value)} />
                </div>
              </div>
            </div>

            <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626', display: 'inline-block' }}></span>
                <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#dc2626' }}>OUT</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <div>
                  <label className="label">Date</label>
                  <input type="date" className="input" value={outDate} onChange={e => setOutDate(e.target.value)} />
                </div>
                <div>
                  <label className="label">Time</label>
                  <input type="time" className="input" value={outTime} onChange={e => setOutTime(e.target.value)} />
                </div>
              </div>
            </div>
          </>
        )}

        {dutyType === 'satsang' && (
          <>
            <label className="label">
              Reason {otherCentre && <span style={{ color: 'var(--red)', fontWeight: 700 }}>*</span>}
              {!otherCentre && dutyType !== 'satsang' && <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.75rem' }}> (optional for gate entry)</span>}
            </label>
            <textarea
              className="input"
              rows={2}
              placeholder={otherCentre ? "Explain reason for adding out-of-centre sewadar..." : "Why is this being entered manually?..."}
              value={remark}
              onChange={e => setRemark(e.target.value)}
              style={{ resize: 'none', marginBottom: '0.5rem' }}
            />
            <p style={{ fontSize: '0.72rem', color: (otherCentre && remark.trim().length < 3) ? 'var(--red)' : 'var(--text-muted)', marginBottom: dutyType === 'satsang' ? '0.5rem' : '1rem' }}>
              {otherCentre && remark.trim().length < 3 
                ? 'Remarks required for out-of-centre sewadar' 
                : (!otherCentre && dutyType !== 'satsang' ? 'Optional' : `Minimum 3 characters required`)}
            </p>
          </>
        )}

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
            {submitting ? 'Saving…' : dutyType === 'satsang' ? (satsangType === 'IN' ? 'Mark IN' : 'Mark OUT') : 'Save Entry'}
          </button>
        </div>
      </div>
    </div>
  )
}
