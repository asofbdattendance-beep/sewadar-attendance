import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { supabase, ROLES } from './lib/supabase'
import LoginPage from './pages/LoginPage'
import ScannerPage from './pages/ScannerPage'
import RecordsPage from './pages/RecordsPage'
import SuperAdminPage from './pages/SuperAdminPage'
import ProfilePage from './pages/ProfilePage'
import JathaPage from './pages/JathaPage'
import ToastContainer from './components/Toast'
import NoInternet from './components/NoInternet'
import { Scan, FileText, User, Shield, Plane, Clock, RefreshCw } from 'lucide-react'

function SessionExpiredScreen({ signOut }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '2rem', textAlign: 'center' }}>
      <div>
        <div style={{ width: 56, height: 56, background: 'rgba(201,168,76,0.2)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
          <Shield size={28} color="var(--gold)" />
        </div>
        <h2 style={{ color: 'var(--gold)', marginBottom: '0.5rem' }}>Session Expired</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '0.5rem', lineHeight: 1.5 }}>
          You were automatically logged out after 60 minutes of inactivity.
        </p>
        <button className="btn btn-gold" onClick={signOut}>Back to Login</button>
      </div>
    </div>
  )
}

function InactiveScreen() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '2rem', textAlign: 'center' }}>
      <div>
        <div style={{ width: 56, height: 56, background: 'var(--red-bg)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
          <Shield size={28} color="var(--red)" />
        </div>
        <h2 style={{ color: 'var(--red)', marginBottom: '0.5rem' }}>Account Inactive</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Your account has been deactivated. Contact Super Admin.</p>
      </div>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto 1rem' }} />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading…</p>
      </div>
    </div>
  )
}

