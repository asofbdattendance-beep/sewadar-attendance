// runArchivalExport — the one place the Archival Reports download decides HOW
// to get the CSV, and the one place it decides what to tell the user.
//
// Three strategies, in this order, for one reason:
//
//   artifact  the CSV already exists in private Storage (built by
//             tools/archival_export_worker.mjs). Fastest and cheapest: the
//             browser downloads a file that was never generated on the fly.
//   rpc       Postgres builds the CSV in 100k-row chunks
//             (public.get_archival_csv_chunk). No server memory is held and the
//             RLS policy is not re-evaluated per row the way a client SELECT
//             would be.
//   client    a paged PostgREST SELECT assembled in the browser. Slow, memory
//             hungry (615k rows today), and it exists ONLY as a last resort so
//             that a half-deployed project still works.
//
// The fourth outcome is the important one: when the browser path hits its row
// cap it says so (status 'ready' with truncated:true and a message) instead of
// handing the user a silently incomplete CSV. A wrong file that looks right is
// worse than an error.

import { ARCHIVAL_SELECT, archivalFilename, buildCsv } from './csv.js';

/** Ordered strategy names. 'artifact' is tried first. */
export const EXPORT_STRATEGIES = ['artifact', 'rpc', 'client'];

/** Duty types stored in archival_attendance (mirrors the table CHECK constraint). */
export const DUTY_TYPES = ['D', 'JMC', 'JO', 'V', 'JH'];

/**
 * Row cap for the browser fallback. Deliberately equal to the value the page
 * shipped with: a project whose SQL/bucket has not been deployed yet keeps
 * working exactly as before, cap included. Bounded, not narrowed.
 */
export const CLIENT_FALLBACK_MAX_ROWS = 650000;

const RPC_NAME = 'get_archival_csv_chunk';
const DEFAULT_RPC_CHUNK = 100000;
const DEFAULT_PAGE_SIZE = 1000; // PostgREST's default max-rows; asking for more is silently capped
const TABLE = 'archival_attendance';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
// Paranoia bound: the RPC loop is data-driven, but a buggy server that always
// returns a full chunk must not spin forever.
const MAX_RPC_CHUNKS = 1000;

const errorText = (error) => (error && error.message ? error.message : String(error));

function normalizeRequest(request) {
  const raw = request || {};
  return {
    dutyType: raw.dutyType ? String(raw.dutyType).trim().toUpperCase() : null,
    dateFrom: raw.dateFrom ? String(raw.dateFrom) : null,
    dateTo: raw.dateTo ? String(raw.dateTo) : null,
  };
}

/** Returns a user-facing message, or null when the request is well formed. */
function validateRequest(request, { requireDutyType }) {
  if (request.dutyType && !DUTY_TYPES.includes(request.dutyType)) {
    return `Unknown duty type "${request.dutyType}".`;
  }
  if (requireDutyType && !request.dutyType) {
    return 'Choose a duty type for a filtered download.';
  }
  if (request.dateFrom && !ISO_DATE.test(request.dateFrom)) {
    return 'The from date must be YYYY-MM-DD.';
  }
  if (request.dateTo && !ISO_DATE.test(request.dateTo)) {
    return 'The to date must be YYYY-MM-DD.';
  }
  if (request.dateFrom && request.dateTo && request.dateFrom > request.dateTo) {
    return 'The from date must be on or before the to date.';
  }
  return null;
}

/**
 * Counts CSV records (not raw newlines): a quoted field may contain a line
 * break, so splitting on '\n' would over-count. Handles doubled quotes.
 */
function countCsvRecords(text) {
  let records = 0;
  let inQuotes = false;
  let sawChar = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    sawChar = true;
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        i += 1; // escaped quote inside a quoted field
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === '\n' && !inQuotes) records += 1;
  }
  if (!sawChar) return 0;
  return text.endsWith('\n') ? records : records + 1;
}

/** Rows carried by one RPC chunk: chunk 0 also carries the header line. */
function countChunkRows(text, chunk) {
  const records = countCsvRecords(text);
  return chunk === 0 ? Math.max(records - 1, 0) : records;
}

/**
 * Fastest path: the worker already built this exact CSV and left a signed URL
 * in storage. Returns a ready/queued result, or null to fall through.
 */
