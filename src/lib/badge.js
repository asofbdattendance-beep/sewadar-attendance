/**
 * badge.js — badge validation + scanned-badge sanitisation ported from
 * sewadar-deployment-portal (src/lib/logic.js badge section).
 *
 * DOMAIN RECONCILIATION (attendance): the portal BADGE_REGEX accepts
 * `FB…GA/LA` + `VS…` but drops this repo's `BH…` branch — a verbatim port
 * would stop BH badges scanning. This module keeps the attendance domain
 * (`FB…GA/LA` + `BH…`) and drops the `VS…` branch (no VSS sewadars exist in
 * this repo; a VS-prefixed read is rejected rather than looked up).
 */
import { sanitizeBarcode } from './scannerUtils'

// VSS-shaped reads are prefixed with "VS". This repo has no VSS sewadars, so
// such reads are treated as noise (see sanitizeScannedBadge) rather than
// as valid badges.
export function isVssBadge(badge) {
  return typeof badge === 'string' && /^VS/i.test(badge)
}

export const BADGE_REGEX = /^(FB(597[1-9]|59[89]\d|600\d|601[01])(GA|LA)\d{4}|BH\d{4}[A-Z]{1,2}\d{4})$/
export function isValidBadgeFormat(badge) {
  return typeof badge === 'string' && BADGE_REGEX.test(badge.trim())
}
export function isFaridabadBadge(badge) {
  return isValidBadgeFormat(badge)
}

/* ─── Scanned-badge sanitisation ───
   Barcode decoders hand back exactly the bytes they saw: Code 39 start/stop
   guards, stray spaces, lower case, and — the expensive kind of noise —
   character confusions (O↔0, I/l↔1, S↔5, B↔8, Z↔2) that turn a real badge
   into a string the validator rejects. `sanitizeBarcode` (scannerUtils.js)
   already fixes the mechanical noise; this function adds the badge-specific
   recovery on top, deriving every position requirement from the SAME
   BADGE_REGEX the validator enforces so a repaired value can never drift
   from what the database will accept. */

// Decoder confusions observed in badge-like alphanumeric codes. Correction is
// POSITIONAL, never global: letters are load-bearing in these badges (the
// "FB" prefix, the "GA"/"LA" middle, the "BH" prefix), so a blind S→5 or B→8
// would retype a valid badge as a DIFFERENT sewadar's badge — a wrong-but-valid
// scan is worse than a rejected one.
const BADGE_LETTER_TO_DIGIT = { O: '0', I: '1', L: '1', S: '5', B: '8', Z: '2' }
const BADGE_DIGIT_TO_LETTER = { 0: 'O', 1: 'I', 5: 'S', 8: 'B', 2: 'Z' }

// Per-position character-class requirements derived from BADGE_REGEX, keyed
// by LENGTH: 'D' = digit required, 'L' = letter required. The 12-char shapes
// (FB + 4 digits + GA/LA + 4 digits, and BH + 4 digits + 2 letters + 4 digits)
// share the same L L D D D D L L D D D D skeleton. Returns null for shapes we
// cannot derive positions from: VS-prefixed reads (nothing to repair — this
// repo has no VSS badges), 11-char BH reads, and any other length is not a
// noisy read of a known badge, so we must not guess.
function badgePositionClasses(value) {
  if (isVssBadge(value)) return null
  if (value.length === 12) {
    return ['L', 'L', 'D', 'D', 'D', 'D', 'L', 'L', 'D', 'D', 'D', 'D']
  }
  return null
}

// Repair positional confusions. A repair is accepted ONLY when the repaired
// string matches BADGE_REGEX — otherwise the original is returned untouched,
// so a failed repair can never retype a scan as a different sewadar. Fewer
// fixes are preferred over more (a value needing many fixes is more likely a
// genuinely different badge than a noisy read of this one).
function repairBadgeConfusions(value) {
  const classes = badgePositionClasses(value)
  if (!classes) return value
  // Positions whose character violates the required class AND is a known
  // confusion of the required class. Anything else is left alone — we do not
  // invent corrections the decoder-confusion model does not explain.
  const fixable = []
  for (let i = 0; i < value.length; i += 1) {
    const req = classes[i]
    const ch = value[i]
    if (req === 'D' && !/[0-9]/.test(ch) && BADGE_LETTER_TO_DIGIT[ch]) fixable.push(i)
    else if (req === 'L' && !/[A-Z]/.test(ch) && BADGE_DIGIT_TO_LETTER[ch]) fixable.push(i)
  }
  if (!fixable.length) return value
  // Try subsets of increasing size (1 fix, then 2, then 3) and accept the
  // first candidate that fully matches BADGE_REGEX. Capped at 3 fixes.
  const MAX_FIXES = 3
  for (let size = 1; size <= Math.min(MAX_FIXES, fixable.length); size += 1) {
    const combos = []
    const walk = (start, chosen) => {
      if (chosen.length === size) { combos.push(chosen); return }
      for (let i = start; i < fixable.length; i += 1) walk(i + 1, [...chosen, fixable[i]])
    }
    walk(0, [])
    for (const positions of combos) {
      const chars = value.split('')
      for (const pos of positions) {
        const req = classes[pos]
        chars[pos] = req === 'D' ? BADGE_LETTER_TO_DIGIT[value[pos]] : BADGE_DIGIT_TO_LETTER[value[pos]]
      }
      const candidate = chars.join('')
      if (BADGE_REGEX.test(candidate)) return candidate
    }
  }
  return value
}

/**
 * Recover a real badge from a noisy barcode decode, or return '' when the
 * input is not a string / is empty. Pure and total: never throws, and
 * idempotent — sanitising an already-sanitised value is a no-op.
 *
 * Pipeline (each step runs only if the previous one did not settle):
 *   1. Mechanical normalisation via `sanitizeBarcode` (trim, collapse
 *      whitespace, strip characters that can never appear in a badge, uppercase).
 *   2. A clean badge passes through untouched.
 *   3. A leading "VS" is NEVER stripped in this repo: there are no VSS
 *      sewadars, so a VS-prefixed read cannot be a real badge — stripping it
 *      would risk scanning the wrong sewadar. Such reads fall through to the
 *      confusion repair, which returns them unchanged (no position map for
 *      VS shapes), and the caller rejects them via BADGE_REGEX.
 *   4. Positional confusion repair (see repairBadgeConfusions).
 *
 * @param {string|null|undefined|number} raw
 * @returns {string} the recovered badge, or '' when nothing can be recovered
 */
export function sanitizeScannedBadge(raw) {
  if (typeof raw !== 'string') return ''
  const value = sanitizeBarcode(raw)
  if (!value) return ''
  // Clean badge — nothing to recover.
  if (isValidBadgeFormat(value) && !isVssBadge(value)) return value
  // No VS-strip in this repo (no VSS badges): a VS-prefixed read is noise.
  if (isValidBadgeFormat(value)) return value
  return repairBadgeConfusions(value)
}
