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
    RETURN p_perm_key IN ('allow_dashboard', 'allow_records', 'allow_reports', 'allow_jatha');
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
  AFTER INSERT OR UPDATE OF permissions ON public.role_masters
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_role_permissions();

-- ============================================================
-- TRIGGER: Auto-set user permissions from role_masters on INSERT
-- ============================================================
-- When a new user row is created, copy permissions from role_masters
-- Fixes: new users had NULL permissions, causing RLS to reject all writes
CREATE OR REPLACE FUNCTION public.set_user_permissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  SELECT permissions INTO NEW.permissions
  FROM public.role_masters
  WHERE role_key = NEW.role;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_user_permissions ON public.users;
CREATE TRIGGER trg_set_user_permissions
  BEFORE INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_user_permissions();

-- ============================================================
-- ONE-TIME FIX: Populate NULL permissions for EXISTING users
-- ============================================================
-- Remove this after running once (or keep for idempotency)
UPDATE public.users u
SET permissions = rm.permissions
FROM public.role_masters rm
WHERE u.role = rm.role_key
  AND (u.permissions IS NULL OR u.permissions = '{}'::jsonb);

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
RETURNS TABLE(centre_name TEXT)
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
    RETURN QUERY SELECT c.name FROM public.centres c;
    RETURN;
  END IF;

  -- Other roles see own centre + children (recursive, with cycle detection)
  RETURN QUERY
  WITH RECURSIVE centre_tree AS (
    SELECT c.name FROM public.centres c WHERE c.name = v_centre
    UNION ALL
    SELECT c.name FROM public.centres c
    INNER JOIN centre_tree ct ON c.parent_centre = ct.name
  ) CYCLE name SET is_cycle USING path
  SELECT ct.name FROM centre_tree ct WHERE NOT is_cycle;
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

-- ASO Overview: Get badge status counts grouped by centre
-- Returns aggregated counts (~123 rows) instead of fetching all 14k rows
CREATE OR REPLACE FUNCTION public.get_aso_badge_counts()
RETURNS TABLE(centre TEXT, badge_status TEXT, count BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT s.centre, s.badge_status, COUNT(*)::BIGINT
  FROM public.sewadars s
  WHERE s.centre IS NOT NULL
  GROUP BY s.centre, s.badge_status
  ORDER BY s.centre, s.badge_status
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
-- READ/WRITE: scoped by sewadar's home centre via badge_number only
--   (destination centre column removed — was always blank for most records)
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result JSON;
BEGIN
  -- Dual-path centre scope (matches RLS policies):
  -- 1. Sewadar's home centre is accessible, OR
  -- 2. Session's scan centre is accessible
  -- (super_admin and aso bypass scope check)
  IF public.get_user_role() IN ('super_admin', 'aso') OR EXISTS (
    SELECT 1 FROM public.sewadars s
    WHERE s.badge_number = p_badge
    AND s.centre IN (SELECT public.get_user_accessible_centres())
  ) OR EXISTS (
    SELECT 1 FROM public.attendance_sessions sess
    WHERE sess.badge_number = p_badge
    AND sess.status = 'OPEN'
    AND sess.centre IN (SELECT public.get_user_accessible_centres())
  ) THEN
    SELECT row_to_json(s.*) INTO v_result
    FROM public.attendance_sessions s
    WHERE s.badge_number = p_badge AND s.status = 'OPEN'
    LIMIT 1;
  END IF;
  RETURN v_result;
END;
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

  -- Validate out_date >= in_date
  IF v_in_date IS NOT NULL AND p_out_date < v_in_date THEN
    RAISE EXCEPTION 'OUT date must be on or after IN date';
  END IF;

  -- Block future OUT dates
  IF p_out_date > CURRENT_DATE THEN
    RAISE EXCEPTION 'OUT date cannot be in the future';
  END IF;

  -- Validate OUT time > IN time when same date (unless super_admin)
  IF v_in_date IS NOT NULL AND p_out_date = v_in_date AND public.get_user_role() != 'super_admin' THEN
    IF p_out_time <= (SELECT in_time FROM public.attendance_sessions WHERE id = p_session_id) THEN
      RAISE EXCEPTION 'OUT time must be after IN time on the same date';
    END IF;
  END IF;

  -- Block if date is locked (unless super_admin)
  IF v_in_date IS NOT NULL AND public.get_user_role() != 'super_admin' AND public.is_date_locked(v_in_date) THEN
    RAISE EXCEPTION 'Cannot close session: date is locked';
  END IF;

  -- Centre scope check (defense-in-depth for SECURITY DEFINER)
  -- super_admin and aso bypass; others must have centre access to the session
  IF v_in_date IS NOT NULL AND public.get_user_role() NOT IN ('super_admin', 'aso') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.attendance_sessions s
      WHERE s.id = p_session_id
      AND (
        s.centre IN (SELECT public.get_user_accessible_centres())
        OR EXISTS (
          SELECT 1 FROM public.sewadars sw
          WHERE sw.badge_number = s.badge_number
          AND sw.centre IN (SELECT public.get_user_accessible_centres())
        )
      )
    ) THEN
      RAISE EXCEPTION 'Not authorized to close this session';
    END IF;
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
-- DENORMALIZED COLUMNS: sewadar_centre + sewadar_dept
-- ============================================================
-- attendance_sessions: snapshot of sewadar's home centre and department at scan time
ALTER TABLE public.attendance_sessions DROP COLUMN IF EXISTS sewadar_centre;
ALTER TABLE public.attendance_sessions ADD COLUMN sewadar_centre TEXT;
ALTER TABLE public.attendance_sessions DROP COLUMN IF EXISTS sewadar_dept;
ALTER TABLE public.attendance_sessions ADD COLUMN sewadar_dept TEXT;

