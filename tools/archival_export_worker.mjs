#!/usr/bin/env node
// ============================================================================
// archival_export_worker.mjs — generate archival CSV artifacts, drain the queue
// ============================================================================
//
// SERVER-SIDE ONLY. This script uses the Supabase service-role key, which
// bypasses RLS. It must never run in a browser, never be bundled, and never be
// pointed at a database you have not been asked to write to.
//
//   node tools/archival_export_worker.mjs --snapshots [--dry-run] [--bucket B]
//   node tools/archival_export_worker.mjs --jobs [--limit N] [--dry-run] [--bucket B]
//
//   --snapshots  build the reusable artifacts: one "all" snapshot plus one per
//                duty type. These are what elevated callers (ASO / super_admin,
//                no date filter) get served from a signed URL.
//   --jobs       drain public.archival_export_jobs: centre-scoped / date-filtered
//                requests the snapshot set cannot answer.
//   --dry-run    print what would be written, write nothing.
//
// Environment (no defaults, no fallbacks — a missing var is a hard error):
//   SUPABASE_URL               e.g. https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  service-role key
//   ARCHIVAL_EXPORT_BUCKET     optional; overrides --bucket
//
// Storage layout (see buildObjectPath):
//   archival/<scope>/<duty|all>/<dates|all>/<fingerprint|none>/v<version>/<file>
//
// The pure helpers below are unit-tested in archival_export_worker.test.mjs and
// MUST keep agreeing with the SQL side:
//   csvEscapeCell     <-> public.csv_field               (sql/archival_download_rpc.sql)
//   scopeFingerprint  <-> public.archival_scope_fingerprint (sql/archival_export_jobs.sql)

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const CSV_EOL = '\r\n';
export const DUTY_TYPES = ['D', 'JMC', 'JO', 'V', 'JH'];

// Column keys are the PostgREST column names; headers are the shipped header
// row. Order is pinned to the RPC's SELECT order in sql/archival_download_rpc.sql.
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
export const ARCHIVAL_SELECT = ARCHIVAL_COLUMNS.map((c) => c.key).join(',');

// A cell that STARTS with one of these is interpreted as a formula by Excel /
// Sheets / LibreOffice. Mirrors `t ~ '^[=+@\t\r-]'` in sql/archival_download_rpc.sql;
// the test suite reads that file and fails if the two drift apart.
const DANGEROUS_LEAD = /^[=+@\t\r-]/;
const NEEDS_QUOTE = /[",\n\r]/;
const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,120}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

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
export function rowsToCsv(rows) {
  const lines = [csvHeader()];
  for (const row of rows || []) {
    lines.push(
      ARCHIVAL_COLUMNS.map((col) => {
        const raw = row ? row[col.key] : null;
        return csvEscapeCell(col.key === 'duty_date' ? toDDMMYYYY(raw) : raw);
      }).join(','),
    );
  }
  return lines.join(CSV_EOL);
}

// ---------------------------------------------------------------------------
// Scope fingerprint / paths
// ---------------------------------------------------------------------------

/**
 * md5 of the sorted, de-duplicated, non-blank centre names joined with '|'.
 * Empty scope is '' (not md5('')). Sorted with JS default (code-unit) order to
 * match `ORDER BY c COLLATE "C"` on the SQL side. Values are joined RAW.
 */
export function scopeFingerprint(centres) {
  if (centres === null || centres === undefined) return '';
  const uniq = new Set();
  for (const raw of centres) {
    if (raw === null || raw === undefined) continue;
    const s = String(raw);
    if (s.trim() === '') continue;
    uniq.add(s);
  }
  if (uniq.size === 0) return '';
  return createHash('md5').update([...uniq].sort().join('|')).digest('hex');
}

/** A single path component we are willing to build a Storage key from. */
export function isSafePathSegment(seg) {
  if (typeof seg !== 'string') return false;
  if (seg === '.' || seg === '..') return false;
  return SAFE_SEGMENT.test(seg);
}

/** Filename shown to the user; mirrors archivalFileName() in ReportsPage.jsx. */
export function artifactFilename({ dutyType = null, dateFrom = null, dateTo = null } = {}) {
  const label = dutyType ? `archival_${dutyType}` : 'archival_all';
  const range = dateFrom || dateTo ? `_${dateFrom || 'start'}_to_${dateTo || 'end'}` : '';
  return `${label}${range}.csv`;
}

/**
 * Deterministic Storage key. Throws rather than emitting an unsafe path: a
 * crafted duty type or date could otherwise escape the `archival/` prefix.
 */
