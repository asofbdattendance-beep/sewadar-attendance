-- ============================================================================
-- archival_export_jobs.sql — export job queue + generated artifact metadata
-- ============================================================================
--
-- WHY THIS EXISTS
--   The archival download (public.archival_attendance, ~615k rows) is served
--   today by get_archival_csv_chunk() paged 100k rows at a time, or, when that
--   RPC is missing/slow, by a direct browser-side paged SELECT. Both re-do the
--   same work for every user, every time.
--
--   This file adds the *metadata* half of a better path:
--     * archival_export_artifacts — one row per generated CSV file in Storage.
--       A "global" artifact is one snapshot any elevated caller can reuse
--       (signed URL, no rebuild). A "centre" artifact is scoped to one
--       centre-set + optional duty/date filters.
--     * archival_export_jobs — the async queue. A scoped caller who cannot be
--       served by an existing artifact enqueues a job; the worker
--       (tools/archival_export_worker.mjs, service_role) drains it, writes the
--       CSV to Storage, and marks the job ready.
--
-- WHAT THIS FILE DOES *NOT* DO
--   No data changes, no inserts, no deletes, no bucket creation. It creates two
--   tables, one pure helper function, RLS policies and grants. The Storage
--   bucket is a separate, deliberate human step (see CONTEXT.md §11).
--
-- SAFE TO RE-RUN
--   Every object is CREATE ... IF NOT EXISTS or CREATE OR REPLACE, and every
--   policy is dropped before it is created.
--
-- ACCESS MODEL
--   archival_export_artifacts : service_role ONLY. RLS is enabled with NO
--                              policies, so anon/authenticated read zero rows
--                              even by accident; an explicit REVOKE removes the
--                              default Supabase grant as well.
--   archival_export_jobs      : owner-scoped. A user may SELECT their own jobs
--                              and INSERT their own job; nothing else. status
--                              transitions are performed by the worker running
--                              as service_role (which bypasses RLS).
--
-- HOW TO READ
--   Each § section is ONE self-contained statement. Expected results are in
--   comments above each one. Run the file in the Supabase SQL Editor as a
--   single script; it needs no other file.
--
-- VERIFY AFTER RUNNING
--   SELECT tablename, rowsecurity, forcerowsecurity
--     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--    WHERE n.nspname = 'public'
--      AND c.relname IN ('archival_export_jobs','archival_export_artifacts');
--   -- expect: both rowsecurity = true ; forcerowsecurity = false
--
--   SELECT policyname, cmd, roles, qual
--     FROM pg_policies WHERE schemaname = 'public'
--      AND tablename IN ('archival_export_jobs','archival_export_artifacts');
--   -- expect: exactly 2 rows, both on archival_export_jobs (SELECT, INSERT);
--   --         archival_export_artifacts has NO policies.
--
--   SELECT public.archival_scope_fingerprint(ARRAY['B','A','A',NULL,'']);
--   -- expect: '685d9b3124d3d6e4e6260e32506211d7'  ( = md5('A|B') )
--   --         sorted, de-duplicated, blanks dropped
--   SELECT public.archival_scope_fingerprint(ARRAY[]::TEXT[]);
--   -- expect: ''  (empty string, NOT md5('') = d41d8cd98f00b204e9800998ecf8427e)
--   SELECT public.archival_scope_fingerprint(ARRAY[NULL,'',' ']);
--   -- expect: ''  (every value whitespace-only, so the set is empty)
--   SELECT public.archival_scope_fingerprint(ARRAY[' A ']);
--   -- expect: '951196ca354c5c72b8356494f97c3b5d' ( = md5(' A ') );
--   --         values are joined raw, NOT trimmed
-- ============================================================================

-- §1 — artifacts metadata (service_role only) --------------------------------
-- One row per generated CSV object. is_current marks the row that requests
-- should be served from; superseded versions stay for audit until expiry.
-- The partial unique index allows exactly ONE current artifact per
-- (scope, duty_type, date_from, date_to, scope_fingerprint). NULLS NOT
-- DISTINCT (PG15+; live DB is PG17) is what makes the "no filter" rows
-- (duty_type/date_from/date_to all NULL) collide correctly.
CREATE TABLE IF NOT EXISTS public.archival_export_artifacts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope             TEXT NOT NULL CHECK (scope IN ('global', 'centre')),
  duty_type         TEXT CHECK (duty_type IS NULL OR duty_type IN ('D','JMC','JO','V','JH')),
  date_from         DATE,
  date_to           DATE,
  -- Which centres the artifact covers. NULL = "all centres the requester can
  -- see" for a global artifact; a concrete sorted list for a centre artifact.
  centre_scope      TEXT[],
  -- md5 of the sorted, de-duplicated centre set ('' when unscoped). SQL and JS
  -- must agree byte-for-byte — see archival_scope_fingerprint below.
  scope_fingerprint TEXT NOT NULL DEFAULT '',
  artifact_bucket   TEXT NOT NULL,
  artifact_path     TEXT NOT NULL,
  row_count         BIGINT NOT NULL DEFAULT 0,
  byte_size         BIGINT,
  content_sha256    TEXT,
  version           INT NOT NULL DEFAULT 1,
  is_current        BOOLEAN NOT NULL DEFAULT TRUE,
  generated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ,
  CONSTRAINT chk_archival_artifact_dates
    CHECK (date_from IS NULL OR date_to IS NULL OR date_from <= date_to)
);

