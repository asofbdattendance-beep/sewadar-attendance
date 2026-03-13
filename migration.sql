-- ============================================================
-- SEWADAR ATTENDANCE SYSTEM — MIGRATION SQL
-- Add sessions table, session_id FK, app settings, and RLS
-- ============================================================

-- 1. SESSIONS TABLE
CREATE TABLE IF NOT EXISTS sessions (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  session_date DATE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT,
  UNIQUE(name, session_date)
);

-- 2. ADD session_id COLUMN TO attendance TABLE
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS session_id BIGINT REFERENCES sessions(id);

-- 3. APP SETTINGS TABLE (for duplicate_window_ms and other config)
CREATE TABLE IF NOT EXISTS app_settings (
  id BIGSERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. INSERT DUPLICATE_WINDOW_MS SETTING (default 120000ms = 2 minutes)
INSERT INTO app_settings (key, value) VALUES ('duplicate_window_ms', '120000')
ON CONFLICT (key) DO NOTHING;

-- 5. ADD PARENT_CENTRE TO USERS TABLE (if not exists)
ALTER TABLE users ADD COLUMN IF NOT EXISTS parent_centre TEXT;

-- 6. ADD BADGE_STATUS TO SEWADARS TABLE (if not exists)
ALTER TABLE sewadars ADD COLUMN IF NOT EXISTS badge_status TEXT DEFAULT 'Active';

-- 7. ADD RAISED_BY_CENTRE AND RAISED_BY_ROLE TO QUERIES TABLE (for audit)
ALTER TABLE queries ADD COLUMN IF NOT EXISTS raised_by_centre TEXT;
ALTER TABLE queries ADD COLUMN IF NOT EXISTS raised_by_role TEXT;

-- 8. ADD RENEWED_AT TO LOGS TABLE (for audit trail)
ALTER TABLE logs ADD COLUMN IF NOT EXISTS renewed_at TIMESTAMPTZ;

-- ============================================================
-- INDEXES FOR NEW COLUMNS
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_attendance_session_id ON attendance(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(session_date);
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active);

-- ============================================================
-- RLS POLICIES FOR NEW TABLES AND COLUMNS
-- ============================================================

-- Enable RLS on sessions
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- SESSIONS: All authenticated users can read, only super_admin can write
CREATE POLICY "sessions_read" ON sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "sessions_write" ON sessions FOR ALL TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

-- UPDATE APP_SETTINGS RLS (if table exists)
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "app_settings_read" ON app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "app_settings_write" ON app_settings FOR ALL TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

-- ============================================================
-- ENABLE REALTIME FOR SESSIONS TABLE
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;

-- ============================================================
-- MIGRATION COMPLETE
-- ============================================================
