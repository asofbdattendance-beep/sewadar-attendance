-- ============================================================================
--  ASMS ARCHIVE — PREFLIGHT  (READ-ONLY. THE DRY RUN.)
-- ============================================================================
--  Reads only the two live source tables, archival_attendance and the system
--  catalogue. Writes nothing, changes nothing, creates nothing.
--
--  RUN THIS BEFORE asms_archive_backfill.sql AND RECORD THE OUTPUT, especially
--  §B. §B is the before-image that verify_asms_archive.sql §3 compares against;
--  without it a "the live tables were unchanged" verdict has no anchor.
--
--  RUN AS `postgres` (i.e. paste into the Supabase SQL Editor). Row-level security
--  is scoped to the RUNNER: any other role sees a subset of rows and the counts
--  below silently become that role's slice, not the database's.
--
--  Each section below is ONE self-contained statement. A WITH clause belongs to a
--  single statement, so nothing here depends on a CTE defined in another section —
--  it would go out of scope at the previous semicolon.
--
--  The cutoff is computed, never hardcoded:
--    keep live : current calendar month + previous calendar month (Asia/Kolkata)
--    archive   : everything strictly before the 1st of the previous month
--    as of 2026-10-18 IST -> 2026-09-01
-- ============================================================================


-- ============================================================================
--  §A. WHAT WOULD MOVE  (headline counts and the eligibility split)
-- ============================================================================
WITH p AS (
  SELECT
    (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE AS today_ist,
    date_trunc(
      'month',
      (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month'
    )::DATE AS cutoff
)
SELECT 'today (Asia/Kolkata)' AS check, p.today_ist::text AS value,
       'the clock every cutoff decision is made against' AS note
FROM p
UNION ALL
SELECT 'retention cutoff', p.cutoff::text,
       'records STRICTLY BEFORE this are eligible; current + previous month stay live'
FROM p

-- ------------------------------------------------- sessions
UNION ALL
SELECT 'attendance_sessions — total rows', count(*)::text, ''
FROM public.attendance_sessions, p
UNION ALL
SELECT 'attendance_sessions — before cutoff (all statuses)', count(*)::text, ''
FROM public.attendance_sessions, p WHERE in_date < p.cutoff
UNION ALL
SELECT 'attendance_sessions — WILL BE COPIED', count(*)::text,
       'in_date < cutoff AND COALESCE(out_date,in_date) < cutoff AND status IS DISTINCT FROM ''OPEN'''
FROM public.attendance_sessions, p
WHERE in_date < p.cutoff
  AND COALESCE(out_date, in_date) < p.cutoff
  AND status IS DISTINCT FROM 'OPEN'
UNION ALL
SELECT 'attendance_sessions — EXCLUDED: still OPEN before cutoff', count(*)::text,
       'kept live on purpose — never archived'
FROM public.attendance_sessions, p
WHERE in_date < p.cutoff AND status = 'OPEN'
UNION ALL
SELECT 'attendance_sessions — EXCLUDED: span crosses the cutoff', count(*)::text,
       'in_date < cutoff but COALESCE(out_date,in_date) >= cutoff — the session''s own span reaches into the retention window'
FROM public.attendance_sessions, p
WHERE in_date < p.cutoff AND COALESCE(out_date, in_date) >= p.cutoff

-- ------------------------------------------------- jatha
UNION ALL
SELECT 'jatha_attendance — total rows', count(*)::text, ''
FROM public.jatha_attendance, p
UNION ALL
SELECT 'jatha_attendance — WILL BE COPIED', count(*)::text,
       'from_date IS NOT NULL AND COALESCE(to_date,from_date) < cutoff'
FROM public.jatha_attendance, p
WHERE from_date IS NOT NULL AND COALESCE(to_date, from_date) < p.cutoff
UNION ALL
SELECT 'jatha_attendance — EXCLUDED: interval crosses the cutoff', count(*)::text,
       'to_date >= cutoff — the interval is not wholly in the past'
FROM public.jatha_attendance, p
WHERE from_date IS NOT NULL AND COALESCE(to_date, from_date) >= p.cutoff
UNION ALL
SELECT 'jatha_attendance — EXCLUDED: NULL from_date', count(*)::text,
       'not datable, so it cannot be placed in a month; resolve before any deletion phase'
FROM public.jatha_attendance, p WHERE from_date IS NULL

-- ------------------------------------------------- open decision, made visible
UNION ALL
SELECT 'jatha_attendance — OPEN DECISION: to_date IS NULL, from_date < cutoff', count(*)::text,
       'read as a single-day entry (the reading check_jatha_overlap uses) and therefore ARCHIVED. If NULL to_date means "still deployed", these must stay live.'
FROM public.jatha_attendance, p
WHERE from_date IS NOT NULL AND to_date IS NULL AND from_date < p.cutoff

-- ------------------------------------------------- data-quality flags (kept, not dropped)
UNION ALL
SELECT 'attendance_sessions — NULL badge_number, will be copied', count(*)::text,
       'copied anyway; flagged only so the count is not a surprise'
FROM public.attendance_sessions, p
WHERE in_date < p.cutoff AND COALESCE(out_date, in_date) < p.cutoff
  AND status IS DISTINCT FROM 'OPEN' AND badge_number IS NULL
UNION ALL
SELECT 'attendance_sessions — NULL sewadar_name, will be copied', count(*)::text,
       'copied anyway; flagged only so the count is not a surprise'
FROM public.attendance_sessions, p
WHERE in_date < p.cutoff AND COALESCE(out_date, in_date) < p.cutoff
  AND status IS DISTINCT FROM 'OPEN' AND sewadar_name IS NULL
UNION ALL
SELECT 'attendance_sessions — NULL status before cutoff', count(*)::text,
       'copied (status IS DISTINCT FROM ''OPEN'' is NULL-safe); a data-quality signal'
FROM public.attendance_sessions, p WHERE in_date < p.cutoff AND status IS NULL
UNION ALL
SELECT 'attendance_sessions — NULL in_date (never eligible)', count(*)::text,
       'cannot be dated, so it can never be placed in a month — stays live'
FROM public.attendance_sessions, p WHERE in_date IS NULL
UNION ALL
SELECT 'jatha_attendance — NULL badge_number, will be copied', count(*)::text,
       'copied anyway; flagged only so the count is not a surprise'
FROM public.jatha_attendance, p
WHERE from_date IS NOT NULL AND COALESCE(to_date, from_date) < p.cutoff
  AND badge_number IS NULL
UNION ALL
SELECT 'jatha_attendance — NULL sewadar_name, will be copied', count(*)::text,
       'copied anyway; flagged only so the count is not a surprise'
FROM public.jatha_attendance, p
WHERE from_date IS NOT NULL AND COALESCE(to_date, from_date) < p.cutoff
  AND sewadar_name IS NULL

-- ------------------------------------------------- archive state, if it exists
UNION ALL
SELECT 'archive tables present?',
       CASE
         WHEN to_regclass('public.attendance_sessions_archive') IS NOT NULL
          AND to_regclass('public.jatha_attendance_archive')    IS NOT NULL THEN 'both'
         WHEN to_regclass('public.attendance_sessions_archive') IS NULL
          AND to_regclass('public.jatha_attendance_archive')    IS NULL THEN 'neither — run asms_archive_schema.sql first'
         ELSE 'PARTIAL — one is missing; re-run asms_archive_schema.sql'
       END,
       'checked with to_regclass, so a missing table is reported rather than erroring'
FROM p;


-- ============================================================================
--  §B. BASELINE TO RECORD  —  the before-image for verify §3
-- ============================================================================
-- Copy this grid somewhere before running the backfill. verify_asms_archive.sql
-- §3 compares the live tables against exactly these numbers. Row counts alone are
-- not enough (an UPDATE leaves counts identical), so the checksum over the whole
-- row text is the real evidence.
--
-- live_row_text_checksum hashes `t::text` for every row, ordered by id. That is
-- every column, with no hand-written column list to go stale, and it is
-- order-normalised by the explicit inner ORDER BY. It is comparable only between
-- runs on the same server (it depends on the type output functions) — which is
-- exactly the before/after window this is for.
SELECT 'attendance_sessions' AS table_name,
       count(*)::bigint          AS row_count,
       max(id)::bigint           AS max_id,
       md5(string_agg(t::text, E'\n' ORDER BY t.id)) AS live_row_text_checksum
FROM public.attendance_sessions t
UNION ALL
SELECT 'jatha_attendance',
       count(*)::bigint, max(id)::bigint,
       md5(string_agg(t::text, E'\n' ORDER BY t.id))
FROM public.jatha_attendance t
UNION ALL
SELECT 'archival_attendance (must be unchanged)',
       count(*)::bigint, max(id)::bigint,
       md5(string_agg(t::text, E'\n' ORDER BY t.id))
FROM public.archival_attendance t;


-- ============================================================================
--  §C. MONTHLY BREAKDOWN  —  sanity-check the cutoff before committing to a copy
-- ============================================================================
-- EXPECTED: the months below the cutoff line are the ones that move.
SELECT to_char(s.in_date, 'YYYY-MM') AS period,
       count(*)                                                      AS total_rows,
       count(*) FILTER (WHERE s.status IS DISTINCT FROM 'OPEN')       AS eligible,
       count(*) FILTER (WHERE s.status = 'OPEN')                      AS still_open,
       count(*) FILTER (WHERE COALESCE(s.out_date, s.in_date)
                          >= date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE) AS span_crosses_cutoff
FROM public.attendance_sessions s
WHERE s.in_date IS NOT NULL
GROUP BY 1
ORDER BY 1;


-- ============================================================================
--  §D. PER-CENTRE BREAKDOWN  —  proves the centre axis, so a later deletion phase
--  cannot be justified by a count that hides one centre
-- ============================================================================
-- 4a. By SCAN centre (s.centre) — the axis the live sessions_read policy scopes on.
SELECT 'sessions by scan centre' AS axis, s.centre,
       count(*) AS candidates
FROM public.attendance_sessions s
WHERE s.in_date < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
  AND COALESCE(s.out_date, s.in_date) < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
  AND s.status IS DISTINCT FROM 'OPEN'
GROUP BY 1, 2
ORDER BY 2;

-- 4b. By HOME centre (s.sewadar_centre). This is the OTHER axis centre-scoped users
-- read through (the badge_number -> sewadars.centre fallback), and it had no
-- coverage breakdown at all. A denormalised snapshot, so it can be NULL.
SELECT 'sessions by home centre' AS axis, s.sewadar_centre,
       count(*) AS candidates
FROM public.attendance_sessions s
WHERE s.in_date < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
  AND COALESCE(s.out_date, s.in_date) < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
  AND s.status IS DISTINCT FROM 'OPEN'
GROUP BY 1, 2
ORDER BY 2;

-- 4c. Jatha by home centre.
SELECT 'jatha by home centre' AS axis, j.sewadar_centre,
       count(*) AS candidates
FROM public.jatha_attendance j
WHERE j.from_date IS NOT NULL
  AND COALESCE(j.to_date, j.from_date) < date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE - interval '1 month')::DATE
GROUP BY 1, 2
ORDER BY 2;


-- ============================================================================
--  §E. SOURCE SHAPE  —  what the mirror will copy, and what the guards assert
-- ============================================================================
-- EXPECTED: nothing surprising. If `id` is a legacy BIGSERIAL rather than an
-- identity column, asms_archive_schema.sql drops the inherited nextval default
-- (see the comment there) — that is a no-op, not a fault.
SELECT c.table_name,
       c.ordinal_position,
       c.column_name,
       c.data_type,
       c.is_nullable,
       c.column_default,
       c.is_identity,
       c.is_generated
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name IN ('attendance_sessions', 'jatha_attendance')
ORDER BY c.table_name, c.ordinal_position;
