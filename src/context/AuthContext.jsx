import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const SESSION_TIMEOUT_MS = 60 * 60 * 1000 // 60 minutes
const SESSION_WARNING_MS = 55 * 60 * 1000 // 55 minutes — show warning

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [sessionWarning, setSessionWarning] = useState(false)
  const lastActivityRef = useRef(Date.now())
  const timeoutCheckRef = useRef(null)

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
    setSessionWarning(false)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        fetchProfile(session.user.id)
        lastActivityRef.current = Date.now()
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
      } else {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll']
    events.forEach(e => window.addEventListener(e, resetActivity, { passive: true })) // NOTE: resetActivity only reads a ref — passive: true is safe and avoids performance penalty
    return () => events.forEach(e => window.removeEventListener(e, resetActivity))
  }, [resetActivity])

  useEffect(() => {
    if (sessionExpired) return
    timeoutCheckRef.current = setInterval(() => {
      if (sessionExpired) { clearInterval(timeoutCheckRef.current); return }
      const elapsed = Date.now() - lastActivityRef.current
      if (elapsed >= SESSION_TIMEOUT_MS) {
        clearInterval(timeoutCheckRef.current)
        setSessionExpired(true)
        supabase.auth.signOut()
      } else if (elapsed >= SESSION_WARNING_MS && !sessionWarning) {
        setSessionWarning(true)
      }
    }, 30000)
    return () => clearInterval(timeoutCheckRef.current)
  }, [sessionExpired, sessionWarning])

  async function fetchProfile(userId) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', userId)
      .single()
    if (error) {
      console.warn('Failed to load profile:', error)
      setProfile(null)
    } else {
      setProfile(data)
    }
    setLoading(false)
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    resetActivity()
    return data
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    localStorage.removeItem('attendance_offline_queue')
    localStorage.removeItem('attendance_cache')
    localStorage.removeItem('sewadars_cache')
    localStorage.removeItem('sewadars_cache_time')
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut, sessionExpired, setSessionExpired, sessionWarning, resetActivity }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