function AppLayout() {
  const { profile, loading, sessionExpired, signOut, resetActivity, sessionWarning } = useAuth()
  const [openFlagCount, setOpenFlagCount] = useState(0)
  const [pwaUpdate, setPwaUpdate] = useState(false)
  const [_realtimeStatus, setRealtimeStatus] = useState('disconnected')
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (window.__pwaUpdateAvailable) setPwaUpdate(true)
    const handler = () => setPwaUpdate(true)
    window.addEventListener('pwa-update-available', handler)
    return () => window.removeEventListener('pwa-update-available', handler)
  }, [])

  useEffect(() => {
    const online = () => setIsOnline(true)
    const offline = () => setIsOnline(false)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [])

  useEffect(() => {
    async function fetchFlagCount() {
      if (!profile) return
      let query = supabase.from('queries').select('id', { count: 'exact', head: true }).eq('status', 'open')
      
      if (profile.role === ROLES.CENTRE && profile.centre) {
        const { data: children } = await supabase.from('centres').select('centre_name').eq('parent_centre', profile.centre)
        const scope = [profile.centre, ...(children?.map(c => c.centre_name) || [])]
        query = query.in('raised_by_centre', scope)
      }
      
      const { count } = await query
      setOpenFlagCount(count || 0)
    }
    fetchFlagCount().catch(console.warn)
    let flagInterval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchFlagCount().catch(console.warn)
    }, 60000)
    const onVisible = () => { if (document.visibilityState === 'visible') fetchFlagCount().catch(console.warn) }
    document.addEventListener('visibilitychange', onVisible)

    const rtChannel = supabase.channel('global-status')
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setRealtimeStatus('connected')
        else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') setRealtimeStatus('disconnected')
      })

    return () => {
      clearInterval(flagInterval)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(rtChannel)
    }
  }, [profile])

  if (loading) return <LoadingScreen />

  if (!isOnline) return <NoInternet onRetry={() => setIsOnline(navigator.onLine)} />

  if (sessionExpired) return <SessionExpiredScreen signOut={signOut} />

  if (!profile) return <LoginPage />

  if (!profile.is_active) return <InactiveScreen />

  const _isCentreUser = profile.role === ROLES.CENTRE
  const isAso = profile.role === ROLES.ASO
  
  const canScan = isAso || profile.can_scan
  const canRecords = isAso || profile.can_records
  const canJatha = isAso || profile.can_jatha
  const _canFlags = isAso || profile.can_flags
  const _canReports = isAso || profile.can_reports

  const navItems = [
    { path: '/scan', label: 'Scanner', icon: Scan, show: canScan },
    { path: '/jatha', label: 'Jatha', icon: Plane, show: canJatha },
    { path: '/records', label: 'Records', icon: FileText, show: canRecords, badge: (isAso || profile?.can_flags) ? openFlagCount : 0 },
    ...(isAso ? [{ path: '/super-admin', label: 'Control', icon: Shield, show: true }] : []),
    { path: '/profile', label: 'Profile', icon: User, show: true },
  ].filter(item => item.show !== false)

  const rolePill = isAso ? 'ASO' : 'CENTRE'

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <nav className="navbar" style={{ position: 'sticky', top: 0, zIndex: 100 }}>
        <div className="navbar-brand">
          <span style={{ fontSize: '1rem' }}>⬛</span>
          Sewadar Attendance
          <span className="navbar-pill">{rolePill}</span>
        </div>
      </nav>

      {sessionWarning && (
        <div style={{
          background: 'rgba(255,193,7,0.15)',
          borderBottom: '1px solid rgba(255,193,7,0.4)',
          padding: '0.5rem 1rem',
          textAlign: 'center',
          fontSize: '0.8rem',
          color: '#ffc107',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
        }}>
          <Clock size={13} /> Session expires soon due to inactivity.
          <button onClick={resetActivity} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ffc107', fontWeight: 700, textDecoration: 'underline', fontSize: '0.8rem', fontFamily: 'inherit', padding: 0 }}>
            Stay signed in
          </button>
        </div>
      )}

      {pwaUpdate && (
        <div style={{
          background: 'var(--gold-bg)',
          borderBottom: '1px solid rgba(201,168,76,0.4)',
          padding: '0.5rem 1rem',
          textAlign: 'center',
          fontSize: '0.8rem',
          color: 'var(--gold)',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
        }}>
          <RefreshCw size={13} />
          A new version is available.
          <button onClick={() => window.location.reload()} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gold)', fontWeight: 700, textDecoration: 'underline', fontSize: '0.8rem', fontFamily: 'inherit', padding: 0 }}>
            Reload to update
          </button>
        </div>
      )}

      <nav className="desktop-nav">
        {navItems.map(({ path, label, icon: Icon, badge }) => (
          <button
            key={path}
            className={`desktop-nav-item ${location.pathname === path ? 'active' : ''}`}
            onClick={() => navigate(path)}
          >
            <Icon size={16} />
            <span>{label}</span>
            {badge > 0 && (
              <span className="desktop-nav-badge">{badge > 9 ? '9+' : badge}</span>
            )}
          </button>
        ))}
      </nav>

      <div style={{ flex: 1 }}>
        <Routes>
          <Route path="/scan" element={canScan ? <ScannerPage /> : <Navigate to="/records" replace />} />
          <Route path="/jatha" element={canJatha ? <JathaPage /> : <Navigate to="/scan" replace />} />
          <Route path="/records" element={canRecords ? <RecordsPage /> : <Navigate to="/scan" replace />} />
          <Route path="/super-admin" element={isAso ? <SuperAdminPage /> : <Navigate to="/scan" replace />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to={canScan ? "/scan" : canRecords ? "/records" : "/jatha"} replace />} />
        </Routes>
      </div>

      <nav className="bottom-nav">
        {navItems.map(({ path, label, icon: Icon, badge }) => (
          <button
            key={path}
            className={`bottom-nav-item ${location.pathname === path ? 'active' : ''}`}
            onClick={() => navigate(path)}
          >
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <Icon size={19} />
              {badge > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -6,
                  background: 'var(--red)', color: 'white',
                  borderRadius: '50%', width: 14, height: 14,
                  fontSize: '0.6rem', fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  lineHeight: 1
                }}>{badge > 9 ? '9+' : badge}</span>
              )}
            </span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AuthProvider>
        <AppLayout />
        <ToastContainer />
      </AuthProvider>
    </BrowserRouter>
  )
}
