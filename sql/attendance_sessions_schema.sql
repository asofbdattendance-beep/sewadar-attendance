-- ============================================================
-- attendance_sessions — canonical DDL for the SEWADAR ATTENDANCE app.
--
-- WHY THIS FILE EXISTS
--   The sewardar-attendance and sewadar-deployment-portal projects originally
--   SHARED one Supabase database (lnznhbwgkusgdcmvgznf). Portal migration v26
--   (v26_attendance.sql) defines a DIFFERENT, incompatible attendance_sessions
--   (uuid id, schedule_id uuid NOT NULL, sewadar_dept uuid, no duty_type /
--   is_gate_entry / entered_by_*). Its DO-block drops any attendance_sessions
--   that lacks schedule_id, so running it erased the attendance app's table.
--
--   This file is the versioned source of truth for the ATTENDANCE app's table
--   so the two projects can be separated into their own databases and this table
--   can be recreated correctly. It is intentionally standalone.
--
-- NOTE: preserve data before dropping/rebuilding on the live DB.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  badge_number       TEXT NOT NULL,
  CONSTRAINT fk_attendance_sessions_badge FOREIGN KEY (badge_number)
    REFERENCES public.sewadars(badge_number) ON DELETE SET NULL,
  sewadar_name       TEXT,
  centre             TEXT NOT NULL,             -- scan centre (where scanned)
  sewadar_centre     TEXT,                      -- home centre (denormalized)
  sewadar_dept       TEXT,                      -- home department (denormalized)
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

-- Auto-populate denormalized home centre/dept from sewadars (RPC also reads them)
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

-- Indexes used by get_session_records / Reports
CREATE INDEX IF NOT EXISTS idx_attsess_in_date  ON public.attendance_sessions (in_date DESC, in_time DESC);
CREATE INDEX IF NOT EXISTS idx_attsess_centre   ON public.attendance_sessions (centre);
CREATE INDEX IF NOT EXISTS idx_attsess_status   ON public.attendance_sessions (status);
CREATE INDEX IF NOT EXISTS idx_attsess_badge    ON public.attendance_sessions (badge_number);

-- NOTE: RLS policies, get_session_records, close_session, etc. are all (re)created
-- by rls_policies_all.sql — run that file AFTER this table exists.
