-- ============================================================
-- archival_attendance — archival download table for the attendance app.
--
-- PURPOSE
--   Backs the "Archival Reports" section of Reports → Downloads. The full
--   historical/deployment dataset (originally delivered as a ~29MB Excel
--   export with 613,470 rows) is bulk-loaded into this table via
--   scripts/load_archival.mjs, then filtered and downloaded from the UI.
--
-- DUTY TYPE NORMALISATION (applied at LOAD time, not runtime)
--   Source uses 7 raw codes: D, JMC, JO, V, JH, J, W.
--   We map  J -> JMC   and   W -> D, yielding exactly 5 canonical codes:
--     D   = Daily duty
--     JMC = Jatha Major Centre
--     JO  = Jatha Others
--     V   = Visit
--     JH  = Jatha Home
--   A CHECK constraint enforces these so no stray code can be inserted later.
--
-- CENTRE SCOPING / RLS
--   Centre-scoped users (admin / centre_user) see ONLY rows whose centre_name
--   is within their accessible centres (own centre + children). ASO and
--   SUPER_ADMIN see ALL rows — get_user_accessible_centres() already returns
--   every centre for those roles, so a single policy handles both cases.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.archival_attendance (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sewadar_name        TEXT,
  badge_number        TEXT,
  father_husband_name TEXT,
  gender              TEXT,
  age                 TEXT,             -- source keeps age as string ("49")
  department_name     TEXT,
  department_id       TEXT,
  area_name           TEXT,
  centre_name         TEXT,             -- used for centre-scoped RLS
  status              TEXT,             -- OPEN / PERMANENT / ELDERLY / VSS
  duty_type           TEXT CHECK (duty_type IN ('D', 'JMC', 'JO', 'V', 'JH')),
  duty_date           DATE,             -- converted from DD-MM-YYYY to ISO
  deployed_department TEXT,
  deployed_centre     TEXT
);

-- Only SELECT is ever needed from the app; no inserts/updates directly.
ALTER TABLE public.archival_attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS archival_read ON public.archival_attendance;
CREATE POLICY archival_read ON public.archival_attendance
  FOR SELECT TO authenticated
  USING (
    public.has_permission('allow_reports')
    AND centre_name IN (SELECT public.get_user_accessible_centres())
  );

-- Indexes for the filter/scope paths
CREATE INDEX IF NOT EXISTS idx_archival_centre_name ON public.archival_attendance (centre_name);
CREATE INDEX IF NOT EXISTS idx_archival_duty_type   ON public.archival_attendance (duty_type);
CREATE INDEX IF NOT EXISTS idx_archival_duty_date   ON public.archival_attendance (duty_date);
-- Composite index for the common filtered + ordered download path
CREATE INDEX IF NOT EXISTS idx_archival_centre_duty_date ON public.archival_attendance (centre_name, duty_type, duty_date DESC);
CREATE INDEX IF NOT EXISTS idx_archival_duty_date_name ON public.archival_attendance (duty_date DESC, sewadar_name ASC);
