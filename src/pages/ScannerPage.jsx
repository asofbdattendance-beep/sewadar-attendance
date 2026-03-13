import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, EXCEPTION_DEPARTMENTS, getDistanceMetres, ROLES } from '../lib/supabase'
import { lookupBadgeOffline, getLastAttendance, addToAttendanceCache, addToOfflineQueue } from '../lib/offline'
import { useAuth } from '../context/AuthContext'
import BarcodeScanner from '../components/scanner/BarcodeScanner'

const DUPLICATE_WINDOW_MS = 120000

export default function ScannerPage({ isOnline }) {
  const { profile } = useAuth()
  const [userLocation, setUserLocation] = useState(null)
  const [centreConfig, setCentreConfig] = useState(null)
  const [gpsStatus, setGpsStatus] = useState('loading')
  const [popupState, setPopupState] = useState(null)
  const [processing, setProcessing] = useState(false)

  const scannerRef = useRef(null)
  const lastScanRef = useRef({ badge: null, time: 0 })
  const popupRef = useRef(null)

  useEffect(() => {
    if (!profile?.centre) return
    supabase
      .from('centres')
      .select('latitude,longitude,geo_radius,geo_enabled')
      .eq('centre_name', profile.centre)
      .maybeSingle()
      .then(({ data }) => setCentreConfig(data))
  }, [profile?.centre])

  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsStatus('failed')
      return
    }
    let retries = 0
    const tryGet = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
          setGpsStatus('success')
        },
        () => {
          retries++ < 3 ? setTimeout(tryGet, 2000) : setGpsStatus('failed')
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
      )
    }
    tryGet()
  }, [])

  const handleScan = useCallback(async (badge) => {
    const now = Date.now()
    if (badge === lastScanRef.current.badge && now - lastScanRef.current.time < 2000) return
    
    lastScanRef.current = { badge, time: now }
    setProcessing(true)

    try {
      let found = null
      let todayEntries = []
      
      if (isOnline) {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const todayStart = today.toISOString()

        const [sRes, aRes] = await Promise.all([
          supabase.from('sewadars').select('*').eq('badge_number', badge).maybeSingle(),
          supabase.from('attendance')
            .select('*')
            .eq('badge_number', badge)
            .gte('scan_time', todayStart)
            .order('scan_time', { ascending: true })
        ])
        found = sRes.data
        todayEntries = aRes.data || []
      } else {
        found = lookupBadgeOffline(badge)
        // For offline, we can't easily check today's entries
      }

      if (!found) {
        setPopupState({ type: 'not_found', badge, sewadar: null })
        setProcessing(false)
        return
      }

      // Check for existing IN/OUT today
      const hasIn = todayEntries.some(e => e.type === 'IN')
      const hasOut = todayEntries.some(e => e.type === 'OUT')
      const lastEntry = todayEntries.length > 0 ? todayEntries[todayEntries.length - 1] : null

      // Check duplicate within 2 minutes
      if (lastEntry?.scan_time) {
        const diff = now - new Date(lastEntry.scan_time).getTime()
        if (diff < DUPLICATE_WINDOW_MS) {
          setPopupState({ type: 'recent', sewadar: found, lastEntry, badge })
          setProcessing(false)
          return
        }
      }

      // Determine what types are allowed today
      let allowedTypes = []
      if (!hasIn && !hasOut) {
        allowedTypes = ['IN', 'OUT'] // Can do either first
      } else if (hasIn && !hasOut) {
        allowedTypes = ['OUT'] // Must do OUT after IN
      } else if (!hasIn && hasOut) {
        allowedTypes = ['IN'] // Must do IN after OUT
      } else {
        // Both already done today
        setPopupState({ type: 'both_done', sewadar: found, badge })
        setProcessing(false)
        return
      }

      const isExcept = EXCEPTION_DEPARTMENTS.some(d => d.toLowerCase() === (found.department || '').toLowerCase())
      const isSameCentre = found.centre === profile?.centre
      const isSuperAdmin = profile?.role === ROLES.SUPER_ADMIN

      if (!isSuperAdmin && !isSameCentre && !isExcept) {
        setPopupState({ type: 'auth_fail', sewadar: found, badge })
        setProcessing(false)
        return
      }

      if (found.geo_required && userLocation && centreConfig?.geo_enabled) {
        if (centreConfig.latitude && centreConfig.longitude) {
          const dist = getDistanceMetres(userLocation.lat, userLocation.lng, centreConfig.latitude, centreConfig.longitude)
          if (dist > (centreConfig.geo_radius || 200)) {
            setPopupState({ type: 'geo_fail', sewadar: found, message: `${Math.round(dist)}m away`, badge })
            setProcessing(false)
            return
          }
        }
      }

      // Show allowed types to user
      setPopupState({ type: 'found', sewadar: found, badge, allowedTypes, hasIn, hasOut })
      setProcessing(false)
    } catch (err) {
      console.error(err)
      setPopupState({ type: 'error', badge })
      setProcessing(false)
    }
  }, [isOnline, profile, userLocation, centreConfig])

  const markAttendance = async (type) => {
    if (!popupState.sewadar || !profile) return
    const scanTime = new Date().toISOString()
    const record = {
      badge_number: popupState.sewadar.badge_number,
      sewadar_name: popupState.sewadar.sewadar_name,
      centre: popupState.sewadar.centre,
      department: popupState.sewadar.department,
      type,
      scan_time: scanTime,
      scanner_badge: profile.badge_number || 'UNKNOWN',
      scanner_name: profile.name || 'Unknown',
      scanner_centre: profile.centre || 'UNKNOWN',
      latitude: userLocation?.lat || null,
      longitude: userLocation?.lng || null,
      device_id: navigator.userAgent.slice(0, 50)
    }

    let success = false
    if (isOnline) {
      const { error } = await supabase.from('attendance').insert(record)
      if (!error) {
        await supabase.from('logs').insert({
          user_badge: profile.badge_number,
          action: 'MARK_ATTENDANCE',
          details: `Marked ${type} for ${popupState.sewadar.badge_number}`,
          timestamp: scanTime
        })
        success = true
      }
    } else {
      addToOfflineQueue(record)
      success = true
    }
    addToAttendanceCache(record)

    if (success) {
      setPopupState({ type: 'success', sewadar: popupState.sewadar, attendanceType: type, time: scanTime })
      setTimeout(closePopup, 2000)
    }
  }

  const closePopup = () => {
    setPopupState(null)
    lastScanRef.current = { badge: null, time: 0 }
    if (scannerRef.current) scannerRef.current.resume()
  }

  return (
    <div className="page pb-nav">
      <div className="header">
        <h2>Scan Badge</h2>
        <div className="status-row">
          <span>{profile?.centre}</span>
          <span className={isOnline ? 'online' : 'offline'}>{isOnline ? 'Online' : 'Offline'}</span>
          <span className={`gps ${gpsStatus}`}>GPS: {gpsStatus === 'success' ? '✓' : gpsStatus === 'failed' ? '✗' : '...'}</span>
        </div>
      </div>

      <BarcodeScanner ref={scannerRef} onScan={handleScan} />

      {processing && <div className="processing-msg">Processing...</div>}

      {popupState && (
        <div className="popup-overlay" onClick={closePopup}>
          <div className="popup-card" onClick={e => e.stopPropagation()}>
            {popupState.type === 'found' && popupState.sewadar && (
              <>
                <div className="popup-header">
                  <div className="sewadar-info">
                    <div className="name">{popupState.sewadar.sewadar_name}</div>
                    <div className="badge">{popupState.sewadar.badge_number}</div>
                  </div>
                  <span className={`gender-badge ${popupState.sewadar.gender?.toUpperCase() === 'MALE' ? 'male' : 'female'}`}>
                    {popupState.sewadar.gender}
                  </span>
                </div>
                <div className="popup-details">
                  <div className="detail"><span>Father/Husband</span>{popupState.sewadar.father_husband_name || '—'}</div>
                  <div className="detail"><span>Age</span>{popupState.sewadar.age || '—'}</div>
                  <div className="detail"><span>Centre</span>{popupState.sewadar.centre}</div>
                  <div className="detail"><span>Dept</span>{popupState.sewadar.department || '—'}</div>
                </div>
                <div className="popup-status-msg">
                  {popupState.hasIn && <span className="status-in">IN marked</span>}
                  {popupState.hasOut && <span className="status-out">OUT marked</span>}
                </div>
                <div className="popup-actions">
                  {popupState.allowedTypes?.includes('IN') && (
                    <button className="btn-in" onClick={() => markAttendance('IN')}>IN</button>
                  )}
                  {popupState.allowedTypes?.includes('OUT') && (
                    <button className="btn-out" onClick={() => markAttendance('OUT')}>OUT</button>
                  )}
                </div>
                <button className="btn-cancel" onClick={closePopup}>Cancel</button>
              </>
            )}

            {popupState.type === 'recent' && popupState.sewadar && (
              <div className="popup-recent">
                <div className="recent-name">{popupState.sewadar.sewadar_name}</div>
                <div className="recent-badge">{popupState.sewadar.badge_number}</div>
                <div className="recent-entry">
                  <span className={popupState.lastEntry.type === 'IN' ? 'text-green' : 'text-red'}>
                    {popupState.lastEntry.type}
                  </span>
                  <span>{new Date(popupState.lastEntry.scan_time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="recent-msg">Already marked within 2 min</div>
                <button className="btn-cancel" onClick={closePopup}>Scan Another</button>
              </div>
            )}

            {popupState.type === 'not_found' && (
              <div className="popup-error">
                <div className="error-title">Badge Not Found</div>
                <div className="error-badge">{popupState.badge}</div>
                <div className="error-msg">This badge is not registered</div>
                <button className="btn-cancel" onClick={closePopup}>Try Again</button>
              </div>
            )}

            {popupState.type === 'auth_fail' && (
              <div className="popup-error">
                <div className="error-title">Not Authorized</div>
                <div className="error-name">{popupState.sewadar.sewadar_name}</div>
                <div className="error-msg">{popupState.sewadar.centre} — Different centre</div>
                <button className="btn-cancel" onClick={closePopup}>Try Another</button>
              </div>
            )}

            {popupState.type === 'geo_fail' && (
              <div className="popup-error">
                <div className="error-title">Outside Area</div>
                <div className="error-msg">{popupState.message} from centre</div>
                <div className="error-hint">Move closer and try again</div>
                <button className="btn-cancel" onClick={closePopup}>Try Again</button>
              </div>
            )}

            {popupState.type === 'both_done' && (
              <div className="popup-error">
                <div className="error-title">Already Completed</div>
                <div className="error-name">{popupState.sewadar.sewadar_name}</div>
                <div className="error-msg">IN and OUT already marked today</div>
                <button className="btn-cancel" onClick={closePopup}>Scan Another</button>
              </div>
            )}

            {popupState.type === 'success' && (
              <div className="popup-success">
                <div className="success-title">Marked!</div>
                <div className="success-name">{popupState.sewadar.sewadar_name}</div>
                <div className="success-type">{popupState.attendanceType} — {new Date(popupState.time).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            )}

            {popupState.type === 'error' && (
              <div className="popup-error">
                <div className="error-title">Error</div>
                <div className="error-msg">Something went wrong</div>
                <button className="btn-cancel" onClick={closePopup}>Try Again</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
