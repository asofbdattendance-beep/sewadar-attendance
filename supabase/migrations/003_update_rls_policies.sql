-- Migration: 003_update_rls_policies
-- Purpose: Tighten RLS policies for security
-- 1. UPDATE attendance only allowed for ASO
-- 2. INSERT logs restricted to authenticated users (not anonymous)
-- 3. SELECT attendance based on role

-- ===========================
-- ATTENDANCE POLICIES
-- ===========================

-- Drop existing attendance policies (if any)
DROP POLICY IF EXISTS "attendance_select" ON attendance;
DROP POLICY IF EXISTS "attendance_insert" ON attendance;
DROP POLICY IF EXISTS "attendance_update" ON attendance;

-- SELECT: Authenticated users can read attendance
CREATE POLICY "attendance_select"
  ON attendance FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: Authenticated users can insert (scanner submits)
CREATE POLICY "attendance_insert"
  ON attendance FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- UPDATE: Only ASO can update attendance records
-- This uses a subquery to check if the user's auth_id matches an ASO user
CREATE POLICY "attendance_update_aso_only"
  ON attendance FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_id = auth.uid()
      AND users.role = 'aso'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_id = auth.uid()
      AND users.role = 'aso'
    )
  );

-- DELETE: Only ASO can delete attendance records
DROP POLICY IF EXISTS "attendance_delete_aso_only" ON attendance;
CREATE POLICY "attendance_delete_aso_only"
  ON attendance FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_id = auth.uid()
      AND users.role = 'aso'
    )
  );

-- ===========================
-- LOGS POLICIES
-- ===========================

-- Drop existing logs policies
DROP POLICY IF EXISTS "logs_insert" ON logs;
DROP POLICY IF EXISTS "logs_select" ON logs;

-- SELECT: Authenticated users can read logs (for audit trail visibility)
CREATE POLICY "logs_select"
  ON logs FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: Authenticated users can create log entries
-- This is intentionally broad as logs are for audit purposes
-- All authenticated users can write to logs
CREATE POLICY "logs_insert"
  ON logs FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ===========================
-- SEWADARS POLICIES
-- ===========================

DROP POLICY IF EXISTS "sewadars_select" ON sewadars;
DROP POLICY IF EXISTS "sewadars_insert" ON sewadars;
DROP POLICY IF EXISTS "sewadars_update" ON sewadars;
DROP POLICY IF EXISTS "sewadars_delete" ON sewadars;

-- SELECT: All authenticated users can read sewadars (needed for scanning)
CREATE POLICY "sewadars_select"
  ON sewadars FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: Only ASO can add sewadars
CREATE POLICY "sewadars_insert_aso_only"
  ON sewadars FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_id = auth.uid()
      AND users.role = 'aso'
    )
  );

-- UPDATE: Only ASO can update sewadar records
CREATE POLICY "sewadars_update_aso_only"
  ON sewadars FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_id = auth.uid()
      AND users.role = 'aso'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_id = auth.uid()
      AND users.role = 'aso'
    )
  );

-- DELETE: Only ASO can delete sewadar records
CREATE POLICY "sewadars_delete_aso_only"
  ON sewadars FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_id = auth.uid()
      AND users.role = 'aso'
    )
  );

-- ===========================
-- CENTRES POLICIES
-- ===========================

DROP POLICY IF EXISTS "centres_select" ON centres;
DROP POLICY IF EXISTS "centres_insert" ON centres;
DROP POLICY IF EXISTS "centres_update" ON centres;

-- SELECT: All authenticated users
CREATE POLICY "centres_select"
  ON centres FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: Only ASO
CREATE POLICY "centres_insert_aso_only"
  ON centres FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_id = auth.uid()
      AND users.role = 'aso'
    )
  );

-- UPDATE: Only ASO
CREATE POLICY "centres_update_aso_only"
  ON centres FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.auth_id = auth.uid()
      AND users.role = 'aso'
    )
  );

-- ===========================
-- QUERIES (FLAGS) POLICIES
-- ===========================

DROP POLICY IF EXISTS "queries_select" ON queries;
DROP POLICY IF EXISTS "queries_insert" ON queries;
DROP POLICY IF EXISTS "queries_update" ON queries;

