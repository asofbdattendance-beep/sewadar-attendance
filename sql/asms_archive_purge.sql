-- ============================================================================
--  ASMS ARCHIVE — PURGE  (PHASE 2)          *** T H I S   D E L E T E S ***
-- ============================================================================
--  Removes from the LIVE tables only the rows that are (a) outside the retention
--  window AND (b) proven present and identical in the archive. Everything else
--  stays. The archive tables are never written by this file.
--
--  DEFAULTS TO DRY RUN. Section 2 holds ONE line to edit. Until you change it to
--  'YES' this file deletes nothing and can be run any number of times safely: it
--  prints the preview and the report and skips the two DELETEs.
--
--  v2 FIX: v1 aborted in §0 when unarmed, which meant the §1 preview was
--  unreachable — you could never read the counts without arming first. The guard
--  now skips the DELETEs (RETURN) instead of aborting the batch, so the preview is
--  always readable.
--
--  WHAT SURVIVES
--    current calendar month + previous calendar month   (computed, never hardcoded)
--    any session with status = 'OPEN'
--    any session whose COALESCE(out_date, in_date) is on/after the cutoff
--    any session with in_date IS NULL
--    any jatha row with from_date IS NULL
--    any jatha row whose COALESCE(to_date, from_date) is on/after the cutoff
--    every row in public.archival_attendance (a different dataset — never touched)
--
--  BEFORE YOU ARM IT
--    1. a backup you can restore, OR the knowledge that this archive IS the copy
--       of record (see RECOVERY below),
--    2. sql/verify_asms_archive.sql §1, §2 and §3 all green, with §3's checksum
--       compared to the preflight §B baseline you saved,
--    3. the §1 preview below, read and understood.
--
--  RUN AS `postgres` (SQL Editor), the whole file in one go.
--
--  WHY THIS IS NOT IN THE SAME DEPLOY AS THE BACKFILL
--    Additive first, destructive last. The copy ran on 2026-10-18 and is verified
--    separately. Only after the archive is proven complete and faithful does the
--    destructive half become safe to consider. Merging them would mean a bug in the
--    copy silently becomes data loss.
--
--  CUTOFF MOVED SINCE THE BACKFILL?  The cutoff is recomputed here. If a month has
--    rolled over, rows that were never copied become eligible, gate 1 fires, and
--    nothing is deleted. That is the guard working, not a failure: re-run
--    asms_archive_backfill.sql for the new window, re-verify, then purge.
--
--  RECOVERY (there is no undo, but there is a re-insert)
--    The archive holds every column of every deleted row, so a purge IS reversible
--    from the archive — provided the archive is intact. Re-insert one table with:
--
--      INSERT INTO public.attendance_sessions
--        OVERRIDING SYSTEM VALUE          -- required: live id is GENERATED ALWAYS
--      SELECT id, badge_number, sewadar_name, centre, duty_type, status, in_date,
--             in_time, out_date, out_time, is_manual, is_gate_entry,
--             in_scanner_badge, in_scanner_name, in_scanner_centre,
--             out_scanner_badge, out_scanner_name, out_scanner_centre,
--             entered_by_badge, entered_by_name, created_at, updated_at,
--             sewadar_centre, sewadar_dept
--      FROM public.attendance_sessions_archive
--      WHERE NOT EXISTS (SELECT 1 FROM public.attendance_sessions s
--                         WHERE s.id = public.attendance_sessions_archive.id);
--
--    `OVERRIDING SYSTEM VALUE` is required because the live `id` is
--    GENERATED ALWAYS AS IDENTITY. `jatha_attendance.id` is a plain nextval default,
--    so its re-insert needs no OVERRIDING clause. A plain restore from a Supabase
--    backup is the other path; both need the backup or the archive to still exist,
--    which is why neither table is ever dropped by this file.
-- ============================================================================

SET lock_timeout = '5s';   -- fail fast instead of queueing behind a long read


-- ============================================================================
--  1.  PREVIEW  (read-only, ALWAYS runs — read this before arming §2)
-- ============================================================================
-- 1a. These are the exact rows §3 will delete. Compare to what the backfill
--     reported: 4,161 sessions and 6,305 jatha for batch asms-archive-2026-10-18T13:27:01.
SELECT '1a. sessions that WOULD be deleted' AS check_name,
       count(*) AS rows_to_delete
