-- =====================================================
-- PERFORMANCE INDEXES
-- Sewadar Attendance System v3.2
-- =====================================================

-- =====================================================
-- QUERIES TABLE INDEXES (for unified flags/queries)
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_queries_status ON public.queries(status);
CREATE INDEX IF NOT EXISTS idx_queries_raised_by_centre ON public.queries(raised_by_centre);
CREATE INDEX IF NOT EXISTS idx_queries_created_at ON public.queries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_queries_session_id ON public.queries(session_id);
CREATE INDEX IF NOT EXISTS idx_queries_flag_type ON public.queries(flag_type);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_queries_status_centre 
  ON public.queries(status, raised_by_centre);

-- =====================================================
-- QUERY_REPLIES TABLE INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_query_replies_query_id ON public.query_replies(query_id);
CREATE INDEX IF NOT EXISTS idx_query_replies_created_at ON public.query_replies(created_at);

-- =====================================================
-- FLAG_AUDIT_LOG TABLE INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_flag_audit_query_id ON public.flag_audit_log(query_id);
CREATE INDEX IF NOT EXISTS idx_flag_audit_created_at ON public.flag_audit_log(created_at DESC);

-- =====================================================
-- ATTENDANCE_SESSIONS TABLE INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_sessions_badge_open 
  ON public.attendance_sessions(badge_number, is_open) 
  WHERE is_open = true;
CREATE INDEX IF NOT EXISTS idx_sessions_date_centre 
  ON public.attendance_sessions(date_ist, centre);
CREATE INDEX IF NOT EXISTS idx_sessions_badge_date 
  ON public.attendance_sessions(badge_number, date_ist);
CREATE INDEX IF NOT EXISTS idx_sessions_flagged 
  ON public.attendance_sessions(flagged) 
  WHERE flagged = true;

-- =====================================================
-- ATTENDANCE TABLE INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_attendance_badge_scan_time 
  ON public.attendance(badge_number, scan_time DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_session_id 
  ON public.attendance(session_id);
CREATE INDEX IF NOT EXISTS idx_attendance_scan_time 
  ON public.attendance(scan_time DESC);

-- =====================================================
-- SEWADARS TABLE INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_sewadars_badge 
  ON public.sewadars(badge_number);
CREATE INDEX IF NOT EXISTS idx_sewadars_centre 
  ON public.sewadars(centre);
CREATE INDEX IF NOT EXISTS idx_sewadars_name 
  ON public.sewadars(sewadar_name);

-- =====================================================
-- CENTRES TABLE INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_centres_parent 
  ON public.centres(parent_centre);

-- =====================================================
-- VERIFICATION
-- =====================================================
SELECT 
  schemaname, 
  relname as table_name, 
  indexrelname as index_name, 
  idx_scan
FROM pg_stat_user_indexes 
WHERE schemaname = 'public'
ORDER BY relname, indexrelname;
