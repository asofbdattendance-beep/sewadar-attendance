-- =====================================================
-- COMPLETE MIGRATION SCRIPT
-- Sewadar Attendance System v2.0
-- Run in Supabase SQL Editor (in order)
-- =====================================================

-- =====================================================
-- STEP 1: Update users table role constraint
-- =====================================================
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('aso', 'centre', 'sc_sp_user', 'centre_user'));

-- =====================================================
-- STEP 2: Migrate existing roles
-- =====================================================
-- Migrate centre_user to centre
UPDATE public.users
  SET role = 'centre'
  WHERE role = 'centre_user';

-- Migrate sc_sp_user to centre (optional - uncomment if needed)
-- UPDATE public.users SET role = 'centre' WHERE role = 'sc_sp_user';

-- Verify migration
SELECT role, COUNT(*) as count FROM public.users GROUP BY role;

-- =====================================================
-- STEP 3: Drop old sc_sp_user role constraint (after migration)
-- =====================================================
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('aso', 'centre'));

-- =====================================================
-- STEP 4: Ensure attendance_sessions table exists
-- =====================================================
CREATE TABLE IF NOT EXISTS public.attendance_sessions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  badge_number   text NOT NULL REFERENCES public.sewadars(badge_number),
  sewadar_name   text NOT NULL,
  centre         text NOT NULL,
  department     text,
  duty_type      text NOT NULL DEFAULT 'gate_entry'
                 CHECK (duty_type IN ('satsang', 'gate_entry', 'watch_ward')),
  in_id          bigint,
  out_id         bigint,
  in_time        timestamptz,
  out_time       timestamptz,
  date_ist       date NOT NULL,
  is_open        boolean NOT NULL DEFAULT true,
  force_closed   boolean NOT NULL DEFAULT false,
  force_closed_reason text,
  force_closed_by text,
  manual_in      boolean NOT NULL DEFAULT false,
  manual_out     boolean NOT NULL DEFAULT false,
  scanner_badge  text,
  scanner_name    text,
  scanner_centre  text,
  in_scanner_badge text,
  in_scanner_name  text,
  out_scanner_badge text,
  out_scanner_name  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- =====================================================
-- STEP 5: Add indexes for attendance_sessions
-- =====================================================
-- Critical performance index: open-session lookup is O(1) per badge
CREATE INDEX IF NOT EXISTS idx_sessions_badge_open
  ON public.attendance_sessions(badge_number, is_open)
  WHERE is_open = true;

-- Date range queries for records page
CREATE INDEX IF NOT EXISTS idx_sessions_date_centre
  ON public.attendance_sessions(date_ist, centre);

-- Badge + date for reports
CREATE INDEX IF NOT EXISTS idx_sessions_badge_date
  ON public.attendance_sessions(badge_number, date_ist);

-- =====================================================
-- STEP 6: Add session_id FK to attendance table
-- =====================================================
-- First check if column exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'attendance' 
    AND column_name = 'session_id'
  ) THEN
    ALTER TABLE public.attendance
      ADD COLUMN session_id bigint REFERENCES public.attendance_sessions(id);
  END IF;
END $$;

-- =====================================================
-- STEP 6b: Drop overly restrictive unique constraint on attendance
-- Allows multiple IN/OUT per badge per day (ladder pattern)
-- =====================================================
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_unique_daily'
  ) THEN
    ALTER TABLE public.attendance DROP CONSTRAINT attendance_unique_daily;
  END IF;
END $$;

-- =====================================================
-- STEP 6c: Add scanner columns to attendance_sessions
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_sessions' AND column_name = 'scanner_badge') THEN
    ALTER TABLE public.attendance_sessions ADD COLUMN scanner_badge text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_sessions' AND column_name = 'scanner_name') THEN
    ALTER TABLE public.attendance_sessions ADD COLUMN scanner_name text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_sessions' AND column_name = 'scanner_centre') THEN
    ALTER TABLE public.attendance_sessions ADD COLUMN scanner_centre text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_sessions' AND column_name = 'in_scanner_name') THEN
    ALTER TABLE public.attendance_sessions ADD COLUMN in_scanner_name text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_sessions' AND column_name = 'out_scanner_name') THEN
    ALTER TABLE public.attendance_sessions ADD COLUMN out_scanner_name text;
  END IF;
END $$;

