-- =====================================================
-- FIX: Set proper ON DELETE for FK constraints
-- Fixes 409 Conflict on session deletion
-- Run in Supabase SQL Editor
-- =====================================================

-- attendance.session_id -> attendance_sessions(id)
-- Change from NO ACTION to SET NULL so deleting a session
-- sets session_id = null on attendance rows (preserves audit trail)
ALTER TABLE public.attendance
  DROP CONSTRAINT IF EXISTS fk_attendance_session_id,
  ADD CONSTRAINT fk_attendance_session_id
  FOREIGN KEY (session_id) REFERENCES public.attendance_sessions(id)
  ON DELETE SET NULL;

-- attendance_sessions.in_id -> attendance(id)
-- SET NULL so clearing in_id won't fail if attendance row exists
ALTER TABLE public.attendance_sessions
  DROP CONSTRAINT IF EXISTS fk_sessions_in_id,
  ADD CONSTRAINT fk_sessions_in_id
  FOREIGN KEY (in_id) REFERENCES public.attendance(id)
  ON DELETE SET NULL;

-- attendance_sessions.out_id -> attendance(id)
-- SET NULL so clearing out_id won't fail if attendance row exists
ALTER TABLE public.attendance_sessions
  DROP CONSTRAINT IF EXISTS fk_sessions_out_id,
  ADD CONSTRAINT fk_sessions_out_id
  FOREIGN KEY (out_id) REFERENCES public.attendance(id)
  ON DELETE SET NULL;

-- Verify
SELECT tc.constraint_name, tc.table_name, kcu.column_name,
       ccu.table_name AS foreign_table_name,
       ccu.column_name AS foreign_column_name,
       rc.delete_rule
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints AS rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_name IN ('attendance', 'attendance_sessions');
