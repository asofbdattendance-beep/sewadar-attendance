import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env file.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    params: { eventsPerSecond: 10 }
  }
})

// Departments that any centre/SP can scan (with confirmation for non-own-centre)
export const EXCEPTION_DEPARTMENTS = [
  'Pathis', 'Baal Pathis', 'Satsang Kartas', 'Baal Satsang Kartas',
  'Administration',
  'PATHIS', 'BAAL PATHIS', 'SATSANG KARTAS', 'BAAL SATSANG KARTAS',
  'ADMINISTRATION'
]

export function isExceptionDept(dept) {
  if (!dept) return false
  return EXCEPTION_DEPARTMENTS.some(d => d.toLowerCase() === dept.toLowerCase())
}

// Fetch all centre names that fall under a given parent (including the parent itself)
// Returns array of centre_name strings
export async function getCentreScope(centreName, role) {
  if (role === ROLES.SUPER_ADMIN) return null // null = no filter = all centres

  const { data } = await supabase
    .from('centres')
    .select('centre_name, parent_centre')
    .or(`centre_name.eq.${centreName},parent_centre.eq.${centreName}`)

  return data?.map(c => c.centre_name) || [centreName]
}

// Given a user profile, return the list of centre names they can VIEW data for
export async function getViewableCentres(profile) {
  if (!profile) return []
  if (profile.role === ROLES.SUPER_ADMIN) return null // no restriction

  if (profile.role === ROLES.ADMIN) {
    return getCentreScope(profile.centre, ROLES.ADMIN)
  }

  // centre_user: only their own centre
  return [profile.centre]
}

// Calculate distance between two GPS coordinates in metres
export function getDistanceMetres(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  CENTRE_USER: 'centre_user'
}

export const FLAG_TYPES = [
  { value: 'error_entry', label: 'Error entry' },
  { value: 'wrong_badge', label: 'Wrong badge scanned' },
  { value: 'duplicate', label: 'Duplicate entry' },
  { value: 'not_present', label: 'Sewadar was not present' },
  { value: 'other', label: 'Other' },
]

export const FLAG_STATUS = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
}
