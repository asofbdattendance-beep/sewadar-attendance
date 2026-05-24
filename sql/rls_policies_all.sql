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
  USING (public.get_user_role() = 'super_admin')
  WITH CHECK (public.get_user_role() = 'super_admin');

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
  USING (public.get_user_role() = 'super_admin')
  WITH CHECK (public.get_user_role() = 'super_admin');

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
    badge_number IN (
      SELECT badge_number FROM public.sewadars
      WHERE centre IN (SELECT public.get_user_accessible_centres())
    )
  );

CREATE POLICY jatha_att_write ON public.jatha_attendance
  FOR ALL TO authenticated
  USING (
    public.get_user_role() = 'super_admin'
    OR (
      public.get_user_role() IN ('admin', 'centre_user')
      AND badge_number IN (
        SELECT badge_number FROM public.sewadars
        WHERE centre IN (SELECT public.get_user_accessible_centres())
      )
    )
  )
  WITH CHECK (
    public.get_user_role() = 'super_admin'
    OR (
      public.get_user_role() IN ('admin', 'centre_user')
      AND badge_number IN (
        SELECT badge_number FROM public.sewadars
        WHERE centre IN (SELECT public.get_user_accessible_centres())
      )
    )
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
    centre IN (SELECT public.get_user_accessible_centres())
    OR badge_number IN (
      SELECT badge_number FROM public.sewadars
      WHERE centre IN (SELECT public.get_user_accessible_centres())
    )
  );

CREATE POLICY sessions_insert ON public.attendance_sessions
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_user_role() = 'super_admin'
    OR centre IN (SELECT public.get_user_accessible_centres())
  );

CREATE POLICY sessions_update ON public.attendance_sessions
  FOR UPDATE TO authenticated
  USING (
    public.get_user_role() = 'super_admin'
    OR (
      public.get_user_role() IN ('admin', 'centre_user')
      AND centre IN (SELECT public.get_user_accessible_centres())
    )
  )
  WITH CHECK (
    public.get_user_role() = 'super_admin'
    OR (
      public.get_user_role() IN ('admin', 'centre_user')
      AND centre IN (SELECT public.get_user_accessible_centres())
    )
  );

CREATE POLICY sessions_delete ON public.attendance_sessions
  FOR DELETE TO authenticated
  USING (
    public.get_user_role() = 'super_admin'
    OR (
      public.get_user_role() IN ('admin', 'centre_user')
      AND centre IN (SELECT public.get_user_accessible_centres())
    )
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
  USING (centre IN (SELECT public.get_user_accessible_centres()));

CREATE POLICY sewadars_write ON public.sewadars
  FOR ALL TO authenticated
  USING (
    public.get_user_role() = 'super_admin'
    OR (
      public.get_user_role() IN ('admin', 'centre_user')
      AND centre IN (SELECT public.get_user_accessible_centres())
    )
  )
  WITH CHECK (
    public.get_user_role() = 'super_admin'
    OR (
      public.get_user_role() IN ('admin', 'centre_user')
      AND centre IN (SELECT public.get_user_accessible_centres())
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
  USING (public.get_user_role() = 'super_admin')
  WITH CHECK (public.get_user_role() = 'super_admin');

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
  USING (public.get_user_role() = 'super_admin')
  WITH CHECK (public.get_user_role() = 'super_admin');

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
  USING (public.get_user_role() = 'super_admin')
  WITH CHECK (public.get_user_role() = 'super_admin');

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
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
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
--
-- ============================================================
-- VERIFICATION
-- ============================================================
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd;
