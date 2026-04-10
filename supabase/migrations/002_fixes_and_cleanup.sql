-- =====================================================
-- SEWADAR ATTENDANCE SYSTEM - FIXES & CLEANUP
-- =====================================================
-- Run this AFTER 001_production_setup.sql
-- =====================================================

-- =====================================================
-- 1. FIX ORPHAN ATTENDANCE RECORDS
-- =====================================================

-- Fix attendance records with invalid session_id
UPDATE attendance a
SET session_id = NULL
WHERE session_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM attendance_sessions s WHERE s.id = a.session_id
);

-- =====================================================
-- 2. BACKFILL MISSING DATA (Run if needed)
-- =====================================================

-- Backfill date_ist from in_time for sessions that are missing it
UPDATE attendance_sessions
SET date_ist = DATE(in_time AT TIME ZONE 'Asia/Kolkata')
WHERE date_ist IS NULL AND in_time IS NOT NULL;

-- Backfill updated_at from created_at for older records
UPDATE attendance_sessions
SET updated_at = created_at
WHERE updated_at IS NULL;

-- Backfill in_scanner_name from scanner_name for manual entries
UPDATE attendance_sessions
SET in_scanner_name = scanner_name
WHERE in_scanner_name IS NULL AND scanner_name IS NOT NULL;


-- =====================================================
-- 3. CLEANUP OLD/DUPLICATE SESSIONS (Review first!)
-- =====================================================

-- Find potential duplicate sessions (same badge, same date, overlapping times)
-- SELECT 
--     badge_number,
--     date_ist,
--     COUNT(*) as session_count,
--     ARRAY_AGG(id ORDER BY created_at) as session_ids,
--     ARRAY_AGG(in_time ORDER BY created_at) as in_times,
--     ARRAY_AGG(out_time ORDER BY created_at) as out_times
-- FROM attendance_sessions
-- WHERE date_ist = CURRENT_DATE
-- GROUP BY badge_number, date_ist
-- HAVING COUNT(*) > 1
-- ORDER BY badge_number;


-- =====================================================
-- 4. VERIFY DATA INTEGRITY
-- =====================================================

-- Count of sessions without proper IN attendance
-- SELECT COUNT(*) FROM attendance_sessions s
-- WHERE NOT EXISTS (
--     SELECT 1 FROM attendance a 
--     WHERE a.session_id = s.id AND a.type = 'IN'
-- );

-- Count of sessions with IN but missing in_id
-- SELECT COUNT(*) FROM attendance_sessions
-- WHERE in_time IS NOT NULL AND in_id IS NULL;

-- Count of sessions with OUT but missing out_id
-- SELECT COUNT(*) FROM attendance_sessions
-- WHERE out_time IS NOT NULL AND out_id IS NULL;

-- =====================================================
-- 5. ADD MORE USEFUL INDEXES (if needed)
-- =====================================================

-- Composite index for dashboard queries
CREATE INDEX IF NOT EXISTS idx_sessions_centre_date_type
    ON attendance_sessions(centre, date_ist, duty_type);

-- Index for logs table
CREATE INDEX IF NOT EXISTS idx_logs_user_time
    ON logs(user_badge, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_logs_action
    ON logs(action, timestamp DESC);


-- =====================================================
-- 6. ROW LEVEL SECURITY POLICIES (Optional - review carefully!)
-- =====================================================

-- Enable RLS on tables (uncomment if needed)
-- ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE sewadars ENABLE ROW LEVEL SECURITY;

-- Example policies (customize based on your needs):
/*
-- Centre users can only see their own centre's data
CREATE POLICY "Centre users view own centre"
    ON attendance_sessions FOR SELECT
    USING (
        auth.jwt() ->> 'role' = 'centre' 
        AND centre = (auth.jwt() ->> 'centre')
    );

-- ASO can view all
CREATE POLICY "ASO can view all"
    ON attendance_sessions FOR SELECT
    USING (auth.jwt() ->> 'role' = 'aso');
*/


-- =====================================================
-- 7. VACCUM & REINDEX (Run monthly)
-- =====================================================

-- VACUUM ANALYZE attendance_sessions;
-- VACUUM ANALYZE attendance;
-- VACUUM ANALYZE users;
-- VACUUM ANALYZE sewadars;

-- REINDEX TABLE attendance_sessions;
-- REINDEX TABLE attendance;
