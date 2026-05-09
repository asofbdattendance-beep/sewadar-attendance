-- ============================================================
-- Run this ONCE in Supabase SQL Editor (already done if working)
-- ============================================================
--
-- Adds temp_password column and creates a database trigger
-- that fires when a user is created. The trigger calls the
-- Edge Function via pg_net (async fallback).
--
-- The primary auth creation is now done from the frontend via
-- supabase.functions.invoke(). This trigger is a backup.
-- ============================================================

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS temp_password TEXT;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.temp_password IS NULL OR NEW.temp_password = '' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://lnznhbwgkusgdcmvgznf.supabase.co/functions/v1/create-auth-user',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Internal-Secret', 'my-random-secret-here'
    ),
    body := jsonb_build_object(
      'email', NEW.email,
      'password', NEW.temp_password,
      'user_metadata', jsonb_build_object(
        'badge_number', NEW.badge_number,
        'name', NEW.name,
        'role', NEW.role,
        'centre', NEW.centre
      )
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_user_created ON public.users;
CREATE TRIGGER on_user_created
  AFTER INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
