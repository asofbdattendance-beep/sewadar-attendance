-- ============================================================================
--  ARCHIVAL EXPORT — BASELINE + VERIFICATION  (READ-ONLY)
-- ============================================================================
--  Answers one question before anyone touches the export path: what is actually
--  deployed, and how big is it. Every statement below READS. There is no INSERT,
--  UPDATE, DELETE, DDL, GRANT or REVOKE anywhere in this file — a few facts
--  (row counts, byte sizes, effective privileges) can only be seen from inside
--  the database that owns them, so this file is how the operator reads them.
--
--  >>> PASTE INTO THE SUPABASE SQL EDITOR AS THE OWNER ROLE. <<<
--  RLS is scoped to the RUNNER. The read-only reporting account used during
--  design has `rolbypassrls`, so its numbers are whole-table. A centre-scoped
--  role sees only its own centre tree, which is a different (correct) answer.
--  §0 proves which case you are in; read §0 before trusting anything below.
--
--  HOW TO READ
--    - Every section is ONE self-contained statement. Run them in any order,
--      individually, and repeatedly; nothing is shared between statements.
--    - A check that returns ZERO ROWS is a PASS only if the statement actually
--      EXECUTED. Some clients render "no rows" for a failed statement too.
--
--  SECTION MAP
--    §0  role + visibility probe
--    §1  archive shape      — rows, centres, duty types, date span
--    §2  physical size      — table and index bytes
--    §3  RLS + grants       — is the read policy what we think it is
--    §4  export RPC         — does it exist, is it hardenable, who may execute it
--    §5  baseline capture   — the numbers to record before optimising anything
-- ============================================================================


