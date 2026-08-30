-- ============================================================
-- Restore the SEWADAR ATTENDANCE app after the shared DB was corrupted
-- by deployment-portal migration v26 (v26_attendance.sql).
--
-- v26 dropped the attendance app's attendance_sessions (it lacked schedule_id)
-- and replaced it with the portal's incompatible schema (uuid id, schedule_id,
-- uuid sewadar_dept, no duty_type/is_gate_entry/entered_by_*). It also rewrote
-- get_sewadar_by_badge to RETURNS jsonb and added att_read/att_insert/att_update.
--
-- THIS SCRIPT:
--   1. Removes the PORTAL-version attendance_sessions (only if it has schedule_id,
--      so a valid attendance table is never touched) and recreates the attendance
--      one from sql/attendance_sessions_schema.sql.
--   2. Drops the portal's conflicting helpers (get_sewadar_by_badge stays whatever
--      it is; rls_policies_all.sql handles it deterministically).
--   3. Hand-off note: you MUST then run rls_policies_all.sql to recreate all the
--      attendance policies + RPCs.
--
-- ⚠️ DATA WARNING: v26 already DROPped the original attendance_sessions CASCADE.
--    If you have a backup/export of that table, restore it after step 1.
--    If the portal's current table still holds attendance-app-shaped rows whose
--    badge_number exists in public.sewadars, run the "PRESERVE data" block at the
--    bottom FIRST so those rows are migrated, not lost.
-- ============================================================

-- 0. PRE-FLIGHT: check what's currently on the table (read-only)
DO $$
DECLARE
  v_has_schedule boolean;
  v_is_portal boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='attendance_sessions' AND column_name='schedule_id'
  ) INTO v_has_schedule;

  IF to_regclass('public.attendance_sessions') IS NULL THEN
    RAISE NOTICE 'attendance_sessions does not exist yet — will be created fresh.';
  ELSIF v_has_schedule THEN
    RAISE NOTICE 'attendance_sessions has schedule_id = PORTAL schema present (v26 replaced it).';
  ELSE
    RAISE NOTICE 'attendance_sessions has NO schedule_id = attendance schema already present.';
  END IF;
END $$;

-- 1. Drop the PORTAL-version table ONLY (v26's, which has schedule_id).
--    Uses CASCADE to also drop the portal's att_read/att_insert/att_update policies
--    and portal triggers referencing it. A correct attendance table is never dropped.
DO $$
BEGIN
  IF to_regclass('public.attendance_sessions') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='attendance_sessions' AND column_name='schedule_id'
     ) THEN
    DROP TABLE public.attendance_sessions CASCADE;
    RAISE NOTICE 'Dropped portal-version attendance_sessions (had schedule_id).';
  ELSE
    RAISE NOTICE 'Skipped drop — attendance_sessions is not the portal schema (no schedule_id).';
  END IF;
END $$;

-- 2. Recreate the ATTENDANCE app's attendance_sessions + populate trigger + indexes.
--    (Run the contents of sql/attendance_sessions_schema.sql here, or execute that
--    file now.)
-- >>> EXECUTE sql/attendance_sessions_schema.sql NOW <<<
CREATE TABLE public.attendance_sessions (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  badge_number       TEXT NOT NULL,
  CONSTRAINT fk_attendance_sessions_badge FOREIGN KEY (badge_number)
    REFERENCES public.sewadars(badge_number) ON DELETE SET NULL,
  sewadar_name       TEXT,
  centre             TEXT NOT NULL,
  sewadar_centre     TEXT,
  sewadar_dept       TEXT,
  duty_type          TEXT NOT NULL DEFAULT 'DAILY'::text
                     CHECK (duty_type IN ('SATSCAN', 'DAILY', 'NIGHT', 'WATCH_AND_WARD', 'JATHA')),
  status             TEXT NOT NULL DEFAULT 'OPEN'::text
                     CHECK (status IN ('OPEN', 'CLOSED')),
  in_date            DATE NOT NULL,
  in_time            TIME,
  out_date           DATE,
  out_time           TIME,
  is_manual          BOOLEAN NOT NULL DEFAULT false,
  is_gate_entry      BOOLEAN NOT NULL DEFAULT false,
  in_scanner_badge   TEXT,
  in_scanner_name    TEXT,
  in_scanner_centre  TEXT,
  out_scanner_badge  TEXT,
  out_scanner_name   TEXT,
  out_scanner_centre TEXT,
  entered_by_badge   TEXT,
  entered_by_name    TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.trg_att_populate_sewadar()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_centre TEXT; v_dept TEXT;
BEGIN
  SELECT centre, department INTO v_centre, v_dept
  FROM public.sewadars WHERE badge_number = NEW.badge_number;
  NEW.sewadar_centre := COALESCE(NEW.sewadar_centre, v_centre);
  NEW.sewadar_dept   := COALESCE(NEW.sewadar_dept, v_dept);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_att_populate_sewadar ON public.attendance_sessions;
CREATE TRIGGER trg_att_populate_sewadar
  BEFORE INSERT OR UPDATE OF badge_number ON public.attendance_sessions
  FOR EACH ROW EXECUTE FUNCTION public.trg_att_populate_sewadar();

CREATE INDEX IF NOT EXISTS idx_attsess_in_date  ON public.attendance_sessions (in_date DESC, in_time DESC);
CREATE INDEX IF NOT EXISTS idx_attsess_centre   ON public.attendance_sessions (centre);
CREATE INDEX IF NOT EXISTS idx_attsess_status   ON public.attendance_sessions (status);
CREATE INDEX IF NOT EXISTS idx_attsess_badge    ON public.attendance_sessions (badge_number);

-- 3. Mandatory hand-off: recreate ALL attendance policies + helper + RPC functions.
-- >>> THEN run rls_policies_all.sql NOW <<<
-- (no statement here — next step is to run rls_policies_all.sql in the SQL editor)

-- ============================================================
-- OPTIONAL — PRESERVE ATTENDANCE-APP-SHAPED ROWS STILL IN THE PORTAL TABLE
-- Run this BEFORE step 1 ONLY if the portal table still holds attendance-app rows
-- (rows whose badge_number exists in public.sewadars and that have in_date/in_time).
-- It copies them into a staging area so you can re-insert after the rebuild.
-- ============================================================
-- CREATE TABLE public._att_recovery AS
-- SELECT badge_number, sewadar_name, centre, sewadar_centre, sewadar_dept::text AS sewadar_dept,
--        'gate_entry'::text AS duty_type, status, in_date, in_time, out_date, out_time,
--        is_manual, false AS is_gate_entry,
--        in_scanner_badge, in_scanner_name, in_scanner_centre,
--        out_scanner_badge, out_scanner_name, out_scanner_centre,
--        NULL::text AS entered_by_badge, NULL::text AS entered_by_name, created_at, updated_at
-- FROM public.attendance_sessions
-- WHERE badge_number IN (SELECT badge_number FROM public.sewadars)
--   AND in_date IS NOT NULL;
