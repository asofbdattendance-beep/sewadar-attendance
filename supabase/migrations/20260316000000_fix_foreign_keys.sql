-- Fix foreign key constraint to allow cascade delete
-- This allows attendance records to be deleted even if they have related queries

-- First, drop the existing foreign key
ALTER TABLE queries DROP CONSTRAINT IF EXISTS queries_attendance_id_fkey;

-- Add new foreign key with ON DELETE CASCADE
ALTER TABLE queries 
ADD CONSTRAINT queries_attendance_id_fkey 
FOREIGN KEY (attendance_id) 
REFERENCES attendance(id) 
ON DELETE CASCADE;

-- Verify the change
\d+ queries
