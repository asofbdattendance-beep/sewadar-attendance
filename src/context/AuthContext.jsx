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
    
    // Determine if user is ASO/Super Admin
    const isASO = data?.role === ROLES.SUPER_ADMIN || data?.role === 'admin'
    
    let perms = {}
    if (isASO) {
      // ASO gets all permissions - fetch from role_masters if available
      const { data: roleData } = await supabase
        .from('role_masters')
        .select('permissions')
        .eq('role_key', ROLES.SUPER_ADMIN)
        .single()
      
      if (roleData?.permissions) {
        perms = typeof roleData.permissions === 'string' ? JSON.parse(roleData.permissions) : roleData.permissions
      } else {
        perms = { allow_dashboard: true, allow_records: true, allow_scan: true, allow_gate_entry: true, allow_jatha: true, allow_reports: true, allow_settings: true }
      }
    } else if (data?.permissions) {
      // Parse custom permissions from DB
      if (typeof data.permissions === 'string') {
        try { perms = JSON.parse(data.permissions) } catch { perms = {} }
      } else {
        perms = data.permissions || {}
      }
      
      // If no custom permissions set, fetch from role defaults
      if (Object.keys(perms).length === 0 && data?.role) {
        const { data: roleData } = await supabase
          .from('role_masters')
          .select('permissions')
          .eq('role_key', data.role)
          .single()
        
        if (roleData?.permissions) {
          perms = typeof roleData.permissions === 'string' ? JSON.parse(roleData.permissions) : roleData.permissions
        }
      }
    }
    
    setProfile(data)
    setPermissions(perms)
    setLoading(false)
  }

  // Helper function to check permission
  const hasPermission = (permKey) => {
    if (profile?.role === ROLES.SUPER_ADMIN || profile?.role === 'admin') {
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
