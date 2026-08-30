-- ============================================================
-- ONE-SHOT FULL DATABASE JSON EXPORT (all public tables in a single result)
-- Run the whole file in the Supabase SQL Editor, then click the Download
-- button on the LAST result — it contains every public table as JSON,
-- keyed by table name inside a single JSON object.
--
-- How it works: creates a helper function that loops over every public
-- base table, runs dynamic SQL per table, and assembles one JSON object.
-- ============================================================

-- 1) Create the helper (run once)
CREATE OR REPLACE FUNCTION public.dump_all_tables_as_json()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r        RECORD;
  v_obj    jsonb := '{}'::jsonb;
  v_rows   jsonb;
  q        text;
BEGIN
  FOR r IN
    SELECT t.table_name
    FROM information_schema.tables t
    WHERE t.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND t.table_name NOT LIKE 'pg_%'
    ORDER BY t.table_name
  LOOP
    q := format(
      'SELECT COALESCE(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) FROM (SELECT * FROM public.%I) x',
      r.table_name
    );
    EXECUTE q INTO v_rows;
    v_obj := v_obj || jsonb_build_object(r.table_name, v_rows);
  END LOOP;
  RETURN v_obj;
END;
$$;

-- 2) Get the whole database as ONE JSON object (keyed by table name)
SELECT jsonb_pretty(public.dump_all_tables_as_json()) AS full_database_export;

-- 3) Cleanup (optional): drop the helper when done
-- DROP FUNCTION public.dump_all_tables_as_json();
