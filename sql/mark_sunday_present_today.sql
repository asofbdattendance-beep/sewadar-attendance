-- ============================================================
-- mark_sunday_present_today.sql
--
-- PURPOSE
--   In archival_attendance, mark the sewadars who were on Daily duty (D)
--   on the LATEST SUNDAY as "present today" by inserting a copy of their
--   record with duty_date = today (2026-08-30).
--
-- RULES
--   - Copies ONLY Daily (D) duty records from the latest Sunday (2026-08-23).
--   - JMC and other duty types are NOT copied.
--   - Only INSERTs; no existing rows are modified or deleted.
--   - Idempotent: skips any badge that already has a D record on the target
--     date, so re-running adds 0 rows.
--
-- Expected result: 2,254 new rows inserted for 2026-08-30.
-- ============================================================

INSERT INTO public.archival_attendance (
  sewadar_name, badge_number, father_husband_name, gender, age,
  department_name, department_id, area_name, centre_name, status,
  duty_type, duty_date, deployed_department, deployed_centre
)
SELECT
  sewadar_name, badge_number, father_husband_name, gender, age,
  department_name, department_id, area_name, centre_name, status,
  'D' AS duty_type,
  DATE '2026-08-30' AS duty_date,
  deployed_department, deployed_centre
FROM public.archival_attendance src
WHERE src.duty_date = DATE '2026-08-23'
  AND src.duty_type = 'D'
  AND NOT EXISTS (
    SELECT 1 FROM public.archival_attendance tgt
    WHERE tgt.badge_number = src.badge_number
      AND tgt.duty_date = DATE '2026-08-30'
      AND tgt.duty_type = 'D'
  );
