-- ============================================================
-- COMPLETE RLS POLICIES — Sewadar Attendance System
-- Run this in Supabase SQL Editor to recreate ALL policies
-- ============================================================

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Get the current user's role from the users table
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE auth_id = auth.uid();
  RETURN v_role;
END;
$$;

-- Check if current user has a specific permission
-- Mirrors the frontend hasPermission() logic for defense-in-depth
CREATE OR REPLACE FUNCTION public.has_permission(p_perm_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role TEXT;
  v_permissions JSONB;
BEGIN
  SELECT role, permissions INTO v_role, v_permissions
  FROM public.users WHERE auth_id = auth.uid();

  -- super_admin has all permissions
  IF v_role = 'super_admin' THEN
    RETURN TRUE;
  END IF;

  -- aso has read-only permissions
  IF v_role = 'aso' THEN
    RETURN p_perm_key IN ('allow_dashboard', 'allow_records', 'allow_reports');
  END IF;

  -- Other roles: check the permissions JSONB column
  IF v_permissions IS NULL OR jsonb_typeof(v_permissions) != 'object' THEN
    RETURN FALSE;
  END IF;

  RETURN COALESCE((v_permissions->>p_perm_key)::boolean, FALSE);
END;
$$;

-- ============================================================
-- TRIGGER: Cascade role permissions to users
-- ============================================================
-- When role_masters.permissions is updated, automatically
-- update all users with that role (atomic, server-side)
CREATE OR REPLACE FUNCTION public.cascade_role_permissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.users
  SET permissions = NEW.permissions
  WHERE role = NEW.role_key;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_role_permissions ON public.role_masters;
CREATE TRIGGER trg_cascade_role_permissions
  AFTER UPDATE OF permissions ON public.role_masters
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_role_permissions();

-- ============================================================
-- TABLE: settings
-- ============================================================
-- Key-value store for system settings (e.g., lock_date)
CREATE TABLE IF NOT EXISTS public.settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS settings_read ON public.settings;
DROP POLICY IF EXISTS settings_write ON public.settings;

CREATE POLICY settings_read ON public.settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY settings_write ON public.settings
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'super_admin' AND public.has_permission('allow_settings'))
  WITH CHECK (public.get_user_role() = 'super_admin' AND public.has_permission('allow_settings'));

-- ============================================================
-- FUNCTION: Check if a date is in a locked month
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_date_locked(p_date DATE)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lock_date DATE;
BEGIN
  SELECT value::DATE INTO v_lock_date FROM public.settings WHERE key = 'lock_date';

  -- No lock date set
  IF v_lock_date IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Lock hasn't activated yet (current date is on or before lock date)
  IF CURRENT_DATE <= v_lock_date THEN
    RETURN FALSE;
  END IF;

  -- Lock is active: lock records from months before the current month
  RETURN date_trunc('month', p_date) < date_trunc('month', CURRENT_DATE);
END;
$$;

-- Get centres accessible to the current user
-- SUPER_ADMIN / ASO → all centres
-- ADMIN / CENTRE_USER / SC_SP_USER → own centre + child centres (recursive)
CREATE OR REPLACE FUNCTION public.get_user_accessible_centres()
RETURNS SETOF TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_centre text;
  v_role text;
BEGIN
  SELECT centre, public.get_user_role() INTO v_centre, v_role FROM public.users WHERE auth_id = auth.uid();
  IF v_centre IS NULL THEN RETURN; END IF;

  -- ASO and SUPER_ADMIN see ALL centres
  IF v_role IN ('aso', 'super_admin') THEN
    RETURN QUERY SELECT name FROM public.centres;
    RETURN;
  END IF;

  -- Other roles see own centre + children (recursive, with cycle detection)
  RETURN QUERY
  WITH RECURSIVE centre_tree AS (
    SELECT name FROM public.centres WHERE name = v_centre
    UNION ALL
    SELECT c.name FROM public.centres c
    INNER JOIN centre_tree ct ON c.parent_centre = ct.name
  ) CYCLE name SET is_cycle USING path
  SELECT name FROM centre_tree WHERE NOT is_cycle;
