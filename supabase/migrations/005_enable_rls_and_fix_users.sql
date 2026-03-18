-- supabase/migrations/005_enable_rls_and_fix_users.sql
-- Enables RLS on all tables and ensures users table is queryable by authenticated users

-- ===========================
-- ENABLE RLS on all tables
-- ===========================
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE sewadars ENABLE ROW LEVEL SECURITY;
ALTER TABLE centres ENABLE ROW LEVEL SECURITY;
ALTER TABLE jatha_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE jatha_centres ENABLE ROW LEVEL SECURITY;
ALTER TABLE queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE query_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;

-- ===========================
-- USERS TABLE: ensure auth_id column exists and policies are correct
-- ===========================

-- Check if auth_id column exists, if not add it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'auth_id'
  ) THEN
    ALTER TABLE users ADD COLUMN auth_id UUID REFERENCES auth.users(id);
  END IF;
END $$;

-- Drop existing users policies (clean slate)
DROP POLICY IF EXISTS "users_select_own" ON users;
DROP POLICY IF EXISTS "users_select_aso" ON users;
DROP POLICY IF EXISTS "users_update_own" ON users;
DROP POLICY IF EXISTS "users_update_aso" ON users;
DROP POLICY IF EXISTS "users_insert_aso" ON users;

-- Users can read their own profile (needed for login + fetchProfile)
-- Note: uses current_setting() to avoid self-referential subquery circular evaluation
CREATE POLICY "users_select_own"
  ON users FOR SELECT
  TO authenticated
  USING (auth.uid() = users.auth_id);

-- Users can update their own profile (name, etc.)
CREATE POLICY "users_update_own"
  ON users FOR UPDATE
  TO authenticated
  USING (auth.uid() = users.auth_id)
  WITH CHECK (auth.uid() = users.auth_id);

-- Service role key bypasses RLS entirely, so no ASO-specific SELECT policy needed for the
-- edge function / service-role operations (user CRUD in super admin uses service role key).
-- For RLS-protected queries from the browser: ASO users read all via attendance/sewadars/centres
-- SELECT policies that already exist; they don't need to SELECT all users directly.