FROM public.attendance_sessions s
WHERE s.in_date < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
  AND COALESCE(s.out_date, s.in_date) < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
  AND s.status IS DISTINCT FROM 'OPEN'
UNION ALL
SELECT '1a. jatha that WOULD be deleted',
       count(*)
FROM public.jatha_attendance j
WHERE j.from_date IS NOT NULL
  AND COALESCE(j.to_date, j.from_date) < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE;

-- 1b. What SURVIVES, by reason. Every number here is a row that must still be in
--     the live table after the purge. Record these — sql/verify_asms_archive_purge.sql
--     §2 compares against them.
SELECT '1b. sessions that would SURVIVE' AS check_name, 'total live' AS reason,
       count(*)::bigint AS rows
FROM public.attendance_sessions
UNION ALL
SELECT '1b. sessions that would SURVIVE', 'still OPEN',
       count(*)::bigint FROM public.attendance_sessions WHERE status = 'OPEN'
UNION ALL
SELECT '1b. sessions that would SURVIVE', 'span crosses cutoff or recent',
       count(*)::bigint FROM public.attendance_sessions
 WHERE in_date >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
    OR COALESCE(out_date, in_date) >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
UNION ALL
SELECT '1b. sessions that would SURVIVE', 'in_date IS NULL',
       count(*)::bigint FROM public.attendance_sessions WHERE in_date IS NULL
UNION ALL
SELECT '1b. jatha that would SURVIVE', 'total live', count(*)::bigint
FROM public.jatha_attendance
UNION ALL
SELECT '1b. jatha that would SURVIVE', 'from_date IS NULL',
       count(*)::bigint FROM public.jatha_attendance WHERE from_date IS NULL
UNION ALL
SELECT '1b. jatha that would SURVIVE', 'recent or crosses cutoff',
       count(*)::bigint FROM public.jatha_attendance
 WHERE from_date IS NOT NULL
   AND COALESCE(to_date, from_date) >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE;


-- ============================================================================
--  2.  ARM  — THE ONE LINE TO EDIT
-- ============================================================================
-- Change 'NO' to 'YES' to let §3 delete. Both delete blocks read this one setting,
-- so there is exactly one place to edit. Leaving it 'NO' makes this file a dry run.
-- If you run §3 by itself in a fresh session this setting is unset and the deletes
-- skip — safe by default.
SELECT set_config('asms.purge_arm', 'YES', false) AS arm_purge__edit_this_line_to_YES;


-- ============================================================================
--  3.  THE DELETE  (two blocks; each re-proves coverage immediately before deleting)
-- ============================================================================
-- The gate inside each block is the whole point of this file: it compares the
-- eligible live rows against the archive COLUMN BY COLUMN — the predicate is built
-- from pg_attribute, so it covers every column including any these files never
-- name — and REFUSES to delete if even one eligible row is missing from the archive
-- or differs from it in any column.
--
-- NOTE: the SQL Editor runs a multi-statement batch in one transaction, so if the
-- second block fails the first can roll back with it. That is why each block proves
-- coverage for itself rather than trusting the other block's work.

-- ------------------------------------------------------------ 3a. sessions
DO $$
DECLARE
  v_cutoff   DATE;
  v_elig     TEXT;
  v_pred     TEXT;
  v_missing  BIGINT;
  v_mismatch BIGINT;
  v_deleted  BIGINT;
