# Sewadar Attendance — Working Context

Session context for contributing to this repo. Read `PROJECT.md` first for the overview; this file records what was done, why, and how to deploy/verify.

---

## 0. Recent issue — Records page 400 "Could not find the function get_session_records"

### Symptom
On the Sewadar Attendance tab of the Records page, the app logs `Failed to fetch gate records: Object` and the Supabase request to
`/rest/v1/rpc/get_session_records` returns **400**.

### Diagnosis
The **deployed frontend is current** (the error comes from `dist/assets/index-CIKxYgMU.js`, which matches a fresh `npm run build`), and the repo's `get_session_records` (sql/rls_policies_all.sql:1164) accepts exactly the 9 args the frontend sends in `RecordsPage.jsx:367`/`549`:
`p_page, p_page_size, p_date_from, p_date_to, p_centre, p_duty_type, p_search, p_status, p_quick_filter`.

A PostgREST **400** on an RPC means **no matching function signature exists in the deployed DB** (PGRST113 / 42883), so the **live Supabase database has a stale `get_session_records`** — likely created before the `p_quick_filter` / `p_status` params were added (first introduced in commit `82c9b27`). The frontend now calls with params the old DB function doesn't have → PostgREST can't resolve an overload → 400.

This is the same class of problem as Bug 2 (stale deployed DB relative to repo). The **SQL file is the source of truth; the DB is not versioned in CI.**

### Fix
Re-run **`sql/rls_policies_all.sql`** in the Supabase SQL Editor (or at minimum the `get_session_records` / `get_jatha_records` DO-block + `CREATE OR REPLACE FUNCTION` section). The signature currently in the repo:
```sql
CREATE OR REPLACE FUNCTION public.get_session_records(
  p_page INT DEFAULT 1,
  p_page_size INT DEFAULT 50,
  p_date_from DATE DEFAULT NULL,
  p_date_to DATE DEFAULT NULL,
  p_centre TEXT DEFAULT NULL,
  p_duty_type TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_quick_filter TEXT DEFAULT NULL
)
```
After the DB is refreshed, the Records page (both tabs) should load. No frontend code change needed — the deployed bundle already matches the repo.

---

## 0b. ROOT CAUSE: two projects SHARED one Supabase database (RESOLVED 2025-08-30)

**History:** the `sewadar-attendance` app and the `sewadar-deployment-portal` previously
pointed at the SAME Supabase project (`lnznhbwgkusgdcmvgznf.supabase.co`). **Separated
2025-08-30:** attendance keeps `lnznhb…` (ASMS-FBD), portal now uses `wgavvihuwwwoqpbqntgp`.
Portal leftovers on the attendance DB are removed via `sql/cleanup_deployment_leftovers.sql`.
They independently defined conflicting versions of overlapping objects:

| Object | Attendance app (`rls_policies_all.sql`) | Portal `v26_attendance.sql` |
|---|---|---|
| `attendance_sessions` | `id BIGINT`, `duty_type`, `is_gate_entry`, `entered_by_*`, TEXT `sewadar_dept` | `id uuid`, `schedule_id uuid NOT NULL`, uuid `sewadar_dept`, no `duty_type` |
| `get_sewadar_by_badge` | `RETURNS SETOF public.sewadars` | `RETURNS jsonb` |
| policies | `sessions_read/insert/update/delete` | `att_read`, `att_insert`, `att_update` |

### What running portal v25/v26/v27 did to the shared DB
- **v25** — only portal tables (`portal_users`, `deployment_*`, `department_incharge_selections`). No effect on attendance objects. Safe.
- **v27** — `centres ADD COLUMN IF NOT EXISTS is_faridabad` (additive) + two new `is_faridabad_*` helpers. No breaking effect.
- **v26** — **BREAKING for the attendance app**:
  1. Its DO-block `DROP TABLE public.attendance_sessions CASCADE` when the table lacks
     `schedule_id` → **erased the attendance app's `attendance_sessions` (and data)** and
     replaced it with the portal's incompatible schema.
  2. `DROP FUNCTION get_sewadar_by_badge(text)` + `CREATE OR REPLACE ... RETURNS jsonb`
     → this is the exact **42P13 "cannot change return type"** hit when re-running the attendance SQL.
  3. Recreated `att_read`/`att_insert`/`att_update` referencing the portal schema's
     `sewadar_dept` → this is the exact **2BP01 "policy att_read depends on sewadar_dept"** hit.

