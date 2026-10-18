# ASMS Archive — data contract

Phase 1 (this document + the four SQL files it names) is **copy-only**. Nothing is deleted,
truncated or updated in any live table. Deletion is a separate, later phase that requires
its own confirmation.

**Built, not run.** This phase authored five files. No statement in any of them has been
executed against any database — the agent session had read-only access to Supabase. Every
number quoted below is either read from a file in this repo or derived from a repo fact; the
live catalogue is checked at run time, not assumed here.

---

## 1. What problem this solves

The live ASMS tables grow without bound. The intent is to keep the current calendar month and
the previous calendar month live, and move everything older into archives that stay queryable.
This document freezes the contract for the *copy* half.

## 2. Source tables (read-only in this phase)

| Table | Columns | Key | Notes |
|---|---|---|---|
| `public.attendance_sessions` | 24 | `id` BIGINT identity, PK | the gate/scan sessions |
| `public.jatha_attendance` | 12 | `id` BIGINT, PK (legacy `nextval` default) | jatha group attendance |

**Known gap, deliberately engineered around.** There is no *current* `CREATE TABLE` for
`jatha_attendance` in this repo — not in `sql/`, `scripts/`, `src/`, `validation/`, or
`supabase/`. An April-era one survives in git history at
`fc42c48:sql/database_structure.txt:93`, with 18 columns under **different names**:
`date_from`/`date_to` (not `from_date`/`to_date`), `submitted_by`/`submitted_name`/
`submitted_centre` (not `entered_by_*`), `created_at` (not `entered_at`), plus `centre`,
`department`, `jatha_type`, `jatha_centre`, `jatha_dept`, `satsang_days`, `flag`,
`flag_reason`. That is direct evidence the table was renamed and restructured before.

The live column set, **confirmed against the deployed database on 2026-10-18**:

```
id, jatha_id, badge_number, sewadar_name, from_date, to_date,
entered_by_badge, entered_by_name, entered_at, remarks, centre, sewadar_centre
```

The first pass inferred 11 columns and **missed `centre`** — precisely the kind of error this
design refuses to depend on. `badge_number` is nullable and carries a foreign key to
`sewadars(badge_number)`; `id` is a legacy `nextval('jatha_attendance_id_seq')` default, not an
identity column. The repo's SQL is **not** applied by CI, so the *deployed* database — not this
repo — is the authority on column lists, types and nullability.

The same check on `attendance_sessions` confirms the reorder is not theoretical: the deployed
order is `... entered_by_name, created_at, updated_at, sewadar_centre, sewadar_dept`, i.e.
`sewadar_centre`/`sewadar_dept` already sit at the **end** (positions 23-24), not at 5-6 as
`sql/attendance_sessions_schema.sql` has them. Two consequences, both handled:

- the ordered column-name guard in the schema file and the backfill is the guard that matters;
- `attendance_sessions.id` *is* `GENERATED ALWAYS AS IDENTITY` (so the `id`-default drop is a
  no-op there), while `jatha_attendance.id` *is* `nextval(...)` — so for jatha that block is
  **load-bearing**, not defensive. `LIKE ... INCLUDING DEFAULTS` would otherwise copy the live
  sequence into the archive.

**The catalogue has holes, and every guard is written for that.** Both tables carry dropped
columns, so their attribute numbers are not contiguous. `attendance_sessions` has 24 live
columns at attnums **1-4 and 7-26** — attnums 5 and 6 are the *original*
`sewadar_centre`/`sewadar_dept` that `rls_policies_all.sql` dropped. `jatha_attendance` is
worse: its 12 live columns sit at attnums **1-10, 38 and 66**, so 54 columns have been dropped
over that table's life. Two consequences, both of which the files handle:

- a naive `count(*) FROM pg_attribute WHERE attrelid = ...` — i.e. without
  `AND NOT attisdropped` — reports **26 and 66**, not 24 and 12. Every count, comparison and
  guard in these four files filters `attisdropped` and orders by `attnum`, which is why they
  read 24 and 12;
- the count is the fragile instrument and the name array is the robust one. A count can be
  wrong in a way nobody sees; a name-by-name, in-order comparison cannot.

