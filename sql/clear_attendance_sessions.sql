-- ============================================================
-- clear_attendance_sessions.sql
-- Purpose: Empty attendance_sessions completely, keep structure
-- Scope: ONLY public.attendance_sessions — no DDL, no other tables
-- Structure preserved: columns, PK (id), FK, CHECKs, indexes, RLS, triggers
-- Run in Supabase SQL Editor (service_role). Requires TRUNCATE privilege.
-- ============================================================

-- Fast, transactional, keeps table definition. RESTART IDENTITY resets
-- the BIGINT GENERATED ALWAYS AS IDENTITY sequence so next insert starts at 1.
-- No CASCADE — does not touch sewadars, centres, logs, archival_attendance.
TRUNCATE public.attendance_sessions RESTART IDENTITY;

-- Verify — should be 0
-- SELECT COUNT(*) AS remaining_rows FROM public.attendance_sessions;
-- SELECT last_value FROM attendance_sessions_id_seq; -- should be 1 after restart

-- Alternative (if TRUNCATE blocked by FK or RLS, slower but equivalent):
-- DELETE FROM public.attendance_sessions; -- keeps identity, does not reset id
-- SELECT setval('public.attendance_sessions_id_seq', 1, false); -- optional reset
