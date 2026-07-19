import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './components/Toast'
import { supabase } from './lib/supabase'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import DashboardPage from './pages/DashboardPage'
import ScannerPage from './pages/ScannerPage'
import RecordsPage from './pages/RecordsPage'
import ProfilePage from './pages/ProfilePage'
import AttendanceEntryPage from './pages/AttendanceEntryPage'
import ReportsPage from './pages/ReportsPage'
import SchedulesPage from './pages/SchedulesPage'
import SuperAdminPage from './pages/SuperAdminPage'
import { LayoutDashboard, Scan, FileText, WifiOff, User, ClipboardList, FileBarChart, Settings, Calendar, Home } from 'lucide-react'

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

  const allNavItems = [
    { path: '/', label: 'Home', icon: Home, always: true },
    { path: '/attendance', label: 'Dashboard', icon: LayoutDashboard, permission: 'allow_dashboard' },
    { path: '/scan', label: 'Scan', icon: Scan, permission: 'allow_scan' },
    { path: '/records', label: 'Records', icon: FileText, permission: 'allow_records' },
    { path: '/entry', label: 'Entry', icon: ClipboardList, gate: true },
    { path: '/reports', label: 'Reports', icon: FileBarChart, permission: 'allow_reports' },
    { path: '/schedules', label: 'Schedules', icon: Calendar, permission: 'schedule_view' },
    { path: '/superadmin', label: 'ASO', icon: Settings, permission: 'allow_settings' },
    { path: '/profile', label: 'Profile', icon: User, always: true },
  ]

  const navItems = allNavItems.filter(item => {
    if (item.always) return true
    if (item.gate) return hasPermission('allow_gate_entry') || hasPermission('allow_jatha')
    if (item.permission) return hasPermission(item.permission)
    return false
  })

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
        <Route path="/" element={<HomePage />} />
        <Route path="/attendance" element={hasPermission('allow_dashboard') ? <DashboardPage /> : <Navigate to="/" replace />} />
        <Route path="/schedules" element={hasPermission('schedule_view') ? <SchedulesPage /> : <Navigate to="/" replace />} />
        <Route path="/reports" element={hasPermission('allow_reports') ? <ReportsPage /> : <Navigate to="/" replace />} />
        <Route path="/scan" element={hasPermission('allow_scan') ? <ScannerPage isOnline={isOnline} /> : <Navigate to="/" replace />} />
        <Route path="/records" element={hasPermission('allow_records') ? <RecordsPage /> : <Navigate to="/" replace />} />
        <Route path="/entry" element={hasPermission('allow_gate_entry') || hasPermission('allow_jatha') ? <AttendanceEntryPage /> : <Navigate to="/" replace />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/superadmin" element={hasPermission('allow_settings') ? <SuperAdminPage /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
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
