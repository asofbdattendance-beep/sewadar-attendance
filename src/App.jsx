import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './components/Toast'
import { supabase, ROLES } from './lib/supabase'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import ScannerPage from './pages/ScannerPage'
import RecordsPage from './pages/RecordsPage'
import ProfilePage from './pages/ProfilePage'
import AttendanceEntryPage from './pages/AttendanceEntryPage'
import ReportsPage from './pages/ReportsPage'
import SuperAdminPage from './pages/SuperAdminPage'
import { LayoutDashboard, Scan, FileText, WifiOff, User, ClipboardList, FileBarChart, Settings } from 'lucide-react'

function AppLayout() {
  const { profile, loading, hasPermission } = useAuth()
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const navigate = useNavigate()
  const location = useLocation()

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

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'var(--bg)' }}>
      <div style={{ textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto 1rem' }} />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Loading…</p>
      </div>
    </div>
  )

  if (!profile) return <LoginPage />

  // Build nav items based on permissions
  const navItems = [
    { path: '/', label: 'Home', icon: LayoutDashboard, permission: 'allow_dashboard' },
    { path: '/scan', label: 'Scan', icon: Scan, permission: 'allow_scan' },
    { path: '/records', label: 'Records', icon: FileText, permission: 'allow_records' },
    { path: '/entry', label: 'Entry', icon: ClipboardList, permission: 'allow_gate_entry' },
    { path: '/reports', label: 'Reports', icon: FileBarChart, permission: 'allow_reports' },
    { path: '/profile', label: 'Profile', icon: User },
  ]

  // Filter nav items based on permissions (ASO sees all)
  const visibleNavItems = navItems.filter(item => {
    if (!item.permission) return true // Profile always visible
    return hasPermission(item.permission)
  })

  const adminNav = (profile?.role === ROLES.SUPER_ADMIN || profile?.role === 'aso') ? [{ path: '/superadmin', label: 'ASO', icon: Settings }] : []

  return (
    <div>
      {/* Navbar */}
      <nav className="navbar">
        <div className="navbar-brand">
          <span>Sewadar</span>
        </div>
        {!isOnline && (
          <div className="scanner-pill pill-offline">
            <WifiOff size={12} /> Offline
          </div>
        )}
      </nav>

      {/* Routes */}
      <Routes>
        <Route path="/" element={hasPermission('allow_dashboard') ? <DashboardPage /> : <Navigate to="/profile" replace />} />
        <Route path="/reports" element={hasPermission('allow_reports') ? <ReportsPage /> : <Navigate to="/" replace />} />
        <Route path="/scan" element={hasPermission('allow_scan') ? <ScannerPage isOnline={isOnline} /> : <Navigate to="/" replace />} />
        <Route path="/records" element={hasPermission('allow_records') ? <RecordsPage /> : <Navigate to="/" replace />} />
        <Route path="/entry" element={hasPermission('allow_gate_entry') ? <AttendanceEntryPage /> : <Navigate to="/" replace />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/superadmin" element={hasPermission('allow_settings') ? <SuperAdminPage /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Bottom Nav */}
      <nav className="bottom-nav">
        {[...visibleNavItems, ...adminNav].map(({ path, label, icon: Icon }) => (
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
