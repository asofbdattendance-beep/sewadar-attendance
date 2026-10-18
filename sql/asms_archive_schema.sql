-- ============================================================================
--  ASMS ARCHIVE — SCHEMA  (ADDITIVE ONLY)
-- ============================================================================
--  CREATES
--    public.attendance_sessions_archive      (mirror of attendance_sessions)
--    public.jatha_attendance_archive         (mirror of jatha_attendance)
--
--  DOES NOT TOUCH   (no DROP, no DELETE, no UPDATE, no TRUNCATE on anything live)
--    public.attendance_sessions, public.jatha_attendance,
--    public.archival_attendance (a DIFFERENT dataset — see
--    docs/asms-archive-data-contract.md §3.1), or any existing policy, index,
--    trigger, function or row.
--
--  WHY `LIKE ... INCLUDING DEFAULTS`
--    The deployed database — not this repo — is the authority for column lists:
--    this repo's SQL is not applied by CI, and there is no CURRENT CREATE TABLE
--    for jatha_attendance anywhere in it. An April-era one survives in git at
--    fc42c48:sql/database_structure.txt with a DIFFERENT shape (date_from/date_to,
--    submitted_by/submitted_name/submitted_centre, created_at, plus centre,
--    department, jatha_type, jatha_centre, jatha_dept, satsang_days, flag,
--    flag_reason) — direct evidence the table has been renamed and restructured
--    before. Treat every column list in this repo as a guess.
--    `LIKE` copies the live columns, types, NOT NULLs and defaults exactly, so the
--    archive cannot drift from its source and no type has to be guessed.
--    `LIKE` copies NO primary key, NO foreign key, NO index, NO trigger and NO
--    RLS — every one of those is added explicitly below.
--
--  SAFE TO RE-RUN. Every statement is individually idempotent. Run the file WHOLE,
--  in one transaction, as it is written — the guard in §0 and the mirrors in §1/§2
--  depend on the file's own ordering.
--
--  RUN ORDER
--    1) THIS FILE
--    2) asms_archive_preflight.sql   (read-only dry run — RECORD ITS OUTPUT)
--    3) asms_archive_backfill.sql    (the copy)
--    4) verify_asms_archive.sql      (the checks)
--
--  ROLLBACK — describes the two NEW tables only, never a source table.
--  Not executable as written (it lives in a comment block on purpose):
--      DROP TABLE IF EXISTS public.attendance_sessions_archive;
--      DROP TABLE IF EXISTS public.jatha_attendance_archive;
-- ============================================================================


-- ============================================================================
--  0.  PRECONDITIONS
-- ============================================================================
-- Fail loudly here rather than with an opaque 42P01 further down. The SQL Editor
-- runs this file as one transaction, so an error at the jatha mirror would
-- otherwise roll back a perfectly good attendance_sessions mirror with it.
DO $$
BEGIN
  IF to_regclass('public.attendance_sessions') IS NULL THEN
    RAISE EXCEPTION
      'public.attendance_sessions does not exist. Wrong project, or the source is gone. Nothing was changed.';
  END IF;
  IF to_regclass('public.jatha_attendance') IS NULL THEN
    RAISE EXCEPTION
      'public.jatha_attendance does not exist. Wrong project, or the source is gone. Nothing was changed.';
  END IF;
END $$;


-- ============================================================================
--  1.  attendance_sessions_archive
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.attendance_sessions_archive
  (LIKE public.attendance_sessions INCLUDING DEFAULTS);

-- GUARD: `CREATE TABLE IF NOT EXISTS` emits a NOTICE and then proceeds REGARDLESS
-- of the existing table's shape. If this table already exists from an earlier
-- partial run against a different source shape, every index, policy and
-- ON CONFLICT below would be built on a lie — so assert the mirror property
-- BEFORE adding anything.
--
-- This guard is also what protects the positional insert in
-- asms_archive_backfill.sql: a column-COUNT check alone cannot see a REORDER, and
-- rls_policies_all.sql:811-814 routinely reorders this very source
-- (`ALTER TABLE ... DROP COLUMN IF EXISTS sewadar_centre; ADD COLUMN
-- sewadar_centre TEXT;` — ADD COLUMN always appends, so those land at the end
-- while the count stays 24). Names in order, not just a number.
DO $$
DECLARE
  v_src  TEXT[];
  v_arch TEXT[];
  n_src  INT;
  n_arch INT;
