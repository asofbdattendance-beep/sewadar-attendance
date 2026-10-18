-- ============================================================================
--  ASMS ARCHIVE — VERIFICATION  (READ-ONLY)
-- ============================================================================
--  Run AFTER sql/asms_archive_backfill.sql. Reads catalogue and data only; the
--  single DO block at §2c executes comparisons and raises on failure, it never
--  writes a row anywhere.
--
--  >>> RUN THIS AS `postgres` — paste it into the Supabase SQL Editor. <<<
--  Row-level security is scoped to the RUNNER. The live table and the archive
--  table are gated by DIFFERENT policies, so under any other role one side can be
--  invisible: a reports-only role sees the archive but not the live table, so §2's
--  joins return nothing and read as "0 mismatches"; a records-only role sees the
--  live table but not the archive, so §1 reads `archived = 0` and looks like total
--  data loss. Neither error raises. Run as the owner. §0 proves which role you are.
--
--  HOW TO READ
--    - Several checks PASS by returning ZERO ROWS. Zero rows is a PASS only if the
--      statement actually EXECUTED — check the editor for an error, because a
--      failed statement and a clean result both show as "no rows" in some clients.
--    - Every section is ONE self-contained statement. A WITH clause belongs to a
--      single statement, so an earlier CTE would be out of scope here — which is
--      exactly the bug this file was rewritten to remove. Nothing is shared.
--    - The cutoff is recomputed inside each statement that needs it, so these can
--      be run individually, in any order, and re-run later without drift.
--
--  SECTION MAP
--    §0  which role am I, and how many rows can it see
--    §1  COVERAGE      — is every eligible live row archived (both directions)
--    §2  FIDELITY      — do archived values equal source values, every column
--    §3  LIVE UNTOUCHED— live counts and checksum vs the preflight §B baseline
--    §4  ARCHIVE HYGIENE — shape, provenance, RLS
-- ============================================================================


-- ============================================================================
--  §0.  ROLE AND VISIBILITY PROBE  —  read this first
-- ============================================================================
-- EXPECTED: current_user = postgres (or another superuser/owner role).
-- live_visible and archive_visible are the counts THIS role can see. If
-- live_visible is far below the preflight's total row count, stop: every check
-- below is measuring that role's slice, not the database.
SELECT '0. role probe' AS check_name,
       current_user                          AS current_user,
       session_user                          AS session_user,
       (SELECT count(*) FROM public.attendance_sessions)          AS live_sessions_visible,
       (SELECT count(*) FROM public.attendance_sessions_archive)  AS live_archive_visible,
       (SELECT count(*) FROM public.jatha_attendance)             AS live_jatha_visible,
       (SELECT count(*) FROM public.jatha_attendance_archive)     AS jatha_archive_visible,
       (SELECT count(*) FROM public.archival_attendance)          AS archival_visible;


-- ============================================================================
--  §1.  COVERAGE
-- ============================================================================
-- 1a. Headline, both directions. EXPECTED: missing = 0 AND
--     archived_id_not_live = 0 for both rows.
--     `archived` may legitimately EXCEED `eligible`: once the cutoff advances, rows
--     archived by an earlier run are still in the archive but no longer match the
--     current eligibility predicate. That is expected, not corruption — but any row
--     archived while its source row is still live and still INELIGIBLE is a real
--     fault, and §1a-bis isolates exactly that case.
SELECT
  '1a. coverage' AS check_name,
  'attendance_sessions' AS source_table,
  (SELECT count(*) FROM public.attendance_sessions s
    WHERE s.in_date < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
      AND COALESCE(s.out_date, s.in_date) < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
      AND s.status IS DISTINCT FROM 'OPEN')                              AS eligible,
  (SELECT count(*) FROM public.attendance_sessions_archive)              AS archived,
  (SELECT count(*) FROM public.attendance_sessions s
    WHERE s.in_date < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
      AND COALESCE(s.out_date, s.in_date) < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
      AND s.status IS DISTINCT FROM 'OPEN'
      AND NOT EXISTS (SELECT 1 FROM public.attendance_sessions_archive a
                       WHERE a.id = s.id))                               AS missing,
  (SELECT count(*) FROM public.attendance_sessions_archive a
    WHERE NOT EXISTS (SELECT 1 FROM public.attendance_sessions s
                       WHERE s.id = a.id))                              AS archived_id_not_live
