// ============================================================================
// request-archival-export — authorize, then serve a signed URL or queue a job
// ============================================================================
//
// POST /functions/v1/request-archival-export
//   Authorization: Bearer <the caller's Supabase access token>
//   body: { dutyType?: 'D'|'JMC'|'JO'|'V'|'JH'|null, dateFrom?: 'YYYY-MM-DD', dateTo?: 'YYYY-MM-DD' }
//
// Answers with exactly one of:
//   { status: 'ready', url, filename, expiresAt, rowCount }   a pre-built artifact
//   { status: 'queued', jobId, deduplicated? }                work for the worker
//
// WHAT THIS FUNCTION REFUSES TO DO
//   * It never reads a scope (centres, roles, row filters) from the request body.
//     The caller's centres come from public.get_user_accessible_centres() and
//     their permission from public.has_permission('allow_reports'), both executed
//     with the CALLER's token, so RLS and auth.uid() decide, not the request.
//   * It never returns, echoes or logs the service-role key or any env value.
//     Responses are built from an explicit field allowlist.
//   * It never trusts a row in archival_export_artifacts: a centre artifact is
//     signed only if its stored centre_scope is a subset of the caller's centres.
//
// Pieces it relies on (all authored in sql/archival_export_jobs.sql):
//   archival_export_artifacts       service-role only, RLS on with no policies
//   archival_export_jobs            owner-scoped SELECT; service-role writes only
//   archival_scope_fingerprint()    md5 over the sorted centre set ('|' joined)
//
// Supabase verifies the JWT at the platform edge (verify_jwt defaults to true);
// the explicit auth check below is the second, authoritative gate and is the one
// that decides what this function returns.
//
// Secrets: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the
// platform into this function's environment only. They are never sent to the
// browser. The caller's own token is used for every authorization decision.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
// The user-scoped client still needs an api key; the per-request Authorization
// header is what PostgREST reads for the role, so the anon key is the right one
// here. If it is missing we fall back to the service key as the *api key* only —
// the forwarded bearer token still determines the role.
const API_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? SERVICE_ROLE_KEY;
const BUCKET = Deno.env.get('ARCHIVAL_EXPORT_BUCKET') ?? 'archival-exports';
const ALLOWED_ORIGIN = Deno.env.get('ARCHIVAL_EXPORT_ALLOWED_ORIGIN') ?? '*';

const DUTY_TYPES = ['D', 'JMC', 'JO', 'V', 'JH'];
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;
// Re-requesting the same export inside this window reuses the queued/processing
// row instead of enqueuing another 600k-row job. This is the only rate limit on
// the queue, so keep it generous.
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

const TTL_SECONDS = clamp(
  Number(Deno.env.get('ARCHIVAL_EXPORT_URL_TTL_SECONDS') ?? 3600),
  MIN_TTL_SECONDS,
  MAX_TTL_SECONDS,
);

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return hi;
  return Math.min(Math.max(Math.trunc(n), lo), hi);
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
  };
}

// Responses are always built from this one place, with an explicit field
// allowlist, so no env value or database row can ride along by accident.
function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json',
      // A signed URL must never be cached by a proxy or the browser's disk cache:
      // it is scoped to one caller and has a short life.
      'Cache-Control': 'no-store',
    },
  });
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

type RequestedExport = { dutyType: string | null; dateFrom: string | null; dateTo: string | null };

// Pure, and deliberately strict: only the three known fields are read, and they
// are the only thing the caller can influence. Unknown keys are ignored rather
// than echoed.
function parseRequest(raw: unknown): RequestedExport {
  const body = (raw ?? {}) as Record<string, unknown>;

  let dutyType: string | null = null;
  if (body.dutyType !== undefined && body.dutyType !== null && body.dutyType !== '') {
    if (typeof body.dutyType !== 'string') throw new Error('dutyType must be a string');
    const upper = body.dutyType.trim().toUpperCase();
    if (!DUTY_TYPES.includes(upper)) throw new Error(`dutyType must be one of ${DUTY_TYPES.join(', ')}`);
    dutyType = upper;
  }

  const dateFrom = body.dateFrom === undefined || body.dateFrom === null || body.dateFrom === '' ? null : body.dateFrom;
  const dateTo = body.dateTo === undefined || body.dateTo === null || body.dateTo === '' ? null : body.dateTo;
  if (dateFrom !== null && !isIsoDate(dateFrom)) throw new Error('dateFrom must be YYYY-MM-DD');
  if (dateTo !== null && !isIsoDate(dateTo)) throw new Error('dateTo must be YYYY-MM-DD');
  if (dateFrom && dateTo && dateFrom > dateTo) throw new Error('dateFrom must not be after dateTo');

  return { dutyType, dateFrom, dateTo };
}

