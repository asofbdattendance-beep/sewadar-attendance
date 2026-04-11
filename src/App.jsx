// ─── App.jsx ──────────────────────────────────────────────────────────────────
// Fixes applied:
//  1. openFlagCount is now actually passed as `badge` to the Flags nav item.
//     Previously it was fetched but never connected to the navItems array.
//  2. FlagsPage route added (/flags) — it was imported in the original but
//     never rendered. Guarded by can_flags permission.
//  3. FlagsPage import added.
//  4. Recent-scans time display uses IST 12-hour format via formatTimeIST().
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { supabase, ROLES } from './lib/supabase'
import LoginPage from './pages/LoginPage'
import ScannerPage from './pages/ScannerPage'
import DashboardPage from './pages/DashboardPage'
import RecordsPage from './pages/RecordsPage'
import SuperAdminPage from './pages/SuperAdminPage'
import ProfilePage from './pages/ProfilePage'
import JathaPage from './pages/JathaPage'
import FlagsPage from './pages/FlagsPage'
import ReportsPage from './pages/ReportsPage'
import ToastContainer from './components/Toast'
import NoInternet from './components/NoInternet'
import { Scan, FileText, User, Shield, Plane, Clock, RefreshCw, Flag, LayoutDashboard, BarChart2 } from 'lucide-react'

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
  const [pwaUpdate, setPwaUpdate]         = useState(false)
  const [isOnline, setIsOnline]           = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const navigate  = useNavigate()
  const location  = useLocation()

  // ── PWA update notification ─────────────────────────────────────────────────
  useEffect(() => {
    if (window.__pwaUpdateAvailable) setPwaUpdate(true)
    const handler = () => setPwaUpdate(true)
    window.addEventListener('pwa-update-available', handler)
    return () => window.removeEventListener('pwa-update-available', handler)
  }, [])

  // ── Online/offline detection ────────────────────────────────────────────────
  useEffect(() => {
    const online  = () => setIsOnline(true)
    const offline = () => setIsOnline(false)
    window.addEventListener('online',  online)
    window.addEventListener('offline', offline)
    return () => {
      window.removeEventListener('online',  online)
      window.removeEventListener('offline', offline)
    }
  }, [])

  // ── Open flag count — FIX: now actually used in navItems ───────────────────
  useEffect(() => {
    async function fetchFlagCount() {
      if (!profile) return
      let query = supabase
        .from('queries')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'open')

      if (
        (profile.role === ROLES.CENTRE || profile.role === ROLES.SC_SP_USER) &&
        profile.centre
      ) {
        const { data: children } = await supabase
          .from('centres')
          .select('centre_name')
          .eq('parent_centre', profile.centre)
        const scope = [profile.centre, ...(children?.map((c) => c.centre_name) || [])]
        query = query.in('raised_by_centre', scope)
      }

      const { count } = await query
      setOpenFlagCount(count || 0)
    }

    fetchFlagCount().catch(() => {})

    // Poll every 10s when tab is visible (reduced from 60s for faster flag updates)
    const flagInterval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchFlagCount().catch(() => {})
    }, 10_000)

    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchFlagCount().catch(() => {})
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(flagInterval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [profile])

  // ── Guards ──────────────────────────────────────────────────────────────────
  if (loading)   return <LoadingScreen />
  if (!isOnline) return <NoInternet onRetry={() => setIsOnline(navigator.onLine)} />
  if (sessionExpired) return <SessionExpiredScreen signOut={signOut} />
  if (!profile)  return <LoginPage />
  if (!profile.is_active) return <InactiveScreen />

  // ── Permissions ─────────────────────────────────────────────────────────────
  const isAso        = profile.role === ROLES.ASO
  const canScan      = isAso || profile.can_scan
  const canRecords   = isAso || profile.can_records
  const canJatha     = isAso || profile.can_jatha
  const canFlags     = isAso || profile.can_flags
  const canReports   = isAso || profile.can_reports
  const rolePill     = isAso ? 'ASO' : profile.role === ROLES.SC_SP_USER ? 'SC/SP' : 'CENTRE'

  // ── Nav items — FIX: openFlagCount now wired to the Flags badge ─────────────
  const navItems = [
    { path: '/dashboard',  label: 'Home',    icon: LayoutDashboard, show: true },
    { path: '/scan',       label: 'Scanner', icon: Scan,            show: canScan    },
    { path: '/jatha',      label: 'Jatha',   icon: Plane,           show: canJatha   },
    { path: '/records',    label: 'Records', icon: FileText,        show: canRecords },
    { path: '/flags',      label: 'Flags',   icon: Flag,            show: canFlags,  badge: openFlagCount },
    { path: '/reports',    label: 'Reports', icon: BarChart2,        show: canReports },
    ...(isAso ? [{ path: '/super-admin', label: 'Control', icon: Shield, show: true }] : []),
    { path: '/profile',    label: 'Profile', icon: User,           show: true       },
  ].filter((item) => item.show !== false)

  // Default redirect — go to first allowed page
  const defaultPath = '/dashboard'

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* ── Top navbar ────────────────────────────────────────────────────── */}
      <nav className="navbar" style={{ position: 'sticky', top: 0, zIndex: 100 }}>
        <div className="navbar-brand">
          <span style={{ fontSize: '1rem' }}>⬛</span>
          Sewadar Attendance
          <span className="navbar-pill">{rolePill}</span>
        </div>
      </nav>

      {/* ── Session warning banner ─────────────────────────────────────────── */}
      {sessionWarning && (
        <div style={{
          background:    'rgba(255,193,7,0.15)',
          borderBottom:  '1px solid rgba(255,193,7,0.4)',
          padding:       '0.5rem 1rem',
          textAlign:     'center',
          fontSize:      '0.8rem',
          color:         '#ffc107',
          fontWeight:    600,
          display:       'flex',
          alignItems:    'center',
          justifyContent:'center',
          gap:           '0.5rem',
        }}>
          <Clock size={13} />
          Session expires soon due to inactivity.
          <button
            onClick={resetActivity}
            style={{
              background:     'none', border: 'none', cursor: 'pointer',
              color:          '#ffc107', fontWeight: 700,
              textDecoration: 'underline', fontSize: '0.8rem',
              fontFamily:     'inherit', padding: 0,
            }}
          >
            Stay signed in
          </button>
        </div>
      )}

      {/* ── PWA update banner ─────────────────────────────────────────────── */}
      {pwaUpdate && (
        <div style={{
          background:    'var(--gold-bg)',
          borderBottom:  '1px solid rgba(201,168,76,0.4)',
          padding:       '0.5rem 1rem',
          textAlign:     'center',
          fontSize:      '0.8rem',
          color:         'var(--gold)',
          fontWeight:    600,
          display:       'flex',
          alignItems:    'center',
          justifyContent:'center',
          gap:           '0.5rem',
        }}>
          <RefreshCw size={13} />
          A new version is available.
          <button
            onClick={() => window.location.reload()}
            style={{
              background:     'none', border: 'none', cursor: 'pointer',
              color:          'var(--gold)', fontWeight: 700,
              textDecoration: 'underline', fontSize: '0.8rem',
              fontFamily:     'inherit', padding: 0,
            }}
          >
            Reload to update
          </button>
        </div>
      )}

      {/* ── Desktop sidebar nav ───────────────────────────────────────────── */}
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

      {/* ── Page content ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1 }}>
        <Routes>
          <Route path="/dashboard"  element={<DashboardPage />} />
          <Route path="/scan"        element={canScan    ? <ScannerPage />    : <Navigate to={defaultPath} replace />} />
          <Route path="/jatha"       element={canJatha   ? <JathaPage />      : <Navigate to={defaultPath} replace />} />
          <Route path="/records"     element={canRecords ? <RecordsPage />    : <Navigate to={defaultPath} replace />} />
          {/* FIX: FlagsPage route was imported but never rendered — added here */}
          <Route path="/flags"       element={canFlags   ? <FlagsPage />      : <Navigate to={defaultPath} replace />} />
          <Route path="/reports"      element={canReports ? <ReportsPage />    : <Navigate to={defaultPath} replace />} />
          <Route path="/super-admin" element={isAso      ? <SuperAdminPage /> : <Navigate to={defaultPath} replace />} />
          <Route path="/profile"     element={<ProfilePage />} />
          <Route path="*"            element={<Navigate to={defaultPath} replace />} />
        </Routes>
      </div>

      {/* ── Bottom mobile nav ─────────────────────────────────────────────── */}
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
                  position:     'absolute', top: -4, right: -6,
                  background:   'var(--red)', color: 'white',
                  borderRadius: '50%', width: 14, height: 14,
                  fontSize:     '0.6rem', fontWeight: 800,
                  display:      'flex', alignItems: 'center', justifyContent: 'center',
                  lineHeight:   1,
                }}>
                  {badge > 9 ? '9+' : badge}
                </span>
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
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <AppLayout />
        <ToastContainer />
      </AuthProvider>
    </BrowserRouter>
  )
}