// ============================================================================
// csv.js — the ONE CSV writer for archival exports
// ============================================================================
//
// Three code paths emit the same archival CSV and must not disagree:
//   * the browser fallback in ReportsPage (via archivalExport.js),
//   * the queue worker (tools/archival_export_worker.mjs imports this file),
//   * the SQL RPC public.get_archival_csv_chunk() (mirrored, not imported).
//
// The escaping rule therefore lives here once. `DANGEROUS_LEAD` mirrors the
// bracket expression `^[=+@\t\r-]` in sql/archival_download_rpc.sql, and
// csv.test.js reads that SQL file and fails if the two drift apart.
//
// A cell that STARTS with one of those characters is executed as a formula by
// Excel / Sheets / LibreOffice, so it is prefixed with an apostrophe (which the
// spreadsheet hides and the formula never sees). Quoting alone does not stop
// this: `"=2+2"` is still a formula.

export const CSV_EOL = '\r\n';

/** Archival export columns, in the order the deployed page ships them.
 *  `gender` and `age` are lowercase on purpose: those header strings are already
 *  in users' hands from previous exports, so they are pinned, not fixed. */
export const ARCHIVAL_COLUMNS = [
  { key: 'sewadar_name', header: 'Sewadar Name' },
  { key: 'badge_number', header: 'Badge Number' },
  { key: 'father_husband_name', header: 'Father/Husband Name' },
  { key: 'gender', header: 'gender' },
  { key: 'age', header: 'age' },
  { key: 'department_name', header: 'Department Name' },
  { key: 'department_id', header: 'Department Id' },
  { key: 'area_name', header: 'Area Name' },
  { key: 'centre_name', header: 'Centre Name' },
  { key: 'status', header: 'Status' },
  { key: 'duty_type', header: 'Duty Type' },
  { key: 'duty_date', header: 'Duty Date' },
  { key: 'deployed_department', header: 'Deployed Department' },
  { key: 'deployed_centre', header: 'Deployed Centre' },
];

export const ARCHIVAL_HEADERS = ARCHIVAL_COLUMNS.map((c) => c.header);

/** PostgREST select list — keeps the fetch and the CSV in step by construction. */
export const ARCHIVAL_SELECT = ARCHIVAL_COLUMNS.map((c) => c.key).join(',');

export const DANGEROUS_LEAD = /^[=+@\t\r-]/;
const NEEDS_QUOTE = /[",\n\r]/;

/** Escape one cell exactly as public.csv_field() does. */
export function csvEscapeCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (s === '') return '';
  if (DANGEROUS_LEAD.test(s)) s = `'${s}`;
  if (NEEDS_QUOTE.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvHeader() {
  return ARCHIVAL_HEADERS.join(',');
}

/** ISO date -> DD-MM-YYYY, matching the source file and the RPC's to_char(). */
export function toDDMMYYYY(value) {
  if (value === null || value === undefined || value === '') return '';
  const iso = String(value).slice(0, 10);
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  return parts.reverse().join('-');
}

/** Full CSV text for rows already fetched from PostgREST. */
export function buildCsv(rows, columns = ARCHIVAL_COLUMNS) {
  const lines = [columns.map((c) => c.header).join(',')];
  for (const row of rows || []) {
    lines.push(
      columns
        .map((col) => {
          const raw = row ? row[col.key] : null;
          return csvEscapeCell(col.key === 'duty_date' ? toDDMMYYYY(raw) : raw);
        })
        .join(','),
    );
  }
  return lines.join(CSV_EOL);
}

/** `archival_all.csv`, `archival_JMC.csv`, `archival_all_2024-01-01_to_end.csv`…
 *  The worker's artifactFilename() and the worker's object path use the same
 *  rule, so a downloaded artifact and a browser-built file are named alike. */
export function archivalFilename({ dutyType = null, dateFrom = null, dateTo = null } = {}) {
  const scope = dutyType ? dutyType : 'all';
  const dated = dateFrom || dateTo;
  const range = dated ? `_${dateFrom || 'start'}_to_${dateTo || 'end'}` : '';
  return `archival_${scope}${range}.csv`;
}

/** Trigger a browser download without buffering a second copy in memory. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
