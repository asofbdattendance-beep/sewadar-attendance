-- ============================================================================
--  ASMS ARCHIVE — BACKFILL  (COPY ONLY. NO DELETES ANYWHERE.)
-- ============================================================================
--  Copies records OLDER THAN THE RETENTION CUTOFF from the live ASMS tables into
--  their archive tables. The live tables are READ-ONLY in this file: the only
--  statements that name them are SELECTs. No DELETE, no TRUNCATE, no UPDATE.
--
--  PREREQUISITE : run sql/asms_archive_schema.sql first.
--  RUN BEFORE   : sql/asms_archive_preflight.sql  (and RECORD its output)
--  RUN AFTER    : sql/verify_asms_archive.sql
--
--  CUTOFF (Asia/Kolkata, computed — never hardcoded)
--    keep live : current calendar month + previous calendar month
--    archive   : everything strictly before the 1st of the previous month
--    as of 2026-10-18 IST  ->  cutoff = 2026-09-01
--
--  ELIGIBILITY
--    attendance_sessions : in_date < cutoff
--                          AND COALESCE(out_date, in_date) < cutoff   <- the whole
--                          span must be in the past, mirroring the jatha rule
--                          below. Without this, a session opened before the cutoff
--                          and closed after it is archived even though its own span
--                          reaches into the retention window.
--                          AND status IS DISTINCT FROM 'OPEN'
--    jatha_attendance    : from_date IS NOT NULL
--                          AND COALESCE(to_date, from_date) < cutoff
--                          (a NULL to_date is read as a single-day entry, the same
--                          reading rls_policies_all.sql's check_jatha_overlap
--                          trigger uses. See the OPEN DECISION notice below.)
--
--  IDEMPOTENT : ON CONFLICT (id) DO NOTHING. Re-run as often as you like. A second
--  run archives only what is new since the first and changes no existing row.
--
--  IF IT TIMES OUT: the two copies are separate transactions, so a timeout discards
--  only the copy that timed out; the other one stands. Re-running to completion is
--  always safe because of ON CONFLICT DO NOTHING. For a very large source, add
--  `AND s.id > <last id already archived>` to the sessions SELECT below, in steps,
--  and keep re-running until v_sess_ins reports 0. There is no persisted
--  high-water mark — derive it from `SELECT max(id) FROM ..._archive;`.
-- ============================================================================


-- ============================================================================
--  1.  attendance_sessions -> attendance_sessions_archive
-- ============================================================================
-- Its own block, so a failure here cannot discard the jatha copy (and vice versa).
DO $$
DECLARE
  v_cutoff     DATE;
  v_batch      TEXT;
  v_src_names  TEXT[];
  v_arch_names TEXT[];
  n_src        INT;
  n_arch       INT;
  v_eligible   BIGINT;
  v_inserted   BIGINT;