UNION ALL
SELECT
  '1a. coverage',
  'jatha_attendance',
  (SELECT count(*) FROM public.jatha_attendance j
    WHERE j.from_date IS NOT NULL
      AND COALESCE(j.to_date, j.from_date) < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE),
  (SELECT count(*) FROM public.jatha_attendance_archive),
  (SELECT count(*) FROM public.jatha_attendance j
    WHERE j.from_date IS NOT NULL
      AND COALESCE(j.to_date, j.from_date) < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
      AND NOT EXISTS (SELECT 1 FROM public.jatha_attendance_archive a
                       WHERE a.id = j.id)),
  (SELECT count(*) FROM public.jatha_attendance_archive a
    WHERE NOT EXISTS (SELECT 1 FROM public.jatha_attendance j
                       WHERE j.id = a.id));


-- 1a-bis. The GENERAL ineligibility test: an archived row whose source row is
-- still live but does NOT satisfy the eligibility predicate. §1e checks three
-- hardcoded predicates; this checks the whole predicate, NULL-safely, so a rule
-- change or an out-of-band insert cannot slip past.
-- EXPECTED: 0 and 0.
-- (A row archived under an OLDER, looser rule would appear here. Nothing has run
--  yet, so under the current rule this must be zero. If it is not, do not proceed
--  to any deletion phase.)
SELECT '1a-bis. archived while ineligible' AS check_name, 'attendance_sessions' AS source_table,
       count(*) AS rows_archived_while_ineligible
FROM public.attendance_sessions_archive a
JOIN public.attendance_sessions s ON s.id = a.id
WHERE s.in_date IS NULL
   OR s.in_date >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
   OR COALESCE(s.out_date, s.in_date) >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
   OR s.status = 'OPEN'
UNION ALL
SELECT '1a-bis. archived while ineligible', 'jatha_attendance',
       count(*)
FROM public.jatha_attendance_archive a
JOIN public.jatha_attendance j ON j.id = a.id
WHERE j.from_date IS NULL
   OR COALESCE(j.to_date, j.from_date) >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE;


-- 1b. Per MONTH, sessions. EXPECTED: **zero rows returned** (the HAVING keeps only
--     months with a gap, so empty means every month below the cutoff is complete).
SELECT '1b. per month' AS check_name,
       to_char(s.in_date, 'YYYY-MM')                            AS period,
       count(*)                                                 AS eligible,
       count(*) FILTER (WHERE a.id IS NOT NULL)                 AS archived,
       count(*) FILTER (WHERE a.id IS NULL)                     AS missing
FROM public.attendance_sessions s
LEFT JOIN public.attendance_sessions_archive a ON a.id = s.id
WHERE s.in_date < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
  AND COALESCE(s.out_date, s.in_date) < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
  AND s.status IS DISTINCT FROM 'OPEN'
GROUP BY 1, 2
HAVING count(*) FILTER (WHERE a.id IS NULL) > 0
ORDER BY 2;


-- 1c. Per SCAN centre (the axis the live sessions_read policy scopes on).
--     EXPECTED: **zero rows returned.**
SELECT '1c. per scan centre' AS check_name,
       s.centre                                    AS centre,
       count(*)                                    AS eligible,
       count(*) FILTER (WHERE a.id IS NOT NULL)    AS archived,
       count(*) FILTER (WHERE a.id IS NULL)        AS missing
FROM public.attendance_sessions s
LEFT JOIN public.attendance_sessions_archive a ON a.id = s.id
WHERE s.in_date < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
  AND COALESCE(s.out_date, s.in_date) < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
  AND s.status IS DISTINCT FROM 'OPEN'
GROUP BY 1, 2
HAVING count(*) FILTER (WHERE a.id IS NULL) > 0
ORDER BY 5 DESC, 2;


-- 1c-bis. Per HOME centre (s.sewadar_centre). The OTHER axis a centre-scoped user
--     reads through, via the badge_number -> sewadars.centre fallback. Coverage was
--     proven on the scan axis only, so a centre could be complete by s.centre and
--     short by s.sewadar_centre.
--     EXPECTED: **zero rows returned.**
SELECT '1c-bis. per home centre' AS check_name,
       s.sewadar_centre                            AS home_centre,
       count(*)                                    AS eligible,
       count(*) FILTER (WHERE a.id IS NOT NULL)    AS archived,
       count(*) FILTER (WHERE a.id IS NULL)        AS missing
