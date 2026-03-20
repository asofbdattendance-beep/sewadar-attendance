-- Migration: Add get_attendance_counts RPC function for scoped quick filter counts
-- Run this after the initial schema is set up

CREATE OR REPLACE FUNCTION public.get_attendance_counts(
  p_start timestamptz,
  p_end timestamptz,
  p_centres text[],
  p_search text
)
RETURNS TABLE (
  total bigint,
  in_only bigint,
  out_only bigint,
  manual bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH scope AS (
    SELECT DISTINCT badge_number, scan_time, type, manual_entry
    FROM public.attendance a
    WHERE a.scan_time >= p_start
      AND a.scan_time <= p_end
      AND (p_centres IS NULL OR a.centre = ANY(p_centres))
      AND (p_search IS NULL
        OR a.badge_number ILIKE '%' || p_search || '%'
        OR a.sewadar_name ILIKE '%' || p_search || '%'
      )
  ),
  grouped AS (
    SELECT
      s.badge_number,
      bool_or(s.type = 'IN')  AS has_in,
      bool_or(s.type = 'OUT') AS has_out,
      bool_or(s.manual_entry) AS has_manual
    FROM scope s
    GROUP BY s.badge_number
  )
  SELECT
    COUNT(*)::bigint AS total,
    COUNT(*) FILTER (WHERE has_in AND NOT has_out)::bigint AS in_only,
    COUNT(*) FILTER (WHERE has_out AND NOT has_in)::bigint AS out_only,
    COUNT(*) FILTER (WHERE has_manual)::bigint AS manual
  FROM grouped;
END;
$$;