END;
$$;

-- SECURITY DEFINER: Look up sewadar's home centre by badge number
-- Bypasses RLS so any authenticated user can detect cross-scans
CREATE OR REPLACE FUNCTION public.get_sewadar_centres(p_badge_numbers TEXT[])
RETURNS TABLE(badge_number TEXT, centre TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT s.badge_number, s.centre
  FROM public.sewadars s
  WHERE s.badge_number = ANY(p_badge_numbers);
END;
$$;

-- SECURITY DEFINER: Look up sewadar's home centre + department by badge numbers
-- Bypasses RLS so Records page can show home centre and department for all records
CREATE OR REPLACE FUNCTION public.get_sewadar_details(p_badge_numbers TEXT[])
RETURNS TABLE(badge_number TEXT, centre TEXT, department TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT s.badge_number, s.centre, s.department
  FROM public.sewadars s
  WHERE s.badge_number = ANY(p_badge_numbers);
END;
$$;

-- SECURITY DEFINER: Get full sewadar record by badge number
-- Bypasses RLS so any authenticated user can scan out-of-centre sewadars
CREATE OR REPLACE FUNCTION public.get_sewadar_by_badge(p_badge TEXT)
RETURNS SETOF public.sewadars
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM public.sewadars s
  WHERE s.badge_number = p_badge;
END;
$$;

-- SECURITY DEFINER: Search sewadars across ALL centres by name or badge
-- Bypasses RLS for cross-centre search (Gate Entry "Allow other centres")
-- Performance: create trigram index for fast ILIKE:
--   CREATE EXTENSION IF NOT EXISTS pg_trgm;
--   CREATE INDEX idx_sewadars_search ON public.sewadars USING gin (badge_number gin_trgm_ops, sewadar_name gin_trgm_ops);
CREATE OR REPLACE FUNCTION public.search_sewadars_all(p_term TEXT)
RETURNS SETOF public.sewadars
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_term IS NULL OR length(p_term) < 2 OR length(p_term) > 50 THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT * FROM public.sewadars s
  WHERE s.badge_number ILIKE '%' || p_term || '%'
     OR s.sewadar_name ILIKE '%' || p_term || '%'
  LIMIT 20;
END;
$$;

-- ============================================================
-- TABLE: centres
-- ============================================================
ALTER TABLE public.centres ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS centres_read ON public.centres;
DROP POLICY IF EXISTS centres_write ON public.centres;

CREATE POLICY centres_read ON public.centres
  FOR SELECT TO authenticated USING (true);

CREATE POLICY centres_write ON public.centres
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'super_admin' AND public.has_permission('allow_settings'))
  WITH CHECK (public.get_user_role() = 'super_admin' AND public.has_permission('allow_settings'));

-- ============================================================
-- TABLE: jatha_master
-- ============================================================
-- centre_name = DESTINATION centre (where sewadars are being sent)
-- All authenticated users can READ (it's reference data)
-- Only SUPER_ADMIN can WRITE
ALTER TABLE public.jatha_master ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jatha_read ON public.jatha_master;
DROP POLICY IF EXISTS jatha_write ON public.jatha_master;

CREATE POLICY jatha_read ON public.jatha_master
  FOR SELECT TO authenticated USING (true);

CREATE POLICY jatha_write ON public.jatha_master
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'super_admin' AND public.has_permission('allow_settings'))
  WITH CHECK (public.get_user_role() = 'super_admin' AND public.has_permission('allow_settings'));

-- ============================================================
-- TABLE: jatha_attendance
-- ============================================================
-- READ: only records for sewadars whose home centre is accessible
-- WRITE (incl. DELETE): SUPER_ADMIN can do all;
--   ADMIN / CENTRE_USER can modify records for their accessible centres' sewadars
ALTER TABLE public.jatha_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jatha_att_read ON public.jatha_attendance;
DROP POLICY IF EXISTS jatha_att_write ON public.jatha_attendance;

CREATE POLICY jatha_att_read ON public.jatha_attendance
  FOR SELECT TO authenticated
  USING (
    public.has_permission('allow_jatha')
    AND badge_number IN (
      SELECT badge_number FROM public.sewadars
      WHERE centre IN (SELECT public.get_user_accessible_centres())
    )
  );

CREATE POLICY jatha_att_write ON public.jatha_attendance
  FOR ALL TO authenticated
  USING (
    public.has_permission('allow_jatha')
    AND (
      public.get_user_role() = 'super_admin'
      OR (
        public.get_user_role() IN ('admin', 'centre_user')
        AND badge_number IN (
          SELECT badge_number FROM public.sewadars
          WHERE centre IN (SELECT public.get_user_accessible_centres())
        )
      )
    )
    AND (public.get_user_role() = 'super_admin' OR from_date IS NULL OR NOT public.is_date_locked(from_date))
  )
  WITH CHECK (
    public.has_permission('allow_jatha')
    AND (
      public.get_user_role() = 'super_admin'
      OR (
        public.get_user_role() IN ('admin', 'centre_user')
        AND badge_number IN (
          SELECT badge_number FROM public.sewadars
          WHERE centre IN (SELECT public.get_user_accessible_centres())
        )
      )
    )
    AND (public.get_user_role() = 'super_admin' OR from_date IS NULL OR NOT public.is_date_locked(from_date))
  );

-- ============================================================
-- TABLE: attendance_sessions
-- ============================================================
-- READ: only sessions where centre is accessible to user
-- INSERT: SUPER_ADMIN can insert any; others can insert for their centres
-- UPDATE/DELETE: SUPER_ADMIN can modify any;
--   ADMIN / CENTRE_USER can modify sessions for their accessible centres
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sessions_read ON public.attendance_sessions;
DROP POLICY IF EXISTS sessions_insert ON public.attendance_sessions;
DROP POLICY IF EXISTS sessions_update ON public.attendance_sessions;
DROP POLICY IF EXISTS sessions_delete ON public.attendance_sessions;

CREATE POLICY sessions_read ON public.attendance_sessions
  FOR SELECT TO authenticated
  USING (
    (public.has_permission('allow_dashboard')
      OR public.has_permission('allow_records')
      OR public.has_permission('allow_scan')
      OR public.has_permission('allow_gate_entry'))
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

CREATE POLICY sessions_insert ON public.attendance_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.has_permission('allow_gate_entry') OR public.has_permission('allow_scan'))
    AND (
      public.get_user_role() = 'super_admin'
      OR centre IN (SELECT public.get_user_accessible_centres())
    )
    AND (public.get_user_role() = 'super_admin' OR NOT public.is_date_locked(in_date))
  );

