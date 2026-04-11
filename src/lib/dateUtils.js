// ─── dateUtils.js ────────────────────────────────────────────────────────────
// All time helpers for the Sewadar Attendance System.
// ALL display times are in IST (Asia/Kolkata) 12-hour format.
// ALL datetime-local inputs use isoToISTInput() / istInputToISO() for
// correct IST ↔ UTC conversion — never rely on the browser's local timezone.
// ─────────────────────────────────────────────────────────────────────────────

const TZ = 'Asia/Kolkata'

// ─── Date string helpers ──────────────────────────────────────────────────────

/** Returns today's date as YYYY-MM-DD in IST */
export function todayDateStr() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** Converts any ISO string → YYYY-MM-DD in IST */
export function scanTimeToISTDate(isoString) {
  if (!isoString) return null
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(isoString))
}

/** Human-readable date — "03 Jan '25" */
export function formatDateStr(dateStr) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T12:00:00+05:30').toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    timeZone: TZ,
  })
}

// ─── Time display helpers (IST, 12-hour) ─────────────────────────────────────

/**
 * Format ISO string → IST 12-hour time, e.g. "9:05 am"
 * Used for scan_time, in_time, out_time in all tables, cards, popups.
 */
export function formatTimeIST(isoString) {
  if (!isoString) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(isoString))
}

/**
 * Format ISO string → "03 Jan, 9:05 am" (date + 12-hour time, IST)
 * Used in audit logs, modals, confirmation screens.
 */
export function formatDateTimeIST(isoString) {
  if (!isoString) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(isoString))
}

/**
 * Format ISO string → full "Wed, 03 Jan '25, 9:05 am" (IST)
 * Used in detailed session headers.
 */
export function formatFullDateTimeIST(isoString) {
  if (!isoString) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: TZ,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(isoString))
}

// ─── datetime-local input helpers ────────────────────────────────────────────

/**
 * Convert ISO string → value for a <input type="datetime-local"> pre-filled in IST.
 * datetime-local has NO timezone — we always pre-fill it with IST so the user
 * sees the correct local time, never UTC.
 *
 * Example: "2025-01-03T03:35:00.000Z" → "2025-01-03T09:05"
 */
export function isoToISTInput(isoString) {
  if (!isoString) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(isoString))
  const get = (type) => parts.find((p) => p.type === type)?.value || '00'
  const hour = get('hour') === '24' ? '00' : get('hour') // midnight edge case
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`
}

/**
 * Convert <input type="datetime-local"> value → IST-anchored ISO string.
 * The browser emits "2025-01-03T09:05" with no timezone info.
 * We treat it as IST ("+05:30") and convert to UTC ISO.
 *
 * Example: "2025-01-03T09:05" → "2025-01-03T03:35:00.000Z"
 */
export function istInputToISO(localValue) {
  if (!localValue) return null
  // Appending +05:30 makes Date() parse it as IST correctly
  const d = new Date(localValue + ':00+05:30')
  if (isNaN(d.getTime())) return null
  return d.toISOString()
}

/**
 * Convert a date string "YYYY-MM-DD" + time string "HH:MM" → IST-anchored ISO.
 * Used when date and time inputs are separate fields.
 */
export function dateTimeToISO(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null
  return istInputToISO(`${dateStr}T${timeStr}`)
}

// ─── Current IST timestamp ────────────────────────────────────────────────────

/**
 * Returns current time as an IST-anchored ISO string e.g. "2025-01-03T09:05:33+05:30"
 * Use this as the canonical "now" for all scan timestamps.
 */
export function nowIST() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const get = (type) => (parts.find((p) => p.type === type) || { value: '00' }).value
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}:${get('second')}+05:30`
}

// ─── Duration helpers ─────────────────────────────────────────────────────────

/**
 * Human-readable duration between two ISO strings.
 * Returns null for null inputs, negative durations, or sessions over 20 hours.
 * W&W duty can run 10–16 hrs overnight — the old 12h cap was too tight.
 */
export function formatDuration(inTime, outTime) {
  if (!inTime || !outTime) return null
  const diffMs = new Date(outTime) - new Date(inTime)
  if (diffMs < 0) return null
  const MAX_MS = 20 * 60 * 60 * 1000 // 20 hours — covers longest W&W shifts
  if (diffMs > MAX_MS) return null
  const mins = Math.round(diffMs / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** Duration in minutes, or null for invalid inputs */
export function getDurationMinutes(inTime, outTime) {
  if (!inTime || !outTime) return null
  const diffMs = new Date(outTime) - new Date(inTime)
  if (diffMs < 0) return null
  return Math.round(diffMs / 60000)
}