-- jatha_attendance: snapshot of sewadar's home centre at entry time
ALTER TABLE public.jatha_attendance DROP COLUMN IF EXISTS sewadar_centre;
ALTER TABLE public.jatha_attendance ADD COLUMN sewadar_centre TEXT;

-- Trigger: auto-populate sewadar_centre + sewadar_dept on attendance_sessions INSERT
CREATE OR REPLACE FUNCTION public.set_session_sewadar_details()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  SELECT centre, department INTO NEW.sewadar_centre, NEW.sewadar_dept
  FROM public.sewadars WHERE badge_number = NEW.badge_number;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_session_sewadar_details ON public.attendance_sessions;
CREATE TRIGGER trg_set_session_sewadar_details
  BEFORE INSERT ON public.attendance_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_session_sewadar_details();

-- Trigger: auto-populate sewadar_centre on jatha_attendance INSERT
CREATE OR REPLACE FUNCTION public.set_jatha_sewadar_centre()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  SELECT centre INTO NEW.sewadar_centre
  FROM public.sewadars WHERE badge_number = NEW.badge_number;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_jatha_sewadar_centre ON public.jatha_attendance;
CREATE TRIGGER trg_set_jatha_sewadar_centre
  BEFORE INSERT ON public.jatha_attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.set_jatha_sewadar_centre();

-- Temporarily disable overlap triggers for backfill (avoid false positives)
ALTER TABLE public.attendance_sessions DISABLE TRIGGER trg_check_session_overlap;
ALTER TABLE public.jatha_attendance DISABLE TRIGGER trg_check_jatha_overlap;

-- One-time backfill for existing attendance_sessions rows
UPDATE public.attendance_sessions s
SET sewadar_centre = sw.centre, sewadar_dept = sw.department
FROM public.sewadars sw
WHERE s.badge_number = sw.badge_number
  AND (s.sewadar_centre IS NULL OR s.sewadar_dept IS NULL);

-- One-time backfill for existing jatha_attendance rows
UPDATE public.jatha_attendance j
SET sewadar_centre = sw.centre
FROM public.sewadars sw
WHERE j.badge_number = sw.badge_number
  AND j.sewadar_centre IS NULL;

