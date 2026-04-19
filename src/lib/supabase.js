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

export const ROLES = {
  SUPER_ADMIN: 'super_admin', // ASO - Full access
  CENTRE_ADMIN: 'centre_admin',  // Parent Centre Admin
  SC_SP_USER: 'sc_sp_user'      // Child Centre / Scanner
}

export const ROLE_LABELS = {
 aso: 'ASO (Super Admin)',
  centre_admin: 'Centre Admin',
  sc_sp_user: 'Scanner'
}

export const ROLE_COLORS = {
 aso: '#dc2626',
  centre_admin: '#7c3aed',
  sc_sp_user: '#16a34a'
}

export const DUTY_TYPES = {
  SATSCAN: 'SATSCAN',
  DAILY: 'DAILY',
  NIGHT: 'NIGHT',
  WATCH_AND_WARD: 'WATCH_AND_WARD',
  JATHA: 'JATHA'
}

export const SESSION_STATUS = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED'
}

export const SPECIAL_DEPARTMENTS = [
  'ADMINISTRATION',
  'PATHI',
  'SATSANG KARTA',
  'BAAL SATSANG KARTA',
  'OFFICE',
  'AREA SECRETARY OFFICE',
  'MAINTENANCE'
]

export function isSatsangDay(date = new Date()) {
  const day = date.getDay()
  return day === 0 || day === 3
}

export function getDutyType(date = new Date()) {
  return isSatsangDay(date) ? DUTY_TYPES.SATSCAN : DUTY_TYPES.DAILY
}

export function isSpecialDepartment(department) {
  if (!department) return false
  return SPECIAL_DEPARTMENTS.includes(department.toUpperCase())
}

export function countSatsangDays(fromDate, toDate) {
  if (!fromDate || !toDate) return 0
  const from = new Date(fromDate + 'T00:00:00')
  const to = new Date(toDate + 'T00:00:00')
  if (to < from) return 0
  let count = 0
  const current = new Date(from)
  while (current <= to) {
    if (isSatsangDay(current)) count++
    current.setDate(current.getDate() + 1)
  }
  return count
}

export function formatTime12Hour(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return '—'
  const parts = timeStr.split(':')
  if (parts.length < 2) return '—'
  const h = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  if (isNaN(h) || isNaN(m)) return '—'
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 || 12
  return `${hour12}:${String(m).padStart(2, '0')} ${ampm}`
}

export function formatDateIndian(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export const GENDER = {
  MALE: 'M',
  FEMALE: 'F'
}