async function tryArtifact(fetchArtifact, request, notices) {
  if (typeof fetchArtifact !== 'function') return null;
  let response;
  try {
    response = await fetchArtifact(request);
  } catch (error) {
    notices.push(`artifact endpoint unavailable (${errorText(error)}); generating the file instead`);
    return null;
  }
  if (!response) return null;

  if (response.status === 'ready' && response.url) {
    return {
      status: 'ready',
      strategy: 'artifact',
      url: response.url,
      filename: response.filename || archivalFilename(request),
      rowCount: response.rowCount ?? null,
      expiresAt: response.expiresAt ?? null,
    };
  }
  if (response.status === 'queued') {
    return {
      status: 'queued',
      jobId: response.jobId ?? null,
      deduplicated: response.deduplicated === true,
    };
  }
  return null;
}

/** Postgres builds the CSV in chunks. Returns {blob, rows}, or null for no rows. */
async function exportViaRpc({ client, request, chunkSize, onProgress }) {
  const parts = [];
  let rows = 0;

  for (let chunk = 0; chunk < MAX_RPC_CHUNKS; chunk += 1) {
    const { data, error } = await client.rpc(RPC_NAME, {
      p_chunk: chunk,
      p_duty_type: request.dutyType,
      p_from: request.dateFrom,
      p_to: request.dateTo,
      p_limit: chunkSize,
    });
    if (error) throw new Error(errorText(error));

    const text = typeof data === 'string' ? data : '';
    if (text === '') break;

    const chunkRows = countChunkRows(text, chunk);
    parts.push(chunk === 0 ? text : `\n${text}`);
    rows += chunkRows;
    onProgress({ strategy: 'rpc', chunk: chunk + 1, rows });

    if (chunkRows < chunkSize) break;
    if (chunk === MAX_RPC_CHUNKS - 1) throw new Error('RPC chunk guard tripped');
  }

  if (rows === 0) return null;
  return { blob: new Blob(parts, { type: 'text/csv' }), rows };
}

/**
 * Last resort: page the table in the browser. Returns
 * {blob, rows, truncated, message}, or null for no rows.
 */
async function exportViaClient({ client, request, pageSize, maxRows, onProgress }) {
  const rows = [];

  // The API caps how many rows one request may return (PostgREST's max-rows — 1000
  // on a default Supabase project, which is why the worker pages at 1000 too). A
  // short page is therefore NOT proof that the table ended: it is equally the
  // signature of the cap. So ask the server for an exact count with the first page
  // and let that count — not the page length — decide whether we got everything.
  // A partial file that looks complete is the failure this module exists to stop.
  let serverCount = null;
  let sawShortPage = false;

  while (rows.length < maxRows) {
    const first = rows.length === 0;
    let query = client
      .from(TABLE)
      .select(ARCHIVAL_SELECT, first ? { count: 'exact' } : undefined)
      .order('id', { ascending: true });
    if (request.dutyType) query = query.eq('duty_type', request.dutyType);
    if (request.dateFrom) query = query.gte('duty_date', request.dateFrom);
    if (request.dateTo) query = query.lte('duty_date', request.dateTo);

    const size = Math.min(pageSize, maxRows - rows.length);
    const { data, error, count } = await query.range(rows.length, rows.length + size - 1);
    if (error) throw new Error(errorText(error));

    if (typeof count === 'number' && count >= 0) serverCount = count;

    const batch = Array.isArray(data) ? data : [];
    rows.push(...batch);
    onProgress({ strategy: 'client', rows: rows.length });

    if (batch.length < size) {
      sawShortPage = true; // the last page, or the API row cap — the count decides
      break;
    }
  }

  if (rows.length === 0) return null;

  const capped = rows.length >= maxRows;
  const missing = serverCount !== null && rows.length < serverCount;
  const truncated = capped || (sawShortPage && missing);
  const message = !truncated
    ? null
    : capped
      ? `Only the first ${maxRows} rows were downloaded. Narrow the date range or duty type to get the rest.`
      : `The API returned ${rows.length} of ${serverCount} rows. Narrow the date range or duty type to get the rest.`;

  return {
    blob: new Blob([buildCsv(rows)], { type: 'text/csv' }),
    rows: rows.length,
    truncated,
    message,
  };
}

/**
 * Resolve one archival download.
 *
 * @param {object} options
 * @param {object} options.client      Supabase client (caller's session)
 * @param {object} [options.request]   {dutyType, dateFrom, dateTo}
 * @param {Function} [options.onProgress] ({strategy, chunk?, rows, page?}) => void
 * @param {Function} [options.fetchArtifact] (request) => Promise<ready|queued|null>
 * @returns {Promise<object>} one of
 *   {status:'ready', strategy:'artifact', url, filename, rowCount, expiresAt}
 *   {status:'ready', strategy:'rpc'|'client', blob, filename, rows, truncated, message, notices}
 *   {status:'queued', jobId, deduplicated, notices}
 *   {status:'empty', message, notices}
 *   {status:'invalid', message, notices}
 *   {status:'error', message, notices}
 */
