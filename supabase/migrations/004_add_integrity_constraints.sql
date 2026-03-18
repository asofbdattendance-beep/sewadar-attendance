-- supabase/migrations/004_add_integrity_constraints.sql
-- Adds database-level uniqueness constraints and foreign keys

-- UNIQUE constraint on sewadars.badge_number
-- Prevents duplicate badge numbers from race conditions or direct DB inserts
ALTER TABLE sewadars ADD CONSTRAINT sewadars_badge_number_key UNIQUE (badge_number);

-- UNIQUE constraint on users.badge_number
ALTER TABLE users ADD CONSTRAINT users_badge_number_key UNIQUE (badge_number);

-- UNIQUE constraint on users.email
ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);

-- UNIQUE constraint on users.auth_id (one profile per auth user)
ALTER TABLE users ADD CONSTRAINT users_auth_id_key UNIQUE (auth_id);
