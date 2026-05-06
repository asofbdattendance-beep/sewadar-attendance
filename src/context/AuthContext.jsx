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

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else { setProfile(null); setPermissions({}); setLoading(false) }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    const { data } = await supabase
      .from('users')
      .select('*')
      .eq('auth_id', userId)
      .single()
    
    // Determine if user is Super Admin (only super_admin or aso)
    const isASO = data?.role === ROLES.SUPER_ADMIN || data?.role === 'aso'
    
    let perms = {}
    if (isASO) {
      // ASO gets all permissions by default
      perms = { allow_dashboard: true, allow_records: true, allow_scan: true, allow_gate_entry: true, allow_jatha: true, allow_reports: true, allow_settings: true }
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
    setLoading(false)
  }

  // Helper function to check permission
  const hasPermission = (permKey) => {
    // Only super_admin/aso bypasses all permission checks
    if (profile?.role === ROLES.SUPER_ADMIN || profile?.role === 'aso') {
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
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    setPermissions({})
  }

  return (
    <AuthContext.Provider value={{ user, profile, permissions, loading, signIn, signOut, hasPermission }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
