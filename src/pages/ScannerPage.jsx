import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, EXCEPTION_DEPARTMENTS, getDistanceMetres, ROLES, isExceptionDept } from '../lib/supabase'
import { lookupBadgeOffline, addToAttendanceCache, addToOfflineQueue, getOfflineQueueCount, syncOfflineQueue, getAttendanceCache } from '../lib/offline'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../App'
import BarcodeScanner from '../components/scanner/BarcodeScanner'
import { Wifi, WifiOff, MapPin, AlertTriangle, CheckCircle, XCircle, Clock, User, RefreshCw, Download, History, Radio, Search } from 'lucide-react'

let DUPLICATE_WINDOW_MS = 120000 // Default, will be loaded from app_settings

export default function ScannerPage({ isOnline }) {
  const { profile } = useAuth()
  const addToast = useToast()
  const [userLocation, setUserLocation] = useState(null)
  const [centreConfig, setCentreConfig] = useState(null)
  const [childCentres, setChildCentres] = useState([])
  const [gpsStatus, setGpsStatus] = useState('loading')
  const [popupState, setPopupState] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [offlineQueueCount, setOfflineQueueCount] = useState(0)
  const [activeSession, setActiveSession] = useState(null)
  const [inCount, setInCount] = useState(0)
  const [scanHistory, setScanHistory] = useState([])

  const scannerRef = useRef(null)
  const lastScanRef = useRef({ badge: null, time: 0 })
  const watchIdRef = useRef(null)

  // Load app settings and session
  useEffect(() => {
    async function loadSettings() {
      const { data } = await supabase.from('app_settings').select('settings_json').eq('id', 'global').single()
      if (data?.settings_json?.duplicate_window_ms) {
        DUPLICATE_WINDOW_MS = parseInt(data.settings_json.duplicate_window_ms)
      }
    }
    loadSettings()
  }, [])

  // Load active session
  useEffect(() => {
    async function loadSession() {
      const today = new Date().toISOString().split('T')[0]
      const { data } = await supabase
        .from('sessions')
        .select('*')
        .eq('is_active', true)
        .eq('session_date', today)
        .single()
      if (data) setActiveSession(data)
    }
    loadSession()
  }, [])

  // Update offline queue count periodically
  useEffect(() => {
    const updateQueue = () => setOfflineQueueCount(getOfflineQueueCount())
    updateQueue()
    const interval = setInterval(updateQueue, 3000)
    return () => clearInterval(interval)
  }, [])

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

  // GPS Watch Position (Continuous)
  useEffect(() => {
    if (!navigator.geolocation) { setGpsStatus('failed'); return }

    const options = {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000
    }

    const successHandler = (pos) => {
      setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
      setGpsStatus('success')
    }

    const errorHandler = () => {
      setGpsStatus('failed')
    }

    watchIdRef.current = navigator.geolocation.watchPosition(successHandler, errorHandler, options)

    return () => {
      if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
  }, [])

  // Realtime subscription for IN count
  useEffect(() => {
    const channel = supabase
      .channel('attendance-scanner')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance' }, (payload) => {
        // Update IN count if new IN record
        if (payload.new.type === 'IN') {
          setInCount(prev => prev + 1)
        } else if (payload.new.type === 'OUT') {
          setInCount(prev => Math.max(0, prev - 1))
        }
        // Add to history for recent scans display
        setScanHistory(prev => [payload.new, ...prev].slice(0, 5))
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  // Load initial IN count
  useEffect(() => {
    async function loadInCount() {
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const { data } = await supabase
        .from('attendance')
        .select('*')
        .eq('type', 'IN')
        .gte('scan_time', today.toISOString())
      setInCount(data?.length || 0)
    }
    loadInCount()
  }, [])

  const playSound = useCallback((type) => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)()
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()

      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)

      if (type === 'IN') {
        oscillator.frequency.value = 800 // Higher tone for IN
        oscillator.type = 'sine'
      } else {
        oscillator.frequency.value = 400 // Lower tone for OUT
        oscillator.type = 'sine'
      }

      gainNode.gain.value = 0.3
      oscillator.start()
      oscillator.stop(audioContext.currentTime + 0.1)

      // Haptic feedback if available
      if (navigator.vibrate) {
        navigator.vibrate(type === 'IN' ? 100 : 50)
      }
    } catch (e) {
      // Sound not available
    }
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
        // Check offline cache for today's entries
        const cached = getAttendanceCache()
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        todayEntries = cached.filter(r => 
          r.badge_number === badge && 
          new Date(r.scan_time) >= today
        ).sort((a, b) => new Date(a.scan_time) - new Date(b.scan_time))
      }

      if (!found) {
        setPopupState({ type: 'not_found', badge })
        setProcessing(false)
        return
      }

      // Check duplicate within window
      const lastEntry = todayEntries.length > 0 ? todayEntries[todayEntries.length - 1] : null
      if (lastEntry?.scan_time) {
        const diff = now - new Date(lastEntry.scan_time).getTime()
        if (diff < DUPLICATE_WINDOW_MS) {
          setPopupState({ type: 'recent', sewadar: found, lastEntry, badge })
          setProcessing(false)
          return
        }
      }

      // Determine allowed types using ladder logic (last scan determines next)
      const hasIn = todayEntries.some(e => e.type === 'IN')
      const hasOut = todayEntries.some(e => e.type === 'OUT')
      let allowedTypes = []
      if (!hasIn && !hasOut) {
        // First scan of the day - can do IN or OUT (flexible)
        allowedTypes = ['IN', 'OUT']
      } else if (hasIn && !hasOut) {
        // Already have IN, next must be OUT
        allowedTypes = ['OUT']
      } else if (!hasIn && hasOut) {
        // Already have OUT, next must be IN (rare case)
        allowedTypes = ['IN']
      } else {
        // Both IN and OUT already done
        setPopupState({ type: 'both_done', sewadar: found, badge })
        setProcessing(false)
        return
      }

      const isSuperAdmin = profile?.role === ROLES.SUPER_ADMIN
      const isAdmin = profile?.role === ROLES.ADMIN
      const isSameCentre = found.centre === profile?.centre
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

  const markAttendance = async (type, manualRecord = null) => {
    const sewadarData = manualRecord || popupState?.sewadar
    if (!sewadarData || !profile) return
    const scanTime = new Date().toISOString()
    const record = {
      badge_number: sewadarData.badge_number,
      sewadar_name: sewadarData.sewadar_name,
      centre: sewadarData.centre,
      department: sewadarData.department,
      type,
      scan_time: scanTime,
      scanner_badge: profile.badge_number || 'UNKNOWN',
      scanner_name: profile.name || 'Unknown',
      scanner_centre: profile.centre || 'UNKNOWN',
      latitude: userLocation?.lat || null,
      longitude: userLocation?.lng || null,
      device_id: navigator.userAgent.slice(0, 50),
      session_id: activeSession?.id || null
    }

    let success = false
    if (isOnline) {
      const { error } = await supabase.from('attendance').insert(record)
      if (!error) {
        await supabase.from('logs').insert({
          user_badge: profile.badge_number,
          action: 'MARK_ATTENDANCE',
          details: `Marked ${type} for ${sewadarData.badge_number}`,
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
      playSound(type)
      setPopupState({ type: 'success', sewadar: sewadarData, attendanceType: type, time: scanTime })
      setTimeout(closePopup, 2000)
    }
  }

  const closePopup = () => {
    setPopupState(null)
    lastScanRef.current = { badge: null, time: 0 }
    if (scannerRef.current) scannerRef.current.resume()
  }

  const syncQueue = async () => {
    if (!isOnline) return
    const result = await syncOfflineQueue(supabase)
    setOfflineQueueCount(0)
    if (result.failed > 0) {
      addToast(`Synced ${result.synced} records, ${result.failed} failed`, 'error')
    } else {
      addToast(`Synced ${result.synced} records successfully`, 'success')
    }
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
          {offlineQueueCount > 0 && (
            <span className="scanner-pill pill-queue" onClick={syncQueue} title="Tap to sync" style={{ background: 'var(--office-amber-bg)', color: 'var(--office-amber)', border: '1px solid var(--office-amber-border)' }}>
              <RefreshCw size={11} />
              {offlineQueueCount} pending
            </span>
          )}
        </div>
      </div>

      {/* Live IN count */}
      <div className="live-in-count">
        <Radio size={14} className="pulse-dot" />
        <span>Inside Now: <strong>{inCount}</strong></span>
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
                isSuperAdmin={profile?.role === ROLES.SUPER_ADMIN}
                scanHistory={scanHistory}
              />
            )}

            {/* EXCEPTION CONFIRMATION */}
            {popupState.type === 'exception_confirm' && (
              <div className="popup-exception">
                <div className="popup-exception-banner">
                  <AlertTriangle size={18} />
                  <span>Sewadar from another centre</span>
                </div>
                <div className="popup-exception-name">{popupState.sewadar.sewadar_name}</div>
                <div className="popup-exception-badge">{popupState.sewadar.badge_number}</div>
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

      {/* Session indicator */}
      {activeSession && (
        <div className="session-indicator">
          <History size={12} />
          <span>{activeSession.name}</span>
        </div>
      )}
    </div>
  )
}

// Extracted sewadar found card for cleanliness
function SewadarFoundCard({ sewadar, allowedTypes, hasIn, hasOut, onMark, onClose, isSuperAdmin, scanHistory }) {
  const [showManualEntry, setShowManualEntry] = useState(false)
  const [manualSearch, setManualSearch] = useState('')
  const [manualResults, setManualResults] = useState([])
  const [selectedManualSewadar, setSelectedManualSewadar] = useState(null)

  const searchManual = async () => {
    if (!manualSearch.trim()) return
    const { data } = await supabase
      .from('sewadars')
      .select('*')
      .or(`sewadar_name.ilike.%${manualSearch}%,badge_number.ilike.%${manualSearch.toUpperCase()}%`)
      .limit(10)
    setManualResults(data || [])
  }

  const handleManualMark = (type) => {
    if (!selectedManualSewadar) return
    const record = {
      badge_number: selectedManualSewadar.badge_number,
      sewadar_name: selectedManualSewadar.sewadar_name,
      centre: selectedManualSewadar.centre,
      department: selectedManualSewadar.department,
    }
    setShowManualEntry(false)
    setSelectedManualSewadar(null)
    onMark(type, record)
  }

  return (
    <>
      <div className="popup-header">
        <div className="sewadar-info">
          <div className="name">{sewadar.sewadar_name}</div>
          <div className="badge" style={{ fontFamily: 'monospace', fontSize: 13, color: '#6b7280' }}>
            {sewadar.badge_number}
          </div>
        </div>
        <span className={`gender-badge ${(sewadar.gender?.toUpperCase() || 'MALE') === 'MALE' ? 'male' : 'female'}`}>
          {sewadar.gender || 'Unknown'}
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

      {/* Scan history indicator */}
      {scanHistory.length > 0 && (
        <div className="scan-history-indicator">
          {scanHistory.slice(0, 3).map((scan, i) => (
            <div key={i} className={`scan-dot ${scan.type === 'IN' ? 'dot-in' : 'dot-out'}`} title={scan.sewadar_name} />
          ))}
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

      {/* Manual entry for super admin */}
      {isSuperAdmin && (
        <button className="btn-manual-entry" onClick={() => setShowManualEntry(true)}>
          <User size={14} /> Manual Entry
        </button>
      )}

      <button className="btn-cancel" onClick={onClose}>Cancel</button>

      {/* Manual entry modal */}
      {showManualEntry && (
        <div className="overlay" onClick={() => { setShowManualEntry(false); setSelectedManualSewadar(null) }}>
          <div className="overlay-sheet" onClick={e => e.stopPropagation()}>
            <h3 style={{ fontWeight: 700, marginBottom: '1rem', color: 'var(--office-text)' }}>Manual Attendance</h3>
            <div className="flex gap-1 mb-3">
              <input
                className="input"
                placeholder="Search by name or badge..."
                value={manualSearch}
                onChange={e => setManualSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchManual()}
              />
              <button className="btn btn-gold" onClick={searchManual}>
                <Search size={16} />
              </button>
            </div>
            
            {selectedManualSewadar ? (
              <div className="manual-selected-card">
                <div className="manual-selected-name">{selectedManualSewadar.sewadar_name}</div>
                <div className="manual-selected-meta">
                  <span>{selectedManualSewadar.badge_number}</span>
                  <span>{selectedManualSewadar.centre}</span>
                </div>
                <div className="manual-selected-actions">
                  <button className="btn-in" onClick={() => handleManualMark('IN')}>IN</button>
                  <button className="btn-out" onClick={() => handleManualMark('OUT')}>OUT</button>
                </div>
                <button className="btn-cancel" onClick={() => setSelectedManualSewadar(null)}>Select Different</button>
              </div>
            ) : (
              <div className="manual-results-list">
                {manualResults.map(s => (
                  <div key={s.id} className="manual-result" onClick={() => setSelectedManualSewadar(s)}>
                    <span>{s.sewadar_name}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--gold)' }}>{s.badge_number}</span>
                  </div>
                ))}
                {manualResults.length === 0 && manualSearch && (
                  <p className="text-muted text-sm text-center">No results found</p>
                )}
              </div>
            )}
            <button className="btn-cancel" onClick={() => { setShowManualEntry(false); setSelectedManualSewadar(null) }}>Close</button>
          </div>
        </div>
      )}
    </>
  )
}