FROM public.attendance_sessions s
LEFT JOIN public.attendance_sessions_archive a ON a.id = s.id
WHERE s.in_date < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
  AND COALESCE(s.out_date, s.in_date) < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
  AND s.status IS DISTINCT FROM 'OPEN'
GROUP BY 1, 2
HAVING count(*) FILTER (WHERE a.id IS NULL) > 0
ORDER BY 5 DESC, 2;


-- 1d. Per centre, jatha. EXPECTED: **zero rows returned.**
SELECT '1d. per centre (jatha)' AS check_name,
       j.sewadar_centre                            AS home_centre,
       count(*)                                    AS eligible,
       count(*) FILTER (WHERE a.id IS NOT NULL)    AS archived,
       count(*) FILTER (WHERE a.id IS NULL)        AS missing
FROM public.jatha_attendance j
LEFT JOIN public.jatha_attendance_archive a ON a.id = j.id
WHERE j.from_date IS NOT NULL
  AND COALESCE(j.to_date, j.from_date) < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
GROUP BY 1, 2
HAVING count(*) FILTER (WHERE a.id IS NULL) > 0
ORDER BY 5 DESC, 2;


-- 1e. The named exclusions, checked on the ARCHIVE side. EXPECTED: every column 0.
SELECT '1e. exclusions honoured' AS check_name,
       (SELECT count(*) FROM public.attendance_sessions_archive
         WHERE status = 'OPEN')                                    AS open_sessions_archived,
       (SELECT count(*) FROM public.attendance_sessions_archive
         WHERE in_date IS NULL)                                    AS null_in_date_archived,
       (SELECT count(*) FROM public.attendance_sessions_archive a
         WHERE COALESCE(a.out_date, a.in_date)
               >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE) AS session_span_crosses_cutoff,
       (SELECT count(*) FROM public.jatha_attendance_archive
         WHERE from_date IS NULL)                                  AS null_from_date_archived,
       (SELECT count(*) FROM public.jatha_attendance_archive a
         WHERE COALESCE(a.to_date, a.from_date)
               >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE) AS crossing_jatha_archived;


-- ============================================================================
--  §2.  FIELD FIDELITY
-- ============================================================================
-- 2a. Sessions: how many archived rows differ from their source in ANY named
--     column. IS DISTINCT FROM is NULL-safe, so a NULL standing where the source
--     had a value (or the reverse) counts as a mismatch.
--     EXPECTED: mismatched_rows = 0.
SELECT '2a. field mismatches (sessions)' AS check_name,
       count(*) AS mismatched_rows
FROM public.attendance_sessions s
JOIN public.attendance_sessions_archive a ON a.id = s.id
WHERE s.badge_number       IS DISTINCT FROM a.badge_number
   OR s.sewadar_name       IS DISTINCT FROM a.sewadar_name
   OR s.centre             IS DISTINCT FROM a.centre
   OR s.sewadar_centre     IS DISTINCT FROM a.sewadar_centre
   OR s.sewadar_dept       IS DISTINCT FROM a.sewadar_dept
   OR s.duty_type          IS DISTINCT FROM a.duty_type
   OR s.status             IS DISTINCT FROM a.status
   OR s.in_date            IS DISTINCT FROM a.in_date
   OR s.in_time            IS DISTINCT FROM a.in_time
   OR s.out_date           IS DISTINCT FROM a.out_date
   OR s.out_time           IS DISTINCT FROM a.out_time
   OR s.is_manual          IS DISTINCT FROM a.is_manual
   OR s.is_gate_entry      IS DISTINCT FROM a.is_gate_entry
   OR s.in_scanner_badge   IS DISTINCT FROM a.in_scanner_badge
   OR s.in_scanner_name    IS DISTINCT FROM a.in_scanner_name
   OR s.in_scanner_centre  IS DISTINCT FROM a.in_scanner_centre
   OR s.out_scanner_badge  IS DISTINCT FROM a.out_scanner_badge
   OR s.out_scanner_name   IS DISTINCT FROM a.out_scanner_name
   OR s.out_scanner_centre IS DISTINCT FROM a.out_scanner_centre
   OR s.entered_by_badge   IS DISTINCT FROM a.entered_by_badge
   OR s.entered_by_name    IS DISTINCT FROM a.entered_by_name
   OR s.created_at         IS DISTINCT FROM a.created_at
   OR s.updated_at         IS DISTINCT FROM a.updated_at;


