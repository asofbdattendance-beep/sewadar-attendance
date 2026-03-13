-- ============================================================
-- SEWADAR ATTENDANCE SYSTEM — MIGRATION SQL
-- Add sessions table, session_id FK, and settings to existing schema
-- ============================================================

-- 0. ADD parent_centre COLUMN TO CENTRES TABLE
ALTER TABLE centres ADD COLUMN IF NOT EXISTS parent_centre TEXT;

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

-- 3. ADD settings_json COLUMN TO EXISTING app_settings TABLE
-- (Your app_settings table uses id as TEXT PRIMARY KEY with value 'global')
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS settings_json JSONB DEFAULT '{}'::jsonb;

-- 4. INSERT DUPLICATE_WINDOW_MS SETTING into existing table
UPDATE app_settings SET settings_json = jsonb_set(
  COALESCE(settings_json, '{}'::jsonb),
  '{duplicate_window_ms}',
  '120000'
) WHERE id = 'global';

-- If no 'global' row exists, insert one
INSERT INTO app_settings (id, settings_json)
SELECT 'global', '{"duplicate_window_ms": 120000}'
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE id = 'global');

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
-- RLS POLICIES FOR SESSIONS TABLE
-- ============================================================

-- Enable RLS on sessions
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- SESSIONS: All authenticated users can read, only super_admin can write
CREATE POLICY "sessions_read" ON sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "sessions_write" ON sessions FOR ALL TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

-- ============================================================
-- ENABLE REALTIME FOR SESSIONS TABLE
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;

-- ============================================================
-- MIGRATION COMPLETE
-- ============================================================
