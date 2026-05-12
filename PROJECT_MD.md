# Sewadar Attendance System — Complete Documentation

> **Version:** 2.2  
> **Created:** April 2026  
> **Last Updated:** May 2026  
> **Supabase Project:** https://lnznhbwgkusgdcmvgznf.supabase.co  
> **Frontend:** React + Vite  
> **Backend:** Supabase (PostgreSQL + Auth)

---

## Table of Contents

1. [Beginner Guide](#1-beginner-guide)
2. [Developer Setup](#2-developer-setup)
3. [Architecture](#3-architecture)
4. [Database](#4-database)
5. [Attendance Logic](#5-attendance-logic)
6. [Security Model](#6-security-model)
7. [User Roles](#7-user-roles)
8. [Troubleshooting](#8-troubleshooting)
9. [Test Users](#9-test-users)

---

## 1. Beginner Guide

### 1.1 What is this app?

A mobile-friendly web app for tracking attendance of **sewadars (volunteers)** across **41 satsang centres** in Haryana, UP, and Delhi. Each sewadar has a printed **barcode badge**. They scan it at their centre to mark attendance (IN/OUT).

The system automatically:
- Records when someone arrives (IN) and leaves (OUT) — like a punch clock
- Detects who scanned at a **different centre** than their home (shown as "Guest")
- Shows real-time dashboards for centre admins
- Generates reports for ASO (Area Superintendent)

### 1.2 Quick Start

**For Centre Admins / Users:**

1. **Login** — Open the app URL, enter your email and password
2. **Scan** — Tap the **Scan** tab, point camera at a sewadar's barcode badge. The scanner will show IN or OUT based on their current status
3. **Manual Entry** — If barcode doesn't scan, tap the search icon in Scanner to find a sewadar by name/badge number
4. **Gate Entry** — Tap **Entry** tab to mark multiple sewadars at once (useful at gate during satsang)
5. **Records** — Tap **Records** tab to see attendance. Use filters (date range, centre, duty type) to narrow down. Switch between Card and Table view
6. **Dashboard** — See live stats: total eligible sewadars, present count, currently inside, centre-wise breakdown
7. **Jatha Records** — Use the Jatha tab in Records page to see sewadars assigned to outstation duty

**Important Notes:**
- You can only scan sewadars from your own centre + sub-centres (except special departments like ADMINISTRATION, PATHI, OFFICE — they can scan anywhere)
- Records from **previous months** cannot be deleted (only Super Admin can)
- If someone forgot to mark OUT, the scanner will detect it after 12 hours and prompt you
- When a sewadar from another centre is scanned, a purple **"Guest from X"** tag appears

### 1.3 User Roles & What You Can Do

| Role | Can Scan | Can Add Entries | Can Delete | Can See All Centres | Can Manage Users |
|------|----------|----------------|------------|-------------------|-----------------|
| SUPER ADMIN | ✓ | ✓ | ✓ (any record) | ✓ | ✓ |
| ASO | Read-only | ✗ | ✗ | ✓ | ✗ |
| Admin / Centre User | ✓ | ✓ | ✓ (current month only, own centre) | Own centre + children | ✗ |
| SC/SP User | ✓ | ✗ | ✗ | Own centre + children | ✗ |

---

## 2. Developer Setup

### 2.1 Prerequisites

- Node.js 18+
- A Supabase project (free tier works)
- Git

### 2.2 Installation

```bash
git clone <repo-url>
cd sewadar-attendance
npm install
```

### 2.3 Environment Variables

Create a `.env` file:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Both values are in your Supabase Dashboard → **Project Settings → API**.

### 2.4 Database Setup

Run these SQL files in **Supabase SQL Editor** in order:

1. `sql/rls_policies_all.sql` — Creates all tables' RLS policies + all helper functions. This is the **canonical RLS file** — source of truth for all security policies
2. `supabase/setup_user_auth.sql` — Sets up auth users (if starting fresh)

### 2.5 Running Locally

```bash
npm run dev
```

The app runs at `https://localhost:5173` (requires HTTPS for camera access).

### 2.6 Building for Production

```bash
npm run build   # Outputs to /dist/
npm run preview # Preview the build locally
```

### 2.7 Deploying to Vercel

The `vercel.json` config is already set up. Connect your repo to Vercel:
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Add environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`

---

## 3. Architecture

### 3.1 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend Framework | React 18 |
| Build Tool | Vite 5 |
| Routing | react-router-dom 6 |
| Icons | lucide-react |
| Backend | Supabase (PostgreSQL + Auth + REST API) |
| Barcode Scanner | `@undecaf/barcode-detector-polyfill` (shape-based detection, no network needed) |
| Hosting | Vercel (or any static host) |

### 3.2 Frontend Structure

```
src/
├── main.jsx                          # Entry point, renders App
├── App.jsx                           # Router, auth gate, bottom navigation
├── index.css                         # All styles (~2230 lines, organized by component)
│
├── context/
│   └── AuthContext.jsx               # Auth state (login, logout, profile, permissions)
│
├── lib/
│   ├── supabase.js                   # Supabase client, ROLES constants, helpers (formatDate, getLocalDate, etc.)
│   └── logger.js                     # Audit logging (INSERT into logs table)
│
├── components/
│   ├── Toast.jsx                     # Toast notification system
│   └── scanner/
│       └── BarcodeScanner.jsx        # Camera + barcode detection engine
│
└── pages/
    ├── LoginPage.jsx                 # Email/password login
    ├── ScannerPage.jsx               # Main scanner: barcode scan + manual entry + forgot-Out
    ├── RecordsPage.jsx               # Attendance records: gate + jatha, filters, card/table view
    ├── DashboardPage.jsx             # Live stats: eligible count, present, centre tree, gender split
    ├── ProfilePage.jsx               # User profile, logout
    ├── AttendanceEntryPage.jsx       # Gate Entry (bulk) + Jatha Entry (outstation duty)
    ├── ReportsPage.jsx               # Export reports, attendance summaries
    └── SuperAdminPage.jsx            # Super Admin: manage centres, users, jatha_master, special departments
```

### 3.3 Route Map

| URL | Page | Navigation |
|-----|------|-----------|
| `/` | Dashboard | Bottom nav tab |
| `/scan` | Scanner | Bottom nav tab |
| `/records` | Records | Bottom nav tab |
| `/entry` | Attendance Entry | Bottom nav tab |
| `/profile` | Profile | Bottom nav tab |
| `/reports` | Reports | Header nav or Profile dropdown |
| `/superadmin` | Super Admin | Profile dropdown (super_admin only) |
| `/login` | Login | Redirect when not authenticated |
| `*` | Redirect to / | Fallback |

### 3.4 How a Scan Works (Data Flow)

```
1. User opens Scanner page -> camera activates
2. Camera detects barcode -> extracts badge_number
3. Frontend calls supabase.rpc('get_sewadar_by_badge', { p_badge })
   -> Returns sewadar record (bypasses RLS via SECURITY DEFINER)
4. Frontend checks isInScope():
   - Is sewadar's centre in user's accessible centres?
   - OR is sewadar's department a special department (ADMINISTRATION, PATHI, etc.)?
5. If out of scope -> show "Not in Scope" error
6. Geofencing check (for non-ASO users): is user within their centre's geo-radius?
7. If geofence violated -> show warning but allow override
8. Frontend calls supabase.rpc('get_open_session', { p_badge })
   -> If OPEN session exists -> show OUT button
   -> If no OPEN session -> show IN button
   -> If OPEN session is >12 hours old -> show FORGOT OUT prompt
9. User taps IN/OUT/Forgot Out
10. For IN: INSERT new attendance_session row
11. For OUT: supabase.rpc('close_session', ...) updates the row
12. Realtime subscription refreshes Records/Dashboard
```

---

## 4. Database

### 4.1 Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `centres` | All 41 satsang centres | `name`, `parent_centre`, `latitude`, `longitude`, `geo_radius`, `geo_enabled` |
| `sewadars` | All registered volunteers (~14,000) | `badge_number` (PK), `sewadar_name`, `centre`, `department`, `badge_status` (PERMANENT/OPEN/ELDERLY), `gender` |
| `attendance_sessions` | Every IN/OUT scan record | `badge_number`, `status` (OPEN/CLOSED), `in_date`, `in_time`, `out_date`, `out_time`, `centre`, `duty_type`, `is_manual`, `is_gate_entry` |
| `users` | App login accounts | `email`, `role`, `centre`, `permissions` (JSON), `badge_number`, `name` |
| `jatha_master` | Outstation duty templates | `jatha_type` (beas/major_centre/jatha_home), `centre_name`, `department` |
| `jatha_attendance` | Sewadars assigned to jathas | `badge_number`, `jatha_id`, `from_date`, `to_date` |
| `special_departments` | Depts allowed to scan at any centre | `name` (ADMINISTRATION, PATHI, OFFICE, etc.) |
| `logs` | Audit trail for important actions | `action`, `details` (JSON), `created_at` |
| `role_masters` | Role configuration | `role_name`, `permissions` (JSON) |

### 4.2 Centre Hierarchy

Centres are organized in a **parent-child tree**:
- **18 parent centres** (e.g., SECTOR-15-A, SURAJ KUND, ANKHEER)
- **24 sub-centres / satsang points** (each has a `parent_centre` pointing to a parent)

A user assigned to a parent centre can see data for that centre AND all its children.
A user assigned to a sub-centre can only see their own centre.

### 4.3 Row Level Security (RLS)

**Key Design Principle:** Every table has RLS enabled. Policies use **helper functions** to determine access. The canonical RLS file is `sql/rls_policies_all.sql`.

**Helper Functions:**

| Function | Type | Purpose |
|----------|------|---------|
| `get_user_role()` | SECURITY DEFINER | Returns the current user's role from `users` table |
| `get_user_accessible_centres()` | SECURITY DEFINER | Returns own centre + children via recursive CTE. For super_admin/aso -> returns ALL centres |
| `get_sewadar_centres(p_badge_numbers TEXT[])` | SECURITY DEFINER | Returns (badge_number, centre) for given badges -- bypasses RLS for cross-scan detection |
| `get_sewadar_details(p_badge_numbers TEXT[])` | SECURITY DEFINER | Returns (badge_number, centre, department) -- used by Records page to show department/centre |
| `get_sewadar_by_badge(p_badge TEXT)` | SECURITY DEFINER | Returns full sewadar record by badge -- bypasses RLS so Scanner can look up ANY sewadar |
| `search_sewadars_all(p_term TEXT)` | SECURITY DEFINER | Searches ALL sewadars by name/badge -- bypasses RLS for Gate Entry "Allow other centres" |
| `get_open_session(p_badge TEXT)` | SECURITY DEFINER | Returns the current OPEN session for a badge -- bypasses RLS so any centre can check |

**Why SECURITY DEFINER?**
Normal RLS policies restrict what rows a user can SELECT/INSERT/UPDATE/DELETE. But sometimes the app needs to read data OUTSIDE the user's scope (e.g., a Centre Admin needs to detect that a sewadar from another centre scanned at their centre). SECURITY DEFINER functions run with the **privileges of the function owner** (super_admin), bypassing the caller's RLS restrictions.

**Policy Summary:**

| Table | Action | Who Can |
|-------|--------|---------|
| `sewadars` | SELECT | Own centre + children |
| `sewadars` | INSERT/UPDATE/DELETE | super_admin OR admin/centre_user for their centre |
| `attendance_sessions` | SELECT | Sessions at own centre + children OR sessions of sewadars from own centre/children |
| `attendance_sessions` | INSERT | All auth users (with centre in accessible centres) |
| `attendance_sessions` | UPDATE/DELETE | super_admin OR admin/centre_user for their centre |
| `jatha_master` | SELECT | All authenticated users |
| `jatha_master` | INSERT/UPDATE/DELETE | super_admin only |
| `jatha_attendance` | SELECT | Records where sewadar's centre is in accessible centres |
| `jatha_attendance` | INSERT/UPDATE/DELETE | super_admin OR admin/centre_user for their sewadars |
| `centres` | SELECT | All auth users |
| `centres` | INSERT/UPDATE/DELETE | super_admin only |
| `users` | SELECT | All auth users |
| `users` | INSERT/UPDATE/DELETE | super_admin only |
| `logs` | SELECT | super_admin and aso only |
| `logs` | INSERT | All auth users |

### 4.4 Badge Status Values

| Status | Meaning | Counts in Dashboard Eligible Total? |
|--------|---------|-------------------------------------|
| PERMANENT | Regular permanent sewadar | Yes |
| OPEN | Open/temporary sewadar | Yes |
| ELDERLY | Elderly sewadar (can still scan) | No -- excluded from eligible count |

### 4.5 Gender Values

Both formats accepted for CSV import: `Male`/`Female` (app standard) and `MALE`/`FEMALE` (CSV import).

---

## 5. Attendance Logic

### 5.1 Session Ladder (IN -> OUT -> IN)

Each sewadar's attendance follows: IN (OPEN) -> OUT (CLOSED) -> IN (OPEN) -> OUT (CLOSED)

Rule: If sewadar has **no OPEN session** -> show IN button. If they **have an OPEN session** -> show OUT button. This prevents orphan sessions.

### 5.2 Cross-Scan Detection (Guests)

When a sewadar scans at a different centre than their home:
1. Session stored with the **scan centre**
2. After fetching, system looks up home centre via `get_sewadar_details` RPC
3. If home centre != scan centre: tag as `is_cross_scan`, show "From X at Y" with purple Guest badge

### 5.3 Forgot-Out Detection

If an OPEN session is **>12 hours old**, scanner shows a "Forgot Out" prompt. The user can enter the actual departure time.

### 5.4 Gate Entry (Bulk Attendance)

Search -> select -> set times -> validate (OUT >= IN, same-date OUT > IN) -> submit batch.

"Allow other centres" checkbox uses `search_sewadars_all` RPC to bypass centre restriction.

### 5.5 Jatha Entry (Outstation Duty)

Select destination -> add sewadars -> set date range -> validate (max 10 days, no overlaps) -> submit.

### 5.6 Duty Types

SATSCAN (Sun/Wed), DAILY (other days), NIGHT, WATCH_AND_WARD, JATHA.

Auto-detected: `isSatsangDay()` -> SATSCAN, otherwise DAILY.

### 5.7 Session Duration

Calculated as OUT datetime - IN datetime. If negative -> shows "Invalid" in red.

---

## 6. Security Model

### 6.1 How RLS + SECURITY DEFINER Work Together

**Layer 1: RLS** -- Applied to every query. Restricts rows based on role + centre.

**Layer 2: SECURITY DEFINER Functions** -- Narrow escape hatches for specific operations (lookup, search, session management). Run as function owner (super_admin).

### 6.2 Permission System

Each user has a `permissions` JSON column. Super admin bypasses all checks.

---

## 7. User Roles

| Role | Level | Description |
|------|-------|-------------|
| super_admin | System-wide | Full access. Manage users, centres, delete any record |
| aso | Read-only | View all data, no modifications |
| admin | Centre-level | Full centre ops. Delete current-month records only |
| centre_user | Centre-level | Same as admin |
| sc_sp_user | Centre-level | Scan + view only. No add/delete |

---

## 8. Troubleshooting

### 8.1 Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| "No rows returned" scanning | Badge not found or RLS blocking | Run sql/rls_policies_all.sql to deploy helper functions |
| "Cannot delete previous month" | Record from prior month, user not super_admin | Only super_admin can delete old records |
| Duration "Invalid" | OUT before IN on same date | Fix the data entry |
| "Allow other centres" no results | search_sewadars_all RPC not deployed | Run sql/rls_policies_all.sql |
| Gate Entry validation fails | OUT <= IN on same date | Correct the times |

### 8.2 Known Issues

1. **Offline mode**: No scan queueing. Internet required.
2. **No photo capture**: Sewadar photos not implemented.
3. **No batch operations**: Cannot delete/export multiple records at once.
4. **No session timeout**: No auto-logout after inactivity.

### 8.3 CSS Notes

All styles in `src/index.css` (~2230 lines). Organized by component section with comment headers. Dead NR module styles (`.nr-*`, `.jathedar-*`, `.schedule-card`, `.role-*`) were removed in cleanup.

---

## 9. Test Users

| Email | Password | Role | Centre |
|-------|----------|------|--------|
| admin@sewadar.app | Admin@123 | SUPER ADMIN | All centres |
| meena.sehgalsk@sewadar.app | Centre@123 | CENTRE_USER | SURAJ KUND |
| sachin.ahujasa@sewadar.app | Centre@123 | CENTRE_USER | SECTOR-15-A |

---

## Appendix: Recent Changes

| Date | Change | Details |
|------|--------|---------|
| May 2026 | Cross-centre scanning | RPC functions for RLS bypass (get_sewadar_by_badge, search_sewadars_all) |
| May 2026 | Guest detection | All roles can detect cross-scans |
| May 2026 | Jatha enhancements | Sewadar centre + department columns, jatha-type filter pills |
| May 2026 | Timezone fix | getLocalDate() replaces UTC date from toISOString() |
| May 2026 | Elderly badge support | Excluded from dashboard eligible count, can still scan |
| May 2026 | Delete restriction | Non-super_admin blocked from deleting previous-month records |
| May 2026 | Time validation | OUT must be after IN, shows "Invalid" in red |
| May 2026 | Records limit | 500 -> 10,000 |
| May 2026 | Dead code cleanup | Deleted orphaned JathaEntryPage.jsx, purged ~789 lines dead NR CSS |
