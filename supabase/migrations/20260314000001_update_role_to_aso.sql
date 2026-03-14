-- Migration to update role name from area_secretary to ASO
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

-- Drop old constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- Update role
UPDATE users SET role = 'aso' WHERE role = 'area_secretary';

-- Add new constraint with ASO
ALTER TABLE users ADD CONSTRAINT users_role_check 
CHECK (role IN ('aso', 'centre_user', 'sc_sp_user'));

-- Re-enable RLS and create policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_read_all ON users;
DROP POLICY IF EXISTS users_read_own ON users;
DROP POLICY IF EXISTS users_insert ON users;
DROP POLICY IF EXISTS users_update ON users;

CREATE POLICY "users_read_all" ON users FOR SELECT TO authenticated USING (true);
CREATE POLICY "users_read_own" ON users FOR SELECT TO authenticated USING (auth_id = auth.uid());
CREATE POLICY "users_insert" ON users FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "users_update" ON users FOR UPDATE TO authenticated USING (true);

SELECT id, email, name, role FROM users;
