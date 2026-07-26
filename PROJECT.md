# Sewadar Attendance

Attendance scanning app for Gurdwara sewadars (badge scanning IN/OUT, jatha group attendance, reports, dashboards, schedules).

## Tech Stack

- **Frontend:** React 18 + Vite 5 + React Router v6
- **Backend:** Supabase (PostgreSQL, Auth, RLS, Edge Functions)
- **Auth:** Supabase Auth with custom roles: super_admin, aso, admin, centre_user, sc_sp_user
- **Icons:** Lucide React
- **Export:** xlsx (Excel), PDF via browser print
- **Scanner:** @undecaf/barcode-detector-polyfill (camera barcode scanning)

## Project Structure

```
src/
├── main.jsx                          # Entry point, ErrorBoundary
├── App.jsx                           # Router, nav layout, offline banner, role guards, bottom nav
├── index.css                         # Theme & component styles (~1000 lines)
├── context/
│   └── AuthContext.jsx               # Auth state, profile, permissions, signIn/signOut
├── lib/
│   ├── supabase.js                   # Supabase client, ROLES enum, helper functions
│   ├── logger.js                     # Action audit logging (inserts to logs table)
│   └── deptColors.js                 # Department color/abbreviation maps
├── components/
│   ├── Toast.jsx                     # Toast notification context/provider
│   ├── scanner/BarcodeScanner.jsx    # Camera scanner with device profiling, resolution chaining
│   └── reports/CentreMonthlyPlanner.jsx  # Monthly calendar schedule planner
└── pages/
    ├── LoginPage.jsx                 # Email/password login
    ├── DashboardPage.jsx             # Stats, attendance summary, centre splits, session counts
    ├── ScannerPage.jsx               # Badge IN/OUT scanning, geofencing, manual entry, forgot-out
    ├── AttendanceEntryPage.jsx       # Gate entry form + Jatha entry, overlap detection, Excel export
    ├── RecordsPage.jsx               # Attendance records with filters, edit/delete, export
    ├── ReportsPage.jsx               # Present/Absent/Inside/Late/ASO reports + downloads
    ├── SchedulesPage.jsx             # Thin wrapper → ScheduleManager
    ├── ProfilePage.jsx               # User profile & sign out
    ├── SuperAdminPage.jsx            # CRUD for centres, jathas, roles, users, sewadars, logs
    └── reports/ScheduleManager.jsx   # Multi-centre monthly schedule grid with drag-to-assign

supabase/functions/
├── create-auth-user/index.ts         # Edge fn: creates Supabase Auth users
├── sync-to-sheets/index.ts           # Edge fn: syncs DB changes to Google Sheets
└── monthly-archive/index.ts          # Edge fn: archives monthly data to Sheets

sql/
└── rls_policies_all.sql              # RLS policies, functions, triggers, indexes (~1400 lines)
```

## Database Tables

| Table | Purpose |
|---|---|
| `sewadars` | Badge_number (PK), name, centre, department, badge_status, gender |
| `attendance_sessions` | IN/OUT scans with denormalized sewadar_centre/dept |
| `jatha_attendance` | Jatha group attendance with denormalized sewadar_centre |
| `jatha_master` | Jatha definitions (destination, department, type) |
| `centres` | Gurdwara locations with parent hierarchy, geofencing coords |
| `users` | App users with role, centre, JSONB permissions |
| `role_masters` | Role definitions with JSONB permissions |
| `settings` | Key-value store (lock_date) |
| `special_departments` | Cross-centre scanning departments |
| `logs` | Action audit trail |

## Key Features

- **Barcode Scanning** — Camera-based with native + WASM fallback, sliding-window confirmation, quality gating
- **Geofencing** — Optional per-centre GPS radius check for scanning
- **Gate Entry** — Multi-day attendance entry with overlap detection
- **Jatha Entry** — Group travel attendance with duplicate/overlap checks
- **Schedules** — Bhati (weekly repeat) + Specific (date-range) schedules with distribution to child centres
- **Monthly Planner** — Calendar view of scheduled duties
- **Reports** — Present/Absent/Late/Inside + CSV export + ASO overview
- **RLS** — Full row-level security with role hierarchy + centre scoping + date locking
- **Super Admin Panel** — CRUD for all tables: centres, jathas, roles, users, sewadars, departments, logs, settings

## Security Model

Roles: `super_admin` > `admin` > `centre_user` > `sc_sp_user` (+ `aso` for read-only)
- Users are scoped to one centre (except super_admin/aso)
- RLS policies filter by user's centre and role
- `lock_date` in settings blocks edits to past attendance records
- Special departments allow cross-centre scanning
