import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, ROLES } from '../lib/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [permissions, setPermissions] = useState({})

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })

    let initialSession = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) {
        if (initialSession) {
          initialSession = false
          return
        }
        fetchProfile(session.user.id)
      } else { setProfile(null); setPermissions({}); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    try {
      const { data } = await supabase
        .from('users')
        .select('id, role, centre, badge_number, name, email, permissions, is_active, created_at')
        .eq('auth_id', userId)
        .single()

      // Determine if user is Super Admin (only super_admin or aso)
      const isASO = data?.role === ROLES.SUPER_ADMIN || data?.role === ROLES.ASO
      const isFullAdmin = data?.role === ROLES.SUPER_ADMIN

      let perms = {}
      if (isFullAdmin) {
        // super_admin gets all permissions by default
        perms = { allow_dashboard: true, allow_records: true, allow_scan: true, allow_gate_entry: true, allow_jatha: true, allow_reports: true, allow_settings: true }
      } else if (isASO) {
        // aso gets read-only permissions
        perms = { allow_dashboard: true, allow_records: true, allow_reports: true }
      } else if (data?.role) {
        if (data.permissions) {
          if (typeof data.permissions === 'string') {
            try { perms = JSON.parse(data.permissions) } catch { perms = {} }
          } else {
            perms = data.permissions || {}
          }
        }
        // If no permissions set, user gets NO access by default (not all access)
      }

      setProfile(data)
      setPermissions(perms)
    } catch (err) {
      console.error('Failed to fetch profile:', err)
      setProfile(null)
      setPermissions({})
    } finally {
      setLoading(false)
    }
  }

  // Helper function to check permission
  const hasPermission = (permKey) => {
    // super_admin bypasses all permission checks
    if (profile?.role === ROLES.SUPER_ADMIN) {
      return true
    }
    return !!permissions[permKey]
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    return data
  }

  async function signOut() {
    try {
      await supabase.auth.signOut()
      setUser(null)
      setProfile(null)
      setPermissions({})
    } catch (err) {
      console.error('Sign out error:', err)
      throw err
    }
  }

  return (
    <AuthContext.Provider value={{ user, profile, permissions, loading, signIn, signOut, hasPermission }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
