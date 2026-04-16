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
import JathaReportsPage from './pages/JathaReportsPage'
import ReportsPage from './pages/ReportsPage'
import { LayoutDashboard, Scan, FileText, WifiOff, User, ClipboardList, BarChart3, FileBarChart } from 'lucide-react'

function AppLayout() {
  const { profile, loading } = useAuth()
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

  const navItems = [
    { path: '/', label: 'Home', icon: LayoutDashboard },
    { path: '/scan', label: 'Scan', icon: Scan },
    { path: '/records', label: 'Records', icon: FileText },
    { path: '/entry', label: 'Entry', icon: ClipboardList },
    { path: '/reports', label: 'Reports', icon: FileBarChart },
    { path: '/profile', label: 'Profile', icon: User },
  ]

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
        <Route path="/" element={<DashboardPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/scan" element={<ScannerPage isOnline={isOnline} />} />
        <Route path="/records" element={<RecordsPage />} />
        <Route path="/entry" element={<AttendanceEntryPage />} />
        <Route path="/jatha-reports" element={<JathaReportsPage />} />
        <Route path="/profile" element={<ProfilePage />} />
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
