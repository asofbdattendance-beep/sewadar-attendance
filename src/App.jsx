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
import { Scan, FileText, User, Shield, WifiOff, Flag, Plane } from 'lucide-react'

function AppLayout() {
  const { profile, loading } = useAuth()
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingSync, setPendingSync] = useState(0)
  const [openFlagCount, setOpenFlagCount] = useState(0)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    const online = () => {
      setIsOnline(true)
      syncOfflineQueue(supabase).then(() => setPendingSync(getOfflineQueueCount()))
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
    // Fetch open flags count
    async function fetchFlagCount() {
      if (!profile) return
      const { count } = await supabase.from('queries').select('id', { count: 'exact', head: true }).eq('status', 'open')
      setOpenFlagCount(count || 0)
    }
    fetchFlagCount()
    const flagInterval = setInterval(fetchFlagCount, 60000)
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
      clearInterval(flagInterval)
    }
  }, [])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto 1rem' }} />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading…</p>
      </div>
    </div>
  )

  if (!profile) return <LoginPage />

  if (!profile.is_active) return (
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
    <div>
      {/* Navbar */}
      <nav className="navbar">
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

      {/* Offline banner */}
      {!isOnline && (
        <div className="offline-banner">
          <WifiOff size={13} /> Offline mode — scans saved locally, will sync when internet returns
        </div>
      )}

      {/* Routes */}
      <Routes>
        <Route path="/scan" element={<ScannerPage isOnline={isOnline} />} />
        <Route path="/records" element={<RecordsPage />} />
        <Route path="/jatha" element={<JathaPage />} />
        <Route path="/flags" element={<FlagsPage />} />
        <Route path="/super-admin" element={<SuperAdminPage />} />
        <Route path="/profile" element={<ProfilePage isOnline={isOnline} />} />
        <Route path="*" element={<Navigate to="/scan" replace />} />
      </Routes>

      {/* Bottom Nav */}
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
    <BrowserRouter>
      <AuthProvider>
        <AppLayout />
      </AuthProvider>
    </BrowserRouter>
  )
}