export function buildObjectPath({
  scope,
  dutyType = null,
  dateFrom = null,
  dateTo = null,
  fingerprint = '',
  version,
}) {
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`buildObjectPath: version must be a positive integer, got ${JSON.stringify(version)}`);
  }
  const segments = [
    'archival',
    String(scope ?? ''),
    dutyType ? String(dutyType) : 'all',
    dateFrom || dateTo ? `${dateFrom || 'start'}_${dateTo || 'end'}` : 'all',
    fingerprint ? String(fingerprint) : 'none',
    `v${version}`,
    artifactFilename({ dutyType, dateFrom, dateTo }),
  ];
  for (const seg of segments) {
    if (!isSafePathSegment(seg)) {
      throw new Error(`buildObjectPath: unsafe path segment ${JSON.stringify(seg)}`);
    }
  }
  return segments.join('/');
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const args = { mode: null, dryRun: false, bucket: null, limit: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--snapshots' || a === '--jobs') {
      const mode = a === '--jobs' ? 'jobs' : 'snapshots';
      if (args.mode && args.mode !== mode) {
        throw new Error('parseArgs: choose exactly one of --snapshots / --jobs');
      }
      args.mode = mode;
    } else if (a === '--dry-run') {
      args.dryRun = true;
    } else if (a === '--bucket') {
      const v = argv[(i += 1)];
      if (!v) throw new Error('parseArgs: --bucket needs a value');
      if (!isSafePathSegment(v)) throw new Error(`parseArgs: unsafe bucket name ${JSON.stringify(v)}`);
      args.bucket = v;
    } else if (a === '--limit') {
      const v = argv[(i += 1)];
      if (!/^\d+$/.test(v ?? '')) throw new Error('parseArgs: --limit needs a non-negative integer');
      args.limit = Number(v);
    } else {
      throw new Error(`parseArgs: unknown argument ${JSON.stringify(a)}`);
    }
  }
  if (!args.mode) throw new Error('parseArgs: pass --snapshots or --jobs');
  return args;
}

// ---------------------------------------------------------------------------
// Runtime (never reached by the unit tests)
// ---------------------------------------------------------------------------

function resolveConfig(args) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = args.bucket || process.env.ARCHIVAL_EXPORT_BUCKET || null;
  const missing = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!key) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!bucket) missing.push('ARCHIVAL_EXPORT_BUCKET (or --bucket)');
  if (missing.length) {
    throw new Error(`missing required environment: ${missing.join(', ')}`);
  }
  if (!isSafePathSegment(bucket)) throw new Error(`unsafe bucket name ${JSON.stringify(bucket)}`);
  return { url, key, bucket };
}

const PAGE = 1000; // PostgREST default max-rows

