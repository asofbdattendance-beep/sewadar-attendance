-- Migration: 002_add_manual_entry_flag
-- Purpose: Add manual_entry boolean to attendance table to track manual vs scanned entries
-- Also add submitted_by for tracking who made manual entries

-- Add manual_entry flag (FALSE = scanned, TRUE = manually entered)
ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS manual_entry BOOLEAN NOT NULL DEFAULT FALSE;

-- Add submitted_by column to track who created the entry (defaults to scanner_badge for scanned)
ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS submitted_by TEXT NOT NULL DEFAULT scanner_badge;

-- Add submitted_at for precise tracking
ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Add comment for documentation
COMMENT ON COLUMN attendance.manual_entry IS 'TRUE if entered manually by admin, FALSE if scanned via barcode';
COMMENT ON COLUMN attendance.submitted_by IS 'Badge number of user who submitted the entry (scanner or admin)';
COMMENT ON COLUMN attendance.submitted_at IS 'Timestamp when entry was submitted to database';

-- Create index for manual entry filtering
CREATE INDEX IF NOT EXISTS idx_attendance_manual
  ON attendance(manual_entry) WHERE manual_entry = TRUE;

-- Update existing records to mark all as scanned (manual_entry = FALSE)
UPDATE attendance SET manual_entry = FALSE WHERE manual_entry IS NULL;
UPDATE attendance SET submitted_by = scanner_badge WHERE submitted_by IS NULL;
UPDATE attendance SET submitted_at = created_at WHERE submitted_at IS NULL;

-- Make columns NOT NULL after update
ALTER TABLE attendance
ALTER COLUMN manual_entry SET NOT NULL,
ALTER COLUMN submitted_by SET NOT NULL,
ALTER COLUMN submitted_at SET NOT NULL;
