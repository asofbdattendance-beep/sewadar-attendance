-- Migration: 001_add_performance_indexes
-- Purpose: Add composite indexes for fast pagination and search on large datasets (up to 4000 sewadars)
-- Run this AFTER your main schema is set up

-- ===========================
-- ATTENDANCE INDEXES
-- ===========================

-- Primary search pattern: filter by centre + date range + search by badge/name
CREATE INDEX IF NOT EXISTS idx_attendance_centre_date
  ON attendance(centre, DATE(scan_time) DESC);

-- Secondary: badge lookup within a centre
CREATE INDEX IF NOT EXISTS idx_attendance_badge_scan
  ON attendance(badge_number, scan_time DESC);

-- Manual entry flag for filtering
CREATE INDEX IF NOT EXISTS idx_attendance_manual
  ON attendance(manual_entry) WHERE manual_entry = TRUE;

-- Flagged records via queries join
CREATE INDEX IF NOT EXISTS idx_attendance_created
  ON attendance(created_at DESC);

-- ===========================
-- SEWADARS INDEXES
-- ===========================

-- Centre-based listing (for Centre Admins seeing their 1000 sewadars)
CREATE INDEX IF NOT EXISTS idx_sewadars_centre
  ON sewadars(centre, badge_number);

-- Fast ILIKE search on name (case-insensitive)
CREATE INDEX IF NOT EXISTS idx_sewadars_name_lower
  ON sewadars(LOWER(sewadar_name));

-- Badge status filter (only active sewadars)
CREATE INDEX IF NOT EXISTS idx_sewadars_status
  ON sewadars(badge_status) WHERE badge_status IN ('open', 'permanent', 'elderly');

-- ===========================
-- QUERIES (FLAGS) INDEXES
-- ===========================

-- Filter by status (open/in_progress/resolved)
CREATE INDEX IF NOT EXISTS idx_queries_status
  ON queries(status);

-- Centre-based queries for Centre Admins
CREATE INDEX IF NOT EXISTS idx_queries_raised_centre
  ON queries(raised_by_centre);

-- Quick lookup by target centre
CREATE INDEX IF NOT EXISTS idx_queries_target_centre
  ON queries(target_centre) WHERE target_centre IS NOT NULL;

-- ===========================
-- JATHA INDEXES
-- ===========================

-- Date range queries for reports
CREATE INDEX IF NOT EXISTS idx_jatha_dates
  ON jatha_attendance(date_from, date_to);

-- Centre + type filtering
CREATE INDEX IF NOT EXISTS idx_jatha_centre_type
  ON jatha_attendance(jatha_centre, jatha_type);

-- ===========================
-- CENTRES INDEXES
-- ===========================

-- Parent-child hierarchy lookup
CREATE INDEX IF NOT EXISTS idx_centres_parent
  ON centres(parent_centre) WHERE parent_centre IS NOT NULL;

-- ===========================
-- USERS INDEXES
-- ===========================

-- Role-based user lookup
CREATE INDEX IF NOT EXISTS idx_users_role
  ON users(role);

-- Centre-based user listing
CREATE INDEX IF NOT EXISTS idx_users_centre
  ON users(centre);

-- Confirm all indexes created
SELECT indexname, tablename FROM pg_indexes
WHERE schemaname = 'public'
AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;
