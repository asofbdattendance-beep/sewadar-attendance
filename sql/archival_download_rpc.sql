-- ============================================================
-- archival_download_rpc.sql
--
-- PURPOSE
--   The archival_attendance table holds 600k+ rows (615,724 measured on the live
--   DB on 2026-10-18). Downloading the whole thing client-side via supabase-js
--   `.select()` is slow and hits Supabase's statement timeout (57014) because the
--   archival_read RLS policy runs the async get_user_accessible_centres() per row.
--
--   These functions build the CSV in Postgres (fast, no per-row RLS cost) and
--   return it in chunks. The frontend calls get_archival_csv_chunk() repeatedly
--   (chunk 0 includes the header row) until it gets a short/empty result, then
--   streams each chunk into the downloaded file.
--
--   >>> THIS IS THE FALLBACK PATH, NOT THE PRIMARY ONE. <<<
--   Primary delivery is a pre-generated snapshot in private Storage served via a
--   short-lived signed URL (see sql/archival_export_jobs.sql and
--   tools/archival_export_worker.mjs). This RPC remains because it is the only
--   path that works before that infrastructure is deployed.
--
-- HARDENING CHANGES (this revision)
--   H1  EXECUTE is REVOKED from PUBLIC and anon. Postgres grants EXECUTE to PUBLIC
--       on every new function, and the previous revision's explicit `GRANT ... TO
--       authenticated` did NOT take that back — the live database confirmed anon
--       could execute a SECURITY DEFINER function that aggregates the whole
--       archive. The permission check inside the body made anon return no rows,
--       but a publicly callable, unbounded CPU surface is not something to leave
--       open on a shared database.
--   H2  p_limit is CLAMPED to 1..100000. It was caller-supplied and unbounded, so
--       a caller could ask for the entire 615k-row archive in one response.
--   H3  p_chunk is validated (NULL or negative -> empty string). A negative chunk
--       produced a negative OFFSET, which Postgres rejects or silently misreads
--       depending on version.
--   H4  The ORDER BY is now fully deterministic: (duty_date DESC, sewadar_name ASC,
--       id ASC). Without the `id` tie-breaker, two rows sharing a date and a name
--       have no stable order across queries, so offset pagination can DUPLICATE one
--       row into two chunks and DROP another entirely. A silent data-integrity bug
--       in a download that people reconcile against a spreadsheet.
--   H5  csv_field() neutralises spreadsheet formula injection. A cell beginning
--       `=`, `+`, `-`, `@`, TAB or CR is prefixed with an apostrophe so Excel /
--       Sheets / LibreOffice treat it as text. Names and department fields in this
--       dataset are free text captured over years; a leading `=` opens a CSV in
--       Excel as a live formula.
--   H6  p_from > p_to returns an empty string rather than an arbitrary slice.
--
--   NOTE ON H5: src/lib/csv.js is the MIRROR of this rule for the browser fallback
--   and the Node worker, and it is the implementation that has unit tests.
--   src/lib/csv.test.js asserts that this file's character class matches it, so the
--   two cannot drift apart silently.
--
--   Run the whole file in the Supabase SQL Editor. Every statement is idempotent
--   (CREATE OR REPLACE / IF NOT EXISTS / REVOKE + GRANT re-applied).
--
-- USAGE (in ReportsPage.jsx, via src/lib/archivalExport.js):
--   supabase.rpc('get_archival_csv_chunk', {
--     p_chunk, p_duty_type, p_from, p_to, p_limit
--   })  -> TEXT (empty string == no more rows / no access)
-- ============================================================

-- NULL-safe CSV field: RFC4180 double-quote escaping AND spreadsheet-formula
-- neutralisation. Order matters — the apostrophe guard is applied first, then the
-- value is quoted, so the guard character lives INSIDE the quoted field where a
-- spreadsheet reads it as "treat as text".
CREATE OR REPLACE FUNCTION public.csv_field(t TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN v.s IS NULL OR v.s = '' THEN ''
    WHEN v.s ~ '[",\n\r]'        THEN '"' || replace(v.s, '"', '""') || '"'
    ELSE v.s
  END
  FROM (
    SELECT CASE
             -- leading formula / control characters -> literal text
             WHEN t IS NULL             THEN NULL
             WHEN t ~ '^[=+@\t\r-]'     THEN '''' || t
             ELSE t
           END AS s
  ) v
$$;

-- Header string (must match the field order built in the chunk function).
-- Kept in SQL as the single source of truth; src/lib/csv.js mirrors it for the
-- paths that never touch the database.
CREATE OR REPLACE FUNCTION public.archival_csv_header()
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT 'Sewadar Name,Badge Number,Father/Husband Name,gender,age,Department Name,Department Id,Area Name,Centre Name,Status,Duty Type,Duty Date,Deployed Department,Deployed Centre'
$$;

-- Return one chunk (default 100000 rows) of the archival CSV as TEXT.
-- Chunk 0 includes the header row. SECURITY DEFINER bypasses RLS, but the caller
-- is still scoped to their accessible centres via get_user_accessible_centres()
-- and must have allow_reports permission.
-- Returns '' when the caller has no access, the range is inverted, or p_chunk is
-- past the end.
CREATE OR REPLACE FUNCTION public.get_archival_csv_chunk(
  p_chunk INT,
  p_duty_type TEXT DEFAULT NULL,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_limit INT DEFAULT 100000
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_csv   TEXT;
  v_limit INT;
BEGIN
  -- H3: a chunk index must be a real, non-negative page number.
  IF p_chunk IS NULL OR p_chunk < 0 THEN
    RETURN '';
  END IF;

  -- H2: never let the caller widen the response beyond one bounded page.
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 100000), 1), 100000);

  -- H6: an inverted range is an empty result, not an arbitrary slice.
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    RETURN '';
  END IF;

  -- Permission gate: mirrors archival_read RLS
  IF NOT public.has_permission('allow_reports') THEN
    RETURN '';
  END IF;

  -- Fast exit if user has no accessible centres (e.g. centre is null)
  IF NOT EXISTS (SELECT 1 FROM public.get_user_accessible_centres() LIMIT 1) THEN
    RETURN '';
  END IF;

  SELECT string_agg(s.line, E'\n' ORDER BY s.sn)
  INTO v_csv
  FROM (
    SELECT
      -- H4: id is the tie-breaker that makes OFFSET pagination loss-free.
      row_number() OVER (ORDER BY duty_date DESC, sewadar_name ASC, id ASC) AS sn,
      (
        public.csv_field(sewadar_name) || ',' ||
        public.csv_field(badge_number) || ',' ||
        public.csv_field(father_husband_name) || ',' ||
        public.csv_field(gender) || ',' ||
        public.csv_field(age::text) || ',' ||
        public.csv_field(department_name) || ',' ||
        public.csv_field(department_id::text) || ',' ||
        public.csv_field(area_name) || ',' ||
        public.csv_field(centre_name) || ',' ||
        public.csv_field(status) || ',' ||
        public.csv_field(duty_type) || ',' ||
        public.csv_field(to_char(duty_date, 'DD-MM-YYYY')) || ',' ||
        public.csv_field(deployed_department) || ',' ||
        public.csv_field(deployed_centre)
      ) AS line
    FROM public.archival_attendance
    WHERE centre_name IN (SELECT centre_name FROM public.get_user_accessible_centres())
      AND (p_duty_type IS NULL OR duty_type = p_duty_type)
      AND (p_from IS NULL OR duty_date >= p_from)
      AND (p_to IS NULL OR duty_date <= p_to)
    ORDER BY duty_date DESC, sewadar_name ASC, id ASC
    -- ::bigint — p_chunk * v_limit overflows int4 well before it exhausts the
    -- table, and an OFFSET overflow raises instead of returning an empty page.
    OFFSET (p_chunk::bigint * v_limit)
    LIMIT v_limit
  ) s;

  IF v_csv IS NULL OR v_csv = '' THEN
    RETURN '';
  END IF;

  IF p_chunk = 0 THEN
    RETURN public.archival_csv_header() || E'\n' || v_csv;
  END IF;

  RETURN v_csv;
END;
$$;

-- ============================================================
-- ORDERING INDEX
-- ============================================================
-- The default ordering is (duty_date DESC, sewadar_name ASC, id ASC). The live
-- table has idx_archival_duty_date_name (duty_date DESC, sewadar_name ASC) without
-- the id tie-breaker, so the planner must sort to produce a stable total order.
-- This index makes the ordered scan and every OFFSET page read the index in order
-- instead of re-sorting the scoped set per chunk.
--
-- Plain CREATE INDEX (not CONCURRENTLY): the SQL Editor runs a pasted file as one
-- transaction, and CREATE INDEX CONCURRENTLY cannot run inside one. Expect a brief
-- write lock while the index builds. ~615k rows on a 135 MB table; expect seconds,
-- not minutes. Safe to run once; IF NOT EXISTS makes a re-run a no-op.
CREATE INDEX IF NOT EXISTS idx_archival_export_order
  ON public.archival_attendance (duty_date DESC, sewadar_name ASC, id ASC);

-- ============================================================
-- PRIVILEGES  (H1)
-- ============================================================
-- REVOKE ... FROM PUBLIC must run BEFORE the GRANTs, and is not optional: every
-- new function is EXECUTE-granted to PUBLIC by default, and `anon` inherits from
-- PUBLIC. The previous revision granted to `authenticated` without revoking, which
-- left the function callable by an unauthenticated client.
--
-- `service_role` keeps EXECUTE because it is the server-side role and the worker
-- (tools/archival_export_worker.mjs) may reasonably reuse the RPC. It never
-- appears in a client bundle.
REVOKE ALL ON FUNCTION public.csv_field(TEXT)                                    FROM PUBLIC;
REVOKE ALL ON FUNCTION public.archival_csv_header()                              FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_archival_csv_chunk(INT, TEXT, DATE, DATE, INT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.csv_field(TEXT)                                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.archival_csv_header()                              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_archival_csv_chunk(INT, TEXT, DATE, DATE, INT) TO authenticated, service_role;

-- ============================================================
-- VERIFY AFTER RUNNING  (read the output, do not assume)
-- ============================================================
-- Expect: anon_can_execute = false, authenticated_can_execute = true,
--         acl_is_open_to_public = false for all three rows.
--
-- SELECT f.proname,
--        has_function_privilege('anon',          f.oid, 'EXECUTE') AS anon_can_execute,
--        has_function_privilege('authenticated', f.oid, 'EXECUTE') AS authenticated_can_execute,
--        (f.proacl IS NULL OR f.proacl::text ~ '(^|,)=X/')         AS acl_is_open_to_public
-- FROM pg_proc f JOIN pg_namespace n ON n.oid = f.pronamespace
-- WHERE n.nspname = 'public'
--   AND f.proname IN ('get_archival_csv_chunk', 'csv_field', 'archival_csv_header');
--
-- Expect: the guard character appears on a formula-shaped input.
-- SELECT public.csv_field('=2+2')   AS guarded_formula,   -- '=2+2   (leading apostrophe)
--        public.csv_field('-BAD')   AS guarded_minus,     -- '-BAD
--        public.csv_field('a,b')    AS quoted_comma,      -- "a,b"
--        public.csv_field(NULL)     AS null_is_empty;     -- (empty)
