-- Migration: 001_add_performance_indexes (FIXED)

-- ===========================
-- ATTENDANCE INDEXES
-- ===========================

-- ✅ FIXED: removed DATE()
CREATE INDEX IF NOT EXISTS idx_attendance_centre_scan_time
  ON attendance(centre, scan_time DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_badge_scan
  ON attendance(badge_number, scan_time DESC);

-- ❌ REMOVED (will be added later after column exists)
-- idx_attendance_manual

CREATE INDEX IF NOT EXISTS idx_attendance_created
  ON attendance(created_at DESC);

-- ===========================
-- SEWADARS
-- ===========================

CREATE INDEX IF NOT EXISTS idx_sewadars_centre
  ON sewadars(centre, badge_number);

CREATE INDEX IF NOT EXISTS idx_sewadars_name_lower
  ON sewadars(LOWER(sewadar_name));

CREATE INDEX IF NOT EXISTS idx_sewadars_status
  ON sewadars(badge_status)
  WHERE badge_status IN ('open', 'permanent', 'elderly');

-- ===========================
-- QUERIES
-- ===========================

CREATE INDEX IF NOT EXISTS idx_queries_status
  ON queries(status);

CREATE INDEX IF NOT EXISTS idx_queries_raised_centre
  ON queries(raised_by_centre);

CREATE INDEX IF NOT EXISTS idx_queries_target_centre
  ON queries(target_centre)
  WHERE target_centre IS NOT NULL;

-- ===========================
-- JATHA
-- ===========================

CREATE INDEX IF NOT EXISTS idx_jatha_dates
  ON jatha_attendance(date_from, date_to);

CREATE INDEX IF NOT EXISTS idx_jatha_centre_type
  ON jatha_attendance(jatha_centre, jatha_type);

-- ===========================
-- CENTRES
-- ===========================

CREATE INDEX IF NOT EXISTS idx_centres_parent
  ON centres(parent_centre)
  WHERE parent_centre IS NOT NULL;

-- ===========================
-- USERS
-- ===========================

CREATE INDEX IF NOT EXISTS idx_users_role
  ON users(role);

CREATE INDEX IF NOT EXISTS idx_users_centre
  ON users(centre);