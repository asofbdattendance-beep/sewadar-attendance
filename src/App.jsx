import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { syncOfflineQueue, getOfflineQueueCount, populateOfflineCache, populateAttendanceCache } from './lib/offline'
import { supabase, ROLES } from './lib/supabase'
import LoginPage from './pages/LoginPage'
import ScannerPage from './pages/ScannerPage'
import DashboardPage from './pages/DashboardPage'
import RecordsPage from './pages/RecordsPage'
import AdminPage from './pages/AdminPage'
import SuperAdminPage from './pages/SuperAdminPage'
import ProfilePage from './pages/ProfilePage'
import { Scan, BarChart2, FileText, Settings, User, Shield, WifiOff } from 'lucide-react'

function AppLayout() {
  const { profile, loading } = useAuth()
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [pendingSync, setPendingSync] = useState(0)
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
    return () => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
    }
  }, [])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto 1rem' }} />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading...</p>
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

  const navItems = [
    { path: '/scan', label: 'Scan', icon: Scan },
    { path: '/dashboard', label: 'Reports', icon: BarChart2 },
    { path: '/records', label: 'Records', icon: FileText },
    ...(profile.role !== ROLES.CENTRE_USER
      ? [{ path: '/admin', label: 'Admin', icon: Settings }]
      : []),
    ...(profile.role === ROLES.SUPER_ADMIN
      ? [{ path: '/super-admin', label: 'Control', icon: Shield }]
      : []),
    { path: '/profile', label: 'Profile', icon: User },
  ]

  return (
    <div>
      {/* Navbar */}
      <nav className="navbar">
        <div className="navbar-brand">
          <span style={{ fontSize: '1rem' }}>⬛</span>
          Sewadar Attendance
          <span className="navbar-pill">{profile.role === ROLES.SUPER_ADMIN ? 'SUPER ADMIN' : profile.role === ROLES.ADMIN ? 'ADMIN' : 'CENTRE USER'}</span>
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
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/records" element={<RecordsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/super-admin" element={<SuperAdminPage />} />
        <Route path="/profile" element={<ProfilePage isOnline={isOnline} />} />
        <Route path="*" element={<Navigate to="/scan" replace />} />
      </Routes>

      {/* Bottom Nav */}
      <nav className="bottom-nav">
        {navItems.map(({ path, label, icon: Icon }) => (
          <button
            key={path}
            className={`bottom-nav-item ${location.pathname === path ? 'active' : ''}`}
            onClick={() => navigate(path)}
          >
            <Icon size={19} />
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
