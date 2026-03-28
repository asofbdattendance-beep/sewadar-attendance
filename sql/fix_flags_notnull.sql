-- Fix: session_id column in flags must be nullable for SET NULL to work
ALTER TABLE public.flags ALTER COLUMN session_id DROP NOT NULL;

-- Verify the column is now nullable
SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'flags' AND column_name = 'session_id';
