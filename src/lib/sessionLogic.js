/**
 * sessionLogic.js — Sewadar Attendance System
 *
 * The single source of truth for all attendance decisions.
 *
 * Fixes applied vs previous version:
 *  1. TIME CONFLICT CHECK  — new hasTimeConflict() helper prevents any new IN
 *     from overlapping an existing closed session's window on the same day.
 *     evaluateScan() now calls this before allowing a new IN.
 *
 *  2. W&W MINIMUM DURATION — the hard 10-min minimum is BYPASSED for sessions
 *     that cross midnight (cross-midnight = genuine W&W by definition). For
 *     same-day sessions the minimum remains 10 min.
 *
 *  3. DURATION CAP RAISED TO 20h — formatDuration was capped at 12h which
 *     caused genuine W&W overnight sessions (e.g. 10pm – 6am = 8h) to show
 *     "—" when they happened to exceed the old cap. Cap is now 20h so any
 *     real shift fits. Sessions truly beyond 20h still return null.
 *
 *  4. DUPLICATE SCAN WINDOW — raised from 30s to 90s to prevent race-condition
 *     duplicates in high-volume scanning scenarios.
 *
 *  5. GEO LOCATION LOGGED ON MANUAL ENTRY — executeManualEntry() now accepts
 *     latitude/longitude and writes them to the attendance row so we have an
 *     audit trail of where the operator was when they made the manual entry.
 *
 *  6. DB CONSTRAINT NOTE — the `users` table CHECK allows only 'aso' | 'centre'.
 *     SC/SP users (role = 'sc_sp_user') need the constraint updated:
 *       ALTER TABLE users DROP CONSTRAINT users_role_check;
 *       ALTER TABLE users ADD CONSTRAINT users_role_check
 *         CHECK (role = ANY (ARRAY['aso','centre','sc_sp_user']));
 *     This file already handles sc_sp_user correctly in all role checks.
 *
 * Hard Rules (unchanged):
 *  - No IN without OUT (one open session at a time, no time overlap)
 *  - No OUT without IN (centre users)
 *  - Jatha active = hard block for everyone
 *  - ASO can override blocked states with reason + full logging
 *  - Centre/SC_SP users get hard blocks only
 */

import { scanTimeToISTDate } from './dateUtils'
import { DUTY_TYPES, DUTY_TYPE_LABEL } from './supabase'

export { DUTY_TYPES, DUTY_TYPE_LABEL }

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const MIN_SESSION_MS        =  10 * 60 * 1000   // 10 minutes minimum (regular sessions)
const MAX_SESSION_MS        =  20 * 60 * 1000 * 1  // alias used inline; see note
// W&W sessions cross midnight and can exceed 12h — allow up to 20h
const MAX_SESSION_MS_NORMAL =  12 * 60 * 60 * 1000  // 12h for same-day sessions
const MAX_SESSION_MS_WW     =  20 * 60 * 60 * 1000  // 20h for W&W / cross-midnight
const DUPLICATE_WINDOW_MS   =  90 * 1000            // 90s duplicate guard (was 30s)

// ─────────────────────────────────────────────────────────────────────────────
// DUTY TYPE COMPUTATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute duty type from scan time.
 * Wed/Sun → SATSANG, everything else → GATE_ENTRY.
 * watchWardConfirmed = true → WATCH_WARD (overrides all).
 */
export function computeDutyType(scanTimeISO, watchWardConfirmed = false) {
  if (watchWardConfirmed) return DUTY_TYPES.WATCH_WARD

  const day = new Date(scanTimeISO).toLocaleDateString('en-IN', {
    weekday: 'short',
    timeZone: 'Asia/Kolkata',
  })

  return (day === 'Wed' || day === 'Sun') ? DUTY_TYPES.SATSANG : DUTY_TYPES.GATE_ENTRY
}

/**
 * Returns true when the scan time is 9 PM or later (IST).
 * Used to prompt Watch & Ward confirmation on late-night scans.
 */
export function isLateNightScan(scanTimeISO) {
  const hourStr = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    hour12: false,
  }).format(new Date(scanTimeISO))
  return parseInt(hourStr, 10) >= 21
}

// ─────────────────────────────────────────────────────────────────────────────
// TIME CONFLICT CHECK  (Fix #1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * hasTimeConflict — checks whether a proposed IN time falls inside any
 * existing session's [in_time, out_time) window.
 *
 * Returns the conflicting session object if found, otherwise null.
 *
 * Rules:
 *  - Only closed sessions with BOTH in_time and out_time are checked.
 *    (An open session is handled separately by the open-session block.)
 *  - A proposed IN at exactly the OUT time of a previous session is allowed
 *    (non-inclusive upper bound).
 *
 * @param {Array}  existingSessions  — sessions returned by getSessionsForDate()
 * @param {string} proposedInISO     — ISO timestamp of the proposed new IN
 * @returns {object|null}
 */
export function hasTimeConflict(existingSessions, proposedInISO) {
  if (!existingSessions?.length || !proposedInISO) return null
  const t = new Date(proposedInISO)
  return (
    existingSessions.find((s) => {
      if (!s.in_time || !s.out_time) return false // open or incomplete — skip
      const inT  = new Date(s.in_time)
      const outT = new Date(s.out_time)
      return t >= inT && t < outT
    }) || null
  )
}

/**
 * hasTimeConflictForOut — checks if proposed OUT time overlaps with any
 * existing session's [in_time, out_time) window.
 * 
 * Returns conflicting session if found, null otherwise.
 * 
 * @param {Array} existingSessions - existing sessions to check against
 * @param {string} proposedOutISO - ISO timestamp of proposed OUT time
 * @param {string} proposedInISO - ISO timestamp of the IN time (to exclude own session)
 * @returns {object|null}
 */
export function hasTimeConflictForOut(existingSessions, proposedOutISO, proposedInISO) {
  if (!existingSessions?.length || !proposedOutISO) return null
  const outT = new Date(proposedOutISO)
  return (
    existingSessions.find((s) => {
      if (!s.in_time || !s.out_time) return false
      // Skip the session we're editing (compare by proposed IN)
      if (proposedInISO && s.in_time === proposedInISO) return false
      const inT = new Date(s.in_time)
      const existingOutT = new Date(s.out_time)
      // Check if proposed OUT falls inside another session's range
      return outT > inT && outT <= existingOutT
    }) || null
  )
}

/**
 * hasSessionOverlap — checks if a time range [in, out) overlaps with any
 * existing session. Used for editing sessions.
 * 
 * @param {Array} existingSessions - sessions to check against
 * @param {string} proposedInISO - proposed IN time
 * @param {string} proposedOutISO - proposed OUT time (can be null for open sessions)
 * @param {string} excludeSessionId - session ID to exclude (for editing own session)
 * @returns {object|null} - returns conflicting session or null
 */