-- 2a-detail. Which rows, and which column, if 2a was non-zero. EXPECTED: zero rows.
SELECT '2a-detail. first mismatches' AS check_name, s.id,
       array_remove(ARRAY[
         CASE WHEN s.badge_number       IS DISTINCT FROM a.badge_number       THEN 'badge_number' END,
         CASE WHEN s.sewadar_name       IS DISTINCT FROM a.sewadar_name       THEN 'sewadar_name' END,
         CASE WHEN s.centre             IS DISTINCT FROM a.centre             THEN 'centre' END,
         CASE WHEN s.sewadar_centre     IS DISTINCT FROM a.sewadar_centre     THEN 'sewadar_centre' END,
         CASE WHEN s.sewadar_dept       IS DISTINCT FROM a.sewadar_dept       THEN 'sewadar_dept' END,
         CASE WHEN s.duty_type          IS DISTINCT FROM a.duty_type          THEN 'duty_type' END,
         CASE WHEN s.status             IS DISTINCT FROM a.status             THEN 'status' END,
         CASE WHEN s.in_date            IS DISTINCT FROM a.in_date            THEN 'in_date' END,
         CASE WHEN s.in_time            IS DISTINCT FROM a.in_time            THEN 'in_time' END,
         CASE WHEN s.out_date           IS DISTINCT FROM a.out_date           THEN 'out_date' END,
         CASE WHEN s.out_time           IS DISTINCT FROM a.out_time           THEN 'out_time' END,
         CASE WHEN s.is_manual          IS DISTINCT FROM a.is_manual          THEN 'is_manual' END,
         CASE WHEN s.is_gate_entry      IS DISTINCT FROM a.is_gate_entry      THEN 'is_gate_entry' END,
         CASE WHEN s.in_scanner_badge   IS DISTINCT FROM a.in_scanner_badge   THEN 'in_scanner_badge' END,
         CASE WHEN s.in_scanner_name    IS DISTINCT FROM a.in_scanner_name    THEN 'in_scanner_name' END,
         CASE WHEN s.in_scanner_centre  IS DISTINCT FROM a.in_scanner_centre  THEN 'in_scanner_centre' END,
         CASE WHEN s.out_scanner_badge  IS DISTINCT FROM a.out_scanner_badge  THEN 'out_scanner_badge' END,
         CASE WHEN s.out_scanner_name   IS DISTINCT FROM a.out_scanner_name   THEN 'out_scanner_name' END,
         CASE WHEN s.out_scanner_centre IS DISTINCT FROM a.out_scanner_centre THEN 'out_scanner_centre' END,
         CASE WHEN s.entered_by_badge   IS DISTINCT FROM a.entered_by_badge   THEN 'entered_by_badge' END,
         CASE WHEN s.entered_by_name    IS DISTINCT FROM a.entered_by_name    THEN 'entered_by_name' END,
         CASE WHEN s.created_at         IS DISTINCT FROM a.created_at         THEN 'created_at' END,
         CASE WHEN s.updated_at         IS DISTINCT FROM a.updated_at         THEN 'updated_at' END
       ], NULL) AS differing_columns
FROM public.attendance_sessions s
JOIN public.attendance_sessions_archive a ON a.id = s.id
WHERE s.badge_number       IS DISTINCT FROM a.badge_number
   OR s.sewadar_name       IS DISTINCT FROM a.sewadar_name
   OR s.centre             IS DISTINCT FROM a.centre
   OR s.sewadar_centre     IS DISTINCT FROM a.sewadar_centre
   OR s.sewadar_dept       IS DISTINCT FROM a.sewadar_dept
   OR s.duty_type          IS DISTINCT FROM a.duty_type
   OR s.status             IS DISTINCT FROM a.status
   OR s.in_date            IS DISTINCT FROM a.in_date
   OR s.in_time            IS DISTINCT FROM a.in_time
   OR s.out_date           IS DISTINCT FROM a.out_date
   OR s.out_time           IS DISTINCT FROM a.out_time
   OR s.is_manual          IS DISTINCT FROM a.is_manual
   OR s.is_gate_entry      IS DISTINCT FROM a.is_gate_entry
   OR s.in_scanner_badge   IS DISTINCT FROM a.in_scanner_badge
   OR s.in_scanner_name    IS DISTINCT FROM a.in_scanner_name
   OR s.in_scanner_centre  IS DISTINCT FROM a.in_scanner_centre
   OR s.out_scanner_badge  IS DISTINCT FROM a.out_scanner_badge
   OR s.out_scanner_name   IS DISTINCT FROM a.out_scanner_name
   OR s.out_scanner_centre IS DISTINCT FROM a.out_scanner_centre
   OR s.entered_by_badge   IS DISTINCT FROM a.entered_by_badge
   OR s.entered_by_name    IS DISTINCT FROM a.entered_by_name
   OR s.created_at         IS DISTINCT FROM a.created_at
   OR s.updated_at         IS DISTINCT FROM a.updated_at