ALTER TABLE public.archival_export_artifacts ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.archival_export_artifacts IS
  'Metadata for generated archival CSV objects in Storage. service_role only (RLS on, no policies).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_archival_artifact_current
  ON public.archival_export_artifacts
     (scope, duty_type, date_from, date_to, scope_fingerprint)
  NULLS NOT DISTINCT
  WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_archival_artifacts_generated
  ON public.archival_export_artifacts (generated_at DESC);

-- service_role only. Supabase grants ALL on new public tables to anon and
-- authenticated by default, so the REVOKE is load-bearing, not cosmetic.
REVOKE ALL ON public.archival_export_artifacts FROM anon, authenticated;
GRANT ALL ON public.archival_export_artifacts TO service_role;

-- §2 — job queue -------------------------------------------------------------
-- A user asks for (duty_type?, date range?, their centre scope). If a matching
-- current artifact exists the request is answered immediately and no job is
-- written; otherwise a row lands here in 'queued' and the worker picks it up.
CREATE TABLE IF NOT EXISTS public.archival_export_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requester_label   TEXT,
  duty_type         TEXT CHECK (duty_type IS NULL OR duty_type IN ('D','JMC','JO','V','JH')),
  date_from         DATE,
  date_to           DATE,
  -- Concrete sorted centre list the job is scoped to. NOT NULL in practice:
  -- the request endpoint resolves the caller's accessible centres server-side
  -- and never trusts a client-supplied scope.
  centre_scope      TEXT[],
  scope_fingerprint TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','processing','ready','failed','expired','canceled')),
  artifact_bucket   TEXT,
  artifact_path     TEXT,
  row_count         BIGINT,
  byte_size         BIGINT,
  content_sha256    TEXT,
  error_message     TEXT,
  attempts          INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  ready_at          TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  CONSTRAINT chk_archival_job_dates
    CHECK (date_from IS NULL OR date_to IS NULL OR date_from <= date_to)
);

ALTER TABLE public.archival_export_jobs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.archival_export_jobs IS
  'Async queue for archival CSV export jobs. Owner-scoped read/insert; worker (service_role) transitions status.';

CREATE INDEX IF NOT EXISTS idx_archival_jobs_queue
  ON public.archival_export_jobs (status, created_at)
  WHERE status IN ('queued', 'processing');

CREATE INDEX IF NOT EXISTS idx_archival_jobs_owner
  ON public.archival_export_jobs (requested_by, created_at DESC);

-- §3 — jobs RLS: owner-scoped, permission-gated ------------------------------
-- UPDATE/DELETE are deliberately absent: the worker owns status transitions and
-- runs as service_role (bypasses RLS). A user who could UPDATE their own job row
-- could forge status='ready' and a bogus artifact_path.

DROP POLICY IF EXISTS archival_jobs_select ON public.archival_export_jobs;
CREATE POLICY archival_jobs_select ON public.archival_export_jobs
  FOR SELECT TO authenticated
  USING (requested_by = (SELECT auth.uid()) AND public.has_permission('allow_reports'));

DROP POLICY IF EXISTS archival_jobs_insert ON public.archival_export_jobs;
CREATE POLICY archival_jobs_insert ON public.archival_export_jobs
  FOR INSERT TO authenticated
  WITH CHECK (requested_by = (SELECT auth.uid()) AND public.has_permission('allow_reports'));

REVOKE ALL ON public.archival_export_jobs FROM anon;
GRANT SELECT, INSERT ON public.archival_export_jobs TO authenticated;
GRANT ALL ON public.archival_export_jobs TO service_role;

-- §4 — scope fingerprint helper ----------------------------------------------
-- md5 over the sorted, de-duplicated centre set joined with '|'. Empty /
-- whitespace-only input returns '' (NOT md5('')) so "no scope" is
-- distinguishable and cheap to compare.
--
-- Two details exist purely so the JS twin (scopeFingerprint() in
-- tools/archival_export_worker.mjs) can be provably identical:
--   * `COLLATE "C"` — byte order, which is what JS Array#sort() does for ASCII.
--     The database default collation (en_US.UTF-8) is case-insensitive at the
--     primary level and would order a centre set differently from JS.
--   * the filter drops whitespace-only entries, matching JS `v.trim() === ''`.
-- Values themselves are joined RAW, untrimmed — ' A ' and 'A' are different
-- centres and must fingerprint differently.
CREATE OR REPLACE FUNCTION public.archival_scope_fingerprint(p_centres TEXT[])
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  WITH uniq AS (
    SELECT DISTINCT c COLLATE "C" AS c
      FROM pg_catalog.unnest(p_centres) AS c
     WHERE c IS NOT NULL AND c !~ '^[[:space:]]*$'
  ), joined AS (
    SELECT pg_catalog.array_to_string(
             ARRAY(SELECT c FROM uniq ORDER BY c), '|') AS s
  )
  SELECT CASE WHEN joined.s = '' THEN '' ELSE pg_catalog.md5(joined.s) END
    FROM joined;
$$;

COMMENT ON FUNCTION public.archival_scope_fingerprint(TEXT[]) IS
  'md5 of sorted unique non-blank centres joined by |, or '''' when empty. Must match scopeFingerprint() in tools/archival_export_worker.mjs.';

-- Pure function over caller-supplied input; still revoke the default PUBLIC
-- grant and hand EXECUTE only to the roles that need it.
REVOKE ALL ON FUNCTION public.archival_scope_fingerprint(TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archival_scope_fingerprint(TEXT[]) TO authenticated, service_role;
