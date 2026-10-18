# Plan — Archival export: fast, uncapped, correctly scoped

Branch: `feat/archival-export-artifacts` · Base: `d909662` (`feat/scanner-engine-port`)

## Problem

`Reports → Downloads → Archival Reports` exports `public.archival_attendance`
(615,724 rows as measured on the live DB, 41 centres, 5 duty types, 2024-01-01 →
2026-08-30). Today:

- Fast path = `get_archival_csv_chunk()` (chunked CSV built in Postgres). It works but
  re-sorts the whole scoped set for every `OFFSET` chunk, and it is `SECURITY DEFINER`
  with `EXECUTE` granted to `PUBLIC`/`anon` and an unbounded caller-supplied `p_limit`.
- Fallback = client-side paged `select()`, hard-capped at `MAX_ROWS = 650000`. Live row
  count is 34,276 under that cap, so the cap is about to silently truncate real data.
- Exported cells are not neutralised against spreadsheet formula injection.

## Design (the shape the tasks build toward)

1. **Global snapshots** (all rows, and one per duty type) are pre-generated into a
   **private** Storage bucket and registered in `archival_export_artifacts`. An
   elevated caller (ASO / super_admin) with no date filter gets a short-lived signed
   URL immediately — no query executes at click time.
2. **Everything else** (centre-scoped, date-filtered, or both) is an async job row in
   `archival_export_jobs`; the worker drains the queue, streams the scoped CSV into
   Storage, and records the artifact path. The client polls status and then downloads.
3. The **RPC stays as a bounded, hardened fallback** — not the primary path. The
   client-side full-table paging fallback stops silently truncating: it either fits
   inside a documented safe bound or it fails loudly pointing at the server export.
4. **`src/lib/csv.js`** is the single CSV escaping implementation, shared by the
   browser fallback, the RPC path's expectations, and the Node worker.

## Hard constraints honoured

- No statement in any authored SQL is executed by the agent. All DB work is authored
  and handed over with run instructions.
- No bucket is created, no Edge Function is deployed, no worker is run against the DB.
- No push, no merge, no deletes.

## Tasks

### Task 1 — Baseline diagnostics (read-only SQL)
Files: `sql/verify_archival_export.sql` (new)
Produces: one read-only verification script printing row/centre/duty/date counts, table
and index sizes, the live `archival_read` policy, and the effective `EXECUTE` grants on
`get_archival_csv_chunk` + `csv_field` + `archival_csv_header`.
Steps: author the file → `node --check` is n/a (SQL) → instead assert the file parses as
plain text and contains only `SELECT`/`WITH`/`:var` free statements by grepping for
disallowed keywords → commit.
Verify: `grep -nE '\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|CREATE)\b' sql/verify_archival_export.sql` returns nothing outside comments.

### Task 2 — Harden the CSV RPC
Files: `sql/archival_download_rpc.sql` (edit)
Produces: `csv_field()` neutralises spreadsheet formula prefixes; `get_archival_csv_chunk`
clamps `p_limit` to `1..100000`, rejects negative `p_chunk`, uses a deterministic
`ORDER BY duty_date DESC, sewadar_name ASC, id ASC`, and `REVOKE EXECUTE ... FROM PUBLIC, anon`.
Steps: TDD on the JS mirror of the escaping rule (`src/lib/csv.js`, Task 6) is the test
surface; for the SQL, author + static assertions (grep-level) → commit.
Verify: the file contains `REVOKE EXECUTE ON FUNCTION public.get_archival_csv_chunk` and
`FROM PUBLIC, anon`, and the ORDER BY includes `id`.

### Task 3 — Jobs + artifacts metadata
Files: `sql/archival_export_jobs.sql` (new)
Produces: `public.archival_export_artifacts` (service-role only, RLS on with no policies),
`public.archival_export_jobs` (owner-select RLS), `public.archival_scope_fingerprint(text[])`.
Also `.gitignore` already updated for `.env.tools` / `.superpowers/`.
Verify: file is `CREATE TABLE IF NOT EXISTS` + idempotent `DROP POLICY IF EXISTS` +
`ENABLE ROW LEVEL SECURITY` on both tables; no `DELETE`/`TRUNCATE`/`DROP TABLE`.

### Task 4 — Export worker (Node, tracked)
Files: `tools/archival_export_worker.mjs` (new), `tools/archival_export_worker.test.mjs` (new)
Produces: `--snapshots` (global + per-duty-type) and `--jobs` (drain queue) modes; pure
helpers `buildObjectPath`, `scopeFingerprint`, `csvHeader`, `rowsToCsv`, `parseArgs`,
`artifactFilename`, `isSafePathSegment`.
Steps: write tests first (RED), implement (GREEN), run `node --test tools/`.
Verify: `node --test tools/` all pass; `node --check tools/archival_export_worker.mjs`.

### Task 5 — Authorized request endpoint
Files: `supabase/functions/request-archival-export/index.ts` (new)
Produces: authenticated request handler returning either
`{status:'ready', url, filename, expiresAt, rowCount}` for a matching current global
artifact, or `{status:'queued', jobId}`; rejects callers without `allow_reports`; never
trusts a client-supplied scope; never returns the service key.
Verify: static review + node-based lint of the TypeScript by transpiling the pure
`resolveRequest()` helper is out of scope (no deno) — assert with grep that no
`SERVICE_ROLE` literal is returned in a response body and that every response passes
through the auth check.

### Task 6 — Shared CSV escaping + client export module
Files: `src/lib/csv.js` (new), `src/lib/csv.test.js` (new),
`src/lib/archivalExport.js` (new), `src/lib/archivalExport.test.js` (new)
Produces: `csvEscapeCell` (RFC4180 quoting + formula neutralisation), `ARCHIVAL_COLUMNS`,
`buildCsv`, `archivalFilename`, `runArchivalExport({client, request, onProgress, fetchArtifact})`
with strategy order artifact → rpc → bounded client fallback, returning a structured result
rather than silent truncation.
Verify: `npm test -- --run src/lib/csv.test.js src/lib/archivalExport.test.js`.

### Task 7 — Wire the page to the module
Files: `src/pages/ReportsPage.jsx` (edit), `src/pages/ReportsPage.archival.test.jsx` (new)
Produces: `downloadArchivalCSV` delegates to `runArchivalExport`; queued state surfaced;
old `downloadViaRpc` / `downloadViaClient` blocks and the duplicated escaping removed.
Verify: `npm test` and `npm run build`.

### Task 8 — Docs and deploy runbook
Files: `CONTEXT.md` (edit), `docs/asms-archive-data-contract.md` (leave alone — different dataset)
Produces: §11 Archival export — artifact/job architecture, deploy order, verify steps,
retention note.

## Verification (whole plan)

`npm test` green, `npm run build` green, `node --test tools/` green, and every authored
SQL file greps clean of write statements. Nothing is executed against Supabase.

## Risks

- No runtime numbers exist: `pg_stat_statements` was not readable with the read-only
  account. `OFFSET` re-sorting is a static hypothesis; Task 1 exists to capture the
  baseline before anyone claims a speedup.
- Storage/egress cost and object retention need a human decision (PII).
- Until the user runs Tasks 1–3 SQL and creates the bucket, the live app uses the
  hardened RPC path only.
