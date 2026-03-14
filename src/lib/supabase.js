import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env file.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 10 } }
})

// Badge parser utility
export function parseBadge(badge) {
  if (!badge || badge.length < 12) return null
  const prefix = badge.substring(0, 2)
  const centreCode = badge.substring(2, 6)
  const gender = badge.substring(6, 7)
  const fixed = badge.substring(7, 8)
  const serial = badge.substring(8)
  if (prefix !== 'FB' || fixed !== 'A') return null
  return { prefix, centreCode, gender: gender === 'G' ? 'Male' : 'Female', serial, raw: badge }
}

// Departments that travel centre-to-centre — scanned by ANY authorised user
export const EXCEPTION_DEPARTMENTS = [
  'Administration', 'Office', 'Area Secretary Office',
  'Pathis', 'Baal Pathis', 'Satsang Kartas', 'Baal Satsang Kartas',
  'Pathi', 'Satsang Karta', 'Baal Satsang Karta',
]

export function isExceptionDept(dept) {
  if (!dept) return false
  const lower = dept.trim().toLowerCase()
  return EXCEPTION_DEPARTMENTS.some(d => d.toLowerCase() === lower)
}

// Count Sundays and Wednesdays (satsang days) in a date range, inclusive
export function countSatsangDays(fromDate, toDate) {
  let count = 0
  const cur = new Date(fromDate + 'T00:00:00')
  const end = new Date(toDate + 'T00:00:00')
  while (cur <= end) {
    const day = cur.getDay() // 0=Sun, 3=Wed
    if (day === 0 || day === 3) count++
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

// Validate jatha date range: max 10 days, to >= from
export function validateJathaRange(fromDate, toDate) {
  if (!fromDate || !toDate) return 'Both dates are required'
  const from = new Date(fromDate + 'T00:00:00')
  const to   = new Date(toDate   + 'T00:00:00')
  if (to < from) return 'End date must be on or after start date'
  const diff = Math.round((to - from) / 86400000)
  if (diff > 10) return `Range is ${diff} days — maximum allowed is 10 days`
  return null
}

export const JATHA_TYPE = {
  MAJOR_CENTRE: 'major_centre',
  BEAS: 'beas',
}

export const JATHA_TYPE_LABEL = {
  major_centre: 'Major Centre',
  beas: 'Beas',
}

export async function getCentreScope(centreName, role) {
  if (role === ROLES.AREA_SECRETARY) return null
  const { data } = await supabase
    .from('centres')
    .select('centre_name, parent_centre')
    .or(`centre_name.eq.${centreName},parent_centre.eq.${centreName}`)
  return data?.map(c => c.centre_name) || [centreName]
}

export async function getViewableCentres(profile) {
  if (!profile) return []
  if (profile.role === ROLES.AREA_SECRETARY) return null
  if (profile.role === ROLES.CENTRE_USER) return getCentreScope(profile.centre, ROLES.CENTRE_USER)
  return [profile.centre]
}

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
  AREA_SECRETARY: 'area_secretary',
  CENTRE_USER: 'centre_user',
  SC_SP_USER: 'sc_sp_user'
}

export const FLAG_TYPES = [
  { value: 'error_entry',   label: 'Error entry' },
  { value: 'wrong_badge',   label: 'Wrong badge scanned' },
  { value: 'duplicate',     label: 'Duplicate entry' },
  { value: 'not_present',   label: 'Sewadar was not present' },
  { value: 'other',         label: 'Other' },
]

export const FLAG_STATUS = {
  OPEN: 'open',
  IN_PROGRESS: 'in_progress',
  RESOLVED: 'resolved',
}