-- ============================================================================
--  §0.  ROLE AND VISIBILITY PROBE  —  read this first
-- ============================================================================
-- EXPECTED (owner / read-only inspector): archival_visible ≈ 615724.
-- EXPECTED (centre-scoped role):         archival_visible = that role's own slice.
-- If you expected the whole table and got a small number, stop: every later
-- section is measuring that role's slice, not the database.
SELECT '0. role probe'                        AS check_name,
       current_user                            AS current_user,
       session_user                            AS session_user,
       (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypasses_rls,
       (SELECT count(*) FROM public.archival_attendance) AS archival_visible;


-- ============================================================================
--  §1.  ARCHIVE SHAPE
-- ============================================================================
-- EXPECTED: rows_total > 0, centres > 0, null_or_blank_centre = 0,
--           duty_types = 5, oldest = 2024-01-01, newest = the latest load date.
-- A null/blank centre is an information leak waiting to happen: the RLS predicate
-- is `centre_name IN (...)`, so a NULL centre is invisible rather than exposed.
-- It is still worth knowing about, because it silently vanishes from every export.
SELECT '1. shape'                             AS check_name,
       count(*)                               AS rows_total,
       count(DISTINCT centre_name)            AS centres,
       count(*) FILTER (WHERE centre_name IS NULL OR btrim(centre_name) = '')
                                              AS null_or_blank_centre,
       count(DISTINCT duty_type)              AS duty_types,
       min(duty_date)                         AS oldest_duty_date,
       max(duty_date)                         AS newest_duty_date,
       count(*) FILTER (WHERE duty_date IS NULL) AS null_duty_date
FROM public.archival_attendance;


-- ============================================================================
--  §1b.  DUTY-TYPE BREAKDOWN
-- ============================================================================
-- EXPECTED: exactly the five canonical codes D, JMC, JO, V, JH — no strays.
-- The table CHECK constraint allows only those five, so a stray code here would
-- mean the constraint is missing on the deployed table.
SELECT '1b. duty types'                       AS check_name,
       duty_type,
       count(*)                               AS rows
FROM public.archival_attendance
GROUP BY duty_type
ORDER BY rows DESC;


-- ============================================================================
--  §2.  PHYSICAL SIZE
-- ============================================================================
-- EXPECTED: table_bytes ≈ 60–80 MB, indexes ≈ 55–75 MB, indexes_total ≈ 135 MB.
-- NOTE: these are the ON-DISK numbers. They are NOT the CSV download size and
-- must never be quoted as such — the CSV is narrower than the row store.
-- reltuples is the planner's estimate and is null/frozen on a freshly loaded or
-- never-analysed table; rows_exact below is the authority.
SELECT '2. size'                              AS check_name,
       pg_size_pretty(pg_total_relation_size('public.archival_attendance')) AS table_total,
       pg_size_pretty(pg_relation_size('public.archival_attendance'))       AS table_heap,
       pg_size_pretty(pg_indexes_size('public.archival_attendance'))        AS indexes_total,
       (SELECT reltuples::bigint FROM pg_class WHERE oid = 'public.archival_attendance'::regclass) AS planner_estimate_rows,
       (SELECT count(*) FROM public.archival_attendance)                    AS rows_exact;


-- ============================================================================
--  §3.  RLS AND TABLE GRANTS
-- ============================================================================
-- 3a. Is RLS on, and is there exactly the one read policy we expect?
-- EXPECTED: relrowsecurity = true, relforcerowsecurity = false (fine — the owner
-- and any rolbypassrls role bypass it; app roles do not), one row named
-- `archival_read`, cmd = SELECT, roles = {authenticated}.
SELECT '3a. rls policy'                       AS check_name,
       c.relrowsecurity                       AS rls_enabled,
       c.relforcerowsecurity                  AS rls_forced,
       p.policyname,
       p.cmd,
       p.roles::text                          AS applies_to,
       p.qual                                 AS using_predicate
FROM pg_class c
LEFT JOIN pg_policies p
       ON p.schemaname = 'public'
      AND p.tablename = 'archival_attendance'
WHERE c.oid = 'public.archival_attendance'::regclass;


-- ============================================================================
--  §3b.  TABLE-LEVEL PRIVILEGES
-- ============================================================================
-- EXPECTED: anon and authenticated hold SELECT only. If anon ever holds anything
-- beyond SELECT (or a future INSERT/UPDATE grant lands), that is a finding: the
-- archive is a read-only, PII-bearing dataset.
SELECT '3b. table grants'                     AS check_name,
       grantee,
       string_agg(DISTINCT privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name   = 'archival_attendance'
GROUP BY grantee
ORDER BY grantee;


-- ============================================================================
--  §4.  EXPORT RPC(S)
-- ============================================================================
-- 4a. Function facts. EXPECTED after sql/archival_download_rpc.sql is re-run:
--     prosecdef = true (it must bypass RLS to aggregate cheaply — that is the
--     whole point), vol volatility, and proconfig carrying `search_path=''`.
SELECT '4a. rpc facts'                        AS check_name,
       p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       p.prosecdef                            AS security_definer,
       p.provolatile                          AS volatility,
       p.proconfig::text                      AS function_config
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('get_archival_csv_chunk', 'csv_field', 'archival_csv_header')
ORDER BY p.proname;


-- ============================================================================
--  §4b.  EFFECTIVE EXECUTE PRIVILEGES  —  the finding that matters most
-- ============================================================================
-- EXPECTED after the hardening migration:
--     anon          = false   <-- this is the whole point of the migration
--     authenticated = true
-- Postgres grants EXECUTE to PUBLIC on every new function. An explicit GRANT to
-- `authenticated` does NOT take that back, which is exactly how the live function
-- ended up callable by anon. acl_is_open_to_public below is the tell: `=X/` in a
-- proacl string means PUBLIC. If it is true, the REVOKE did not take.
SELECT '4b. rpc execute'                      AS check_name,
       f.proname,
       has_function_privilege('anon',          f.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', f.oid, 'EXECUTE') AS authenticated_can_execute,
       (f.proacl IS NULL OR f.proacl::text ~ '(^|,)=X/')         AS acl_is_open_to_public
FROM pg_proc f
JOIN pg_namespace n ON n.oid = f.pronamespace
WHERE n.nspname = 'public'
  AND f.proname IN ('get_archival_csv_chunk', 'csv_field', 'archival_csv_header')
ORDER BY f.proname;


-- ============================================================================
--  §5.  BASELINE CAPTURE  —  record these numbers BEFORE optimising
-- ============================================================================
-- There is no measured download latency for this feature anywhere. Do not accept
-- a speed-up claim that is not compared against a number captured here.
--
-- 1. Run §1–§4 above and paste the output into the change record.
-- 2. In the app, as an ASO login, time ONE combined archival download:
--       metric     = wall-clock time from click to "saved file"
--       statistic  = report the single cold run AND a second warm run
--       load       = one real user, production data, no other download running
--       record     = seconds, the served path it used (RPC vs fallback), and the
--                    on-disk CSV size in MB
-- 3. Repeat for one duty-type filtered export and one centre-scoped export.
-- 4. CSV size read at the filesystem, NOT from §2. They measure different things.
--
-- pg_stat_statements would give per-statement timings, but reading it requires
-- membership in pg_read_all_stats, which the design-time read-only account did
-- not have. If the owner role has it, this is the cheapest way to see whether the
-- chunked RPC's OFFSET is actually the cost centre:
--
--   SELECT calls, round(total_exec_time::numeric, 1) AS total_ms,
--          round(mean_exec_time::numeric, 1)         AS mean_ms,
--          rows, left(query, 90) AS query
--   FROM pg_stat_statements
--   WHERE query ILIKE '%archival_attendance%'
--   ORDER BY total_exec_time DESC
--   LIMIT 20;
--
-- (Enable first with: CREATE EXTENSION IF NOT EXISTS pg_stat_statements; —
--  that is DDL and is deliberately NOT part of this read-only file.)
SELECT '5. baseline'                          AS check_name,
       'record timings + CSV byte sizes by hand (see comments above)' AS instruction;