-- Re-enable overlap triggers
ALTER TABLE public.attendance_sessions ENABLE TRIGGER trg_check_session_overlap;
ALTER TABLE public.jatha_attendance ENABLE TRIGGER trg_check_jatha_overlap;

-- ============================================================
-- COMPOSITE INDEXES (performance for common query patterns)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_badge ON public.attendance_sessions(badge_number);
CREATE INDEX IF NOT EXISTS idx_jatha_attendance_badge ON public.jatha_attendance(badge_number);
CREATE INDEX IF NOT EXISTS idx_sewadars_badge ON public.sewadars(badge_number);

-- Drop single-column index replaced by composite
DROP INDEX IF EXISTS public.idx_attendance_sessions_in_date;

-- Composite: date + centre + duty (most common filter combo)
CREATE INDEX IF NOT EXISTS idx_sessions_date_centre_duty
  ON public.attendance_sessions(in_date DESC, centre, duty_type);

-- Composite: sort order for pagination (cards view cursor)
CREATE INDEX IF NOT EXISTS idx_sessions_date_time
  ON public.attendance_sessions(in_date DESC, in_time DESC);

-- Composite: badge search + date sort
CREATE INDEX IF NOT EXISTS idx_sessions_badge_date
  ON public.attendance_sessions(badge_number, in_date DESC);

-- Composite: jatha date range queries
CREATE INDEX IF NOT EXISTS idx_jatha_dates
  ON public.jatha_attendance(from_date DESC, to_date DESC);

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
-- FIX: Swap in_date/out_date for rows where in_date > out_date
-- (existing data from before the date-range validation was added)
-- Temporarily disable overlap triggers to avoid false positives
-- from swaps that create valid overlaps after correction
-- ============================================================
ALTER TABLE public.attendance_sessions DISABLE TRIGGER trg_check_session_overlap;
ALTER TABLE public.jatha_attendance DISABLE TRIGGER trg_check_jatha_overlap;

UPDATE public.attendance_sessions
SET
  in_date = out_date,
  out_date = in_date,
  in_time = out_time,
  out_time = in_time
WHERE in_date IS NOT NULL AND out_date IS NOT NULL AND in_date > out_date;

ALTER TABLE public.attendance_sessions ENABLE TRIGGER trg_check_session_overlap;
ALTER TABLE public.jatha_attendance ENABLE TRIGGER trg_check_jatha_overlap;

-- ============================================================
-- CHECK CONSTRAINT: attendance_sessions date range (in <= out)
-- ============================================================
ALTER TABLE public.attendance_sessions DROP CONSTRAINT IF EXISTS chk_session_dates;
ALTER TABLE public.attendance_sessions ADD CONSTRAINT chk_session_dates
  CHECK (out_date IS NULL OR in_date IS NULL OR in_date <= out_date);