### Decision (user-approved)
Separate the two apps into their **own Supabase databases**. The attendance app's schema
is now versioned in `sql/attendance_sessions_schema.sql` (previously only existed in the
live DB / old git history, which is how v26 silently clobbered it). New DB build order:
1. run `sql/attendance_sessions_schema.sql` (creates the table + populate trigger + indexes),
2. run `sql/rls_policies_all.sql` (policies, helper functions, RPCs),
3. migrate/export data, point each app's env vars at its own project, redeploy.
4. The attendance SQL now also defends against legacy/portal objects (drops `att_read`/
   `att_write` and drops/recreates `get_sewadar_by_badge`, `search_sewadars_all` before
   `CREATE OR REPLACE`).

---

## 1. High-level architecture

- **Frontend**: React 18 + Vite 5 SPA. Deployed from `dist/` (Vercel).
- **Backend**: Supabase (PostgreSQL + RLS + Edge Functions). All database logic lives in **`sql/rls_policies_all.sql`** and is deployed by running the whole file in the Supabase SQL Editor (see "Deploy" below).
- **Timezone reality**: The Supabase DB runs on **UTC**, but the app computes and sends **local (IST / Asia/Kolkata)** date strings. Any SQL that compares app-sent dates against `CURRENT_DATE` / `now()` MUST use `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE` instead, or it will be off by one day between 00:00–05:30 IST.

---

## 2. Bug 1 — Scanners can't scan sewadars before 5:30 AM IST (FIXED)

### Symptom
Between 00:00 and 05:30 IST, scanning a sewadar IN failed with "Cannot create attendance session with a future date" (or locks/future-date checks misfired).

### Root cause
`CURRENT_DATE` in the DB returns the **UTC** day. Between midnight and 05:30 IST, the UTC day is still the *previous* date, so app-sent IST dates looked like "tomorrow" to the DB. Three places were affected:

| Function | File:line | Old | New (IST-aware) |
|---|---|---|---|
| `is_date_locked()` | `sql/rls_policies_all.sql:171` | `CURRENT_DATE` (3 uses) | `v_today := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE` |
| `close_session()` | `sql/rls_policies_all.sql:701` | `CURRENT_DATE` | same IST expression |
| `prevent_future_session()` trigger | `sql/rls_policies_all.sql:880` | `CURRENT_DATE` | same IST expression (added `v_today` DECLARE) |

### Side-effect fix confirmed
The `close_session()` IST change also fixed a second latent bug: closing an **overnight** session at 00:00–05:30 IST (in 23:30 day X, out 00:30 day X+1) previously sent `out_date = X+1` while UTC still read day X, so the future-date check rejected a legitimate close. IST-aware compare now accepts it.

### Verification after deploy
Run a scan at ~00:10 IST → should succeed. Run the policy/functions re-create (Section 4).

---

## 3. Bug 2 — Superadmin CRUD failed in the ASO Panel (jatha_master / centres) (FIXED)

### Root cause (two parts)

**A. RLS write policies over-depended on `has_permission('allow_settings')` (deployed DB was stale).**
The repo's `has_permission()` short-circuits `super_admin → TRUE` (line 40-43), but the live DB had an older version without the bypass. So the superadmin write policies:

```sql
USING (get_user_role() = 'super_admin' AND public.has_permission('allow_settings'))
```

were FALSE for everyone — superadmin included — and all CRUD returned "permission denied" / RLS violations.

**Fix applied** (6 superadmin-only write policies): dropped the `AND public.has_permission('allow_settings')` dependency, leaving self-sufficient `get_user_role() = 'super_admin'`:

- `settings_write` → `sql/rls_policies_all.sql:150`
- `centres_write` → `:322`
- `jatha_write` (`jatha_master`) → `:341`
- `users_write` → `:563`
- `role_masters_write` → `:588`
- `depts_write` (`special_departments`) → `:613`

Security is unchanged: these tables were already super_admin-write-only; ASO/admin/centre_user are still denied by the role check.