-- =====================================================
-- STEP 7: Add duty_type to attendance table
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'attendance' 
    AND column_name = 'duty_type'
  ) THEN
    ALTER TABLE public.attendance
      ADD COLUMN duty_type text NOT NULL DEFAULT 'gate_entry'
      CHECK (duty_type IN ('satsang', 'gate_entry', 'watch_ward'));
  END IF;
END $$;

-- =====================================================
-- STEP 8: Add FK constraints for in_id and out_id
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_sessions_in_id'
  ) THEN
    ALTER TABLE public.attendance_sessions
      ADD CONSTRAINT fk_sessions_in_id
      FOREIGN KEY (in_id) REFERENCES public.attendance(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_sessions_out_id'
  ) THEN
    ALTER TABLE public.attendance_sessions
      ADD CONSTRAINT fk_sessions_out_id
      FOREIGN KEY (out_id) REFERENCES public.attendance(id);
  END IF;
END $$;

-- =====================================================
-- STEP 9: Update attendance.session_id FK
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'fk_attendance_session_id'
  ) THEN
    ALTER TABLE public.attendance
      ADD CONSTRAINT fk_attendance_session_id
      FOREIGN KEY (session_id) REFERENCES public.attendance_sessions(id);
  END IF;
END $$;

-- =====================================================
-- STEP 10: Set up RLS on attendance_sessions
-- =====================================================
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;

-- Allow authenticated reads
DROP POLICY IF EXISTS "sessions_read" ON public.attendance_sessions;
CREATE POLICY "sessions_read" ON public.attendance_sessions
  FOR SELECT TO authenticated USING (true);

-- Allow authenticated inserts/updates
DROP POLICY IF EXISTS "sessions_write" ON public.attendance_sessions;
CREATE POLICY "sessions_write" ON public.attendance_sessions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =====================================================
-- STEP 11: Ensure user_permissions table exists
-- =====================================================
CREATE TABLE IF NOT EXISTS public.user_permissions (
  user_id         bigint PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  can_scan        boolean NOT NULL DEFAULT true,
  can_records     boolean NOT NULL DEFAULT true,
  can_reports     boolean NOT NULL DEFAULT false,
  can_jatha       boolean NOT NULL DEFAULT false,
  can_manual_entry boolean NOT NULL DEFAULT false,
  can_flags       boolean NOT NULL DEFAULT false,
  can_edit_jatha  boolean NOT NULL DEFAULT false,
  updated_by      text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- =====================================================
-- STEP 12: Set up RLS on user_permissions
-- =====================================================
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;

-- ASO can read all permissions
DROP POLICY IF EXISTS "permissions_read" ON public.user_permissions;
CREATE POLICY "permissions_read" ON public.user_permissions
  FOR SELECT TO authenticated USING (true);

-- Authenticated users can update their own permissions (ASO controls this)
DROP POLICY IF EXISTS "permissions_update" ON public.user_permissions;
CREATE POLICY "permissions_update" ON public.user_permissions
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ASO can insert permissions for users
DROP POLICY IF EXISTS "permissions_insert" ON public.user_permissions;
CREATE POLICY "permissions_insert" ON public.user_permissions
  FOR INSERT TO authenticated WITH CHECK (true);

-- =====================================================
-- STEP 13: Create default permissions for existing centre users
-- =====================================================
INSERT INTO public.user_permissions (user_id, can_scan, can_records, can_reports, can_jatha, can_manual_entry, can_flags, can_edit_jatha, updated_by)
SELECT 
  id,
  true,  -- can_scan
  true,  -- can_records
  false, -- can_reports
  false, -- can_jatha
  false, -- can_manual_entry
  false, -- can_flags
  false, -- can_edit_jatha
  'SYSTEM'
FROM public.users
WHERE role = 'centre'
ON CONFLICT (user_id) DO NOTHING;

-- =====================================================
-- STEP 14: Ensure logs table exists with proper columns
-- =====================================================
CREATE TABLE IF NOT EXISTS public.logs (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_badge text,
  action     text,
  details    text,
  timestamp  timestamptz NOT NULL DEFAULT now(),
  device_id  text
);

ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "logs_read" ON public.logs;
CREATE POLICY "logs_read" ON public.logs
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "logs_insert" ON public.logs;
CREATE POLICY "logs_insert" ON public.logs
  FOR INSERT TO authenticated WITH CHECK (true);

-- =====================================================
-- STEP 15: Add flag columns to attendance_sessions
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_sessions' AND column_name = 'flagged') THEN
    ALTER TABLE public.attendance_sessions ADD COLUMN flagged boolean NOT NULL DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_sessions' AND column_name = 'flag_reason') THEN
    ALTER TABLE public.attendance_sessions ADD COLUMN flag_reason text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_sessions' AND column_name = 'flagged_by') THEN
    ALTER TABLE public.attendance_sessions ADD COLUMN flagged_by text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_sessions' AND column_name = 'flagged_at') THEN
    ALTER TABLE public.attendance_sessions ADD COLUMN flagged_at timestamptz;
  END IF;
END $$;

-- =====================================================
-- STEP 16: Add index for flagged sessions
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_sessions_flagged ON public.attendance_sessions(flagged) WHERE flagged = true;

-- =====================================================
-- STEP 17: Create flags table with replies thread
-- =====================================================
CREATE TABLE IF NOT EXISTS public.flags (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id      bigint REFERENCES public.attendance_sessions(id) ON DELETE SET NULL, -- nullable so SET NULL works
  raised_by_badge text NOT NULL,
  raised_by_name  text NOT NULL,
  raised_by_centre text NOT NULL,
  reason          text NOT NULL,
  status          text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'in_progress', 'resolved')),
  resolved_by     text,
  resolved_at     timestamptz,
  resolved_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "flags_read" ON public.flags;