async function fetchAllRows(client, { dutyType = null, dateFrom = null, dateTo = null, centreScope = null }, onPage) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let q = client
      .from('archival_attendance')
      .select(ARCHIVAL_SELECT)
      // Same presentation order as sql/archival_download_rpc.sql (and the
      // idx_archival_export_order index it creates).
      .order('duty_date', { ascending: false })
      .order('sewadar_name', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (dutyType) q = q.eq('duty_type', dutyType);
    if (dateFrom) q = q.gte('duty_date', dateFrom);
    if (dateTo) q = q.lte('duty_date', dateTo);
    if (centreScope && centreScope.length) q = q.in('centre_name', centreScope);
    const { data, error } = await q;
    if (error) throw new Error(`fetch archival rows failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (onPage) onPage(rows.length);
    if (data.length < PAGE) break;
  }
  return rows;
}

async function publishArtifact(client, { bucket, csv, meta, dryRun }) {
  const body = Buffer.from(csv, 'utf8');
  const sha256 = createHash('sha256').update(body).digest('hex');
  const rowCount = Math.max(0, csv.split(CSV_EOL).length - 1);

  const { data: prev, error: prevErr } = await client
    .from('archival_export_artifacts')
    .select('version')
    .eq('scope', meta.scope)
    .eq('scope_fingerprint', meta.fingerprint || '')
    .eq('duty_type', meta.dutyType)
    .eq('is_current', true);
  if (prevErr) throw new Error(`artifact lookup failed: ${prevErr.message}`);
  const version = (prev?.reduce((m, r) => Math.max(m, r.version || 0), 0) || 0) + 1;

  const objectPath = buildObjectPath({ ...meta, version });
  const filename = artifactFilename(meta);

  if (dryRun) {
    console.log(`[dry-run] would upload ${objectPath} (${rowCount} rows, ${body.byteLength} bytes, sha256 ${sha256.slice(0, 12)}…)`);
    return { objectPath, rowCount, byteSize: body.byteLength, sha256, version, filename, dryRun: true };
  }

  // Upload to a NEW versioned path rather than overwriting: Storage returns
  // 400 "Asset Already Exists" on a plain re-upload, and CDN propagation makes
  // overwriting a live object unreliable.
  const { error: upErr } = await client.storage
    .from(bucket)
    .upload(objectPath, body, { contentType: 'text/csv; charset=utf-8', upsert: false });
  if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

  await client
    .from('archival_export_artifacts')
    .update({ is_current: false })
    .eq('scope', meta.scope)
    .eq('scope_fingerprint', meta.fingerprint || '')
    .eq('duty_type', meta.dutyType)
    .eq('is_current', true);

  const { error: insErr } = await client.from('archival_export_artifacts').insert({
    scope: meta.scope,
    duty_type: meta.dutyType,
    date_from: meta.dateFrom,
    date_to: meta.dateTo,
    centre_scope: meta.centreScope || null,
    scope_fingerprint: meta.fingerprint || '',
    artifact_bucket: bucket,
    artifact_path: objectPath,
    row_count: rowCount,
    byte_size: body.byteLength,
    content_sha256: sha256,
    version,
    is_current: true,
    expires_at: meta.expiresAt || null,
  });
  if (insErr) throw new Error(`artifact record insert failed: ${insErr.message}`);

  console.log(`uploaded ${objectPath} (${rowCount} rows, ${(body.byteLength / 1048576).toFixed(1)} MB)`);
  return { objectPath, rowCount, byteSize: body.byteLength, sha256, version, filename };
}

async function runSnapshots(client, cfg, args) {
  const targets = [{ dutyType: null, label: 'all' }, ...DUTY_TYPES.map((d) => ({ dutyType: d, label: d }))];
  for (const t of targets) {
    const meta = { scope: 'global', dutyType: t.dutyType, dateFrom: null, dateTo: null, fingerprint: '', centreScope: null };
    console.log(`— snapshot ${t.label}`);
    const rows = await fetchAllRows(client, { dutyType: t.dutyType }, (n) => {
      if (n % 50000 === 0) console.log(`  … ${n} rows`);
    });
    await publishArtifact(client, { bucket: cfg.bucket, csv: rowsToCsv(rows), meta, dryRun: args.dryRun });
  }
}

async function runJobs(client, cfg, args) {
  const { data: jobs, error } = await client
    .from('archival_export_jobs')
    .select('id,requested_by,requester_label,duty_type,date_from,date_to,centre_scope,scope_fingerprint,attempts')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(args.limit ?? 25);
  if (error) throw new Error(`job fetch failed: ${error.message}`);
  if (!jobs || jobs.length === 0) {
    console.log('no queued jobs');
    return;
  }

  for (const job of jobs) {
    console.log(`— job ${job.id} (${job.requester_label || job.requested_by})`);
    if (args.dryRun) {
      console.log('  [dry-run] would process');
      continue;
    }
    await client
      .from('archival_export_jobs')
      .update({ status: 'processing', attempts: (job.attempts || 0) + 1, updated_at: new Date().toISOString() })
      .eq('id', job.id)
      .eq('status', 'queued');
    try {
      const centreScope = Array.isArray(job.centre_scope) ? job.centre_scope : [];
      if (centreScope.length === 0) {
        throw new Error('job has an empty centre_scope — refusing to export the whole table');
      }
      const meta = {
        scope: 'centre',
        dutyType: job.duty_type,
        dateFrom: job.date_from,
        dateTo: job.date_to,
        fingerprint: job.scope_fingerprint || scopeFingerprint(centreScope),
        centreScope,
      };
      const rows = await fetchAllRows(client, {
        dutyType: job.duty_type,
        dateFrom: job.date_from,
        dateTo: job.date_to,
        centreScope,
      });
      const published = await publishArtifact(client, {
        bucket: cfg.bucket,
        csv: rowsToCsv(rows),
        meta,
        dryRun: false,
      });
      const { error: doneErr } = await client
        .from('archival_export_jobs')
        .update({
          status: 'ready',
          artifact_bucket: cfg.bucket,
          artifact_path: published.objectPath,
          row_count: published.rowCount,
          byte_size: published.byteSize,
          content_sha256: published.sha256,
          ready_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 7 * DAY_MS).toISOString(),
        })
        .eq('id', job.id);
      if (doneErr) throw new Error(doneErr.message);
    } catch (err) {
      const { error: failErr } = await client
        .from('archival_export_jobs')
        .update({ status: 'failed', error_message: String(err.message || err).slice(0, 500), updated_at: new Date().toISOString() })
        .eq('id', job.id);
      if (failErr) console.error(`  could not record failure: ${failErr.message}`);
      console.error(`  job failed: ${err.message || err}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = resolveConfig(args);
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(cfg.url, cfg.key, { auth: { persistSession: false, autoRefreshToken: false } });
  console.log(`archival export worker → ${cfg.bucket} (mode ${args.mode}${args.dryRun ? ', dry-run' : ''})`);
  if (args.mode === 'snapshots') await runSnapshots(client, cfg, args);
  else await runJobs(client, cfg, args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
