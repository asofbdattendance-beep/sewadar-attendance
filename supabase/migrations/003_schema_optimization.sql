-- =====================================================
-- SEWADAR ATTENDANCE - SCHEMA OPTIMIZATION
-- Creates views & indexes after columns were dropped
-- =====================================================

-- =====================================================
-- STEP 1: CREATE VIEWS
-- =====================================================

-- View 1: Attendance with full sewadar info (use this instead of attendance table)
CREATE OR REPLACE VIEW v_attendance AS
SELECT 
  a.id,
  a.badge_number,
  a.type,
  a.scan_time,
  a.scanner_badge,
  a.scanner_name,
  a.scanner_centre,
  a.latitude,
  a.longitude,
  a.device_id,
  a.created_at,
  a.session_id,
  a.manual_entry,
  a.submitted_by,
  a.submitted_at,
  a.duty_type,
  -- Sewadar info (joined)
  s.sewadar_name,
  s.centre AS sewadar_centre,
  s.department AS sewadar_department,
  s.badge_status,
  s.gender
FROM attendance a
INNER JOIN sewadars s ON a.badge_number = s.badge_number;

-- View 2: Sessions with full sewadar info
CREATE OR REPLACE VIEW v_sessions AS
SELECT 
  sess.id,
  sess.badge_number,
  sess.duty_type,
  sess.in_id,
  sess.out_id,
  sess.in_time,
  sess.out_time,
  sess.date_ist,
  sess.is_open,
  sess.force_closed,
  sess.force_closed_reason,
  sess.force_closed_by,
  sess.manual_in,
  sess.manual_out,
  sess.scanner_badge,
  sess.scanner_name,
  sess.scanner_centre,
  sess.in_scanner_name,
  sess.out_scanner_name,
  sess.flagged,
  sess.flag_reason,
  sess.flagged_by,
  sess.flagged_at,
  sess.remark,
  sess.created_at,
  sess.updated_at,
  -- Sewadar info (joined)
  sw.sewadar_name,
  sw.centre AS sewadar_centre,
  sw.department AS sewadar_department,
  sw.badge_status
FROM attendance_sessions sess
INNER JOIN sewadars sw ON sess.badge_number = sw.badge_number;

-- View 3: Sessions with IN/OUT attendance details
CREATE OR REPLACE VIEW v_sessions_full AS
SELECT 
  sess.id,
  sess.badge_number,
  sess.duty_type,
  sess.in_id,
  sess.out_id,
  sess.in_time,
  sess.out_time,
  sess.date_ist,
  sess.is_open,
  sess.force_closed,
  sess.force_closed_reason,
  sess.force_closed_by,
  sess.manual_in,
  sess.manual_out,
  sess.scanner_badge,
  sess.scanner_name,
  sess.scanner_centre,
  sess.in_scanner_name,
  sess.out_scanner_name,
  sess.flagged,
  sess.flag_reason,
  sess.flagged_by,
  sess.flagged_at,
  sess.remark,
  sess.created_at,
  sess.updated_at,
  -- Sewadar info (from sewadars table)
  sw.sewadar_name,
  sw.centre AS sewadar_centre,
  sw.department AS sewadar_department,
  sw.badge_status,
  -- IN attendance details
  att_in.id AS in_att_id,
  att_in.scan_time AS in_att_scan_time,
  att_in.scanner_badge AS in_att_scanner_badge,
  att_in.scanner_name AS in_att_scanner_name,
  att_in.scanner_centre AS in_att_scanner_centre,
  att_in.latitude AS in_att_latitude,
  att_in.longitude AS in_att_longitude,
  att_in.manual_entry AS in_att_manual_entry,
  -- OUT attendance details
  att_out.id AS out_att_id,
  att_out.scan_time AS out_att_scan_time,
  att_out.scanner_badge AS out_att_scanner_badge,
  att_out.scanner_name AS out_att_scanner_name,
  att_out.scanner_centre AS out_att_scanner_centre,
  att_out.latitude AS out_att_latitude,
  att_out.longitude AS out_att_longitude,
  att_out.manual_entry AS out_att_manual_entry
FROM attendance_sessions sess
INNER JOIN sewadars sw ON sess.badge_number = sw.badge_number
LEFT JOIN attendance att_in ON sess.in_id = att_in.id
LEFT JOIN attendance att_out ON sess.out_id = att_out.id;

