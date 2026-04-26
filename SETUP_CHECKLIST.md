# Sewadar Attendance System - Complete Checklist

## 1. ROLES SYSTEM ✅

### Role Hierarchy
| Role Key | Label | Badge Prefix | Access Level |
|----------|-------|--------------|--------------|
| `super_admin` | Super Admin | SA | Full System |
| `admin` | Admin | AD | Admin Tasks |
| `centre_user` | Centre Admin | CU | Centre-Level |
| `sc_sp_user` | Scanner | SC | Basic Access |

### Role Permissions
| Feature | Super Admin | Admin | Centre Admin | Scanner |
|---------|-------------|-------|--------------|---------|
| All Centres | ✅ | ✅ | ❌ | ❌ |
| All Sewadars | ✅ | ✅ | ❌ | ❌ |
| All Records | ✅ | ✅ | ✅ Own | ✅ Own |
| Gate Entry | ✅ | ✅ | ✅ Own | ✅ Own |
| Jatha Entry | ✅ | ✅ | ✅ | ✅ |
| User Mgmt | ✅ | ✅ | ❌ | ❌ |
| Settings | ✅ | ✅ | ❌ | ❌ |

---

## 2. FILES UPDATED ✅

### Frontend
- [x] `src/lib/supabase.js` - Added ROLE_LABELS and ROLE_COLORS
- [x] `src/pages/ProfilePage.jsx` - Uses constants instead of hardcoded values
- [x] `src/pages/RecordsPage.jsx` - All `.centre` accesses have null checks
- [x] `src/pages/ScannerPage.jsx` - All `.centre` accesses have null checks
- [x] `src/pages/GateEntryPage.jsx` - All `.centre` accesses have null checks
- [x] `src/pages/JathaEntryPage.jsx` - All `.centre` accesses have null checks

### Backend
- [x] `supabase_schema.sql` - Updated to `super_admin`, added role_masters table
- [x] `supabase_schema.sql` - Updated RLS policies
- [x] `supabase_schema.sql` - Added migration for existing users

### Scripts
- [x] `bulk_create_users.py` - Role mapping, auto badge generation
- [x] `users_template.csv` - Includes Badge_Number column

---

## 3. DATABASE CHANGES

### New Table: role_masters
```sql
CREATE TABLE role_masters (
  id BIGSERIAL PRIMARY KEY,
  role_key TEXT UNIQUE NOT NULL,
  role_label TEXT NOT NULL,
  role_description TEXT,
  permissions JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true
);
```

### Updated Table: users
```sql
-- Role now references role_masters
role TEXT NOT NULL REFERENCES role_masters(role_key)
```

### Updated Roles
- `aso` → `super_admin`
- New: `admin`
- `centre_user` (unchanged)
- `sc_sp_user` (unchanged)

---

## 4. SETUP INSTRUCTIONS

### 1. Run Database Migration
Run this SQL in Supabase SQL Editor:

```sql
-- Step 1: Create role_masters table
CREATE TABLE IF NOT EXISTS role_masters (
  id BIGSERIAL PRIMARY KEY,
  role_key TEXT UNIQUE NOT NULL,
  role_label TEXT NOT NULL,
  role_description TEXT,
  permissions JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Step 2: Seed roles
INSERT INTO role_masters (role_key, role_label, role_description, permissions) VALUES
('super_admin', 'Super Admin', 'Full system access', '{"all": true}'),
('admin', 'Admin', 'Administrative access', '{"users": true}'),
('centre_user', 'Centre Admin', 'Centre-level access', '{"centre_data": true}'),
('sc_sp_user', 'Scanner', 'Basic scanning access', '{"scan": true}')
ON CONFLICT (role_key) DO NOTHING;

-- Step 3: Update existing users
UPDATE users SET role = 'super_admin' WHERE role = 'aso';
```

### 2. Create Users from Excel/CSV
```bash
# Install dependencies
pip install -r requirements.txt

# Set Supabase key
export SUPABASE_KEY="your-service-role-key"

# Create users
python bulk_create_users.py users.csv
```

### 3. Excel/CSV Format
```csv
Email,Password,Name,Role,Centre,Badge_Number
admin@example.com,pass123,Admin,SUPER_ADMIN,Gurugram,
scanner@example.com,pass123,Scanner,SCANNER,BADHA SIKENDERPUR,
```

---

## 5. ROLE MAPPING (CSV → DB)

| CSV Role | DB Role |
|---------|---------|
| SUPER_ADMIN | super_admin |
| ADMIN | admin |
| CENTRE_ADMIN | centre_user |
| CENTRE_USER | centre_user |
| SC_SP_USER | sc_sp_user |
| SCANNER | sc_sp_user |
| USER | sc_sp_user |

---

## 6. BADGE NUMBER GENERATION

If Badge_Number is provided, it's used as-is.
Otherwise, auto-generated: `{PREFIX}{MMDDHHMMSS}{SEQ}`

Examples:
- Super Admin: `SA0425163012001`
- Admin: `AD0425163012002`
- Centre Admin: `CU0425163012003`
- Scanner: `SC0425163012004`

---

## 7. VERIFICATION CHECKLIST

After setup, verify:

- [ ] Login works with new roles
- [ ] Profile page shows correct role label
- [ ] Scanner page restricts to own centre (if not admin)
- [ ] Records page shows only own centre data (if not admin)
- [ ] Gate Entry only for own centre (if not admin)
- [ ] Export works correctly
- [ ] Jatha entry works correctly

---

## 8. COMMON ISSUES

### "Cannot read properties of undefined (reading 'centre')"
✅ Fixed - All `.centre` accesses now have null checks with fallbacks

### "Inconsistent role values"
✅ Fixed - Now uses `role_masters` table and constants

### "Badge number not generating"
✅ Fixed - Auto-generation with prefix based on role

### "RLS policy errors"
✅ Fixed - Updated policies to use new role names