**B. Frontend sent a bogus `permissions` column to tables that don't have one (PGRST204 → 400).**
`SuperAdminPage.jsx` `handleSubmit()` unconditionally forced `payload.permissions = {}` when the form had no permissions value. For `jatha_master` (and `centres`, `special_departments`, etc.) there is **no** `permissions` column, so PostgREST returned:

```
Could not find the 'permissions' column of 'jatha_master' in the schema cache
(400 / PGRST204)
```

This is what blocked *saves* even after the RLS fix was deployed.

**Fix applied** (`src/pages/SuperAdminPage.jsx:468`): only normalize `permissions` when `activeTable` is `users` or `role_masters`; otherwise `delete payload.permissions`.

### Verify after UI rebuild
Open `/superadmin` → Jatha Master → Add/Edit/Delete → should persist. Same for Centres, Roles, Departments, Users.

---

## 4. Deploying the DB fix (do this if the live DB predates these commits)

Run **only** these statements in the Supabase SQL Editor (they are idempotent and the minimal set — no data changes, no deletes):

```sql
-- RLS write policies (superadmin-only, no has_permission dependency)
DROP POLICY IF EXISTS settings_write ON public.settings;
CREATE POLICY settings_write ON public.settings
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'super_admin')
  WITH CHECK (public.get_user_role() = 'super_admin');

DROP POLICY IF EXISTS centres_write ON public.centres;
CREATE POLICY centres_write ON public.centres
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'super_admin')
  WITH CHECK (public.get_user_role() = 'super_admin');

DROP POLICY IF EXISTS jatha_write ON public.jatha_master;
CREATE POLICY jatha_write ON public.jatha_master
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'super_admin')
  WITH CHECK (public.get_user_role() = 'super_admin');

DROP POLICY IF EXISTS users_write ON public.users;
CREATE POLICY users_write ON public.users
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'super_admin')
  WITH CHECK (public.get_user_role() = 'super_admin');

DROP POLICY IF EXISTS role_masters_write ON public.role_masters;
CREATE POLICY role_masters_write ON public.role_masters
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'super_admin')
  WITH CHECK (public.get_user_role() = 'super_admin');

DROP POLICY IF EXISTS depts_write ON public.special_departments;
CREATE POLICY depts_write ON public.special_departments
  FOR ALL TO authenticated
  USING (public.get_user_role() = 'super_admin')
  WITH CHECK (public.get_user_role() = 'super_admin');

-- IST-aware date functions/trigger (Bug 1)
CREATE OR REPLACE FUNCTION public.is_date_locked(p_date DATE)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_lock_date DATE;
  v_prev_month_first DATE;
  v_today DATE;
BEGIN
  v_today := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;
  v_prev_month_first := (date_trunc('month', v_today - interval '1 month'))::DATE;
  IF p_date < v_prev_month_first THEN RETURN TRUE; END IF;
  SELECT value::DATE INTO v_lock_date FROM public.settings WHERE key = 'lock_date';
  IF v_lock_date IS NULL OR v_today <= v_lock_date THEN RETURN FALSE; END IF;
  RETURN date_trunc('month', p_date) < date_trunc('month', v_today);
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_future_session()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_today DATE;
BEGIN
  v_today := (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE;
  IF NEW.in_date > v_today AND public.get_user_role() != 'super_admin' THEN
    RAISE EXCEPTION 'Cannot create attendance session with a future date';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_session(
  p_session_id BIGINT, p_out_date DATE, p_out_time TIME,
  p_out_scanner_badge TEXT, p_out_scanner_name TEXT, p_out_scanner_centre TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_in_date DATE;
BEGIN
  SELECT in_date INTO v_in_date FROM public.attendance_sessions WHERE id = p_session_id;
  IF v_in_date IS NOT NULL AND p_out_date < v_in_date THEN
    RAISE EXCEPTION 'OUT date must be on or after IN date';
  END IF;
  IF p_out_date > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE THEN
    RAISE EXCEPTION 'OUT date cannot be in the future';
  END IF;
  IF v_in_date IS NOT NULL AND p_out_date = v_in_date AND public.get_user_role() != 'super_admin' THEN
    IF p_out_time <= (SELECT in_time FROM public.attendance_sessions WHERE id = p_session_id) THEN
      RAISE EXCEPTION 'OUT time must be after IN time on the same date';
    END IF;
  END IF;
  IF v_in_date IS NOT NULL AND public.get_user_role() != 'super_admin' AND public.is_date_locked(v_in_date) THEN
    RAISE EXCEPTION 'Cannot close session: date is locked';
  END IF;
  IF v_in_date IS NOT NULL AND public.get_user_role() NOT IN ('super_admin', 'aso') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.attendance_sessions s
      WHERE s.id = p_session_id
      AND (
        s.centre IN (SELECT public.get_user_accessible_centres())
        OR EXISTS (
          SELECT 1 FROM public.sewadars sw
          WHERE sw.badge_number = s.badge_number
          AND sw.centre IN (SELECT public.get_user_accessible_centres())
        )
      )
    ) THEN
      RAISE EXCEPTION 'Not authorized to close this session';
    END IF;
  END IF;
  UPDATE public.attendance_sessions
  SET out_date = p_out_date, out_time = p_out_time,
      out_scanner_badge = p_out_scanner_badge,
      out_scanner_name = p_out_scanner_name,
      out_scanner_centre = p_out_scanner_centre,
      status = 'CLOSED', updated_at = now()
  WHERE id = p_session_id AND status = 'OPEN';
END;
$$;
```