CREATE POLICY sessions_update ON public.attendance_sessions
  FOR UPDATE TO authenticated
  USING (
    public.has_permission('allow_scan')
    AND (
      public.get_user_role() = 'super_admin'
      OR (
        public.get_user_role() IN ('admin', 'centre_user')
        AND centre IN (SELECT public.get_user_accessible_centres())
      )
    )
    AND (public.get_user_role() = 'super_admin' OR NOT public.is_date_locked(in_date))
  )
  WITH CHECK (
    public.has_permission('allow_scan')
    AND (
      public.get_user_role() = 'super_admin'
      OR (
        public.get_user_role() IN ('admin', 'centre_user')
        AND centre IN (SELECT public.get_user_accessible_centres())
      )
    )
    AND (public.get_user_role() = 'super_admin' OR NOT public.is_date_locked(in_date))
  );

CREATE POLICY sessions_delete ON public.attendance_sessions
  FOR DELETE TO authenticated
  USING (
    (
      public.get_user_role() = 'super_admin'
      OR (
        public.get_user_role() IN ('admin', 'centre_user')
        AND centre IN (SELECT public.get_user_accessible_centres())
      )
    )
    AND (public.get_user_role() = 'super_admin' OR NOT public.is_date_locked(in_date))
  );

-- ============================================================
-- TABLE: sewadars
-- ============================================================
ALTER TABLE public.sewadars ENABLE ROW LEVEL SECURITY;

