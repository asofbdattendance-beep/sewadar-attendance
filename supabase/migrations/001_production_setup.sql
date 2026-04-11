-- =====================================================
-- SEWADAR ATTENDANCE SYSTEM - PRODUCTION MIGRATION
-- =====================================================
-- Run this in Supabase SQL Editor to set up production constraints
-- =====================================================

-- =====================================================
-- 1. USERS TABLE CONSTRAINTS
-- =====================================================

-- Drop existing constraint if it exists and recreate with correct roles
DO $$
BEGIN
    -- Drop old constraint
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'users_role_check'
    ) THEN
        ALTER TABLE users DROP CONSTRAINT users_role_check;
    END IF;
    
    -- Add new constraint with all valid roles
    ALTER TABLE users ADD CONSTRAINT users_role_check 
        CHECK (role = ANY (ARRAY['aso', 'centre', 'sc_sp_user']));
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Constraint already exists or error: %', SQLERRM;
END $$;

-- Ensure badge_number is unique
ALTER TABLE users ADD CONSTRAINT users_badge_number_unique UNIQUE (badge_number);

-- Ensure email is unique
ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE (email);

-- Ensure auth_id is unique
ALTER TABLE users ADD CONSTRAINT users_auth_id_unique UNIQUE (auth_id);


-- =====================================================
-- 2. SEWADARS TABLE CONSTRAINTS
-- =====================================================

-- Ensure badge_number is unique
ALTER TABLE sewadars ADD CONSTRAINT sewadars_badge_number_unique UNIQUE (badge_number);

-- Drop old constraint and recreate with correct status values
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'sewadars_badge_status_check'
    ) THEN
        ALTER TABLE sewadars DROP CONSTRAINT sewadars_badge_status_check;
    END IF;
    
    ALTER TABLE sewadars ADD CONSTRAINT sewadars_badge_status_check 
        CHECK (badge_status IN ('open', 'permanent', 'elderly', 'suspended'));
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Constraint already exists or error: %', SQLERRM;
END $$;


-- =====================================================
-- 3. ATTENDANCE_SESSIONS TABLE - ADD MISSING COLUMNS
-- =====================================================

-- Add missing columns if they don't exist
ALTER TABLE attendance_sessions 
    ADD COLUMN IF NOT EXISTS in_id UUID REFERENCES attendance(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS out_id UUID REFERENCES attendance(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS out_scanner_name TEXT,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS force_closed_reason TEXT,
    ADD COLUMN IF NOT EXISTS force_closed_by TEXT;


-- =====================================================
-- 4. ATTENDANCE TABLE CONSTRAINTS
-- =====================================================

-- Add missing columns if they don't exist
ALTER TABLE attendance
    ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES attendance_sessions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS scanner_badge TEXT,
    ADD COLUMN IF NOT EXISTS scanner_name TEXT,
    ADD COLUMN IF NOT EXISTS scanner_centre TEXT,
    ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS manual_entry BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS submitted_by TEXT,
    ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;


-- =====================================================
-- 5. ATTENDANCE TYPE CONSTRAINT
-- =====================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'attendance_type_check'
    ) THEN
        ALTER TABLE attendance DROP CONSTRAINT attendance_type_check;
    END IF;
    
    ALTER TABLE attendance ADD CONSTRAINT attendance_type_check 
        CHECK (type IN ('IN', 'OUT'));
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Constraint already exists or error: %', SQLERRM;
END $$;


-- =====================================================
-- 6. DUTY TYPE CONSTRAINT
-- =====================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'attendance_sessions_duty_type_check'
    ) THEN
        ALTER TABLE attendance_sessions DROP CONSTRAINT attendance_sessions_duty_type_check;
    END IF;
    
    ALTER TABLE attendance_sessions ADD CONSTRAINT attendance_sessions_duty_type_check 
        CHECK (duty_type IN ('gate_entry', 'satsang', 'watch_ward'));
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Constraint already exists or error: %', SQLERRM;
END $$;


-- =====================================================
-- 7. PERFORMANCE INDEXES
-- =====================================================

-- Attendance Sessions Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_badge_date 
    ON attendance_sessions(badge_number, date_ist);

CREATE INDEX IF NOT EXISTS idx_sessions_badge_open 
    ON attendance_sessions(badge_number, is_open) 
    WHERE is_open = true;

CREATE INDEX IF NOT EXISTS idx_sessions_centre_date 
    ON attendance_sessions(centre, date_ist);

CREATE INDEX IF NOT EXISTS idx_sessions_in_time 
    ON attendance_sessions(in_time);

CREATE INDEX IF NOT EXISTS idx_sessions_date_open 
    ON attendance_sessions(date_ist, is_open);