`LIKE` preserves the source's effective `attnum` order, skipping the dropped entries, and the
runtime guard re-verifies that on every run rather than trusting it.

One unrelated defect this dump exposed, worth fixing separately: the deployed
`attendance_sessions.duty_type` has `DEFAULT 'gate_entry'` while its own `CHECK` allows only
`('SATSCAN','DAILY','NIGHT','WATCH_AND_WARD','JATHA')`. The default can never satisfy the
constraint, so any insert that relies on it fails. Harmless for this archive (every value is
supplied explicitly) but it is a live bug.

Consequence: this design never transcribes a column list. It copies the live shape with
`CREATE TABLE ... (LIKE public.<source> INCLUDING DEFAULTS)` and inserts with a positional
`s.*` projection. A schema that drifts from the repo therefore cannot silently corrupt the
archive — **provided the guard is the right guard.** A column *count* is not: `sql/
rls_policies_all.sql:811-814` routinely drops and re-adds `sewadar_centre`/`sewadar_dept` on
`attendance_sessions`, which `ADD COLUMN` appends at the end. The count stays 24 while the
order changes. The guard therefore compares column **names in order** (from `pg_attribute`),
in both the schema file and the backfill, and aborts before writing anything.

## 3. Target tables (new, additive)

| Table | Purpose |
|---|---|
| `public.attendance_sessions_archive` | full-fidelity copy of `attendance_sessions` rows |
| `public.jatha_attendance_archive` | full-fidelity copy of `jatha_attendance` rows |

Both are **`LIKE`-derived** from their source, so they carry the same columns, types, NOT NULLs
and defaults, plus four appended archive columns **in this order**:

```
archived_at    TIMESTAMPTZ NOT NULL DEFAULT now()
archived_by    TEXT          -- the connecting role; 'postgres' when run from the SQL Editor
archive_batch  TEXT          -- one value per copy run, e.g. asms-archive-2026-10-18T14:22:07
source_table   TEXT NOT NULL -- NO default; CHECK (source_table = '<source>')
```

`source_table` deliberately has no default. A `NOT NULL` column *with* a default is a
type-compatible landing pad: if the positional insert ever slipped by one, a value would land
there and the row would still look self-consistent. Without a default that slip raises `23502`,
and the per-table `CHECK` narrows it further.

No primary key, foreign key, index, trigger or RLS is copied by `LIKE`; each is added
explicitly in `sql/asms_archive_schema.sql`. Two `LIKE` behaviours are load-bearing and
documented in that file so nobody deletes them as dead code:

- `INCLUDING DEFAULTS` does **not** copy `GENERATED ... AS IDENTITY` (an identity column has no
  `pg_attrdef` row), so the archive's `id` is a plain `bigint NOT NULL` and an explicit insert
  works. But it **would** copy `nextval('..._id_seq')` from a legacy `BIGSERIAL` source — a
  functional linkage to the live sequence. The `id`-default-drop block exists for exactly that
  case.
- `LIKE` copies no `CHECK` and no foreign key, so no archive row can be rejected by a live
  `duty_type`/`status` constraint, and the archive does not depend on `public.sewadars`
  surviving.

### 3.1 Why NOT `public.archival_attendance`

`archival_attendance` is a **different dataset** (`sql/archival_attendance_schema.sql:27`):
14 central-attendance columns, `duty_type CHECK (duty_type IN ('D','JMC','JO','V','JH'))`, no
session fields, no jatha fields, and no `id` relationship to ASMS rows. Its `id` is its own
identity sequence; comparing it to a session id compares two unrelated counters. Writing ASMS
sessions into it would mix two vocabularies (measured: only ~25% of August scan rows appear in
the August archival export) and destroy the ability to reconcile either. It is left untouched
and its `archival_read` policy is unchanged.

## 4. Identity and de-duplication

**Natural key = the source `id`.** It is the source table's own primary key, it is never
reused, and it is copied verbatim into the archive's `id`. The archive's PK is asserted to be
`PRIMARY KEY (id)` specifically — a PK on any other column would satisfy a loose "has a primary
key" test and then break the copy with `42P10`. Re-running a copy is therefore idempotent via
`ON CONFLICT (id) DO NOTHING`, and reconciliation is a plain `id` join.