ORDER BY s.id
LIMIT 100;


-- 2b. Jatha: same shape, every live column. EXPECTED: mismatched_rows = 0.
--     The 12 columns below were confirmed against the deployed schema on
--     2026-10-18 (the first pass inferred 11 and MISSED `centre`). §2c remains the
--     general check that does not depend on this list staying complete.
SELECT '2b. field mismatches (jatha)' AS check_name,
       count(*) AS mismatched_rows
FROM public.jatha_attendance j
JOIN public.jatha_attendance_archive a ON a.id = j.id
WHERE j.badge_number    IS DISTINCT FROM a.badge_number
   OR j.sewadar_name    IS DISTINCT FROM a.sewadar_name
   OR j.sewadar_centre  IS DISTINCT FROM a.sewadar_centre
   OR j.centre          IS DISTINCT FROM a.centre
   OR j.jatha_id        IS DISTINCT FROM a.jatha_id
   OR j.from_date       IS DISTINCT FROM a.from_date
   OR j.to_date         IS DISTINCT FROM a.to_date
   OR j.remarks         IS DISTINCT FROM a.remarks
   OR j.entered_by_badge IS DISTINCT FROM a.entered_by_badge
   OR j.entered_by_name  IS DISTINCT FROM a.entered_by_name
   OR j.entered_at       IS DISTINCT FROM a.entered_at;


-- 2c. THE GENERAL FIDELITY CHECK — every column, generated from the catalogue.
--     This does not depend on any hand-written column list, so it catches a column
--     §2a/§2b never names. It is a real check, not a string to copy: it builds the
--     predicate from pg_attribute and EXECUTES it.
--     EXPECTED: two NOTICE lines ending "0 mismatched row(s)". A non-zero count
--     RAISES AN EXCEPTION, so a failure cannot be missed in a result grid — the
--     script stops instead. If the SQL Editor hides NOTICEs, the absence of an
--     error is the pass.
DO $$
DECLARE
  v_pred TEXT;
  v_bad  BIGINT;
  r      RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('attendance_sessions', 's', 'attendance_sessions_archive', 'a'),
      ('jatha_attendance',    'j', 'jatha_attendance_archive',    'a')
    ) AS t(src, src_alias, arch, arch_alias)
  LOOP
    SELECT string_agg(
             format('(%1$s.%2$I IS DISTINCT FROM %3$s.%2$I)',
                    r.src_alias, c.attname, r.arch_alias),
             ' OR ' ORDER BY c.attnum)
      INTO v_pred
    FROM pg_attribute c
    WHERE c.attrelid = to_regclass('public.' || r.src)
      AND c.attnum > 0 AND NOT c.attisdropped;

    IF v_pred IS NULL THEN
      RAISE EXCEPTION
        '2c: no columns found for public.% — does the table exist?', r.src;
    END IF;

    EXECUTE format(
      'SELECT count(*) FROM public.%1$I %2$s JOIN public.%3$I %4$s ON %4$s.id = %2$s.id WHERE %5$s',
      r.src, r.src_alias, r.arch, r.arch_alias, v_pred)
    INTO v_bad;

    RAISE NOTICE '2c. % : % mismatched row(s)', r.src, v_bad;

    IF v_bad > 0 THEN
      RAISE EXCEPTION
        '2c FAILED: % row(s) of % differ from their source in at least one column. Do not proceed to any deletion phase.',
        v_bad, r.src;
    END IF;
  END LOOP;
END $$;


-- 2d. Structural: the archive must not contain two rows sharing an id. That is
--     what the PRIMARY KEY + ON CONFLICT (id) DO NOTHING guarantees, so it is a
--     check on the guard, not on the data. EXPECTED: 0 and 0.
--     (A non-empty result from a duplicate scan on (badge_number, in_date) is a
--      DATA-QUALITY observation about the source, entirely benign, and is not a
--      check — those keys legitimately repeat.)
SELECT '2d. duplicate ids in archive' AS check_name,
       'attendance_sessions_archive' AS table_name,
       count(*) AS duplicate_id_groups
