-- =====================================================
-- CLEAN RESET: Drop and Recreate Flag/Query System
-- =====================================================

-- =====================================================
-- STEP 1: DROP all flag/query related tables
-- =====================================================
DROP TABLE IF EXISTS public.flag_audit_log CASCADE;
DROP TABLE IF EXISTS public.query_replies CASCADE;
DROP TABLE IF EXISTS public.query_replies_legacy CASCADE;
DROP TABLE IF EXISTS public.flags CASCADE;
DROP TABLE IF EXISTS public.flag_query_map CASCADE;
DROP TABLE IF EXISTS public.temp_flag_to_query CASCADE;

-- =====================================================
-- STEP 2: Add missing columns to queries (make it the unified table)
-- =====================================================
ALTER TABLE public.queries ADD COLUMN IF NOT EXISTS session_id bigint REFERENCES public.attendance_sessions(id);
ALTER TABLE public.queries ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE public.queries ADD COLUMN IF NOT EXISTS resolved_reason text;

-- Make issue_description nullable (for migrated session flags)
ALTER TABLE public.queries ALTER COLUMN issue_description DROP NOT NULL;

-- =====================================================
-- STEP 3: Create unified query_replies table
-- =====================================================
CREATE TABLE IF NOT EXISTS public.query_replies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  query_id bigint REFERENCES public.queries(id) ON DELETE CASCADE,
  replied_by_badge text NOT NULL,
  replied_by_name text NOT NULL,
  replied_by_centre text,
  replied_by_role text,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.query_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "query_replies_read" ON public.query_replies;
CREATE POLICY "query_replies_read" ON public.query_replies
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "query_replies_insert" ON public.query_replies;
CREATE POLICY "query_replies_insert" ON public.query_replies
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "query_replies_update" ON public.query_replies;
CREATE POLICY "query_replies_update" ON public.query_replies
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_query_replies_query_id ON public.query_replies(query_id);

-- =====================================================
-- STEP 4: Create unified flag_audit_log table
-- =====================================================
CREATE TABLE IF NOT EXISTS public.flag_audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  query_id bigint REFERENCES public.queries(id) ON DELETE SET NULL,
  action text NOT NULL,
  actor_badge text NOT NULL,
  actor_name text NOT NULL,
  details text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.flag_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "flag_audit_read" ON public.flag_audit_log;
CREATE POLICY "flag_audit_read" ON public.flag_audit_log
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "flag_audit_insert" ON public.flag_audit_log;
CREATE POLICY "flag_audit_insert" ON public.flag_audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_flag_audit_query_id ON public.flag_audit_log(query_id);

-- =====================================================
-- STEP 5: Create indexes on queries
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_queries_status ON public.queries(status);
CREATE INDEX IF NOT EXISTS idx_queries_raised_by_centre ON public.queries(raised_by_centre);
CREATE INDEX IF NOT EXISTS idx_queries_created_at ON public.queries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_queries_session_id ON public.queries(session_id);

-- =====================================================
-- VERIFICATION
-- =====================================================
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('queries', 'query_replies', 'flag_audit_log');
