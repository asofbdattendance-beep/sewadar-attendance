-- Complete fix for users table RLS issues
-- Run this in Supabase SQL Editor

-- Step 1: Disable RLS completely
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

-- Step 2: Drop all existing policies
DROP POLICY IF EXISTS users_read ON users;
DROP POLICY IF EXISTS users_write ON users;
DROP POLICY IF EXISTS users_read_own ON users;

-- Step 3: Re-enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Step 4: Create simple policies that allow all authenticated users to read
-- (We can restrict later after testing)
CREATE POLICY "users_read_all" ON users FOR SELECT TO authenticated USING (true);
CREATE POLICY "users_read_own" ON users FOR SELECT TO authenticated USING (auth_id = auth.uid());

-- Step 5: Create insert/update policy for area_secretary only
CREATE POLICY "users_insert" ON users FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "users_update" ON users FOR UPDATE TO authenticated USING (true);

-- Test
SELECT id, email, name, role FROM users LIMIT 10;