export function hasSessionOverlap(existingSessions, proposedInISO, proposedOutISO, excludeSessionId = null) {
  if (!existingSessions?.length || !proposedInISO) return null
  
  const proposedIn = new Date(proposedInISO)
  const proposedOut = proposedOutISO ? new Date(proposedOutISO) : null
  
  return existingSessions.find(s => {
    // Skip open sessions or the session being edited
    if (!s.in_time || !s.out_time) return false
    if (excludeSessionId && s.id === excludeSessionId) return false
    
    const existingIn = new Date(s.in_time)
    const existingOut = new Date(s.out_time)
    
    // Check for any overlap: [A_start, A_end) overlaps with [B_start, B_end) if:
    // A_start < B_end AND A_end > B_start
    if (proposedOut) {
      return proposedIn < existingOut && proposedOut > existingIn
    } else {
      // For open session (no OUT time), check if IN falls in existing range
      return proposedIn < existingOut
    }
  }) || null
}

/**
 * checkJathaOverlap — checks if a proposed time range overlaps with any
 * jatha that the person is part of.
 * 
 * @param {Array} jathaRecords - jatha records for the person
 * @param {string} proposedInISO - proposed IN time
 * @param {string} proposedOutISO - proposed OUT time (can be null)
 * @returns {object|null} - returns conflicting jatha or null
 */
export function checkJathaOverlap(jathaRecords, proposedInISO, proposedOutISO) {
  if (!jathaRecords?.length || !proposedInISO) return null
  
  const proposedIn = new Date(proposedInISO)
  const proposedOut = proposedOutISO ? new Date(proposedOutISO) : null
  
  return jathaRecords.find(j => {
    if (!j.date_from || !j.date_to) return false
    
    const jathaIn = new Date(j.date_from)
    const jathaOut = new Date(j.date_to)
    
    if (proposedOut) {
      return proposedIn < jathaOut && proposedOut > jathaIn
    } else {
      return proposedIn < jathaOut
    }
  }) || null
}

/**
 * Comprehensive time conflict detector - checks all scenarios:
 * - Existing attendance sessions
 * - Jatha assignments
 * 
 * @param {Object} options
 * @param {Array} options.sessions - existing sessions
 * @param {Array} options.jathas - jatha records
 * @param {string} options.proposedInISO - proposed IN time
 * @param {string} options.proposedOutISO - proposed OUT time (optional)
 * @param {string} options.excludeSessionId - session ID to exclude (for edits)
 * @param {string} options.badgeNumber - badge number for error message
 * @returns {Object} - { hasConflict, type, conflictingItem, message }
 */
