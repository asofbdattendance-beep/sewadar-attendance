-- =============================================================
-- Fix: Rewrite RLS policies with recursive centre hierarchy
-- =============================================================
-- Role access matrix:
--   super_admin   : FULL access (read/write all centres, all tables)
--   admin         : Read/Write own centre + child centres
--   centre_user   : Read/Write own centre + child centres
--   sc_sp_user    : Read only own centre + child centres
-- =============================================================

-- Helper function: return all accessible centres (own + all descendants recursively)
CREATE OR REPLACE FUNCTION get_user_accessible_centres()
RETURNS SETOF text AS $$
DECLARE
  v_centre text;
BEGIN
  SELECT centre INTO v_centre FROM users WHERE auth_id = auth.uid();
  IF v_centre IS NULL THEN RETURN; END IF;

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

-- SEWADARS
DROP POLICY IF EXISTS "sewadars_read" ON sewadars;
CREATE POLICY "sewadars_read" ON sewadars FOR SELECT TO authenticated
  USING (centre = ANY (SELECT get_user_accessible_centres()));

DROP POLICY IF EXISTS "sewadars_write" ON sewadars;
CREATE POLICY "sewadars_write" ON sewadars FOR ALL TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() IN ('admin', 'centre_user') AND centre = ANY (SELECT get_user_accessible_centres()))
  )
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() IN ('admin', 'centre_user') AND centre = ANY (SELECT get_user_accessible_centres()))
  );

-- ATTENDANCE_SESSIONS
DROP POLICY IF EXISTS "sessions_read" ON attendance_sessions;
CREATE POLICY "sessions_read" ON attendance_sessions FOR SELECT TO authenticated
  USING (centre = ANY (SELECT get_user_accessible_centres()));

DROP POLICY IF EXISTS "sessions_insert" ON attendance_sessions;
CREATE POLICY "sessions_insert" ON attendance_sessions FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR centre = ANY (SELECT get_user_accessible_centres())
  );

DROP POLICY IF EXISTS "sessions_update" ON attendance_sessions;
CREATE POLICY "sessions_update" ON attendance_sessions FOR UPDATE TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() IN ('admin', 'centre_user') AND centre = ANY (SELECT get_user_accessible_centres()))
  )
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() IN ('admin', 'centre_user') AND centre = ANY (SELECT get_user_accessible_centres()))
  );

DROP POLICY IF EXISTS "sessions_delete" ON attendance_sessions;
CREATE POLICY "sessions_delete" ON attendance_sessions FOR DELETE TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() IN ('admin', 'centre_user') AND centre = ANY (SELECT get_user_accessible_centres()))
  );

-- CENTRES
DROP POLICY IF EXISTS "centres_write" ON centres;
CREATE POLICY "centres_write" ON centres FOR ALL TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

-- JATHA_MASTER
DROP POLICY IF EXISTS "jatha_read" ON jatha_master;
DROP POLICY IF EXISTS "jatha_write" ON jatha_master;
CREATE POLICY "jatha_read" ON jatha_master FOR SELECT TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR centre_name = ANY (SELECT get_user_accessible_centres())
  );

CREATE POLICY "jatha_write" ON jatha_master FOR ALL TO authenticated
  USING (
    get_user_role() = 'super_admin'
    OR (get_user_role() IN ('admin', 'centre_user') AND centre_name = ANY (SELECT get_user_accessible_centres()))
  )
  WITH CHECK (
    get_user_role() = 'super_admin'
    OR (get_user_role() IN ('admin', 'centre_user') AND centre_name = ANY (SELECT get_user_accessible_centres()))
  );

-- JATHA_ATTENDANCE
DROP POLICY IF EXISTS "jatha_att_read" ON jatha_attendance;
DROP POLICY IF EXISTS "jatha_read" ON jatha_attendance;
DROP POLICY IF EXISTS "jatha_att_write" ON jatha_attendance;
CREATE POLICY "jatha_att_read" ON jatha_attendance FOR SELECT TO authenticated
  USING (
    badge_number IN (
      SELECT badge_number FROM sewadars
      WHERE centre = ANY (SELECT get_user_accessible_centres())
    )
  );
CREATE POLICY "jatha_att_write" ON jatha_attendance FOR ALL TO authenticated
  USING (
    get_user_role() IN ('super_admin', 'admin', 'centre_user')
  )
  WITH CHECK (
    get_user_role() IN ('super_admin', 'admin', 'centre_user')
  );

-- LOGS
ALTER TABLE logs ADD COLUMN IF NOT EXISTS user_name text DEFAULT 'Unknown';
DROP POLICY IF EXISTS "logs_read" ON logs;
CREATE POLICY "logs_read" ON logs FOR SELECT TO authenticated
  USING (get_user_role() IN ('aso', 'super_admin'));

-- SPECIAL_DEPARTMENTS
DROP POLICY IF EXISTS "depts_write" ON special_departments;
CREATE POLICY "depts_write" ON special_departments FOR ALL TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');

-- ROLE_MASTERS (already correct, kept for completeness)
DROP POLICY IF EXISTS "role_masters_write" ON role_masters;
CREATE POLICY "role_masters_write" ON role_masters FOR ALL TO authenticated
  USING (get_user_role() = 'super_admin')
  WITH CHECK (get_user_role() = 'super_admin');
