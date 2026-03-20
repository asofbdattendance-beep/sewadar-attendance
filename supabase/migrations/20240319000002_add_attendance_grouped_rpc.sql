-- Migration: Add get_attendance_grouped RPC function
-- Returns one row per (badge_number, IST date), with earliest IN and latest OUT per day

DROP FUNCTION IF EXISTS public.get_attendance_grouped(timestamptz, timestamptz, text[], text);

CREATE OR REPLACE FUNCTION public.get_attendance_grouped(
  p_start   timestamptz,
  p_end     timestamptz,
  p_centres text[],
  p_search  text
)
RETURNS TABLE (
  badge_number text,
  sewadar_name text,
  centre       text,
  department   text,
  ist_date     date,
  in_time      timestamptz,
  out_time     timestamptz,
  in_scanner   text,
  out_scanner  text,
  in_id        bigint,
  out_id       bigint,
  manual_entry boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH
  -- Convert scan_time to IST date for grouping
  scope AS (
    SELECT
      a.badge_number,
      a.sewadar_name,
      a.centre,
      a.department,
      (a.scan_time AT TIME ZONE 'Asia/Kolkata')::date AS ist_date,
      a.type,
      a.scan_time,
      a.scanner_name,
      a.id,
      a.manual_entry
    FROM public.attendance a
    WHERE a.scan_time >= p_start
      AND a.scan_time <= p_end
      AND (p_centres IS NULL OR a.centre = ANY(p_centres))
      AND (p_search IS NULL
        OR a.badge_number ILIKE '%' || p_search || '%'
        OR a.sewadar_name ILIKE '%' || p_search || '%')
  ),
  -- Earliest IN per badge per IST date
  earliest_in AS (
    SELECT DISTINCT ON (badge_number, ist_date)
      badge_number, ist_date, scan_time AS in_time,
      scanner_name AS in_scanner, id AS in_id, manual_entry
    FROM scope WHERE type = 'IN'
    ORDER BY badge_number, ist_date, scan_time ASC
  ),
  -- Latest OUT per badge per IST date
  latest_out AS (
    SELECT DISTINCT ON (badge_number, ist_date)
      badge_number, ist_date, scan_time AS out_time,
      scanner_name AS out_scanner, id AS out_id
    FROM scope WHERE type = 'OUT'
    ORDER BY badge_number, ist_date, scan_time DESC
  ),
  -- Distinct badge/date/centre combinations
  badge_days AS (
    SELECT DISTINCT ON (s.badge_number, s.ist_date)
      s.badge_number, s.sewadar_name, s.centre, s.department, s.ist_date
    FROM scope s
    ORDER BY s.badge_number, s.ist_date, s.scan_time ASC
  )
  SELECT
    bd.badge_number,
    bd.sewadar_name,
    bd.centre,
    bd.department,
    bd.ist_date,
    ei.in_time,
    lo.out_time,
    ei.in_scanner,
    lo.out_scanner,
    ei.in_id,
    lo.out_id,
    COALESCE(ei.manual_entry, false) AS manual_entry
  FROM badge_days bd
  LEFT JOIN earliest_in ei ON ei.badge_number = bd.badge_number AND ei.ist_date = bd.ist_date
  LEFT JOIN latest_out  lo ON lo.badge_number = bd.badge_number  AND lo.ist_date = bd.ist_date
  ORDER BY bd.ist_date DESC, bd.badge_number ASC;
END;
$$;