/**
 * POST the request to the request-archival-export Edge Function and return its
 * body. Throws on anything unexpected — runArchivalExport() reads a throw as
 * "no artifact path here" and moves on to the RPC, which is why this must never
 * swallow a failure into a fake success.
 */
export async function requestArchivalArtifact(client, request = {}, { endpoint = '', anonKey = '', fetchImpl = null } = {}) {
  if (!endpoint) throw new Error('artifact endpoint is not configured');
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new Error('fetch is not available in this environment');

  const session = await client?.auth?.getSession?.();
  const token = session?.data?.session?.access_token;
  if (!token) throw new Error('not signed in');

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  if (anonKey) headers.apikey = anonKey;

  const response = await doFetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      dutyType: request.dutyType || null,
      dateFrom: request.dateFrom || null,
      dateTo: request.dateTo || null,
    }),
  });

  if (!response || !response.ok) {
    throw new Error(`artifact endpoint returned ${response ? response.status : 'no response'}`);
  }
  return response.json();
}

export async function runArchivalExport({
  client,
  request = {},
  onProgress = () => {},
  fetchArtifact = null,
  rpcChunkSize = DEFAULT_RPC_CHUNK,
  pageSize = DEFAULT_PAGE_SIZE,
  maxRows = CLIENT_FALLBACK_MAX_ROWS,
  requireDutyType = false,
} = {}) {
  const notices = [];
  // `queued` is not an ending: it means no prepared file exists right now. Hold it
  // so it can still be reported if every path that can build a file also fails.
  let queued = null;

  try {
    if (!client) throw new Error('a Supabase client is required');

    const asked = normalizeRequest(request);
    const problem = validateRequest(asked, { requireDutyType });
    if (problem) return { status: 'invalid', message: problem, notices };

    // 1. Pre-built artifact. Only a real file short-circuits the rest: a queued
    //    answer is held and the download continues, because the caller asked for a
    //    file and the RPC below builds one from the same filters. The artifact is
    //    an optimisation; the server-side CSV is the path that always works.
    const artifact = await tryArtifact(fetchArtifact, asked, notices);
    if (artifact && artifact.status !== 'queued') return { ...artifact, notices };
    queued = artifact;

    // 2. Server-side CSV. An error here is not fatal: it means the RPC is
    //    missing from this deployment, so we fall through and say so.
    let rpc = { ok: false };
    try {
      rpc = { ok: true, value: await exportViaRpc({ client, request: asked, chunkSize: rpcChunkSize, onProgress }) };
    } catch (error) {
      notices.push(`server-side export unavailable (${errorText(error)}); using the browser fallback`);
    }
    if (rpc.ok) {
      if (rpc.value) {
        return {
          status: 'ready',
          strategy: 'rpc',
          blob: rpc.value.blob,
          filename: archivalFilename(asked),
          rows: rpc.value.rows,
          truncated: false,
          message: null,
          notices,
        };
      }
      // The RPC answered with no rows. Fall through anyway: an unexpected empty
      // from a deployed-but-drifted function is indistinguishable from a genuine
      // empty result, and the browser path costs exactly one extra request when
      // the result really is empty (the first page comes back short, so the loop
      // stops). Cheap insurance against a silently broken feature.
      notices.push('the server returned no rows; checking the browser fallback');
    }

    // 3. Browser fallback, bounded and loud about its bound.
    const fallback = await exportViaClient({ client, request: asked, pageSize, maxRows, onProgress });
    if (!fallback) {
      return { status: 'empty', message: 'No archival records found for the selected filters.', notices };
    }
    return {
      status: 'ready',
      strategy: 'client',
      blob: fallback.blob,
      filename: archivalFilename(asked),
      rows: fallback.rows,
      truncated: fallback.truncated,
      message: fallback.message,
      notices,
    };
  } catch (error) {
    // Nothing produced a file. If a job was queued on the way, that job is the one
    // piece of information worth keeping — it is the only path to this data that
    // has been started but not yet finished.
    if (queued) return { ...queued, notices };
    return { status: 'error', message: `Download failed: ${errorText(error)}`, notices };
  }
}
