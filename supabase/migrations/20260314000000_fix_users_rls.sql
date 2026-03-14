-- Fix users table RLS
ALTER TABLE users DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_read ON users;
DROP POLICY IF EXISTS users_write ON users;
DROP POLICY IF EXISTS users_read_own ON users;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_all" ON users FOR SELECT TO authenticated USING (true);
CREATE POLICY "users_read_own" ON users FOR SELECT TO authenticated USING (auth_id = auth.uid());
CREATE POLICY "users_insert" ON users FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "users_update" ON users FOR UPDATE TO authenticated USING (true);
