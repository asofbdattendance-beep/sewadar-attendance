-- ============================================================
-- SEWADAR ATTENDANCE SYSTEM v2
-- Supabase Project: lnznhbwgkusgdcmvgznf.supabase.co
-- Run this entire script in Supabase SQL Editor
-- ============================================================

-- ============================================================
-- MIGRATION: Add missing columns to existing tables
-- This runs safely whether tables exist or not
-- ============================================================

DO $$
BEGIN
  -- Add jatha columns to attendance_sessions if they don't exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'attendance_sessions' AND column_name = 'jatha_id') THEN
    ALTER TABLE attendance_sessions ADD COLUMN is_jatha_entry BOOLEAN DEFAULT false;
    ALTER TABLE attendance_sessions ADD COLUMN jatha_id BIGINT;
    ALTER TABLE attendance_sessions ADD COLUMN jatha_type TEXT;
  END IF;
  
  -- Update duty_type constraint to include WATCH_AND_WARD
  ALTER TABLE attendance_sessions DROP CONSTRAINT IF EXISTS attendance_sessions_duty_type_check;
  ALTER TABLE attendance_sessions ADD CONSTRAINT attendance_sessions_duty_type_check 
    CHECK (duty_type IN ('SATSCAN', 'DAILY', 'NIGHT', 'WATCH_AND_WARD', 'JATHA'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Migration note: %', SQLERRM;
END $$;

-- ============================================================
-- 1. CENTRES (Parent + Satsang Points)
CREATE TABLE IF NOT EXISTS centres (
  id BIGSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  parent_centre TEXT REFERENCES centres(name),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. SPECIAL DEPARTMENTS
CREATE TABLE IF NOT EXISTS special_departments (
  id BIGSERIAL PRIMARY KEY,
  department_name TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. SEWADARS MASTER
CREATE TABLE IF NOT EXISTS sewadars (
  id BIGSERIAL PRIMARY KEY,
  badge_number TEXT UNIQUE NOT NULL,
  sewadar_name TEXT NOT NULL,
  father_husband_name TEXT,
  gender TEXT CHECK (gender IN ('Male', 'Female')),
  badge_status TEXT DEFAULT 'OPEN' CHECK (badge_status IN ('OPEN', 'PERMANENT')),
  centre TEXT NOT NULL,
  department TEXT,
  is_initiated BOOLEAN DEFAULT false,
  age INTEGER,
  print_status TEXT DEFAULT 'NOT_PRINTED',
  form_status TEXT DEFAULT 'NOT_SUBMITTED',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. ATTENDANCE SESSIONS
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id BIGSERIAL PRIMARY KEY,
  badge_number TEXT NOT NULL REFERENCES sewadars(badge_number),
  sewadar_name TEXT NOT NULL,
  centre TEXT NOT NULL,
  duty_type TEXT NOT NULL CHECK (duty_type IN ('SATSCAN', 'DAILY', 'NIGHT', 'WATCH_AND_WARD', 'JATHA')),
  status TEXT DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  in_date DATE NOT NULL,
  in_time TIME NOT NULL,
  in_scanner_badge TEXT,
  in_scanner_name TEXT,
  in_scanner_centre TEXT,
  out_date DATE,
  out_time TIME,
  out_scanner_badge TEXT,
  out_scanner_name TEXT,
  out_scanner_centre TEXT,
  is_manual BOOLEAN DEFAULT false,
  is_gate_entry BOOLEAN DEFAULT false,
  is_jatha_entry BOOLEAN DEFAULT false,
  jatha_id BIGINT,
  jatha_type TEXT,
  entered_by_badge TEXT,
  entered_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4b. JATHA MASTER
CREATE TABLE IF NOT EXISTS jatha_master (
  id BIGSERIAL PRIMARY KEY,
  jatha_type TEXT NOT NULL CHECK (jatha_type IN ('beas', 'major_centre', 'jatha_home')),
  centre_name TEXT NOT NULL,
  department TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (jatha_type, centre_name, department)
);

-- 4c. JATHA ATTENDANCE (Separate table for jatha records)
CREATE TABLE IF NOT EXISTS jatha_attendance (
  id BIGSERIAL PRIMARY KEY,
  jatha_id BIGINT NOT NULL REFERENCES jatha_master(id),
  badge_number TEXT NOT NULL REFERENCES sewadars(badge_number),
  sewadar_name TEXT NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  entered_by_badge TEXT NOT NULL,
  entered_by_name TEXT NOT NULL,
  entered_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. ROLES MASTER
CREATE TABLE IF NOT EXISTS role_masters (
  id BIGSERIAL PRIMARY KEY,
  role_key TEXT UNIQUE NOT NULL,
  role_label TEXT NOT NULL,
  role_description TEXT,
  permissions JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed role_masters
INSERT INTO role_masters (role_key, role_label, role_description, permissions) VALUES
('super_admin', 'Super Admin', 'Full system access with all permissions', '{"all": true}'),
('admin', 'Admin', 'Administrative access', '{"users": true, "reports": true, "settings": true}'),
('centre_user', 'Centre Admin', 'Centre-level administrative access', '{"centre_data": true, "reports": true}'),
('sc_sp_user', 'Scanner', 'Basic scanning and attendance entry access', '{"scan": true, "entry": true}')
ON CONFLICT (role_key) DO NOTHING;

-- 5b. USERS (updated roles)
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  badge_number TEXT NOT NULL,
  role TEXT NOT NULL REFERENCES role_masters(role_key),
  centre TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. LOGS
CREATE TABLE IF NOT EXISTS logs (
  id BIGSERIAL PRIMARY KEY,
  user_badge TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sessions_badge ON attendance_sessions(badge_number);
CREATE INDEX IF NOT EXISTS idx_sessions_date ON attendance_sessions(in_date);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON attendance_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_open ON attendance_sessions(badge_number, status) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_sessions_jatha ON attendance_sessions(jatha_id) WHERE jatha_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sewadars_badge ON sewadars(badge_number);
CREATE INDEX IF NOT EXISTS idx_sewadars_centre ON sewadars(centre);
CREATE INDEX IF NOT EXISTS idx_centres_parent ON centres(parent_centre);
CREATE INDEX IF NOT EXISTS idx_jatha_type ON jatha_master(jatha_type);
CREATE INDEX IF NOT EXISTS idx_jatha_active ON jatha_master(is_active);
CREATE INDEX IF NOT EXISTS idx_jatha_att_badge ON jatha_attendance(badge_number);
CREATE INDEX IF NOT EXISTS idx_jatha_att_jatha ON jatha_attendance(jatha_id);
CREATE INDEX IF NOT EXISTS idx_jatha_att_dates ON jatha_attendance(from_date, to_date);

-- ============================================================
-- REALTIME (ignore if already exists)
-- ============================================================
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE attendance_sessions;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Publication already exists: %', SQLERRM;
END $$;

-- ============================================================
-- ROW LEVEL SECURITY (ignore if already enabled)
-- ============================================================
DO $$
BEGIN
  ALTER TABLE sewadars ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'RLS already enabled for sewadars';
END $$;

DO $$
BEGIN
  ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'RLS already enabled for attendance_sessions';
END $$;

DO $$
BEGIN
  ALTER TABLE users ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'RLS already enabled for users';
END $$;

DO $$
BEGIN
  ALTER TABLE centres ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'RLS already enabled for centres';
END $$;

DO $$
BEGIN
  ALTER TABLE special_departments ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'RLS already enabled for special_departments';
END $$;

DO $$
BEGIN
  ALTER TABLE logs ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'RLS already enabled for logs';
END $$;

DO $$
BEGIN
  ALTER TABLE jatha_master ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'RLS already enabled for jatha_master';
END $$;

CREATE OR REPLACE FUNCTION get_user_role() RETURNS TEXT AS $$
  SELECT role FROM users WHERE auth_id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_user_centre() RETURNS TEXT AS $$
  SELECT centre FROM users WHERE auth_id = auth.uid();
$$ LANGUAGE SQL SECURITY DEFINER;

-- SEWADARS
DROP POLICY IF EXISTS "sewadars_read" ON sewadars;
DROP POLICY IF EXISTS "sewadars_write" ON sewadars;
CREATE POLICY "sewadars_read" ON sewadars FOR SELECT TO authenticated USING (true);
CREATE POLICY "sewadars_write" ON sewadars FOR ALL TO authenticated
  USING (get_user_role() IN ('super_admin', 'admin')) WITH CHECK (get_user_role() IN ('super_admin', 'admin'));

-- SESSIONS
DROP POLICY IF EXISTS "sessions_read" ON attendance_sessions;
DROP POLICY IF EXISTS "sessions_insert" ON attendance_sessions;
DROP POLICY IF EXISTS "sessions_update" ON attendance_sessions;
CREATE POLICY "sessions_read" ON attendance_sessions FOR SELECT TO authenticated
  USING (get_user_role() IN ('super_admin', 'admin', 'centre_user') OR centre = get_user_centre());
CREATE POLICY "sessions_insert" ON attendance_sessions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "sessions_update" ON attendance_sessions FOR UPDATE TO authenticated
  USING (get_user_role() IN ('super_admin', 'admin', 'centre_user'));

-- USERS
DROP POLICY IF EXISTS "users_read" ON users;
DROP POLICY IF EXISTS "users_write" ON users;
CREATE POLICY "users_read" ON users FOR SELECT TO authenticated USING (true);
CREATE POLICY "users_write" ON users FOR ALL TO authenticated
  USING (get_user_role() IN ('super_admin', 'admin')) WITH CHECK (get_user_role() IN ('super_admin', 'admin'));

-- CENTRES
DROP POLICY IF EXISTS "centres_read" ON centres;
DROP POLICY IF EXISTS "centres_write" ON centres;
CREATE POLICY "centres_read" ON centres FOR SELECT TO authenticated USING (true);
CREATE POLICY "centres_write" ON centres FOR ALL TO authenticated
  USING (get_user_role() IN ('super_admin', 'admin')) WITH CHECK (get_user_role() IN ('super_admin', 'admin'));

-- SPECIAL DEPTS
DROP POLICY IF EXISTS "depts_read" ON special_departments;
DROP POLICY IF EXISTS "depts_write" ON special_departments;
CREATE POLICY "depts_read" ON special_departments FOR SELECT TO authenticated USING (true);
CREATE POLICY "depts_write" ON special_departments FOR ALL TO authenticated
  USING (get_user_role() IN ('super_admin', 'admin')) WITH CHECK (get_user_role() IN ('super_admin', 'admin'));

-- LOGS
DROP POLICY IF EXISTS "logs_read" ON logs;
DROP POLICY IF EXISTS "logs_insert" ON logs;
CREATE POLICY "logs_read" ON logs FOR SELECT TO authenticated
  USING (get_user_role() IN ('super_admin', 'admin'));
CREATE POLICY "logs_insert" ON logs FOR INSERT TO authenticated WITH CHECK (true);

-- JATHA MASTER
DROP POLICY IF EXISTS "jatha_read" ON jatha_master;
DROP POLICY IF EXISTS "jatha_write" ON jatha_master;
CREATE POLICY "jatha_read" ON jatha_master FOR SELECT TO authenticated USING (is_active = true);
CREATE POLICY "jatha_write" ON jatha_master FOR ALL TO authenticated
  USING (get_user_role() IN ('super_admin', 'admin')) WITH CHECK (get_user_role() IN ('super_admin', 'admin'));

-- JATHA ATTENDANCE
DO $$
BEGIN
  ALTER TABLE jatha_attendance ENABLE ROW LEVEL SECURITY;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'RLS already enabled for jatha_attendance';
END $$;

DROP POLICY IF EXISTS "jatha_att_read" ON jatha_attendance;
DROP POLICY IF EXISTS "jatha_att_write" ON jatha_attendance;
CREATE POLICY "jatha_att_read" ON jatha_attendance FOR SELECT TO authenticated USING (true);
CREATE POLICY "jatha_att_write" ON jatha_attendance FOR INSERT TO authenticated WITH CHECK (true);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Get open session for a badge
CREATE OR REPLACE FUNCTION get_open_session(p_badge TEXT)
RETURNS attendance_sessions AS $$
  SELECT * FROM attendance_sessions
  WHERE badge_number = p_badge AND status = 'OPEN'
  ORDER BY in_time DESC
  LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER;

-- Get valid centres for a user (based on their centre + children)
CREATE OR REPLACE FUNCTION get_user_centres(p_user_centre TEXT)
RETURNS TABLE(name TEXT) AS $$
  WITH user_info AS (
    SELECT name, parent_centre FROM centres WHERE name = p_user_centre
  )
  SELECT DISTINCT c.name FROM centres c
  WHERE 
    c.name = p_user_centre
    OR c.parent_centre = p_user_centre
    OR (SELECT parent_centre FROM user_info) IS NOT NULL 
       AND c.name = (SELECT parent_centre FROM user_info)
    OR (SELECT parent_centre FROM user_info) IS NOT NULL 
       AND c.parent_centre = (SELECT parent_centre FROM user_info)
$$ LANGUAGE SQL SECURITY DEFINER;

-- ============================================================
-- SEED DATA: CENTRES (42 entries)
-- ============================================================
INSERT INTO centres (name, parent_centre) VALUES
-- Parent centres (18)
('ANKHEER', NULL),
('BALLABGARH', NULL),
('DLF CITY GURGAON', NULL),
('FIROZPUR JHIRKA', NULL),
('TAORU', NULL),
('GURGAON', NULL),
('MOHANA', NULL),
('ZAIBABAD KHERLI', NULL),
('NANGLA GUJRAN', NULL),
('NIT - 2', NULL),
('PALWAL', NULL),
('BAROLI', NULL),
('HODAL', NULL),
('RAJENDRA PARK', NULL),
('SECTOR-15-A', NULL),
('PRITHLA', NULL),
('SURAJ KUND', NULL),
('TIGAON', NULL),
-- BALLABGARH children
('MACHHGAR', 'BALLABGARH'),
-- DLF CITY GURGAON children
('ABHEYPUR', 'DLF CITY GURGAON'),
('NUH', 'DLF CITY GURGAON'),
('PUNAHANA', 'DLF CITY GURGAON'),
('SOHNA', 'DLF CITY GURGAON'),
-- GURGAON children
('BADHA SIKENDERPUR', 'GURGAON'),
('BILASPUR', 'GURGAON'),
('BUDHERA', 'GURGAON'),
('DUNDAHERA', 'GURGAON'),
('FARUKH NAGAR', 'GURGAON'),
('JATAULA', 'GURGAON'),
('KASAN', 'GURGAON'),
('PATAUDI', 'GURGAON'),
-- MOHANA children
('FATEHPUR BILLOCH', 'MOHANA'),
-- PALWAL children
('BAHIN', 'PALWAL'),
('HASANPUR', 'PALWAL'),
('HATHIN', 'PALWAL'),
('MANDKOLA', 'PALWAL'),
('NAYAGAON', 'PALWAL'),
('SIHA', 'PALWAL'),
-- SECTOR-15-A children
('DHATIR', 'SECTOR-15-A'),
('GREATER FARIDABAD', 'SECTOR-15-A'),
-- TIGAON children
('NACHAULI', 'TIGAON')
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- SEED DATA: SPECIAL DEPARTMENTS (7 entries)
-- ============================================================
INSERT INTO special_departments (department_name) VALUES
('ADMINISTRATION'),
('PATHI'),
('SATSANG KARTA'),
('BAAL SATSANG KARTA'),
('OFFICE'),
('AREA SECRETARY OFFICE'),
('MAINTENANCE')
ON CONFLICT (department_name) DO NOTHING;

-- ============================================================
-- SAMPLE SEWADARS DATA (for testing)
-- ============================================================
INSERT INTO sewadars (badge_number, sewadar_name, father_husband_name, gender, badge_status, centre, department, is_initiated, age, print_status, form_status) VALUES
('FB0001GA0001', 'SYSTEM ADMIN', 'TEST USER', 'Male', 'PERMANENT', 'SECTOR-15-A', 'ADMINISTRATION', true, 30, 'Printed', 'Approved'),
('FB5988LA0017', 'OMBATI', 'VED PRAKASH', 'Female', 'OPEN', 'BADHA SIKENDERPUR', 'SECURITY', true, 61, 'Printed', 'Approved'),
('FB5978GA0015', 'RAM KUMAR', 'SHYAM LAL', 'Male', 'PERMANENT', 'GURGAON', 'BAAL SATSANG KARTA', true, 45, 'Printed', 'Approved'),
('FB5901GA0023', 'SHANTI DEVI', 'MOHAN LAL', 'Female', 'OPEN', 'KASAN', 'ADMINISTRATION', true, 52, 'Printed', 'Approved'),
('FB5925GA0008', 'HARISH CHAND', 'SURAJ BHAN', 'Male', 'OPEN', 'DHATIR', 'SATSANG KARTA', false, 38, 'Not Printed', 'Pending'),
('FB5902LA0012', 'GEETA', 'RAMAUTAR', 'Female', 'OPEN', 'SECTOR-15-A', 'OFFICE', true, 35, 'Printed', 'Approved'),
('FB5918GA0025', 'SURESH', 'LEELADHAR', 'Male', 'OPEN', 'GURGAON', 'PATHI', true, 42, 'Printed', 'Approved'),
('FB5930LA0010', 'MEENA', 'PRAKASH', 'Female', 'PERMANENT', 'NIT - 2', 'BAAL SATSANG KARTA', true, 48, 'Printed', 'Approved'),
('FB5942GA0018', 'VINOD', 'BANARSI', 'Male', 'OPEN', 'PALWAL', 'MAINTENANCE', true, 55, 'Printed', 'Approved')
ON CONFLICT (badge_number) DO NOTHING;

-- ============================================================
-- SEED DATA: JATHA MASTER
-- ============================================================
INSERT INTO jatha_master (jatha_type, centre_name, department) VALUES
-- BEAS
('beas', 'BEAS', 'ACCOMMODATION'),
('beas', 'BEAS', 'AGRICULTURE'),
('beas', 'BEAS', 'CONSTRUCTION'),
('beas', 'BEAS', 'ENGINEERING'),
('beas', 'BEAS', 'F&B UNIT'),
('beas', 'BEAS', 'HORTICULTURE'),
('beas', 'BEAS', 'HOSPITAL'),
('beas', 'BEAS', 'LANGAR'),
('beas', 'BEAS', 'MAND SEWA'),
('beas', 'BEAS', 'MECHANICAL'),
('beas', 'BEAS', 'PANDAL'),
('beas', 'BEAS', 'RAILWAY'),
('beas', 'BEAS', 'RIVER BANK SEWA'),
('beas', 'BEAS', 'SANITATION'),
('beas', 'BEAS', 'SECURITY'),
('beas', 'BEAS', 'TRAFFIC'),
('beas', 'BEAS', 'VAN DRIVER'),
('beas', 'BEAS', 'VAN LOADING UNLOADING SEWA'),
('beas', 'BEAS', 'WELDER SEWA'),
-- MAJOR CENTRE - BHATI
('major_centre', 'BHATI', 'CONSTRUCTION'),
('major_centre', 'BHATI', 'LANGAR'),
('major_centre', 'BHATI', 'SECURITY'),
('major_centre', 'BHATI', 'PRE VISIT MAINTENANCE (ROAD SEWA)'),
('major_centre', 'BHATI', 'PRE VISIT SEWA INSIDE'),
('major_centre', 'BHATI', 'VISIT SEWA'),
('major_centre', 'BHATI', 'TRACTOR DRIVER SEWA SAMITI'),
('major_centre', 'BHATI', 'SANITATION'),
('major_centre', 'BHATI', 'HORTICULTURE'),
('major_centre', 'BHATI', 'COORDINATOR'),
('major_centre', 'BHATI', 'MASON'),
('major_centre', 'BHATI', 'TRAFFIC INSIDE'),
('major_centre', 'BHATI', 'SEWA COLLECTION'),
('major_centre', 'BHATI', 'RAILWAY STATION'),
('major_centre', 'BHATI', 'PLUMBER'),
('major_centre', 'BHATI', 'FERRY'),
('major_centre', 'BHATI', 'WATER'),
-- MAJOR CENTRE - OTHER
('major_centre', 'SIKANDERPUR', 'CASH'),
('major_centre', 'SIKANDERPUR', 'CONSTRUCTION'),
('major_centre', 'BANGALORE', 'CASH'),
('major_centre', 'BANGALORE', 'CONSTRUCTION'),
('major_centre', 'LUCKNOW', 'CASH'),
('major_centre', 'LUCKNOW', 'CONSTRUCTION'),
('major_centre', 'PORTBLAIR', 'CONSTRUCTION'),
-- JATHA HOME
('jatha_home', 'FARIDABAD', 'ANKHEER'),
('jatha_home', 'FARIDABAD', 'BALLABGARH'),
('jatha_home', 'FARIDABAD', 'MACHHGAR'),
('jatha_home', 'FARIDABAD', 'BAROLI'),
('jatha_home', 'FARIDABAD', 'DLF CITY GURGAON'),
('jatha_home', 'FARIDABAD', 'ABHEYPUR'),
('jatha_home', 'FARIDABAD', 'NUH'),
('jatha_home', 'FARIDABAD', 'PUNAHANA'),
('jatha_home', 'FARIDABAD', 'SOHNA'),
('jatha_home', 'FARIDABAD', 'FIROZPUR JHIRKA'),
('jatha_home', 'FARIDABAD', 'GURGAON'),
('jatha_home', 'FARIDABAD', 'BADHA SIKENDERPUR'),
('jatha_home', 'FARIDABAD', 'BILASPUR'),
('jatha_home', 'FARIDABAD', 'BUDHERA'),
('jatha_home', 'FARIDABAD', 'DUNDAHERA'),
('jatha_home', 'FARIDABAD', 'FARUKH NAGAR'),
('jatha_home', 'FARIDABAD', 'JATAULA'),
('jatha_home', 'FARIDABAD', 'KASAN'),
('jatha_home', 'FARIDABAD', 'PATAUDI'),
('jatha_home', 'FARIDABAD', 'HODAL'),
('jatha_home', 'FARIDABAD', 'MOHANA'),
('jatha_home', 'FARIDABAD', 'FATEHPUR BILLOCH'),
('jatha_home', 'FARIDABAD', 'NANGLA GUJRAN'),
('jatha_home', 'FARIDABAD', 'NIT - 2'),
('jatha_home', 'FARIDABAD', 'PALWAL'),
('jatha_home', 'FARIDABAD', 'BAHIN'),
('jatha_home', 'FARIDABAD', 'HASANPUR'),
('jatha_home', 'FARIDABAD', 'HATHIN'),
('jatha_home', 'FARIDABAD', 'MANDKOLA'),
('jatha_home', 'FARIDABAD', 'NAYAGAON'),
('jatha_home', 'FARIDABAD', 'SIHA'),
('jatha_home', 'FARIDABAD', 'PRITHLA'),
('jatha_home', 'FARIDABAD', 'RAJENDRA PARK'),
('jatha_home', 'FARIDABAD', 'SECTOR-15-A'),
('jatha_home', 'FARIDABAD', 'DHATIR'),
('jatha_home', 'FARIDABAD', 'GREATER FARIDABAD'),
('jatha_home', 'FARIDABAD', 'SURAJ KUND'),
('jatha_home', 'FARIDABAD', 'TAORU'),
('jatha_home', 'FARIDABAD', 'TIGAON'),
('jatha_home', 'FARIDABAD', 'NACHAULI'),
('jatha_home', 'FARIDABAD', 'ZAIBABAD KHERLI')
ON CONFLICT (jatha_type, centre_name, department) DO NOTHING;

-- ============================================================
-- CREATE TEST USER
-- ============================================================
-- Run this after creating auth user in Supabase Dashboard
-- 
-- 1. Go to Supabase Dashboard > Authentication > Users
-- 2. Create user with email: admin@sewadar.app, password: Admin@123
-- 3. Copy the auth_id from auth.users table
-- 4. Run this INSERT with your actual auth_id:
-- 
-- INSERT INTO users (auth_id, email, name, badge_number, role, centre)
-- VALUES ('YOUR-AUTH-UUID-HERE', 'admin@sewadar.app', 'System Admin', 'SA000001', 'super_admin', 'SECTOR-15-A');

-- ============================================================
-- MIGRATION: Update existing users to new role names
-- ============================================================
UPDATE users SET role = 'super_admin' WHERE role = 'aso';
