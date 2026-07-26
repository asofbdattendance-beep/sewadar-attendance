-- ============================================================
-- SCHEDULE MODULE — Separate from attendance tables
-- Tables: jatha_schedules, jatha_schedule_entries, jatha_schedule_allocations
-- These tables and their RLS policies are independent of attendance.
-- ============================================================

-- ============================================================
-- TABLE: jatha_schedules (header)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.jatha_schedules (
  id BIGSERIAL PRIMARY KEY,
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('bhati', 'specific')),
  title TEXT NOT NULL,
  month INT CHECK (month BETWEEN 1 AND 12),
  year INT,
  from_date DATE,
  to_date DATE,
  location TEXT,
  created_by UUID REFERENCES public.users(auth_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: jatha_schedule_entries (row-level allocations)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.jatha_schedule_entries (
  id BIGSERIAL PRIMARY KEY,
  schedule_id BIGINT NOT NULL REFERENCES public.jatha_schedules(id) ON DELETE CASCADE,
  day_of_week INT CHECK (day_of_week BETWEEN 0 AND 6),
  department TEXT,
  jatha_type TEXT,
  date DATE,
  centre TEXT NOT NULL,
  count INT NOT NULL DEFAULT 1 CHECK (count >= 0),
  created_by UUID REFERENCES public.users(auth_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add jatha_type column if not exists (idempotent)
DO $$ BEGIN
  ALTER TABLE public.jatha_schedule_entries ADD COLUMN IF NOT EXISTS jatha_type TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

ALTER TABLE public.jatha_schedule_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jatha_schedule_entries_read ON public.jatha_schedule_entries;
DROP POLICY IF EXISTS jatha_schedule_entries_write ON public.jatha_schedule_entries;

CREATE POLICY jatha_schedule_entries_read ON public.jatha_schedule_entries
  FOR SELECT TO authenticated
  USING (
    public.get_user_role() IN ('super_admin', 'aso')
    OR centre IN (SELECT public.get_user_accessible_centres())
  );

CREATE POLICY jatha_schedule_entries_write ON public.jatha_schedule_entries
  FOR ALL TO authenticated
  USING (
    public.get_user_role() = 'super_admin'
    OR (
      public.get_user_role() IN ('admin', 'aso')
      AND centre IN (SELECT public.get_user_accessible_centres())
      AND public.has_permission('allow_jatha')
    )
  )
  WITH CHECK (
    public.get_user_role() = 'super_admin'
    OR (
      public.get_user_role() IN ('admin', 'aso')
      AND centre IN (SELECT public.get_user_accessible_centres())
      AND public.has_permission('allow_jatha')
    )
  );

DROP INDEX IF EXISTS idx_jatha_schedule_entries_schedule;
CREATE INDEX idx_jatha_schedule_entries_schedule ON public.jatha_schedule_entries(schedule_id);

DROP INDEX IF EXISTS idx_jatha_schedule_entries_centre;
CREATE INDEX idx_jatha_schedule_entries_centre ON public.jatha_schedule_entries(centre);

-- Unique constraints
DROP INDEX IF EXISTS uq_entry_specific;
CREATE UNIQUE INDEX IF NOT EXISTS uq_entry_specific
  ON public.jatha_schedule_entries (schedule_id, department, centre)
  WHERE day_of_week IS NULL;

DROP INDEX IF EXISTS uq_entry_bhati;
CREATE UNIQUE INDEX IF NOT EXISTS uq_entry_bhati
  ON public.jatha_schedule_entries (schedule_id, department, centre, day_of_week)
  WHERE day_of_week IS NOT NULL;

-- ============================================================
-- TABLE: jatha_schedule_allocations (soft distribution overlay)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.jatha_schedule_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id BIGINT NOT NULL REFERENCES public.jatha_schedule_entries(id) ON DELETE CASCADE,
  centre TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.jatha_schedule_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jatha_schedule_allocations_read ON public.jatha_schedule_allocations;
CREATE POLICY jatha_schedule_allocations_read ON public.jatha_schedule_allocations
  FOR SELECT TO authenticated
  USING (
    centre IN (SELECT public.get_user_accessible_centres())
    OR entry_id IN (
      SELECT id FROM public.jatha_schedule_entries
      WHERE centre IN (SELECT public.get_user_accessible_centres())
    )
  );

DROP POLICY IF EXISTS jatha_schedule_allocations_write ON public.jatha_schedule_allocations;
CREATE POLICY jatha_schedule_allocations_write ON public.jatha_schedule_allocations
  FOR ALL TO authenticated
  USING (
    public.has_permission('allow_jatha')
    AND entry_id IN (
      SELECT id FROM public.jatha_schedule_entries
      WHERE centre IN (SELECT public.get_user_accessible_centres())
    )
  )
  WITH CHECK (
    public.has_permission('allow_jatha')
    AND entry_id IN (
      SELECT id FROM public.jatha_schedule_entries
      WHERE centre IN (SELECT public.get_user_accessible_centres())
    )
  );

DROP INDEX IF EXISTS idx_jatha_schedule_allocations_entry;
CREATE INDEX idx_jatha_schedule_allocations_entry ON public.jatha_schedule_allocations(entry_id);

DROP INDEX IF EXISTS idx_jatha_schedule_allocations_centre;
CREATE INDEX idx_jatha_schedule_allocations_centre ON public.jatha_schedule_allocations(centre);

-- ============================================================
-- RLS for jatha_schedules (enabled after entries table exists)
-- ============================================================
ALTER TABLE public.jatha_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jatha_schedules_read ON public.jatha_schedules;
DROP POLICY IF EXISTS jatha_schedules_write ON public.jatha_schedules;

CREATE POLICY jatha_schedules_read ON public.jatha_schedules
  FOR SELECT TO authenticated
  USING (
    public.get_user_role() IN ('super_admin', 'aso')
    OR EXISTS (
      SELECT 1 FROM public.jatha_schedule_entries e
      WHERE e.schedule_id = id
      AND e.centre IN (SELECT public.get_user_accessible_centres())
    )
  );

CREATE POLICY jatha_schedules_write ON public.jatha_schedules
  FOR ALL TO authenticated
  USING (
    public.get_user_role() = 'super_admin'
    OR (
      public.get_user_role() IN ('admin', 'aso')
      AND public.has_permission('allow_jatha')
      AND EXISTS (
        SELECT 1 FROM public.jatha_schedule_entries e
        WHERE e.schedule_id = id
        AND e.centre IN (SELECT public.get_user_accessible_centres())
      )
    )
  )
  WITH CHECK (
    public.get_user_role() = 'super_admin'
    OR (
      public.get_user_role() IN ('admin', 'aso')
      AND public.has_permission('allow_jatha')
    )
  );
