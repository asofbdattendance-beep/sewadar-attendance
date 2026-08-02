/**
 * validate-sewadars.mjs
 *
 * Reconciliation script: Excel sheet (sewadars)  vs  Supabase `sewadars` table.
 * - Reads ONLY the columns in the sheet that map to DB fields (extra cols ignored).
 * - Outputs a report Excel file with sheets:
 *     - "In database"          : sheet rows that exist in DB (matched by badge_number)
 *     - "Not in database"      : sheet rows that are NEW (badge not in DB)
 *     - "In DB not in sheet"   : DB sewadars missing from the sheet (deleted/removed)
 *     - "Changed fields"       : matching sewadars whose info differs (before -> after)
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
      .select('badge_number, sewadar_name, centre, department, badge_status, gender')
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

function classify(sheetRecords, dbRecords, filtered, draft) {
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

  return { inDb, notInDb, dbNotInSheet, dbPresentFiltered, dbDraft, changed: changes }
}

// ---------------------------------------------------------------------------
// 6. Write the report workbook
// ---------------------------------------------------------------------------
function writeReport({ inDb, notInDb, dbNotInSheet, dbPresentFiltered, changed }, outPath, mapping) {
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

  const dbNotInSheetSheet = XLSX.utils.aoa_to_sheet([headerRow, ...dbNotInSheet.map(rowFor)])
  XLSX.utils.book_append_sheet(wb, dbNotInSheetSheet, 'In DB not in sheet')

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
//     - NO DELETE: we intentionally do NOT touch records present in DB but not in sheet.
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

function generateSql(changes, notInDb, dbDraft) {
  const lines = []
  lines.push('-- ===================================================================')
  lines.push('-- Sewadar reconciliation SQL (generated by validate-sewadars.mjs)')
  lines.push('--   newly_added  : INSERTs sewaders in the sheet but not in DB (ALL columns)')
  lines.push('--   changed      : UPDATEs changed fields from the sheet')
  lines.push('--   draft_remove : DELETE sewadars whose sheet Form_Status is "Draft"')
  lines.push('-- NOTE: records in DB but NOT in the sheet are deliberately LEFT as-is (no DELETE).')
  lines.push('-- Run these in the Supabase SQL editor. Review first; use in a transaction.')
  lines.push('-- ===================================================================')
  lines.push('')

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

  const { inDb, notInDb, dbNotInSheet, dbPresentFiltered, dbDraft, changed } = classify(sheetRecords, dbRecords, filtered, draft)

  const out = writeReport({ inDb, notInDb, dbNotInSheet, dbPresentFiltered, changed }, outPath, mapping)

  // Write SQL to apply the sheet changes
  const sqlPath = outPath.replace(/\.xlsx$/i, '.sql')
  const sql = generateSql(changed, notInDb, dbDraft)
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
  console.log(`  Sewaders with changed fields : ${changed.length} (${changed.reduce((n, c) => n + c.diffs.length, 0)} field changes)`)
  console.log('')
  console.log('Report written to:', path.resolve(outPath))
  console.log('SQL written to  :', path.resolve(sqlPath))
  console.log('Sheets: "In database", "Not in database", "In DB not in sheet", "In DB but filtered", "Changed fields"')
  console.log('SQL: INSERT for new + UPDATE for changed + DELETE for Draft form status')
}

main().catch((err) => {
  console.error('\nERROR:', err.message)
  process.exit(1)
})