BEGIN
  SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_src
  FROM pg_attribute a
  WHERE a.attrelid = to_regclass('public.attendance_sessions')
    AND a.attnum > 0 AND NOT a.attisdropped;

  SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_arch
  FROM pg_attribute a
  WHERE a.attrelid = to_regclass('public.attendance_sessions_archive')
    AND a.attnum > 0 AND NOT a.attisdropped;

  n_src  := array_length(v_src, 1);
  n_arch := array_length(v_arch, 1);

  IF v_arch[1:n_src] IS DISTINCT FROM v_src THEN
    RAISE EXCEPTION
      'attendance_sessions_archive exists but does not mirror attendance_sessions. Source columns: %. Archive columns: %. A reorder or a stale shape would silently mis-map the copy. DROP the archive table and re-run this file. Nothing was changed.',
      v_src, v_arch;
  END IF;

  IF n_arch <> n_src AND n_arch <> n_src + 4 THEN
    RAISE EXCEPTION
      'attendance_sessions_archive has % columns; expected % (freshly created, before the 4 archive columns) or % (already migrated). Partial state — DROP the archive table and re-run. Nothing was changed.',
      n_arch, n_src, n_src + 4;
  END IF;
END $$;

-- The archive must NEVER draw a value from the live identity/sequence.
-- An identity column has no pg_attrdef row, so this is a no-op there; it is
-- load-bearing only when the deployed source predates attendance_sessions_schema.sql
-- and `id` is a legacy BIGSERIAL, where INCLUDING DEFAULTS would copy
-- nextval('attendance_sessions_id_seq') — a FUNCTIONAL LINKAGE to the live
-- sequence. Do not delete this block as dead code.
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
  FROM pg_attrdef d
  JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
  WHERE d.adrelid = 'public.attendance_sessions_archive'::regclass
    AND a.attname  = 'id';

  IF v_def IS NOT NULL THEN
    ALTER TABLE public.attendance_sessions_archive ALTER COLUMN id DROP DEFAULT;
    RAISE NOTICE 'attendance_sessions_archive: dropped inherited id default (%)', v_def;
  END IF;
END $$;

-- Archive-only columns. ORDER MATTERS: asms_archive_backfill.sql inserts
-- positionally as `s.*, now(), current_user, v_batch, '<source>'`, so these four
-- must be appended in exactly this order.
-- source_table deliberately has NO DEFAULT: a provenance tag with a default is a
-- type-compatible landing pad, so a shifted positional insert would land a value
-- there and still look self-consistent. Without a default such a shift raises
-- 23502 instead. The CHECK added below narrows it further.
ALTER TABLE public.attendance_sessions_archive
  ADD COLUMN IF NOT EXISTS archived_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS archived_by   TEXT,
  ADD COLUMN IF NOT EXISTS archive_batch TEXT,
  ADD COLUMN IF NOT EXISTS source_table  TEXT NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.attendance_sessions_archive'::regclass
      AND conname  = 'asms_sess_arch_source_table_chk'
  ) THEN
    ALTER TABLE public.attendance_sessions_archive
      ADD CONSTRAINT asms_sess_arch_source_table_chk
      CHECK (source_table = 'attendance_sessions');
  END IF;
END $$;

-- Primary key = the SOURCE id, copied verbatim and never reused. That is what
-- makes the copy idempotent (ON CONFLICT (id) DO NOTHING) and reconciliation a
-- plain id join. Assert the PK is on `id` specifically: a PK on any other column
-- would satisfy a bare "has a primary key" test and then break the backfill with
-- 42P10 "no unique or exclusion constraint matching the ON CONFLICT".
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.attendance_sessions_archive'::regclass
    AND c.contype  = 'p';

  IF v_def IS NULL THEN
    ALTER TABLE public.attendance_sessions_archive
      ADD CONSTRAINT attendance_sessions_archive_pkey PRIMARY KEY (id);
  ELSIF v_def <> 'PRIMARY KEY (id)' THEN
    RAISE EXCEPTION
      'attendance_sessions_archive primary key is "%", not "PRIMARY KEY (id)". ON CONFLICT (id) would fail. Fix the constraint first. Nothing was changed.',
      v_def;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sess_arch_in_date   ON public.attendance_sessions_archive (in_date DESC);