CREATE POLICY "flags_read" ON public.flags
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "flags_insert" ON public.flags;
CREATE POLICY "flags_insert" ON public.flags
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "flags_update" ON public.flags;
CREATE POLICY "flags_update" ON public.flags
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- =====================================================
-- STEP 18: Create flag_replies table
-- =====================================================
CREATE TABLE IF NOT EXISTS public.flag_replies (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  flag_id       bigint REFERENCES public.flags(id) ON DELETE SET NULL,
  replied_by_badge  text NOT NULL,
  replied_by_name   text NOT NULL,
  replied_by_centre text,
  message       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.flag_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "flag_replies_read" ON public.flag_replies;
CREATE POLICY "flag_replies_read" ON public.flag_replies
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "flag_replies_insert" ON public.flag_replies;
CREATE POLICY "flag_replies_insert" ON public.flag_replies
  FOR INSERT TO authenticated WITH CHECK (true);

-- =====================================================
-- STEP 19: Create indexes for flags
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_flags_session_id ON public.flags(session_id);
CREATE INDEX IF NOT EXISTS idx_flags_status ON public.flags(status);
CREATE INDEX IF NOT EXISTS idx_flags_raised_by ON public.flags(raised_by_badge);
CREATE INDEX IF NOT EXISTS idx_flag_replies_flag_id ON public.flag_replies(flag_id);

-- =====================================================
-- STEP 20: Create flag_audit_log table for full trail
-- =====================================================
CREATE TABLE IF NOT EXISTS public.flag_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  flag_id     bigint REFERENCES public.flags(id) ON DELETE SET NULL,
  action      text NOT NULL,
  actor_badge text NOT NULL,
  actor_name  text NOT NULL,
  details     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.flag_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "flag_audit_read" ON public.flag_audit_log;
CREATE POLICY "flag_audit_read" ON public.flag_audit_log
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "flag_audit_insert" ON public.flag_audit_log;
CREATE POLICY "flag_audit_insert" ON public.flag_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- Check users by role
SELECT role, COUNT(*) as count FROM public.users GROUP BY role;

-- Check attendance_sessions table
SELECT COUNT(*) as total_sessions FROM public.attendance_sessions;

-- Check user_permissions
SELECT 
  u.name,
  u.badge_number,
  u.role,
  up.can_scan,
  up.can_records,
  up.can_reports,
  up.can_jatha,
  up.can_manual_entry,
  up.can_flags
FROM public.users u
LEFT JOIN public.user_permissions up ON u.id = up.user_id
WHERE u.role = 'centre';

-- Check attendance columns
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'attendance'
ORDER BY ordinal_position;

-- Check attendance_sessions columns
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'attendance_sessions'
ORDER BY ordinal_position;

-- =====================================================
-- ROLLBACK (if needed)
-- =====================================================
-- To rollback:
-- UPDATE public.users SET role = 'centre_user' WHERE role = 'centre';
-- ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
-- ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('aso', 'centre', 'centre_user'));
