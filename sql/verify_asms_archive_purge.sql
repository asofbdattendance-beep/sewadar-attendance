-- ============================================================================
--  ASMS ARCHIVE — POST-PURGE VERIFICATION      (read-only, changes nothing)
-- ============================================================================
--  Run AFTER sql/asms_archive_purge.sql. Every statement is self-contained and
--  read-only. Read as `postgres` in the SQL Editor.
--
--  WHY THIS IS NOT verify_asms_archive.sql
--    That file proves the COPY was complete and that the live tables were
--    untouched — correct for phase 1, and its §3c ("no archive id is missing from
--    live") is the exact inverse of what a purge makes true. After the purge, an
--    archived id SHOULD be absent from live. So §3c must not be re-run as a
--    pass/fail gate here; use the checks below instead.
--
--  THE FOUR CLAIMS
--    C1  every eligible row is gone from live                        -> §1
--    C2  every survivor is still there, by reason                    -> §2
--    C3  the archive is unchanged and complete                       -> §3
--    C4  every absence is explained by the purge predicate, and the
--        live arithmetic closes                                  -> §4, §5
--
--  PRE-PURGE NUMBERS TO COMPARE AGAINST (from the §1b preview and the delete
--  NOTICs, plus the preflight §B baseline):
--    sessions_live_before, jatha_live_before
--    sessions_deleted (NOTICE 2a), jatha_deleted (NOTICE 2b)
--    sessions_archive_before, jatha_archive_before
-- ============================================================================


-- ============================================================================
--  0.  WHICH ROLE AM I?  (RLS is runner-scoped: `postgres` bypasses it, so this
--      run proves data state, NOT what a gated user can see)
-- ============================================================================
SELECT current_user, session_user,
       (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser,
       (SELECT count(*) FROM pg_roles WHERE rolname = current_user AND rolbypassrls) AS bypassrls;


-- ============================================================================
--  1.  C1 — THE ELIGIBLE SET IS NOW EMPTY   (EXPECTED: 0 and 0)
-- ============================================================================
SELECT '1a. sessions still eligible (EXPECT 0)' AS check_name,
       count(*) AS rows_still_live
FROM public.attendance_sessions s
WHERE s.in_date < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
  AND COALESCE(s.out_date, s.in_date) < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
  AND s.status IS DISTINCT FROM 'OPEN';

SELECT '1b. jatha still eligible (EXPECT 0)' AS check_name,
       count(*) AS rows_still_live
FROM public.jatha_attendance j
WHERE j.from_date IS NOT NULL
  AND COALESCE(j.to_date, j.from_date) < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE;


-- ============================================================================
--  2.  C2 — SURVIVORS INTACT   (each must match its pre-purge §1b value)
-- ============================================================================
SELECT '2. sessions survivors' AS check_name, 'total live' AS reason, count(*) AS rows_now
FROM public.attendance_sessions
UNION ALL
SELECT '2. sessions survivors', 'still OPEN', count(*)
FROM public.attendance_sessions WHERE status = 'OPEN'
UNION ALL
SELECT '2. sessions survivors', 'recent or span crosses cutoff', count(*)
FROM public.attendance_sessions
 WHERE in_date >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
    OR COALESCE(out_date, in_date) >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
UNION ALL
SELECT '2. sessions survivors', 'in_date IS NULL', count(*)
FROM public.attendance_sessions WHERE in_date IS NULL
UNION ALL
SELECT '2. jatha survivors', 'total live', count(*)
FROM public.jatha_attendance
UNION ALL
SELECT '2. jatha survivors', 'from_date IS NULL', count(*)
FROM public.jatha_attendance WHERE from_date IS NULL
UNION ALL
SELECT '2. jatha survivors', 'recent or crosses cutoff', count(*)
FROM public.jatha_attendance
 WHERE from_date IS NOT NULL
   AND COALESCE(to_date, from_date) >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE;


-- ============================================================================
--  3.  C3 — THE ARCHIVE IS UNCHANGED   (purge must not have written to it)
-- ============================================================================
SELECT '3a. archive totals (EXPECT: same as pre-purge)' AS check_name,
       (SELECT count(*) FROM public.attendance_sessions_archive) AS sessions_archive_rows,
       (SELECT count(*) FROM public.jatha_attendance_archive)    AS jatha_archive_rows;

-- 3b. Provenance must be untouched: one batch, one archiver, no NULLs leaked in.
SELECT '3b. sessions provenance' AS check_name,
       archive_batch, archived_by, source_table, count(*) AS rows
FROM public.attendance_sessions_archive
GROUP BY archive_batch, archived_by, source_table
UNION ALL
SELECT '3b. jatha provenance',
       archive_batch, archived_by, source_table, count(*)
FROM public.jatha_attendance_archive
GROUP BY archive_batch, archived_by, source_table;

-- 3c. Duplicate ids in the archive would mean a broken PK. EXPECT: 0 rows.
SELECT '3c. duplicate archive ids (EXPECT no rows)' AS check_name,
       'sessions' AS tbl, id, count(*) AS n
FROM public.attendance_sessions_archive GROUP BY id HAVING count(*) > 1
UNION ALL
SELECT '3c. duplicate archive ids (EXPECT no rows)', 'jatha', id, count(*)
FROM public.jatha_attendance_archive GROUP BY id HAVING count(*) > 1;


-- ============================================================================
--  4.  C4 — EVERY ABSENCE IS EXPLAINED BY THE PURGE PREDICATE
--      (EXPECT: 0 and 0)
-- ============================================================================
-- An archived row that is absent from live is FINE if the row's own values satisfy
-- the purge predicate, and ALARMING if they do not — that would be a row removed
-- for a reason the purge was never authorised to use. Eligibility is re-evaluated
-- from the ARCHIVE's own columns, so this needs nothing but the archive.
SELECT '4a. unexplained session absences (EXPECT 0)' AS check_name,
       count(*) AS rows_missing_unexplained
FROM public.attendance_sessions_archive a
WHERE NOT EXISTS (SELECT 1 FROM public.attendance_sessions s WHERE s.id = a.id)
  AND NOT (
        a.in_date < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
    AND COALESCE(a.out_date, a.in_date) < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
    AND a.status IS DISTINCT FROM 'OPEN'
  );

SELECT '4b. unexplained jatha absences (EXPECT 0)' AS check_name,
       count(*) AS rows_missing_unexplained
FROM public.jatha_attendance_archive a
WHERE NOT EXISTS (SELECT 1 FROM public.jatha_attendance j WHERE j.id = a.id)
  AND NOT (
        a.from_date IS NOT NULL
    AND COALESCE(a.to_date, a.from_date) < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
  );

-- 4c. The mirror image: an eligible-looking archived row that is STILL live means
--     the purge silently skipped rows it should have taken. EXPECT: 0.
SELECT '4c. eligible archive rows still live (EXPECT 0)' AS check_name,
       count(*) AS rows
FROM public.attendance_sessions_archive a
WHERE EXISTS (SELECT 1 FROM public.attendance_sessions s WHERE s.id = a.id)
  AND a.in_date < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
  AND COALESCE(a.out_date, a.in_date) < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
  AND a.status IS DISTINCT FROM 'OPEN';


-- ============================================================================
--  5.  C4 — THE ARITHMETIC CLOSES
--      live_now must equal live_before minus the rows the NOTICEs reported.
--      Fill the two "before" numbers in from the §1b preview / preflight §B.
-- ============================================================================
WITH n AS (
  SELECT (SELECT count(*) FROM public.attendance_sessions) AS live_now,
         (SELECT count(*) FROM public.attendance_sessions_archive) AS arch,
         -- >>> EDIT: sessions_live_before from §1b, sessions_deleted from NOTICE 2a
         NULL::BIGINT AS live_before,
         NULL::BIGINT AS deleted
)
SELECT '5a. sessions arithmetic' AS check_name,
       live_now, arch, live_before, deleted,
       (live_before - deleted) AS expected_now,
       CASE WHEN live_before IS NULL THEN 'SET live_before + deleted'
            WHEN live_now = live_before - deleted THEN 'OK'
            ELSE 'MISMATCH — investigate before trusting the purge' END AS verdict
FROM n
UNION ALL
SELECT '5b. jatha arithmetic',
       (SELECT count(*) FROM public.jatha_attendance),
       (SELECT count(*) FROM public.jatha_attendance_archive),
       NULL, NULL, NULL, 'SET live_before + deleted';

-- 5c. Nothing was removed from the OTHER dataset. Compare to the preflight §B value.
SELECT '5c. archival_attendance untouched' AS check_name, count(*) AS rows_now
FROM public.archival_attendance;


-- ============================================================================
--  6.  STILL READ-ONLY, STILL GATED  (the purge must not have widened access)
-- ============================================================================
SELECT '6a. sessions_archive access' AS check_name, c.relrowsecurity AS rls_on,
       c.relforcerowsecurity AS rls_forced,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'attendance_sessions_archive') AS policies,
       has_table_privilege('authenticated', 'public.attendance_sessions_archive', 'SELECT') AS auth_can_select,
       has_table_privilege('authenticated', 'public.attendance_sessions_archive', 'INSERT') AS auth_can_insert,
       has_table_privilege('authenticated', 'public.attendance_sessions_archive', 'UPDATE') AS auth_can_update,
       has_table_privilege('authenticated', 'public.attendance_sessions_archive', 'DELETE') AS auth_can_delete
FROM pg_class c WHERE c.oid = to_regclass('public.attendance_sessions_archive')
UNION ALL
SELECT '6a. jatha_archive access', c.relrowsecurity, c.relforcerowsecurity,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'jatha_attendance_archive'),
       has_table_privilege('authenticated', 'public.jatha_attendance_archive', 'SELECT'),
       has_table_privilege('authenticated', 'public.jatha_attendance_archive', 'INSERT'),
       has_table_privilege('authenticated', 'public.jatha_attendance_archive', 'UPDATE'),
       has_table_privilege('authenticated', 'public.jatha_attendance_archive', 'DELETE')
FROM pg_class c WHERE c.oid = to_regclass('public.jatha_attendance_archive');

-- 6b. The live tables' own policies must be exactly what they were. EXPECT: the
--     same set as the preflight §E / §B listing — the purge touches rows, not DDL.
SELECT '6b. live policies' AS check_name, tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('attendance_sessions', 'jatha_attendance')
ORDER BY tablename, policyname;