FROM (SELECT id FROM public.attendance_sessions_archive GROUP BY id HAVING count(*) > 1) d
UNION ALL
SELECT '2d. duplicate ids in archive', 'jatha_attendance_archive', count(*)
FROM (SELECT id FROM public.jatha_attendance_archive GROUP BY id HAVING count(*) > 1) d;


-- ============================================================================
--  §3.  THE LIVE TABLES WERE NOT TOUCHED
-- ============================================================================
-- 3a. Live row counts. Compare each against the preflight §B grid you recorded.
--     EXPECTED: identical to §B. A mismatch means the copy phase changed live data
--     — stop and investigate. (Counts alone cannot see an UPDATE; §3b can.)
SELECT '3a. live row count' AS check_name, 'attendance_sessions' AS table_name,
       count(*)::bigint AS row_count, max(id)::bigint AS max_id
FROM public.attendance_sessions
UNION ALL
SELECT '3a. live row count', 'jatha_attendance',
       count(*)::bigint, max(id)::bigint
FROM public.jatha_attendance
UNION ALL
SELECT '3a. live row count', 'archival_attendance (must be unchanged)',
       count(*)::bigint, max(id)::bigint
FROM public.archival_attendance;


-- 3b. Live row-text checksum. Hashes `t::text` for EVERY row — i.e. every column,
--     with no hand-written list — normalised by an explicit inner ORDER BY t.id so
--     it is stable across runs. This is the real before/after evidence: an UPDATE
--     to any column changes it, unlike a row count.
--
--     EXPECTED: byte-identical to the preflight §B value for the same table.
--     If §B was never recorded, this run is its own baseline and proves NOTHING —
--     run §B first. Comparable only within one server: the text form of a row
--     depends on the type output functions.
--     A live table that receives scans between the two runs will legitimately
--     differ; if that is possible, restrict both §B and this query to a closed id
--     window recorded in §B (max_id).
SELECT '3b. live row-text checksum' AS check_name,
       'attendance_sessions' AS table_name,
       count(*)::bigint AS row_count,
       md5(string_agg(t::text, E'\n' ORDER BY t.id)) AS live_row_text_checksum
FROM public.attendance_sessions t
UNION ALL
SELECT '3b. live row-text checksum', 'jatha_attendance',
       count(*)::bigint,
       md5(string_agg(t::text, E'\n' ORDER BY t.id))
FROM public.jatha_attendance t;


-- 3c. Every archived id must STILL exist live — BOTH tables. EXPECTED: 0 and 0.
--     A non-zero count means something removed a source row, which the copy phase
--     cannot do, and is the signal to stop before any deletion phase.
SELECT '3c. archived id no longer live' AS check_name, 'attendance_sessions_archive' AS table_name,
       count(*) AS orphaned_archive_rows
FROM public.attendance_sessions_archive a
WHERE NOT EXISTS (SELECT 1 FROM public.attendance_sessions s WHERE s.id = a.id)
UNION ALL
SELECT '3c. archived id no longer live', 'jatha_attendance_archive',
       count(*)
FROM public.jatha_attendance_archive a
WHERE NOT EXISTS (SELECT 1 FROM public.jatha_attendance j WHERE j.id = a.id);

-- 3c-detail. Which rows, if 3c was non-zero. EXPECTED: zero rows.
SELECT '3c-detail. orphaned archive rows' AS check_name, 'attendance_sessions_archive' AS table_name,
       a.id, a.badge_number, a.in_date
FROM public.attendance_sessions_archive a
WHERE NOT EXISTS (SELECT 1 FROM public.attendance_sessions s WHERE s.id = a.id)
UNION ALL
SELECT '3c-detail. orphaned archive rows', 'jatha_attendance_archive',
       a.id, a.badge_number, a.from_date
FROM public.jatha_attendance_archive a
WHERE NOT EXISTS (SELECT 1 FROM public.jatha_attendance j WHERE j.id = a.id)
ORDER BY 3
LIMIT 100;