-- ============================================================
-- CHECK CONSTRAINT: jatha_attendance date range
-- ============================================================
ALTER TABLE public.jatha_attendance DROP CONSTRAINT IF EXISTS chk_jatha_dates;
ALTER TABLE public.jatha_attendance ADD CONSTRAINT chk_jatha_dates
  CHECK (from_date IS NULL OR to_date IS NULL OR from_date <= to_date);

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
  IF NEW.badge_number IS NULL THEN
    RETURN NEW;
  END IF;
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
  IF NEW.badge_number IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check overlap with other jatha_attendance for same badge
  IF EXISTS (
    SELECT 1 FROM public.jatha_attendance
    WHERE badge_number = NEW.badge_number
      AND id != COALESCE(NEW.id, -1)
      AND from_date IS NOT NULL
      AND from_date <= COALESCE(NEW.to_date, NEW.from_date)
      AND COALESCE(to_date, from_date) >= NEW.from_date
  ) THEN
    RAISE EXCEPTION 'This sewadar already has a jatha entry overlapping this date range';
  END IF;

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
-- OPTIMIZED RPC: Get paginated session records with all filters
-- ============================================================
-- Returns: JSON { records: [...], total_count, open_count, closed_count, guest_count, manual_count, gate_entry_count, has_more }
-- p_page=0 returns ALL matching records (unlimited, for CSV export)
-- Scoping: dual-path (centre OR badge in accessible centres) + sc_sp_user
-- Nuke all overloads before creating the new one
DO $$ BEGIN
  PERFORM p.oid::regprocedure FROM pg_catalog.pg_proc p
    WHERE p.proname = 'get_session_records' AND p.pronamespace = 'public'::regnamespace;
  IF FOUND THEN
    EXECUTE (
      SELECT string_agg('DROP FUNCTION ' || p.oid::regprocedure || ' CASCADE;', ' ')
      FROM pg_catalog.pg_proc p
      WHERE p.proname = 'get_session_records' AND p.pronamespace = 'public'::regnamespace
    );
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.get_session_records(
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 50,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_centre TEXT DEFAULT NULL,
  p_duty_type TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_quick_filter TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_offset INT;
  v_result JSON;
BEGIN
  v_offset := CASE WHEN p_page > 0 THEN (p_page - 1) * p_page_size ELSE 0 END;

  WITH scoped AS (
    SELECT
      s.id, s.badge_number, s.sewadar_name,
      s.sewadar_centre, s.sewadar_dept,
      s.centre, s.in_scanner_centre, s.duty_type, s.status,
      s.in_date, s.in_time, s.out_date, s.out_time,
      s.in_scanner_badge, s.in_scanner_name,
      s.out_scanner_badge, s.out_scanner_name, s.out_scanner_centre,
      s.is_manual, s.is_gate_entry,
      s.entered_by_badge, s.entered_by_name,
      s.created_at, s.updated_at,
      CASE
        WHEN s.sewadar_centre IS NOT NULL AND s.sewadar_centre IS DISTINCT FROM s.centre
        THEN true ELSE false
      END AS is_cross_scan,
      CASE
        WHEN s.sewadar_centre IS NOT NULL AND s.sewadar_centre IS DISTINCT FROM s.centre
        THEN s.centre ELSE NULL
      END AS scan_centre
    FROM public.attendance_sessions s
    WHERE s.in_date >= COALESCE(p_date_from, '1900-01-01'::date)
      AND s.in_date <= COALESCE(p_date_to, '2999-12-31'::date)
      AND (p_centre IS NULL OR LOWER(TRIM(s.centre)) = LOWER(TRIM(p_centre)))
      AND (p_duty_type IS NULL OR s.duty_type = p_duty_type)
      AND (p_status IS NULL OR s.status = p_status)
      AND (
        p_search IS NULL
        OR s.badge_number ILIKE '%' || p_search || '%'
        OR s.sewadar_name ILIKE '%' || p_search || '%'
      )
      AND (
        (p_quick_filter IS NULL OR p_quick_filter = '')
        OR (p_quick_filter = 'open' AND s.status = 'OPEN')
        OR (p_quick_filter = 'closed' AND s.status = 'CLOSED')
        OR (p_quick_filter = 'guests' AND s.sewadar_centre IS NOT NULL AND s.sewadar_centre IS DISTINCT FROM s.centre)
        OR (p_quick_filter = 'manual' AND s.is_manual = true AND (s.is_gate_entry IS NULL OR s.is_gate_entry = false))
        OR (p_quick_filter = 'gate_entry' AND s.is_gate_entry = true)
      )
      AND (
        s.centre IN (SELECT public.get_user_accessible_centres())
        OR s.badge_number IN (
          SELECT badge_number FROM public.sewadars
          WHERE centre IN (SELECT public.get_user_accessible_centres())
        )
      )
      AND (
        public.get_user_role() != 'sc_sp_user'
        OR s.in_scanner_centre = (SELECT centre FROM public.users WHERE auth_id = auth.uid())
      )
  ),
  counts AS (
    SELECT
      COUNT(*) AS total_count,
      COUNT(*) FILTER (WHERE status = 'OPEN') AS open_count,
      COUNT(*) FILTER (WHERE status = 'CLOSED') AS closed_count,
      COUNT(*) FILTER (WHERE sewadar_centre IS NOT NULL AND sewadar_centre IS DISTINCT FROM centre) AS guest_count,
      COUNT(*) FILTER (WHERE is_manual = true AND (is_gate_entry IS NULL OR is_gate_entry = false)) AS manual_count,
      COUNT(*) FILTER (WHERE is_gate_entry = true) AS gate_entry_count
    FROM scoped
  ),
  ordered AS (
    SELECT * FROM scoped
    ORDER BY in_date DESC, in_time DESC
    LIMIT CASE WHEN p_page > 0 THEN p_page_size ELSE NULL END
    OFFSET CASE WHEN p_page > 0 THEN v_offset ELSE 0 END
  )
  SELECT json_build_object(
    'records', COALESCE((SELECT json_agg(row_to_json(ordered.*)) FROM ordered), '[]'::json),
    'has_more', CASE WHEN p_page > 0 THEN (SELECT COUNT(*) > v_offset + p_page_size FROM scoped) ELSE false END,
    'total_count', (SELECT total_count FROM counts),
    'open_count', (SELECT open_count FROM counts),
    'closed_count', (SELECT closed_count FROM counts),
    'guest_count', (SELECT guest_count FROM counts),
    'manual_count', (SELECT manual_count FROM counts),
    'gate_entry_count', (SELECT gate_entry_count FROM counts)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================
-- OPTIMIZED RPC: Get paginated jatha records with all filters
-- ============================================================
-- Returns: JSON { records: [...], total_count, has_more }
-- p_page=0 returns ALL matching records (unlimited, for CSV export)
-- Includes: jatha_type, jatha_department from jatha_master,
--           sewadar_centre from denormalized column
-- Nuke all overloads before creating the new one
DO $$ BEGIN
  PERFORM p.oid::regprocedure FROM pg_catalog.pg_proc p
    WHERE p.proname = 'get_jatha_records' AND p.pronamespace = 'public'::regnamespace;
  IF FOUND THEN
    EXECUTE (
      SELECT string_agg('DROP FUNCTION ' || p.oid::regprocedure || ' CASCADE;', ' ')
      FROM pg_catalog.pg_proc p
      WHERE p.proname = 'get_jatha_records' AND p.pronamespace = 'public'::regnamespace
    );
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.get_jatha_records(
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 50,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_centre TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_jatha_type TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_offset INT;
  v_result JSON;
BEGIN
  v_offset := CASE WHEN p_page > 0 THEN (p_page - 1) * p_page_size ELSE 0 END;

  WITH scoped AS (
    SELECT
      j.id, j.badge_number, j.sewadar_name,
      j.sewadar_centre,
      j.from_date, j.to_date, j.remarks,
      j.entered_by_badge, j.entered_by_name, j.entered_at,
      jm.jatha_type, jm.department AS jatha_department,
      j.jatha_id
    FROM public.jatha_attendance j
    LEFT JOIN public.jatha_master jm ON j.jatha_id = jm.id
    WHERE j.from_date >= COALESCE(p_date_from, '1900-01-01'::date)
      AND j.from_date <= COALESCE(p_date_to, '2999-12-31'::date)
      AND (p_centre IS NULL OR LOWER(REGEXP_REPLACE(j.sewadar_centre, '^\s+|\s+$', '', 'g')) = LOWER(REGEXP_REPLACE(p_centre, '^\s+|\s+$', '', 'g')))
      AND (p_jatha_type IS NULL OR jm.jatha_type = p_jatha_type)
      AND (
        p_search IS NULL
        OR j.badge_number ILIKE '%' || p_search || '%'
        OR j.sewadar_name ILIKE '%' || p_search || '%'
      )
      AND j.badge_number IN (
        SELECT badge_number FROM public.sewadars
        WHERE LOWER(REGEXP_REPLACE(centre, '^\s+|\s+$', '', 'g')) IN (
          SELECT LOWER(REGEXP_REPLACE(centre_name, '^\s+|\s+$', '', 'g')) FROM public.get_user_accessible_centres()
        )
      )
      AND public.has_permission('allow_jatha')
  ),
  ordered AS (
    SELECT * FROM scoped
    ORDER BY from_date DESC, entered_at DESC
    LIMIT CASE WHEN p_page > 0 THEN p_page_size ELSE NULL END
    OFFSET CASE WHEN p_page > 0 THEN v_offset ELSE 0 END
  )
  SELECT json_build_object(
    'records', COALESCE((SELECT json_agg(row_to_json(ordered.*)) FROM ordered), '[]'::json),
    'has_more', CASE WHEN p_page > 0 THEN (SELECT COUNT(*) > v_offset + p_page_size FROM scoped) ELSE false END,
    'total_count', (SELECT COUNT(*) FROM scoped)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

-- ============================================================
-- HOW TO DEPLOY
-- ============================================================
-- 1. Run the entire file in Supabase SQL Editor
-- 2. This recreates ALL helper functions, RLS policies, indexes, and constraints
-- 3. Existing data is preserved (DDL only affects policies/functions/schema)
-- 4. New in v2.4:
--    - get_session_records(): paginated, filtered, scoped session records RPC
--    - get_jatha_records(): paginated, filtered, scoped jatha records RPC
--    - Denormalized sewadar_centre/sewadar_dept on attendance_sessions
--    - Denormalized sewadar_centre on jatha_attendance
--    - Auto-populate triggers for denormalized columns
--    - Composite indexes for query performance
-- ============================================================
-- VERIFICATION
-- ============================================================
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd;

-- -- ============================================================
-- -- v2.5: JATHA DEDUP — Clean duplicate jatha_attendance rows
-- -- ============================================================
-- -- Problem: Same sewadar + same jatha + same dates inserted multiple times
-- --   (jatha_id=15: 40x, jatha_id=27: 5-7x per sewadar)
-- -- Root cause: Inserted before overlap trigger was deployed
-- -- Fix: Keep lowest id per unique (badge, jatha, from, to), delete rest, add unique index
-- --
-- -- STEP 1: Preview duplicates before deleting
-- -- Run this first to verify what will be removed:
-- --   SELECT badge_number, jatha_id, from_date, to_date, COUNT(*) - 1 AS dup_count
-- --   FROM public.jatha_attendance
-- --   WHERE badge_number IS NOT NULL
-- --   GROUP BY badge_number, jatha_id, from_date, to_date
-- --   HAVING COUNT(*) > 1
-- --   ORDER BY dup_count DESC;
-- --
-- STEP 2: Delete duplicates (keep lowest id per group)
-- Disable trigger since we're cleaning, not creating new overlaps
ALTER TABLE public.jatha_attendance DISABLE TRIGGER trg_check_jatha_overlap;

DELETE FROM public.jatha_attendance ja
WHERE ja.id NOT IN (
  SELECT MIN(id)
  FROM public.jatha_attendance
  WHERE badge_number IS NOT NULL
  GROUP BY badge_number, jatha_id, from_date, to_date
);

ALTER TABLE public.jatha_attendance ENABLE TRIGGER trg_check_jatha_overlap;

-- STEP 3: Prevent future duplicates with a unique index
DROP INDEX IF EXISTS idx_jatha_unique_entry;
CREATE UNIQUE INDEX idx_jatha_unique_entry
  ON public.jatha_attendance(badge_number, jatha_id, from_date, COALESCE(to_date, '1900-01-01'))
  WHERE badge_number IS NOT NULL;

-- ============================================================
-- v2.6: Jatha centre filter — home-centre only; removed destination column
-- ============================================================
-- Changes:
--   1. Removed jatha_attendance.centre column (destination was always blank)
--   2. get_jatha_records: filters by j.sewadar_centre (home centre)
--   3. RLS jatha_att policies: removed centre IN (...) path, home-centre only
--   4. Frontend INSERT: removed centre from payload
--   5. UI/CSV: removed Destination column from JathaCard/JathaTable/exports
--   6. All comparisons use REGEXP_REPLACE(..., '^\s+|\s+$', '', 'g') for
--      robust whitespace stripping (\r, \n, \t, spaces)