This is the one place the archive deliberately breaks the house habit of "pre-read a Set, then
plain insert" (`scripts/load_archival.mjs`, `scripts/mark_sunday_present_today.mjs`). Those
scripts insert into a table with no conflict key; here the key is exact and server-side, and a
client-side `Set` over hundreds of thousands of rows is both slower and race-prone.

## 5. Retention cutoff (Asia/Kolkata)

```
cutoff = date_trunc('month', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE
                                - interval '1 month')::DATE
```

Keep live: current month + previous month. Archive: everything strictly before the cutoff. As
of 2026-10-18 IST this evaluates to **2026-09-01**.

The cutoff is **computed, never hardcoded**, so a re-run in a later month archives the
additional months automatically. It is recomputed inside every statement that needs it, in
all three scripts, so each statement can be run alone. The expression is the same one the
deployed `is_date_locked()` uses (`sql/rls_policies_all.sql:171`), so the archive boundary and
the permanent-lock boundary coincide.

## 6. Eligibility and exclusions

**Eligibility**

| Table | Predicate |
|---|---|
| `attendance_sessions` | `in_date < cutoff` **AND** `COALESCE(out_date, in_date) < cutoff` **AND** `status IS DISTINCT FROM 'OPEN'` |
| `jatha_attendance` | `from_date IS NOT NULL` **AND** `COALESCE(to_date, from_date) < cutoff` |

The sessions predicate carries the same whole-span test as jatha. Without it, a session opened
before the cutoff and closed after it (`in_date = 2026-08-25`, `out_date = 2026-09-20`) would be
archived even though its own span reaches into the retention window.

**Exclusions — each counted and reported, never silently dropped**

| Exclusion | Reason | Counted in |
|---|---|---|
| `attendance_sessions.status = 'OPEN'` before the cutoff | still in use; a stale open session must stay visible to scanners | preflight §A, verify §1e |
| `attendance_sessions` where `COALESCE(out_date, in_date) >= cutoff` | the session's span crosses the cutoff | preflight §A, verify §1e |
| `attendance_sessions.in_date IS NULL` | not datable, so it cannot be placed in a month | preflight §A, verify §1e |
| `jatha_attendance` where `COALESCE(to_date, from_date) >= cutoff` | the interval crosses the cutoff | preflight §A, verify §1e |
| `jatha_attendance.from_date IS NULL` | not datable | preflight §A, verify §1e |
| `sewadar_name` **and** `badge_number` NULL rows | **not** excluded — archived anyway, and counted so the number is never a surprise | preflight §A |

**One exclusion is an open decision, not a settled rule.** A jatha row with `to_date IS NULL`
is read here as a single-day entry (the same reading `check_jatha_overlap` uses), and is
therefore archived. If `NULL to_date` instead means "still deployed / not marked out", those
rows must stay live — otherwise the later deletion phase would delete a live record. The
population is counted in preflight §A and announced by the backfill, so it can never be
invisible. Decide it before any deletion phase.

## 7. Access control

Both archive tables: RLS enabled, **SELECT-only** policy, no INSERT/UPDATE/DELETE policy — and
`REVOKE ALL` followed by `GRANT SELECT`. Read-only therefore holds at **both** layers: RLS has
no write policy to allow, and the privileges carry no write bit to exercise. Dropping RLS later
would not silently grant write access.

| Table | Policy | Gate |
|---|---|---|
| `attendance_sessions_archive` | `sessions_archive_read` | (`allow_dashboard` OR `allow_records` OR `allow_scan` OR `allow_gate_entry` OR `allow_reports`) AND (`centre` accessible OR `badge_number` belongs to an accessible centre) AND (not `sc_sp_user` OR `in_scanner_centre` = own centre) |
| `jatha_attendance_archive` | `jatha_archive_read` | `allow_jatha` AND (`sewadar_centre` accessible OR (`sewadar_centre IS NULL` AND `badge_number` belongs to an accessible centre)) |

