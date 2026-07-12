# Attendance App — Agent Context

## Project
- **Sewadar Attendance App** — India-based (IST UTC+5:30)
- Database in UTC → `CURRENT_DATE` mismatch causes "future date" rejection near 5 AM IST
- Stack: React (Vite) + Supabase (PostgreSQL)
- No tests; verify via `npm run build`

## Timezone Pattern
Replace `CURRENT_DATE` in SQL with `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE`
Replace `toISOString().split('T')[0]` / `toLocaleDateString('en-CA')` in JS with `getLocalDate(date)` (already imported helper)

## Code Conventions
- Prefer `useRef` for stale closure sync, updater pattern with `setX(prev => ...)` for dependent reads
- Use `try/finally` with `setProcessing(false)` for async operation guards
- Paginate Supabase queries: `.range(from, to)` with pageSize loop, never `.limit(N)`
- Avoid `.catch(() => {})` — always log with `console.error`
- Pass individual props (not whole objects) to `useCallback` deps
- JSX: 2-space indent, single attribute per line for readability
- Filename `rls_policies_all.sql` — all SQL in one file

## Fix History (most recent first)

### Agent Context File
- Created `agent_context.md` with full project context

### Swallowed Promises Fix
- Replaced 7 instances of `.catch(() => {})` with `.catch(err => console.error(...))` across:
  - `ReportsPage.jsx` (accessible centres)
  - `SuperAdminPage.jsx` (role permissions, lock date, roles)
  - `AttendanceEntryPage.jsx` (accessible centres ×2)
  - `RecordsPage.jsx` (accessible centres)

### SQL Timezone Fix (is_date_locked)
- `rls_policies_all.sql:145-171`: Replaced all 3 `CURRENT_DATE` uses in `is_date_locked` with `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE`

### AttendanceEntryPage Fixes
- **Issue 13** (`updateEntry` stale closure): Changed to updater pattern — reads `updated` from inside `setEntries(prev => ...)` instead of stale closure `entries`
- **Issue 11** (`setMonth+toISOString` timezone): Replaced `twoMonthsAgo.toISOString().split('T')[0]` with `getLocalDate(twoMonthsAgo)`
- **Issue 10** (`toLocaleDateString('en-CA')`): Replaced `today.toLocaleDateString('en-CA')` with `getLocalDate()`

### ReportsPage Fixes
- **Date-specific**: Made all report fetchers use `dateFrom`/`dateTo` instead of hardcoded `today`. DateRangePicker now always shows both date inputs and always uses state values.
  - `fetchPresent`: `.gte('in_date', dateFrom).lte('in_date', dateTo)` (was `.eq('in_date', today)`)
  - `fetchAbsenteeism`: same
  - `fetchCurrentlyInside`: same
  - `fetchMissingOut`: `.lte('in_date', dateTo)` (was `.lt('in_date', today)`)
  - `fetchLateComing`: already used date range ✓
  - `fetchWeeklySummary`: already used date range ✓
  - `fetchDepartmentWise`: `.gte.lte` (was `.eq(today)`)
  - `fetchCentreWise`: same
- **Export limit 10k**: `downloadDailyCSV` and `downloadJathaCSV` now paginate with `.range()` in a loop instead of `.limit(10000)`
- **Dead code**: Removed `fetchGateSummary` function, its switch case, its header entry, and its SummaryCard

### ScannerPage Fixes
- **Stale closure fix**: Added `const popupStateRef = useRef(popupState)` + sync `useEffect`; `markIN`/`markOUT` read `popupStateRef.current` instead of closure variable
- **Processing race**: Added `processing` state guard at top of `markIN`/`markOUT` + `try/finally` to ensure `setProcessing(false)` always fires
- **useCallback deps**: Narrowed `handleScan` deps from whole `profile` object to specific props (`profile?.centre`, `profile?.role`, `profile?.badge_number`, `profile?.name`)

### ScheduleManager Fixes (earlier)
- Fixed operator precedence, silent delete confirmation, activeDept init, duplicate detection, sensitive data exposure, allocations error handling, pagination limit, `to_date(NULL)` validation, distribution toggle stale ref, ScheduleCard try/catch

## Risks
- **`fetchMissingOut`** now uses `.lte('in_date', dateTo)` instead of `.lt('in_date', today)`. For date ranges in the past, this correctly shows open sessions within the range. For date ranges covering today, behavior is equivalent to original.
- **`fetchPresent`/`fetchAbsenteeism`** for multi-day ranges show aggregate presence (any session in range counts as present). Single-date behavior is unchanged.
- **`fetchDepartmentWise`/`fetchCentreWise`** join full `sewadars` table with sessions filtered by date range. For performance on large datasets, consider adding a `COUNT(*)` with subquery pattern.
