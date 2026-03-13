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

// Badge parser utility
export function parseBadge(badge) {
  if (!badge || badge.length < 12) return null
  const prefix = badge.substring(0, 2)       // FB
  const centreCode = badge.substring(2, 6)   // 5978
  const gender = badge.substring(6, 7)       // G or F
  const fixed = badge.substring(7, 8)        // A
  const serial = badge.substring(8)          // 0001
  if (prefix !== 'FB' || fixed !== 'A') return null
  return { prefix, centreCode, gender: gender === 'G' ? 'Male' : 'Female', serial, raw: badge }
}

// Special departments that any centre user can scan
export const EXCEPTION_DEPARTMENTS = [
  'Pathis', 'Baal Pathis', 'Satsang Kartas', 'Baal Satsang Kartas',
  'PATHIS', 'BAAL PATHIS', 'SATSANG KARTAS', 'BAAL SATSANG KARTAS'
]

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