> **Alternative:** just re-run the entire `sql/rls_policies_all.sql` in the SQL Editor. It recreates everything (policies, functions, indexes, constraints) idempotently and preserves data. Note it also runs one-time data fixes (jatha dedup DELETE, in/out date swaps, closing duplicate OPEN sessions, permission backfills) — review those before doing a full re-run on live data.

---

## 5. Diagnosing a `400`/`Save error: Object` in the ASO Panel

`SuperAdminPage.jsx:494` logs `Save error: Object`; the real message is in the toast (`result.error.message`). Known causes and how to tell them apart:

| PostgREST error | Meaning | Fix |
|---|---|---|
| `42501` … violates row-level security policy | RLS blocked the write | Deploy Section 4 policies |
| `PGRST204` Could not find the 'X' column | Payload sends a column that doesn't exist on that table | Section 3B (permissions guard) |
| `23502` null value violates not-null constraint | Required form field empty | Fill required col |
| `23514` check violation | `chk_users_permissions_is_object`, etc. | Check value format |

Verify live policy state (SQL Editor, read-only):
```sql
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd;
```

---

## 6. Rules / gotchas for this repo

- **Deployment is two-step**: (1) run SQL in Supabase SQL Editor, (2) `npm run build` + deploy `dist/`. The live DB schema/RLS is not versioned in CI — the SQL file is the source of truth.
- **DB runs UTC, app sends IST** — see Section 1. Never introduce a bare `CURRENT_DATE` in new DB logic.
- **ASO is read-only**: it has only `allow_dashboard/allow_records/allow_reports` (+ jatha read in DB). Writes are super_admin-only everywhere.
- **`has_permission()` vs `get_user_role()`**: super_admin gets everything via the short-circuit in `has_permission()` and also via `get_user_role() = 'super_admin'` in RLS. Don't add `has_permission(...)` gates on superadmin-only policies — they're redundant and break if the deployed function is older.
- **Permissions column only exists on `users` and `role_masters`.** Never send `permissions` in payloads for other tables.
- **Frontend `hasPermission()`** in `AuthContext.jsx` mirrors the SQL `has_permission()`; keep them in sync.
- `getLocalDate()` (in `src/lib/supabase.js`) uses the **device** timezone, not forced IST. It only matches the DB's `Asia/Kolkata` logic when devices are on IST.

---

## 7. Verification checklist after changes

- `npm run build` (must pass).
- Re-run the IST functions + write policies (Section 4) in Supabase if deploying to a DB older than the last commit.
- UI: scan at ~00:10 IST; close an overnight session; CRUD on every ASO Panel tab.
- `git status` clean and commit only when asked.

---

## 8. Changelog of this session

- `sql/rls_policies_all.sql`: IST-aware `is_date_locked()`, `close_session()`, `prevent_future_session()`.
- `sql/rls_policies_all.sql`: removed `has_permission('allow_settings')` from `settings_write`, `centres_write`, `jatha_write`, `users_write`, `role_masters_write`, `depts_write`.
- `src/pages/SuperAdminPage.jsx`: `handleSubmit()` only touches `permissions` for `users`/`role_masters` tables (fixes PGRST204 → 400 on jatha_master/centres saves).
- Committed as `f84729e "Fixed the issues"`.
- `context.md` created (this file).

