-- Add remark column to attendance_sessions for manual entry notes
ALTER TABLE attendance_sessions ADD COLUMN IF NOT EXISTS remark TEXT;