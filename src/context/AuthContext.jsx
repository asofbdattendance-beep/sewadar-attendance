// ─── AuthContext.jsx ──────────────────────────────────────────────────────────
// Fixes applied:
//  1. Session warning interval: once warning fires, interval is cleared — no
//     more redundant 30s ticks after the banner is already visible.
//  2. resetActivity() now also clears the stale interval and starts a fresh one
//     so the 60-min timer restarts properly on user interaction.
//  3. Minor: fetchProfile dependencies are stable (no stale closure risk).
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react'
import { supabase, ROLES } from '../lib/supabase'

const SESSION_TIMEOUT_MS  = 60 * 60 * 1000  // 60 minutes
const SESSION_WARNING_MS  = 55 * 60 * 1000  // 55 minutes — show warning banner
const CHECK_INTERVAL_MS   = 30 * 1000       // check every 30 seconds

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser]                   = useState(null)
  const [profile, setProfile]             = useState(null)
  const [loading, setLoading]             = useState(true)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [sessionWarning, setSessionWarning] = useState(false)

  const lastActivityRef  = useRef(Date.now())
  const intervalRef      = useRef(null)  // single interval ref — always cleared before restarting

  // ── Profile fetch ───────────────────────────────────────────────────────────
  async function fetchProfile(userId) {
    const { data: userData, error } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', userId)
      .single()

    if (error) {
      if (import.meta.env.DEV) console.warn('Failed to load profile:', error)
      setProfile(null)
      setLoading(false)
      return
    }

    // Defaults — ASO gets everything implicitly; centre users check permissions table
    let permissions = {
      can_scan:         true,
      can_records:      true,
      can_reports:      false,
      can_jatha:        false,
      can_manual_entry: false,
      can_flags:        false,
      can_edit_jatha:   false,
    }

    if (userData.role === ROLES.CENTRE || userData.role === ROLES.SC_SP_USER) {
      const { data: permData } = await supabase
        .from('user_permissions')
        .select('*')
        .eq('user_id', userData.id)
        .single()

      if (permData) {
        permissions = {
          can_scan:         permData.can_scan         ?? true,
          can_records:      permData.can_records       ?? true,
          can_reports:      permData.can_reports       ?? false,
          can_jatha:        permData.can_jatha         ?? false,
          can_manual_entry: permData.can_manual_entry  ?? false,
          can_flags:        permData.can_flags         ?? false,
          can_edit_jatha:   permData.can_edit_jatha    ?? false,
        }
      }
    }

    setProfile({ ...userData, ...permissions })
    setLoading(false)
  }

  // ── Inactivity timer ────────────────────────────────────────────────────────
  // Starts (or restarts) the 30-second interval that watches elapsed inactivity.
  // Clears any existing interval first so only ONE interval ever runs at a time.
  const startInterval = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)

    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current

      if (elapsed >= SESSION_TIMEOUT_MS) {
        // Hard timeout — sign out and show expired screen
        clearInterval(intervalRef.current)
        intervalRef.current = null
        setSessionExpired(true)
        supabase.auth.signOut()
        return
      }

      if (elapsed >= SESSION_WARNING_MS) {
        // Show warning once, then stop checking (interval cleared)
        setSessionWarning(true)
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }, CHECK_INTERVAL_MS)
  }, [])

  // Reset inactivity — called on user interaction and on sign-in.
  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
    setSessionWarning(false)
    // Restart interval so the 55-min / 60-min clock resets cleanly
    startInterval()
  }, [startInterval])

  // ── Auth state ──────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
        lastActivityRef.current = Date.now()
        startInterval()
      } else {
        setLoading(false)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
        lastActivityRef.current = Date.now()
        setSessionExpired(false)
        setSessionWarning(false)
        startInterval()
      } else {
        setProfile(null)
        setLoading(false)
        // Clear interval on sign-out
        if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
      }
    })

    return () => {
      subscription.unsubscribe()
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Activity listeners ──────────────────────────────────────────────────────
  useEffect(() => {
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach((e) => window.addEventListener(e, resetActivity, { passive: true }))
    return () => events.forEach((e) => window.removeEventListener(e, resetActivity))
  }, [resetActivity])

  // ── Auth actions ─────────────────────────────────────────────────────────────
  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    resetActivity()
    return data
  }

  async function signOut() {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    setSessionWarning(false)
    setSessionExpired(false)
  }

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      loading,
      signIn,
      signOut,
      sessionExpired,
      setSessionExpired,
      sessionWarning,
      resetActivity,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)