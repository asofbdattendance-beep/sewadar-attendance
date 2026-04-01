-- =====================================================
-- ADD PASSWORD_HASH COLUMN TO user_credentials
-- Sewadar Attendance System v3.1
-- =====================================================

-- Add password_hash column (stores SHA-256 hash, not plaintext)
ALTER TABLE public.user_credentials 
  ADD COLUMN IF NOT EXISTS password_hash text;

-- Rename password column to password_original (for backward compatibility)
-- This will be deprecated - actual passwords are now stored only in Supabase Auth
-- This column will be kept empty for new entries

-- Create index for password_hash lookups (if needed in future)
CREATE INDEX IF NOT EXISTS idx_user_credentials_badge 
  ON public.user_credentials(badge_number);

-- =====================================================
-- VERIFICATION
-- =====================================================
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'public' AND table_name = 'user_credentials' 
ORDER BY ordinal_position;

-- =====================================================
-- NOTE: 
-- After running this migration, deploy the new edge function:
-- supabase/functions/save-credential/index.ts
-- 
-- The frontend will now store hashed passwords instead of plaintext.
-- Existing plaintext passwords in the password column should be 
-- migrated or cleared based on security policy.
-- =====================================================