The sessions gate is the **union** of the live `sessions_read` gates plus `allow_reports`, with
the live policy's `sc_sp_user` scanner-centre clause reproduced verbatim. Taking the union means
the archive is never *narrower* than the table it mirrors: no role that can see a row live loses
it in the archive. Row scoping is unchanged — the `centre` axis with the
`badge_number → sewadars.centre` fallback. The alternative (gating on `allow_reports` alone) was
rejected because it would silently narrow access once the archive becomes the only copy; if you
want it narrower, say so and it is a one-line change.

**"All centres are retained" does not mean "every user may read all centres."**
`get_user_accessible_centres()` returns every centre only for `aso` / `super_admin`
(`sql/rls_policies_all.sql:209`), and returns **zero rows** when the user's own `users.centre`
is NULL — so a centre-less user sees nothing. That behaviour is inherited, not changed.

## 8. Run order

1. `sql/asms_archive_schema.sql` — creates the two archive tables, keys, indexes, RLS and
   grants. Additive, idempotent.
2. `sql/asms_archive_preflight.sql` — read-only dry run. Prints the cutoff, the eligibility
   split, the exclusions, the monthly breakdown (§C), the per-centre breakdown on three axes
   (§D), the source shape (§E) and — crucially — the **§B baseline grid**. **Record §B.** It is
   the before-image the verification compares against.
3. `sql/asms_archive_backfill.sql` — the copy. Reads live, writes archive only.
4. `sql/verify_asms_archive.sql` — the checks, in four sections plus a role probe.

Run 2 after 1 so the preflight can also report archive state. Run 3 and 4 **as `postgres`**
(the SQL Editor), because RLS is scoped to the runner and the live and archive tables are gated
differently — under any other role one side can be invisible and a check can pass while
comparing nothing.

## 9. The checks

| Section | What it proves | Expected |
|---|---|---|
| `§0` role probe | which role is running, and how many rows it can see in all four tables | `current_user` = `postgres` |
| `§1` coverage | every eligible live row is archived; §1a both directions, §1a-bis the *general* ineligibility test, §1b per month, §1c per scan centre, §1c-bis per home centre, §1d jatha per centre, §1e the named exclusions on the archive side | `missing = 0`, `archived_id_not_live = 0`; §1b–§1d and §1e return **zero rows / all zeros** |
| `§2` fidelity | archived values equal source values, column by column. §2a/§2a-detail sessions, §2b jatha, §2c **every** column generated from the catalogue and actively enforced, §2d no duplicate archive ids | `§2a/§2b mismatched_rows = 0`; §2c zero mismatches per table (it raises if not); §2d zero |
| `§3` live untouched | live row counts (§3a) and an every-column row-text checksum (§3b) against the preflight §B baseline; §3c no archived id has left the source | identical to §B; §3c zero |
| `§4` archive hygiene | §4a the archive is exactly the source's columns plus the four archive columns; §4b provenance columns populated and `source_table` correct; §4c RLS on, one policy, with the actual predicate text | `§4a `source_cols + 4 = archive_cols`` and the four extra names listed; §4b zeros; §4c `rls_enabled = true`, `policy_count = 1` |

§2c is a real check, not a string to copy: it builds the comparison predicate from
`pg_attribute` and `EXECUTE`s it, so it covers columns no hand-written list names, and it
raises an exception rather than leaving a failure to be spotted in a grid. §3b hashes
`t::text` for every row — every column, no column list to go stale — normalised by an explicit
inner `ORDER BY t.id`. `rls_forced = false` is expected and is printed because RLS does not
apply to a table's owner, which is precisely why §0 exists.

## 10. Rollback

Phase 1 is purely additive. Compensation, in the SQL Editor, is:

```sql
DROP TABLE IF EXISTS public.attendance_sessions_archive;
DROP TABLE IF EXISTS public.jatha_attendance_archive;
```

Both are archives. The live tables were never touched, so nothing is recoverable *from* the
archive that does not still exist in the source. Replacing `DROP` with `TRUNCATE` empties them
without dropping the policies, indexes or grants — useful if you want to re-run the copy from
a clean slate.

