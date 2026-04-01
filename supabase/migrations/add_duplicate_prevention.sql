-- =====================================================
-- Database Constraints for Duplicate Prevention
-- =====================================================
-- Run these in your Supabase SQL Editor
-- These add an extra layer of protection beyond the app-level checks
-- =====================================================

-- 1. Prevent duplicate IN scans within the same minute for same badge
-- This catches race conditions where two scans happen within milliseconds
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique_in 
ON attendance (badge_number, type, date_trunc('minute', scan_time::timestamptz AT TIME ZONE 'Asia/Kolkata'))
WHERE type = 'IN';

-- 2. Prevent duplicate OUT scans within the same minute for same badge
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique_out
ON attendance (badge_number, type, date_trunc('minute', scan_time::timestamptz AT TIME ZONE 'Asia/Kolkata'))
WHERE type = 'OUT';

-- 3. Performance indexes for common queries
-- Speed up session lookups by badge
CREATE INDEX IF NOT EXISTS idx_sessions_badge_open 
ON attendance_sessions(badge_number, is_open);

-- Speed up attendance lookups by badge and time
CREATE INDEX IF NOT EXISTS idx_attendance_badge_time 
ON attendance(badge_number, scan_time DESC);

-- Speed up jatha checks
CREATE INDEX IF NOT EXISTS idx_jatha_active 
ON jatha_attendance(badge_number, date_from, date_to)
WHERE flag = false;

-- Speed up centre-based queries
CREATE INDEX IF NOT EXISTS idx_centres_parent 
ON centres(parent_centre);

-- =====================================================
-- Note: The application-level check in sessionLogic.js
-- already prevents duplicate scans within 30 seconds.
-- These database constraints are an ADDITIONAL safeguard.
-- =====================================================