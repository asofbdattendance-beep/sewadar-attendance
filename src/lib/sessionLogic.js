/**
 * sessionLogic.js
 * 
 * The unified session engine for the Sewadar Attendance System.
 * All attendance decisions go through these functions.
 * 
 * Hard Rules:
 * - No IN without OUT (one open session at a time)
 * - No OUT without IN
 * - Jatha active = hard block
 * - ASO can override with reason and logging
 * - Centre users = hard block only (no override)
 */

import { scanTimeToISTDate } from './dateUtils'
import { DUTY_TYPES, DUTY_TYPE_LABEL } from './supabase'

export { DUTY_TYPES, DUTY_TYPE_LABEL }

// =====================================================
// DUTY TYPE COMPUTATION
// =====================================================

/**
 * Compute duty type based on scan time and watch ward flag
 * Wed/Sun = satsang, everything else = gate_entry
 * watch_ward overrides if user confirmed
 */
export function computeDutyType(scanTimeISO, watchWardConfirmed = false) {
  if (watchWardConfirmed) return DUTY_TYPES.WATCH_WARD
  
  const day = new Date(scanTimeISO).toLocaleDateString('en-IN', {
    weekday: 'short',
    timeZone: 'Asia/Kolkata',
  })
  
  return (day === 'Wed' || day === 'Sun')
    ? DUTY_TYPES.SATSANG
    : DUTY_TYPES.GATE_ENTRY
}

/**
 * Check if scan time is 9 PM or later (for Watch & Ward detection)
 */
export function isLateNightScan(scanTimeISO) {
  const hourStr = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    hour12: false,
  }).format(new Date(scanTimeISO))
  return parseInt(hourStr, 10) >= 21
}

// =====================================================
// SESSION QUERIES
// =====================================================

/**
 * Get open session for a badge (O(1) indexed query)
 * Returns null if no open session
 */
export async function getOpenSession(supabase, badgeNumber) {
  const { data, error } = await supabase
    .from('attendance_sessions')
    .select('id, in_time, in_id, duty_type, centre, date_ist, sewadar_name')
    .eq('badge_number', badgeNumber)
    .eq('is_open', true)
    .limit(1)
    .maybeSingle()
  
  if (error) {
    console.warn('[Session] Open session query failed:', error.message)
  }
  return data || null
}

/**
 * Get all sessions for a badge on a specific date
 */
export async function getSessionsForDate(supabase, badgeNumber, dateIST) {
  const { data, error } = await supabase
    .from('attendance_sessions')
    .select('id, duty_type, in_time, out_time, is_open, force_closed, manual_in, manual_out')
    .eq('badge_number', badgeNumber)
    .eq('date_ist', dateIST)
    .order('in_time', { ascending: true })
  
  if (error) {
    console.warn('[Session] Sessions for date query failed:', error.message)
  }
  return data || []
}

/**
 * Get active jatha for a badge on a specific date
 * Returns null if no jatha active
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
  
  if (error) {
    console.warn('[Session] Jatha check failed:', error.message)
  }
  return data || null
}

// =====================================================
// CORE EVALUATION
// =====================================================

/**
 * evaluateScan - the single decision function
 * 
 * Call before any scan to determine if allowed
 * 
 * @param {object} supabase - Supabase client
 * @param {object} params
 * @param {string} params.badgeNumber - Badge number
 * @param {string} params.type - 'IN' or 'OUT'
 * @param {string} params.scanTimeISO - ISO timestamp
 * @param {boolean} params.watchWard - User confirmed Watch & Ward
 * @param {boolean} params.isAso - Is user ASO?
 * @param {boolean} params.isCentreUser - Is user Centre?
 * 
 * @returns {object} Result with status, action, reason, etc.
 */
