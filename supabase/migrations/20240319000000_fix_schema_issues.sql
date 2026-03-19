-- Migration: Add performance indexes + add replied_by_role column
-- Already applied: All constraints (FK, CHECK, UNIQUE)

-- Add replied_by_role column to query_replies (for displaying user roles in replies)
ALTER TABLE public.query_replies
ADD COLUMN IF NOT EXISTS replied_by_role text;

-- Performance indexes

-- attendance indexes
CREATE INDEX IF NOT EXISTS idx_attendance_badge_scan_time ON public.attendance(badge_number, scan_time DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_centre_scan_time ON public.attendance(centre, scan_time DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_type_scan_time ON public.attendance(type, scan_time DESC);

-- jatha_attendance indexes
CREATE INDEX IF NOT EXISTS idx_jatha_attendance_badge_dates ON public.jatha_attendance(badge_number, date_from, date_to);
CREATE INDEX IF NOT EXISTS idx_jatha_attendance_centre_date ON public.jatha_attendance(centre, date_from);

-- queries indexes
CREATE INDEX IF NOT EXISTS idx_queries_attendance_id ON public.queries(attendance_id) WHERE attendance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_queries_status_centre ON public.queries(status, raised_by_centre);

-- logs indexes
CREATE INDEX IF NOT EXISTS idx_logs_user_timestamp ON public.logs(user_badge, timestamp DESC);

-- centres indexes
CREATE INDEX IF NOT EXISTS idx_centres_parent_centre ON public.centres(parent_centre) WHERE parent_centre IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_centres_parent_name_unique ON public.centres(parent_centre, centre_name) WHERE parent_centre IS NOT NULL;
