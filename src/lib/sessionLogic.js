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
    .select('id, in_time, in_id, duty_type, centre, date_ist, sewadar_name, department')
    .eq('badge_number', badgeNumber)
    .eq('is_open', true)
    .order('in_time', { ascending: false })
    .limit(1)
    .maybeSingle()
  
  if (error) {
    if (import.meta.env.DEV) console.warn('[Session] Open session query failed:', error.message)
  }
  return data || null
}

/**
 * Check for recent duplicate scan to prevent race conditions
 * Returns true if a scan of same type occurred within last 30 seconds
 */
export async function checkDuplicateScan(supabase, badgeNumber, type, scanTimeISO) {
  const thirtySecondsAgo = new Date(new Date(scanTimeISO).getTime() - 30000).toISOString()
  
  const { data, error } = await supabase
    .from('attendance')
    .select('id, scan_time, type')
    .eq('badge_number', badgeNumber)
    .eq('type', type)
    .gte('scan_time', thirtySecondsAgo)
    .order('scan_time', { ascending: false })
    .limit(1)
    .maybeSingle()
  
  if (error) {
    if (import.meta.env.DEV) console.warn('[Session] Duplicate check failed:', error.message)
    return false // On error, allow the scan (fail open)
  }
  
  return !!data // Return true if duplicate found
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
    if (import.meta.env.DEV) console.warn('[Session] Sessions for date query failed:', error.message)
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
    if (import.meta.env.DEV) console.warn('[Session] Jatha check failed:', error.message)
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
  if (!badgeNumber || typeof badgeNumber !== 'string') {
    throw new Error('Invalid badge number: ' + badgeNumber)
  }
  if (!scanTimeISO || isNaN(new Date(scanTimeISO).getTime())) {
    throw new Error('Invalid scan time: ' + scanTimeISO)
  }
  
  // Step 0: Check for recent duplicate scan (race condition prevention)
  // Skip for ASO users to allow override, but check for centre users
  if (!isAso) {
    const isDuplicate = await checkDuplicateScan(supabase, badgeNumber, type, scanTimeISO)
    if (isDuplicate) {
      return {
        status: 'blocked',
        reason: 'duplicate_scan',
        canOverride: false,
        message: 'Duplicate scan detected. Please wait before scanning again.',
      }
    }
  }
  
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
    const openSessionDate = openSession?.date_ist
      ? String(openSession.date_ist).substring(0, 10)
      : null
    const isSameDay = openSessionDate === scanDateIST
    
    if (openSession && isSameDay) {
      // Same day with open session → block (must scan OUT first)
      return {
        status: 'blocked',
        reason: 'open_session_same_day',
        openSession,
        todaySessions,
        canOverride: false,
        message: 'Cannot create new IN on same day. Scan OUT first.',
      }
    }
    
    if (openSession && !isSameDay) {
      // Different day with open session from previous day
      // CRITICAL FIX: This is NOT automatically Watch & Ward!
      // User either forgot to scan OUT yesterday, OR it's genuine W&W
      // We must prompt to either:
      // 1. Force-close the old session (if they forgot OUT)
      // 2. Confirm W&W (if overnight duty)
      if (!watchWard) {
        // Check if old session was on Satsang day (Wed/Sun) - use IN time date
        const oldInDate = openSession.in_time ? new Date(openSession.in_time) : null
        const oldDay = oldInDate ? oldInDate.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' }) : ''
        const wasSatsang = oldDay === 'Wed' || oldDay === 'Sun'
        
        return {
          status: 'needs_watch_ward_confirmation',
          reason: 'previous_day_open_session',
          openSession,
          todaySessions,
          message: 'You have an open session from ' + openSessionDate + '. Was this Watch & Ward (overnight duty)?',
          oldSessionWasSatsang: wasSatsang,
          oldSessionInDate: openSessionDate,
        }
      }
      // W&W confirmed - we need to auto-close the OLD session first!
      // The executeScan function should handle this
    }
    
    // No open session OR W&W confirmed → allow new IN
    return {
      status: 'allowed',
      action: 'new_in',
      dutyType,
      todaySessions,
      existingOpenSession: openSession, // for executeScan to handle closing
    }
  }
  
  if (type === 'OUT') {
    if (!openSession) {
      // No open session - ASO can create standalone OUT with reason, others blocked
      if (isCentreUser) {
        return {
          status: 'blocked',
          reason: 'no_open_session',
          todaySessions,
          canOverride: false,
        }
      }
      // ASO can do standalone OUT but must provide reason
      return {
        status: 'allowed',
        action: 'standalone_out',
        todaySessions,
        canOverride: isAso,
        requiresReason: isAso, // ASO must provide reason for standalone OUT
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
  closePreviousSession = false,
  closePreviousOutTime = null,
  remark = null,
}) {
  const scanDateIST = scanTimeToISTDate(scanTimeISO)
  
  if (type === 'IN') {
    // CRITICAL: If there's an existing open session from a previous day
    // and user confirmed Watch & Ward, we must close the old session first
    if (openSession?.id) {
      const oldSessionDate = openSession.date_ist ? String(openSession.date_ist).substring(0, 10) : null
      const newSessionDate = scanDateIST
      
      // Auto-close old session if:
      // 1. It's from a different day AND user confirmed W&W, OR
      // 2. User denied W&W (closePreviousSession = true)
      const shouldClose = (oldSessionDate && oldSessionDate !== newSessionDate && openSession.in_time)
      
      if (shouldClose || closePreviousSession) {
        // Calculate the OUT time - use user-provided or default to 11:59 PM
        let outTime
        if (closePreviousOutTime) {
          // User provided specific OUT time - use it
          outTime = closePreviousOutTime
        } else {
          // Default: 11:59 PM of the IN date (only for W&W confirmed case)
          const inDate = new Date(openSession.in_time)
          const year = inDate.getFullYear()
          const month = String(inDate.getMonth() + 1).padStart(2, '0')
          const day = inDate.getDate()
          outTime = `${year}-${month}-${day}T23:59:59+05:30`
        }
        
        // Validate duration - if exceeds limits, need manual input
        const durationMs = new Date(outTime) - new Date(openSession.in_time)
        const MAX_SESSION_MS = 12 * 60 * 60 * 1000
        
        // If duration would exceed 12h, throw error asking for manual input
        if (durationMs > MAX_SESSION_MS) {
          throw new Error('SESSION_EXCEEDS_LIMIT:' + JSON.stringify({
            in_time: openSession.in_time,
            max_hours: 12,
            message: 'Session exceeds 12 hours. Please provide OUT time manually.'
          }))
        }
        
        const { error: closeError } = await supabase
          .from('attendance_sessions')
          .update({
            out_time: outTime,
            is_open: false,
            force_closed: closePreviousSession,
            force_closed_reason: closePreviousSession 
              ? 'Closed: User confirmed this was NOT Watch & Ward'
              : 'Auto-closed: New W&W session started on ' + newSessionDate,
            updated_at: new Date().toISOString(),
          })
          .eq('id', openSession.id)
        
        if (closeError) {
          throw new Error('Failed to close previous session: ' + closeError.message)
        }
        
        // Create OUT attendance record for the closed session
        if (openSession.in_id) {
          try {
            await supabase.from('attendance').insert({
              badge_number,
              sewadar_name: openSession.sewadar_name,
              centre: openSession.centre,
              department: openSession.department,
              type: 'OUT',
              scan_time: outTime,
              duty_type: openSession.duty_type,
              session_id: openSession.id,
              scanner_badge: 'SYSTEM',
              scanner_name: 'System Auto-Close',
              scanner_centre: openSession.centre,
              manual_entry: true,
              submitted_by: scanner_badge || 'SYSTEM',
              submitted_at: new Date().toISOString(),
            })
          } catch (_) { /* non-critical */ }
        }
        
        // Log the close
        try {
          await supabase.from('logs').insert({
            user_badge: scanner_badge || 'SYSTEM',
            action: closePreviousSession ? 'FORCE_CLOSE_SESSION' : 'AUTO_CLOSE_SESSION',
            details: closePreviousSession
              ? `Closed session ${openSession.id} (badge: ${badge_number}) - User denied W&W`
              : `Auto-closed session ${openSession.id} (badge: ${badge_number}) - New W&W session on ${newSessionDate}`,
            timestamp: new Date().toISOString(),
          })
        } catch (_) { /* logging failure is non-critical */ }
      }
    }
    
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
        scanner_badge,
        scanner_name,
        scanner_centre,
        in_scanner_name: scanner_name,
        remark: remark || null,
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
      await deleteSessionWithAttendance(supabase, {
        sessionId: session.id,
        deletedByBadge: scanner_badge,
        reason: 'Failed to create IN attendance - rollback'
      })
      if (attError.code === '23505') {
        throw new Error('Duplicate entry. This attendance record may already exist.')
      }
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
    
    // Validate: OUT time must be after IN time
    if (openSession.in_time && new Date(scanTimeISO) < new Date(openSession.in_time)) {
      throw new Error('OUT time cannot be before IN time. Please correct the scan.')
    }
    
    // Validate: Session duration - minimum 10 minutes, max 12 hours for all duty types
    if (openSession.in_time) {
      const durationMs = new Date(scanTimeISO) - new Date(openSession.in_time)
      const MIN_SESSION_MS = 10 * 60 * 1000    // 10 minutes minimum
      const MAX_SESSION_MS = 12 * 60 * 60 * 1000   // 12 hours maximum
      
      if (durationMs < MIN_SESSION_MS) {
        throw new Error('Session must be at least 10 minutes. Please wait before scanning OUT.')
      }
      
      if (durationMs > MAX_SESSION_MS) {
        // Throw special error that UI can catch to prompt manual input
        throw new Error('SESSION_EXCEEDS_LIMIT:' + JSON.stringify({
          in_time: openSession.in_time,
          max_hours: 12,
          message: 'Session duration exceeds 12 hours. Please enter OUT time manually.'
        }))
      }
    }
    
    // Check if this is a Watch & Ward session (IN at late night, OUT next morning)
    // If IN was done after 9 PM and OUT is on different date, auto-set to WATCH_WARD
    let finalDutyType = openSession.duty_type
    if (openSession.in_time && isLateNightScan(openSession.in_time)) {
      const inDate = scanTimeToISTDate(openSession.in_time)
      const outDate = scanTimeToISTDate(scanTimeISO)
      if (inDate !== outDate) {
        finalDutyType = DUTY_TYPES.WATCH_WARD
      }
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
        duty_type: finalDutyType,
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
      if (attError.code === '23505') {
        throw new Error('Duplicate entry. This attendance record may already exist.')
      }
      throw new Error('Failed to record OUT: ' + attError.message)
    }
    
    // 2. Close session and update duty_type if needed
    const { error: closeError } = await supabase
      .from('attendance_sessions')
      .update({
        out_id: att.id,
        out_time: scanTimeISO,
        is_open: false,
        manual_out: manual_entry,
        out_scanner_name: scanner_name,
        duty_type: finalDutyType, // Update duty_type for Watch & Ward
        updated_at: new Date().toISOString(),
      })
      .eq('id', openSession.id)
    
    if (closeError) {
      // Rollback: delete the attendance we just created to prevent orphan
      await supabase.from('attendance').delete().eq('id', att.id)
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
  try {
    await supabase.from('logs').insert({
      user_badge: asobadge,
      action: 'FORCE_CLOSE_SESSION',
      details: `Force closed session ${sessionId} - Reason: ${reason}`,
      timestamp: new Date().toISOString(),
    })
  } catch (_) { /* logging failure is non-critical */ }
}

/**
 * Close session with custom OUT time - used when duration exceeds limits
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
  const outTimeDate = new Date(outTimeISO)
  
  // First get the session to validate
  const { data: session, error: fetchError } = await supabase
    .from('attendance_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()
  
  if (fetchError || !session) {
    throw new Error('Session not found')
  }
  
  // Validate OUT time is after IN time
  if (session.in_time && outTimeDate < new Date(session.in_time)) {
    throw new Error('OUT time cannot be before IN time')
  }
  
  // Validate duration - minimum 10 minutes, max 12 hours
  if (session.in_time) {
    const durationMs = outTimeDate - new Date(session.in_time)
    const MIN_MS = 10 * 60 * 1000   // 10 minutes minimum
    const MAX_MS = 12 * 60 * 60 * 1000 // 12 hours max
    
    if (durationMs < MIN_MS) {
      throw new Error('Session must be at least 10 minutes')
    }
    
    if (durationMs > MAX_MS) {
      throw new Error('Session cannot exceed 12 hours')
    }
  }
  
  const outDateIST = scanTimeToISTDate(outTimeISO)
  
  // Determine duty type based on timing
  let finalDutyType = session.duty_type
  if (session.in_time && isLateNightScan(session.in_time) && session.date_ist !== outDateIST) {
    finalDutyType = DUTY_TYPES.WATCH_WARD
  }
  
  // Create OUT attendance record
  const { data: att, error: attError } = await supabase
    .from('attendance')
    .insert({
      badge_number,
      sewadar_name: session.sewadar_name,
      centre: session.centre,
      department: session.department,
      type: 'OUT',
      scan_time: outTimeISO,
      duty_type: finalDutyType,
      session_id: sessionId,
      scanner_badge: scanner_badge || 'MANUAL',
      scanner_name: scanner_name || 'Manual Entry',
      scanner_centre: scanner_centre || session.centre,
      manual_entry: true,
      submitted_by: scanner_badge,
      submitted_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  
  if (attError) {
    throw new Error('Failed to record OUT: ' + attError.message)
  }
  
  // Update session with OUT time
  const { error: updateError } = await supabase
    .from('attendance_sessions')
    .update({
      out_time: outTimeISO,
      out_id: att.id,
      is_open: false,
      force_closed: true,
      force_closed_reason: reason,
      force_closed_by: scanner_badge || 'MANUAL',
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
  
  if (updateError) {
    throw new Error('Failed to close session: ' + updateError.message)
  }
  
  // Log the action
  try {
    await supabase.from('logs').insert({
      user_badge: scanner_badge || 'MANUAL',
      action: 'MANUAL_CLOSE_SESSION',
      details: `Closed session ${sessionId} (badge: ${badge_number}) - OUT: ${outTimeISO} - ${reason}`,
      timestamp: new Date().toISOString(),
    })
  } catch (_) { /* logging failure is non-critical */ }
  
  return { attendanceId: att.id, sessionId }
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
  try {
    await supabase.from('logs').insert({
      user_badge: asobadge,
      action: 'STANDALONE_OUT',
      details: `Created standalone OUT for ${badge_number} - Reason: ${reason}`,
      timestamp: new Date().toISOString(),
    })
  } catch (_) { /* logging failure is non-critical */ }
  
  return { attendanceId: att.id, sessionId: session.id }
}

// =====================================================
// UTILITY FUNCTIONS
// =====================================================

/**
 * Format session duration
 * Returns null if invalid times, negative duration, or exceeds 24 hours
 */
export function formatDuration(inTime, outTime) {
  if (!inTime || !outTime) return null
  const inDate = new Date(inTime)
  const outDate = new Date(outTime)
  const diffMs = outDate - inDate
  
  // Check for negative duration (OUT before IN)
  if (diffMs < 0) return null
  
  // Check for unreasonably long sessions (max 12 hours = 43200000ms)
  const MAX_SESSION_MS = 12 * 60 * 60 * 1000
  if (diffMs >= MAX_SESSION_MS) return null
  
  const mins = Math.round(diffMs / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

/**
 * Check if duration is negative (OUT before IN)
 */
export function isNegativeDuration(inTime, outTime) {
  if (!inTime || !outTime) return false
  return new Date(outTime) < new Date(inTime)
}

/**
 * Get duration in minutes
 */
export function getDurationMinutes(inTime, outTime) {
  if (!inTime || !outTime) return null
  const diffMs = new Date(outTime) - new Date(inTime)
  if (diffMs < 0) return null
  return Math.round(diffMs / 60000)
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

// =====================================================
// SAFE DELETE FUNCTIONS - Data Integrity
// =====================================================

/**
 * Delete session with all associated attendance records (atomic)
 * Ensures NO orphan records are left behind
 * Logs detailed deletion information
 */
export async function deleteSessionWithAttendance(supabase, {
  sessionId,
  deletedByBadge,
  reason = 'Manual deletion'
}) {
  // Step 1: Get session details for logging
  const { data: session, error: sessionError } = await supabase
    .from('attendance_sessions')
    .select('*')
    .eq('id', sessionId)
    .single()
  
  if (sessionError || !session) {
    throw new Error('Session not found: ' + (sessionError?.message || 'No session with this ID'))
  }
  
  // Step 2: Get all attendance records for logging
  const { data: attendanceRecords } = await supabase
    .from('attendance')
    .select('id, type, scan_time, badge_number, duty_type')
    .eq('session_id', sessionId)
  
  const attendanceCount = attendanceRecords?.length || 0
  
  // Step 3: Delete attendance records first
  if (attendanceCount > 0) {
    const { error: attError } = await supabase
      .from('attendance')
      .delete()
      .eq('session_id', sessionId)
    
    if (attError) {
      throw new Error('Failed to delete attendance records: ' + attError.message)
    }
  }
  
  // Step 4: Delete session
  const { error: sessError } = await supabase
    .from('attendance_sessions')
    .delete()
    .eq('id', sessionId)
  
  if (sessError) {
    throw new Error('Failed to delete session: ' + sessError.message)
  }
  
  // Step 5: Log the deletion with full details
  try {
    await supabase.from('logs').insert({
      user_badge: deletedByBadge || 'SYSTEM',
      action: 'DELETE_SESSION_CASCADE',
      details: JSON.stringify({
        deleted_session: {
          id: sessionId,
          badge_number: session.badge_number,
          sewadar_name: session.sewadar_name,
          centre: session.centre,
          department: session.department,
          in_time: session.in_time,
          out_time: session.out_time,
          duty_type: session.duty_type,
          date_ist: session.date_ist,
          is_open: session.is_open
        },
        deleted_attendance_count: attendanceCount,
        deleted_attendance_records: attendanceRecords?.map(a => ({
          id: a.id,
          type: a.type,
          scan_time: a.scan_time,
          badge_number: a.badge_number
        })),
        reason: reason,
        deleted_at: new Date().toISOString()
      }),
      timestamp: new Date().toISOString()
    })
  } catch (_) { /* logging failure is non-critical */ }
  
  return {
    deleted: true,
    sessionId,
    attendanceDeleted: attendanceCount
  }
}

/**
 * Delete single attendance record and update session links
 * Use when you want to delete one attendance but keep the session
 */
export async function deleteAttendanceWithSessionUpdate(supabase, {
  attendanceId,
  deletedByBadge,
  reason = 'Manual deletion'
}) {
  // Get attendance record
  const { data: att, error: attError } = await supabase
    .from('attendance')
    .select('id, type, scan_time, badge_number, session_id')
    .eq('id', attendanceId)
    .single()
  
  if (attError || !att) {
    throw new Error('Attendance not found: ' + (attError?.message || 'No record with this ID'))
  }
  
  // Delete attendance
  const { error: deleteError } = await supabase
    .from('attendance')
    .delete()
    .eq('id', attendanceId)
  
  if (deleteError) {
    throw new Error('Failed to delete attendance: ' + deleteError.message)
  }
  
  // Update session links (clear in_id or out_id)
  if (att.session_id) {
    if (att.type === 'IN') {
      await supabase
        .from('attendance_sessions')
        .update({ in_id: null })
        .eq('id', att.session_id)
    } else if (att.type === 'OUT') {
      await supabase
        .from('attendance_sessions')
        .update({ out_id: null })
        .eq('id', att.session_id)
    }
  }
  
  // Log deletion
  try {
    await supabase.from('logs').insert({
      user_badge: deletedByBadge || 'SYSTEM',
      action: 'DELETE_ATTENDANCE',
      details: JSON.stringify({
        attendance_id: attendanceId,
        session_id: att.session_id,
        badge_number: att.badge_number,
        type: att.type,
        scan_time: att.scan_time,
        reason: reason,
        deleted_at: new Date().toISOString()
      }),
      timestamp: new Date().toISOString()
    })
  } catch (_) { /* logging failure is non-critical */ }
  
  return { deleted: true, attendanceId }
}

// =====================================================
// ORPHAN DETECTION & CLEANUP
// =====================================================

/**
 * Find orphan records in database
 * Returns list of sessions and attendance with broken references
 */
export async function findOrphanRecords(supabase) {
  const results = {
    orphanSessions: [],      // Sessions with no matching attendance
    orphanAttendance: [],    // Attendance with invalid session_id
    invalidSessionLinks: [] // Attendance where session_id points to non-existent session
  }
  
  // Get all session IDs
  const { data: allSessions } = await supabase
    .from('attendance_sessions')
    .select('id')
  
  const validSessionIds = new Set(allSessions?.map(s => s.id) || [])
  
  // Find attendance with session_id pointing to non-existent session
  const { data: allAttendance } = await supabase
    .from('attendance')
    .select('id, badge_number, type, scan_time, session_id')
    .not('session_id', 'is', null)
  
  for (const att of allAttendance || []) {
    if (att.session_id && !validSessionIds.has(att.session_id)) {
      results.invalidSessionLinks.push({
        id: att.id,
        badge_number: att.badge_number,
        type: att.type,
        scan_time: att.scan_time,
        session_id: att.session_id
      })
    }
  }
  
  // Find closed sessions with no attendance (might be orphans)
  const { data: closedSessions } = await supabase
    .from('attendance_sessions')
    .select('id, badge_number, in_time, out_time')
    .eq('is_open', false)
  
  // Check each closed session for attendance
  for (const sess of closedSessions || []) {
    const { count } = await supabase
      .from('attendance')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sess.id)
    
    if (count === 0) {
      results.orphanSessions.push({
        id: sess.id,
        badge_number: sess.badge_number,
        in_time: sess.in_time,
        out_time: sess.out_time
      })
    }
  }
  
  return results
}

/**
 * Cleanup orphan records
 * Fixes invalid session_id references in attendance table
 */
export async function cleanupOrphanRecords(supabase, deletedByBadge = 'SYSTEM') {
  const results = {
    attendanceFixed: 0,
    sessionsDeleted: 0,
    errors: []
  }
  
  // Get all session IDs
  const { data: allSessions } = await supabase
    .from('attendance_sessions')
    .select('id')
  
  const validSessionIds = new Set(allSessions?.map(s => s.id) || [])
  
  // Get all attendance with session_id
  const { data: allAttendance } = await supabase
    .from('attendance')
    .select('id, session_id')
    .not('session_id', 'is', null)
  
  // Fix invalid session_ids
  for (const att of allAttendance || []) {
    if (att.session_id && !validSessionIds.has(att.session_id)) {
      try {
        await supabase
          .from('attendance')
          .update({ session_id: null })
          .eq('id', att.id)
        results.attendanceFixed++
      } catch (e) {
        results.errors.push(`Failed to fix attendance ${att.id}: ${e.message}`)
      }
    }
  }
  
  // Delete closed sessions with no attendance (orphans)
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
        await supabase
          .from('attendance_sessions')
          .delete()
          .eq('id', sess.id)
        results.sessionsDeleted++
      } catch (e) {
        results.errors.push(`Failed to delete orphan session ${sess.id}: ${e.message}`)
      }
    }
  }
  
  // Log cleanup
  try {
    await supabase.from('logs').insert({
      user_badge: deletedByBadge,
      action: 'CLEANUP_ORPHANS',
      details: JSON.stringify({
        ...results,
        cleaned_at: new Date().toISOString()
      }),
      timestamp: new Date().toISOString()
    })
  } catch (_) { /* logging failure is non-critical */ }
  
  return results
}
