-- ============================================================
-- SEWADARS IMPORT SCRIPT (Fixed v2)
-- Run this BEFORE importing your CSV
-- ============================================================

-- Step 1: Drop foreign keys first (they depend on the constraint)
ALTER TABLE attendance_sessions DROP CONSTRAINT IF EXISTS attendance_sessions_badge_number_fkey;
ALTER TABLE jatha_attendance DROP CONSTRAINT IF EXISTS jatha_attendance_badge_number_fkey;

-- Step 2: Drop existing constraints
ALTER TABLE sewadars DROP CONSTRAINT IF EXISTS sewadars_gender_check;
ALTER TABLE sewadars DROP CONSTRAINT IF EXISTS sewadars_badge_status_check;
ALTER TABLE sewadars DROP CONSTRAINT IF EXISTS sewadars_badge_number_key;

-- Step 3: Change column types to TEXT to accept any value
ALTER TABLE sewadars ALTER COLUMN gender TYPE TEXT;
ALTER TABLE sewadars ALTER COLUMN is_initiated TYPE TEXT;
ALTER TABLE sewadars ALTER COLUMN age TYPE TEXT;
ALTER TABLE sewadars ALTER COLUMN badge_status TYPE TEXT;
ALTER TABLE sewadars ALTER COLUMN print_status TYPE TEXT;
ALTER TABLE sewadars ALTER COLUMN form_status TYPE TEXT;

-- Step 4: Create temp table with exact CSV column names
DROP TABLE IF EXISTS sewadars_import_temp;

CREATE TABLE sewadars_import_temp (
    Badge_Number TEXT PRIMARY KEY,
    Sewadar_Name TEXT NOT NULL,
    Father_Husband_Name TEXT,
    Gender TEXT,
    Badge_Status TEXT,
    Centre TEXT NOT NULL,
    Department TEXT,
    Is_Initiated TEXT,
    Age TEXT,
    Print_Status TEXT,
    Form_Status TEXT
);

-- ============================================================
-- IMPORT YOUR CSV INTO: sewadars_import_temp
-- ============================================================
-- In Supabase Dashboard:
-- 1. Go to Table Editor
-- 2. Click "Import data from CSV"  
-- 3. Select your file
-- 4. Target table: "sewadars_import_temp"
-- ============================================================

-- Step 5: Re-add unique constraint BEFORE foreign keys (required for FK to work)
ALTER TABLE sewadars ADD CONSTRAINT sewadars_badge_number_key UNIQUE (badge_number);

-- Step 6: After CSV import, run this to fix and copy to main table
INSERT INTO sewadars (badge_number, sewadar_name, father_husband_name, gender, badge_status, centre, department, is_initiated, age, print_status, form_status)
SELECT 
    Badge_Number,
    Sewadar_Name,
    Father_Husband_Name,
    CASE 
        WHEN UPPER(Gender) = 'FEMALE' THEN 'Female'
        WHEN UPPER(Gender) = 'MALE' THEN 'Male'
        ELSE Gender
    END,
    Badge_Status,
    Centre,
    Department,
    CASE 
        WHEN UPPER(Is_Initiated) = 'TRUE' THEN true
        WHEN UPPER(Is_Initiated) = 'FALSE' THEN false
        ELSE NULL
    END,
    NULLIF(Age, '')::INTEGER,
    CASE 
        WHEN Print_Status ILIKE '%printed%' THEN 'Printed'
        ELSE 'NOT_PRINTED'
    END,
    CASE 
        WHEN Form_Status ILIKE '%approved%' THEN 'Approved'
        ELSE 'NOT_SUBMITTED'
    END
FROM sewadars_import_temp
ON CONFLICT (badge_number) DO UPDATE SET
    sewadar_name = EXCLUDED.sewadar_name,
    father_husband_name = EXCLUDED.father_husband_name,
    gender = EXCLUDED.gender,
    badge_status = EXCLUDED.badge_status,
    centre = EXCLUDED.centre,
    department = EXCLUDED.department,
    is_initiated = EXCLUDED.is_initiated,
    age = EXCLUDED.age,
    print_status = EXCLUDED.print_status,
    form_status = EXCLUDED.form_status;

-- Step 7: Clean up temp table
DROP TABLE sewadars_import_temp;

-- Step 8: Re-add other constraints
ALTER TABLE sewadars ADD CONSTRAINT sewadars_gender_check CHECK (gender IN ('Male', 'Female') OR gender IS NULL);
ALTER TABLE sewadars ADD CONSTRAINT sewadars_badge_status_check CHECK (badge_status IN ('OPEN', 'PERMANENT') OR badge_status IS NULL);

-- Step 9: Re-add foreign keys (now that unique constraint exists)
ALTER TABLE attendance_sessions ADD CONSTRAINT attendance_sessions_badge_number_fkey 
    FOREIGN KEY (badge_number) REFERENCES sewadars(badge_number);
ALTER TABLE jatha_attendance ADD CONSTRAINT jatha_attendance_badge_number_fkey 
    FOREIGN KEY (badge_number) REFERENCES sewadars(badge_number);

-- Step 10: Verify the data
SELECT gender, COUNT(*) FROM sewadars GROUP BY gender;
SELECT is_initiated, COUNT(*) FROM sewadars GROUP BY is_initiated;
SELECT badge_status, COUNT(*) FROM sewadars GROUP BY badge_status;
SELECT print_status, COUNT(*) FROM sewadars GROUP BY print_status;
SELECT form_status, COUNT(*) FROM sewadars GROUP BY form_status;
SELECT COUNT(*) as total_sewadars FROM sewadars;