CREATE INDEX IF NOT EXISTS idx_sess_arch_centre    ON public.attendance_sessions_archive (centre);
CREATE INDEX IF NOT EXISTS idx_sess_arch_badge     ON public.attendance_sessions_archive (badge_number);
CREATE INDEX IF NOT EXISTS idx_sess_arch_duty      ON public.attendance_sessions_archive (duty_type);
CREATE INDEX IF NOT EXISTS idx_sess_arch_centre_dt ON public.attendance_sessions_archive (centre, in_date DESC);
CREATE INDEX IF NOT EXISTS idx_sess_arch_batch     ON public.attendance_sessions_archive (archive_batch);

-- Read-only, two ways: (1) no INSERT/UPDATE/DELETE policy exists, so RLS denies
-- every write; (2) the privileges themselves carry no write bit, so dropping RLS
-- later does not silently grant write access.
--
-- The permission gate is the UNION of the live table's gates (sessions_read:
-- allow_dashboard|records|scan|gate_entry) plus allow_reports. Taking the union
-- means no role that can see a row live loses it in the archive — the archive is
-- never narrower than the table it mirrors. Row scoping is unchanged: the centre
-- axis, plus the same sc_sp_user scanner-centre restriction as the live policy.
ALTER TABLE public.attendance_sessions_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sessions_archive_read ON public.attendance_sessions_archive;
CREATE POLICY sessions_archive_read ON public.attendance_sessions_archive
  FOR SELECT TO authenticated
  USING (
    (public.has_permission('allow_dashboard')
      OR public.has_permission('allow_records')
      OR public.has_permission('allow_scan')
      OR public.has_permission('allow_gate_entry')
      OR public.has_permission('allow_reports'))
    AND (
      centre IN (SELECT public.get_user_accessible_centres())
      OR badge_number IN (
        SELECT badge_number FROM public.sewadars
        WHERE centre IN (SELECT public.get_user_accessible_centres())
      )
    )
    AND (
      public.get_user_role() != 'sc_sp_user'
      OR in_scanner_centre = (SELECT centre FROM public.users WHERE auth_id = auth.uid())
    )
  );

-- RLS governs ROWS; privileges govern REACHABILITY. A new table does not
-- necessarily inherit whatever default privileges make archival_attendance
-- reachable, so GRANT explicitly — and REVOKE first so the grant is the only
-- thing this table carries, whatever the project's ALTER DEFAULT PRIVILEGES say.
REVOKE ALL ON public.attendance_sessions_archive FROM anon, authenticated;
GRANT SELECT ON public.attendance_sessions_archive TO authenticated;


-- ============================================================================
--  2.  jatha_attendance_archive
-- ============================================================================
-- Unlike the sessions mirror, the columns this repo's SQL later references on
-- jatha_attendance are NOT guaranteed: the table was restructured before under
-- different names (fc42c48). Assert them here, so a mismatch fails with a clear
-- message instead of an obscure error from the first index below.
DO $$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT string_agg(x.n, ', ') INTO v_missing
  FROM (VALUES ('from_date'), ('to_date'), ('sewadar_centre'),
               ('badge_number'), ('jatha_id')) AS x(n)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    WHERE a.attrelid = 'public.jatha_attendance'::regclass
      AND a.attname  = x.n AND a.attnum > 0 AND NOT a.attisdropped
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'jatha_attendance is missing expected column(s): %. This repo''s SQL references them (CONTEXT.md, rls_policies_all.sql, asms_archive_preflight.sql). Reconcile the deployed table before archiving. Nothing was changed.',
      v_missing;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.jatha_attendance_archive
  (LIKE public.jatha_attendance INCLUDING DEFAULTS);

-- Same mirror guard as §1. See the comment there for why a count is not enough.
DO $$
DECLARE
  v_src  TEXT[];
  v_arch TEXT[];
  n_src  INT;
  n_arch INT;