## 11. Open items (settle before the deletion phase)

1. **The preflight must be run against the live database, not an export.** `sql/
   recover_aug_manual_scans.sql` holds 1,102 distinct August session inserts of which only 48
   appear in the August export — an export can lag the live table by more than a thousand rows.
   The §B baseline is only a baseline if it came from the live DB at run time.
   **Satisfied 2026-10-18** — the preflight was run against the live database, so §B is a live
   baseline.
2. ~~**`NULL to_date` on jatha (§6).**~~ **CLOSED 2026-10-18.** Measured against the live table:
   `SELECT count(*) FROM public.jatha_attendance WHERE to_date IS NULL` → **0**. There are no NULL
   `to_date` rows to mis-read, so the single-day reading cannot cause data loss in the purge.
   Re-open this item if such a row ever exists before a future purge.
3. **The sessions archive gate is the union of the live gates (§7).** Chosen so the archive is
   never narrower than live. If reports-only access is wanted, that is a one-line tightening.
4. **`jatha_attendance` has no versioned DDL.** The `LIKE` design neutralises this for the
   archive, but the repo should still gain a captured `CREATE TABLE` for it. Until then the
   column-name guard is the only thing standing between a reorder and a silent mis-map.
5. App surfacing of the archives (a Reports-page download per archive table) was the
   conditional task #7 in the plan and is **not** included — it changes a working page and needs
   explicit go-ahead.
6. How to retain the generated reconciliation/absence reports (dated audit snapshots, not
   attendance facts) is **not** implemented here.

## 12. Explicitly out of scope (phase 1 files)

The five phase-1 files — `asms_archive_schema.sql`, `asms_archive_preflight.sql`,
`asms_archive_backfill.sql`, `verify_asms_archive.sql` and this document — contain no `DELETE`,
`TRUNCATE` or `UPDATE` against `attendance_sessions` or `jatha_attendance`. The only writes
anywhere in them are the two `INSERT … SELECT` statements into the archive tables. No change to
`archival_attendance`, its RPC or its UI; no change to any existing policy, index, trigger,
function or row. Verified statically: destructive verbs appear only on archive tables (phase 1)
or live source tables (phase 2, below).

## 13. Phase 2 — the purge

Two files, both written after phase 1 was verified. Additive first, destructive last: they are
deliberately not in the same deploy as the copy.

| File | Nature |
|---|---|
| `sql/asms_archive_purge.sql` | **Destructive.** Deletes eligible rows from the live tables. |
| `sql/verify_asms_archive_purge.sql` | Read-only post-purge verification. |

**Defaults to a dry run.** One line — `set_config('asms.purge_arm', 'NO', false)` in §2 — arms
it. Until that reads `'YES'` both delete blocks print a `NOT ARMED` notice and `RETURN`, so the
whole file can be run repeatedly with zero effect while still printing the preview and report.
The preview precedes the arm line, so the counts are readable without arming.

**Four gates run immediately before each delete.** (0) **no inbound foreign key may mutate
another table.** If any other table declares a foreign key referencing that source table with
`ON DELETE CASCADE`, `SET NULL` or `SET DEFAULT`, the delete would silently change rows in a
table the archive knows nothing about — so the block raises and names the offending reference
instead of proceeding. The check deliberately matches on the referenced *table* (`confrelid`),
not on a column, so a reference to any unique key counts; an `ON DELETE NO ACTION`/`RESTRICT`
reference needs no gate because Postgres itself will refuse the delete loudly. This gate was
added after the first reviewed version, which had no inbound-reference check at all.
(1) no eligible live row may be absent from the archive; (2) no eligible live row may differ
from its archive counterpart in **any** column — the comparison predicate is generated from
`pg_attribute`, so it covers columns no file names; (3) the `DELETE` targets exactly the rows
gates 1–2 just proved. A failure raises and deletes nothing. The cutoff is recomputed inside
the file, so if a month has rolled over since the copy, newly-eligible rows are absent from
the archive, gate 1 fires, and nothing is deleted.

