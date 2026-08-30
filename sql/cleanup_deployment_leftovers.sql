-- ============================================================
-- cleanup_deployment_leftovers.sql
-- PURPOSE: Erase ONLY portal/deployment artefacts that linger on the
-- ATTENDANCE DB (lnznhbwgkusgdcmvgznf) after the shared-DB period.
-- KEEPS: attendance_sessions (BIGINT), jatha_*, sewadars, centres,
--        users, role_masters, settings, logs, archival_attendance (+ RPC)
--
-- RUN ON: ATTENDANCE DB ONLY (lnznhb...). NEVER on portal DB (wgavv...).
--         Safe to re-run. Uses IF EXISTS + CASCADE.
-- ============================================================

-- 1) Portal tables (16) — CASCADE drops their RLS policies, triggers, FKs
DROP TABLE IF EXISTS public.sewadar_audit_log CASCADE;
DROP TABLE IF EXISTS public.audit_log CASCADE;
DROP TABLE IF EXISTS public.vss_registrations CASCADE;
DROP TABLE IF EXISTS public.vss_sewadars CASCADE;
DROP TABLE IF EXISTS public.sewadar_consents CASCADE;
DROP TABLE IF EXISTS public.department_incharge_selections CASCADE;
DROP TABLE IF EXISTS public.department_incharges CASCADE;
DROP TABLE IF EXISTS public.centre_vss_overrides CASCADE;
DROP TABLE IF EXISTS public.centre_overrides CASCADE;
DROP TABLE IF EXISTS public.centre_locks CASCADE;
DROP TABLE IF EXISTS public.centre_allocations CASCADE;
DROP TABLE IF EXISTS public.prev_year_deployments CASCADE;
DROP TABLE IF EXISTS public.deployments CASCADE; -- portal's deployments (uuid, schedule_id) — NOT attendance_sessions
DROP TABLE IF EXISTS public.deployment_schedules CASCADE;
DROP TABLE IF EXISTS public.deployment_departments CASCADE;
DROP TABLE IF EXISTS public.portal_settings CASCADE;
DROP TABLE IF EXISTS public.portal_users CASCADE;

-- 2) Portal view
DROP VIEW IF EXISTS public.vw_all_deployments CASCADE;

-- 3) Portal helper functions / triggers (those not already dropped by CASCADE)
DROP FUNCTION IF EXISTS public.get_portal_user_role() CASCADE;
DROP FUNCTION IF EXISTS public.get_portal_user_centre() CASCADE;
DROP FUNCTION IF EXISTS public.get_portal_profile() CASCADE;
DROP FUNCTION IF EXISTS public.get_root_centre(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_parent_centres(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_subtree_centres(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_my_dept_ids(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_my_subtree_centres() CASCADE;
DROP FUNCTION IF EXISTS public.is_dept_incharge(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.is_scanner() CASCADE;
DROP FUNCTION IF EXISTS public.is_centre_locked(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.is_centre_override_open(UUID, TEXT, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.is_any_centre_override_open(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.is_centre_undeployed_override_open(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.is_any_normal_override_open(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.centre_vss_creation_override(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.vss_creation_open_for_centre(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.vss_deploy_open_for_centre(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_my_effective_gates(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.is_valid_badge_format(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.is_vss_badge(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.is_faridabad_centre(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.is_faridabad_badge(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.scan_in(TEXT, UUID, TIMESTAMPTZ, TEXT, TEXT, BOOLEAN) CASCADE;
DROP FUNCTION IF EXISTS public.scan_out(TEXT, UUID, TIMESTAMPTZ, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.absentees_in_my_dept(UUID, DATE) CASCADE;
DROP FUNCTION IF EXISTS public.get_parent_consent_matrix(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_parent_department_matrix(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.get_dept_quota_remaining(UUID, UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_remaining_quota(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.sewadar_display_name(TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.dept_name_by_id(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.assign_vss_registration(UUID, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.vss_reg_assign_temp_id() CASCADE;
DROP FUNCTION IF EXISTS public.vss_reg_validate_age() CASCADE;
DROP FUNCTION IF EXISTS public.audit_consent_change() CASCADE;
DROP FUNCTION IF EXISTS public.audit_deployment_change() CASCADE;
DROP FUNCTION IF EXISTS public.audit_lock_change() CASCADE;
DROP FUNCTION IF EXISTS public.block_aas_deployment() CASCADE;
DROP FUNCTION IF EXISTS public.block_after_deadline() CASCADE;
DROP FUNCTION IF EXISTS public.block_finalized_consent_edit() CASCADE;
DROP FUNCTION IF EXISTS public.block_finalized_delete() CASCADE;
DROP FUNCTION IF EXISTS public.block_finalized_deploy_edit() CASCADE;
DROP FUNCTION IF EXISTS public.block_locked_delete() CASCADE;
DROP FUNCTION IF EXISTS public.check_centre_lock() CASCADE;
DROP FUNCTION IF EXISTS public.check_department_incharge() CASCADE;
DROP FUNCTION IF EXISTS public.check_deployment() CASCADE;
DROP FUNCTION IF EXISTS public.check_deployment_batch() CASCADE;
DROP FUNCTION IF EXISTS public.check_deployment_batch_upd() CASCADE;
DROP FUNCTION IF EXISTS public.check_incharge_selection() CASCADE;
DROP FUNCTION IF EXISTS public.clamp_oe_escorts_consent_days() CASCADE;
DROP FUNCTION IF EXISTS public.guard_oe_escorts_min_days() CASCADE;
DROP FUNCTION IF EXISTS public.guard_vss_registration_write() CASCADE;
DROP FUNCTION IF EXISTS public.require_sewadar_exists() CASCADE;
DROP FUNCTION IF EXISTS public.get_sewadar_deployment_open() CASCADE;
DROP FUNCTION IF EXISTS public.get_vss_creation_open() CASCADE;
DROP FUNCTION IF EXISTS public.get_vss_deployment_open() CASCADE;
DROP FUNCTION IF EXISTS public.vss_creation_window_open() CASCADE;
DROP FUNCTION IF EXISTS public.touch_updated_at() CASCADE;

-- Portal overload of get_sewadar_by_badge that returns jsonb (attendance keeps SETOF sewadars version)
-- rls_policies_all.sql already handles this via DO-drop, but safe to keep here too:
-- DROP FUNCTION IF EXISTS public.get_sewadar_by_badge(TEXT) CASCADE; -- DON'T run here — would drop attendance version

-- 4) Verify (run after, read-only):
-- SELECT table_name FROM information_schema.tables WHERE table_schema='public'
--   AND table_name IN ('portal_users','deployment_schedules','deployments','sewadar_consents','vss_sewadars','portal_settings')
--   ORDER BY table_name; -- expect 0 rows
-- SELECT proname FROM pg_proc WHERE proname LIKE '%portal%' OR proname = 'scan_in' ORDER BY proname; -- expect 0 rows
-- SELECT COUNT(*) FROM public.attendance_sessions; -- unchanged
-- SELECT COUNT(*) FROM public.archival_attendance; -- unchanged (kept)
