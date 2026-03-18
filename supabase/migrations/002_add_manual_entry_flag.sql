-- Migration: 002_add_manual_entry_flag (FIXED)

-- ===========================
-- ADD COLUMNS (no invalid defaults)
-- ===========================

ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS manual_entry BOOLEAN DEFAULT FALSE;

ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS submitted_by TEXT;  -- ❗ no default here

ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- ===========================
-- BACKFILL DATA
-- ===========================

-- Existing records
UPDATE attendance
SET manual_entry = FALSE
WHERE manual_entry IS NULL;

UPDATE attendance
SET submitted_by = scanner_badge
WHERE submitted_by IS NULL;

UPDATE attendance
SET submitted_at = created_at
WHERE submitted_at IS NULL;

-- ===========================
-- ENFORCE NOT NULL
-- ===========================

ALTER TABLE attendance
ALTER COLUMN manual_entry SET NOT NULL,
ALTER COLUMN submitted_by SET NOT NULL,
ALTER COLUMN submitted_at SET NOT NULL;

-- ===========================
-- INDEX (after column exists)
-- ===========================

CREATE INDEX IF NOT EXISTS idx_attendance_manual
  ON attendance(manual_entry)
  WHERE manual_entry = TRUE;

-- ===========================
-- COMMENTS
-- ===========================

COMMENT ON COLUMN attendance.manual_entry IS 'TRUE if manual entry';
COMMENT ON COLUMN attendance.submitted_by IS 'Who submitted entry';
COMMENT ON COLUMN attendance.submitted_at IS 'Submission timestamp';