**Retention:** current and previous calendar months stay live; everything strictly older that
passes the gates is removed. Open sessions and sessions whose span crosses the cutoff are never
eligible; so are jatha rows with a NULL `from_date`. The sessions half of that NULL guard is
**structurally dead**: `attendance_sessions.in_date` is `NOT NULL` (verified from
`information_schema`), so the `in_date IS NULL` preview row and its twin clause in the predicate
can only ever evaluate false. It is kept for symmetry with jatha, not as protection — the real
protection there is the column's own NOT NULL constraint. Do not read a `0` on that preview row as
evidence of anything.

**Do not re-run `verify_asms_archive.sql` as a post-purge gate.** Its §3c asserts "no archive id
is missing from live", which a purge deliberately inverts. The post-purge check that replaces it
is `verify_asms_archive_purge.sql` §4: an archived row absent from live *and* not eligible by the
purge predicate is real data loss; everything else is expected.

**One transaction.** The SQL Editor runs a multi-statement batch in a single transaction, so a
failure in the second delete block can roll the first back with it. Each block therefore proves
its own coverage rather than relying on the other.

**Reversibility.** The archive holds every column of every deleted row, so the purge can be
undone by re-inserting from it — `INSERT INTO public.attendance_sessions OVERRIDING SYSTEM VALUE
SELECT …` (required: the live `id` is `GENERATED ALWAYS AS IDENTITY`; `jatha_attendance.id` is a
plain `nextval` default and needs no such clause). This makes the archive the copy of record,
which is why no file here ever drops or truncates an archive table.

## 14. Verified evidence (2026-10-18)

Everything below was produced by the user running the read-only scripts against the live database.
No file in this repository executed anything against Supabase.

**Source shape — taken from `information_schema.columns`, not from repo DDL.**
`attendance_sessions`: 24 effective columns at ordinal positions 1–4 and 7–26 (positions **5 and
6 are dropped**); `id` is an identity column; `in_date` is `NOT NULL`; `badge_number` is nullable;
`duty_type` defaults to `'gate_entry'`, `status` to `'OPEN'`.
`jatha_attendance`: 12 effective columns at positions 1–10, **38** (`centre`) and **66**
(`sewadar_centre`); `id` defaults to `nextval('jatha_attendance_id_seq')` and is **not** an
identity column; `from_date` and `to_date` are both nullable. This listing is the authority the
`LIKE`-derived archives were built from, and it is why the mirror guard compares column **names in
order** instead of counting them — a count cannot see the 25/26 reorder, and both the gap at 5–6
and jatha's gaps would defeat a positional read of the repo's DDL.

**Archive tables.** Created 4 columns wider than each source (28 vs 24, 16 vs 12). RLS enabled,
`relforcerowsecurity` false, exactly one `SELECT` policy each, with `qual` text matching §7:
`sessions_archive_read` = (dashboard ∨ records ∨ scan ∨ gate_entry ∨ reports) ∧ (centre is
accessible ∨ the badge's home centre is accessible) ∧ (not `sc_sp_user` ∨ `in_scanner_centre` is
the user's own centre); `jatha_archive_read` = `allow_jatha` ∧ (`sewadar_centre` accessible ∨
(NULL `sewadar_centre` ∧ badge falls back to an accessible home centre)).

**Copy.** 4,161 session rows and 6,305 jatha rows, batch `asms-archive-2026-10-18T13:27:01`, with
0 archived ids absent from live.

**Purge dry run (unarmed), read from the file's own §4 report.** `arm_state` = `NO`; live rows
**33,607** sessions and **8,831** jatha; archive rows 4,161 and 6,305; `eligible_still_live` 4,161
and 6,305. The eligible set still exactly equals the archived set, so the earlier unarmed run
deleted nothing. The purge's own gates re-prove that identity at delete time. Post-purge
arithmetic: **29,446** sessions and **2,526** jatha rows remain live.

**Live policies unchanged** (§6b): `attendance_sessions` → `sessions_delete` (DELETE),
`sessions_insert`, `sessions_read` (SELECT), `sessions_update`; `jatha_attendance` →
`jatha_att_read` (SELECT), `jatha_att_write` (ALL).
