# Sewadar Attendance

Attendance scanning app for Gurdwara sewadars. Users scan badges (QR/barcode) to mark IN/OUT, manage jatha group attendance, view records/dashboards.

## Tech Stack

- **Frontend**: React 18, Vite 5, React Router v6, Lucide React icons
- **Backend**: Supabase (PostgreSQL 15, Auth, RLS, Edge Functions)
- **Auth**: Supabase Auth with custom roles
- **Hosting**: Vercel (SPA with fallback)

## Project Structure

| Path | Purpose |
|---|---|
| `src/lib/supabase.js` | Supabase client init |
| `src/context/AuthContext.jsx` | Auth provider, permissions |
| `src/App.jsx` | Routes, nav items, route guards |
| `src/pages/ScannerPage.jsx` | Barcode scanning IN/OUT, manual entry |
| `src/pages/AttendanceEntryPage.jsx` | Gate entry + Jatha entry forms |
| `src/pages/SuperAdminPage.jsx` | ASO Panel: Settings, CRUD tables |
| `src/pages/RecordsPage.jsx` | Session & jatha records with filters |
| `src/pages/DashboardPage.jsx` | Dashboard stats |
| `src/pages/LoginPage.jsx` | Login |
| `src/pages/ReportsPage.jsx` | Reports & CSV downloads |
| `src/pages/ProfilePage.jsx` | User profile |
| `src/index.css` | CSS custom properties (theme) |
| `sql/rls_policies_all.sql` | All database logic (run to deploy) |
| `supabase/functions/create-auth-user/index.ts` | Edge function for auth users |

## Database

- `users` — App users with roles, centre, permissions
- `sewadars` — Sewadar records (badge_number PK)
- `attendance_sessions` — IN/OUT scan records
- `jatha_attendance` — Jatha group attendance
- `jatha_master` — Jatha definitions
- `centres` — Gurdwara locations
- `role_masters` — Role definitions with JSONB permissions
- `settings` — Key-value store (lock_date)
- `special_departments` — Special department definitions
- `logs` — Action audit trail

## Permissions

Roles: `super_admin > admin > centre_user > aso > sc_sp_user > centre_user_level2`

Key permissions: `allow_scan`, `allow_gate_entry`, `allow_jatha`, `allow_records`, `allow_dashboard`, `allow_reports`, `allow_settings`, `allow_view_logs`.

- Super Admin bypasses all restrictions (RLS, lock date)
- Centre scoping via `get_user_accessible_centres()` RPC
- `allow_settings` is super_admin only

## Deployment

1. Run `sql/rls_policies_all.sql` in Supabase SQL Editor
2. `npm run build` → deploy `dist/` to Vercel
3. Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
4. Edge Function env: `INTERNAL_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`