BEGIN
  SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_src
  FROM pg_attribute a
  WHERE a.attrelid = to_regclass('public.jatha_attendance')
    AND a.attnum > 0 AND NOT a.attisdropped;

  SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_arch
  FROM pg_attribute a
  WHERE a.attrelid = to_regclass('public.jatha_attendance_archive')
    AND a.attnum > 0 AND NOT a.attisdropped;

  n_src  := array_length(v_src, 1);
  n_arch := array_length(v_arch, 1);

  IF v_arch[1:n_src] IS DISTINCT FROM v_src THEN
    RAISE EXCEPTION
      'jatha_attendance_archive exists but does not mirror jatha_attendance. Source columns: %. Archive columns: %. DROP the archive table and re-run this file. Nothing was changed.',
      v_src, v_arch;
  END IF;

  IF n_arch <> n_src AND n_arch <> n_src + 4 THEN
    RAISE EXCEPTION
      'jatha_attendance_archive has % columns; expected % (freshly created) or % (already migrated). Partial state — DROP the archive table and re-run. Nothing was changed.',
      n_arch, n_src, n_src + 4;
  END IF;
END $$;

DO $$
DECLARE
  v_def TEXT;
BEGIN
  -- Same nextval-linkage reasoning as §1 (a legacy BIGSERIAL/nextval default).
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
  FROM pg_attrdef d
  JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
  WHERE d.adrelid = 'public.jatha_attendance_archive'::regclass
    AND a.attname  = 'id';

  IF v_def IS NOT NULL THEN
    ALTER TABLE public.jatha_attendance_archive ALTER COLUMN id DROP DEFAULT;
    RAISE NOTICE 'jatha_attendance_archive: dropped inherited id default (%)', v_def;
  END IF;

  -- Any OTHER inherited default is reported, not assumed. The backfill supplies
  -- every source column explicitly, so a default can never fire — but say so
  -- out loud rather than leaving it implied.
  FOR v_def IN
    SELECT a.attname::text || ' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid)
    FROM pg_attrdef d
    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
    WHERE d.adrelid = 'public.jatha_attendance_archive'::regclass
      AND a.attname <> 'archived_at'
  LOOP
    RAISE NOTICE 'jatha_attendance_archive: inherited default — % (source value is supplied explicitly)', v_def;
  END LOOP;
END $$;

ALTER TABLE public.jatha_attendance_archive
  ADD COLUMN IF NOT EXISTS archived_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS archived_by   TEXT,
  ADD COLUMN IF NOT EXISTS archive_batch TEXT,
  ADD COLUMN IF NOT EXISTS source_table  TEXT NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.jatha_attendance_archive'::regclass
      AND conname  = 'asms_jatha_arch_source_table_chk'
  ) THEN
    ALTER TABLE public.jatha_attendance_archive
      ADD CONSTRAINT asms_jatha_arch_source_table_chk
      CHECK (source_table = 'jatha_attendance');
  END IF;
END $$;

DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def
  FROM pg_constraint c
  WHERE c.conrelid = 'public.jatha_attendance_archive'::regclass
    AND c.contype  = 'p';

  IF v_def IS NULL THEN
    ALTER TABLE public.jatha_attendance_archive
      ADD CONSTRAINT jatha_attendance_archive_pkey PRIMARY KEY (id);
  ELSIF v_def <> 'PRIMARY KEY (id)' THEN
    RAISE EXCEPTION
      'jatha_attendance_archive primary key is "%", not "PRIMARY KEY (id)". ON CONFLICT (id) would fail. Fix the constraint first. Nothing was changed.',
      v_def;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_jatha_arch_from_date ON public.jatha_attendance_archive (from_date DESC);
CREATE INDEX IF NOT EXISTS idx_jatha_arch_to_date   ON public.jatha_attendance_archive (to_date DESC);
CREATE INDEX IF NOT EXISTS idx_jatha_arch_centre    ON public.jatha_attendance_archive (sewadar_centre);
CREATE INDEX IF NOT EXISTS idx_jatha_arch_badge     ON public.jatha_attendance_archive (badge_number);
CREATE INDEX IF NOT EXISTS idx_jatha_arch_jatha_id  ON public.jatha_attendance_archive (jatha_id);
CREATE INDEX IF NOT EXISTS idx_jatha_arch_batch     ON public.jatha_attendance_archive (archive_batch);

