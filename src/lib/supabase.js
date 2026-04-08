// ─── supabase.js ──────────────────────────────────────────────────────────────
// Fixes applied:
//  1. SC_SP_USER role — was already in ROLES but the `users` table DB constraint
//     only allows 'aso' | 'centre'. The migration SQL below MUST be run in your
//     Supabase SQL editor to unblock sc_sp_user inserts/updates:
//
//       ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
//       ALTER TABLE public.users
//         ADD CONSTRAINT users_role_check
//         CHECK (role = ANY (ARRAY['aso'::text, 'centre'::text, 'sc_sp_user'::text]));
//
//     Until this is run, any INSERT/UPDATE of a user with role='sc_sp_user' will
//     fail with a constraint violation — silently swallowed if you don't check
//     the Supabase error response.
//
//  2. No other logic changes — all helpers are unchanged. This file is included
//     in the replacement set so you have the migration note in-code permanently.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Check your .env file.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth:     { persistSession: true, autoRefreshToken: true },
  realtime: { 
    params: { eventsPerSecond: 10 },
    // Try to enable all tables
  },
})

// Helper to enable realtime on a table (run in Supabase SQL editor)
export const ENABLE_REALTIME_SQL = `
-- Add tables to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE attendance_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE attendance;
ALTER PUBLICATION supabase_realtime ADD TABLE jatha_attendance;
ALTER PUBLICATION supabase_realtime ADD TABLE queries;
ALTER PUBLICATION supabase_realtime ADD TABLE query_replies;
ALTER PUBLICATION supabase_realtime ADD TABLE sewadars;
ALTER PUBLICATION supabase_realtime ADD TABLE jatha_centres;
`

// ─────────────────────────────────────────────────────────────────────────────
// ROLES
// NOTE: 'sc_sp_user' requires the DB constraint migration above before it can
// be stored in the `users` table.
// ─────────────────────────────────────────────────────────────────────────────
export const ROLES = {
  ASO:        'aso',
  CENTRE:     'centre',
  SC_SP_USER: 'sc_sp_user',
}

export const DUTY_TYPES = {
  SATSANG:    'satsang',
  GATE_ENTRY: 'gate_entry',
  WATCH_WARD: 'watch_ward',
}

export const DUTY_TYPE_LABEL = {
  satsang:    'Satsang Duty',
  gate_entry: 'Gate Entry',
  watch_ward: 'Watch & Ward Sewadar',
}

// ─────────────────────────────────────────────────────────────────────────────
// BADGE PARSER
// ─────────────────────────────────────────────────────────────────────────────