export async function evaluateScan(supabase, {
  badgeNumber,
  type,
  scanTimeISO,
  watchWard = false,
  isAso = false,
  isCentreUser = false,
}) {
  const scanDateIST = scanTimeToISTDate(scanTimeISO)
  
  // Step 1: Check for active jatha (hard block for all)
  const jatha = await getActiveJatha(supabase, badgeNumber, scanDateIST)
  if (jatha) {
    return {
      status: 'blocked',
      reason: 'jatha_active',
      jatha,
      canOverride: false, // No override for jatha
    }
  }
  
  // Step 2: Get open session
  const openSession = await getOpenSession(supabase, badgeNumber)
  
  // Step 3: Get today's sessions for display
  const todaySessions = await getSessionsForDate(supabase, badgeNumber, scanDateIST)
  
  // Step 4: Compute duty type
  const dutyType = computeDutyType(scanTimeISO, watchWard)
  
  // Step 5: Apply ladder logic
  if (type === 'IN') {
    if (openSession) {
      // Centre users: hard block
      if (isCentreUser) {
        return {
          status: 'blocked',
          reason: 'open_session_exists',
          openSession,
          todaySessions,
          canOverride: false,
        }
      }
      // ASO: can override with reason
      return {
        status: 'blocked',
        reason: 'open_session_exists',
        openSession,
        todaySessions,
        canOverride: isAso,
        overrideType: 'force_close_and_new_in',
      }
    }
    
    return {
      status: 'allowed',
      action: 'new_in',
      dutyType,
      todaySessions,
    }
  }
  
  if (type === 'OUT') {
    if (!openSession) {
      // Centre users: hard block
      if (isCentreUser) {
        return {
          status: 'blocked',
          reason: 'no_open_session',
          todaySessions,
          canOverride: false,
        }
      }
      // ASO: can create standalone OUT
      return {
        status: 'blocked',
        reason: 'no_open_session',
        todaySessions,
        canOverride: isAso,
        overrideType: 'standalone_out',
      }
    }
    
    return {
      status: 'allowed',
      action: 'close_session',
      dutyType: openSession.duty_type,
      openSession,
      todaySessions,
    }
  }
  
  return { status: 'blocked', reason: 'unknown_type', canOverride: false }
}

// =====================================================
// EXECUTE SCAN
// =====================================================

/**
 * executeScan - write scan to database
 * 
 * Only call after evaluateScan returns status='allowed'
 * or when ASO is overriding
 * 
 * @param {object} supabase
 * @param {object} params
 * @returns {object} { attendanceId, sessionId }
 */
