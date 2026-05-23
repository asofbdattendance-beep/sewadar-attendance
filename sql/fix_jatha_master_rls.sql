-- =============================================
-- FIX: jatha_master table & RLS policies
-- Run this in Supabase SQL Editor
-- =============================================

-- Step 1: Create jatha_master table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.jatha_master (
  id BIGSERIAL PRIMARY KEY,
  jatha_type TEXT NOT NULL CHECK (jatha_type IN ('beas', 'major_centre', 'jatha_home')),
  centre_name TEXT NOT NULL,
  department TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2: Enable RLS (safe to run multiple times)
ALTER TABLE public.jatha_master ENABLE ROW LEVEL SECURITY;

-- Step 3: Drop existing policies to recreate them cleanly
DROP POLICY IF EXISTS jatha_read ON public.jatha_master;
DROP POLICY IF EXISTS jatha_write ON public.jatha_master;

-- Step 4: Create read policy - all authenticated users can read jathas (reference data)
-- centre_name is the DESTINATION centre, not the user's own centre
CREATE POLICY jatha_read ON public.jatha_master
  FOR SELECT
  TO authenticated
  USING (true);

-- Step 5: Create write policy - only super_admin can manage jatha_master records
CREATE POLICY jatha_write ON public.jatha_master
  FOR ALL
  TO authenticated
  USING (public.get_user_role() = 'super_admin')
  WITH CHECK (public.get_user_role() = 'super_admin');

-- Step 6: Verify policies
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE tablename = 'jatha_master';

-- Step 7: Check if get_user_accessible_centres function exists
SELECT proname, prosrc
FROM pg_proc
WHERE proname = 'get_user_accessible_centres';

-- Step 8: Check if get_user_role function exists
SELECT proname, prosrc
FROM pg_proc
WHERE proname = 'get_user_role';