/** Parse badge number into components. Supports FB and BH prefixes. */
export function parseBadge(badge) {
  if (!badge || badge.length < 12) return null
  const prefix     = badge.substring(0, 2)
  const centreCode = badge.substring(2, 6)
  const gender     = badge.substring(6, 7)
  const fixed      = badge.substring(7, 8)
  const serial     = badge.substring(8)
  if ((prefix !== 'FB' && prefix !== 'BH') || fixed !== 'A') return null
  return {
    prefix,
    centreCode,
    gender: gender === 'G' ? 'Male' : 'Female',
    serial,
    raw: badge,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXCEPTION DEPARTMENTS
// These departments travel centre-to-centre and can be scanned by any
// authorised user regardless of the sewadar's home centre.
// ─────────────────────────────────────────────────────────────────────────────
export const EXCEPTION_DEPARTMENTS = [
  'Administration',
  'Pathi',
  'Satsang Karta',
  'Baal Satsang Karta',
  'Office',
  'Area Secretary Office',
  'Maintenance',
]

export function isExceptionDept(dept) {
  if (!dept) return false
  const lower = dept.trim().toLowerCase()
  return EXCEPTION_DEPARTMENTS.some((d) => d.toLowerCase() === lower)
}

// ─────────────────────────────────────────────────────────────────────────────
// JATHA HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Count total calendar days in a jatha range (inclusive: To − From + 1) */
export function countSatsangDays(fromDate, toDate) {
  if (!fromDate || !toDate) return 0
  const from = new Date(fromDate + 'T00:00:00')
  const to   = new Date(toDate   + 'T00:00:00')
  if (to < from) return 0
  return Math.round((to - from) / 86_400_000) + 1
}

/** Validate jatha date range: max 10 days, to >= from */
export function validateJathaRange(fromDate, toDate) {
  if (!fromDate || !toDate) return 'Both dates are required'
  const from = new Date(fromDate + 'T00:00:00')
  const to   = new Date(toDate   + 'T00:00:00')
  if (to < from) return 'End date must be on or after start date'
  const diff = Math.round((to - from) / 86_400_000)
  if (diff > 10) return `Range is ${diff} days — maximum allowed is 10 days`
  return null
}

export const JATHA_TYPE = {
  MAJOR_CENTRE: 'major_centre',
  BEAS:         'beas',
  JATHA_HOME:   'jatha_home',
}

export const JATHA_TYPE_LABEL = {
  major_centre: 'Major Centre',
  beas:         'Beas',
  jatha_home:   'Jatha Home',
}

// ─────────────────────────────────────────────────────────────────────────────
// CENTRE SCOPE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export async function getCentreScope(centreName, role) {
  if (role === ROLES.ASO) return null
  const { data } = await supabase
    .from('centres')
    .select('centre_name, parent_centre')
    .or(`centre_name.eq.${centreName},parent_centre.eq.${centreName}`)
  return data?.map((c) => c.centre_name) || [centreName]
}

export async function getViewableCentres(profile) {
  if (!profile) return []
  if (profile.role === ROLES.ASO) return null
  if (profile.role === ROLES.CENTRE || profile.role === ROLES.SC_SP_USER) {
    return getCentreScope(profile.centre, profile.role)
  }
  return [profile.centre]
}

// ─────────────────────────────────────────────────────────────────────────────
// GEO HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function getDistanceMetres(lat1, lon1, lat2, lon2) {
  const R    = 6_371_000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ─────────────────────────────────────────────────────────────────────────────
// FLAGS & QUERIES
// ─────────────────────────────────────────────────────────────────────────────

export const FLAG_TYPES = [
  { value: 'session_flag', label: 'Attendance flag'         },
  { value: 'error_entry',  label: 'Error entry'             },
  { value: 'wrong_badge',  label: 'Wrong badge scanned'     },
  { value: 'duplicate',    label: 'Duplicate entry'         },
  { value: 'not_present',  label: 'Sewadar was not present' },
  { value: 'other',        label: 'Other'                   },
]

export const FLAG_STATUS = {
  OPEN:        'open',
  IN_PROGRESS: 'in_progress',
  RESOLVED:    'resolved',
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT LOG ACTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const LOG_ACTIONS = {
  LOGIN:               'LOGIN',
  LOGOUT:              'LOGOUT',
  MARK_IN:             'MARK_IN',
  MARK_OUT:            'MARK_OUT',
  MANUAL_IN:           'MANUAL_IN',
  MANUAL_OUT:          'MANUAL_OUT',
  MANUAL_IN_VISITOR:   'MANUAL_IN_VISITOR',   // Cross-centre visitor manual entry
  MANUAL_OUT_VISITOR:  'MANUAL_OUT_VISITOR',
  FORCE_CLOSE:         'FORCE_CLOSE_SESSION',
  STANDALONE_OUT:      'STANDALONE_OUT',
  DELETE_SESSION:      'DELETE_SESSION',
  EDIT_MANUAL_ENTRY:   'EDIT_MANUAL_ENTRY',   // 4-hour edit window
  DELETE_MANUAL_ENTRY: 'DELETE_MANUAL_ENTRY', // 4-hour delete window
  CREATE_USER:         'CREATE_USER',
  UPDATE_USER:         'UPDATE_USER',
  UPDATE_PERMISSIONS:  'UPDATE_PERMISSIONS',
  CREATE_FLAG:         'CREATE_FLAG',
  RESOLVE_FLAG:        'RESOLVE_FLAG',
  JATHA_CREATE:        'JATHA_CREATE',
  JATHA_UPDATE:        'JATHA_UPDATE',
  JATHA_DELETE:        'JATHA_DELETE',
  JATHA_FLAG:          'JATHA_FLAG',
  JATHA_FLAG_REMOVE:   'JATHA_FLAG_REMOVE',
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGGING HELPER
// ─────────────────────────────────────────────────────────────────────────────

export async function logAction(profile, action, details, extra = {}) {
  try {
    await supabase.from('logs').insert({
      user_badge: profile?.badge_number || 'SYSTEM',
      action,
      details,
      timestamp:  new Date().toISOString(),
      device_id:  navigator.userAgent.slice(0, 50),
      ...extra,
    })
  } catch (_) {
    // Logging failure is non-critical — never throw
  }
}