// PostgREST has no "= NULL"; NULL filters need `is`. Keeping this in one place
// stops a filter from being silently dropped on the way out.
function eqOrNull<T>(query: T, column: string, value: string | null): T {
  const q = query as unknown as { eq: (c: string, v: string) => T; is: (c: string, v: null) => T };
  return value === null ? q.is(column, null) : q.eq(column, value);
}

function basename(path: string): string {
  const parts = String(path).split('/');
  return parts[parts.length - 1] || 'archival.csv';
}

function isSubset(scope: unknown, allowed: string[]): boolean {
  if (!Array.isArray(scope) || scope.length === 0) return false;
  const set = new Set(allowed);
  return scope.every((c) => typeof c === 'string' && set.has(c));
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const requestId = crypto.randomUUID();

  try {
    const header = req.headers.get('Authorization') ?? '';
    if (!header.toLowerCase().startsWith('bearer ')) return json({ error: 'unauthorized' }, 401);
    const token = header.slice(7).trim();
    if (!token) return json({ error: 'unauthorized' }, 401);

    let requested: RequestedExport;
    try {
      requested = parseRequest(await req.json());
    } catch (err) {
      return json({ error: 'invalid_request', detail: String((err as Error).message) }, 400);
    }

    // ---- 1. Who is asking? (caller's token, not ours) ----------------------
    const asUser = createClient(SUPABASE_URL, API_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await asUser.auth.getUser(token);
    if (userError || !userData?.user?.id) return json({ error: 'unauthorized' }, 401);
    const userId = userData.user.id;

    // ---- 2. May they read reports at all? ---------------------------------
    const { data: allowed, error: permissionError } = await asUser.rpc('has_permission', {
      p_perm_key: 'allow_reports',
    });
    if (permissionError) {
      console.error(`[${requestId}] has_permission failed: ${permissionError.message}`);
      return json({ error: 'internal_error', requestId }, 500);
    }
    if (allowed !== true) return json({ error: 'forbidden' }, 403);

    // ---- 3. Which centres may they read? ----------------------------------
    // Fail-safe: if this fails, or resolves to nothing, the request is refused
    // rather than widened.
    const { data: centres, error: centreError } = await asUser.rpc('get_user_accessible_centres');
    if (centreError) {
      console.error(`[${requestId}] get_user_accessible_centres failed: ${centreError.message}`);
      return json({ error: 'internal_error', requestId }, 500);
    }
    const allowedCentres: string[] = (Array.isArray(centres) ? centres : []).filter(
      (c: unknown): c is string => typeof c === 'string' && c.trim() !== '',
    );
    if (allowedCentres.length === 0) return json({ error: 'forbidden' }, 403);

    // Role only decides the snapshot path (whole-table artifacts). A failed read
    // leaves the caller centre-scoped, which is the narrower, safe answer.
    const { data: profile } = await asUser
      .from('users')
      .select('role, name, email')
      .eq('auth_id', userId)
      .maybeSingle();
    const role = (profile as { role?: string } | null)?.role ?? '';
    const unrestricted = role === 'super_admin' || role === 'aso';

    // A global snapshot exists only for "everything, no date filter". Any date
    // filter needs the worker, even for an ASO.
    const isGlobalScope = unrestricted && !requested.dateFrom && !requested.dateTo;

    // Fingerprint comes from the SQL function so the endpoint, the worker and
    // archival_scope_fingerprint can never disagree.
    let fingerprint = '';
    if (!isGlobalScope) {
      const { data: fp, error: fpError } = await asUser.rpc('archival_scope_fingerprint', {
        p_centres: allowedCentres,
      });
      if (fpError) {
        console.error(`[${requestId}] archival_scope_fingerprint failed: ${fpError.message}`);
        return json({ error: 'internal_error', requestId }, 500);
      }
      fingerprint = typeof fp === 'string' ? fp : '';
      if (!fingerprint) return json({ error: 'internal_error', requestId }, 500);
    }

    // ---- 4. Everything below is service-role work ---------------------------
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ---- 4a. Is there a current artifact for exactly this export? ----------
    try {
      let query = admin
        .from('archival_export_artifacts')
        .select('artifact_bucket, artifact_path, row_count, expires_at, centre_scope')
        .eq('is_current', true)
        .order('generated_at', { ascending: false })
        .limit(1);

      if (isGlobalScope) {
        query = query.eq('scope', 'global').is('date_from', null).is('date_to', null);
      } else {
        query = query.eq('scope', 'centre').eq('scope_fingerprint', fingerprint);
      }
      // eqOrNull, not eq: PostgREST reads `date_from=eq.null` as 'equals NULL',
      // which matches nothing, so an unfiltered request would never find the
      // unfiltered artifact.
      query = eqOrNull(query, 'duty_type', requested.dutyType);
      query = eqOrNull(query, 'date_from', requested.dateFrom);
      query = eqOrNull(query, 'date_to', requested.dateTo);

      const { data: artifacts, error: artifactError } = await query;
      if (artifactError) {
        console.error(`[${requestId}] artifact lookup failed: ${artifactError.message}`);
      }

      const artifact = (artifacts ?? [])[0] as
        | { artifact_bucket: string; artifact_path: string; row_count: number | null; expires_at: string | null; centre_scope: string[] | null }
        | undefined;

      const fresh = artifact?.expires_at ? new Date(artifact.expires_at).getTime() > Date.now() : true;
      const scopeOk = isGlobalScope || isSubset(artifact?.centre_scope, allowedCentres);

      if (artifact && fresh && scopeOk) {
        const bucketName = artifact.artifact_bucket || BUCKET;
        const { data: signed, error: signError } = await admin.storage
          .from(bucketName)
          .createSignedUrl(artifact.artifact_path, TTL_SECONDS);
        if (signError) {
          console.error(`[${requestId}] createSignedUrl failed: ${signError.message}`);
        } else if (signed?.signedUrl) {
          return json({
            status: 'ready',
            url: signed.signedUrl,
            filename: basename(artifact.artifact_path),
            expiresAt: new Date(Date.now() + TTL_SECONDS * 1000).toISOString(),
            rowCount: artifact.row_count ?? null,
          });
        }
      }
    } catch (err) {
      // An artifact lookup can only ever cost time: fall through to the queue.
      console.error(`[${requestId}] artifact path error: ${String((err as Error).message)}`);
    }

    // ---- 4b. Queue it for the worker --------------------------------------
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
    let existingQuery = admin
      .from('archival_export_jobs')
      .select('id')
      .eq('requested_by', userId)
      .in('status', ['queued', 'processing'])
      .eq('scope_fingerprint', fingerprint)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1);
    existingQuery = eqOrNull(existingQuery, 'duty_type', requested.dutyType);
    existingQuery = eqOrNull(existingQuery, 'date_from', requested.dateFrom);
    existingQuery = eqOrNull(existingQuery, 'date_to', requested.dateTo);

    const { data: existing, error: existingError } = await existingQuery;
    if (existingError) console.error(`[${requestId}] job dedupe lookup failed: ${existingError.message}`);
    const existingId = (existing ?? [])[0]?.id as string | undefined;
    if (existingId) return json({ status: 'queued', jobId: existingId, deduplicated: true });

    const { data: inserted, error: insertError } = await admin
      .from('archival_export_jobs')
      .insert({
        requested_by: userId,
        requester_label: (profile as { name?: string; email?: string } | null)?.name ?? (profile as { email?: string } | null)?.email ?? null,
        duty_type: requested.dutyType,
        date_from: requested.dateFrom,
        date_to: requested.dateTo,
        // NULL (not '{}') is the whole-table scope: the worker reads an empty
        // array as a malformed row and refuses it.
        centre_scope: isGlobalScope ? null : allowedCentres,
        scope_fingerprint: fingerprint,
        status: 'queued',
      })
      .select('id')
      .single();

    if (insertError || !inserted?.id) {
      console.error(`[${requestId}] job insert failed: ${insertError?.message}`);
      return json({ error: 'internal_error', requestId }, 500);
    }

    return json({ status: 'queued', jobId: inserted.id });
  } catch (err) {
    console.error(`[${requestId}] unhandled: ${String((err as Error)?.message ?? err)}`);
    return json({ error: 'internal_error', requestId }, 500);
  }
});