BEGIN
  IF to_regclass('public.attendance_sessions_archive') IS NULL THEN
    RAISE EXCEPTION
      'attendance_sessions_archive not found. Run sql/asms_archive_schema.sql first. Nothing was changed.';
  END IF;

  -- ---- GUARD: the positional insert below is only correct if the archive's
  -- leading columns are EXACTLY the source's columns, in the same order.
  -- A count check alone does NOT prove that: rls_policies_all.sql:811-814 drops
  -- and re-adds sewadar_centre/sewadar_dept on attendance_sessions as a routine
  -- deploy step, which moves them to the END while the count stays 24. A
  -- count-only guard would pass, and `s.*` would then map duty_type's value into
  -- the archive's sewadar_centre, centre's into... silently. Compare NAMES, in
  -- order, via pg_attribute (not information_schema, which is privilege-filtered).
  SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_src_names
  FROM pg_attribute a
  WHERE a.attrelid = to_regclass('public.attendance_sessions')
    AND a.attnum > 0 AND NOT a.attisdropped;

  SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_arch_names
  FROM pg_attribute a
  WHERE a.attrelid = to_regclass('public.attendance_sessions_archive')
    AND a.attnum > 0 AND NOT a.attisdropped;

  n_src  := array_length(v_src_names, 1);
  n_arch := array_length(v_arch_names, 1);

  IF v_arch_names[1:n_src] IS DISTINCT FROM v_src_names THEN
    RAISE EXCEPTION
      'attendance_sessions_archive no longer mirrors attendance_sessions. Source: %. Archive: %. The positional copy would mis-map values. Re-run sql/asms_archive_schema.sql against the current source, or reconcile by hand. Nothing was written.',
      v_src_names, v_arch_names;
  END IF;

  IF n_arch <> n_src + 4 THEN
    RAISE EXCEPTION
      'attendance_sessions_archive has % columns, source has % (expected source + 4). Aborted — nothing written.',
      n_arch, n_src;
  END IF;

  -- ---- GUARD: the archive key is the source id and it is the PRIMARY KEY.
  -- A single NULL id would abort the whole statement with a message that points
  -- at the archive rather than the source, so name the real cause first.
  IF EXISTS (SELECT 1 FROM public.attendance_sessions WHERE id IS NULL) THEN
    RAISE EXCEPTION
      'attendance_sessions has rows with a NULL id — they cannot be archived (archive.id is the primary key). Nothing was written.';
  END IF;

  v_cutoff := date_trunc(
                'month',
                (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month'
              )::DATE;
  v_batch  := 'asms-archive-' || to_char(
                CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'
              );

  RAISE NOTICE '=== ASMS archive backfill (sessions) — batch % ===', v_batch;
  RAISE NOTICE 'Retention cutoff (Asia/Kolkata): %', v_cutoff;

  SELECT count(*) INTO v_eligible
  FROM public.attendance_sessions
  WHERE in_date < v_cutoff
    AND COALESCE(out_date, in_date) < v_cutoff
    AND status IS DISTINCT FROM 'OPEN';

  -- Positional insert: `s.*` maps 1:1 onto the archive's leading columns
  -- (established by the name guard above, not by COUNT alone), then the four
  -- archive columns in the order asms_archive_schema.sql appended them.
  -- current_user is `postgres` when this runs from the SQL Editor, so archived_by
  -- records "who ran the copy" only in the sense of the connecting role.
  INSERT INTO public.attendance_sessions_archive
  SELECT s.*, now(), current_user::TEXT, v_batch, 'attendance_sessions'
  FROM public.attendance_sessions s
  WHERE s.in_date < v_cutoff
    AND COALESCE(s.out_date, s.in_date) < v_cutoff
    AND s.status IS DISTINCT FROM 'OPEN'
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RAISE NOTICE 'sessions : % eligible, % inserted this run.', v_eligible, v_inserted;
  RAISE NOTICE 'A second run must report 0 inserted. The live table was not modified.';
END $$;


-- ============================================================================
--  2.  jatha_attendance -> jatha_attendance_archive
-- ============================================================================
DO $$
DECLARE
  v_cutoff      DATE;
  v_batch       TEXT;
  v_src_names   TEXT[];
  v_arch_names  TEXT[];
  n_src         INT;
  n_arch        INT;
  v_eligible    BIGINT;
  v_inserted    BIGINT;
  v_null_to     BIGINT;
BEGIN
  IF to_regclass('public.jatha_attendance_archive') IS NULL THEN
    RAISE EXCEPTION
      'jatha_attendance_archive not found. Run sql/asms_archive_schema.sql first. Nothing was changed.';
  END IF;

  SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_src_names
  FROM pg_attribute a
  WHERE a.attrelid = to_regclass('public.jatha_attendance')
    AND a.attnum > 0 AND NOT a.attisdropped;

  SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_arch_names
  FROM pg_attribute a
  WHERE a.attrelid = to_regclass('public.jatha_attendance_archive')
    AND a.attnum > 0 AND NOT a.attisdropped;

  n_src  := array_length(v_src_names, 1);
  n_arch := array_length(v_arch_names, 1);

  IF v_arch_names[1:n_src] IS DISTINCT FROM v_src_names THEN
    RAISE EXCEPTION
      'jatha_attendance_archive no longer mirrors jatha_attendance. Source: %. Archive: %. The positional copy would mis-map values. Nothing was written.',
      v_src_names, v_arch_names;
  END IF;

  IF n_arch <> n_src + 4 THEN
    RAISE EXCEPTION
      'jatha_attendance_archive has % columns, source has % (expected source + 4). Aborted — nothing written.',
      n_arch, n_src;
  END IF;

  IF EXISTS (SELECT 1 FROM public.jatha_attendance WHERE id IS NULL) THEN
    RAISE EXCEPTION
      'jatha_attendance has rows with a NULL id — they cannot be archived (archive.id is the primary key). Nothing was written.';
  END IF;

  v_cutoff := date_trunc(
                'month',
                (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month'
              )::DATE;
  v_batch  := 'asms-archive-' || to_char(
                CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD"T"HH24:MI:SS'
              );

  RAISE NOTICE '=== ASMS archive backfill (jatha) — batch % ===', v_batch;

  -- OPEN DECISION, made visible. A NULL to_date is read here as a single-day
  -- entry, matching the reading rls_policies_all.sql's check_jatha_overlap uses.
  -- If NULL to_date instead means "still deployed / not marked out", these rows
  -- must NOT be archived, because the later deletion phase would then delete a
  -- live record. Confirm the semantics before that phase; the count is surfaced
  -- by asms_archive_preflight.sql so the population is never invisible.
  SELECT count(*) INTO v_null_to
  FROM public.jatha_attendance
  WHERE from_date IS NOT NULL
    AND to_date IS NULL
    AND from_date < v_cutoff;

  IF v_null_to > 0 THEN
    RAISE NOTICE 'jatha : % row(s) with to_date IS NULL and from_date < cutoff are treated as single-day entries and WILL be archived. Verify this reading before any deletion phase.', v_null_to;
  END IF;

  SELECT count(*) INTO v_eligible
  FROM public.jatha_attendance
  WHERE from_date IS NOT NULL
    AND COALESCE(to_date, from_date) < v_cutoff;

  INSERT INTO public.jatha_attendance_archive
  SELECT j.*, now(), current_user::TEXT, v_batch, 'jatha_attendance'
  FROM public.jatha_attendance j
  WHERE j.from_date IS NOT NULL
    AND COALESCE(j.to_date, j.from_date) < v_cutoff
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RAISE NOTICE 'jatha    : % eligible, % inserted this run.', v_eligible, v_inserted;
  RAISE NOTICE '=== Backfill complete. The live tables were NOT modified. ===';
END $$;


-- ============================================================================
--  REPORT  (read-only result grid — the DO blocks' NOTICEs are not visible in
--  every SQL client, so the same numbers are returned as rows)
-- ============================================================================
WITH p AS (
  SELECT date_trunc(
           'month',
           (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month'
         )::DATE AS cutoff
)
SELECT 'attendance_sessions' AS source_table,
       (SELECT count(*) FROM public.attendance_sessions, p
         WHERE in_date < p.cutoff
           AND COALESCE(out_date, in_date) < p.cutoff
           AND status IS DISTINCT FROM 'OPEN')                                AS eligible_now,
       (SELECT count(*) FROM public.attendance_sessions_archive)              AS in_archive,
       (SELECT count(*) FROM public.attendance_sessions_archive a
         WHERE NOT EXISTS (SELECT 1 FROM public.attendance_sessions s
                            WHERE s.id = a.id))                               AS archived_but_not_live,
       (SELECT max(archive_batch) FROM public.attendance_sessions_archive)    AS latest_batch
UNION ALL
SELECT 'jatha_attendance',
       (SELECT count(*) FROM public.jatha_attendance, p
         WHERE from_date IS NOT NULL AND COALESCE(to_date, from_date) < p.cutoff),
       (SELECT count(*) FROM public.jatha_attendance_archive),
       (SELECT count(*) FROM public.jatha_attendance_archive a
         WHERE NOT EXISTS (SELECT 1 FROM public.jatha_attendance j
                            WHERE j.id = a.id)),
       (SELECT max(archive_batch) FROM public.jatha_attendance_archive);

-- HOW TO READ THIS
--   eligible_now is recomputed with the CURRENT predicate, immediately after the
--   copy, so on a clean first run eligible_now = in_archive.
--   It is NOT an invariant. On a later run, after the cutoff has advanced, rows
--   archived under an earlier cutoff are still in in_archive but no longer match
--   eligible_now, so in_archive > eligible_now is the CORRECT, expected result —
--   not corruption. The invariant that does hold on every run, for both rows:
--       in_archive = (rows archived before this run) + (rows inserted this run)
--       archived_but_not_live = 0
--   archived_but_not_live > 0 is the one genuinely alarming reading here.
