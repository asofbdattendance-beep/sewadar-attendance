# Sewadar Attendance — Working Context

Session context for contributing to this repo. Read `PROJECT.md` first for the overview; this file records what was done, why, and how to deploy/verify.

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