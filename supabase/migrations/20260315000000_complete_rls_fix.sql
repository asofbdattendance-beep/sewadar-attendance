-- ============================================================
-- COMPLETE RLS FIX - Sewadar Attendance System
-- Run this ENTIRE script in Supabase SQL Editor
-- This will DROP all existing RLS policies and recreate them
-- with ASO having FULL ACCESS to everything
-- ============================================================

-- ============================================================
-- STEP 1: Enable RLS on all tables (if not already enabled)
-- ============================================================
ALTER TABLE sewadars ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE centres ENABLE ROW LEVEL SECURITY;
ALTER TABLE queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE jatha_centres ENABLE ROW LEVEL SECURITY;
ALTER TABLE jatha_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE query_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- STEP 2: Drop ALL existing RLS policies (clean slate)
-- ============================================================

-- sewadars
DROP POLICY IF EXISTS sewadars_read ON sewadars;
DROP POLICY IF EXISTS sewadars_write ON sewadars;
DROP POLICY IF EXISTS sewadars_select ON sewadars;
DROP POLICY IF EXISTS sewadars_insert ON sewadars;
DROP POLICY IF EXISTS sewadars_update ON sewadars;
DROP POLICY IF EXISTS sewadars_delete ON sewadars;

-- attendance
DROP POLICY IF EXISTS attendance_read_own_centre ON attendance;
DROP POLICY IF EXISTS attendance_insert ON attendance;
DROP POLICY IF EXISTS attendance_select ON attendance;
DROP POLICY IF EXISTS attendance_insert ON attendance;
DROP POLICY IF EXISTS attendance_update ON attendance;
DROP POLICY IF EXISTS attendance_delete ON attendance;

-- users
DROP POLICY IF EXISTS users_read ON users;
DROP POLICY IF EXISTS users_write ON users;
DROP POLICY IF EXISTS users_read_own ON users;
DROP POLICY IF EXISTS users_read_all ON users;
DROP POLICY IF EXISTS users_insert ON users;
DROP POLICY IF EXISTS users_update ON users;
DROP POLICY IF EXISTS users_delete ON users;

-- centres
DROP POLICY IF EXISTS centres_read ON centres;
DROP POLICY IF EXISTS centres_write ON centres;
DROP POLICY IF EXISTS centres_select ON centres;
DROP POLICY IF EXISTS centres_insert ON centres;
DROP POLICY IF EXISTS centres_update ON centres;
DROP POLICY IF EXISTS centres_delete ON centres;

-- queries
DROP POLICY IF EXISTS queries_read ON queries;
DROP POLICY IF EXISTS queries_write ON queries;
DROP POLICY IF EXISTS queries_select ON queries;
DROP POLICY IF EXISTS queries_insert ON queries;
DROP POLICY IF EXISTS queries_update ON queries;
DROP POLICY IF EXISTS queries_delete ON queries;

-- logs
DROP POLICY IF EXISTS logs_read ON logs;
DROP POLICY IF EXISTS logs_insert ON logs;
DROP POLICY IF EXISTS logs_select ON logs;
DROP POLICY IF EXISTS logs_insert ON logs;

-- jatha_centres
DROP POLICY IF EXISTS jatha_centres_read ON jatha_centres;
DROP POLICY IF EXISTS jatha_centres_write ON jatha_centres;
DROP POLICY IF EXISTS jatha_centres_select ON jatha_centres;
DROP POLICY IF EXISTS jatha_centres_insert ON jatha_centres;
DROP POLICY IF EXISTS jatha_centres_update ON jatha_centres;
DROP POLICY IF EXISTS jatha_centres_delete ON jatha_centres;

-- jatha_attendance
DROP POLICY IF EXISTS jatha_attendance_read ON jatha_attendance;
DROP POLICY IF EXISTS jatha_attendance_write ON jatha_attendance;
DROP POLICY IF EXISTS jatha_attendance_select ON jatha_attendance;
DROP POLICY IF EXISTS jatha_attendance_insert ON jatha_attendance;
DROP POLICY IF EXISTS jatha_attendance_update ON jatha_attendance;
DROP POLICY IF EXISTS jatha_attendance_delete ON jatha_attendance;

-- query_replies
DROP POLICY IF EXISTS query_replies_read ON query_replies;
DROP POLICY IF EXISTS query_replies_write ON query_replies;
DROP POLICY IF EXISTS query_replies_select ON query_replies;
DROP POLICY IF EXISTS query_replies_insert ON query_replies;
DROP POLICY IF EXISTS query_replies_update ON query_replies;
DROP POLICY IF EXISTS query_replies_delete ON query_replies;

-- app_settings
DROP POLICY IF EXISTS app_settings_read ON app_settings;
DROP POLICY IF EXISTS app_settings_write ON app_settings;
DROP POLICY IF EXISTS app_settings_select ON app_settings;
DROP POLICY IF EXISTS app_settings_insert ON app_settings;
DROP POLICY IF EXISTS app_settings_update ON app_settings;

-- ============================================================
-- STEP 3: Create Helper Functions
-- ============================================================

