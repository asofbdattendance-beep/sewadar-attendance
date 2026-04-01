-- =====================================================
-- Clean Up Duplicates and Add Constraints
-- =====================================================
-- This removes duplicates keeping the FIRST (earliest) record
-- =====================================================

-- Step 1: Delete duplicates, keeping the earliest record
DELETE FROM attendance
WHERE id IN (
    SELECT id FROM (
        SELECT 
            id,
            badge_number,
            type,
            scan_time,
            ROW_NUMBER() OVER (
                PARTITION BY 
                    badge_number, 
                    type, 
                    date_trunc('minute', scan_time::timestamptz AT TIME ZONE 'Asia/Kolkata')
                ORDER BY scan_time ASC  -- KEEP FIRST (earliest)
            ) as row_num
        FROM attendance
    ) sub
    WHERE row_num > 1
);

-- Step 2: Create unique constraints (now will work)
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique_in 
ON attendance (badge_number, type, date_trunc('minute', scan_time::timestamptz AT TIME ZONE 'Asia/Kolkata'))
WHERE type = 'IN';

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique_out
ON attendance (badge_number, type, date_trunc('minute', scan_time::timestamptz AT TIME ZONE 'Asia/Kolkata'))
WHERE type = 'OUT';

-- Step 3: Performance indexes
CREATE INDEX IF NOT EXISTS idx_sessions_badge_open ON attendance_sessions(badge_number, is_open);
CREATE INDEX IF NOT EXISTS idx_attendance_badge_time ON attendance(badge_number, scan_time DESC);
CREATE INDEX IF NOT EXISTS idx_jatha_active ON jatha_attendance(badge_number, date_from, date_to) WHERE flag = false;
CREATE INDEX IF NOT EXISTS idx_centres_parent ON centres(parent_centre);

-- Verify it's done
SELECT 
    date_trunc('minute', scan_time::timestamptz AT TIME ZONE 'Asia/Kolkata') as scan_minute,
    badge_number,
    type,
    COUNT(*) as cnt
FROM attendance
GROUP BY scan_minute, badge_number, type
HAVING COUNT(*) > 1
ORDER BY cnt DESC
LIMIT 5;