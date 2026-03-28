-- Fix flags FK to preserve conversations when sessions are deleted
-- Run this in Supabase SQL Editor

-- 1. Drop existing FK on flags (it likely has CASCADE)
DO $$
BEGIN
  -- Find and drop the constraint
  ALTER TABLE public.flags DROP CONSTRAINT IF EXISTS flags_session_id_fkey;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Constraint not found or already dropped: %', SQLERRM;
END $$;

-- 2. Re-add FK with SET NULL (preserves flag when session deleted)
ALTER TABLE public.flags ADD CONSTRAINT flags_session_id_fkey 
  FOREIGN KEY (session_id) REFERENCES public.attendance_sessions(id) ON DELETE SET NULL;

-- 3. Drop existing FK on flag_replies
DO $$
BEGIN
  ALTER TABLE public.flag_replies DROP CONSTRAINT IF EXISTS flag_replies_flag_id_fkey;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Constraint not found: %', SQLERRM;
END $$;

-- 4. Re-add FK with SET NULL (preserves reply when flag deleted)
ALTER TABLE public.flag_replies ADD CONSTRAINT flag_replies_flag_id_fkey 
  FOREIGN KEY (flag_id) REFERENCES public.flags(id) ON DELETE SET NULL;

-- 5. Drop existing FK on flag_audit_log
DO $$
BEGIN
  ALTER TABLE public.flag_audit_log DROP CONSTRAINT IF EXISTS flag_audit_log_flag_id_fkey;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Constraint not found: %', SQLERRM;
END $$;

-- 6. Re-add FK with SET NULL
ALTER TABLE public.flag_audit_log ADD CONSTRAINT flag_audit_log_flag_id_fkey 
  FOREIGN KEY (flag_id) REFERENCES public.flags(id) ON DELETE SET NULL;

-- Verify: check current constraints
SELECT 
  tc.constraint_name,
  tc.table_name,
  cc.column_name,
  rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.constraint_column_usage cc ON tc.constraint_name = cc.constraint_name
JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN ('flags', 'flag_replies', 'flag_audit_log')
ORDER BY tc.table_name;

-- 7. Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_flags_session_id ON public.flags(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_flag_replies_flag_id ON public.flag_replies(flag_id) WHERE flag_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_flag_audit_flag_id ON public.flag_audit_log(flag_id) WHERE flag_id IS NOT NULL;