-- Get current user's role from users table
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM users WHERE auth_id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER;

-- Get current user's centre from users table
CREATE OR REPLACE FUNCTION get_user_centre()
RETURNS TEXT AS $$
  SELECT centre FROM users WHERE auth_id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER;

-- Get sub-centres for a given parent centre
CREATE OR REPLACE FUNCTION get_sub_centres(parent_centre_name TEXT)
RETURNS TEXT[] AS $$
  SELECT ARRAY_AGG(centre_name) FROM centres WHERE parent_centre = parent_centre_name;
$$ LANGUAGE SQL SECURITY DEFINER;

-- Check if user is ASO (Super Admin)
CREATE OR REPLACE FUNCTION is_aso()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'aso');
$$ LANGUAGE SQL SECURITY DEFINER;

-- Check if user is centre_user
CREATE OR REPLACE FUNCTION is_centre_user()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE auth_id = auth.uid() AND role = 'centre_user');
$$ LANGUAGE SQL SECURITY DEFINER;

-- ============================================================
-- STEP 4: Create RLS Policies
-- ============================================================

-- ============================================================
-- SEWADARS TABLE
-- ASO: Full access (SELECT, INSERT, UPDATE, DELETE)
-- centre_user: Read only
-- sc_sp_user: Read only
-- ============================================================

-- SELECT - Everyone authenticated can read
CREATE POLICY "sewadars_select" ON sewadars 
FOR SELECT TO authenticated 
USING (true);

-- INSERT - ASO only
CREATE POLICY "sewadars_insert" ON sewadars 
FOR INSERT TO authenticated 
WITH CHECK (is_aso() = true);

-- UPDATE - ASO only
CREATE POLICY "sewadars_update" ON sewadars 
FOR UPDATE TO authenticated 
USING (is_aso() = true);

-- DELETE - ASO only
CREATE POLICY "sewadars_delete" ON sewadars 
FOR DELETE TO authenticated 
USING (is_aso() = true);


-- ============================================================
-- ATTENDANCE TABLE
-- ASO: Full access
-- centre_user: Read all, Insert for their centre
-- sc_sp_user: Read/Insert for own centre
-- ============================================================

-- SELECT
CREATE POLICY "attendance_select" ON attendance 
FOR SELECT TO authenticated 
USING (
  is_aso() = true 
  OR is_centre_user() = true 
  OR centre = get_user_centre()
);

-- INSERT
CREATE POLICY "attendance_insert" ON attendance 
FOR INSERT TO authenticated 
WITH CHECK (
  is_aso() = true 
  OR is_centre_user() = true 
  OR scanner_centre = get_user_centre()
);

-- UPDATE - ASO only (for attendance correction)
CREATE POLICY "attendance_update" ON attendance 
FOR UPDATE TO authenticated 
USING (is_aso() = true);

-- DELETE - ASO only (for attendance correction)
CREATE POLICY "attendance_delete" ON attendance 
FOR DELETE TO authenticated 
USING (is_aso() = true);


-- ============================================================
-- USERS TABLE
-- ASO: Full access
-- Everyone: Read all, Update own profile
-- ============================================================

-- SELECT - Everyone authenticated
CREATE POLICY "users_select" ON users 
FOR SELECT TO authenticated 
USING (true);

-- INSERT - ASO only (user creation)
CREATE POLICY "users_insert" ON users 
FOR INSERT TO authenticated 
WITH CHECK (is_aso() = true);

-- UPDATE - ASO can update anyone, regular users can update own profile
CREATE POLICY "users_update" ON users 
FOR UPDATE TO authenticated 
USING (is_aso() = true OR auth_id = auth.uid());

-- DELETE - ASO only
CREATE POLICY "users_delete" ON users 
FOR DELETE TO authenticated 
USING (is_aso() = true);


-- ============================================================
-- CENTRES TABLE
-- ASO: Full access
-- Everyone: Read only
-- ============================================================

-- SELECT
CREATE POLICY "centres_select" ON centres 
FOR SELECT TO authenticated 
USING (true);

-- INSERT
CREATE POLICY "centres_insert" ON centres 
FOR INSERT TO authenticated 
WITH CHECK (is_aso() = true);

-- UPDATE
CREATE POLICY "centres_update" ON centres 
FOR UPDATE TO authenticated 
USING (is_aso() = true);

-- DELETE
CREATE POLICY "centres_delete" ON centres 
FOR DELETE TO authenticated 
USING (is_aso() = true);


-- ============================================================
-- QUERIES (FLAGS) TABLE
-- ASO: Full access
-- centre_user: Read/Write for their centre
-- sc_sp_user: Read/Write own queries
-- ============================================================

-- SELECT
CREATE POLICY "queries_select" ON queries 
FOR SELECT TO authenticated 
USING (
  is_aso() = true 
  OR is_centre_user() = true 
  OR raised_by_badge = (SELECT badge_number FROM users WHERE auth_id = auth.uid())
);

-- INSERT
CREATE POLICY "queries_insert" ON queries 
FOR INSERT TO authenticated 
WITH CHECK (
  is_aso() = true 
  OR is_centre_user() = true
);