-- Gate is identical to the live jatha_att_read policy (allow_jatha), so there is
-- no divergence to document on this table, beyond the identical NULL-centre
-- fallback to the sewadar's home centre.
ALTER TABLE public.jatha_attendance_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jatha_archive_read ON public.jatha_attendance_archive;
CREATE POLICY jatha_archive_read ON public.jatha_attendance_archive
  FOR SELECT TO authenticated
  USING (
    public.has_permission('allow_jatha')
    AND (
      sewadar_centre IN (SELECT public.get_user_accessible_centres())
      OR (
        sewadar_centre IS NULL
        AND badge_number IN (
          SELECT badge_number FROM public.sewadars
          WHERE centre IN (SELECT public.get_user_accessible_centres())
        )
      )
    )
  );

REVOKE ALL ON public.jatha_attendance_archive FROM anon, authenticated;
GRANT SELECT ON public.jatha_attendance_archive TO authenticated;


-- ============================================================================
--  3.  REPORT  (no side effects — read-only result grid)
-- ============================================================================
-- Every value here is read from the catalogue or the table, never a literal, so
-- no column of this grid can print a fixed answer. A check that cannot fail is
-- worse than no check.
SELECT
  c.table_name,
  c.column_count,
  c.source_column_count,
  (c.column_count - c.source_column_count) AS archive_column_delta,
  c.rls_enabled,
  c.rls_forced,
  c.policy_count,
  c.row_count
FROM (
  SELECT 'attendance_sessions_archive' AS table_name,
         (SELECT count(*) FROM pg_attribute
           WHERE attrelid = to_regclass('public.attendance_sessions_archive')
             AND attnum > 0 AND NOT attisdropped)::int          AS column_count,
         (SELECT count(*) FROM pg_attribute
           WHERE attrelid = to_regclass('public.attendance_sessions')
             AND attnum > 0 AND NOT attisdropped)::int          AS source_column_count,
         (SELECT relrowsecurity      FROM pg_class
           WHERE oid = to_regclass('public.attendance_sessions_archive'))::text     AS rls_enabled,
         (SELECT relforcerowsecurity FROM pg_class
           WHERE oid = to_regclass('public.attendance_sessions_archive'))::text     AS rls_forced,
         (SELECT count(*) FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename  = 'attendance_sessions_archive')::int   AS policy_count,
         (SELECT count(*) FROM public.attendance_sessions_archive)::bigint          AS row_count
  UNION ALL
  SELECT 'jatha_attendance_archive',
         (SELECT count(*) FROM pg_attribute
           WHERE attrelid = to_regclass('public.jatha_attendance_archive')
             AND attnum > 0 AND NOT attisdropped)::int,
         (SELECT count(*) FROM pg_attribute
           WHERE attrelid = to_regclass('public.jatha_attendance')
             AND attnum > 0 AND NOT attisdropped)::int,
         (SELECT relrowsecurity      FROM pg_class
           WHERE oid = to_regclass('public.jatha_attendance_archive'))::text,
         (SELECT relforcerowsecurity FROM pg_class
           WHERE oid = to_regclass('public.jatha_attendance_archive'))::text,
         (SELECT count(*) FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename  = 'jatha_attendance_archive')::int,
         (SELECT count(*) FROM public.jatha_attendance_archive)::bigint
) c;

-- EXPECTED on a first run:
--   archive_column_delta = 4 for both rows   <- the invariant this file can assert
--   rls_enabled = true, policy_count = 1 for both rows
--   row_count = 0 for both rows
-- The absolute column counts (column_count / source_column_count) are printed only
-- so the preflight's numbers can be cross-checked. Do NOT treat a specific number
-- as the expectation: the deployed schema, not this repo, decides it.
--
-- rls_forced = false is the normal, expected state. It is printed because row
-- security does NOT apply to a table's OWNER unless the table is FORCEd, so a
-- verification run by the owner sees every row regardless of these policies —
-- which is exactly the trap verify_asms_archive.sql §3 warns about.
