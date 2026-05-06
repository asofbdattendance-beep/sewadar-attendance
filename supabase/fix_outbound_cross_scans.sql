-- =============================================================
-- Fix: Allow centres to see outbound cross-scans
-- A Tigaon admin should see sessions where Tigaon sewadars scanned elsewhere
-- =============================================================

-- Drop the old sessions_read policy
DROP POLICY IF EXISTS "sessions_read" ON attendance_sessions;

-- Recreate with outbound cross-scan support
CREATE POLICY "sessions_read" ON attendance_sessions FOR SELECT TO authenticated
  USING (
    -- ASO / centre_user: see all sessions
    get_user_role() IN ('aso', 'centre_user')
    -- Admin: see sessions at their centre
    OR centre = get_user_centre()
    -- Admin: ALSO see sessions where their centre's sewadars scanned elsewhere
    OR EXISTS (
      SELECT 1 FROM sewadars
      WHERE sewadars.badge_number = attendance_sessions.badge_number
        AND sewadars.centre = get_user_centre()
    )
  );

-- =============================================================
-- Verify: After running this, a Tigaon admin should see:
-- 1. All sessions scanned AT Tigaon
-- 2. All sessions where Tigaon sewadars scanned at other centres
-- =============================================================
