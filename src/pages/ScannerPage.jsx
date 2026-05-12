import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, ROLES, DUTY_TYPES, SESSION_STATUS, getDutyType, formatTime12Hour, getLocalDate } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { logAction } from '../lib/logger'
import BarcodeScanner from '../components/scanner/BarcodeScanner'
import { Wifi, WifiOff, CheckCircle, XCircle, Clock, AlertTriangle, Keyboard, Search, Info, MapPin, RefreshCw } from 'lucide-react'

// Geofencing: Calculate distance between two coordinates using Haversine formula
function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000 // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export default function ScannerPage({ isOnline }) {
  const { profile } = useAuth()
  const [popupState, setPopupState] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [recentScans, setRecentScans] = useState([])
  const [forgotOutData, setForgotOutData] = useState(null)
  const [childCentres, setChildCentres] = useState([])
  const [specialDepts, setSpecialDepts] = useState([])
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
  const [manualForgotOutData, setManualForgotOutData] = useState(null)
  const [manualTimeError, setManualTimeError] = useState('')

  const scannerRef = useRef(null)
  const lastScanRef = useRef({ badge: null, time: 0 })
  const manualSearchTimeout = useRef(null)
  const popupOpenRef = useRef(false)
  const scopeLoadedRef = useRef(false)
  const [geoCheckDone, setGeoCheckDone] = useState(false)
  const [geoBlocked, setGeoBlocked] = useState(false)
  const [geoDistance, setGeoDistance] = useState(null)
  const [geoLoading, setGeoLoading] = useState(true)

  const fetchRecentScans = useCallback(async () => {
    if (!profile?.centre) return
    const today = new Date(); today.setHours(0, 0, 0, 0)
    let q = supabase.from('attendance_sessions')
      .select('id,badge_number,sewadar_name,status,in_date,in_time,out_time,duty_type')
      .eq('in_scanner_centre', profile.centre)
      .gte('in_date', getLocalDate(today))
      .order('in_time', { ascending: false })
      .limit(10)
    const { data } = await q
    setRecentScans(data || [])
  }, [profile?.centre])

  useEffect(() => {
    if (!profile?.centre) return
    fetchRecentScans()
  }, [profile?.centre, fetchRecentScans])

  // Geofencing: Check location on page load
  useEffect(() => {
    const checkGeoLocation = async () => {
      const isASO = profile?.role === ROLES.ASO || profile?.role === ROLES.SUPER_ADMIN

      // ASO is exempt from geofencing
      if (isASO) {
        setGeoCheckDone(true)
        setGeoLoading(false)
        return
      }

      // Check if centre has geofencing enabled
      const { data: centreData } = await supabase
        .from('centres')
        .select('latitude, longitude, geo_radius, geo_enabled')
        .eq('name', profile.centre)
        .single()

      if (!centreData?.geo_enabled || !centreData?.latitude || !centreData?.longitude) {
        setGeoCheckDone(true)
        setGeoLoading(false)
        return
      }

      try {
        const position = await new Promise((resolve, reject) => {
          if (!navigator.geolocation) {
            reject(new Error('Geolocation not supported'))
            return
          }
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000
          })
        })

        const userLat = position.coords.latitude
        const userLon = position.coords.longitude
        const distance = getDistanceFromLatLonInMeters(userLat, userLon, centreData.latitude, centreData.longitude)
        const radius = centreData.geo_radius || 200

        console.log(`Initial geo check: ${distance.toFixed(0)}m from centre (max ${radius}m)`)

        if (distance > radius) {
          setGeoBlocked(true)
          setGeoDistance(Math.round(distance))
        }
      } catch (geoError) {
        console.warn('Geo check failed:', geoError.message)
        // Allow if location check fails
      }

      setGeoCheckDone(true)
      setGeoLoading(false)
    }

    if (profile?.centre) {
      checkGeoLocation()
    }
  }, [profile?.centre, profile?.role])

  useEffect(() => {
    if (!profile?.centre) return
    const channel = supabase.channel('scanner-scans')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance_sessions' }, () => fetchRecentScans())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [profile?.centre, fetchRecentScans])

  useEffect(() => {
    if (profile?.centre) {
      Promise.all([
        supabase.from('centres').select('name').eq('parent_centre', profile.centre),
        supabase.from('special_departments').select('department_name')
      ]).then(([centresResult, deptsResult]) => {
        setChildCentres(centresResult.data?.map(c => c.name) || [])
        const depts = deptsResult.data?.map(d => d.department_name?.trim().toUpperCase()) || []
        setSpecialDepts(depts)
        scopeLoadedRef.current = true
      }).catch(err => {
        console.error('Failed to load scope data:', err)
        scopeLoadedRef.current = true
      })
    } else {
      scopeLoadedRef.current = true
    }
  }, [profile?.centre])

  const isInScope = (sewadarCentre, department) => {
    if (!profile?.centre) return true
    const scope = [profile?.centre, ...childCentres]
    if (sewadarCentre && scope.includes(sewadarCentre)) return true
    if (scopeLoadedRef.current && !specialDepts.length) return true
    if (department) {
      const deptUpper = department.trim().toUpperCase()
      if (specialDepts.includes(deptUpper)) return true
    }
    return false
  }

const handleScan = useCallback(async (badge) => {
    const now = Date.now()
    console.log('=== handleScan START ===', badge)
    console.log('popupOpenRef:', popupOpenRef.current)
    console.log('lastScanRef:', lastScanRef.current)
    
    if (popupOpenRef.current) {
      console.log('Blocked: popup already showing')
      return
    }
    if (badge === lastScanRef.current.badge && now - lastScanRef.current.time < 2000) {
      console.log('Rejected: too soon')
      return
    }
    if (!profile?.centre) {
      console.log('Rejected: no centre')
      return
    }
    lastScanRef.current = { badge, time: now }
    console.log('Updated lastScanRef:', lastScanRef.current)
    
    if (!scopeLoadedRef.current) {
      console.log('Blocked: scope data not loaded yet')
      setProcessing(false)
      return
    }
    setProcessing(true)

    console.log('Fetching sewadar:', badge)

    try {
      let found = null
      if (isOnline) {
        const { data } = await supabase.rpc('get_sewadar_by_badge', { p_badge: badge }).maybeSingle()
        found = data
      }

      if (!found) {
        setPopupState({ type: 'not_found', badge })
        popupOpenRef.current = true
        setProcessing(false)
        return
      }

      if (!isInScope(found.centre, found.department)) {
        setPopupState({ type: 'not_in_scope', sewadar: found })
        popupOpenRef.current = true
        setProcessing(false)
        return
      }

      // Check if user is within their centre's geo-fence radius
      // SKIP for ASO/Super Admin — they can scan from anywhere
      const isASO = profile?.role === ROLES.ASO || profile?.role === ROLES.SUPER_ADMIN
      if (!isASO && profile?.centre) {
        const { data: centreData } = await supabase
          .from('centres')
          .select('latitude, longitude, geo_radius, geo_enabled')
          .eq('name', profile.centre)
          .single()

        if (centreData?.geo_enabled && centreData?.latitude && centreData?.longitude) {
          try {
            const position = await new Promise((resolve, reject) => {
              if (!navigator.geolocation) {
                reject(new Error('Geolocation not supported'))
                return
              }
              navigator.geolocation.getCurrentPosition(resolve, reject, {
                enableHighAccuracy: true,
                timeout: 5000,
                maximumAge: 30000
              })
            })

            const userLat = position.coords.latitude
            const userLon = position.coords.longitude
            const distance = getDistanceFromLatLonInMeters(userLat, userLon, centreData.latitude, centreData.longitude)
            const radius = centreData.geo_radius || 200

            console.log(`Geo check: ${distance.toFixed(0)}m from centre (max ${radius}m)`)

            if (distance > radius) {
              setPopupState({
                type: 'out_of_range',
                sewadar: found,
                distance: Math.round(distance),
                radius: radius,
                centre: profile.centre
              })
              popupOpenRef.current = true
              setProcessing(false)
              return
            }
          } catch (geoError) {
            console.warn('Geo check failed:', geoError.message)
          }
        }
      }

      let openSession = null
      if (isOnline) {
        const { data } = await supabase.rpc('get_open_session', { p_badge: badge })
        openSession = data && data.badge_number ? data : null
      }

      const dutyType = getDutyType()
      const today = new Date()
      const todayStr = getLocalDate(today)
      const currentTime = today.toTimeString().slice(0, 5)

      console.log('openSession:', openSession)

      if (openSession) {
        if (scannerRef.current) scannerRef.current.stop()
        popupOpenRef.current = true

        const inDate = new Date(openSession.in_date + 'T12:00:00')
        const hoursSinceIn = (today - inDate) / (1000 * 60 * 60)

        // If OPEN session is >12 hours old, assume sewadar forgot to mark OUT
        // Show forgot_out prompt instead of normal OUT

        if (hoursSinceIn > 12) {
          setPopupState({ type: 'forgot_out', sewadar: found, openSession, dutyType })
        } else {
          setPopupState({ type: 'out', sewadar: found, openSession })
        }
      } else {
        if (scannerRef.current) scannerRef.current.stop()
        popupOpenRef.current = true

        setPopupState({ type: 'in', sewadar: found, dutyType, inDate: todayStr, inTime: currentTime })
      }
    } catch (err) {
      console.error('Scan error:', err)
      setPopupState({ type: 'not_found', badge })
      popupOpenRef.current = true
    }

    setProcessing(false)
  }, [isOnline, profile, childCentres, specialDepts])

  const markIN = async (customTime = null) => {
    if (!popupState?.sewadar || !profile) return

    const sewadar = popupState.sewadar
    const now = new Date()
    const inDate = customTime?.date || getLocalDate(now)
    const inTime = customTime?.time || now.toTimeString().slice(0, 5)

    if (navigator.vibrate) navigator.vibrate([40])

    if (isOnline) {
      try {
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
        const { data, error } = await supabase.from('attendance_sessions').insert(record).select().single()
        if (error) {
          if (error.code === '23505') {
            const { data: existingSession } = await supabase.rpc('get_open_session', { p_badge: sewadar.badge_number })
            if (existingSession && existingSession.badge_number) {
              setTimeout(() => setPopupState({ type: 'out', sewadar, openSession: existingSession }), 1600)
              return
            }
          }
          console.error('Failed to insert session:', error)
          return
        }
        await logAction(profile?.badge_number, profile?.name, 'SCAN_IN', {
          badge: sewadar.badge_number,
          name: sewadar.sewadar_name,
          centre: profile?.centre,
          duty: getDutyType()
        })
        setPopupState({ type: 'success', action: 'IN', sewadar, time: formatTime12Hour(inTime) })
        fetchRecentScans()
      } catch (err) {
        console.error('Failed to insert session:', err)
        return
      }
    } else {
      setPopupState({ type: 'success', action: 'IN', sewadar, time: formatTime12Hour(inTime) })
    }

    setTimeout(closePopup, 1500)
  }

  const markOUT = async (forgotDate = null, forgotTime = null) => {
    if (!popupState?.openSession || !profile) return
    const now = new Date()
    const outDate = forgotDate || getLocalDate(now)
    const outTime = forgotTime || now.toTimeString().slice(0, 5)

    const sessionId = typeof popupState.openSession === 'object' ? popupState.openSession.id : popupState.openSession

    if (navigator.vibrate) navigator.vibrate([40, 30, 40])

    if (isOnline) {
      try {
        const { error } = await supabase.rpc('close_session', {
          p_session_id: sessionId,
          p_out_date: outDate,
          p_out_time: outTime,
          p_out_scanner_badge: profile?.badge_number,
          p_out_scanner_name: profile?.name,
          p_out_scanner_centre: profile?.centre || popupState?.sewadar?.centre || 'UNKNOWN'
        })
        if (error) {
          console.error('Failed to close session:', error)
          return
        }
        await logAction(profile?.badge_number, profile?.name, 'SCAN_OUT', {
          badge: popupState?.sewadar?.badge_number,
          name: popupState?.sewadar?.sewadar_name,
          session_id: sessionId
        })
        setPopupState({ type: 'success', action: 'OUT', sewadar: popupState.sewadar, time: formatTime12Hour(outTime) })
        fetchRecentScans()
      } catch (err) {
        console.error('Failed to close session:', err)
        return
      }
    } else {
      setPopupState({ type: 'success', action: 'OUT', sewadar: popupState.sewadar, time: formatTime12Hour(outTime) })
    }

    setTimeout(closePopup, 1500)
  }

  const closePopup = () => {
    setPopupState(null)
    setForgotOutData(null)
    lastScanRef.current = { badge: null, time: 0 }
    popupOpenRef.current = false
    if (scannerRef.current) scannerRef.current.restart()
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
    setManualForgotOutData(null)
    setManualTimeError('')
  }

  const searchSewadars = async (query) => {
    if (!query || query.length < 2) {
      setManualResults([])
      return
    }

    setManualLoading(true)
    const term = query.replace(/[%_]/g, '').toUpperCase().slice(0, 50)

    let data = null
    if (profile?.role === ROLES.SC_SP_USER && profile?.centre) {
      const scope = [profile.centre, ...childCentres]
      const { data: d } = await supabase.from('sewadars').select('*').in('centre', scope).or(`badge_number.ilike.%${term}%,sewadar_name.ilike.%${term}%`).limit(20)
      data = d
    } else {
      const { data: d } = await supabase.rpc('search_sewadars_all', { p_term: term })
      data = d
    }

    let filtered = data || []
    if (profile?.centre) {
      filtered = filtered.filter(s => isInScope(s.centre, s.department))
    }
    setManualResults(filtered)
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
    setManualForgotOutData(null)
    setManualTimeError('')
    
    const now = new Date()
    setManualEntryTime({
      date: getLocalDate(now),
      time: now.toTimeString().slice(0, 5)
    })
    
    // Check for open session
    if (isOnline) {
      const { data } = await supabase.rpc('get_open_session', { p_badge: sewadar.badge_number })
      if (data && data.badge_number) {
        setManualOpenSession(data)
        
        // Check if session is older than 12 hours
        const inDate = new Date(data.in_date + 'T12:00:00')
        const hoursSinceIn = (now - inDate) / (1000 * 60 * 60)
        
        if (hoursSinceIn > 12) {
          // Session is very old - show forgot_out mode
          const nowStr = getLocalDate(now)
          const nowTime = now.toTimeString().slice(0, 5)
          setManualForgotOutData({ 
            date: nowStr, 
            time: nowTime,
            inDate: data.in_date,
            inTime: data.in_time
          })
          setManualEntryType('out')
        } else {
          setManualForgotOutData(null)
          setManualEntryType('out')
        }
      } else {
        setManualOpenSession(null)
        setManualForgotOutData(null)
        setManualEntryType('in')
      }
    } else {
      setManualOpenSession(null)
      setManualForgotOutData(null)
      setManualEntryType('in')
    }
    
    setManualLoading(false)
  }

  const submitManualEntry = async () => {
    console.log('submitManualEntry called', {
      manualSelectedSewadar: manualSelectedSewadar?.badge_number,
      manualEntryType,
      manualEntryTime,
      manualForgotOutData,
      manualOpenSession: manualOpenSession?.id
    })
    
    if (!manualSelectedSewadar) {
      console.log('No sewadar selected')
      return
    }
    
    if (manualEntryType === 'in') {
      if (!manualEntryTime.date || !manualEntryTime.time) {
        console.log('IN: missing date/time')
        return
      }
    } else {
      const hasTime = (manualEntryTime.date && manualEntryTime.time) || (manualForgotOutData?.date && manualForgotOutData?.time)
      if (!manualOpenSession || !hasTime) return

      // Validate OUT time is after IN time
      const outDate = manualForgotOutData?.date || manualEntryTime.date
      const outTime = manualForgotOutData?.time || manualEntryTime.time
      if (outDate && manualOpenSession.in_date && outDate === manualOpenSession.in_date && outTime && manualOpenSession.in_time && outTime <= manualOpenSession.in_time) {
        setManualTimeError('OUT time must be after IN time')
        return
      }
      setManualTimeError('')
    }

    const now = new Date()
    
    if (manualEntryType === 'in') {
      console.log('Inserting IN session...')
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
        const { error } = await supabase.from('attendance_sessions').insert(record)
        if (error) {
          if (error.code === '23505') {
            setManualHasSession(true)
            return
          }
          console.error('Failed to insert session:', error)
        }
        if (!error) {
          await logAction(profile?.badge_number, profile?.name, 'MANUAL_IN', {
            badge: manualSelectedSewadar.badge_number,
            name: manualSelectedSewadar.sewadar_name,
            centre: profile?.centre,
            duty: getDutyType()
          })
        }
        fetchRecentScans()
      }
    } else {
      console.log('Processing OUT session...', { manualOpenSession })
      if (!manualOpenSession) {
        console.log('No open session found')
        setManualNoSession(true)
        return
      }
      
      const outDate = manualForgotOutData?.date || manualEntryTime.date
      const outTime = manualForgotOutData?.time || manualEntryTime.time
      
      console.log('OUT date/time:', { outDate, outTime, from: manualForgotOutData ? 'forgotOutData' : 'manualEntryTime' })
      
      if (!outDate || !outTime) {
        console.log('Missing out date/time')
        return
      }
      
      const updateData = {
        status: SESSION_STATUS.CLOSED,
        out_date: outDate,
        out_time: outTime,
        out_scanner_badge: profile?.badge_number,
        out_scanner_name: profile?.name,
        out_scanner_centre: profile?.centre || manualSelectedSewadar?.centre || 'UNKNOWN',
        updated_at: now.toISOString()
      }
      
      console.log('Updating session:', manualOpenSession.id, updateData)

      const sessionId = typeof manualOpenSession === 'object' ? manualOpenSession.id : manualOpenSession
      console.log('Using session ID:', sessionId, 'type:', typeof sessionId, 'manualOpenSession:', manualOpenSession)

      if (isOnline) {
        const { data: existing } = await supabase
          .from('attendance_sessions')
          .select('*')
          .eq('id', sessionId)
          .single()
        console.log('Existing session before update:', existing)
        
        // Try using RPC to bypass RLS
        const rpcResult = await supabase.rpc('close_session', {
          p_session_id: sessionId,
          p_out_date: outDate,
          p_out_time: outTime,
          p_out_scanner_badge: profile?.badge_number,
          p_out_scanner_name: profile?.name,
          p_out_scanner_centre: profile?.centre || manualSelectedSewadar?.centre || 'UNKNOWN'
        })
        console.log('RPC result:', rpcResult)
        
        await logAction(profile?.badge_number, profile?.name, 'MANUAL_OUT', {
          badge: manualSelectedSewadar.badge_number,
          name: manualSelectedSewadar.sewadar_name,
          session_id: sessionId
        })

        const { data: updated } = await supabase
          .from('attendance_sessions')
          .select('*')
          .eq('id', sessionId)
          .single()
        console.log('Session after update:', updated)
        
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

      {/* Geofencing Blocked - Show instead of scanner */}
      {geoLoading ? (
        <div className="scanner-processing">
          <div className="scanner-processing-dot" />Checking location...
        </div>
      ) : geoBlocked ? (
        <div className="popup-error">
          <MapPin size={48} color="#ef4444" style={{ margin: '0 auto 16px', display: 'block' }} />
          <div className="error-title">Out of Range</div>
          <div className="error-msg">You are {geoDistance}m away from centre</div>
          <div className="error-msg" style={{ fontSize: '0.88rem', marginTop: 8 }}>
            Must be within 200m of {profile?.centre} to scan
          </div>
          <button 
            className="btn-primary" 
            style={{ marginTop: '1rem', width: '100%' }}
            onClick={() => window.location.reload()}
          >
            <RefreshCw size={16} style={{ marginRight: 8 }} />
            Retry
          </button>
        </div>
      ) : (
        <BarcodeScanner ref={scannerRef} onScan={handleScan} />
      )}

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
                    {popupState.sewadar.gender || 'Unknown'}
                  </span>
                </div>
                <div className="popup-details">
                  <div className="detail"><span>Centre</span><span>{popupState.sewadar?.centre || '-'}</span></div>
                  {popupState.sewadar?.centre && popupState.sewadar.centre !== profile?.centre && (
                    <div className="detail"><span>Guest</span><span className="guest-tag">From {popupState.sewadar.centre}</span></div>
                  )}
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
                    {popupState.sewadar.gender || 'Unknown'}
                  </span>
                </div>
                <div className="popup-details">
                  <div className="detail"><span>Centre</span><span>{popupState.sewadar?.centre || '-'}</span></div>
                  {popupState.sewadar?.centre && popupState.sewadar.centre !== profile?.centre && (
                    <div className="detail"><span>Guest</span><span className="guest-tag">From {popupState.sewadar.centre}</span></div>
                  )}
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
                    {popupState.sewadar.gender || 'Unknown'}
                  </span>
                </div>
                <div className="popup-details">
                  <div className="detail"><span>Centre</span><span>{popupState.sewadar?.centre || '-'}</span></div>
                  {popupState.sewadar?.centre && popupState.sewadar.centre !== profile?.centre && (
                    <div className="detail"><span>Guest</span><span className="guest-tag">From {popupState.sewadar.centre}</span></div>
                  )}
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
                  <button className="btn-out" onClick={() => { logAction(profile?.badge_number, profile?.name, 'FORGOT_OUT', { badge: popupState?.sewadar?.badge_number, name: popupState?.sewadar?.sewadar_name, session_id: popupState?.openSession?.id }); markOUT(forgotOutData?.date, forgotOutData?.time) }} disabled={!forgotOutData?.date || !forgotOutData?.time}>Close Session</button>
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

            {/* Not In Scope */}
            {popupState.type === 'not_in_scope' && (
              <div className="popup-error">
                <AlertTriangle size={32} color="#f59e0b" style={{ margin: '0 auto 12px', display: 'block' }} />
                <div className="error-title">Not In Scope</div>
                <div className="error-badge">{popupState.sewadar.sewadar_name}</div>
                <div className="error-msg">Sewadar is from {popupState.sewadar.centre}</div>
                <div className="error-msg" style={{ fontSize: 11, marginTop: 4 }}>Only {profile?.centre} + child centres allowed</div>
                <button className="btn-cancel" onClick={closePopup}>Try Again</button>
              </div>
            )}

            {/* Out of Range - Geofencing */}
            {popupState.type === 'out_of_range' && (
              <div className="popup-error">
                <MapPin size={32} color="#ef4444" style={{ margin: '0 auto 12px', display: 'block' }} />
                <div className="error-title">Out of Range</div>
                <div className="error-badge">{popupState.sewadar.sewadar_name}</div>
                <div className="error-msg">You are {popupState.distance}m away</div>
                <div className="error-msg" style={{ fontSize: 11, marginTop: 4 }}>
                  Must be within {popupState.radius}m of {popupState.centre}
                </div>
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
                {popupState.sewadar?.centre && popupState.sewadar.centre !== profile?.centre && (
                  <div className="success-guest">Guest from {popupState.sewadar.centre}</div>
                )}
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
                    setManualForgotOutData(null)
                  }}>Change</button>
                </div>

                {manualLoading ? (
                  <div className="manual-loading">
                    <div className="spinner" style={{ width: 24, height: 24 }} />
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Checking session...</span>
                  </div>
                ) : (
                  <>
                    {manualEntryType === 'out' && manualOpenSession && !manualForgotOutData && (
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

                    {manualForgotOutData && (
                      <div className="warning-box" style={{ borderColor: '#f59e0b', background: 'rgba(245, 158, 11, 0.08)' }}>
                        <AlertTriangle size={14} color="#f59e0b" />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 12, color: '#f59e0b' }}>Previous Session Still Open</div>
                          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                            From {manualForgotOutData.inDate} at {formatTime12Hour(manualForgotOutData.inTime)}
                          </div>
                        </div>
                      </div>
                    )}

                    {manualForgotOutData && (
                      <div style={{ marginBottom: '1rem' }}>
                        <label style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '6px' }}>When did you leave?</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                          <input type="date" className="input" value={manualForgotOutData?.date || ''} onChange={e => { setManualTimeError(''); setManualForgotOutData(f => ({ ...f, date: e.target.value })) }} />
                          <input type="time" className="input" value={manualForgotOutData?.time || ''} onChange={e => { setManualTimeError(''); setManualForgotOutData(f => ({ ...f, time: e.target.value })) }} />
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

                    {manualTimeError && (
                      <div className="warning-box" style={{ borderColor: '#dc2626', background: 'rgba(220,38,38,0.08)' }}>
                        <AlertTriangle size={14} color="#dc2626" />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 12, color: '#dc2626' }}>{manualTimeError}</div>
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
                          setManualForgotOutData(null)
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

                    {!manualForgotOutData && (
                      <div className="time-inputs">
                        <div className="time-field">
                          <label>Date</label>
                          <input
                            type="date"
                            value={manualEntryTime.date}
                            onChange={e => { setManualTimeError(''); setManualEntryTime(t => ({ ...t, date: e.target.value })) }}
                          />
                        </div>
                        <div className="time-field">
                          <label>Time</label>
                          <input
                            type="time"
                            value={manualEntryTime.time}
                            onChange={e => { setManualTimeError(''); setManualEntryTime(t => ({ ...t, time: e.target.value })) }}
                          />
                        </div>
                      </div>
                    )}

                    <button
                      className={manualEntryType === 'in' ? 'btn-in' : 'btn-out'}
                      onClick={submitManualEntry}
                      disabled={false}
                    >
                      {manualForgotOutData ? 'Close Session' : `Mark ${manualEntryType.toUpperCase()}`}
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