-- View 4: Jatha with full sewadar info
CREATE OR REPLACE VIEW v_jatha AS
SELECT 
  j.id,
  j.badge_number,
  j.jatha_type,
  j.jatha_centre,
  j.jatha_dept,
  j.date_from,
  j.date_to,
  j.satsang_days,
  j.remarks,
  j.flag,
  j.flag_reason,
  j.submitted_by,
  j.submitted_name,
  j.submitted_centre,
  j.created_at,
  -- Sewadar info (joined)
  s.sewadar_name,
  s.centre AS sewadar_centre,
  s.department AS sewadar_department
FROM jatha_attendance j
INNER JOIN sewadars s ON j.badge_number = s.badge_number;

-- =====================================================
-- STEP 2: CREATE INDEXES (Performance)
-- =====================================================

-- Attendance indexes
CREATE INDEX IF NOT EXISTS idx_attendance_badge ON attendance(badge_number);
CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_scan_time ON attendance(scan_time DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_type ON attendance(type);
CREATE INDEX IF NOT EXISTS idx_attendance_duty ON attendance(duty_type);

-- Sessions indexes
CREATE INDEX IF NOT EXISTS idx_sessions_badge ON attendance_sessions(badge_number);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON attendance_sessions(date_ist DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_in_id ON attendance_sessions(in_id);
CREATE INDEX IF NOT EXISTS idx_sessions_out_id ON attendance_sessions(out_id);
CREATE INDEX IF NOT EXISTS idx_sessions_open ON attendance_sessions(is_open) WHERE is_open = true;
CREATE INDEX IF NOT EXISTS idx_sessions_duty ON attendance_sessions(duty_type);

-- Jatha indexes
CREATE INDEX IF NOT EXISTS idx_jatha_badge ON jatha_attendance(badge_number);
CREATE INDEX IF NOT EXISTS idx_jatha_dates ON jatha_attendance(date_from, date_to);

-- Sewadar indexes (critical for joins)
CREATE INDEX IF NOT EXISTS idx_sewadars_badge ON sewadars(badge_number);
CREATE INDEX IF NOT EXISTS idx_sewadars_centre ON sewadars(centre);
CREATE INDEX IF NOT EXISTS idx_sewadars_status ON sewadars(badge_status);

-- =====================================================
-- STEP 3: AUDIT TRIGGER
-- =====================================================

-- Log sewadar info changes for audit trail
CREATE OR REPLACE FUNCTION log_sewadar_change()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO logs(user_badge, action, details, timestamp)
  VALUES (
    'SYSTEM',
    'SEWADAR_INFO_CHANGE',
    json_build_object(
      'badge', NEW.badge_number,
      'old_name', OLD.sewadar_name,
      'new_name', NEW.sewadar_name,
      'old_centre', OLD.centre,
      'new_centre', NEW.centre
    ),
    now()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_sewadar_change ON sewadars;
CREATE TRIGGER trg_log_sewadar_change
AFTER UPDATE ON sewadars
FOR EACH ROW 
WHEN (OLD.sewadar_name IS DISTINCT FROM NEW.sewadar_name 
   OR OLD.centre IS DISTINCT FROM NEW.centre)
EXECUTE FUNCTION log_sewadar_change();

-- =====================================================
-- STEP 4: HELPER FUNCTION
-- =====================================================

-- Get full sewadar info by badge number
CREATE OR REPLACE FUNCTION get_sewadar_info(p_badge text)
RETURNS TABLE (
  badge_number text,
  sewadar_name text,
  centre text,
  department text,
  badge_status text,
  gender text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.badge_number,
    s.sewadar_name,
    s.centre,
    s.department,
    s.badge_status,
    s.gender
  FROM sewadars s
  WHERE s.badge_number = p_badge;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON VIEW v_attendance IS 'Attendance with sewadar info - use this instead of attendance table';
COMMENT ON VIEW v_sessions IS 'Sessions with sewadar info - use this instead of attendance_sessions table';
COMMENT ON VIEW v_sessions_full IS 'Full session data with IN/OUT attendance details';
COMMENT ON VIEW v_jatha IS 'Jatha attendance with sewadar info';