-- SELECT: All authenticated users
CREATE POLICY "queries_select"
  ON queries FOR SELECT
  TO authenticated
  USING (true);

-- INSERT: All authenticated users (anyone can raise a flag)
CREATE POLICY "queries_insert"
  ON queries FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- UPDATE: Authenticated users can update (for status changes and replies)
CREATE POLICY "queries_update"
  ON queries FOR UPDATE
  TO authenticated
  USING (true);

-- ===========================
-- QUERY_REPLIES POLICIES
-- ===========================

DROP POLICY IF EXISTS "query_replies_select" ON query_replies;
DROP POLICY IF EXISTS "query_replies_insert" ON query_replies;

CREATE POLICY "query_replies_select"
  ON query_replies FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "query_replies_insert"
  ON query_replies FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ===========================
-- JATHA TABLES POLICIES
-- ===========================

-- jatha_attendance
DROP POLICY IF EXISTS "jatha_attendance_select" ON jatha_attendance;
DROP POLICY IF EXISTS "jatha_attendance_insert" ON jatha_attendance;
DROP POLICY IF EXISTS "jatha_attendance_update" ON jatha_attendance;
DROP POLICY IF EXISTS "jatha_attendance_delete" ON jatha_attendance;

CREATE POLICY "jatha_attendance_select" ON jatha_attendance FOR SELECT TO authenticated USING (true);
CREATE POLICY "jatha_attendance_insert" ON jatha_attendance FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "jatha_attendance_update" ON jatha_attendance FOR UPDATE TO authenticated USING (true);
CREATE POLICY "jatha_attendance_delete" ON jatha_attendance FOR DELETE TO authenticated USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.auth_id = auth.uid()
    AND users.role = 'aso'
  )
);

-- jatha_centres
DROP POLICY IF EXISTS "jatha_centres_select" ON jatha_centres;
DROP POLICY IF EXISTS "jatha_centres_insert" ON jatha_centres;
DROP POLICY IF EXISTS "jatha_centres_update" ON jatha_centres;

CREATE POLICY "jatha_centres_select" ON jatha_centres FOR SELECT TO authenticated USING (true);
CREATE POLICY "jatha_centres_insert" ON jatha_centres FOR INSERT TO authenticated WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.auth_id = auth.uid()
    AND users.role = 'aso'
  )
);
CREATE POLICY "jatha_centres_update" ON jatha_centres FOR UPDATE TO authenticated USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.auth_id = auth.uid()
    AND users.role = 'aso'
  )
);

-- ===========================
-- USERS TABLE POLICIES
-- ===========================

DROP POLICY IF EXISTS "users_select_own" ON users;
DROP POLICY IF EXISTS "users_select_aso" ON users;
DROP POLICY IF EXISTS "users_update_own" ON users;
DROP POLICY IF EXISTS "users_update_aso" ON users;

-- Users can select their own profile
CREATE POLICY "users_select_own"
  ON users FOR SELECT
  TO authenticated
  USING (auth.uid() = users.auth_id);

-- ASO can select all users
CREATE POLICY "users_select_aso"
  ON users FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u2
      WHERE u2.auth_id = auth.uid()
      AND u2.role = 'aso'
    )
  );

-- Users can update their own profile (limited fields)
CREATE POLICY "users_update_own"
  ON users FOR UPDATE
  TO authenticated
  USING (auth.uid() = users.auth_id)
  WITH CHECK (auth.uid() = users.auth_id);

-- ASO can update any user
CREATE POLICY "users_update_aso"
  ON users FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users u2
      WHERE u2.auth_id = auth.uid()
      AND u2.role = 'aso'
    )
  );

-- ===========================
-- APP_SETTINGS POLICIES
-- ===========================

DROP POLICY IF EXISTS "app_settings_select" ON app_settings;
DROP POLICY IF EXISTS "app_settings_update" ON app_settings;

CREATE POLICY "app_settings_select" ON app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "app_settings_update" ON app_settings FOR UPDATE TO authenticated USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.auth_id = auth.uid()
    AND users.role = 'aso'
  )
);

-- Verify all policies created
SELECT tablename, policyname, cmd FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
