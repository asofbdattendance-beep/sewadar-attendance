-- Update role from area_secretary to ASO
UPDATE users SET role = 'aso' WHERE role = 'area_secretary';

-- Verify
SELECT id, email, name, role FROM users;
