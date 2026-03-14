-- ============================================================
-- SEWADAR ATTENDANCE SYSTEM — SUPABASE SQL SETUP
-- Run this ENTIRE script in Supabase SQL Editor (once)
-- ============================================================

-- 1. SEWADARS TABLE (your main Excel data)
CREATE TABLE IF NOT EXISTS sewadars (
  id BIGSERIAL PRIMARY KEY,
  badge_number TEXT UNIQUE NOT NULL,
  sewadar_name TEXT NOT NULL,
  father_husband_name TEXT,
  gender TEXT CHECK (gender IN ('Male', 'Female')),
  centre TEXT NOT NULL,
  department TEXT,
  age INTEGER,
  badge_status TEXT DEFAULT 'Active',
  geo_required BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ATTENDANCE TABLE
CREATE TABLE IF NOT EXISTS attendance (
  id BIGSERIAL PRIMARY KEY,
  badge_number TEXT NOT NULL REFERENCES sewadars(badge_number),
  sewadar_name TEXT NOT NULL,
  centre TEXT NOT NULL,
  department TEXT,
  type TEXT NOT NULL CHECK (type IN ('IN', 'OUT')),
  scan_time TIMESTAMPTZ DEFAULT NOW(),
  scanner_badge TEXT NOT NULL,
  scanner_name TEXT NOT NULL,
  scanner_centre TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  device_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. USERS TABLE (app login roles)
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  badge_number TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('aso', 'centre_user', 'sc_sp_user')),
  centre TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. CENTRES TABLE
CREATE TABLE IF NOT EXISTS centres (
  id BIGSERIAL PRIMARY KEY,
  centre_name TEXT UNIQUE NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  geo_radius INTEGER DEFAULT 200,
  geo_enabled BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. QUERIES TABLE (admin flags)
CREATE TABLE IF NOT EXISTS queries (
  id BIGSERIAL PRIMARY KEY,
  raised_by_badge TEXT NOT NULL,
  raised_by_name TEXT NOT NULL,
  attendance_id BIGINT REFERENCES attendance(id),
  issue_description TEXT NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. LOGS TABLE
CREATE TABLE IF NOT EXISTS logs (
  id BIGSERIAL PRIMARY KEY,
  user_badge TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  device_id TEXT
);

-- ============================================================
-- INDEXES (for fast queries)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_attendance_badge ON attendance(badge_number);
CREATE INDEX IF NOT EXISTS idx_attendance_scan_time ON attendance(scan_time);
CREATE INDEX IF NOT EXISTS idx_attendance_centre ON attendance(centre);
CREATE INDEX IF NOT EXISTS idx_sewadars_badge ON sewadars(badge_number);
CREATE INDEX IF NOT EXISTS idx_sewadars_centre ON sewadars(centre);
CREATE INDEX IF NOT EXISTS idx_users_auth_id ON users(auth_id);

-- ============================================================
-- REALTIME (enable live dashboard)
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE attendance;

-- ============================================================
-- ROW LEVEL SECURITY (RLS) — DATA SECURITY
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE sewadars ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE centres ENABLE ROW LEVEL SECURITY;
ALTER TABLE queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs ENABLE ROW LEVEL SECURITY;

-- Helper function to get current user's role and centre
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM users WHERE auth_id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_user_centre()
RETURNS TEXT AS $$
  SELECT centre FROM users WHERE auth_id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER;

-- SEWADARS: All logged-in users can read. Only aso can write.
CREATE POLICY "sewadars_read" ON sewadars FOR SELECT TO authenticated USING (true);
CREATE POLICY "sewadars_write" ON sewadars FOR ALL TO authenticated
  USING (get_user_role() = 'aso')
  WITH CHECK (get_user_role() = 'aso');

-- ATTENDANCE: Users can read own centre (or all if aso/centre_user)
CREATE POLICY "attendance_read_own_centre" ON attendance FOR SELECT TO authenticated
  USING (
    get_user_role() IN ('aso', 'centre_user')
    OR centre = get_user_centre()
  );

-- Attendance insert: sc_sp_user can only insert for their centre
-- (exception departments handled in app logic)
CREATE POLICY "attendance_insert" ON attendance FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() IN ('aso', 'centre_user')
    OR scanner_centre = get_user_centre()
  );

-- USERS: Users can read all users, only aso can write
CREATE POLICY "users_read" ON users FOR SELECT TO authenticated USING (true);
CREATE POLICY "users_write" ON users FOR ALL TO authenticated
  USING (get_user_role() = 'aso')
  WITH CHECK (get_user_role() = 'aso');
-- Allow users to read their own profile
CREATE POLICY "users_read_own" ON users FOR SELECT TO authenticated
  USING (auth_id = auth.uid());

-- CENTRES: All can read, only aso can write
CREATE POLICY "centres_read" ON centres FOR SELECT TO authenticated USING (true);
CREATE POLICY "centres_write" ON centres FOR ALL TO authenticated
  USING (get_user_role() = 'aso')
  WITH CHECK (get_user_role() = 'aso');

-- QUERIES: Area Secretary and Centre User can read/write
CREATE POLICY "queries_read" ON queries FOR SELECT TO authenticated
  USING (get_user_role() IN ('aso', 'centre_user'));
CREATE POLICY "queries_write" ON queries FOR INSERT TO authenticated
  WITH CHECK (get_user_role() IN ('aso', 'centre_user'));
CREATE POLICY "queries_update" ON queries FOR UPDATE TO authenticated
  USING (get_user_role() IN ('aso', 'centre_user'));

-- LOGS: Only aso can read
CREATE POLICY "logs_read" ON logs FOR SELECT TO authenticated
  USING (get_user_role() = 'aso');
CREATE POLICY "logs_insert" ON logs FOR INSERT TO authenticated
  WITH CHECK (true);

-- ============================================================
-- INSERT CENTRES DATA
-- ============================================================
INSERT INTO centres (centre_name, latitude, longitude, geo_radius, geo_enabled) VALUES
('ANKHEER', 0, 0, 200, false),
('BALLABGARH', 28.3411, 77.3181, 200, false),
('DLF CITY GURGAON', 28.4745, 77.0942, 200, false),
('FIROZPUR JHIRKA', 27.7936, 76.9491, 200, false),
('TAORU', 28.2320, 77.0350, 200, false),
('GURGAON', 28.4595, 77.0266, 200, false),
('MOHANA', 28.1200, 77.1000, 200, false),
('ZAIBABAD KHERLI', 28.0500, 77.2000, 200, false),
('NANGLA GUJRAN', 28.5000, 77.3000, 200, false),
('NIT - 2', 28.4200, 77.3100, 200, false),
('PALWAL', 28.1440, 77.3320, 200, false),
('BAROLI', 28.1000, 77.2500, 200, false),
('HODAL', 27.8900, 77.3700, 200, false),
('RAJENDRA PARK', 28.4800, 77.0500, 200, false),
('SECTOR-15-A', 28.4300, 77.3100, 200, false),
('PRITHLA', 28.1800, 77.4100, 200, false),
('SURAJ KUND', 28.4600, 77.2900, 200, false),
('TIGAON', 28.3900, 77.3700, 200, false)
ON CONFLICT (centre_name) DO NOTHING;

-- ============================================================
-- DONE! Now create your Super Admin user from the app.
-- ============================================================