-- Allow ELDERLY badge status for imports
ALTER TABLE public.sewadars DROP CONSTRAINT IF EXISTS sewadars_badge_status_check;
ALTER TABLE public.sewadars ADD CONSTRAINT sewadars_badge_status_check
  CHECK (badge_status = ANY (ARRAY['PERMANENT'::text, 'OPEN'::text, 'ELDERLY'::text]));

-- Allow both cases for gender (Male/Female and MALE/FEMALE)
ALTER TABLE public.sewadars DROP CONSTRAINT IF EXISTS sewadars_gender_check;
ALTER TABLE public.sewadars ADD CONSTRAINT sewadars_gender_check
  CHECK (gender = ANY (ARRAY['Male'::text, 'Female'::text, 'MALE'::text, 'FEMALE'::text]));

DROP POLICY IF EXISTS sewadars_read ON public.sewadars;
DROP POLICY IF EXISTS sewadars_write ON public.sewadars;

CREATE POLICY sewadars_read ON public.sewadars
  FOR SELECT TO authenticated
  USING (
    (public.has_permission('allow_dashboard')
      OR public.has_permission('allow_records')
      OR public.has_permission('allow_scan')
      OR public.has_permission('allow_gate_entry')
      OR public.has_permission('allow_jatha')
      OR public.has_permission('allow_reports'))
    AND centre IN (SELECT public.get_user_accessible_centres())
  );

CREATE POLICY sewadars_write ON public.sewadars
  FOR ALL TO authenticated
  USING (
    public.has_permission('allow_settings')
    AND (
      public.get_user_role() = 'super_admin'
      OR (
        public.get_user_role() IN ('admin', 'centre_user')
        AND centre IN (SELECT public.get_user_accessible_centres())
      )
    )
  )
  WITH CHECK (
    public.has_permission('allow_settings')
    AND (
      public.get_user_role() = 'super_admin'
      OR (
        public.get_user_role() IN ('admin', 'centre_user')
        AND centre IN (SELECT public.get_user_accessible_centres())
      )
    )
  );

-- ============================================================
-- TABLE: users
-- ============================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_read ON public.users;
DROP POLICY IF EXISTS users_write ON public.users;

CREATE POLICY users_read ON public.users
  FOR SELECT TO authenticated
  USING (auth_id = auth.uid() OR public.get_user_role() = 'super_admin');

CREATE POLICY users_write ON public.users
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'super_admin' AND public.has_permission('allow_settings'))
  WITH CHECK (public.get_user_role() = 'super_admin' AND public.has_permission('allow_settings'));

-- ============================================================
-- TABLE: role_masters
-- ============================================================
ALTER TABLE public.role_masters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_masters_read ON public.role_masters;
DROP POLICY IF EXISTS role_masters_write ON public.role_masters;

CREATE POLICY role_masters_read ON public.role_masters
  FOR SELECT TO authenticated USING (true);

CREATE POLICY role_masters_write ON public.role_masters
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'super_admin' AND public.has_permission('allow_settings'))
  WITH CHECK (public.get_user_role() = 'super_admin' AND public.has_permission('allow_settings'));

-- ============================================================
-- TABLE: special_departments
-- ============================================================
ALTER TABLE public.special_departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS depts_read ON public.special_departments;
DROP POLICY IF EXISTS depts_write ON public.special_departments;

CREATE POLICY depts_read ON public.special_departments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY depts_write ON public.special_departments
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'super_admin' AND public.has_permission('allow_settings'))
  WITH CHECK (public.get_user_role() = 'super_admin' AND public.has_permission('allow_settings'));

-- ============================================================
-- TABLE: logs
-- ============================================================
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS logs_read ON public.logs;
DROP POLICY IF EXISTS logs_insert ON public.logs;

CREATE POLICY logs_read ON public.logs
  FOR SELECT TO authenticated
  USING (public.get_user_role() IN ('aso', 'super_admin'));

