/**
 * validate-sewadars.mjs
 *
 * Reconciliation script: Excel sheet (sewadars)  vs  Supabase `sewadars` table.
 * - Reads ONLY the columns in the sheet that map to DB fields (extra cols ignored).
 * - Outputs a report Excel file with sheets:
 *     - "In database"          : sheet rows that exist in DB (matched by badge_number)
 *     - "Not in database"      : sheet rows that are NEW (badge not in DB)
 *     - "In DB not in sheet"   : DB sewadars missing from the sheet (with transfer status)
 *     - "In DB but filtered"   : DB sewadars present in sheet but excluded by filters
 *     - "Changed fields"       : matching sewadars whose info differs (before -> after)
 *     - "Transfers"            : badge re-issued cases (old badge -> new badge)
 *
 * - Transfer detection: DB records absent from the sheet are matched against the
 *   sheet by exact name; ties are resolved by scoring other details (centre,
 *   department, gender, age, initiated, father/husband name). Unresolved ties
 *   are reported as AMBIGUOUS and left out of the SQL.
 *
 * - Keep-list: badges listed in validation/keep-badges.txt (one per line) are
 *   never deleted or merged — they are reported as KEPT and left untouched.
 *
 * - Also writes a sibling `.sql` file (never runs it) with:
 *     - INSERT for sheet rows not in DB (newly added)
 *     - UPDATE for changed fields (sheet value wins)
 *     - TRANSFER: badge_number old -> new on sewadars + attendance_sessions + jatha_attendance
 *     - DELETE for sheet rows whose Form_Status is "Draft"
 *     - DELETE for DB sewadars missing from the sheet entirely (no name match)
 *   Review the SQL before running it in the Supabase SQL editor.
 *
 * Usage:
 *   node validate-sewadars.mjs <path/to/sewadars.xlsx> [--out report.xlsx]
 *
 * Env/`.env` (loaded automatically):
 *   VITE_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...   (service role key, bypasses RLS so ALL rows are read)
 *
 * Example report path: validation-report.xlsx
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// 1. Env loading (Simple .env parser — no dotenv dependency)
// ---------------------------------------------------------------------------
function loadEnv(envPath = '.env') {
  if (!fs.existsSync(envPath)) return
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}
loadEnv()         // repo-root .env (if any)
loadEnv(path.join(__dirname, '.env')) // this script's folder .env (takes priority - does not override already-set)

// ---------------------------------------------------------------------------
// 2. DB fields and which sheet column names map to them (case-insensitive)
//    Only these columns are considered; every other sheet column is ignored.
// ---------------------------------------------------------------------------
const DB_FIELDS = [
  { key: 'badge_number', label: 'Badge Number', aliases: ['badge_number', 'badge number', 'badge no', 'badge', 'badge id', 'card no', 'id', 'sewadar id'] },
  { key: 'sewadar_name', label: 'Name', aliases: ['sewadar_name', 'sewadar name', 'name', 'full name', 'member name'] },
  { key: 'centre',      label: 'Centre', aliases: ['centre', 'center', 'gurdwara', 'home centre', 'location'] },
  { key: 'department',  label: 'Department', aliases: ['department', 'dept', 'department name'] },
  { key: 'badge_status',label: 'Badge Status', aliases: ['badge_status', 'badge status', 'status'] },
  { key: 'gender',      label: 'Gender', aliases: ['gender', 'sex'] },
]

// Filter columns: read ONLY to decide whether a sheet row is valid for comparison.
// These are NOT compared against the DB — only DB fields above are compared.
const FILTER_FIELDS = [
  { key: 'print_status', label: 'Print Status', allowed: ['printed', 'readytoprint', 'readytoprint-vss'], aliases: ['print status', 'print', 'printed'] },
  { key: 'form_status',  label: 'Form Status',  allowed: ['approved'], aliases: ['form status', 'form_status', 'approval', 'form', 'approval status'] },
]

// Badge statuses from the sheet that are allowed (all others are skipped)
const ALLOWED_BADGE_STATUS = ['open', 'permanent', 'elderly']

function normalize(v) {
  return String(v ?? '').trim().toLowerCase()
}

// Extra DB columns to include when building INSERT statements (read from the sheet,
// but NOT used for comparison/changed detection).
const INSERT_FIELDS = [
  { key: 'father_husband_name', label: 'Father/Husband Name', aliases: ['father husband name', 'father_husband_name', 'father name', 'husband name'] },
  { key: 'is_initiated', label: 'Initiated', aliases: ['is_initiated', 'initiated'], type: 'boolean' },
  { key: 'age', label: 'Age', aliases: ['age'] },
  { key: 'print_status', label: 'Print Status', aliases: ['print status', 'print', 'printed'] },
  { key: 'form_status', label: 'Form Status', aliases: ['form status', 'form_status', 'approval'] },
]

// Fixed column order for INSERT INTO public.sewadars (auto columns id/created_at excluded)
const INSERT_COLUMNS = [
  'badge_number', 'sewadar_name', 'father_husband_name', 'gender',
  'badge_status', 'centre', 'department', 'is_initiated', 'age',
  'print_status', 'form_status',
]

// Map each sheet header -> field, ignoring non-DB columns
function buildAliasMapping(fields, sheetHeaders) {
  const mapping = {} // key -> excel column index
  const used = new Set()
  for (const field of fields) {
    let found = null
    for (let i = 0; i < sheetHeaders.length; i++) {
      if (used.has(i)) continue
      const h = normalize(sheetHeaders[i])
      if (field.aliases.some((a) => h === normalize(a))) {
        found = i
        break
      }
    }
    if (found !== null) {
      mapping[field.key] = found
      used.add(found)
      field._excelCol = sheetHeaders[found]
    }
  }
  return mapping
}

// Locate a filter column by aliases (returns excel column index or undefined)
function buildFilterMapping(sheetHeaders) {
  const filterMap = {}
  for (const filter of FILTER_FIELDS) {
    for (let i = 0; i < sheetHeaders.length; i++) {
      const h = normalize(sheetHeaders[i])
      if (filter.aliases.some((a) => h === normalize(a))) {
        filterMap[filter.key] = i
        filter._excelCol = sheetHeaders[i]
        break
      }
    }
  }
  return filterMap
}

// ---------------------------------------------------------------------------
// 3. Read the Excel sheet
// ---------------------------------------------------------------------------
function readSheet(filePath) {
  const wb = XLSX.readFile(filePath)
  // use the first sheet that has rows
  const ws = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
  if (rows.length === 0) throw new Error(`No data rows found in sheet "${wb.SheetNames[0]}"`)
  return rows
}

function buildSheetRecords(rows, mapping, filterMap, insertMap) {
  const headers = Object.keys(rows[0])
  const records = []  // rows that pass all filters (valid)
  const filtered = [] // rows that EXIST but were excluded by a filter -> { rec, reason }
  const draft = []    // rows whose Form_Status is Draft -> delete candidates
  const seen = new Set()

  const badgeVal = (raw, field) => {
    const idx = mapping[field.key]
    if (idx === undefined) return ''
    return String(raw[headers[idx]] ?? '').trim()
  }

  for (const raw of rows) {
    const badge = badgeVal(raw, DB_FIELDS[0]) // badge_number
    if (!badge) continue

    // Determine why this row would be filtered (empty reason = passes all filters)
    let reason = ''
    for (const filter of FILTER_FIELDS) {
      const idx = filterMap[filter.key]
      if (idx === undefined) continue // column missing -> not applied
      const val = normalize(raw[headers[idx]])
      if (val && !filter.allowed.includes(val)) {
        reason = `${filter.label} is "${String(raw[headers[idx]]).trim()}" (needs ${filter.allowed.join('/')})`
        break
      }
    }
    const badgeStatVal = badgeVal(raw, DB_FIELDS.find((f) => f.key === 'badge_status'))
    if (!reason && badgeStatVal && !ALLOWED_BADGE_STATUS.includes(normalize(badgeStatVal))) {
      reason = `Badge Status is "${badgeStatVal}" (needs Open/Permanent/Elderly)`
    }

    const rec = {}
    for (const field of DB_FIELDS) {
      const idx = mapping[field.key]
      if (idx === undefined) continue
      rec[field.key] = String(raw[headers[idx]] ?? '').trim()
    }
    for (const field of INSERT_FIELDS) {
      const idx = insertMap[field.key]
      if (idx === undefined) continue
      rec[field.key] = String(raw[headers[idx]] ?? '').trim()
    }

    // Form_Status = Draft -> delete candidate (regardless of other filters)
    if (rec.form_status && normalize(rec.form_status) === 'draft') {
      draft.push({ rec, reason: 'Form Status is "Draft"' })
      continue
    }

    if (reason) {
      filtered.push({ rec, reason })
      continue
    }
    // avoid counting duplicate badges twice (keeps first passing occurrence)
    if (seen.has(norm(badge))) continue
    seen.add(norm(badge))
    records.push(rec)
  }

  return { records, filtered, draft }
}

// ---------------------------------------------------------------------------
// 4. Fetch ALL sewaders from supabase (service role bypasses RLS)
// ---------------------------------------------------------------------------
async function fetchDbSewaders() {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. ' +
      'Add SUPABASE_SERVICE_ROLE_KEY to your .env (needed to bypass RLS and read every sewdar).'
    )
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const all = []
  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('sewadars')
      .select('badge_number, sewadar_name, centre, department, badge_status, gender, age, is_initiated, father_husband_name, print_status, form_status')
      .order('badge_number')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Supabase query failed: ${error.message}`)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

// ---------------------------------------------------------------------------
// 5. Compare and classify
// ---------------------------------------------------------------------------
const norm = (v) => String(v ?? '').trim().toLowerCase()

// Badges listed in keep-badges.txt (one per line, '#' comments allowed) are
// NEVER deleted or merged — they are reported as KEPT and left untouched.
function loadKeepBadges(keepPath) {
  if (!fs.existsSync(keepPath)) return new Set()
  const set = new Set()
  for (const line of fs.readFileSync(keepPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    set.add(norm(t))
  }
  return set
}

function classify(sheetRecords, dbRecords, filtered, draft, keepBadges = new Set()) {
  const dbByBadge = new Map(dbRecords.map((r) => [norm(r.badge_number), r]))

  const inDb = []       // sheet (valid) row exists in DB
  const notInDb = []     // sheet (valid) row NEW (badge not in DB)
  const dbNotInSheet = []   // DB row truly absent from sheet (not present at all)
  const dbPresentFiltered = [] // DB row present in sheet but excluded by a filter
  const dbDraft = []    // DB row whose sheet Form_Status is Draft -> delete candidates
  const changes = []     // matched, but values differ

  const validBadges = new Set(sheetRecords.map((r) => norm(r.badge_number)))
  // any badge that appears in the sheet AT ALL (valid or filtered)
  const presentBadges = new Set([
    ...validBadges,
    ...filtered.map((f) => norm(f.rec.badge_number)),
    ...draft.map((f) => norm(f.rec.badge_number)),
  ])

  for (const s of sheetRecords) {
    const badge = norm(s.badge_number)
    const db = dbByBadge.get(badge)
    if (!db) {
      notInDb.push(s)
      continue
    }
    inDb.push({ ...s })
    const diffs = []
    for (const field of DB_FIELDS) {
      if (field.key === 'badge_number') continue
      if (field.key in s && field.key in db) {
        const a = norm(s[field.key])
        const b = norm(db[field.key])
        if (a !== b) diffs.push({ key: field.key, label: field.label, sheet: String(s[field.key] ?? '').trim(), db: String(db[field.key] ?? '').trim() })
      }
    }
    if (diffs.length) changes.push({ badge_number: s.badge_number, badge_norm: badge, diffs })
  }

  // For DB records not among valid rows: distinguish truly absent v present-but-filtered
  const filteredByBadge = new Map(filtered.map((f) => [norm(f.rec.badge_number), f.reason]))
  for (const d of dbRecords) {
    const badge = norm(d.badge_number)
    if (validBadges.has(badge)) continue
    if (presentBadges.has(badge)) {
      dbPresentFiltered.push({ ...d, filter_reason: filteredByBadge.get(badge) || 'excluded by filters' })
    } else {
      dbNotInSheet.push(d)
    }
  }

  // Draft rows: only deletable if the badge actually exists in the DB AND is not
  // a valid (kept) record anywhere in the sheet.
  const draftByBadge = new Map(draft.map((f) => [norm(f.rec.badge_number), f.rec]))
  for (const d of dbRecords) {
    const badge = norm(d.badge_number)
    if (validBadges.has(badge)) continue
    if (draftByBadge.has(badge)) dbDraft.push(d)
  }

  // ---------------------------------------------------------------------------
  // 5b. Transfer detection: DB records missing from the sheet may be cases where
  //     the sewadar was re-issued a new badge (badge transfer). Match on exact
  //     normalized name, then disambiguate ties by scoring other details.
  // ---------------------------------------------------------------------------
  const TRANSFER_DETAIL_FIELDS = [
    { key: 'centre', weight: 2, label: 'Centre' },
    { key: 'department', weight: 2, label: 'Department' },
    { key: 'gender', weight: 1, label: 'Gender' },
    { key: 'age', weight: 1, label: 'Age' },
    { key: 'is_initiated', weight: 1, label: 'Initiated' },
    { key: 'father_husband_name', weight: 1, label: 'Father/Husband' },
  ]

  const detailScore = (dbRec, sheetRec) => {
    const matched = []
    let score = 0
    for (const f of TRANSFER_DETAIL_FIELDS) {
      const a = norm(dbRec[f.key])
      const b = norm(sheetRec[f.key])
      if (a && b && a === b) {
        score += f.weight
        matched.push(`${f.label}="${String(sheetRec[f.key]).trim()}"`)
      }
    }
    return { score, matched }
  }

  const sheetCandidatePool = [...sheetRecords, ...filtered.map((f) => f.rec)]
  const byName = new Map()
  for (const rec of sheetCandidatePool) {
    const n = norm(rec.sewadar_name)
    if (!n) continue
    if (!byName.has(n)) byName.set(n, [])
    byName.get(n).push(rec)
  }

  const transfers = []          // old badge -> new badge (SQL UPDATE)
  const ambiguous = []          // same-name ties not resolved by details (report-only)
  const dbNotInSheetTagged = [] // full list w/ transfer status for the report
  const remainingNotInSheet = [] // SQL DELETE list (no name match at all)
  const transferredNewBadges = new Set()
  let keptCount = 0

  for (const d of dbNotInSheet) {
    if (keepBadges.has(norm(d.badge_number))) {
      dbNotInSheetTagged.push({ ...d, transfer_status: 'KEPT (in keep-badges.txt)' })
      keptCount++
      continue
    }
    const name = norm(d.sewadar_name)
    const candidates = byName.get(name)
    let status = 'DELETE'
    if (candidates && candidates.length) {
      const scored = candidates.map((c) => ({ rec: c, ...detailScore(d, c) }))
      scored.sort((a, b) => b.score - a.score)
      const top = scored[0]
      const targetDb = dbByBadge.get(norm(top.rec.badge_number))
      const samePerson = targetDb && norm(targetDb.sewadar_name) === name
      const pick = (kind, conf, matched = []) => {
        transfers.push({ old: d, new: top.rec, targetDb, kind, confidence: conf, matched })
        transferredNewBadges.add(norm(top.rec.badge_number))
        return `${kind === 'merge' ? 'MERGED' : 'TRANSFERRED'} -> ${top.rec.badge_number} (${conf}${matched.length ? ': ' + matched.join(', ') : ''})`
      }
      if (candidates.length === 1 && !targetDb) {
        status = pick('transfer', 'exact name match')
      } else if (candidates.length === 1 && samePerson) {
        status = pick('merge', 'duplicate in DB, same person')
      } else if (candidates.length > 1 && top.score > 0 && scored[1] && scored[1].score < top.score) {
        if (!targetDb) status = pick('transfer', 'detail-matched', top.matched)
        else if (samePerson) status = pick('merge', 'detail-matched, duplicate in DB', top.matched)
        else status = `AMBIGUOUS - target badge ${top.rec.badge_number} exists in DB for a different person`
      } else {
        const reason = targetDb
          ? (samePerson ? '' : `target badge ${top.rec.badge_number} already exists in DB for a different person`)
          : `${scored.filter((s) => s.score === top.score).length} same-name candidates, details don't resolve`
        ambiguous.push({ old: d, candidates: scored.filter((s) => s.score === top.score).map((s) => s.rec), reason })
        status = `AMBIGUOUS - ${reason}`
      }
    }
    dbNotInSheetTagged.push({ ...d, transfer_status: status })
    if (status === 'DELETE') remainingNotInSheet.push(d)
  }

  return {
    inDb, notInDb, dbNotInSheet: dbNotInSheetTagged, dbNotInSheetToDelete: remainingNotInSheet,
    dbPresentFiltered, dbDraft, changed: changes, transfers, ambiguous, transferredNewBadges, keptCount,
  }
}

// ---------------------------------------------------------------------------
// 6. Write the report workbook
// ---------------------------------------------------------------------------
function writeReport({ inDb, notInDb, dbNotInSheet, dbPresentFiltered, changed, transfers, ambiguous }, outPath, mapping) {
  const cols = DB_FIELDS.filter((f) => mapping[f.key] !== undefined || f.key === 'badge_number')
  const headerRow = cols.map((c) => c.label)

  const rowFor = (rec) => cols.map((c) => {
    if (c.key === 'badge_number' && rec.filter_reason) return rec.badge_number
    return rec[c.key] ?? ''
  })

  const wb = XLSX.utils.book_new()

  const inDbSheet = XLSX.utils.aoa_to_sheet([headerRow, ...inDb.map(rowFor)])
  XLSX.utils.book_append_sheet(wb, inDbSheet, 'In database')

  const notInDbSheet = XLSX.utils.aoa_to_sheet([headerRow, ...notInDb.map(rowFor)])
  XLSX.utils.book_append_sheet(wb, notInDbSheet, 'Not in database')

  // DB records missing from the sheet, with transfer classification
  const missHeader = [...headerRow, 'Transfer status']
  const missRows = dbNotInSheet.map((d) => [...cols.map((c) => d[c.key] ?? ''), d.transfer_status || ''])
  const dbNotInSheetSheet = XLSX.utils.aoa_to_sheet([missHeader, ...missRows])
  XLSX.utils.book_append_sheet(wb, dbNotInSheetSheet, 'In DB not in sheet')

  // Transfers: old badge -> new badge
  const transferRows = [['Old Badge', 'New Badge', 'Name', 'Centre', 'Department', 'Type', 'Confidence', 'Matched fields']]
  for (const t of transfers) {
    transferRows.push([
      t.old.badge_number, t.new.badge_number, t.new.sewadar_name,
      t.new.centre, t.new.department, t.kind === 'merge' ? 'MERGE' : 'TRANSFER', t.confidence, t.matched.join(', '),
    ])
  }
  for (const a of ambiguous) {
    for (const c of a.candidates) {
      transferRows.push([a.old.badge_number, c.badge_number, c.sewadar_name, c.centre, c.department, 'AMBIGUOUS', a.reason, ''])
    }
  }
  if (transferRows.length > 1) {
    const trSheet = XLSX.utils.aoa_to_sheet(transferRows)
    XLSX.utils.book_append_sheet(wb, trSheet, 'Transfers')
  }

  // DB sweat in sheet but excluded by filters
  const filtHeader = [...headerRow, 'Filter reason']
  const filtRows = dbPresentFiltered.map((d) => [...cols.map((c) => d[c.key] ?? ''), d.filter_reason || ''])
  const filtSheet = XLSX.utils.aoa_to_sheet([filtHeader, ...filtRows])
  XLSX.utils.book_append_sheet(wb, filtSheet, 'In DB but filtered')

  // Changed fields: one row per changed field
  const changeRows = [['Badge Number', 'Field', 'Value in Sheet', 'Value in DB']]
  for (const c of changed) {
    for (const d of c.diffs) changeRows.push([c.badge_number, d.label, d.sheet, d.db])
  }
  const chSheet = XLSX.utils.aoa_to_sheet(changeRows)
  XLSX.utils.book_append_sheet(wb, chSheet, 'Changed fields')

  XLSX.writeFile(wb, outPath)
  return outPath
}

// ---------------------------------------------------------------------------
// 6b. Generate SQL to APPLY the sheet changes to the DB.
//     - UPDATE  : every changed field (sheet value wins).
//     - INSERT  : sewaders in sheet but NOT in DB (newly added).
//     - DELETE  : Draft form-status rows AND records present in DB but not in the sheet.
// ---------------------------------------------------------------------------
const DB_KEY_TO_COL = {
  badge_number: 'badge_number',
  sewadar_name: 'sewadar_name',
  centre: 'centre',
  department: 'department',
  badge_status: 'badge_status',
  gender: 'gender',
}

function sqlVal(v) {
  const s = String(v ?? '').trim()
  if (!s) return 'NULL'
  return `'${s.replace(/'/g, "''")}'`
}

// Build one full-column INSERT for a new record. All DB columns are filled from
// the matching Excel columns; anything missing becomes NULL / its default.
function insertFor(rec) {
  const parts = []
  for (const col of INSERT_COLUMNS) {
    const raw = String(rec[col] ?? '').trim()
    if (col === 'is_initiated') {
      parts.push(raw ? (['true', '1', 'yes', 'y'].includes(normalize(raw)) ? 'true' : 'false') : 'false')
    } else {
      parts.push(sqlVal(raw))
    }
  }
  return `INSERT INTO public.sewadars (${INSERT_COLUMNS.join(', ')}) VALUES (${parts.join(', ')});`
}

function generateSql(changes, notInDb, dbDraft, dbNotInSheet, transfers) {
  const lines = []
  lines.push('-- ===================================================================')
  lines.push('-- Sewadar reconciliation SQL (generated by validate-sewadars.mjs)')
  lines.push('--   newly_added  : INSERTs sewaders in the sheet but not in DB (ALL columns)')
  lines.push('--   changed      : UPDATEs changed fields from the sheet')
  lines.push('--   transfer     : UPDATE badge_number (old -> new) on sewadars + child tables')
  lines.push('--   draft_remove : DELETE sewadars whose sheet Form_Status is "Draft"')
  lines.push('--   missing      : DELETE sewadars in DB but NOT in the sheet at all')
  lines.push('-- Run these in the Supabase SQL editor. Review first; use in a transaction.')
  lines.push('-- ===================================================================')
  lines.push('')

  if (transfers.length) {
    lines.push('-- ===================================================================')
    lines.push('-- TRANSFERS / MERGES: same sewadar found under another badge.')
    lines.push('--   transfer : badge re-issued (old badge no longer used) -> rename old->new')
    lines.push('--   merge    : duplicate row in DB (same person, two badges) -> move history')
    lines.push('--             to the kept badge and delete the duplicate row.')
    lines.push('-- Child tables first (FK has no ON UPDATE CASCADE).')
    lines.push('-- ===================================================================')
    for (const t of transfers) {
      lines.push(`-- ${t.old.badge_number} (${t.old.sewadar_name}) -> ${t.new.badge_number} [${t.kind.toUpperCase()}, ${t.confidence}]`)
      lines.push(`UPDATE public.attendance_sessions SET badge_number = ${sqlVal(t.new.badge_number)} WHERE badge_number = ${sqlVal(t.old.badge_number)};`)
      lines.push(`UPDATE public.jatha_attendance SET badge_number = ${sqlVal(t.new.badge_number)} WHERE badge_number = ${sqlVal(t.old.badge_number)};`)
      if (t.kind === 'merge') {
        lines.push(`-- duplicate row: the new badge already exists in DB with full details; drop the old row`)
        lines.push(`DELETE FROM public.sewadars WHERE badge_number = ${sqlVal(t.old.badge_number)};`)
      } else {
        const cols = INSERT_COLUMNS.filter((c) => c !== 'badge_number')
        const parts = [`badge_number = ${sqlVal(t.new.badge_number)}`]
        for (const col of cols) {
          const raw = String(t.new[col] ?? '').trim()
          let v
          if (col === 'is_initiated') {
            v = raw ? (['true', '1', 'yes', 'y'].includes(normalize(raw)) ? 'true' : 'false') : 'false'
          } else {
            v = sqlVal(raw)
          }
          parts.push(`${col} = ${v}`)
        }
        lines.push(`UPDATE public.sewadars SET ${parts.join(', ')} WHERE badge_number = ${sqlVal(t.old.badge_number)};`)
      }
    }
    lines.push('')
  }

  if (notInDb.length) {
    lines.push('-- ... INSERT NEW (in sheet, not in DB) ...')
    for (const rec of notInDb) lines.push(insertFor(rec))
    lines.push('')
  }

  lines.push('-- UPDATE changed fields (sheet value wins) --')
  for (const c of changes) {
    for (const d of c.diffs) {
      lines.push(`UPDATE public.sewadars SET ${DB_KEY_TO_COL[d.key]} = ${sqlVal(d.sheet)} WHERE badge_number = ${sqlVal(c.badge_number)};`)
    }
  }
  lines.push('')

  if (dbDraft.length) {
    lines.push('-- DELETE: Form_Status = "Draft" (present in sheet, exists in DB) --')
    for (const d of dbDraft) lines.push(`DELETE FROM public.sewadars WHERE badge_number = ${sqlVal(d.badge_number)};`)
    lines.push('')
  }

  if (dbNotInSheet.length) {
    lines.push('-- ===================================================================')
    lines.push('-- ONE-TIME SCHEMA FIX (idempotent, safe to re-run): attendance_sessions')
    lines.push('-- and jatha_attendance badge_number is NOT NULL, but their FK is')
    lines.push('-- ON DELETE SET NULL. Without this, deleting a sewadar that has')
    lines.push('-- attendance rows fails with 23502. History is KEPT with a NULL badge.')
    lines.push('-- ===================================================================')
    lines.push('ALTER TABLE public.attendance_sessions ALTER COLUMN badge_number DROP NOT NULL;')
    lines.push('ALTER TABLE public.jatha_attendance ALTER COLUMN badge_number DROP NOT NULL;')
    lines.push('')
    lines.push('-- DELETE: In DB but NOT in the sheet at all (missing from dump) --')
    lines.push('-- attendance/jatha rows for these badges are kept, badge_number set to NULL by the FK --')
    for (const d of dbNotInSheet) lines.push(`DELETE FROM public.sewadars WHERE badge_number = ${sqlVal(d.badge_number)};`)
    lines.push('')
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 7. Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2)
  const outIdx = args.indexOf('--out')
  const outPath = outIdx !== -1 ? args[outIdx + 1] : path.join(__dirname, 'validation-report.xlsx')
  // First non-option arg is the input file; default to Input.xlsx in this folder
  const positionals = (outIdx !== -1 ? args.filter((_, i) => i !== outIdx && i !== outIdx + 1) : args)
    .filter((a) => a && !a.startsWith('--'))
  const excelPath = positionals[0] ? path.resolve(positionals[0]) : path.join(__dirname, 'Input.xlsx')
  if (!fs.existsSync(excelPath)) {
    console.error(`Input file not found: ${excelPath}`)
    console.error('Put your data file at validation/Input.xlsx, or pass a path: node validate-sewadars.mjs <file.xlsx> [--out report.xlsx]')
    process.exit(1)
  }

  console.log('Reading sheet:', excelPath)
  const rows = readSheet(excelPath)
  const headers = Object.keys(rows[0])
  const mapping = buildAliasMapping(DB_FIELDS, headers)
  const filterMap = buildFilterMapping(headers)
  const insertMap = buildAliasMapping(INSERT_FIELDS, headers)
  const { records: sheetRecords, filtered, draft } = buildSheetRecords(rows, mapping, filterMap, insertMap)

  // Report which DB columns were matched
  const mapped = DB_FIELDS.filter((f) => mapping[f.key] !== undefined)
  const skipped = DB_FIELDS.filter((f) => mapping[f.key] === undefined)
  console.log('Matched sheet columns -> DB fields:')
  for (const f of mapped) console.log(`  "${f._excelCol}"  ->  ${f.label}`)
  if (skipped.length) {
    console.log('DB fields with NO matching sheet column (will not be compared):')
    for (const f of skipped) console.log(`  ${f.label}`)
  }

  // Report which filter columns were found
  const foundFilters = FILTER_FIELDS.filter((f) => filterMap[f.key] !== undefined)
  console.log('Filter columns used:')
  for (const f of foundFilters) console.log(`  "${f._excelCol}"  ->  must be ${f.allowed.join('/')}`)
  const missingFilters = FILTER_FIELDS.filter((f) => filterMap[f.key] === undefined)
  for (const f of missingFilters) console.log(`  WARNING: no "${f.label}" column found - filter NOT applied`)

  console.log(`Rows read: ${rows.length}`)
  console.log(`Rows kept (valid): ${sheetRecords.length}`)
  console.log(`Rows in sheet but filtered out: ${filtered.length}`)
  console.log('')

  console.log('Fetching DB sewaders from Supabase...')
  const dbRecords = await fetchDbSewaders()

  const keepBadges = loadKeepBadges(path.join(__dirname, 'keep-badges.txt'))

  const { inDb, notInDb, dbNotInSheet, dbNotInSheetToDelete, dbPresentFiltered, dbDraft, changed, transfers, ambiguous, transferredNewBadges, keptCount } = classify(sheetRecords, dbRecords, filtered, draft, keepBadges)

  // Transferred sewadars already get their new badge via the transfer UPDATE —
  // suppress the INSERT that would otherwise be generated for the new badge.
  const notInDbFinal = notInDb.filter((r) => !transferredNewBadges.has(norm(r.badge_number)))

  const out = writeReport({ inDb, notInDb: notInDbFinal, dbNotInSheet, dbPresentFiltered, changed, transfers, ambiguous }, outPath, mapping)

  // Write SQL to apply the sheet changes
  const sqlPath = outPath.replace(/\.xlsx$/i, '.sql')
  const sql = generateSql(changed, notInDbFinal, dbDraft, dbNotInSheetToDelete, transfers)
  fs.writeFileSync(sqlPath, sql)

  console.log('')
  console.log('================ VALIDATION SUMMARY ================')
  console.log(`  Total valid rows in sheet    : ${sheetRecords.length}`)
  console.log(`  Filtered-out sheet rows      : ${filtered.length}`)
  console.log(`  Draft rows (to delete)       : ${draft.length} (in DB: ${dbDraft.length})`)
  console.log(`  Total rows in DB             : ${dbRecords.length}`)
  console.log(`  In database (sheet = DB)     : ${inDb.length}`)
  console.log(`  Not in database (NEWLY ADDED): ${notInDb.length}`)
  console.log(`  In DB but present in sheet (filtered): ${dbPresentFiltered.length}`)
  console.log(`  In DB, not in sheet at all   : ${dbNotInSheet.length}`)
  console.log(`    -> KEPT (allowlist)         : ${keptCount}`)
  console.log(`    -> TRANSFERRED (new badge)  : ${transfers.length}`)
  console.log(`    -> AMBIGUOUS (report only)  : ${ambiguous.length}`)
  console.log(`    -> DELETE                   : ${dbNotInSheetToDelete.length}`)
  console.log(`  Sewaders with changed fields : ${changed.length} (${changed.reduce((n, c) => n + c.diffs.length, 0)} field changes)`)
  console.log('')
  console.log('Report written to:', path.resolve(outPath))
  console.log('SQL written to  :', path.resolve(sqlPath))
  console.log('Sheets: "In database", "Not in database", "In DB not in sheet", "In DB but filtered", "Changed fields", "Transfers"')
  console.log('SQL: INSERT for new + UPDATE for changed + TRANSFER updates + DELETE for Draft form status + DELETE for records missing from sheet')
}

main().catch((err) => {
  console.error('\nERROR:', err.message)
  process.exit(1)
})