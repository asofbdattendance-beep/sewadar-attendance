-- ============================================================
-- archival_download_rpc.sql
--
-- PURPOSE
--   The archival_attendance table can hold 600k+ rows. Downloading the
--   whole thing client-side via supabase-js `.select()` is slow and hits
--   Supabase's statement timeout (57014) because the archival_read RLS
--   policy runs the async get_user_accessible_centres() per row.
--
--   These functions build the CSV in Postgres (fast, no per-row RLS cost)
--   and return it in chunks. Run this whole file in the Supabase SQL Editor
--   BEFORE using the archival download in ReportsPage.
--
--   The frontend calls get_archival_csv_chunk() repeatedly (chunk 0 includes
--   the header row) until it gets a short/empty result, then streams each
--   chunk into the downloaded file.
--
-- USAGE (in ReportsPage.jsx):
--   supabase.rpc('get_archival_csv_chunk', {
--     p_chunk, p_duty_type, p_from, p_to, p_limit
--   })  -> TEXT (empty string == no more rows / no access)
-- ============================================================

-- NULL-safe CSV field with standard double-quote escaping
CREATE OR REPLACE FUNCTION public.csv_field(t TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN t IS NULL THEN ''
    WHEN t ~ '[",\n\r]' THEN '"' || replace(t, '"', '""') || '"'
    ELSE t
  END
$$;

-- Header string (must match the field order built in the chunk function)
-- Used by the frontend in case it needs the fallback path, and kept here as a
-- single source of truth.
CREATE OR REPLACE FUNCTION public.archival_csv_header()
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT 'Sewadar Name,Badge Number,Father/Husband Name,gender,age,Department Name,Department Id,Area Name,Centre Name,Status,Duty Type,Duty Date,Deployed Department,Deployed Centre'
$$;

-- Return one chunk (default 100000 rows) of the archival CSV as TEXT.
-- Chunk 0 includes the header row. SECURITY DEFINER bypasses RLS, but the
-- caller is still scoped to their accessible centres via
-- get_user_accessible_centres() and must have allow_reports permission.
-- Returns '' when the caller has no access or when p_chunk is past the end.
CREATE OR REPLACE FUNCTION public.get_archival_csv_chunk(
  p_chunk INT,
  p_duty_type TEXT DEFAULT NULL,
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL,
  p_limit INT DEFAULT 100000
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_csv TEXT;
BEGIN
  -- Permission gate: mirrors archival_read RLS
  IF NOT public.has_permission('allow_reports') THEN
    RETURN '';
  END IF;

  -- Fast exit if user has no accessible centres (e.g. centre is null)
  IF NOT EXISTS (SELECT 1 FROM public.get_user_accessible_centres() LIMIT 1) THEN
    RETURN '';
  END IF;

  SELECT string_agg(s.line, E'\n' ORDER BY s.sn)
  INTO v_csv
  FROM (
    SELECT
      row_number() OVER (ORDER BY duty_date DESC, sewadar_name ASC) AS sn,
      (
        public.csv_field(sewadar_name) || ',' ||
        public.csv_field(badge_number) || ',' ||
        public.csv_field(father_husband_name) || ',' ||
        public.csv_field(gender) || ',' ||
        public.csv_field(age::text) || ',' ||
        public.csv_field(department_name) || ',' ||
        public.csv_field(department_id::text) || ',' ||
        public.csv_field(area_name) || ',' ||
        public.csv_field(centre_name) || ',' ||
        public.csv_field(status) || ',' ||
        public.csv_field(duty_type) || ',' ||
        public.csv_field(to_char(duty_date, 'DD-MM-YYYY')) || ',' ||
        public.csv_field(deployed_department) || ',' ||
        public.csv_field(deployed_centre)
      ) AS line
    FROM public.archival_attendance
    WHERE centre_name IN (SELECT centre_name FROM public.get_user_accessible_centres())
      AND (p_duty_type IS NULL OR duty_type = p_duty_type)
      AND (p_from IS NULL OR duty_date >= p_from)
      AND (p_to IS NULL OR duty_date <= p_to)
    ORDER BY duty_date DESC, sewadar_name ASC
    OFFSET p_chunk * p_limit
    LIMIT p_limit
  ) s;

  IF v_csv IS NULL OR v_csv = '' THEN
    RETURN '';
  END IF;

  IF p_chunk = 0 THEN
    RETURN public.archival_csv_header() || E'\n' || v_csv;
  END IF;

  RETURN v_csv;
END;
$$;

-- Allow authenticated users to call the RPC (SECURITY DEFINER still scopes data)
GRANT EXECUTE ON FUNCTION public.csv_field(TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.archival_csv_header() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_archival_csv_chunk(INT, TEXT, DATE, DATE, INT) TO authenticated;
