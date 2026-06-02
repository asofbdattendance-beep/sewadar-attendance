# Sewadar Attendance System

A mobile-friendly web app for tracking attendance of sewadars (volunteers) across 41 satsang centres in Haryana, UP, and Delhi.

**Version:** 2.6  
**Supabase Project:** `lnznhbwgkusgdcmvgznf`  
**Frontend:** React 18 + Vite 5  
**Backend:** Supabase (PostgreSQL + Auth + REST)  
**Hosting:** Vercel (SPA)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Setup](#2-setup)
3. [Architecture](#3-architecture)
4. [Database Schema](#4-database-schema)
5. [RLS Policies](#5-rls-policies)
6. [RPC Functions](#6-rpc-functions)
7. [User Roles & Permissions](#7-user-roles--permissions)
8. [Feature Flows](#8-feature-flows)
9. [Security Model](#9-security-model)
10. [Troubleshooting](#10-troubleshooting)
11. [Recent Changes](#11-recent-changes)

---

## 1. Overview

### 1.1 What it does

Each sewadar has a printed barcode badge. They scan it at their centre to mark IN/OUT attendance. The system automatically:

- Records IN and OUT times (like a punch clock)
- Detects cross-centre scans (shows as "Guest" with purple tag)
- Shows real-time dashboards for centre admins
- Generates reports (present lists, absenteeism, summaries)
- Tracks outstation duty (Jatha) assignments
- Provides ASO (Area Superintendent) overview with centre-wise breakdown

### 1.2 User Roles

| Role | Scan | Gate Entry | Delete Records | See All Centres | Manage Users |
|------|------|-----------|---------------|----------------|-------------|
| SUPER ADMIN | Yes | Yes | Any record | Yes | Yes |
| ASO | No | No | No | Yes (read-only) | No |
| ADMIN | Yes | Yes | Current month, own centre | Own + children | No |
| CENTRE_USER | Yes | Yes | Current month, own centre | Own + children | No |
| SC_SP_USER | Yes | No | No | Own + children | No |

### 1.3 Key Features

- **Barcode scanning** via device camera (offline-capable detection)
- **Manual entry** (keyboard search + time selection)
- **Forgot-out detection** — open sessions >12 hours old prompt for departure time
- **Geofencing** — centre-level GPS radius enforcement (configurable per centre)
- **Gate Entry** — bulk attendance marking with CSV-like batch input
- **Jatha Entry** — outstation duty assignment with date ranges
- **Jatha Records** — dedicated tab with card/table views and type filters (BEAS, Major Centre, Jatha Home)
- **ASO Reports** — centre hierarchy tree with badge status counts (Total/Permanent/Open/Elderly), Export + Summary CSV
- **Attendance Reports** — Present, Absent, Currently Inside, Late Coming, Summary (gate + weekly), Centre-wise
- **Real-time updates** via Supabase Realtime subscriptions
- **Cross-centre scanning** — ADMIN/SUPER_ADMIN can scan sewadars from any centre
- **Audit logging** — all scan IN/OUT, manual entry, record delete actions logged

---

## 2. Setup

### 2.1 Prerequisites

- Node.js 18+
- Supabase project (free tier)
- Git

### 2.2 Installation

```bash
git clone <repo-url>
cd sewadar-attendance
npm install
```

### 2.3 Environment

```env
VITE_SUPABASE_URL=https://lnznhbwgkusgdcmvgznf.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxuem5oYndna3VzZ2RjbXZnem5mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzMzYxODcsImV4cCI6MjA5MTkxMjE4N30.75OQyMgsbj04a9PtheTzndnJEDd-Q_5TVlcScq6tTYw
```

Both values from Supabase Dashboard → Project Settings → API.

### 2.4 Database Setup

1. Run `sql/rls_policies_all.sql` in Supabase SQL Editor
2. Run `sql/enable_geo.sql` to seed geo-coordinates for all 41 centres
3. Deploy edge function: `npx supabase functions deploy create-auth-user`
4. Set env var `INTERNAL_SECRET` in Supabase Dashboard → Edge Functions → create-auth-user

**Note:** Two RPC functions (`get_open_session`, `close_session`) exist only in the live database. Extract them before deploying to a new project:
```sql
-- Get these from your existing Supabase DB's SQL editor
CREATE OR REPLACE FUNCTION public.get_open_session(p_badge TEXT) ...
CREATE OR REPLACE FUNCTION public.close_session(p_session_id BIGINT, p_out_date DATE, ...) ...
```

### 2.5 Running Locally

```bash
npm run dev
```

Runs at `http://localhost:5173` (HTTPS required for camera — use `--host`).

### 2.6 Building

```bash
npm run build   # Outputs to dist/
npm run preview # Preview build
```

### 2.7 Deploy

Connect to Vercel:
- Framework: Vite
- Build: `npm run build`
- Output: `dist`
- Environment: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

---

## 3. Architecture

### 3.1 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, react-router-dom 6 |
| Build | Vite 5 |
| Icons | lucide-react |
| Barcode | @undecaf/barcode-detector-polyfill (shape-based, offline) |
| Backend | Supabase PostgreSQL, Auth, REST, Realtime |
| Edge Functions | Supabase Edge Functions (Deno) |
| Hosting | Vercel (SPA rewrites in vercel.json) |

### 3.2 Frontend Structure

```
src/
├── main.jsx                        # Entry → renders App
├── App.jsx                         # Router, auth gate, bottom nav
├── index.css                       # All styles (~2200 lines)
├── context/
│   └── AuthContext.jsx             # Auth: login, logout, profile, permissions
├── lib/
│   ├── supabase.js                 # Client, ROLES, DUTY_TYPES, helpers
│   └── logger.js                   # Fire-and-forget audit logging
├── components/
│   ├── Toast.jsx                   # Toast notification system
│   └── scanner/
│       └── BarcodeScanner.jsx      # Camera + barcode detection engine
└── pages/
    ├── LoginPage.jsx               # Email/password login
    ├── ScannerPage.jsx             # Barcode scan + manual entry + forgot-out
    ├── RecordsPage.jsx             # Gate + Jatha records, filters, card/table
    ├── DashboardPage.jsx           # Live stats: eligible, present, centre tree
    ├── ProfilePage.jsx             # User profile, logout
    ├── AttendanceEntryPage.jsx     # Gate Entry (bulk) + Jatha Entry
    ├── ReportsPage.jsx             # Reports: present, absent, ASO overview
    └── SuperAdminPage.jsx          # CRUD: centres, users, roles, jatha_master
```

### 3.3 Route Map

| URL | Page | Access |
|-----|------|--------|
| `/` | Dashboard | allow_dashboard permission |
| `/scan` | Scanner | allow_scan permission |
| `/records` | Records | allow_records permission |
| `/entry` | Attendance Entry | allow_gate_entry permission |
| `/profile` | Profile | Always |
| `/reports` | Reports | allow_reports permission |
| `/superadmin` | ASO Panel | allow_settings permission (super_admin only) |
| `*` | Redirect to `/` | Fallback |

Unauthenticated users see `<LoginPage />` directly (no navigation). Bottom nav items are filtered by permissions; ASO nav item only for super_admin.

### 3.4 Scan Data Flow

```
1. User opens Scanner → camera activates via BarcodeScanner component
2. Camera detects barcode → extracts badge_number
3. Guard checks (sequential):
   a. Popup not already showing
   b. Debounce — same badge not scanned within 2 seconds
   c. User has a centre assigned
   d. Scope data loaded (child centres + special departments)
4. supabase.rpc('get_sewadar_by_badge', { p_badge }) — bypasses RLS
5. Guard: isInScope() — centre own/child/special-dept?
6. Geo-fence check (non-ASO only) — GPS distance > radius = hard block
7. Record scan in lastScanRef (debounce)
8. supabase.rpc('get_open_session', { p_badge }) — check for open session
9. If OPEN found:
   → Calculate hours since IN (using both in_date + in_time)
   → If > 12 hours → forgot-out prompt (user enters departure time)
   → Else → show OUT button
10. If no OPEN → show IN button
11. User taps button → INSERT (IN) or RPC close_session (OUT)
12. Success popup → setTimeout auto-close, fetchRecentScans()
```

---

## 4. Database Schema

### 4.1 Tables

#### `sewadars` (~14,000 rows)
| Column | Type | Notes |
|--------|------|-------|
| badge_number | TEXT | NOT indexed, no UNIQUE constraint |
| sewadar_name | TEXT | |
| father_husband_name | TEXT | |
| gender | VARCHAR | CHECK: Male/Female/MALE/FEMALE |
| badge_status | TEXT | CHECK: PERMANENT/OPEN/ELDERLY |
| centre | TEXT | Home centre |
| department | TEXT | |
| is_initiated | BOOLEAN | |
| age | TEXT | |
| print_status | TEXT | NOT_PRINTED/... |
| form_status | TEXT | NOT_SUBMITTED/... |
| created_at | TIMESTAMPTZ | |

#### `attendance_sessions`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL | PK |
| badge_number | TEXT | No FK to sewadars |
| sewadar_name | TEXT | |
| centre | TEXT | Scan centre (not home) |
| duty_type | TEXT | CHECK: SATSCAN/DAILY/NIGHT/WATCH_AND_WARD/JATHA |
| status | TEXT | OPEN/CLOSED |
| in_date | DATE | |
| in_time | TIME | |
| in_scanner_badge | TEXT | Who scanned them IN |
| in_scanner_name | TEXT | |
| in_scanner_centre | TEXT | |
| out_date | DATE | |
| out_time | TIME | |
| out_scanner_badge | TEXT | Who scanned them OUT |
| out_scanner_name | TEXT | |
| out_scanner_centre | TEXT | |
| is_manual | BOOLEAN | True if manual entry |
| entered_by_badge | TEXT | |
| entered_by_name | TEXT | |
| is_gate_entry | BOOLEAN | True if bulk entry |
| is_jatha_entry | BOOLEAN | True if jatha entry |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

#### `centres` (41 rows)
| Column | Type | Notes |
|--------|------|-------|
| name | TEXT | UNIQUE |
| parent_centre | TEXT | FK → centres(name), nullable (root centres) |
| is_active | BOOLEAN | |
| latitude | DECIMAL | For geofencing |
| longitude | DECIMAL | |
| geo_radius | INTEGER | Default 200 (metres) |
| geo_enabled | BOOLEAN | Default true |

#### `users`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL | PK |
| auth_id | UUID | FK → auth.users(id), UNIQUE |
| email | TEXT | UNIQUE |
| name | TEXT | |
| badge_number | TEXT | |
| role | TEXT | CHECK: super_admin/aso/admin/centre_user/sc_sp_user |
| centre | TEXT | |
| is_active | BOOLEAN | |
| permissions | JSONB | |
| temp_password | TEXT | |
| created_at | TIMESTAMPTZ | |

#### `jatha_master`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL | PK |
| jatha_type | TEXT | CHECK: beas/major_centre/jatha_home |
| centre_name | TEXT | Destination centre |
| department | TEXT | |
| is_active | BOOLEAN | |

#### `jatha_attendance`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL | PK |
| jatha_id | BIGINT | FK → jatha_master(id) |
| badge_number | TEXT | |
| sewadar_name | TEXT | |
| from_date | DATE | |
| to_date | DATE | |
| entered_by_badge | TEXT | |
| entered_by_name | TEXT | |
| entered_at | TIMESTAMPTZ | |
| remarks | TEXT | |

#### `logs`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGINT | GENERATED ALWAYS AS IDENTITY |
| user_badge | TEXT | |
| user_name | TEXT | |
| action | TEXT | |
| details | TEXT | JSON string |
| timestamp | TIMESTAMPTZ | |

#### `role_masters`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL | PK |
| role_key | TEXT | UNIQUE (e.g., super_admin, centre_user) |
| role_label | TEXT | Display name |
| role_description | TEXT | |
| permissions | JSONB | |
| is_active | BOOLEAN | |

#### `special_departments`
| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL | PK |
| department_name | TEXT | UNIQUE (ADMINISTRATION, PATHI, OFFICE, etc.) |
| created_at | TIMESTAMPTZ | |

### 4.2 Centre Hierarchy

18 parent centres with 24 sub-centres. Tree built via `parent_centre` FK referencing `centres(name)`. Recursive CTE in `get_user_accessible_centres()` uses `CYCLE` clause (PostgreSQL 14+) for cycle-safe traversal.

**Parent centres:** ANKHEER, BALLABGARH, MACHHGAR, BAROLI, DLF CITY GURGAON, ABHEYPUR, NUH, PUNAHANA, SOHNA, FIROZPUR JHIRKA, GURGAON, BADHA SIKENDERPUR, BILASPUR, BUDHERA, DUNDAHERA, FARUKH NAGAR, JATAULA, KASAN, PATAUDI, HODAL, MOHANA, FATEHPUR BILLOCH, NANGLA GUJRAN, NIT - 2, PALWAL, BAHIN, HASANPUR, HATHIN, MANDKOLA, NAYAGAON, SIHA, PRITHLA, RAJENDRA PARK, SECTOR-15-A, DHATIR, GREATER FARIDABAD, SURAJ KUND, TAORU, TIGAON, NACHAULI, ZAIBABAD KHERLI

### 4.3 Badge Status Values

| Status | Eligible? | Meaning |
|--------|-----------|---------|
| PERMANENT | Yes | Regular permanent sewadar |
| OPEN | Yes | Open/temporary sewadar |
| ELDERLY | No | Excluded from eligible total, can still scan |

### 4.4 Duty Types

| Type | Auto-detect |
|------|-------------|
| SATSCAN | Sunday (0) or Wednesday (3) |
| DAILY | All other days |
| NIGHT | Manual override |
| WATCH_AND_WARD | Manual override |
| JATHA | Manual override |

---

## 5. RLS Policies

All tables have Row Level Security enabled. Helper functions determine access:

### Helper Functions

| Function | Type | Purpose |
|----------|------|---------|
| `get_user_role()` | SECURITY DEFINER | Returns current user's role |
| `get_user_accessible_centres()` | SECURITY DEFINER | Recursive CTE with CYCLE detection — returns own centre + children (or ALL for super_admin/aso) |
| `get_sewadar_by_badge(p_badge)` | SECURITY DEFINER | Bypasses RLS for scanner badge lookup |
| `get_sewadar_details(p_badge_numbers[])` | SECURITY DEFINER | Returns centre + department for records display |
| `get_sewadar_centres(p_badge_numbers[])` | SECURITY DEFINER | Returns centre for cross-scan detection |
| `search_sewadars_all(p_term)` | SECURITY DEFINER | Cross-centre search with 3-char minimum guard |

### Policy Summary

| Table | SELECT | INSERT/UPDATE/DELETE |
|-------|--------|---------------------|
| `sewadars` | Own centre + children | super_admin OR admin/centre_user for their centre |
| `attendance_sessions` | Centre accessible OR sewadar from accessible centre | INSERT: super_admin OR centre in accessible centres. UPDATE/DELETE: super_admin OR admin/centre_user for their centre |
| `centres` | All authenticated | super_admin only |
| `users` | Own row (auth_id = uid) OR super_admin | super_admin only |
| `jatha_master` | All authenticated | super_admin only |
| `jatha_attendance` | Sewadar's centre in accessible centres | super_admin OR admin/centre_user for their sewadars |
| `logs` | aso + super_admin only | INSERT: all authenticated (WITH CHECK true) |
| `role_masters` | All authenticated | super_admin only |
| `special_departments` | All authenticated | super_admin only |

---

## 6. RPC Functions

Called from frontend via `supabase.rpc()`:

| Function | Defined in Repo? | Purpose |
|----------|-----------------|---------|
| `get_user_accessible_centres()` | ✅ `rls_policies_all.sql:174` | Returns TABLE(centre_name) — recursive CTE of own centre + children (or all for super_admin/aso) |
| `get_sewadar_by_badge(p_badge TEXT)` | ✅ `rls_policies_all.sql:93` | Returns full sewadar record, bypasses RLS |
| `search_sewadars_all(p_term TEXT)` | ✅ `rls_policies_all.sql:111` | Searches all sewadars by name/badge, 3-char minimum, bypasses RLS |
| `get_sewadar_details(p_badge_numbers TEXT[])` | ✅ `rls_policies_all.sql:77` | Returns centre + department for records page |
| `get_open_session(p_badge TEXT)` | ❌ DB only | Returns current OPEN session for a badge |
| `close_session(p_session_id, ...)` | ❌ DB only | Updates session with OUT data, closes it |

**Important:** `get_open_session` and `close_session` are called from ScannerPage but are NOT in `sql/rls_policies_all.sql`. On a fresh deploy, extract these from the existing Supabase database.

---

## 7. User Roles & Permissions

### 7.1 Permission System

Each user has a `permissions` JSONB column with boolean flags. Super admin bypasses all checks.

Available permission keys:
- `allow_dashboard` — View dashboard
- `allow_records` — View records
- `allow_scan` — Use scanner
- `allow_gate_entry` — Use Gate Entry page
- `allow_jatha` — Use Jatha Entry
- `allow_reports` — View reports
- `allow_settings` — Access ASO panel

### 7.2 Role Defaults

| Role | Default Permissions |
|------|-------------------|
| super_admin | All permissions (bypassed at code level) |
| aso | dashboard, records, reports (read-only) |
| admin | Depends on role_masters config |
| centre_user | Depends on role_masters config |
| sc_sp_user | Depends on role_masters config |

The `role_masters` table defines base permissions per role. When editing a user, selecting a role auto-fills permissions from the role master. Super admin can override individual user permissions.

### 7.3 ASO Panel

Accessible only to super_admin (settings gear icon in bottom nav). Manages:
- **Centres** — CRUD, geo-coordinates, parent-child hierarchy
- **Users** — CRUD, creates auth accounts via edge function (`create-auth-user`)
- **Roles** — CRUD, defines permission templates
- **Jatha Master** — CRUD, outstation duty destinations
- **Special Departments** — CRUD, departments that bypass centre scope
- **Logs** — Read-only audit trail

Edge function `create-auth-user` verifies the caller is super_admin via JWT + service-role lookup. Requires `INTERNAL_SECRET` env var set.

---

## 8. Feature Flows

### 8.1 Scanner (IN/OUT)

- Camera-based barcode detection with manual fallback
- Guards: popup lock, debounce (2s), centre check, scope load, geo-fence
- Open session check → IN or OUT or FORGOT_OUT (>12h)
- Close popup auto-dismisses after 1.5s
- Recent scans panel below scanner
- Manual entry: search → select → set time → mark IN/OUT

### 8.2 Forgot-Out Detection

If an OPEN session's IN time is >12 hours ago (calculated using actual `in_time`, not hardcoded noon):
1. Scanner shows "Previous Session Still Open" with IN date/time
2. User enters departure date + time
3. Taps "Close Session" → `close_session` RPC with entered times

### 8.3 Geofencing

Two-tier:
1. **Page load** — initial GPS check, blocks entire scanner if out of range
2. **Per scan** — re-checks GPS, shows out_of_range popup

Both are hard blocks — no override option. Only non-ASO users are checked.

### 8.4 Gate Entry (Bulk)

- Search sewadar → select → add to batch list
- Each entry: set IN/OUT date/time, validate OUT > IN
- "Allow other centres" checkbox uses `search_sewadars_all` RPC
- Submits batch as individual INSERTs
- Validates no overlapping sessions within the batch

### 8.5 Jatha Entry

- Select destination from jatha_master list
- Add sewadars (search + select)
- Set date range (max 10 days, validated)
- Submits batch INSERT into jatha_attendance
- Uses separate fetch + submit from Gate Entry
- Overlap detection: validates no jatha-vs-jatha overlap (across ALL jathas, not just same jatha) and no jatha-vs-session overlap

### 8.6 Records (Gate + Jatha)

**Gate tab:**
- Filters: date range, centre, duty type, search
- Card view (default) or Table view
- Sort by IN date, duration
- Delete button: super_admin + admin only; non-super_admin blocked from previous months
- CSV export with proper escaping

**Jatha tab:**
- Filter pills: All, BEAS, Major Centre, Jatha Home (with counts)
- Card view: shows jatha type pill (purple/green/amber), destination, department, date range, days duration
- Table view: same columns in grid
- Delete button: admin/super_admin only

### 8.7 Dashboard

- Date picker (default: today)
- Stats cards: Total Eligible, Present Today, Currently Inside, % bars
- Department-wise stats table
- Gender split (Male/Female) with present/inside/permanent/open counts
- Centre tree (collapsible) with badges, guests
- CSV export with proper field escaping
- Race-condition protected with fetchTickRef

### 8.8 Reports

**Gate Reports:**
- Present List — sewadars marked IN today (with filters)
- Absent List — eligible sewadars not marked IN
- Currently Inside — sewadars with OPEN status
- Late Coming — based on configurable late threshold
- Gate Summary — counts per centre
- Weekly Summary — aggregated by week

**Jatha Reports:**
- Active Jathas — currently active assignments
- Past Jathas — historical assignments
- All Jathas — combined view
- Jatha Summary — aggregated counts

**ASO Reports:**
- Overview — centre hierarchy tree with Total/Permanent/Open/Elderly counts per centre (collapsible)
- Export button — detailed CSV with Centre + Sub Centre columns
- Summary button — merged CSV with parent-centre-only counts

### 8.9 Audit Logging

All important actions logged to `logs` table (fire-and-forget via logger.js):
- SCAN_IN, SCAN_OUT, FORGOT_OUT
- MANUAL_IN, MANUAL_OUT
- RECORD_DELETE
- USER_CREATED, ADMIN_ADD, ADMIN_EDIT
- ROLE_CASCADE

Logs viewable in ASO Panel (read-only, super_admin/aso only).

---

## 9. Security Model

### 9.1 Layered Security

1. **Supabase Auth** — email/password authentication, JWT-based sessions
2. **Row Level Security** — every table has RLS policies checking role + centre
3. **SECURITY DEFINER functions** — narrow bypasses for scanner/search with `SET search_path = ''`
4. **Frontend permission gating** — routes and nav items filtered by `hasPermission()`
5. **Edge function auth** — `create-auth-user` verifies caller's JWT + super_admin role via service-role client

### 9.2 Known Security Notes

- `logs` table INSERT has `WITH CHECK (true)` — any authenticated user can insert audit entries
- `sessions_insert` policy doesn't restrict by role — SC_SP user could technically INSERT via API (frontend-gated only)
- No request timeouts on Supabase queries — can hang on slow networks

### 9.3 Edge Function: create-auth-user

- Located at `supabase/functions/create-auth-user/index.ts`
- Verified by: JWT decode + service-role `users` table lookup
- Creates Supabase Auth account with `email_confirm: true`
- On profile creation failure, rolls back by deleting the auth user
- Requires `INTERNAL_SECRET` env var set (checked server-side)
- Accepts `x-internal-secret` header in CORS (not validated)

---

## 10. Troubleshooting

### 10.1 Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Scanner shows "Not Found" | RPC get_sewadar_by_badge missing or RLS blocking | Run `rls_policies_all.sql` |
| Scanner stuck on "Checking location..." | Geolocation permission denied or timeout | Check browser location permissions |
| "Cannot delete previous month" | Record from prior month, user not super_admin | Only super_admin can delete old records |
| Duration "Invalid" on records | OUT before IN on same date | Fix the data entry |
| Gate Entry "No results" with Allow Other Centres | `search_sewadars_all` RPC not deployed | Create the RPC function |
| Login fails with 400 | `users` table query failing | Check `select()` columns match table schema |
| "new row violates RLS policy" on jatha_attendance | User has `permissions = NULL` (new user created without role cascading) | Run `rls_policies_all.sql` — triggers `trg_set_user_permissions` + one-time fix. Also verify `role_masters` has `"allow_jatha": true` for admin/centre_user roles |

### 10.2 Known Issues

1. **Offline mode**: No scan queueing. Scans dropped silently when offline.
2. **No photo capture**: Sewadar photos not implemented.
3. **No batch operations**: Cannot delete/export multiple records at once.
4. **No session timeout**: No auto-logout after inactivity.
5. **get_open_session/close_session not in repo SQL**: Must be extracted from live DB for fresh deploys.
6. **Centre geo-coordinates**: Latitude/longitude for 41 centres were defined in `sql/enable_geo.sql` (removed). Coordinates are already stored in the DB. If re-seeding is needed, extract from the `centres` table.
7. **RLS policy severity**: `has_permission()` functions are SECURITY DEFINER — if they fail or return NULL, access is silently denied. Always test with a non-super_admin account after deploying role changes.

---

## 11. Recent Changes

| Date | Change | Details |
|------|--------|---------|
| May 2026 | Debug log removal | Removed ~25 console.log statements from ScannerPage and AttendanceEntryPage that leaked badge numbers and session data |
| May 2026 | users_read policy tightened | Changed from `USING (true)` to `auth_id = auth.uid() OR super_admin` — users now see only their own row |
| May 2026 | Forgot-out timing fix | `hoursSinceIn` now uses actual `in_time` instead of hardcoded noon — was falsely triggering forgot-out on recent scans |
| May 2026 | handleDelete stale closure fix | RecordsPage delete now uses fetchRecordsRef pattern instead of direct function reference |
| May 2026 | Dashboard race condition fix | Added fetchTickRef with isLatest() guard to prevent stale responses from overwriting newer ones |
| May 2026 | CSV export escaping | DashboardPage now escapes commas, quotes, and newlines in CSV export |
| May 2026 | Blob URL cleanup | URL.revokeObjectURL called after download in RecordsPage and ReportsPage |
| May 2026 | SuperAdminPage simplified | Removed flawed RPC fallback from user update handler |
| May 2026 | Unhandled promise rejections fixed | Added `.catch(() => {})` to 4 fire-and-forget Supabase queries |
| May 2026 | RLS cycle detection | Added `CYCLE name SET is_cycle USING path` to recursive CTE preventing infinite loops |
| May 2026 | Search guard added | `search_sewadars_all` now rejects terms < 3 characters |
| May 2026 | ASO Reports shipped | Centre hierarchy tree with collapsible nodes, stat pills, Export + Summary CSV buttons |
| May 2026 | Delete permission restricted | Frontend delete button hidden for centre_user (RLS still allows, frontend-gated) |
| May 2026 | Logger fire-and-forget | logAction no longer awaited in callers; internal error handling via .catch() |
| May 2026 | AuthContext cleanup | select('*') → explicit columns; signOut only resets state on success |
| May 2026 | Scanner page refactored | lastScanRef moved after all guard checks; removed dead Debug Supabase queries from manual OUT path |
| May 2026 | App.jsx login routing | Reverted from Navigate-based redirect to inline render (Navigate broke login page) |
| Jun 2026 | Auto-Set User Permissions | Added `trg_set_user_permissions` — BEFORE INSERT ON users copies permissions from role_masters. Extended cascade trigger to INSERT (not just UPDATE) of role_masters. One-time fix for existing NULL permissions. Fixes: new users had `permissions = NULL` causing "new row violates RLS policy" on jatha_attendance writes. Source: `sql/rls_policies_all.sql`. |
| Jun 2026 | Recursive Centre Scoping in Frontend | All pages switched from `eq('parent_centre', ...)` to `supabase.rpc('get_user_accessible_centres')`. Covers grandchild centres (recursive CTE), not just direct children. Affected: ScannerPage, AttendanceEntryPage (Gate+Jatha), RecordsPage, DashboardPage. |
| Jun 2026 | `get_user_accessible_centres()` return type | Changed from `SETOF TEXT` to `TABLE(centre_name TEXT)` so PostgREST returns `{"centre_name":"..."}` instead of `{"get_user_accessible_centres":"..."}`. Frontend callers map `.centre_name`. Also fixed unaliased column references in recursive CTE. |
| Jun 2026 | RecordsPage simplified | Removed manual centre-scoped session fetch + cross-centre query. RLS on `attendance_sessions` handles scoping automatically. Centre filter defaults to empty (All Centres). |
| Jun 2026 | Jatha-vs-Jatha overlap detection | `check_jatha_overlap()` trigger now prevents jatha-vs-jatha overlap (not just jatha-vs-session). Frontend `checkForDuplicates()` checks across ALL jathas (not just same `jatha_id`) and shows destination centre in error message. |
