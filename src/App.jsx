import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { syncOfflineQueue, getOfflineQueueCount, populateOfflineCache, populateAttendanceCache } from './lib/offline'
import { supabase, ROLES } from './lib/supabase'
import LoginPage from './pages/LoginPage'
import ScannerPage from './pages/ScannerPage'
import RecordsPage from './pages/RecordsPage'
import SuperAdminPage from './pages/SuperAdminPage'
import ProfilePage from './pages/ProfilePage'
import FlagsPage from './pages/FlagsPage'
import JathaPage from './pages/JathaPage'
import ToastContainer from './components/Toast'
import { Scan, FileText, User, Shield, WifiOff, Flag, Plane, Clock, RefreshCw } from 'lucide-react'

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
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1.5rem' }}>
          All pending offline scans are preserved and will sync after re-login.
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
  const { profile, loading, sessionExpired, setSessionExpired, signOut, resetActivity, sessionWarning } = useAuth()
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingSync, setPendingSync] = useState(0)
  const [openFlagCount, setOpenFlagCount] = useState(0)
  const [pwaUpdate, setPwaUpdate] = useState(false)
  const [realtimeStatus, setRealtimeStatus] = useState('disconnected')
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (window.__pwaUpdateAvailable) setPwaUpdate(true)
    const handler = () => setPwaUpdate(true)
    window.addEventListener('pwa-update-available', handler)
    return () => window.removeEventListener('pwa-update-available', handler)
  }, [])

  useEffect(() => {
    const online = () => {
      setIsOnline(true)
      syncOfflineQueue(supabase).then(() => setPendingSync(getOfflineQueueCount())).catch(console.warn)
      populateOfflineCache(supabase)
      populateAttendanceCache(supabase)
    }
    const offline = () => setIsOnline(false)
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    setPendingSync(getOfflineQueueCount())
    if (navigator.onLine) {
      populateOfflineCache(supabase)
      populateAttendanceCache(supabase)
    }
    async function fetchFlagCount() {
      if (!profile) return
      const { count } = await supabase.from('queries').select('id', { count: 'exact', head: true }).eq('status', 'open')
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
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
      clearInterval(flagInterval)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(rtChannel)
    }
  }, [])

  // Note: sessionExpired screen shows until user clicks Back to Login
  // resetActivity is called on signOut in AuthContext

  // ── Conditional screens (after all hooks) ──
  if (loading) return <LoadingScreen />

  if (sessionExpired) return <SessionExpiredScreen signOut={signOut} />

  if (!profile) return <LoginPage />

  if (!profile.is_active) return <InactiveScreen />

  const isScSpUser = profile.role === ROLES.SC_SP_USER
  const isCentreUser = profile.role === ROLES.CENTRE_USER
  const isAso = profile.role === ROLES.ASO

  const navItems = [
    { path: '/scan', label: 'Scan', icon: Scan },
    { path: '/records', label: 'Records', icon: FileText },
    { path: '/jatha', label: 'Jatha', icon: Plane },
    { path: '/flags', label: 'Flags', icon: Flag, badge: openFlagCount },
    ...(isAso ? [{ path: '/super-admin', label: 'Control', icon: Shield }] : []),
    { path: '/profile', label: 'Profile', icon: User },
  ]

  const rolePill = isAso ? 'ASO' : isCentreUser ? 'CENTRE USER' : 'SC_SP USER'

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <nav className="navbar" style={{ position: 'sticky', top: 0, zIndex: 100 }}>
        <div className="navbar-brand">
          <span style={{ fontSize: '1rem' }}>⬛</span>
          Sewadar Attendance
          <span className="navbar-pill">{rolePill}</span>
        </div>
        {!isOnline && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', background: 'rgba(230,81,0,0.25)', border: '1px solid rgba(255,255,255,0.3)', padding: '0.25rem 0.6rem', borderRadius: '6px', color: '#FFD54F', fontSize: '0.72rem', fontWeight: 600 }}>
            <WifiOff size={12} /> OFFLINE {pendingSync > 0 ? `· ${pendingSync}` : ''}
          </div>
        )}
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

      {!isOnline && (
        <div className="offline-banner">
          <WifiOff size={13} /> Offline mode — scans saved locally, will sync when internet returns
          <span style={{ marginLeft: 'auto', fontSize: '0.72rem', opacity: 0.7 }}>
            Realtime: {realtimeStatus === 'connected' ? '✓ connected' : '✕ disconnected'}
          </span>
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

      {/* Desktop horizontal nav — shown on md+ */}
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
          <Route path="/scan" element={<ScannerPage isOnline={isOnline} />} />
          <Route path="/records" element={<RecordsPage />} />
          <Route path="/jatha" element={<JathaPage isOnline={isOnline} />} />
          <Route path="/flags" element={<FlagsPage />} />
          <Route path="/super-admin" element={<SuperAdminPage isOnline={isOnline} />} />
          <Route path="/profile" element={<ProfilePage isOnline={isOnline} />} />
          <Route path="*" element={<Navigate to="/scan" replace />} />
        </Routes>
      </div>

      {/* Mobile bottom nav — shown on mobile only */}
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