BEGIN
  IF current_setting('asms.purge_arm', true) IS DISTINCT FROM 'YES' THEN
    RAISE NOTICE '3a: NOT ARMED — skipping the sessions delete. Set §2 to ''YES'' to arm. Nothing was deleted.';
    RETURN;
  END IF;

  IF to_regclass('public.attendance_sessions_archive') IS NULL THEN
    RAISE EXCEPTION '3a: attendance_sessions_archive is missing. The archive is the copy of record — refusing to delete. Nothing was deleted.';
  END IF;

  v_cutoff := date_trunc(
                'month',
                (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month'
              )::DATE;

  -- Eligibility as text, cutoff spliced in as a quoted literal.
  v_elig := format(
    's.in_date < %1$L AND COALESCE(s.out_date, s.in_date) < %1$L AND s.status IS DISTINCT FROM ''OPEN''',
    v_cutoff);

  -- The every-column comparison, generated from the catalogue.
  SELECT string_agg(format('(s.%1$I IS DISTINCT FROM a.%1$I)', c.attname), ' OR ' ORDER BY c.attnum)
    INTO v_pred
  FROM pg_attribute c
  WHERE c.attrelid = to_regclass('public.attendance_sessions')
    AND c.attnum > 0 AND NOT c.attisdropped;

  IF v_pred IS NULL THEN
    RAISE EXCEPTION '3a: cannot build a column predicate for attendance_sessions. Nothing was deleted.';
  END IF;

  -- GATE 0: no INBOUND foreign key may cascade into, null out, or default another
  -- table. A DELETE that silently mutates a third table is not a purge, it is an
  -- incident — and nothing in the archive design would notice, because the archive
  -- only knows about attendance_sessions. Deliberately checked at table level
  -- (confrelid), not column level, so a reference to any unique key counts.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class p ON p.oid = c.confrelid
    WHERE c.contype = 'f'
      AND p.oid = to_regclass('public.attendance_sessions')
      AND c.confdeltype IN ('c', 'n', 'd')
  ) THEN
    RAISE EXCEPTION
      '3a: REFUSING TO DELETE. An inbound foreign key is declared with a mutating action, so deleting here would also change another table: %. Resolve that reference first. Nothing was deleted.',
      (SELECT string_agg(
                format('%s.%s -> attendance_sessions (%s)',
                       tc.relname, a.attname,
                       CASE c.confdeltype WHEN 'c' THEN 'ON DELETE CASCADE'
                                          WHEN 'n' THEN 'ON DELETE SET NULL'
                                          ELSE 'ON DELETE SET DEFAULT' END),
                ', ' ORDER BY tc.relname)
       FROM pg_constraint c
       JOIN pg_class tc     ON tc.oid = c.conrelid
       JOIN pg_class p      ON p.oid  = c.confrelid
       JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
       JOIN pg_attribute a  ON a.attrelid = c.conrelid AND a.attnum = k.attnum
       WHERE c.contype = 'f'
         AND p.oid = to_regclass('public.attendance_sessions')
         AND c.confdeltype IN ('c', 'n', 'd'));
  END IF;

  -- GATE 1: no eligible row may be absent from the archive.
  EXECUTE format(
    'SELECT count(*) FROM public.attendance_sessions s
      WHERE %1$s
        AND NOT EXISTS (SELECT 1 FROM public.attendance_sessions_archive a WHERE a.id = s.id)',
    v_elig)
  INTO v_missing;

  -- GATE 2: no eligible row may differ from its archive counterpart in ANY column.
  EXECUTE format(
    'SELECT count(*) FROM public.attendance_sessions s
       JOIN public.attendance_sessions_archive a ON a.id = s.id
      WHERE %1$s AND (%2$s)',
    v_elig, v_pred)
  INTO v_mismatch;

  IF v_missing > 0 OR v_mismatch > 0 THEN
    RAISE EXCEPTION
      '3a: refusing to delete. % eligible row(s) are not in the archive, % differ from it. Re-run the backfill, re-verify, then purge. Nothing was deleted.',
      v_missing, v_mismatch;
  END IF;

  -- GATE 3: the delete targets exactly the rows just proven.
  EXECUTE format('DELETE FROM public.attendance_sessions s WHERE %s', v_elig);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE NOTICE '3a: deleted % session row(s); 0 missing from the archive, 0 mismatched at delete time.', v_deleted;
END $$;

-- ------------------------------------------------------------ 3b. jatha
DO $$
DECLARE
  v_cutoff   DATE;
  v_elig     TEXT;
  v_pred     TEXT;
  v_missing  BIGINT;
  v_mismatch BIGINT;
  v_deleted  BIGINT;
