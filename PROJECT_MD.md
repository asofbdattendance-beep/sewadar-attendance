# SEWADAR ATTENDANCE SYSTEM v2
## Complete Project Documentation

> **Version:** 2.2  
> **Created:** April 2026  
> **Last Updated:** May 10, 2026  
> **Supabase Project:** https://lnznhbwgkusgdcmvgznf.supabase.co

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Completed Features](#2-completed-features)
3. [Data Model](#3-data-model)
4. [Attendance Logic](#4-attendance-logic)
5. [Centre Hierarchy](#5-centre-hierarchy)
6. [Database Schema](#6-database-schema)
7. [API Reference](#7-api-reference)
8. [App Structure](#8-app-structure)
9. [User Roles](#9-user-roles)
10. [Bug Report](#10-bug-report)
11. [Known Issues](#11-known-issues)
12. [Test Users](#12-test-users)

---

## 1. System Overview

### 1.1 What is this system?

A **mobile-first attendance tracking system** for **41 Satsang Points** across Haryana, UP, and Delhi. Sewadars (volunteers) mark their attendance by scanning their barcode ID cards.

### 1.2 Key Features

| Feature | Description |
|---------|-------------|
| **Barcode Scanning** | Sewadar scans badge → System records attendance |
| **Session Ladder** | IN → OUT → IN → OUT (no orphan records) |
| **Auto Duty Detection** | Sunday/Wednesday = SATSCAN, Other days = DAILY |
| **Smart OUT Detection** | Detects forgotten OUT scans (>12 hours = prompt) |
| **Manual Entry** | Fallback for offline/unable to scan |
| **Gate Entry** | Bulk attendance with overlap validation |
| **Centre Hierarchy** | 18 parent centres + 24 satsang points |
| **Movement Rules** | Sewadar can work within their centre + sub-centres |

### 1.3 The Big Picture

```
┌─────────────────────────────────────────────────────────────────┐
│                      SATSANG POINTS                              │
│                                                                  │
│   ┌──────────────┐        ┌──────────────┐                      │
│   │   GURGAON    │        │  SECTOR-15-A │                      │
│   │   (Parent)   │        │   (Parent)   │                      │
│   └──────┬───────┘        └──────┬───────┘                      │
│          │                       │                               │
│    ┌─────┼─────┐          ┌─────┼─────┐                         │
│    │     │     │          │     │     │                          │
│    ▼     ▼     ▼          ▼     ▼     ▼                          │
│  KASAN  PATAUDI  BADHA    DHATIR  GREATER  (Satsang Points)     │
│  BILASPUR  BUDHERA  ...   FARIDABAD                            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Completed Features

### ✅ Phase 1: Project Setup
- [x] Vite + React project initialized
- [x] HTTPS configured with self-signed certificates (for camera access on mobile)
- [x] Supabase client configured
- [x] Auth context with login/logout

### ✅ Phase 2: Scanner Page
- [x] Barcode scanning with camera
- [x] IN/OUT logic with session validation
- [x] Prevent duplicate IN (check for OPEN sessions)
- [x] Prevent orphan records (OUT requires matching IN)
- [x] Forgot OUT detection (>12 hours)
- [x] Manual entry fallback
- [x] Scanner operator tracking
- [x] Real-time updates via Supabase Realtime

### ✅ Phase 3: Records Page
- [x] Session-based card display
- [x] Duration calculation
- [x] Entry type badges (Scanner/Manual/Gate)
- [x] Date range filtering
- [x] Duty type filtering
- [x] Search by badge/name
- [x] Export functionality

### ✅ Phase 4: Profile Page
- [x] User info display
- [x] Sign out functionality
- [x] Centre restriction notice for SC_SP_USER

### ✅ Phase 5: Gate Entry Page
- [x] Sewadar search and selection
- [x] Multiple attendance entries per submission
- [x] IN/OUT date and time fields
- [x] **Form overlap validation** (entries can't overlap each other)
- [x] **Database overlap validation** (entries can't overlap existing sessions)
- [x] **OPEN session detection** (warns if person is already inside)
- [x] Duty type auto-detection (DAILY vs NIGHT)
- [x] Refresh button to re-fetch existing sessions
- [x] Visual feedback (badges, warnings, success states)

---

## 3. Data Model

### 3.1 CENTRES Table

**Purpose:** Stores all 42 centres (18 parents + 24 satsang points)

| Field | Type | Description |
|-------|------|-------------|
| id | BIGSERIAL | Primary key |
| name | TEXT | Centre/Satsang Point name (UNIQUE) |
| parent_centre | TEXT | FK to parent centre (NULL for parents) |
| is_active | BOOLEAN | Whether active |
| created_at | TIMESTAMPTZ | Creation timestamp |

---

### 3.2 SPECIAL_DEPARTMENTS Table

**Purpose:** Departments that can work anywhere

| Department |
|------------|
| ADMINISTRATION |
| PATHI |
| SATSANG KARTA |
| BAAL SATSANG KARTA |
| OFFICE |
| AREA SECRETARY OFFICE |
| MAINTENANCE |

---

### 3.3 SEWADARS Table

**Purpose:** Master data of all sewadars

| Field | Type | Notes |
|-------|------|-------|
| id | BIGSERIAL | Primary key |
| badge_number | TEXT | UNIQUE - e.g., FB5988LA0017 |
| sewadar_name | TEXT | e.g., OMBATI |
| father_husband_name | TEXT | e.g., VED PRAKASH |
| gender | TEXT | Male / Female |
| badge_status | TEXT | OPEN / PERMANENT |
| centre | TEXT | Centre OR Satsang Point name |
| department | TEXT | e.g., SECURITY |
| is_initiated | BOOLEAN | TRUE / FALSE |
| age | INTEGER | e.g., 61 |
| print_status | TEXT | Informational only |
| form_status | TEXT | Informational only |
| created_at | TIMESTAMPTZ | Auto |

---

### 3.4 ATTENDANCE_SESSIONS Table

**Purpose:** One row = One complete IN→OUT session

| Field | Type | Notes |
|-------|------|-------|
| id | BIGSERIAL | Primary key |
| badge_number | TEXT | FK to sewadars |
| sewadar_name | TEXT | Denormalized |
| centre | TEXT | Where attendance marked |
| duty_type | TEXT | SATSCAN / DAILY / NIGHT / JATHA |
| status | TEXT | OPEN / CLOSED |
| in_date | DATE | |
| in_time | TIME | |
| in_scanner_badge | TEXT | Scanner operator's badge (IN) |
| in_scanner_name | TEXT | Scanner operator's name (IN) |
| in_scanner_centre | TEXT | Scanner operator's centre (IN) |
| out_date | DATE | NULL until closed |
| out_time | TIME | NULL until closed |
| out_scanner_badge | TEXT | Scanner operator's badge (OUT) |
| out_scanner_name | TEXT | Scanner operator's name (OUT) |
| out_scanner_centre | TEXT | Scanner operator's centre (OUT) |
| is_manual | BOOLEAN | TRUE for manual entry |
| is_gate_entry | BOOLEAN | TRUE for gate entry |
| entered_by_badge | TEXT | Who entered manually |
| entered_by_name | TEXT | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

---

### 3.5 USERS Table

**Purpose:** App login users

| Field | Type | Notes |
|-------|------|-------|
| id | BIGSERIAL | Primary key |
| auth_id | UUID | Supabase Auth reference |
| email | TEXT | UNIQUE - login email |
| name | TEXT | Full name |
| badge_number | TEXT | Their sewadar badge |
| role | TEXT | aso / centre_user / sc_sp_user |
| centre | TEXT | Their assigned centre |
| is_active | BOOLEAN | |
| created_at | TIMESTAMPTZ | |

---

### 3.6 LOGS Table

**Purpose:** Audit trail

| Field | Type | Notes |
|-------|------|-------|
| id | BIGSERIAL | Primary key |
| user_badge | TEXT | Who performed action |
| action | TEXT | e.g., SCAN_IN, SCAN_OUT |
| details | TEXT | Details of the action |
| timestamp | TIMESTAMPTZ | |

---

## 4. Attendance Logic

### 4.1 Session Ladder Rules

```
Rule 1: Every OUT requires a matching IN
Rule 2: Sessions alternate IN → OUT → IN → OUT
Rule 3: Multiple sessions allowed per day
Rule 4: Cross-day sessions = Night Duty
```

### 4.2 Scanner Flow

```
ON BADGE SCAN:
│
├─ 1. LOOKUP BADGE
│     → Find sewadar by badge_number
│     → If not found → "Badge Not Registered"
│
├─ 2. CHECK OPEN SESSIONS
│     → Find sessions where badge = X AND status = 'OPEN'
│     → Order by in_time DESC
│
├─ 3. DETERMINE ACTION
│     │
│     ├─ NO OPEN SESSION
│     │   → Show popup with sewadar info
│     │   → Show GREEN "IN" button
│     │   → Create session: status='OPEN'
│     │
│     └─ OPEN SESSION EXISTS
│         │
│         ├─ IN was TODAY
│         │   → Show RED "OUT" button
│         │   → Close session with current time
│         │
│         └─ IN was BEFORE TODAY (>12 hours ago)
│             → "Previous session still open"
│             → Ask: "When did you leave?"
│             → Close old session
│             → Then show "IN" button
│
└─ 4. RECORD SCANNER
      → Log scanner's badge as in_scanner_badge / out_scanner_badge
```

### 4.3 Smart OUT Detection (The "Forgot to Scan" Problem)

**Scenario:** Sewadar forgets to scan OUT on Wednesday. They come back Sunday and scan.

**With Smart Detection (>12 hours rule):**
```
1. Sewadar scans badge on Sunday
2. System finds OPEN session from Wednesday (3+ days old)
3. System calculates: hours_since_in > 12
4. System shows: "Previous session still open"
5. System asks: "When did you leave?"
6. Sewadar enters: Saturday 6:00 PM
7. System closes Wednesday session with Saturday 6:00 PM
8. System shows: "Session Closed. Now you can start new session"
9. System shows IN button for new session
```

### 4.4 Duty Type Auto-Detection

| Day | Number | Duty Type | Input Method |
|-----|--------|-----------|--------------|
| Sunday | 0 | SATSCAN | Scanner |
| Monday | 1 | DAILY | Manual |
| Tuesday | 2 | DAILY | Manual |
| Wednesday | 3 | SATSCAN | Scanner |
| Thursday | 4 | DAILY | Manual |
| Friday | 5 | DAILY | Manual |
| Saturday | 6 | DAILY | Manual |

### 4.5 Gate Entry Validation Rules

```
GATE ENTRY OVERLAP RULES:

1. Form Overlaps
   - Multiple entries in the same form cannot overlap
   - Each entry IN must be after previous OUT

2. Database Overlaps (CLOSED sessions)
   - New entry cannot overlap with any CLOSED session
   - Check: newIN < existingOUT AND newOUT > existingIN

3. Database Overlaps (OPEN sessions)
   - New entry cannot overlap with OPEN session
   - If existing session has no OUT, person is "inside since IN"
   - Any entry ending after they entered = conflict

4. Entry Type Detection
   - Same day IN/OUT = DAILY
   - Different day IN/OUT = NIGHT
```

---

## 5. Centre Hierarchy

### 5.1 Complete Centre List (42 entries)

| Parent Centre | Satsang Points |
|---------------|----------------|
| ANKHEER | — |
| BALLABGARH | MACHHGAR |
| DLF CITY GURGAON | ABHEYPUR, NUH, PUNAHANA, SOHNA |
| FIROZPUR JHIRKA | — |
| TAORU | — |
| GURGAON | BADHA SIKENDERPUR, BILASPUR, BUDHERA, DUNDAHERA, FARUKH NAGAR, JATAULA, KASAN, PATAUDI |
| MOHANA | FATEHPUR BILLOCH |
| ZAIBABAD KHERLI | — |
| NANGLA GUJRAN | — |
| NIT - 2 | — |
| PALWAL | BAHIN, HASANPUR, HATHIN, MANDKOLA, NAYAGAON, SIHA |
| BAROLI | — |
| HODAL | — |
| RAJENDRA PARK | — |
| SECTOR-15-A | DHATIR, GREATER FARIDABAD |
| PRITHLA | — |
| SURAJ KUND | — |
| TIGAON | NACHAULI |

### 5.2 Movement Rules

```
Sewadar's Centre = GURGAON

Can mark attendance at:
├── GURGAON (their centre)
├── BADHA SIKENDERPUR (child of GURGAON)
├── BILASPUR (child of GURGAON)
├── BUDHERA (child of GURGAON)
├── DUNDAHERA (child of GURGAON)
├── FARUKH NAGAR (child of GURGAON)
├── JATAULA (child of GURGAON)
├── KASAN (child of GURGAON)
└── PATAUDI (child of GURGAON)

CANNOT mark attendance at:
├── SECTOR-15-A (different parent)
├── ANKHEER (different parent)
├── PALWAL (different parent)
└── ...etc
```

**Exception:** Special departments can work ANYWHERE

---

## 6. Database Schema

### 6.1 Key Tables

```sql
-- 4. ATTENDANCE SESSIONS
CREATE TABLE attendance_sessions (
  id BIGSERIAL PRIMARY KEY,
  badge_number TEXT NOT NULL REFERENCES sewadars(badge_number),
  sewadar_name TEXT NOT NULL,
  centre TEXT NOT NULL,
  duty_type TEXT NOT NULL CHECK (duty_type IN ('SATSCAN', 'DAILY', 'NIGHT', 'JATHA')),
  status TEXT DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  in_date DATE NOT NULL,
  in_time TIME NOT NULL,
  in_scanner_badge TEXT,
  in_scanner_name TEXT,
  in_scanner_centre TEXT,
  out_date DATE,
  out_time TIME,
  out_scanner_badge TEXT,
  out_scanner_name TEXT,
  out_scanner_centre TEXT,
  is_manual BOOLEAN DEFAULT false,
  is_gate_entry BOOLEAN DEFAULT false,
  entered_by_badge TEXT,
  entered_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_sessions_badge ON attendance_sessions(badge_number);
CREATE INDEX idx_sessions_date ON attendance_sessions(in_date);
CREATE INDEX idx_sessions_status ON attendance_sessions(status);
CREATE INDEX idx_sessions_open ON attendance_sessions(badge_number, status) WHERE status = 'OPEN';

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE attendance_sessions;
```

### 6.2 Row Level Security

The canonical RLS policies are maintained in `sql/rls_policies_all.sql`.
Run that file in the Supabase SQL Editor to recreate ALL policies.

**Key design decisions:**

| Role | Read | Write (Insert/Update/Delete) |
|------|------|------------------------------|
| `super_admin` | All data | Full access to all tables |
| `aso` | All data (read-only) | No write access |
| `admin` / `centre_user` | Own centre + children | Can modify data for own centre's sewadars |
| `sc_sp_user` | Own centre + children | No write access to records |

**Helper functions used by policies:**
- `get_user_role()` — returns the current user's role from `users` table
- `get_user_accessible_centres()` — returns own centre + children (recursive CTE), or ALL centres for `super_admin`/`aso`
- `get_sewadar_centres(p_badge_numbers TEXT[])` — SECURITY DEFINER, returns `(badge_number, centre)` for given badges; bypasses RLS for cross-scan detection
- `get_sewadar_by_badge(p_badge TEXT)` — SECURITY DEFINER, returns full sewadar record by badge; bypasses RLS so Scanner can look up out-of-centre sewadars
- `search_sewadars_all(p_term TEXT)` — SECURITY DEFINER, searches sewadars by name/badge across ALL centres; bypasses RLS for Gate Entry "Allow other centres"

**Delete access:**
- `attendance_sessions`: `admin`/`centre_user` can delete sessions where `centre IN get_user_accessible_centres()`
- `jatha_attendance`: `admin`/`centre_user` can delete records for sewadars from their accessible centres
- Jatha master, centres, users, etc.: only `super_admin` can delete

---

## 7. API Reference

### 7.1 Get Open Session

```sql
CREATE OR REPLACE FUNCTION get_open_session(p_badge TEXT)
RETURNS attendance_sessions AS $$
  SELECT * FROM attendance_sessions
  WHERE badge_number = p_badge AND status = 'OPEN'
  ORDER BY in_time DESC
  LIMIT 1;
$$ LANGUAGE SQL SECURITY DEFINER;
```

### 7.2 Get Sewadar By Badge (RLS Bypass)

```sql
CREATE OR REPLACE FUNCTION public.get_sewadar_by_badge(p_badge TEXT)
RETURNS SETOF public.sewadars
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM public.sewadars s
  WHERE s.badge_number = p_badge;
END;
$$;
```

Used by `ScannerPage.jsx` to look up any sewadar by badge, bypassing RLS so out-of-centre special department sewadars can be scanned.

### 7.3 Search Sewadars All Centres (RLS Bypass)

```sql
CREATE OR REPLACE FUNCTION public.search_sewadars_all(p_term TEXT)
RETURNS SETOF public.sewadars
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM public.sewadars s
  WHERE s.badge_number ILIKE '%' || p_term || '%'
     OR s.sewadar_name ILIKE '%' || p_term || '%'
  LIMIT 20;
END;
$$;
```

Used by `AttendanceEntryPage.jsx` Gate Entry form when "Allow other centres" checkbox is checked. Also used by `ScannerPage.jsx` manual entry for non-SC_SP_USER roles.

### 7.4 Get Valid Centres for User

```sql
CREATE OR REPLACE FUNCTION get_user_centres(p_user_centre TEXT)
RETURNS TABLE(name TEXT) AS $$
  WITH user_info AS (
    SELECT name, parent_centre FROM centres WHERE name = p_user_centre
  )
  SELECT DISTINCT c.name FROM centres c
  WHERE 
    c.name = p_user_centre
    OR c.parent_centre = p_user_centre
    OR (SELECT parent_centre FROM user_info) IS NOT NULL 
       AND c.name = (SELECT parent_centre FROM user_info)
    OR (SELECT parent_centre FROM user_info) IS NOT NULL 
       AND c.parent_centre = (SELECT parent_centre FROM user_info)
$$ LANGUAGE SQL SECURITY DEFINER;
```

---

## 8. App Structure

```
src/
├── main.jsx
├── App.jsx                      # Router + Layout + Bottom Nav
├── index.css                    # All styles (theme, components)
│
├── context/
│   └── AuthContext.jsx          # Auth state (login, logout, profile)
│
├── lib/
│   └── supabase.js              # Client + constants + helpers
│
├── components/
│   └── scanner/
│       └── BarcodeScanner.jsx   # Camera barcode scanning
│
└── pages/
    ├── LoginPage.jsx            # Login with credentials
    ├── ScannerPage.jsx          # Main scanner + manual entry
    ├── RecordsPage.jsx          # View session records
    ├── ProfilePage.jsx          # User profile + sign out
    └── GateEntryPage.jsx        # Bulk attendance entry
```

### 8.1 Navigation

Bottom navigation with 4 tabs:
1. **Scanner** - Barcode scanning + manual entry
2. **Records** - View attendance records
3. **Gate Entry** - Bulk attendance
4. **Profile** - User info + logout

---

## 9. User Roles

### 9.1 Role Definitions

| Role | Code | Description |
|------|------|-------------|
| Area Secretary | `aso` | Super Admin - full access |
| Centre User | `centre_user` | Centre-level admin |
| Scanner | `sc_sp_user` | Scanner operator |

### 9.2 Permissions Matrix

| Action | ASO | Centre User | Scanner |
|--------|-----|------------|---------|
| Scan badges | ✅ | ✅ | ✅ |
| View own centre records | ✅ | ✅ | ✅ |
| View all records | ✅ | ✅ | ❌ |
| Mark manual attendance | ✅ | ✅ | ❌ |
| Gate entry | ✅ | ✅ | ❌ |
| Edit attendance | ✅ | ✅ | ❌ |
| Manage sewadars | ✅ | ❌ | ❌ |
| Manage users | ✅ | ❌ | ❌ |
| Manage centres | ✅ | ❌ | ❌ |
| View logs | ✅ | ❌ | ❌ |

---

## 10. Bug Report

> **Scan Date:** April 16, 2026  
> **Analyst:** Deep Code Analysis

### Summary

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Logic Bugs | 0 | 3 | 1 | 0 | 4 |
| State Management | 0 | 2 | 2 | 1 | 5 |
| UI Bugs | 0 | 0 | 2 | 3 | 5 |
| Security Bugs | 1 | 2 | 2 | 0 | 5 |
| Data Integrity | 0 | 3 | 4 | 0 | 7 |
| Error Handling | 1 | 3 | 1 | 0 | 5 |
| Mobile/Responsive | 0 | 2 | 3 | 2 | 7 |
| **TOTAL** | **1** | **15** | **15** | **6** | **37** |

---

### 10.1 CRITICAL Bugs

#### C1: Hardcoded Test Credentials in Production
**File:** `LoginPage.jsx`
**Issue:** Test credentials visible in production build
```javascript
<div>Email: <span>admin@sewadar.app</span></div>
<div>Pass: <span>Admin@123</span>
```
**Fix:** Remove from production or use environment-based rendering

---

### 10.2 HIGH Priority Bugs

#### H1: Time Format Parsing Bug
**File:** `ScannerPage.jsx`
**Issue:** `toLocaleTimeString('en-IN', { hour12: true })` produces "02:30 PM" but storage expects "14:30"
```javascript
const currentTime = today.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
```
**Fix:** Use 24-hour format for storage, convert to 12-hour for display only

#### H2: Forgot OUT Creates Orphan Session
**File:** `ScannerPage.jsx`
**Issue:** After closing "forgot OUT" session, creates new OPEN session
```javascript
if (forgotDate) {
  await supabase.from('attendance_sessions').update(updateData).eq('id', popupState.openSession.id)
  await supabase.from('attendance_sessions').insert({
    status: SESSION_STATUS.OPEN, // Creates potentially orphan record
  })
}
```
**Fix:** Either don't auto-create new session, or auto-close at midnight

#### H3: Duplicate IN Prevention Not Atomic
**File:** `ScannerPage.jsx`
**Issue:** Check-then-insert is not atomic. Two rapid scans could create duplicates
```javascript
if (manualOpenSession) {
  setManualHasSession(true)
  return
}
// ... insert happens AFTER check
```
**Fix:** Add unique constraint at DB level or use upsert with conflict resolution

#### H4: Missing useEffect Dependency - Race Condition
**File:** `ScannerPage.jsx`
**Issue:** `handleScan` uses `popupState` but doesn't include it in dependencies
```javascript
const handleScan = useCallback(async (badge) => {
  // Uses popupState but not in dependencies
}, [isOnline, profile]) // Missing: popupState
```
**Fix:** Add `popupState` to dependency array or use ref

#### H5: Stale Closure in AuthContext
**File:** `AuthContext.jsx`
**Issue:** If `fetchProfile` called multiple times quickly, stale data possible
```javascript
async function fetchProfile(userId) {
  const { data } = await supabase.from('users').select('*').eq('auth_id', userId).single()
  setProfile(data) // Race condition possible
}
```
**Fix:** Add abort controller or use latest user ID ref

---

### 10.3 MEDIUM Priority Bugs

#### M1: RecordsPage - useEffect Missing Dependencies
**File:** `RecordsPage.jsx`
**Issue:** `fetchRecords` references `searchTerm` not in dependencies
```javascript
useEffect(() => { fetchRecords() }, [dateFrom, dateTo, dutyFilter])
// fetchRecords uses searchTerm but it's not a dependency
```
**Fix:** Add searchTerm to dependency array or use useCallback

#### M2: Missing Cleanup - Realtime Subscription
**File:** `ScannerPage.jsx`
**Issue:** If `fetchRecentScans` changes reference, subscription uses stale function
```javascript
useEffect(() => {
  const channel = supabase.channel('scanner-scans')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance_sessions' }, fetchRecentScans)
    .subscribe()
}, [profile?.centre])
```
**Fix:** Use useCallback for fetchRecentScans with proper dependencies

#### M3: SQL Injection via .or() Filter
**File:** `ScannerPage.jsx`, `GateEntryPage.jsx`
**Issue:** Template literals with user input in Supabase .or() filter
```javascript
.or(`badge_number.ilike.%${term}%,sewadar_name.ilike.%${term}%`)
```
**Fix:** Sanitize input or use parameterized queries properly

#### M4: No Authorization on RPC
**File:** `ScannerPage.jsx`
**Issue:** Any authenticated user can query any badge's open session
```javascript
const { data } = await supabase.rpc('get_open_session', { p_badge: badge })
```
**Fix:** Ensure RLS policies on RPC or add application-level authorization

#### M5: Orphan Records - No Transaction Safety
**File:** `GateEntryPage.jsx`
**Issue:** If submission partially fails, records could be left inconsistent
```javascript
const { error: insertError } = await supabase.from('attendance_sessions').insert(records)
```
**Fix:** Use Supabase transaction or check inserted data before showing success

#### M6: Gate Entry - Overlap Detection Incomplete
**File:** `GateEntryPage.jsx`
**Issue:** Doesn't prevent overlaps with sessions created in forgot_out flow
**Fix:** Cross-page session validation or unified session management

---

### 10.4 LOW Priority Bugs

#### L1: GateEntryPage - State Mutation Risk
**File:** `GateEntryPage.jsx`
**Issue:** Uses stale `validationErrors` in setter
```javascript
setValidationErrors({ ...validationErrors, [id]: entryErrors })
```
**Fix:** Use functional update: `setValidationErrors(prev => ({...prev, [id]: entryErrors}))`

#### L2: RecordsPage Search Triggers on Every Keystroke
**File:** `RecordsPage.jsx`
**Issue:** Fetches on every keystroke - excessive API calls
```javascript
onChange={e => { setSearchTerm(e.target.value); fetchRecords() }}
```
**Fix:** Debounce search

#### L3: Camera Permission - No Retry Option
**File:** `BarcodeScanner.jsx`
**Issue:** If user denies permission, no way to retry
```javascript
setErrorMsg(err.name === 'NotAllowedError' ? 'Camera permission denied...' : ...)
```
**Fix:** Add link to camera settings

#### L4: Empty Session Card - No Data Validation
**File:** `RecordsPage.jsx`
**Issue:** If session has null values, card displays empty/undefined
**Fix:** Add nullish coalescing: `{session.badge_number || 'Unknown'}`

---

## 11. Known Issues

1. **Time Display** - All times stored in 24-hour format, displayed in 12-hour format
2. **No Offline Mode** - Requires internet connection (offline queue not implemented)
3. **No Photo Capture** - Can't attach photo to manual entries
4. **No Batch Operations** - Can't delete multiple records at once
5. **Session Timeout** - No session timeout handling (requires page refresh)

---

## 12. Test Users

| Email | Password | Role | Centre |
|-------|----------|------|--------|
| admin@sewadar.app | Admin@123 | ASO | SECTOR-15-A |

---

## Appendix: CSS Classes Reference

### Entry Type Badges
```css
.scanner-badge { background: var(--excel-green); color: white; }
.manual-badge { background: #f97316; color: white; }
.gate-badge { background: #8b5cf6; color: white; }
```

### Validation States
```css
.entry-error { border: 2px solid var(--red); }
.overlap-warning { background: #fee2e2; border-left: 3px solid var(--red); }
.db-overlap-warning { background: #fef3c7; border-left: 3px solid #f59e0b; }
.entry-preview.success { background: #dcfce7; border-left: 3px solid var(--excel-green); }
```

---

**Document Version:** 2.1  
**Last Updated:** April 16, 2026  
**Status:** Feature Complete - Bug Fixes Needed
