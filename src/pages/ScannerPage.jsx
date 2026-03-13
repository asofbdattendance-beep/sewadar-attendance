import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, EXCEPTION_DEPARTMENTS, getDistanceMetres, ROLES, isExceptionDept } from '../lib/supabase'
import { lookupBadgeOffline, getLastAttendance, addToAttendanceCache, addToOfflineQueue } from '../lib/offline'
import { useAuth } from '../context/AuthContext'
import BarcodeScanner from '../components/scanner/BarcodeScanner'
import { Wifi, WifiOff, MapPin, AlertTriangle, CheckCircle, XCircle, Clock, User } from 'lucide-react'

const DUPLICATE_WINDOW_MS = 120000

export default function ScannerPage({ isOnline }) {
  const { profile } = useAuth()
  const [userLocation, setUserLocation] = useState(null)
  const [centreConfig, setCentreConfig] = useState(null)
  const [childCentres, setChildCentres] = useState([])
  const [gpsStatus, setGpsStatus] = useState('loading')
  const [popupState, setPopupState] = useState(null)
  const [processing, setProcessing] = useState(false)

  const scannerRef = useRef(null)
  const lastScanRef = useRef({ badge: null, time: 0 })

  // Load centre config and child centres list
  useEffect(() => {
    if (!profile?.centre) return
    Promise.all([
      supabase.from('centres')
        .select('latitude,longitude,geo_radius,geo_enabled')
        .eq('centre_name', profile.centre)
        .maybeSingle(),
      supabase.from('centres')
        .select('centre_name')
        .eq('parent_centre', profile.centre)
    ]).then(([centreRes, childRes]) => {
      setCentreConfig(centreRes.data)
      const children = childRes.data?.map(c => c.centre_name) || []
      setChildCentres(children)
    })
  }, [profile?.centre])

  // GPS
  useEffect(() => {
    if (!navigator.geolocation) { setGpsStatus('failed'); return }
    let retries = 0
    const tryGet = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
          setGpsStatus('success')
        },
        () => { retries++ < 3 ? setTimeout(tryGet, 2000) : setGpsStatus('failed') },
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
        const [sRes, aRes] = await Promise.all([
          supabase.from('sewadars').select('*').eq('badge_number', badge).maybeSingle(),
          supabase.from('attendance')
            .select('*')
            .eq('badge_number', badge)
            .gte('scan_time', today.toISOString())
            .order('scan_time', { ascending: true })
        ])
        found = sRes.data
        todayEntries = aRes.data || []
      } else {
        found = lookupBadgeOffline(badge)
      }

      if (!found) {
        setPopupState({ type: 'not_found', badge })
        setProcessing(false)
        return
      }

      // Check duplicate within 2 minutes
      const lastEntry = todayEntries.length > 0 ? todayEntries[todayEntries.length - 1] : null
      if (lastEntry?.scan_time) {
        const diff = now - new Date(lastEntry.scan_time).getTime()
        if (diff < DUPLICATE_WINDOW_MS) {
          setPopupState({ type: 'recent', sewadar: found, lastEntry, badge })
          setProcessing(false)
          return
        }
      }

      // Determine allowed types
      const hasIn = todayEntries.some(e => e.type === 'IN')
      const hasOut = todayEntries.some(e => e.type === 'OUT')
      let allowedTypes = []
      if (!hasIn && !hasOut) allowedTypes = ['IN', 'OUT']
      else if (hasIn && !hasOut) allowedTypes = ['OUT']
      else if (!hasIn && hasOut) allowedTypes = ['IN']
      else {
        setPopupState({ type: 'both_done', sewadar: found, badge })
        setProcessing(false)
        return
      }

      const isSuperAdmin = profile?.role === ROLES.SUPER_ADMIN
      const isAdmin = profile?.role === ROLES.ADMIN
      const isSameCentre = found.centre === profile?.centre
      // Admin can scan own centre + all child centres without any confirmation
      const isChildCentre = isAdmin && childCentres.includes(found.centre)
      const isException = isExceptionDept(found.department)

      // Geo check
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

      // Auth check
      if (!isSuperAdmin && !isAdmin && !isSameCentre && !isException) {
        setPopupState({ type: 'auth_fail', sewadar: found, badge })
        setProcessing(false)
        return
      }

      // Admin scanning sub-centre badge: no confirmation needed
      if (isAdmin && isChildCentre) {
        setPopupState({ type: 'found', sewadar: found, badge, allowedTypes, hasIn, hasOut })
        setProcessing(false)
        return
      }

      // Exception dept from different centre: show confirmation first
      if (!isSuperAdmin && !isAdmin && !isSameCentre && isException) {
        setPopupState({ type: 'exception_confirm', sewadar: found, badge, allowedTypes, hasIn, hasOut })
        setProcessing(false)
        return
      }

      setPopupState({ type: 'found', sewadar: found, badge, allowedTypes, hasIn, hasOut })
      setProcessing(false)
    } catch (err) {
      console.error(err)
      setPopupState({ type: 'error', badge })
      setProcessing(false)
    }
  }, [isOnline, profile, userLocation, centreConfig, childCentres])

  const markAttendance = async (type) => {
    if (!popupState?.sewadar || !profile) return
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
      {/* Status bar */}
      <div className="scanner-status-bar">
        <span className="scanner-centre-name">{profile?.centre}</span>
        <div className="scanner-indicators">
          <span className={`scanner-pill ${isOnline ? 'pill-online' : 'pill-offline'}`}>
            {isOnline ? <Wifi size={11} /> : <WifiOff size={11} />}
            {isOnline ? 'Online' : 'Offline'}
          </span>
          <span className={`scanner-pill ${gpsStatus === 'success' ? 'pill-gps-ok' : gpsStatus === 'failed' ? 'pill-gps-fail' : 'pill-gps-loading'}`}>
            <MapPin size={11} />
            GPS {gpsStatus === 'success' ? '✓' : gpsStatus === 'failed' ? '✗' : '…'}
          </span>
        </div>
      </div>

      <BarcodeScanner ref={scannerRef} onScan={handleScan} />

      {processing && (
        <div className="scanner-processing">
          <div className="scanner-processing-dot" />
          Processing…
        </div>
      )}

      {/* ── POPUP ── */}
      {popupState && (
        <div className="popup-overlay" onClick={closePopup}>
          <div className="popup-card" onClick={e => e.stopPropagation()}>

            {/* FOUND */}
            {(popupState.type === 'found') && (
              <SewadarFoundCard
                sewadar={popupState.sewadar}
                allowedTypes={popupState.allowedTypes}
                hasIn={popupState.hasIn}
                hasOut={popupState.hasOut}
                onMark={markAttendance}
                onClose={closePopup}
              />
            )}

            {/* EXCEPTION CONFIRMATION — different centre, exception dept */}
            {popupState.type === 'exception_confirm' && (
              <div className="popup-exception">
                <div className="popup-exception-banner">
                  <AlertTriangle size={18} />
                  <span>Sewadar from another centre</span>
                </div>
                <div className="popup-exception-name">{popupState.sewadar.sewadar_name}</div>
                <div className="popup-exception-badge">{popupState.sewadar.badge_number}</div>
                <div className="popup-exception-detail">
                  <span>Centre</span>
                  <strong>{popupState.sewadar.centre}</strong>
                </div>
                <div className="popup-exception-detail">
                  <span>Dept</span>
                  <strong>{popupState.sewadar.department}</strong>
                </div>
                <p className="popup-exception-note">
                  This sewadar belongs to their respective centre. Confirm to mark attendance here.
                </p>
                <div className="popup-actions">
                  {popupState.allowedTypes?.includes('IN') && (
                    <button className="btn-in" onClick={() => {
                      setPopupState({ ...popupState, type: 'found' })
                      markAttendance('IN')
                    }}>IN</button>
                  )}
                  {popupState.allowedTypes?.includes('OUT') && (
                    <button className="btn-out" onClick={() => {
                      setPopupState({ ...popupState, type: 'found' })
                      markAttendance('OUT')
                    }}>OUT</button>
                  )}
                </div>
                <button className="btn-cancel" onClick={closePopup}>Cancel</button>
              </div>
            )}

            {/* RECENT */}
            {popupState.type === 'recent' && (
              <div className="popup-recent">
                <div className="popup-recent-icon">
                  <Clock size={28} color="#b45309" />
                </div>
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

            {/* NOT FOUND */}
            {popupState.type === 'not_found' && (
              <div className="popup-error">
                <XCircle size={32} color="#dc2626" style={{ margin: '0 auto 12px', display: 'block' }} />
                <div className="error-title">Badge Not Found</div>
                <div className="error-badge">{popupState.badge}</div>
                <div className="error-msg">This badge is not registered in the system</div>
                <button className="btn-cancel" onClick={closePopup}>Try Again</button>
              </div>
            )}

            {/* AUTH FAIL */}
            {popupState.type === 'auth_fail' && (
              <div className="popup-error">
                <XCircle size={32} color="#dc2626" style={{ margin: '0 auto 12px', display: 'block' }} />
                <div className="error-title">Not Authorised</div>
                <div className="error-name">{popupState.sewadar.sewadar_name}</div>
                <div className="error-msg">{popupState.sewadar.centre} — Different centre</div>
                <button className="btn-cancel" onClick={closePopup}>Try Another</button>
              </div>
            )}

            {/* GEO FAIL */}
            {popupState.type === 'geo_fail' && (
              <div className="popup-error">
                <MapPin size={32} color="#dc2626" style={{ margin: '0 auto 12px', display: 'block' }} />
                <div className="error-title">Outside Area</div>
                <div className="error-msg">{popupState.message} from centre</div>
                <div className="error-hint">Move closer and try again</div>
                <button className="btn-cancel" onClick={closePopup}>Try Again</button>
              </div>
            )}

            {/* BOTH DONE */}
            {popupState.type === 'both_done' && (
              <div className="popup-error">
                <CheckCircle size={32} color="#16a34a" style={{ margin: '0 auto 12px', display: 'block' }} />
                <div className="error-title" style={{ color: '#16a34a' }}>Already Complete</div>
                <div className="error-name">{popupState.sewadar.sewadar_name}</div>
                <div className="error-msg">IN and OUT already marked today</div>
                <button className="btn-cancel" onClick={closePopup}>Scan Another</button>
              </div>
            )}

            {/* SUCCESS */}
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

            {/* ERROR */}
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
    </div>
  )
}

// Extracted sewadar found card for cleanliness
function SewadarFoundCard({ sewadar, allowedTypes, hasIn, hasOut, onMark, onClose }) {
  return (
    <>
      <div className="popup-header">
        <div className="sewadar-info">
          <div className="name">{sewadar.sewadar_name}</div>
          <div className="badge" style={{ fontFamily: 'monospace', fontSize: 13, color: '#6b7280' }}>
            {sewadar.badge_number}
          </div>
        </div>
        <span className={`gender-badge ${sewadar.gender?.toUpperCase() === 'MALE' ? 'male' : 'female'}`}>
          {sewadar.gender}
        </span>
      </div>

      <div className="popup-details">
        <div className="detail">
          <span>Father/Husband</span>
          <span>{sewadar.father_husband_name || '—'}</span>
        </div>
        <div className="detail">
          <span>Age</span>
          <span>{sewadar.age || '—'}</span>
        </div>
        <div className="detail">
          <span>Centre</span>
          <span>{sewadar.centre}</span>
        </div>
        <div className="detail">
          <span>Dept</span>
          <span>{sewadar.department || '—'}</span>
        </div>
      </div>

      {(hasIn || hasOut) && (
        <div className="popup-status-msg">
          {hasIn && <span className="status-in">✓ IN marked</span>}
          {hasOut && <span className="status-out">✓ OUT marked</span>}
        </div>
      )}

      <div className="popup-actions">
        {allowedTypes?.includes('IN') && (
          <button className="btn-in" onClick={() => onMark('IN')}>IN</button>
        )}
        {allowedTypes?.includes('OUT') && (
          <button className="btn-out" onClick={() => onMark('OUT')}>OUT</button>
        )}
      </div>
      <button className="btn-cancel" onClick={onClose}>Cancel</button>
    </>
  )
}
