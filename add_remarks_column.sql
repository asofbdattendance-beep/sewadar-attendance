-- Add remarks column to jatha_attendance table
ALTER TABLE public.jatha_attendance ADD COLUMN IF NOT EXISTS remarks text;