-- Attendance Indexes
CREATE INDEX IF NOT EXISTS idx_attendance_badge_time 
    ON attendance(badge_number, scan_time DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_session 
    ON attendance(session_id) 
    WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_type_time 
    ON attendance(type, scan_time DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_badge_type_time 
    ON attendance(badge_number, type, scan_time DESC);


-- Users Indexes
CREATE INDEX IF NOT EXISTS idx_users_badge 
    ON users(badge_number);

CREATE INDEX IF NOT EXISTS idx_users_role 
    ON users(role) 
    WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_users_centre 
    ON users(centre);


-- Sewadars Indexes
CREATE INDEX IF NOT EXISTS idx_sewadars_badge 
    ON sewadars(badge_number);

CREATE INDEX IF NOT EXISTS idx_sewadars_centre 
    ON sewadars(centre);


-- Centres Indexes
CREATE INDEX IF NOT EXISTS idx_centres_parent 
    ON centres(parent_centre);


-- Jatha Attendance Indexes
CREATE INDEX IF NOT EXISTS idx_jatha_badge_dates 
    ON jatha_attendance(badge_number, date_from, date_to);


-- =====================================================
-- 8. REALTIME SUBSCRIPTIONS (Enable for production)
-- =====================================================

-- Enable realtime for attendance_sessions (ignore if already enabled)
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE attendance_sessions;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Table attendance_sessions already in publication or error: %', SQLERRM;
END $$;

-- Enable realtime for attendance (ignore if already enabled)
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE attendance;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Table attendance already in publication or error: %', SQLERRM;
END $$;


-- =====================================================
-- 9. FUNCTION TO PREVENT MULTIPLE OPEN SESSIONS
-- =====================================================

CREATE OR REPLACE FUNCTION prevent_multiple_open_sessions()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_open = true THEN
        -- Check if there's already an open session for this badge
        IF EXISTS (
            SELECT 1 FROM attendance_sessions 
            WHERE badge_number = NEW.badge_number 
            AND is_open = true 
            AND id != COALESCE(NEW.id, 0::bigint)
        ) THEN
            RAISE EXCEPTION 'Cannot have multiple open sessions for the same badge number';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if exists and recreate
DROP TRIGGER IF EXISTS trg_prevent_multiple_open_sessions ON attendance_sessions;

CREATE TRIGGER trg_prevent_multiple_open_sessions
    BEFORE INSERT OR UPDATE ON attendance_sessions
    FOR EACH ROW
    EXECUTE FUNCTION prevent_multiple_open_sessions();


-- =====================================================
-- 10. FUNCTION TO SET created_at TIMESTAMP
-- =====================================================

CREATE OR REPLACE FUNCTION set_created_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.created_at IS NULL THEN
        NEW.created_at := NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to attendance_sessions
DROP TRIGGER IF EXISTS trg_set_sessions_created_at ON attendance_sessions;
CREATE TRIGGER trg_set_sessions_created_at
    BEFORE INSERT ON attendance_sessions
    FOR EACH ROW
    EXECUTE FUNCTION set_created_at();

-- Apply to attendance
DROP TRIGGER IF EXISTS trg_set_attendance_created_at ON attendance;
CREATE TRIGGER trg_set_attendance_created_at
    BEFORE INSERT ON attendance
    FOR EACH ROW
    EXECUTE FUNCTION set_created_at();


-- =====================================================
-- 11. FUNCTION TO UPDATE updated_at TIMESTAMP
-- =====================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to attendance_sessions
DROP TRIGGER IF EXISTS trg_set_sessions_updated_at ON attendance_sessions;
CREATE TRIGGER trg_set_sessions_updated_at
    BEFORE UPDATE ON attendance_sessions
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();


-- =====================================================
-- 12. ANALYZE TABLES (Update statistics)
-- =====================================================

ANALYZE attendance_sessions;
ANALYZE attendance;
ANALYZE users;
ANALYZE sewadars;
ANALYZE centres;


-- =====================================================
-- VERIFICATION QUERIES (Run to verify)
-- =====================================================

-- Check indexes on tables
-- SELECT indexname, tablename 
-- FROM pg_indexes 
-- WHERE schemaname = 'public' 
-- AND tablename IN ('attendance_sessions', 'attendance', 'users', 'sewadars')
-- ORDER BY tablename, indexname;

-- Check table sizes
-- SELECT 
--     schemaname,
--     tablename,
--     pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
-- FROM pg_tables 
-- WHERE schemaname = 'public'
-- ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Verify tables exist
-- SELECT 'attendance_sessions' as table_name, COUNT(*) as row_count FROM attendance_sessions
-- UNION ALL
-- SELECT 'attendance', COUNT(*) FROM attendance
-- UNION ALL
-- SELECT 'users', COUNT(*) FROM users
-- UNION ALL
-- SELECT 'sewadars', COUNT(*) FROM sewadars;

-- Test the multiple open sessions prevention
-- This should fail if the trigger works:
-- INSERT INTO attendance_sessions (badge_number, is_open, duty_type) VALUES ('TEST999', true, 'gate_entry');