export async function executeScan(supabase, {
  badge_number,
  sewadar_name,
  centre,
  department,
  type,
  scanTimeISO,
  dutyType,
  openSession = null,
  scanner_badge,
  scanner_name,
  scanner_centre,
  latitude,
  longitude,
  manual_entry = false,
  submitted_by,
}) {
  const scanDateIST = scanTimeToISTDate(scanTimeISO)
  
  if (type === 'IN') {
    // 1. Create session row
    const { data: session, error: sessionError } = await supabase
      .from('attendance_sessions')
      .insert({
        badge_number,
        sewadar_name,
        centre,
        department,
        duty_type: dutyType,
        in_time: scanTimeISO,
        date_ist: scanDateIST,
        is_open: true,
        manual_in: manual_entry,
      })
      .select('id')
      .single()
    
    if (sessionError) {
      throw new Error('Failed to create session: ' + sessionError.message)
    }
    
    // 2. Create attendance row
    const { data: att, error: attError } = await supabase
      .from('attendance')
      .insert({
        badge_number,
        sewadar_name,
        centre,
        department,
        type: 'IN',
        scan_time: scanTimeISO,
        duty_type: dutyType,
        session_id: session.id,
        scanner_badge,
        scanner_name,
        scanner_centre,
        latitude,
        longitude,
        manual_entry,
        submitted_by,
        submitted_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    
    if (attError) {
      await supabase.from('attendance_sessions').delete().eq('id', session.id)
      throw new Error('Failed to record IN: ' + attError.message)
    }
    
    // 3. Back-fill in_id on session
    await supabase
      .from('attendance_sessions')
      .update({ in_id: att.id })
      .eq('id', session.id)
    
    return { attendanceId: att.id, sessionId: session.id }
  }
  
  if (type === 'OUT') {
    if (!openSession?.id) {
      throw new Error('executeScan OUT called with no openSession')
    }
    
    // 1. Create attendance row
    const { data: att, error: attError } = await supabase
      .from('attendance')
      .insert({
        badge_number,
        sewadar_name,
        centre,
        department,
        type: 'OUT',
        scan_time: scanTimeISO,
        duty_type: openSession.duty_type,
        session_id: openSession.id,
        scanner_badge,
        scanner_name,
        scanner_centre,
        latitude,
        longitude,
        manual_entry,
        submitted_by,
        submitted_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    
    if (attError) {
      throw new Error('Failed to record OUT: ' + attError.message)
    }
    
    // 2. Close session
    const { error: closeError } = await supabase
      .from('attendance_sessions')
      .update({
        out_id: att.id,
        out_time: scanTimeISO,
        is_open: false,
        manual_out: manual_entry,
        updated_at: new Date().toISOString(),
      })
      .eq('id', openSession.id)
    
    if (closeError) {
      throw new Error('Failed to close session: ' + closeError.message)
    }
    
    return { attendanceId: att.id, sessionId: openSession.id }
  }
  
  throw new Error('Invalid scan type')
}

// =====================================================
// ASO OVERRIDE FUNCTIONS
// =====================================================

/**
 * ASO Force Close - closes an open session without real OUT
 * Used when ASO is overriding an IN while session is open
 */
export async function asoForceCloseSession(supabase, {
  sessionId,
  asobadge,
  reason,
}) {
  const { error } = await supabase
    .from('attendance_sessions')
    .update({
      is_open: false,
      force_closed: true,
      force_closed_reason: reason,
      force_closed_by: asobadge,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
  
  if (error) {
    throw new Error('Force close failed: ' + error.message)
  }
  
  // Log the override
  await supabase.from('logs').insert({
    user_badge: asobadge,
    action: 'FORCE_CLOSE_SESSION',
    details: `Force closed session ${sessionId} - Reason: ${reason}`,
    timestamp: new Date().toISOString(),
  }).catch(console.warn)
}

/**
 * ASO Standalone OUT - creates OUT without prior IN
 * Used when correcting data errors
 */
export async function executeStandaloneOut(supabase, {
  badge_number,
  sewadar_name,
  centre,
  department,
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
  
  // Create session with only OUT (no IN)
  const { data: session, error: sessionError } = await supabase
    .from('attendance_sessions')
    .insert({
      badge_number,
      sewadar_name,
      centre,
      department,
      duty_type: 'gate_entry', // Default for standalone
      out_time: scanTimeISO,
      date_ist: scanDateIST,
      is_open: false,
      force_closed: true,
      force_closed_reason: reason,
      force_closed_by: asobadge,
    })
    .select('id')
    .single()
  
  if (sessionError) {
    throw new Error('Failed to create standalone session: ' + sessionError.message)
  }
  
  // Create attendance row
  const { data: att, error: attError } = await supabase
    .from('attendance')
    .insert({
      badge_number,
      sewadar_name,
      centre,
      department,
      type: 'OUT',
      scan_time: scanTimeISO,
      duty_type: 'gate_entry',
      session_id: session.id,
      scanner_badge,
      scanner_name,
      scanner_centre,
      latitude,
      longitude,
      manual_entry: true,
      submitted_by: asobadge,
      submitted_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  
  if (attError) {
    throw new Error('Failed to record standalone OUT: ' + attError.message)
  }
  
  // Update session with out_id
  await supabase
    .from('attendance_sessions')
    .update({ out_id: att.id })
    .eq('id', session.id)
  
  // Log the action
  await supabase.from('logs').insert({
    user_badge: asobadge,
    action: 'STANDALONE_OUT',
    details: `Created standalone OUT for ${badge_number} - Reason: ${reason}`,
    timestamp: new Date().toISOString(),
  }).catch(console.warn)
  
  return { attendanceId: att.id, sessionId: session.id }
}

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

/**
 * Format session duration
 */
export function formatDuration(inTime, outTime) {
  if (!inTime || !outTime) return null
  const mins = Math.round((new Date(outTime) - new Date(inTime)) / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/**
 * Format session date display (handles cross-midnight)
 */
export function formatSessionDate(dateIST, outTime) {
  if (!outTime) return dateIST
  const outDate = scanTimeToISTDate(outTime)
  if (outDate !== dateIST) {
    return `${dateIST} → ${outDate}`
  }
  return dateIST
}
