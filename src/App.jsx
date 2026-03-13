import { useState, useEffect, createContext, useContext } from 'react'
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
import FlagsPage from './pages/FlagsPage'
import { Scan, BarChart2, FileText, Settings, User, Shield, WifiOff, Flag, XCircle, CheckCircle, AlertCircle } from 'lucide-react'

// Toast Context
const ToastContext = createContext(null)

export function useToast() {
  return useContext(ToastContext)
}

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = (message, type = 'info') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }

  const removeToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            {toast.type === 'success' && <CheckCircle size={16} />}
            {toast.type === 'error' && <AlertCircle size={16} />}
            {toast.type === 'info' && <Flag size={16} />}
            <span>{toast.message}</span>
            <button onClick={() => removeToast(toast.id)} className="toast-close">
              <XCircle size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function AppLayout() {
  const { profile, loading, error } = useAuth()
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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--office-bg)' }}>
      <div style={{ textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto 1rem' }} />
        <p style={{ color: 'var(--office-text-muted)', fontSize: '0.9rem' }}>Loading…</p>
      </div>
    </div>
  )

  if (error) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '2rem', background: 'var(--office-bg)', textAlign: 'center' }}>
      <div>
        <div style={{ width: 64, height: 64, background: 'var(--office-red-bg)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', border: '1px solid var(--office-red-border)' }}>
          <XCircle size={32} color="var(--office-red)" />
        </div>
        <h2 style={{ color: 'var(--office-red)', marginBottom: '0.5rem', fontSize: '1.25rem' }}>Something went wrong</h2>
        <p style={{ color: 'var(--office-text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>{error}</p>
        <button className="btn btn-primary" onClick={() => window.location.reload()}>Refresh Page</button>
      </div>
    </div>
  )

  if (!profile) return <LoginPage />

  if (!profile.is_active) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '2rem', background: 'var(--office-bg)', textAlign: 'center' }}>
      <div>
        <div style={{ width: 64, height: 64, background: 'var(--office-red-bg)', borderRadius: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem', border: '1px solid var(--office-red-border)' }}>
          <Shield size={32} color="var(--office-red)" />
        </div>
        <h2 style={{ color: 'var(--office-red)', marginBottom: '0.5rem', fontSize: '1.25rem' }}>Account Inactive</h2>
        <p style={{ color: 'var(--office-text-muted)', fontSize: '0.9rem' }}>Your account has been deactivated. Contact Super Admin.</p>
      </div>
    </div>
  )

  const isCentreUser = profile.role === ROLES.CENTRE_USER
  const isAdmin = profile.role === ROLES.ADMIN
  const isSuperAdmin = profile.role === ROLES.SUPER_ADMIN

  const navItems = [
    { path: '/scan', label: 'Scan', icon: Scan },
    { path: '/dashboard', label: 'Reports', icon: BarChart2 },
    { path: '/records', label: 'Records', icon: FileText },
    { path: '/flags', label: 'Flags', icon: Flag },
    ...(!isCentreUser ? [{ path: '/admin', label: 'Admin', icon: Settings }] : []),
    ...(isSuperAdmin ? [{ path: '/super-admin', label: 'Control', icon: Shield }] : []),
    { path: '/profile', label: 'Profile', icon: User },
  ]

  const rolePill = isSuperAdmin ? 'SUPER ADMIN' : isAdmin ? 'ADMIN' : 'CENTRE USER'

  return (
    <div>
      {/* Navbar */}
      <nav className="navbar">
        <div className="navbar-brand">
          <div className="navbar-logo">🙏</div>
          <span className="navbar-title">Sewadar Attendance</span>
          <span className="navbar-pill">{rolePill}</span>
        </div>
        {!isOnline && (
          <div className="offline-indicator">
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
        <Route path="/flags" element={<FlagsPage />} />
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
        <ToastProvider>
          <AppLayout />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