---

## 9. Archival Reports (branch: data-archival)

### What it is
A new section under **Reports → Downloads → Archival Reports** that lets users
download the full historical/deployment archival dataset — **combined** (all duty
types) or **filtered by duty type + optional date range**. The data originally
arrived as a ~29MB Excel export (`Archival Sheet.xlsx`, 613,470 rows, 14 columns).

### Data source — new table `archival_attendance`
- DDL: **`sql/archival_attendance_schema.sql`** (table + RLS + indexes). Run it in
  the Supabase SQL Editor BEFORE loading data.
- **Duty-type normalisation at LOAD time** (not runtime): source has 7 raw codes
  (D, JMC, JO, V, JH, J, W). We map **J → JMC** and **W → D**, leaving exactly 5
  canonical types stored in the table:
  - D = Daily duty, JMC = Jatha Major Centre, JO = Jatha Others, V = Visit, JH = Jatha Home
  - Enforced by a CHECK constraint. Resulting counts: D=496,955, JMC=72,072, JO=24,124, V=20,301, JH=18.
- Bulk loader: **`scripts/load_archival.mjs`** — reads the xlsx, normalises duty
  type + date (DD-MM-YYYY → ISO), inserts in batches. Needs `scripts/.env`
  (`VITE_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; both gitignored). To re-run
  clean, `TRUNCATE public.archival_attendance RESTART IDENTITY;` first.
  ```
  node scripts/load_archival.mjs --file "/Users/jai/Downloads/Archival Sheet.xlsx"
  ```

### Centre scoping (RLS)
Single policy `archival_read` scopes by centre:
`has_permission('allow_reports') AND centre_name IN (SELECT public.get_user_accessible_centres())`.
- Centre-scoped users (admin / centre_user) → only their centre + children.
- ASO / SUPER_ADMIN → all centres (the function already returns every centre for them).
The UI shows "Combined" and "Filtered" buttons; the CSV is built client-side from the
RLS-filtered query, so no role-specific query logic is needed in the frontend.

### Files changed (branch: data-archival)
- `sql/archival_attendance_schema.sql` (new)
- `scripts/load_archival.mjs` (new; `scripts/` already gitignored)
- `src/pages/ReportsPage.jsx` (archival state, `downloadArchivalCSV(scope)`,
  `fetchArchivalRows`, duty-type labels, UI replacing the placeholder)
- `src/index.css` (archival controls layout, ghost button)
- `CONTEXT.md` (this doc)

### Deploy order
1. Run `sql/archival_attendance_schema.sql` in the SQL Editor (creates table + RLS + indexes).
2. Create `scripts/.env` with the service-role key and run `node scripts/load_archival.mjs`.
3. `npm run build` → deploy `dist/` (Vercel).

### Verify after deploy
- `SELECT COUNT(*), COUNT(DISTINCT duty_type) FROM archival_attendance;` → `613470 / 5`.
- UI: as ASO/superadmin, Combined download returns all rows; each duty-type filter
  returns only that type; date-range filter works; as a centre-scoped user the
  download only contains their centre's records.

---

## 10. Mark latest-Sunday Daily duty as "present today" in the archive

### What it is
Copies the Daily (D) duty records of the sewadars present on the LATEST SUNDAY
into the archive under today's date, marking them present today.

- **Source:** D records on `2026-08-23` (latest Sunday in the archive; data spans
  2024-01-01 → 2026-08-29, same 5 duty types). 2,254 unique sewadars (no dups).
- **Target:** new D records on `2026-08-30` (0 rows existed).
- **Result:** 2,254 rows inserted on 08-30, all local fields copied unchanged
  (name, badge, father/husband, gender, age, dept, area, centre, status); only
  `duty_date` changes. JMC and other types NOT copied.

### Files
- `sql/mark_sunday_present_today.sql` — idempotent `INSERT … SELECT … NOT EXISTS`
  (run in SQL Editor when direct SQL access is available).
- `scripts/mark_sunday_present_today.mjs` — REST-equivalent using the service-role
  key (used here because raw SQL can't run via PostgREST). Supports `--from`,
  `--to`, `--dry-run`; idempotent (skips badges already having a target-date D
  record).

### Verified
- 08-30 count = 2254, all duty_type D.
- Spot-check (badge FB5971GA0024) shows identical 08-23 and 08-30 rows, date-only change.
- Re-run inserts 0 (idempotent). No existing rows modified/deleted.

---

## 11. Archival export — fast, uncapped downloads (branch: feat/archival-export-artifacts)

### Why this exists
The old download path had one real route: the browser paged `archival_attendance`
itself (`range()` in 5,000-row batches) with a hard `MAX_ROWS = 650000` cap. The
live table is **615,724 rows** (41 centres, 2024-01-01 → 2026-08-30, table +
indexes ≈ 135 MB), so the cap was ~34k rows from silently truncating, and every
download moved all rows through the user's tab. A server-side CSV RPC existed but
was never referenced in this file's deploy order, had no `REVOKE` (so `anon` held
`EXECUTE`), re-sorted the whole table per 100k-row `OFFSET` chunk, and quoted CSV
without neutralising spreadsheet formula prefixes.

### Three strategies, in order (`src/lib/archivalExport.js`)
1. **`artifact`** — a pre-built CSV in a private Storage bucket, returned as a
   short-lived signed URL. Only used for a *matching, still-fresh, in-scope*
   artifact. `request-archival-export` resolves the caller's scope server-side
   and will also serve a centre-scoped artifact when its `centre_scope` is a
   subset of the caller's accessible centres.
2. **`rpc`** — `get_archival_csv_chunk(...)`, Postgres builds the CSV chunk by
   chunk (default 100k rows/chunk). Still O(rows) server work, but no per-row
   round trip and no browser memory ceiling.
3. **`client`** — the old browser pager, kept as a bounded last resort (cap
   unchanged at 650,000 so behaviour on an undeployed project is identical).
   Hitting the cap now returns `truncated: true` with a message the page shows
   **and** alerts on — a partial file that looks complete is the failure this
   work exists to prevent. Nothing is ever truncated silently.

The page surfaces which strategy ran and to which file, via the
`.archival-notice` status line; `status:'queued'` is surfaced as
"no prepared file yet — a job was queued (`<jobId>`), run the worker, then try
again".

### Files
- `sql/verify_archival_export.sql` — **read-only** baseline diagnostics (row/duty
  counts, sizes, RLS + effective `EXECUTE`, `relrowsecurity`). Run before changing
  anything so you have a before/after. Contains no write statement by design.
- `sql/archival_download_rpc.sql` — hardened `csv_field` (RFC4180 quoting **plus**
  a `^[=+@\t\r-]` formula guard), `get_archival_csv_chunk` (bounded `p_limit` ≤
  100k, rejects negative `p_chunk` and reversed date ranges, `id` tie-breaker so
  chunk boundaries are stable), a supporting index
  `idx_archival_export_order (duty_date DESC, sewadar_name ASC, id ASC)`, and the
  grant line: `REVOKE ALL … FROM PUBLIC` then `GRANT EXECUTE … TO authenticated,
  service_role` — **no `anon`**.
- `sql/archival_export_jobs.sql` — `archival_export_artifacts` (artifact metadata;
  RLS on with **no** policy, `service_role` only), `archival_export_jobs`
  (owner-scoped **read**; every write is `service_role`), and
  `archival_scope_fingerprint(text[])` — `md5` of the sorted, de-duplicated centre
  list joined with `|` (`''` for an empty list), using `COLLATE "C"` so Postgres
  orders the same way JS `Array#sort()` does.
- `tools/archival_export_worker.mjs` — `service_role`-only CLI.
  `--snapshots` rebuilds the global + per-duty-type CSVs; `--jobs` drains queued
  jobs at most `--limit` (default 25) per run. Credentials come from the
  environment only (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `ARCHIVAL_EXPORT_BUCKET` or `--bucket`) — **never** from `scripts/.env`, which
  is a load-time-only file. `--dry-run` validates args and env without touching
  the network. A job with an empty `centre_scope` is refused rather than exported
  as the whole table; `centre_scope IS NULL` means global by design (only the
  endpoint writes NULL, and only for super_admin/aso).
- `supabase/functions/request-archival-export/index.ts` — the only thing that ever
  holds the service key. Verifies the caller's JWT, checks
  `has_permission('allow_reports')`, resolves the centre scope server-side from
  `get_user_accessible_centres()` (a client-supplied scope is never read), signs
  the artifact URL with `{ download: filename }`, or enqueues a job.
- `src/lib/csv.js` — **the** single CSV writer (escaping, header, filenames,
  `buildCsv`), shared by the browser, the worker and the drift test that reads
  `sql/archival_download_rpc.sql` and fails if the SQL guard class and the JS
  regex ever disagree. `src/lib/archivalExport.js` orchestrates the strategies.
- Tests: `src/lib/csv.test.js`, `src/lib/archivalExport.test.js`,
  `src/pages/ReportsPage.archival.test.jsx`, `tools/archival_export_worker.test.mjs`,
  `tools/edge_functions.test.mjs` (`node --test tools/`).

### Deploy order
1. `sql/verify_archival_export.sql` (read-only — note the baseline numbers).
2. `sql/archival_download_rpc.sql`, then `sql/archival_export_jobs.sql`, in the
   Supabase SQL Editor. Both are idempotent; re-run either safely.
3. Create a **private** Storage bucket (default name `archival-exports`). No
   public access — every download is a signed URL.
4. Run the worker once with the service key in its environment:
   `node tools/archival_export_worker.mjs --snapshots` (add `--dry-run` first to
   see what it would do). This is what makes the fast path exist at all.
5. Deploy `request-archival-export` as an Edge Function; set
   `ARCHIVAL_EXPORT_BUCKET`, and optionally `ARCHIVAL_EXPORT_ALLOWED_ORIGIN` and
   `ARCHIVAL_EXPORT_URL_TTL_SECONDS` (clamped 60–86400).
6. `npm run build` → deploy `dist/`. Optionally set
   `VITE_ARCHIVAL_EXPORT_ENDPOINT`; without it the page derives
   `${VITE_SUPABASE_URL}/functions/v1/request-archival-export`.
7. Schedule the worker (`--jobs`) if you want queued exports to drain without a
   human running it.

**Until 1–4 are done the feature is inert but not broken:** every request falls
through to the RPC, then to the browser fallback, exactly as before.

### Verify after deploy
- `sql/verify_archival_export.sql` §4b: `anon_can_execute = false`,
  `authenticated_can_execute = true`, `acl_is_open_to_public = false`.
- §3a/§3b: `archival_attendance` has exactly the `archival_read` SELECT policy;
  `archival_export_artifacts` has **no** policy and no `authenticated` grant;
  `archival_export_jobs` has exactly **one** policy (`archival_jobs_select`) and
  `authenticated` holds `SELECT` only.
- The fingerprint examples in `sql/archival_export_jobs.sql`'s header return
  exactly the documented md5 values.
- A combined download as ASO returns `strategy: 'artifact'` and a
  `Content-Disposition: attachment` response; as a centre-scoped user it returns
  only their centre tree.
- A request with a duty type that has no snapshot yet returns `status:'queued'`,
  and after `--jobs` the same request returns the artifact.
- `npm test`, `node --test tools/`, `npm run build` green.

### Retention / PII (needs a human decision)
Artifacts are CSVs of personal data (name, badge, father/husband name, gender,
age, centre) sitting in Storage. The worker stamps `expires_at` at **7 days** and
uploads each rebuild to a new versioned path (never overwriting — a CDN-cached
stale object would be served otherwise), but it does not delete anything: nothing
here removes objects or expires rows automatically. Decide and then enforce a
retention job (delete expired objects + set `is_current = false`) before this is
used at scale. A signed URL is a bearer token: it stays valid until it expires
regardless of any later permission change, so keep the TTL short and re-check
authorization on every new request.

### Known gaps
- No runtime numbers were captured: `pg_stat_statements` was not readable with
  the read-only account, so the `OFFSET`-re-sorting cost is a static hypothesis,
  not a measurement. §5 of the verifier says how to capture the before/after.
- Nothing in this section has been executed against Supabase — the SQL files are
  authored and verified by static read only; the tests cover the JS/SQL contract,
  not the deployed database.