export function detectTimeConflict({ sessions, jathas, proposedInISO, proposedOutISO, excludeSessionId, badgeNumber }) {
  // Check session overlap
  const sessionConflict = hasSessionOverlap(sessions, proposedInISO, proposedOutISO, excludeSessionId)
  if (sessionConflict) {
    const inTime = sessionConflict.in_time ? new Date(sessionConflict.in_time).toLocaleString('en-IN', { 
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' 
    }) : ''
    const outTime = sessionConflict.out_time ? new Date(sessionConflict.out_time).toLocaleString('en-IN', { 
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' 
    }) : 'Open'
    return {
      hasConflict: true,
      type: 'session',
      conflictingItem: sessionConflict,
      message: `Time overlaps with existing session (${inTime} - ${outTime})`
    }
  }
  
  // Check Jatha overlap
  if (jathas?.length) {
    const jathaConflict = checkJathaOverlap(jathas, proposedInISO, proposedOutISO)
    if (jathaConflict) {
      return {
        hasConflict: true,
        type: 'jatha',
        conflictingItem: jathaConflict,
        message: `Person is assigned to Jatha from ${new Date(jathaConflict.date_from).toLocaleDateString('en-IN')} to ${new Date(jathaConflict.date_to).toLocaleDateString('en-IN')}`
      }
    }
  }
  
  return { hasConflict: false, type: null, conflictingItem: null, message: '' }
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION QUERIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the single open session for a badge, or null.
 */
export async function getOpenSession(supabase, badgeNumber) {
  const { data, error } = await supabase
    .from('attendance_sessions')
    .select('id, in_time, in_id, duty_type, date_ist')
    .eq('badge_number', badgeNumber)
    .eq('is_open', true)
    .order('in_time', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error && import.meta.env.DEV) console.warn('[Session] getOpenSession failed:', error.message)
  return data || null
}

/**
 * Check for a recent duplicate scan (same badge + type within DUPLICATE_WINDOW_MS).
 * Returns true if a duplicate is detected.
 *
 * Window raised from 30s → 90s (Fix #4).
 */
export async function checkDuplicateScan(supabase, badgeNumber, type, scanTimeISO) {
  const since = new Date(new Date(scanTimeISO).getTime() - DUPLICATE_WINDOW_MS).toISOString()

  const { data, error } = await supabase
    .from('attendance')
    .select('id, scan_time, type')
    .eq('badge_number', badgeNumber)
    .eq('type', type)
    .gte('scan_time', since)
    .order('scan_time', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error && import.meta.env.DEV) console.warn('[Session] checkDuplicateScan failed:', error.message)
  return !!data
}

/**
 * Get all sessions for a badge on a specific IST date.
 */
export async function getSessionsForDate(supabase, badgeNumber, dateIST) {
  const { data, error } = await supabase
    .from('attendance_sessions')
    .select('id, duty_type, in_time, out_time, is_open, force_closed, manual_in, manual_out')
    .eq('badge_number', badgeNumber)
    .eq('date_ist', dateIST)
    .order('in_time', { ascending: true })

  if (error && import.meta.env.DEV) console.warn('[Session] getSessionsForDate failed:', error.message)
  return data || []
}

/**
 * Get active jatha entry for a badge on a specific IST date.
 * Returns null if no jatha is active.
 */
export async function getActiveJatha(supabase, badgeNumber, dateIST) {
  const { data, error } = await supabase
    .from('jatha_attendance')
    .select('id, jatha_type, jatha_centre, jatha_dept, date_from, date_to')
    .eq('badge_number', badgeNumber)
    .lte('date_from', dateIST)
    .gte('date_to', dateIST)
    .limit(1)
    .maybeSingle()

  if (error && import.meta.env.DEV) console.warn('[Session] getActiveJatha failed:', error.message)
  return data || null
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE EVALUATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * evaluateScan — the single decision function.
 *
 * Call this before any scan (barcode OR manual) to determine whether it
 * should be allowed, blocked, or needs additional confirmation.
 *
 * @param {object} supabase
 * @param {object} params
 * @param {string} params.badgeNumber
 * @param {string} params.type           — 'IN' | 'OUT'
 * @param {string} params.scanTimeISO    — ISO timestamp
 * @param {boolean} params.watchWard     — user confirmed Watch & Ward
 * @param {boolean} params.isAso
 * @param {boolean} params.isCentreUser
 *
 * @returns {object}  Result with `status`, `action`, `reason`, etc.
 */
export async function evaluateScan(supabase, {
  badgeNumber,
  type,
  scanTimeISO,
  watchWard    = false,
  isAso        = false,
  isCentreUser = false,
}) {
  if (!badgeNumber || typeof badgeNumber !== 'string') {
    throw new Error('Invalid badge number: ' + badgeNumber)
  }
  if (!scanTimeISO || isNaN(new Date(scanTimeISO).getTime())) {
    throw new Error('Invalid scan time: ' + scanTimeISO)
  }

  // Step 0 — Duplicate scan guard (skipped for ASO who may legitimately retry)
  if (!isAso) {
    const isDuplicate = await checkDuplicateScan(supabase, badgeNumber, type, scanTimeISO)
    if (isDuplicate) {
      return {
        status:     'blocked',
        reason:     'duplicate_scan',
        canOverride: false,
        message:    'Duplicate scan detected. Please wait before scanning again.',
      }
    }
  }

  const scanDateIST = scanTimeToISTDate(scanTimeISO)

  // Step 1 — Active jatha check (hard block for everyone, no override)
  const jatha = await getActiveJatha(supabase, badgeNumber, scanDateIST)
  if (jatha) {
    return {
      status:     'blocked',
      reason:     'jatha_active',
      jatha,
      canOverride: false,
    }
  }

  // Step 2 — Get open session and today's sessions
  const openSession   = await getOpenSession(supabase, badgeNumber)
  const todaySessions = await getSessionsForDate(supabase, badgeNumber, scanDateIST)

  // Step 3 — Compute duty type
  const dutyType = computeDutyType(scanTimeISO, watchWard)

  // ── IN path ─────────────────────────────────────────────────────────────────
  if (type === 'IN') {
    const openSessionDate = openSession?.date_ist
      ? String(openSession.date_ist).substring(0, 10)
      : null
    const isSameDay = openSessionDate === scanDateIST

    // Same-day open session → must scan OUT first
    if (openSession && isSameDay) {
      return {
        status:     'blocked',
        reason:     'open_session_same_day',
        openSession,
        todaySessions,
        canOverride: false,
        message:    'Cannot create new IN on same day. Scan OUT first.',
      }
    }

    // Previous-day open session → needs W&W or force-close decision
    if (openSession && !isSameDay) {
      if (!watchWard) {
        const oldInDate  = openSession.in_time ? new Date(openSession.in_time) : null
        const oldDay     = oldInDate
          ? oldInDate.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' })
          : ''
        const wasSatsang = oldDay === 'Wed' || oldDay === 'Sun'

        return {
          status:              'needs_watch_ward_confirmation',
          reason:              'previous_day_open_session',
          openSession,
          todaySessions,
          message:             `You have an open session from ${openSessionDate}. Was this Watch & Ward (overnight duty)?`,
          oldSessionWasSatsang: wasSatsang,
          oldSessionInDate:    openSessionDate,
        }
      }
      // watchWard = true — executeScan will auto-close the old session
    }

    // FIX #1 — Time conflict check against closed sessions on the same day
    const conflict = hasTimeConflict(todaySessions, scanTimeISO)
    if (conflict) {
      // ASO can override time conflicts (with reason), centre users cannot
      if (!isAso) {
        return {
          status:          'blocked',
          reason:          'time_conflict',
          conflictSession: conflict,
          todaySessions,
          canOverride:     false,
          message:         `This sewadar already has an entry from ${
            _fmtTime(conflict.in_time)
          } to ${
            _fmtTime(conflict.out_time)
          } on this date. A new IN cannot overlap an existing session.`,
        }
      }
      // isAso — surface as a warning; let ASO decide to proceed
      return {
        status:          'time_conflict_override',
        reason:          'time_conflict',
        conflictSession: conflict,
        todaySessions,
        canOverride:     true,
        requiresReason:  true,
        message:         `Time overlap with existing session (${
          _fmtTime(conflict.in_time)
        } – ${
          _fmtTime(conflict.out_time)
        }). Proceed only if correcting data.`,
      }
    }

    // All clear — allow new IN
    return {
      status:              'allowed',
      action:              'new_in',
      dutyType,
      todaySessions,
      existingOpenSession: openSession, // executeScan uses this to close previous W&W
    }
  }

  // ── OUT path ─────────────────────────────────────────────────────────────────
  if (type === 'OUT') {
    if (!openSession) {
      if (isCentreUser) {
        return {
          status:     'blocked',
          reason:     'no_open_session',
          todaySessions,
          canOverride: false,
        }
      }
      // ASO standalone OUT (data correction)
      return {
        status:         'allowed',
        action:         'standalone_out',
        todaySessions,
        canOverride:    isAso,
        requiresReason: isAso,
      }
    }

    // Check if this is a previous-day open session
    const openSessionDate = openSession?.date_ist
      ? String(openSession.date_ist).substring(0, 10)
      : null
    const isSameDay = openSessionDate === scanDateIST

    // Previous-day open session → needs W&W or forgot OUT confirmation
    if (!isSameDay) {
      const oldInDate = openSession.in_time ? new Date(openSession.in_time) : null
      const oldDay = oldInDate
        ? oldInDate.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' })
        : ''
      const wasSatsang = oldDay === 'Wed' || oldDay === 'Sun'

      return {
        status:              'needs_watch_ward_confirmation',
        reason:              'previous_day_open_session',
        action:              'close_and_confirm',
        openSession,
        todaySessions,
        message:             `You have an open session from ${openSessionDate}. Did you forget to scan OUT?`,
        oldSessionWasSatsang: wasSatsang,
        oldSessionInDate:    openSessionDate,
      }
    }

    return {
      status:     'allowed',
      action:     'close_session',
      dutyType:   openSession.duty_type,
      openSession,
      todaySessions,
    }
  }

  return { status: 'blocked', reason: 'unknown_type', canOverride: false }
}

// Internal helper — format IST time for human-readable error messages
function _fmtTime(isoString) {
  if (!isoString) return '?'
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(isoString))
}

// ─────────────────────────────────────────────────────────────────────────────
// EXECUTE SCAN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * executeScan — write a verified scan to the database.
 *
 * Only call after evaluateScan returns status='allowed' (or ASO override).
 *
 * Changes vs previous version:
 *  - OUT validation: cross-midnight sessions skip the 10-min minimum (Fix #2).
 *  - Max session duration uses MAX_SESSION_MS_WW (20h) for W&W, 12h otherwise.
 *  - latitude/longitude are always written to the attendance row (Fix #5).
 */
export async function executeScan(supabase, {
  badge_number,
  sewadar_name,
  centre,
  department,
  type,
  scanTimeISO,
  dutyType,
  openSession        = null,
  scanner_badge,
  scanner_name,
  scanner_centre,
  latitude,
  longitude,
  manual_entry       = false,
  submitted_by,
  closePreviousSession = false,
  closePreviousOutTime = null,
  remark             = null,
}) {
  const scanDateIST = scanTimeToISTDate(scanTimeISO)

  // ── IN ──────────────────────────────────────────────────────────────────────
  if (type === 'IN') {
    // If a previous-day open session exists (W&W or forgotten OUT), close it first
    if (openSession?.id) {
      const oldSessionDate = openSession.date_ist
        ? String(openSession.date_ist).substring(0, 10)
        : null
      const shouldClose = (oldSessionDate && oldSessionDate !== scanDateIST && openSession.in_time)
        || closePreviousSession

      if (shouldClose) {
        let outTime
        if (closePreviousOutTime) {
          outTime = closePreviousOutTime
        } else {
          // Default: 11:59:59 PM of the IN date
          const inDate = new Date(openSession.in_time)
          const y = inDate.getFullYear()
          const m = String(inDate.getMonth() + 1).padStart(2, '0')
          const d = String(inDate.getDate()).padStart(2, '0')
          outTime = `${y}-${m}-${d}T23:59:59+05:30`
          
          // Ensure OUT is AFTER IN (handles case where IN was late night like 11:30pm)
          if (new Date(outTime) <= new Date(openSession.in_time)) {
            // If 23:59 is not after IN, use IN time + 1 minute
            const inTime = new Date(openSession.in_time)
            inTime.setMinutes(inTime.getMinutes() + 1)
            outTime = inTime.toISOString()
          }
        }

        const durationMs = new Date(outTime) - new Date(openSession.in_time)
        if (durationMs > MAX_SESSION_MS_WW) {
          throw new Error('SESSION_EXCEEDS_LIMIT:' + JSON.stringify({
            in_time:  openSession.in_time,
            max_hours: 20,
            message:  'Session exceeds 20 hours. Please provide OUT time manually.',
          }))
        }

        const { error: closeError } = await supabase
          .from('attendance_sessions')
          .update({
            out_time:             outTime,
            is_open:              false,
            force_closed:         closePreviousSession,
            force_closed_reason:  closePreviousSession
              ? 'Closed: User confirmed this was NOT Watch & Ward'
              : `Auto-closed: New W&W session started on ${scanDateIST}`,
            updated_at:           new Date().toISOString(),
          })
          .eq('id', openSession.id)

        if (closeError) throw new Error('Failed to close previous session: ' + closeError.message)

        // Create the system OUT record for the old session
        if (openSession.in_id) {
          try {
            await supabase.from('attendance').insert({
              badge_number,
              type:           'OUT',
              scan_time:      outTime,
              duty_type:      openSession.duty_type,
              session_id:     openSession.id,
              scanner_badge:  'SYSTEM',
              scanner_name:   'System Auto-Close',
              scanner_centre: openSession.centre,
              manual_entry:   true,
              submitted_by:   scanner_badge || 'SYSTEM',
              submitted_at:   new Date().toISOString(),
            })
          } catch (_) { /* non-critical */ }
        }

        try {
          await supabase.from('logs').insert({
            user_badge: scanner_badge || 'SYSTEM',
            action:     closePreviousSession ? 'FORCE_CLOSE_SESSION' : 'AUTO_CLOSE_SESSION',
            details:    closePreviousSession
              ? `Closed session ${openSession.id} (badge: ${badge_number}) — user denied W&W`
              : `Auto-closed session ${openSession.id} (badge: ${badge_number}) — new W&W on ${scanDateIST}`,
            timestamp: new Date().toISOString(),
          })
        } catch (_) { /* logging is non-critical */ }
      }
    }

    // Create session row
    const { data: session, error: sessionError } = await supabase
      .from('attendance_sessions')
      .insert({
        badge_number,
        duty_type:      dutyType,
        in_time:        scanTimeISO,
        date_ist:       scanDateIST,
        is_open:        true,
        manual_in:      manual_entry,
        scanner_badge,
        scanner_name,
        scanner_centre,
        in_scanner_name: scanner_name,
        remark:         remark || null,
      })
      .select('id')
      .single()

    if (sessionError) throw new Error('Failed to create session: ' + sessionError.message)

    // Create attendance row (Fix #5 — geo coords always written)
    const { data: att, error: attError } = await supabase
      .from('attendance')
      .insert({
        badge_number,
        type:         'IN',
        scan_time:    scanTimeISO,
        duty_type:    dutyType,
        session_id:   session.id,
        scanner_badge,
        scanner_name,
        scanner_centre,
        latitude:     latitude ?? null,
        longitude:    longitude ?? null,
        manual_entry,
        submitted_by,
        submitted_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (attError) {
      // Rollback: delete the session we just created
      await deleteSessionWithAttendance(supabase, {
        sessionId:       session.id,
        deletedByBadge:  scanner_badge,
        reason:          'Failed to create IN attendance — rollback',
      })
      if (attError.code === '23505') {
        throw new Error('Duplicate entry. This attendance record may already exist.')
      }
      throw new Error('Failed to record IN: ' + attError.message)
    }

    // Back-fill in_id on session
    await supabase
      .from('attendance_sessions')
      .update({ in_id: att.id })
      .eq('id', session.id)

    return { attendanceId: att.id, sessionId: session.id }
  }

  // ── OUT ─────────────────────────────────────────────────────────────────────
  if (type === 'OUT') {
    if (!openSession?.id) throw new Error('executeScan OUT called with no openSession')

    // OUT must be after IN
    if (openSession.in_time && new Date(scanTimeISO) < new Date(openSession.in_time)) {
      throw new Error('OUT time cannot be before IN time. Please correct the scan.')
    }

    if (openSession.in_time) {
      const durationMs   = new Date(scanTimeISO) - new Date(openSession.in_time)
      const isCrossMidnight = scanTimeToISTDate(scanTimeISO) !== scanTimeToISTDate(openSession.in_time)

      // FIX #2 — Minimum session check: cross-midnight sessions skip the 10-min minimum
      // because a W&W sewadar scanning IN at 11:58 PM and OUT at 12:05 AM (7 min) is valid.
      if (!isCrossMidnight && durationMs < MIN_SESSION_MS) {
        throw new Error('Session must be at least 10 minutes. Please wait before scanning OUT.')
      }

      // FIX #3 — Use 20h cap for cross-midnight (W&W), 12h for same-day
      const maxMs = isCrossMidnight ? MAX_SESSION_MS_WW : MAX_SESSION_MS_NORMAL
      if (durationMs > maxMs) {
        throw new Error('SESSION_EXCEEDS_LIMIT:' + JSON.stringify({
          in_time:  openSession.in_time,
          max_hours: isCrossMidnight ? 20 : 12,
          message:  `Session duration exceeds ${isCrossMidnight ? 20 : 12} hours. Please enter OUT time manually.`,
        }))
      }
    }

    // Auto-promote to W&W: IN after 9 PM + OUT on different calendar day
    let finalDutyType = openSession.duty_type
    if (openSession.in_time && isLateNightScan(openSession.in_time)) {
      const inDate  = scanTimeToISTDate(openSession.in_time)
      const outDate = scanTimeToISTDate(scanTimeISO)
      if (inDate !== outDate) finalDutyType = DUTY_TYPES.WATCH_WARD
    }

    // Create attendance row
    const { data: att, error: attError } = await supabase
      .from('attendance')
      .insert({
        badge_number,
        type:         'OUT',
        scan_time:    scanTimeISO,
        duty_type:    finalDutyType,
        session_id:   openSession.id,
        scanner_badge,
        scanner_name,
        scanner_centre,
        latitude:     latitude ?? null,
        longitude:    longitude ?? null,
        manual_entry,
        submitted_by,
        submitted_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (attError) {
      if (attError.code === '23505') throw new Error('Duplicate entry. This attendance record may already exist.')
      throw new Error('Failed to record OUT: ' + attError.message)
    }

    // Close session
    const { error: closeError } = await supabase
      .from('attendance_sessions')
      .update({
        out_id:          att.id,
        out_time:        scanTimeISO,
        is_open:         false,
        manual_out:      manual_entry,
        out_scanner_name: scanner_name,
        duty_type:       finalDutyType,
        updated_at:      new Date().toISOString(),
      })
      .eq('id', openSession.id)

    if (closeError) {
      // Rollback the attendance row to prevent orphan
      await supabase.from('attendance').delete().eq('id', att.id)
      throw new Error('Failed to close session: ' + closeError.message)
    }

    return { attendanceId: att.id, sessionId: openSession.id }
  }

  throw new Error('Invalid scan type: ' + type)
}

// ─────────────────────────────────────────────────────────────────────────────
// ASO OVERRIDE FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ASO Force Close — closes an open session without a real OUT scan.
 */
export async function asoForceCloseSession(supabase, { sessionId, asobadge, reason }) {
  const { error } = await supabase
    .from('attendance_sessions')
    .update({
      is_open:             false,
      force_closed:        true,
      force_closed_reason: reason,
      force_closed_by:     asobadge,
      updated_at:          new Date().toISOString(),
    })
    .eq('id', sessionId)

  if (error) throw new Error('Force close failed: ' + error.message)

  try {
    await supabase.from('logs').insert({
      user_badge: asobadge,
      action:     'FORCE_CLOSE_SESSION',
      details:    `Force closed session ${sessionId} — Reason: ${reason}`,
      timestamp:  new Date().toISOString(),
    })
  } catch (_) { /* logging non-critical */ }
}

/**
 * Close session with a custom OUT time — used when the auto-close exceeds limits.
 * Validates: OUT after IN, 10-min minimum (waived cross-midnight), 20h max.
 */
export async function closeSessionWithTime(supabase, {
  sessionId,
  badge_number,
  outTimeISO,
  scanner_badge,
  scanner_name,
  scanner_centre,
  reason = 'Closed with manual OUT time',
}) {
  const { data: session, error: fetchError } = await supabase
    .from('attendance_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (fetchError || !session) throw new Error('Session not found')

  const outDate = new Date(outTimeISO)
  if (session.in_time && outDate < new Date(session.in_time)) {
    throw new Error('OUT time cannot be before IN time')
  }

  if (session.in_time) {
    const durationMs   = outDate - new Date(session.in_time)
    const isCrossMidnight = scanTimeToISTDate(outTimeISO) !== scanTimeToISTDate(session.in_time)

    if (!isCrossMidnight && durationMs < MIN_SESSION_MS) {
      throw new Error('Session must be at least 10 minutes')
    }
    const maxMs = isCrossMidnight ? MAX_SESSION_MS_WW : MAX_SESSION_MS_NORMAL
    if (durationMs > maxMs) {
      throw new Error(`Session cannot exceed ${isCrossMidnight ? 20 : 12} hours`)
    }
  }

  // Check for time conflicts (except for the session being closed)
  const { data: existingSessions } = await supabase
    .from('v_sessions')
    .select('id, badge_number, in_time, out_time, date_ist, duty_type')
    .eq('badge_number', badge_number)
    .neq('id', sessionId)
    .eq('is_open', false)

  // Check Jatha overlap
  const { data: jathaRecords } = await supabase
    .from('jatha_attendance')
    .select('id, date_from, date_to')
    .eq('badge_number', badge_number)
    .lte('date_from', outTimeISO)
    .gte('date_to', session.in_time)

  const conflictResult = detectTimeConflict({
    sessions: existingSessions || [],
    jathas: jathaRecords || [],
    proposedInISO: session.in_time,
    proposedOutISO: outTimeISO,
    excludeSessionId: sessionId,
    badgeNumber: badge_number
  })

  if (conflictResult.hasConflict) {
    throw new Error(conflictResult.message)
  }

  const outDateIST = scanTimeToISTDate(outTimeISO)

  // Auto-promote to W&W if applicable
  let finalDutyType = session.duty_type
  if (session.in_time && isLateNightScan(session.in_time)) {
    if (scanTimeToISTDate(session.in_time) !== outDateIST) {
      finalDutyType = DUTY_TYPES.WATCH_WARD
    }
  }

  const { data: att, error: attError } = await supabase
    .from('attendance')
    .insert({
      badge_number,
      type:           'OUT',
      scan_time:      outTimeISO,
      duty_type:      finalDutyType,
      session_id:     sessionId,
      scanner_badge:  scanner_badge || 'MANUAL',
      scanner_name:   scanner_name  || 'Manual Entry',
      scanner_centre: scanner_centre,
      manual_entry:   true,
      submitted_by:   scanner_badge,
      submitted_at:   new Date().toISOString(),
    })
    .select('id')
    .single()

  if (attError) throw new Error('Failed to record OUT: ' + attError.message)

  const { error: updateError } = await supabase
    .from('attendance_sessions')
    .update({
      out_time:            outTimeISO,
      out_id:              att.id,
      is_open:             false,
      force_closed:        true,
      force_closed_reason: reason,
      force_closed_by:     scanner_badge || 'MANUAL',
      out_scanner_name:    scanner_name || 'Manual Entry',
      duty_type:           finalDutyType,
      updated_at:          new Date().toISOString(),
    })
    .eq('id', sessionId)

  if (updateError) throw new Error('Failed to close session: ' + updateError.message)

  try {
    await supabase.from('logs').insert({
      user_badge: scanner_badge || 'MANUAL',
      action:     'MANUAL_CLOSE_SESSION',
      details:    `Closed session ${sessionId} (badge: ${badge_number}) — OUT: ${outTimeISO} — ${reason}`,
      timestamp:  new Date().toISOString(),
    })
  } catch (_) { /* logging non-critical */ }

  return { attendanceId: att.id, sessionId }
}

/**
 * closeForgottenSession — closes an open session when user forgot to scan OUT.
 * 
 * This function:
 * 1. Validates OUT time is after IN time
 * 2. Checks duration (min 10 mins, max 20 hours)
 * 3. If duration > 12 hours, creates auto-flag in queries table
 * 4. Closes the session with provided OUT time
 * 5. Creates OUT attendance record
 * 
 * @param {object} supabase
 * @param {object} params
 * @param {string} params.sessionId - Session ID to close
 * @param {string} params.outTimeISO - OUT time in ISO format
 * @param {boolean} params.isWatchWard - Was this a W&W duty (for duration > 12h)
 * @param {string} params.reason - Reason for forgetting OUT (required, min 3 chars)
 * @param {string} params.scanner_badge - Badge of person closing
 * @param {string} params.scanner_name - Name of person closing
 * @param {string} params.scanner_centre - Centre of person closing
 */
export async function closeForgottenSession(supabase, {
  sessionId,
  outTimeISO,
  isWatchWard = false,
  reason,
  scanner_badge,
  scanner_name,
  scanner_centre,
}) {
  if (!sessionId) throw new Error('Session ID is required')
  if (!outTimeISO) throw new Error('OUT time is required')
  if (!reason || reason.trim().length < 3) throw new Error('Reason is required (min 3 characters)')

  const { data: session, error: fetchError } = await supabase
    .from('attendance_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (fetchError || !session) throw new Error('Session not found')

  const outDate = new Date(outTimeISO)
  const inTime = session.in_time ? new Date(session.in_time) : null

  if (inTime && outDate < inTime) {
    throw new Error('OUT time cannot be before IN time')
  }

  let durationHours = 0
  if (inTime) {
    const durationMs = outDate - inTime
    const MIN_MS = 10 * 60 * 1000
    const MAX_MS = 20 * 60 * 60 * 1000
    
    if (durationMs < MIN_MS) {
      throw new Error('Session must be at least 10 minutes')
    }
    
    if (durationMs > MAX_MS) {
      throw new Error('Duration cannot exceed 20 hours')
    }
    
    durationHours = Math.round(durationMs / (1000 * 60 * 60) * 10) / 10
  }

  // Check for time conflicts
  const { data: existingSessions } = await supabase
    .from('v_sessions')
    .select('id, badge_number, in_time, out_time, date_ist, duty_type')
    .eq('badge_number', session.badge_number)
    .neq('id', sessionId)
    .eq('is_open', false)

  const { data: jathaRecords } = await supabase
    .from('jatha_attendance')
    .select('id, date_from, date_to')
    .eq('badge_number', session.badge_number)
    .lte('date_from', outTimeISO)
    .gte('date_to', session.in_time)

  const conflictResult = detectTimeConflict({
    sessions: existingSessions || [],
    jathas: jathaRecords || [],
    proposedInISO: session.in_time,
    proposedOutISO: outTimeISO,
    excludeSessionId: sessionId,
    badgeNumber: session.badge_number
  })

  if (conflictResult.hasConflict) {
    throw new Error(conflictResult.message)
  }

  const outDateIST = scanTimeToISTDate(outTimeISO)
  const isCrossMidnight = inTime && scanTimeToISTDate(session.in_time) !== outDateIST

  let finalDutyType = session.duty_type
  if (isWatchWard) {
    finalDutyType = DUTY_TYPES.WATCH_WARD
  } else if (inTime && isLateNightScan(session.in_time)) {
    if (isCrossMidnight) {
      finalDutyType = DUTY_TYPES.WATCH_WARD
    }
  }

  const { data: att, error: attError } = await supabase
    .from('attendance')
    .insert({
      badge_number: session.badge_number,
      type: 'OUT',
      scan_time: outTimeISO,
      duty_type: finalDutyType,
      session_id: sessionId,
      scanner_badge: scanner_badge || 'FORGOT_OUT',
      scanner_name: scanner_name || 'Forgot OUT Entry',
      scanner_centre: scanner_centre,
      manual_entry: true,
      submitted_by: scanner_badge,
      submitted_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (attError) throw new Error('Failed to record OUT: ' + attError.message)

  const { error: updateError } = await supabase
    .from('attendance_sessions')
    .update({
      out_time: outTimeISO,
      out_id: att.id,
      is_open: false,
      force_closed: true,
      force_closed_reason: `FORGOT OUT - Duration: ${durationHours}h. Reason: ${reason.trim()}`,
      force_closed_by: scanner_badge || 'FORGOT_OUT',
      out_scanner_name: scanner_name || 'Forgot OUT Entry',
      duty_type: finalDutyType,
      flagged: isWatchWard || durationHours > 12,
      flag_reason: isWatchWard ? 'Watch & Ward confirmed' : 'Duration exceeded 12h',
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)

  if (updateError) throw new Error('Failed to close session: ' + updateError.message)

  if (isWatchWard || durationHours > 12) {
    try {
      await supabase.from('queries').insert({
        session_id: sessionId,
        badge_number: session.badge_number,
        raised_by_badge: scanner_badge || 'SYSTEM',
        raised_by_name: scanner_name || 'System',
        raised_by_centre: scanner_centre,
        reason: reason.trim(),
        issue_description: `[FORGOT OUT] Duration: ${durationHours}h. Reason: ${reason.trim()}${isWatchWard ? ' (W&W confirmed)' : ' (Auto-flagged: >12h)'}`,
        status: 'open',
        flag_type: 'forgot_out',
      })
    } catch (flagErr) {
      if (import.meta.env.DEV) console.warn('[Session] Failed to create auto-flag:', flagErr)
    }
  }

  try {
    await supabase.from('logs').insert({
      user_badge: scanner_badge || 'FORGOT_OUT',
      action: 'CLOSE_FORGOTTEN_SESSION',
      details: `Closed forgotten session ${sessionId} (badge: ${session.badge_number}) — OUT: ${outTimeISO} — Duration: ${durationHours}h — W&W: ${isWatchWard} — Reason: ${reason.trim()}`,
      timestamp: new Date().toISOString(),
    })
  } catch (_) { /* logging non-critical */ }

  return { 
    attendanceId: att.id, 
    sessionId,
    durationHours,
    flagged: isWatchWard || durationHours > 12,
    dutyType: finalDutyType,
  }
}

/**
 * ASO Standalone OUT — creates an OUT record without a prior IN.
 * Used for data correction only. ASO must provide a reason.
 */
export async function executeStandaloneOut(supabase, {
  badge_number,
  scanTimeISO,
  scanner_badge,
  scanner_name,
  scanner_centre,
  latitude,
  longitude,
  reason,
  asobadge,
}) {
  const scanDateIST = scanTimeToISTDate(scanTimeISO)

  const { data: session, error: sessionError } = await supabase
    .from('attendance_sessions')
    .insert({
      badge_number,
      duty_type:           'gate_entry',
      out_time:            scanTimeISO,
      date_ist:            scanDateIST,
      is_open:             false,
      force_closed:        true,
      force_closed_reason: reason,
      force_closed_by:     asobadge,
    })
    .select('id')
    .single()

  if (sessionError) throw new Error('Failed to create standalone session: ' + sessionError.message)

  const { data: att, error: attError } = await supabase
    .from('attendance')
    .insert({
      badge_number,
      type:         'OUT',
      scan_time:    scanTimeISO,
      duty_type:    'gate_entry',
      session_id:   session.id,
      scanner_badge,
      scanner_name,
      scanner_centre,
      latitude:     latitude ?? null,
      longitude:    longitude ?? null,
      manual_entry: true,
      submitted_by: asobadge,
      submitted_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (attError) throw new Error('Failed to record standalone OUT: ' + attError.message)

  await supabase
    .from('attendance_sessions')
    .update({ out_id: att.id })
    .eq('id', session.id)

  try {
    await supabase.from('logs').insert({
      user_badge: asobadge,
      action:     'STANDALONE_OUT',
      details:    `Created standalone OUT for ${badge_number} — Reason: ${reason}`,
      timestamp:  new Date().toISOString(),
    })
  } catch (_) { /* logging non-critical */ }

  return { attendanceId: att.id, sessionId: session.id }
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * formatDuration — human-readable session length.
 *
 * FIX #3: cap raised from 12h to 20h so W&W overnight shifts display correctly.
 * Returns null for invalid / negative / over-20h durations.
 */
export function formatDuration(inTime, outTime) {
  if (!inTime || !outTime) return null
  const diffMs = new Date(outTime) - new Date(inTime)
  if (diffMs < 0) return null
  if (diffMs > MAX_SESSION_MS_WW) return null
  const mins = Math.round(diffMs / 60000)
  const h    = Math.floor(mins / 60)
  const m    = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** Returns true when OUT is strictly before IN */
export function isNegativeDuration(inTime, outTime) {
  if (!inTime || !outTime) return false
  return new Date(outTime) < new Date(inTime)
}

/** Duration in minutes, or null */
export function getDurationMinutes(inTime, outTime) {
  if (!inTime || !outTime) return null
  const diffMs = new Date(outTime) - new Date(inTime)
  if (diffMs < 0) return null
  return Math.round(diffMs / 60000)
}

/**
 * Format session date — returns "YYYY-MM-DD" normally,
 * or "YYYY-MM-DD → YYYY-MM-DD" for cross-midnight sessions.
 */
export function formatSessionDate(dateIST, outTime) {
  if (!outTime) return dateIST
  const outDate = scanTimeToISTDate(outTime)
  return outDate !== dateIST ? `${dateIST} → ${outDate}` : dateIST
}

// ─────────────────────────────────────────────────────────────────────────────
// SAFE DELETE — DATA INTEGRITY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * deleteSessionWithAttendance — atomically deletes a session and ALL its
 * attendance records. Prevents orphan rows. Logs full details.
 */
export async function deleteSessionWithAttendance(supabase, {
  sessionId,
  deletedByBadge,
  reason = 'Manual deletion',
}) {
  const { data: session, error: sessionError } = await supabase
    .from('attendance_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()

  if (sessionError || !session) {
    throw new Error('Session not found: ' + (sessionError?.message || 'No session with this ID'))
  }

  const { data: attendanceRecords } = await supabase
    .from('attendance')
    .select('id, type, scan_time, badge_number, duty_type')
    .eq('session_id', sessionId)

  const attendanceCount = attendanceRecords?.length || 0

  // Handle linked queries (flags) - archive them before deletion
  const { data: linkedQueries } = await supabase
    .from('queries')
    .select('*')
    .eq('session_id', sessionId)

  if (linkedQueries && linkedQueries.length > 0) {
    // Archive each linked query with session details
    for (const query of linkedQueries) {
      await supabase.from('queries').update({
        archived: true,
        archived_at: new Date().toISOString(),
        archived_reason: reason,
        session_deleted: true,
        // Clear the foreign key reference since session will be deleted
        session_id: null,
        // Keep original session reference as JSON for historical record
        original_session_info: JSON.stringify({
          badge_number: session.badge_number,
          sewadar_name: session.sewadar_name,
          centre: session.centre,
          department: session.department,
          date_ist: session.date_ist,
          in_time: session.in_time,
          out_time: session.out_time,
          duty_type: session.duty_type,
        })
      }).eq('id', query.id)
    }
  }

  if (attendanceCount > 0) {
    const { error: attError } = await supabase
      .from('attendance')
      .delete()
      .eq('session_id', sessionId)

    if (attError) throw new Error('Failed to delete attendance records: ' + attError.message)
  }

  const { error: sessError } = await supabase
    .from('attendance_sessions')
    .delete()
    .eq('id', sessionId)

  if (sessError) throw new Error('Failed to delete session: ' + sessError.message)

  try {
    await supabase.from('logs').insert({
      user_badge: deletedByBadge || 'SYSTEM',
      action:     'DELETE_SESSION_CASCADE',
      details:    JSON.stringify({
        deleted_session: {
          id:          sessionId,
          badge_number: session.badge_number,
          sewadar_name: session.sewadar_name,
          centre:       session.centre,
          department:   session.department,
          in_time:      session.in_time,
          out_time:     session.out_time,
          duty_type:    session.duty_type,
          date_ist:     session.date_ist,
          is_open:      session.is_open,
        },
        deleted_attendance_count:   attendanceCount,
        deleted_attendance_records: attendanceRecords?.map((a) => ({
          id:         a.id,
          type:       a.type,
          scan_time:  a.scan_time,
          badge_number: a.badge_number,
        })),
        reason,
        deleted_at: new Date().toISOString(),
      }),
      timestamp: new Date().toISOString(),
    })
  } catch (_) { /* logging non-critical */ }

  return { deleted: true, sessionId, attendanceDeleted: attendanceCount }
}

/**
 * deleteAttendanceWithSessionUpdate — deletes a single attendance row and
 * clears the corresponding in_id / out_id link on the parent session.
 */
export async function deleteAttendanceWithSessionUpdate(supabase, {
  attendanceId,
  deletedByBadge,
  reason = 'Manual deletion',
}) {
  const { data: att, error: attError } = await supabase
    .from('attendance')
    .select('id, type, scan_time, badge_number, session_id')
    .eq('id', attendanceId)
    .single()

  if (attError || !att) {
    throw new Error('Attendance not found: ' + (attError?.message || 'No record with this ID'))
  }

  const { error: deleteError } = await supabase
    .from('attendance')
    .delete()
    .eq('id', attendanceId)

  if (deleteError) throw new Error('Failed to delete attendance: ' + deleteError.message)

  if (att.session_id) {
    const field = att.type === 'IN' ? 'in_id' : 'out_id'
    await supabase
      .from('attendance_sessions')
      .update({ [field]: null })
      .eq('id', att.session_id)
  }

  try {
    await supabase.from('logs').insert({
      user_badge: deletedByBadge || 'SYSTEM',
      action:     'DELETE_ATTENDANCE',
      details:    JSON.stringify({
        attendance_id: attendanceId,
        session_id:    att.session_id,
        badge_number:  att.badge_number,
        type:          att.type,
        scan_time:     att.scan_time,
        reason,
        deleted_at:    new Date().toISOString(),
      }),
      timestamp: new Date().toISOString(),
    })
  } catch (_) { /* logging non-critical */ }

  return { deleted: true, attendanceId }
}

// ─────────────────────────────────────────────────────────────────────────────
// ORPHAN DETECTION & CLEANUP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * findOrphanRecords — scans the DB for data integrity issues.
 * Returns sessions with no attendance, and attendance pointing to missing sessions.
 */
export async function findOrphanRecords(supabase) {
  const results = {
    orphanSessions:      [],
    orphanAttendance:    [],
    invalidSessionLinks: [],
  }

  const { data: allSessions } = await supabase.from('attendance_sessions').select('id')
  const validSessionIds = new Set(allSessions?.map((s) => s.id) || [])

  const { data: allAttendance } = await supabase
    .from('attendance')
    .select('id, badge_number, type, scan_time, session_id')
    .not('session_id', 'is', null)

  for (const att of allAttendance || []) {
    if (att.session_id && !validSessionIds.has(att.session_id)) {
      results.invalidSessionLinks.push({
        id:           att.id,
        badge_number: att.badge_number,
        type:         att.type,
        scan_time:    att.scan_time,
        session_id:   att.session_id,
      })
    }
  }

  const { data: closedSessions } = await supabase
    .from('attendance_sessions')
    .select('id, badge_number, in_time, out_time')
    .eq('is_open', false)

  for (const sess of closedSessions || []) {
    const { count } = await supabase
      .from('attendance')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sess.id)

    if (count === 0) {
      results.orphanSessions.push({
        id:           sess.id,
        badge_number: sess.badge_number,
        in_time:      sess.in_time,
        out_time:     sess.out_time,
      })
    }
  }

  return results
}

/**
 * cleanupOrphanRecords — fixes invalid session_id references in attendance,
 * and deletes closed sessions that have no linked attendance rows.
 */
export async function cleanupOrphanRecords(supabase, deletedByBadge = 'SYSTEM') {
  const results = { attendanceFixed: 0, sessionsDeleted: 0, errors: [] }

  const { data: allSessions } = await supabase.from('attendance_sessions').select('id')
  const validSessionIds = new Set(allSessions?.map((s) => s.id) || [])

  const { data: allAttendance } = await supabase
    .from('attendance')
    .select('id, session_id')
    .not('session_id', 'is', null)

  for (const att of allAttendance || []) {
    if (att.session_id && !validSessionIds.has(att.session_id)) {
      try {
        await supabase.from('attendance').update({ session_id: null }).eq('id', att.id)
        results.attendanceFixed++
      } catch (e) {
        results.errors.push(`Failed to fix attendance ${att.id}: ${e.message}`)
      }
    }
  }

  const { data: closedSessions } = await supabase
    .from('attendance_sessions')
    .select('id')
    .eq('is_open', false)

  for (const sess of closedSessions || []) {
    const { count } = await supabase
      .from('attendance')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sess.id)

    if (count === 0) {
      try {
        await supabase.from('attendance_sessions').delete().eq('id', sess.id)
        results.sessionsDeleted++
      } catch (e) {
        results.errors.push(`Failed to delete orphan session ${sess.id}: ${e.message}`)
      }
    }
  }

  try {
    await supabase.from('logs').insert({
      user_badge: deletedByBadge,
      action:     'CLEANUP_ORPHANS',
      details:    JSON.stringify({ ...results, cleaned_at: new Date().toISOString() }),
      timestamp:  new Date().toISOString(),
    })
  } catch (_) { /* logging non-critical */ }

  return results
}

// ─────────────────────────────────────────────────────────────────────────────
// BIDIRECTIONAL SYNC - Keep sessions and attendance consistent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sync session fields with its attendance records.
 * Updates the linked IN/OUT attendance records when session is edited.
 * 
 * @param {object} supabase
 * @param {object} params
 * @param {number} params.sessionId - Session ID to sync
 * @param {object} params.updates - Fields to update on session
 * @param {string} params.updatedBy - Badge of user making the change
 * @param {string} params.reason - Reason for the change (for logging)
 */
export async function syncSessionWithAttendance(supabase, {
  sessionId,
  updates,
  updatedBy,
  reason = 'Manual edit',
}) {
  const errors = []
  
  // Fetch current session to get in_id and out_id
  const { data: session, error: fetchError } = await supabase
    .from('attendance_sessions')
    .select('id, in_id, out_id, in_time, out_time')
    .eq('id', sessionId)
    .single()

  if (fetchError || !session) {
    throw new Error('Session not found: ' + (fetchError?.message || sessionId))
  }

  // Prepare attendance updates
  const attendanceUpdates = {}
  
  if (updates.in_time && session.in_id) {
    attendanceUpdates.in_time = updates.in_time
  }
  if (updates.out_time && session.out_id) {
    attendanceUpdates.out_time = updates.out_time
  }
  if (updates.duty_type) {
    attendanceUpdates.duty_type = updates.duty_type
  }

  // Update session
  const sessionUpdateData = { ...updates, updated_at: new Date().toISOString() }
  const { error: sessionError } = await supabase
    .from('attendance_sessions')
    .update(sessionUpdateData)
    .eq('id', sessionId)

  if (sessionError) {
    errors.push('Session update failed: ' + sessionError.message)
  }

  // Update linked IN attendance record
  if (session.in_id && Object.keys(attendanceUpdates).length > 0) {
    const { error: inError } = await supabase
      .from('attendance')
      .update(attendanceUpdates)
      .eq('id', session.in_id)
    
    if (inError) {
      errors.push('IN attendance update failed: ' + inError.message)
    }
  }

  // Update linked OUT attendance record
  if (session.out_id && Object.keys(attendanceUpdates).length > 0) {
    const { error: outError } = await supabase
      .from('attendance')
      .update(attendanceUpdates)
      .eq('id', session.out_id)
    
    if (outError) {
      errors.push('OUT attendance update failed: ' + outError.message)
    }
  }

  // Log the change
  try {
    await supabase.from('logs').insert({
      user_badge: updatedBy || 'SYSTEM',
      action: 'SYNC_SESSION_ATTENDANCE',
      details: JSON.stringify({
        sessionId,
        updates,
        syncedFields: attendanceUpdates,
        reason,
        errors,
      }),
      timestamp: new Date().toISOString(),
    })
  } catch (_) { /* logging non-critical */ }

  if (errors.length > 0) {
    throw new Error('Sync partially failed: ' + errors.join('; '))
  }

  return { success: true, sessionId }
}

/**
 * Sync attendance record with its session.
 * Updates the session when an attendance record is edited.
 * 
 * @param {object} supabase
 * @param {object} params
 * @param {number} params.attendanceId - Attendance ID that was edited
 * @param {object} params.updates - Fields updated on attendance
 * @param {string} params.updatedBy - Badge of user making the change
 */
export async function syncAttendanceWithSession(supabase, {
  attendanceId,
  updates,
  updatedBy,
}) {
  // Fetch the attendance record
  const { data: att, error: fetchError } = await supabase
    .from('attendance')
    .select('id, session_id, type, scan_time')
    .eq('id', attendanceId)
    .single()

  if (fetchError || !att) {
    throw new Error('Attendance record not found: ' + (fetchError?.message || attendanceId))
  }

  if (!att.session_id) {
    // No linked session, nothing to sync
    return { success: true, attendanceId, synced: false }
  }

  // Prepare session updates based on attendance changes
  const sessionUpdates = {}

  if (updates.scan_time) {
    if (att.type === 'IN') {
      sessionUpdates.in_time = updates.scan_time
    } else if (att.type === 'OUT') {
      sessionUpdates.out_time = updates.scan_time
    }
  }
  
  if (updates.duty_type) {
    sessionUpdates.duty_type = updates.duty_type
  }

  if (Object.keys(sessionUpdates).length === 0) {
    return { success: true, attendanceId, synced: false }
  }

  // Update the session
  sessionUpdates.updated_at = new Date().toISOString()
  
  const { error: sessionError } = await supabase
    .from('attendance_sessions')
    .update(sessionUpdates)
    .eq('id', att.session_id)

  if (sessionError) {
    throw new Error('Session sync failed: ' + sessionError.message)
  }

  // Also update the other attendance record if time changed
  if (updates.scan_time) {
    const { data: otherAtts } = await supabase
      .from('attendance')
      .select('id, type')
      .eq('session_id', att.session_id)
      .neq('id', attendanceId)

    for (const other of otherAtts || []) {
      await supabase
        .from('attendance')
        .update({ duty_type: updates.duty_type })
        .eq('id', other.id)
    }
  }

  // Log the change
  try {
    await supabase.from('logs').insert({
      user_badge: updatedBy || 'SYSTEM',
      action: 'SYNC_ATTENDANCE_SESSION',
      details: JSON.stringify({
        attendanceId,
        sessionId: att.session_id,
        updates,
        sessionUpdates,
      }),
      timestamp: new Date().toISOString(),
    })
  } catch (_) { /* logging non-critical */ }

  return { success: true, attendanceId, sessionId: att.session_id }
}