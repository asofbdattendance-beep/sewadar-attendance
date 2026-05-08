-- =============================================================
-- Add ASO (read-only) role separate from super_admin
-- =============================================================
-- Role matrix:
--   super_admin : FULL read/write on all tables
--   aso         : READ-ONLY on all data, no INSERT/UPDATE/DELETE
-- =============================================================

-- 1. Insert aso role into role_masters (read-only feature permissions)
INSERT INTO role_masters (role_key, role_label, role_description, permissions, is_active)
VALUES ('aso', 'ASO (View Only)', 'Read-only access to all data', '{"allow_dashboard": true, "allow_records": true, "allow_reports": true}', true)
ON CONFLICT (role_key) DO UPDATE SET
  role_label = 'ASO (View Only)',
  role_description = 'Read-only access to all data',
  permissions = '{"allow_dashboard": true, "allow_records": true, "allow_reports": true}';

-- 2. Update get_user_accessible_centres: return ALL centres for aso and super_admin
CREATE OR REPLACE FUNCTION get_user_accessible_centres()
RETURNS SETOF text AS $$
DECLARE
  v_centre text;
  v_role text;
BEGIN
  SELECT centre, get_user_role() INTO v_centre, v_role FROM users WHERE auth_id = auth.uid();
  IF v_centre IS NULL THEN RETURN; END IF;

  -- ASO and super_admin see ALL centres (read-only for aso, full for super_admin)
  IF v_role IN ('aso', 'super_admin') THEN
    RETURN QUERY SELECT name FROM centres;
    RETURN;
  END IF;

  RETURN QUERY
  WITH RECURSIVE centre_tree AS (
    SELECT name FROM centres WHERE name = v_centre
    UNION ALL
    SELECT c.name FROM centres c
    INNER JOIN centre_tree ct ON c.parent_centre = ct.name
  )
  SELECT name FROM centre_tree;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 3. Add separate READ policies for tables that currently only have FOR ALL (write) policies

-- Centres: everyone authenticated can READ centres
DROP POLICY IF EXISTS "centres_read" ON centres;
CREATE POLICY "centres_read" ON centres FOR SELECT TO authenticated
  USING (true);

-- Role masters: everyone authenticated can READ role definitions
DROP POLICY IF EXISTS "role_masters_read" ON role_masters;
CREATE POLICY "role_masters_read" ON role_masters FOR SELECT TO authenticated
  USING (true);

-- Special departments: everyone authenticated can READ departments
DROP POLICY IF EXISTS "depts_read" ON special_departments;
CREATE POLICY "depts_read" ON special_departments FOR SELECT TO authenticated
  USING (true);

-- Logs: aso and super_admin can READ logs (already exists, kept for clarity)
-- Existing policy: get_user_role() IN ('aso', 'super_admin')

-- 4. Update logs_read policy to include aso explicitly (already correct in current DB)
-- DROP POLICY IF EXISTS "logs_read" ON logs;
-- CREATE POLICY "logs_read" ON logs FOR SELECT TO authenticated
--   USING (get_user_role() IN ('aso', 'super_admin'));

-- =============================================================
-- NOTE: Write policies already exclude 'aso' role:
--   - sewadars_write : super_admin, admin, centre_user
--   - sessions_insert/update/delete : super_admin, admin, centre_user
--   - centres_write : super_admin
--   - jatha_write : super_admin, admin, centre_user
--   - jatha_att_write : super_admin, admin, centre_user
--   - depts_write : super_admin
--   - role_masters_write : super_admin
-- No changes needed to write policies - aso is already excluded.
-- =============================================================