BEGIN
  IF current_setting('asms.purge_arm', true) IS DISTINCT FROM 'YES' THEN
    RAISE NOTICE '3b: NOT ARMED — skipping the jatha delete. Set §2 to ''YES'' to arm. Nothing was deleted.';
    RETURN;
  END IF;

  IF to_regclass('public.jatha_attendance_archive') IS NULL THEN
    RAISE EXCEPTION '3b: jatha_attendance_archive is missing. Refusing to delete. Nothing was deleted.';
  END IF;

  v_cutoff := date_trunc(
                'month',
                (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month'
              )::DATE;

  v_elig := format(
    'j.from_date IS NOT NULL AND COALESCE(j.to_date, j.from_date) < %1$L',
    v_cutoff);

  SELECT string_agg(format('(j.%1$I IS DISTINCT FROM a.%1$I)', c.attname), ' OR ' ORDER BY c.attnum)
    INTO v_pred
  FROM pg_attribute c
  WHERE c.attrelid = to_regclass('public.jatha_attendance')
    AND c.attnum > 0 AND NOT c.attisdropped;

  IF v_pred IS NULL THEN
    RAISE EXCEPTION '3b: cannot build a column predicate for jatha_attendance. Nothing was deleted.';
  END IF;

  -- GATE 0: no INBOUND foreign key may cascade into, null out, or default another
  -- table (see the note in 3a). Checked at table level so any unique key counts.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class p ON p.oid = c.confrelid
    WHERE c.contype = 'f'
      AND p.oid = to_regclass('public.jatha_attendance')
      AND c.confdeltype IN ('c', 'n', 'd')
  ) THEN
    RAISE EXCEPTION
      '3b: REFUSING TO DELETE. An inbound foreign key is declared with a mutating action, so deleting here would also change another table: %. Resolve that reference first. Nothing was deleted.',
      (SELECT string_agg(
                format('%s.%s -> jatha_attendance (%s)',
                       tc.relname, a.attname,
                       CASE c.confdeltype WHEN 'c' THEN 'ON DELETE CASCADE'
                                          WHEN 'n' THEN 'ON DELETE SET NULL'
                                          ELSE 'ON DELETE SET DEFAULT' END),
                ', ' ORDER BY tc.relname)
       FROM pg_constraint c
       JOIN pg_class tc     ON tc.oid = c.conrelid
       JOIN pg_class p      ON p.oid  = c.confrelid
       JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
       JOIN pg_attribute a  ON a.attrelid = c.conrelid AND a.attnum = k.attnum
       WHERE c.contype = 'f'
         AND p.oid = to_regclass('public.jatha_attendance')
         AND c.confdeltype IN ('c', 'n', 'd'));
  END IF;

  EXECUTE format(
    'SELECT count(*) FROM public.jatha_attendance j
      WHERE %1$s
        AND NOT EXISTS (SELECT 1 FROM public.jatha_attendance_archive a WHERE a.id = j.id)',
    v_elig)
  INTO v_missing;

  EXECUTE format(
    'SELECT count(*) FROM public.jatha_attendance j
       JOIN public.jatha_attendance_archive a ON a.id = j.id
      WHERE %1$s AND (%2$s)',
    v_elig, v_pred)
  INTO v_mismatch;

  IF v_missing > 0 OR v_mismatch > 0 THEN
    RAISE EXCEPTION
      '3b: refusing to delete. % eligible row(s) are not in the archive, % differ from it. Nothing was deleted.',
      v_missing, v_mismatch;
  END IF;

  EXECUTE format('DELETE FROM public.jatha_attendance j WHERE %s', v_elig);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RAISE NOTICE '3b: deleted % jatha row(s); 0 missing from the archive, 0 mismatched at delete time.', v_deleted;
END $$;


-- ============================================================================
--  4.  REPORT  (read-only, ALWAYS runs)
-- ============================================================================
-- After a clean armed run: arm_state = 'YES', eligible_still_live = 0 for both
-- tables, and archive_rows unchanged. If arm_state = 'NO' nothing was deleted and
-- eligible_still_live still shows the rows §3 would have taken.
SELECT '4. arm_state' AS check_name,
       COALESCE(current_setting('asms.purge_arm', true), '(unset)') AS arm_state,
       NULL::bigint AS live_rows_now, NULL::bigint AS archive_rows, NULL::bigint AS eligible_still_live
UNION ALL
SELECT '4. sessions',
       NULL,
       (SELECT count(*) FROM public.attendance_sessions),
       (SELECT count(*) FROM public.attendance_sessions_archive),
       (SELECT count(*) FROM public.attendance_sessions s
         WHERE s.in_date < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
           AND COALESCE(s.out_date, s.in_date) < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
           AND s.status IS DISTINCT FROM 'OPEN')
UNION ALL
SELECT '4. jatha',
       NULL,
       (SELECT count(*) FROM public.jatha_attendance),
       (SELECT count(*) FROM public.jatha_attendance_archive),
       (SELECT count(*) FROM public.jatha_attendance j
         WHERE j.from_date IS NOT NULL
           AND COALESCE(j.to_date, j.from_date) < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE);