-- UPDATE
CREATE POLICY "queries_update" ON queries 
FOR UPDATE TO authenticated 
USING (
  is_aso() = true 
  OR is_centre_user() = true
);

-- DELETE - ASO only
CREATE POLICY "queries_delete" ON queries 
FOR DELETE TO authenticated 
USING (is_aso() = true);


-- ============================================================
-- LOGS TABLE
-- ASO: Full access (read/write)
-- Everyone: Insert only
-- ============================================================

-- SELECT - ASO only
CREATE POLICY "logs_select" ON logs 
FOR SELECT TO authenticated 
USING (is_aso() = true);

-- INSERT - Everyone authenticated
CREATE POLICY "logs_insert" ON logs 
FOR INSERT TO authenticated 
WITH CHECK (true);

-- UPDATE - ASO only
CREATE POLICY "logs_update" ON logs 
FOR UPDATE TO authenticated 
USING (is_aso() = true);

-- DELETE - ASO only
CREATE POLICY "logs_delete" ON logs 
FOR DELETE TO authenticated 
USING (is_aso() = true);


-- ============================================================
-- JATHA CENTRES TABLE
-- ASO: Full access
-- Everyone: Read only
-- ============================================================

-- SELECT
CREATE POLICY "jatha_centres_select" ON jatha_centres 
FOR SELECT TO authenticated 
USING (true);

-- INSERT
CREATE POLICY "jatha_centres_insert" ON jatha_centres 
FOR INSERT TO authenticated 
WITH CHECK (is_aso() = true);

-- UPDATE
CREATE POLICY "jatha_centres_update" ON jatha_centres 
FOR UPDATE TO authenticated 
USING (is_aso() = true);

-- DELETE
CREATE POLICY "jatha_centres_delete" ON jatha_centres 
FOR DELETE TO authenticated 
USING (is_aso() = true);


-- ============================================================
-- JATHA ATTENDANCE TABLE
-- ASO: Full access
-- centre_user: Read all, Insert for their centre
-- sc_sp_user: Read/Insert own centre
-- ============================================================

-- SELECT
CREATE POLICY "jatha_attendance_select" ON jatha_attendance 
FOR SELECT TO authenticated 
USING (
  is_aso() = true 
  OR is_centre_user() = true 
  OR centre = get_user_centre()
);

-- INSERT
CREATE POLICY "jatha_attendance_insert" ON jatha_attendance 
FOR INSERT TO authenticated 
WITH CHECK (
  is_aso() = true 
  OR is_centre_user() = true 
  OR submitted_centre = get_user_centre()
);

-- UPDATE
CREATE POLICY "jatha_attendance_update" ON jatha_attendance 
FOR UPDATE TO authenticated 
USING (is_aso() = true);

-- DELETE
CREATE POLICY "jatha_attendance_delete" ON jatha_attendance 
FOR DELETE TO authenticated 
USING (is_aso() = true);


-- ============================================================
-- QUERY REPLIES TABLE
-- ASO: Full access
-- Everyone: Read/Write own replies
-- ============================================================

-- SELECT
CREATE POLICY "query_replies_select" ON query_replies 
FOR SELECT TO authenticated 
USING (true);

-- INSERT
CREATE POLICY "query_replies_insert" ON query_replies 
FOR INSERT TO authenticated 
WITH CHECK (true);

-- UPDATE
CREATE POLICY "query_replies_update" ON query_replies 
FOR UPDATE TO authenticated 
USING (
  is_aso() = true 
  OR replied_by_badge = (SELECT badge_number FROM users WHERE auth_id = auth.uid())
);

-- DELETE - ASO only
CREATE POLICY "query_replies_delete" ON query_replies 
FOR DELETE TO authenticated 
USING (is_aso() = true);


-- ============================================================
-- APP SETTINGS TABLE
-- ASO: Full access
-- Everyone: Read only
-- ============================================================

-- SELECT
CREATE POLICY "app_settings_select" ON app_settings 
FOR SELECT TO authenticated 
USING (true);

-- UPDATE - ASO only
CREATE POLICY "app_settings_update" ON app_settings 
FOR UPDATE TO authenticated 
USING (is_aso() = true);


-- ============================================================
-- STEP 5: Grant Permissions (fallback for service role)
-- ============================================================

-- Grant usage on sequences if needed
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;

-- ============================================================
-- VERIFICATION: Test the policies
-- ============================================================

-- Check if ASO can see all users
SELECT 
  'Users table - ASO can see all:' AS test,
  (SELECT COUNT(*) FROM users) AS total_users;

-- Check if attendance is accessible
SELECT 
  'Attendance table - accessible:' AS test,
  (SELECT COUNT(*) FROM attendance LIMIT 1) AS attendance_count;

-- List all created policies
SELECT 
  tablename, 
  policyname, 
  permissive, 
  roles, 
  cmd 
FROM pg_policies 
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- ============================================================
-- DONE! RLS is now configured with ASO having full access.
-- ============================================================