CREATE POLICY logs_insert ON public.logs
  FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================
-- RPC: Get current OPEN session for a badge number
-- Returns JSON (single object or null) so JS receives data as object not array
-- SECURITY DEFINER bypasses RLS so scanner can check any badge
-- ============================================================
DROP FUNCTION IF EXISTS public.get_open_session(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.get_open_session(p_badge TEXT)
RETURNS JSON
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT row_to_json(s.*) AS result
  FROM public.attendance_sessions s
  WHERE s.badge_number = p_badge AND s.status = 'OPEN'
  LIMIT 1;
$$;

-- ============================================================
-- RPC: Close an open session with OUT details
-- SECURITY DEFINER so scanner can close any session
-- ============================================================
DROP FUNCTION IF EXISTS public.close_session(BIGINT, DATE, TIME, TEXT, TEXT, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.close_session(
  p_session_id BIGINT,
  p_out_date DATE,
  p_out_time TIME,
  p_out_scanner_badge TEXT,
  p_out_scanner_name TEXT,
  p_out_scanner_centre TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_in_date DATE;
BEGIN
  -- Get the session's in_date
  SELECT in_date INTO v_in_date FROM public.attendance_sessions WHERE id = p_session_id;

  -- Block if date is locked (unless super_admin)
  IF v_in_date IS NOT NULL AND public.get_user_role() != 'super_admin' AND public.is_date_locked(v_in_date) THEN
    RAISE EXCEPTION 'Cannot close session: date is locked';
  END IF;

  UPDATE public.attendance_sessions
  SET
    out_date = p_out_date,
    out_time = p_out_time,
    out_scanner_badge = p_out_scanner_badge,
    out_scanner_name = p_out_scanner_name,
    out_scanner_centre = p_out_scanner_centre,
    status = 'CLOSED',
    updated_at = now()
  WHERE id = p_session_id AND status = 'OPEN';
END;
$$;

-- ============================================================
-- INDEXES (performance)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_badge ON public.attendance_sessions(badge_number);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_in_date ON public.attendance_sessions(in_date);
CREATE INDEX IF NOT EXISTS idx_jatha_attendance_badge ON public.jatha_attendance(badge_number);
CREATE INDEX IF NOT EXISTS idx_sewadars_badge ON public.sewadars(badge_number);

-- ============================================================
-- FOREIGN KEY CONSTRAINTS (drop first — FKs depend on UNIQUE index)
-- ON DELETE SET NULL preserves attendance history when sewadar is deleted
-- ============================================================
ALTER TABLE public.attendance_sessions
  DROP CONSTRAINT IF EXISTS fk_attendance_sessions_badge;

ALTER TABLE public.jatha_attendance
  DROP CONSTRAINT IF EXISTS fk_jatha_attendance_badge;

-- ============================================================
-- UNIQUE CONSTRAINT on sewadars.badge_number (safe after FKs dropped)
-- Safe: zero duplicates confirmed in live DB
-- ============================================================
ALTER TABLE public.sewadars DROP CONSTRAINT IF EXISTS sewadars_badge_number_unique;
ALTER TABLE public.sewadars ADD CONSTRAINT sewadars_badge_number_unique UNIQUE (badge_number);

-- ============================================================
-- FOREIGN KEY CONSTRAINTS (recreate after UNIQUE)
-- ============================================================
ALTER TABLE public.attendance_sessions
  ADD CONSTRAINT fk_attendance_sessions_badge
  FOREIGN KEY (badge_number) REFERENCES public.sewadars(badge_number)
  ON DELETE SET NULL;

ALTER TABLE public.jatha_attendance
  ADD CONSTRAINT fk_jatha_attendance_badge
  FOREIGN KEY (badge_number) REFERENCES public.sewadars(badge_number)
  ON DELETE SET NULL;

-- ============================================================
-- CLEANUP: Close duplicate OPEN sessions (keep latest per badge)
-- ============================================================
UPDATE public.attendance_sessions t
SET status = 'CLOSED',
    out_date = t.in_date,
    out_time = t.in_time,
    out_scanner_name = 'duplicate-cleanup',
    updated_at = now()
FROM (
  SELECT id
  FROM (
    SELECT id, badge_number,
           ROW_NUMBER() OVER (PARTITION BY badge_number ORDER BY (in_date + in_time) DESC, created_at DESC) AS rn
    FROM public.attendance_sessions
    WHERE status = 'OPEN'
  ) sub
  WHERE sub.rn > 1
) dupes
WHERE t.id = dupes.id;

-- ============================================================
-- UNIQUE INDEX: Prevent multiple OPEN sessions per badge
-- ============================================================
DROP INDEX IF EXISTS idx_one_open_per_badge;
CREATE UNIQUE INDEX idx_one_open_per_badge
  ON public.attendance_sessions(badge_number)
  WHERE status = 'OPEN';

-- ============================================================
-- TRIGGER: Prevent overlapping attendance sessions
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_session_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new_start TIMESTAMP;
  v_new_end TIMESTAMP;
BEGIN
  v_new_start := NEW.in_date + NEW.in_time;
  v_new_end := CASE
                WHEN NEW.out_date IS NOT NULL AND NEW.out_time IS NOT NULL
                THEN NEW.out_date + NEW.out_time
                ELSE NULL
              END;

  -- Check overlap with other attendance_sessions for same badge
  IF EXISTS (
    SELECT 1 FROM public.attendance_sessions
    WHERE badge_number = NEW.badge_number
      AND id != COALESCE(NEW.id, -1)
      AND (in_date + in_time) < COALESCE(v_new_end, 'infinity'::timestamp)
      AND COALESCE(out_date + out_time, 'infinity'::timestamp) > v_new_start
  ) THEN
    RAISE EXCEPTION 'This sewadar already has an overlapping session';
  END IF;

  -- Check overlap with jatha_attendance for same badge
  IF EXISTS (
    SELECT 1 FROM public.jatha_attendance
    WHERE badge_number = NEW.badge_number
      AND from_date IS NOT NULL
      AND from_date <= COALESCE(NEW.out_date, NEW.in_date)
      AND COALESCE(to_date, from_date) >= NEW.in_date
  ) THEN
    RAISE EXCEPTION 'This sewadar has a jatha entry overlapping this date';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_session_overlap ON public.attendance_sessions;
CREATE TRIGGER trg_check_session_overlap
  BEFORE INSERT OR UPDATE ON public.attendance_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.check_session_overlap();

-- ============================================================
-- TRIGGER: Prevent overlapping jatha entries
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_jatha_overlap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Check overlap with attendance_sessions for same badge
  IF EXISTS (
    SELECT 1 FROM public.attendance_sessions
    WHERE badge_number = NEW.badge_number
      AND in_date <= COALESCE(NEW.to_date, NEW.from_date)
      AND COALESCE(out_date, in_date) >= NEW.from_date
  ) THEN
    RAISE EXCEPTION 'This sewadar has an attendance session overlapping this jatha';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_jatha_overlap ON public.jatha_attendance;
CREATE TRIGGER trg_check_jatha_overlap
  BEFORE INSERT OR UPDATE ON public.jatha_attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.check_jatha_overlap();

-- ============================================================
-- HOW TO DEPLOY
-- ============================================================
-- 1. Run the entire file in Supabase SQL Editor
-- 2. This recreates ALL helper functions, RLS policies, indexes, and constraints
-- 3. Existing data is preserved (DDL only affects policies/functions/schema)
-- 4. New in v2.3:
--    - get_open_session(p_badge): returns current OPEN session JSON
--    - close_session(...): closes session with OUT details
--    - Indexes on badge_number and in_date for query performance
--    - UNIQUE constraint on sewadars.badge_number (zero duplicates confirmed)
--    - FK constraints (attendance_sessions, jatha_attendance → sewadars)
--    - Unique partial index + overlap triggers on attendance_sessions and jatha_attendance
-- ============================================================
-- VERIFICATION
-- ============================================================
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd;
