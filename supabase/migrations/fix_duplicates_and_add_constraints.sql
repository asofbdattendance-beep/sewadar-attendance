-- =====================================================
-- Fix Existing Duplicates and Add Constraints
-- =====================================================
-- Run these in your Supabase SQL Editor
-- =====================================================

-- Step 1: Identify duplicates (for review)
-- This shows which badges have duplicate scans within same minute
SELECT 
    badge_number,
    type,
    date_trunc('minute', scan_time::timestamptz AT TIME ZONE 'Asia/Kolkata') as scan_minute,
    COUNT(*) as duplicate_count,
    array_agg(id) as record_ids
FROM attendance
GROUP BY badge_number, type, scan_minute
HAVING COUNT(*) > 1
ORDER BY badge_number, scan_minute
LIMIT 20;

-- Step 2: Delete duplicates, keeping the first/latest record
-- Run this ONLY if you want to automatically remove duplicates
-- WARNING: This will delete duplicate attendance records!
DELETE FROM attendance
WHERE id IN (
    SELECT id FROM (
        SELECT 
            id,
            badge_number,
            type,
            scan_time,
            ROW_NUMBER() OVER (
                PARTITION BY badge_number, type, date_trunc('minute', scan_time::timestamptz AT TIME ZONE 'Asia/Kolkata')
                ORDER BY scan_time DESC
            ) as row_num
        FROM attendance
    ) sub
    WHERE row_num > 1
);

-- Step 3: Now create the unique constraints (will work after duplicates removed)
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique_in 
ON attendance (badge_number, type, date_trunc('minute', scan_time::timestamptz AT TIME ZONE 'Asia/Kolkata'))
WHERE type = 'IN';

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique_out
ON attendance (badge_number, type, date_trunc('minute', scan_time::timestamptz AT TIME ZONE 'Asia/Kolkata'))
WHERE type = 'OUT';

-- Step 4: Add performance indexes
CREATE INDEX IF NOT EXISTS idx_sessions_badge_open ON attendance_sessions(badge_number, is_open);
CREATE INDEX IF NOT EXISTS idx_attendance_badge_time ON attendance(badge_number, scan_time DESC);
CREATE INDEX IF NOT EXISTS idx_jatha_active ON jatha_attendance(badge_number, date_from, date_to) WHERE flag = false;
CREATE INDEX IF NOT EXISTS idx_centres_parent ON centres(parent_centre);