-- ============================================================================
--  §4.  ARCHIVE HYGIENE  —  shape, provenance, RLS
-- ============================================================================
-- 4a. The archive must be exactly "the source's columns, same names, same order,
--     plus the four archive columns". EXPECTED: source_cols + 4 = archive_cols,
--     and archive_only_cols =
--     'archive_batch, archived_at, archived_by, source_table'.
--     This is the structural counterpart to the schema file's mirror guard. It
--     replaces an earlier check that compared archive ids against
--     archival_attendance.id — two unrelated identity sequences that start at 1 and
--     therefore overlap massively. That comparison measured nothing.
SELECT '4a. archive column set' AS check_name, 'attendance_sessions' AS source_table,
       (SELECT count(*) FROM pg_attribute
         WHERE attrelid = to_regclass('public.attendance_sessions')
           AND attnum > 0 AND NOT attisdropped)::int     AS source_cols,
       (SELECT count(*) FROM pg_attribute
         WHERE attrelid = to_regclass('public.attendance_sessions_archive')
           AND attnum > 0 AND NOT attisdropped)::int     AS archive_cols,
       (SELECT string_agg(x.attname, ', ' ORDER BY x.attname)
          FROM pg_attribute x
         WHERE x.attrelid = to_regclass('public.attendance_sessions_archive')
           AND x.attnum > 0 AND NOT x.attisdropped
           AND NOT EXISTS (
             SELECT 1 FROM pg_attribute y
             WHERE y.attrelid = to_regclass('public.attendance_sessions')
               AND y.attnum > 0 AND NOT y.attisdropped
               AND y.attname = x.attname))               AS archive_only_cols
UNION ALL
SELECT '4a. archive column set', 'jatha_attendance',
       (SELECT count(*) FROM pg_attribute
         WHERE attrelid = to_regclass('public.jatha_attendance')
           AND attnum > 0 AND NOT attisdropped)::int,
       (SELECT count(*) FROM pg_attribute
         WHERE attrelid = to_regclass('public.jatha_attendance_archive')
           AND attnum > 0 AND NOT attisdropped)::int,
       (SELECT string_agg(x.attname, ', ' ORDER BY x.attname)
          FROM pg_attribute x
         WHERE x.attrelid = to_regclass('public.jatha_attendance_archive')
           AND x.attnum > 0 AND NOT x.attisdropped
           AND NOT EXISTS (
             SELECT 1 FROM pg_attribute y
             WHERE y.attrelid = to_regclass('public.jatha_attendance')
               AND y.attnum > 0 AND NOT y.attisdropped
               AND y.attname = x.attname));


-- 4b. Provenance columns populated. EXPECTED: 0, 0, 0, 0, 0, 0 on any completed
--     archive (all six columns zero). wrong_source_table is additionally enforced
--     by a CHECK constraint on each archive table, so it should be impossible.
--     first/last archived_at are provenance only — with chunked copies spanning
--     days there is no "within the last day" rule to assert.
SELECT '4b. archive metadata' AS check_name, 'attendance_sessions_archive' AS table_name,
       count(*) FILTER (WHERE archive_batch IS NULL)     AS null_batch,
       count(*) FILTER (WHERE archived_by   IS NULL)     AS null_archived_by,
       count(*) FILTER (WHERE source_table <> 'attendance_sessions') AS wrong_source_table,
       min(archived_at) AS first_archived_at,
       max(archived_at) AS last_archived_at
FROM public.attendance_sessions_archive
UNION ALL
SELECT '4b. archive metadata', 'jatha_attendance_archive',
       count(*) FILTER (WHERE archive_batch IS NULL),
       count(*) FILTER (WHERE archived_by   IS NULL),
       count(*) FILTER (WHERE source_table <> 'jatha_attendance'),
       min(archived_at), max(archived_at)
FROM public.jatha_attendance_archive;


-- 4c. RLS state and the actual policy predicate. EXPECTED: rls_enabled = true,
--     policy_count = 1, and the qual text naming has_permission and
--     get_user_accessible_centres. rls_forced = false is normal and expected —
--     it is shown because RLS does NOT apply to a table's OWNER unless the table
--     is FORCEd, which is why §0 must confirm you are running as the owner.
SELECT '4c. rls on archive tables' AS check_name,
       c.relname        AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policy_count,
       (SELECT string_agg(p.policyname || ' [' || p.cmd || '] -> ' || COALESCE(p.qual, '(none)'), ' | ')
          FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies_and_quals
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('attendance_sessions_archive', 'jatha_attendance_archive')
ORDER BY c.relname;
