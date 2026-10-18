// runArchivalExport — strategy order, structured results, loud truncation.
//
// The three strategies exist for one reason: the artifact path is fast because
// the CSV is already built, the RPC path is medium because Postgres builds it,
// and the browser path is a last resort that must never silently ship half a
// file. These tests pin that order and that "never silent" property.

import { test, describe, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ARCHIVAL_HEADERS, CSV_EOL } from './csv.js';
import {
  CLIENT_FALLBACK_MAX_ROWS,
  DUTY_TYPES,
  EXPORT_STRATEGIES,
  requestArchivalArtifact,
  runArchivalExport,
} from './archivalExport.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Minimal PostgREST-ish stub: records every query, slices by range(). */
function makeClient({ rows = [], rpc = null } = {}) {
  const queries = [];
  const client = {
    queries,
    rpc: vi.fn(rpc ?? (async () => ({ data: '', error: null }))),
    from() {
      const query = {
        filters: [],
        select: () => query,
        order: () => query,
        eq(col, value) { query.filters.push(['eq', col, value]); return query; },
        gte(col, value) { query.filters.push(['gte', col, value]); return query; },
        lte(col, value) { query.filters.push(['lte', col, value]); return query; },
        range(from, to) {
          queries.push({ from, to, filters: query.filters });
          return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
        },
      };
      return query;
    },
  };
  return client;
}

const row = (n) => ({ sewadar_name: `N${n}`, duty_date: '2024-05-01' });

describe('strategy order', () => {
  test('a ready artifact short-circuits the RPC and the browser entirely', async () => {
    const client = makeClient({ rows: [row(1)] });
    const fetchArtifact = vi.fn(async () => ({
      status: 'ready',
      url: 'https://example.test/signed',
      filename: 'archival_all.csv',
      rowCount: 615724,
      expiresAt: '2026-01-01T00:00:00.000Z',
    }));

    const result = await runArchivalExport({ client, request: {}, fetchArtifact });

    expect(result.status).toBe('ready');
    expect(result.strategy).toBe('artifact');
    expect(result.url).toBe('https://example.test/signed');
    expect(result.rowCount).toBe(615724);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.queries.length).toBe(0);
  });

  test('a queued answer is returned as queued, not retried through the RPC', async () => {
    const client = makeClient();
    const fetchArtifact = vi.fn(async () => ({ status: 'queued', jobId: 'job-1' }));

    const result = await runArchivalExport({ client, request: { dutyType: 'JMC' }, fetchArtifact });

    expect(result).toEqual(expect.objectContaining({ status: 'queued', jobId: 'job-1' }));
    expect(client.rpc).not.toHaveBeenCalled();
  });

  test('an unreachable endpoint falls through to the RPC', async () => {
    const client = makeClient({
      // chunk 0 answers, chunk 1 is past the end — a server that always echoed
      // the same chunk would (correctly) trip the module's chunk guard instead.
      rpc: async (_name, args) => ({ data: args.p_chunk === 0 ? 'header\nr1\nr2' : '', error: null }),
    });
    const fetchArtifact = vi.fn(async () => {
      throw new Error('function not deployed');
    });

    const result = await runArchivalExport({ client, request: {}, fetchArtifact, rpcChunkSize: 2 });

    expect(result.status).toBe('ready');
    expect(result.strategy).toBe('rpc');
    expect(result.rows).toBe(2);
  });
});

describe('rpc strategy', () => {
  test('chunks are requested with the deployed argument names and assembled', async () => {
    const chunks = ['h\nr1\nr2', 'r3\nr4', 'r5'];
    const client = makeClient({
      rpc: async (_name, args) => ({ data: chunks[args.p_chunk] ?? '', error: null }),
    });
    const progress = vi.fn();

    const result = await runArchivalExport({ client, request: { dutyType: 'V' }, rpcChunkSize: 2, onProgress: progress });

    expect(client.rpc).toHaveBeenCalledTimes(3);
    expect(client.rpc.mock.calls[0][0]).toBe('get_archival_csv_chunk');
    expect(client.rpc.mock.calls[0][1]).toEqual({
      p_chunk: 0,
      p_duty_type: 'V',
      p_from: null,
      p_to: null,
      p_limit: 2,
    });
    expect(result.rows).toBe(5);
    await expect(result.blob.text()).resolves.toBe('h\nr1\nr2\nr3\nr4\nr5');
    expect(progress).toHaveBeenCalled();
  });

  test('an RPC error falls through to the browser, and that is visible in the result', async () => {
    const client = makeClient({
      rows: [row(1), row(2)],
      rpc: async () => ({ data: null, error: { message: 'timeout 57014' } }),
    });

    const result = await runArchivalExport({ client, request: {} });

    expect(result.strategy).toBe('client');
    expect(result.rows).toBe(2);
    expect(result.notices.join(' ')).toMatch(/57014|RPC/);
  });
});

describe('browser fallback', () => {
  test('pages with range(), filters by duty type and date, and builds the CSV', async () => {
    const client = makeClient({ rows: [row(1)] });

    const result = await runArchivalExport({
      client,
      request: { dutyType: 'D', dateFrom: '2024-01-01', dateTo: '2024-12-31' },
      pageSize: 5000,
    });

    expect(result.strategy).toBe('client');
    expect(client.queries[0].filters).toEqual([
      ['eq', 'duty_type', 'D'],
      ['gte', 'duty_date', '2024-01-01'],
      ['lte', 'duty_date', '2024-12-31'],
    ]);
    const text = await result.blob.text();
    expect(text.startsWith(ARCHIVAL_HEADERS.join(','))).toBe(true);
    expect(text).toContain(`${CSV_EOL}N1,`);
    expect(result.filename).toBe('archival_D_2024-01-01_to_2024-12-31.csv');
  });

  test('hitting the row cap is reported as truncation, never as success', async () => {
    const rows = [row(1), row(2)];
    const client = makeClient({ rows, rpc: async () => ({ data: null, error: { message: 'boom' } }) });

    const result = await runArchivalExport({ client, request: {}, pageSize: 2, maxRows: 2 });

    expect(result.strategy).toBe('client');
    expect(result.truncated).toBe(true);
    expect(result.message).toMatch(/first 2/);
    expect(result.rows).toBe(2);
  });

  test('a short final page is not truncation', async () => {
    const client = makeClient({ rows: [row(1)], rpc: async () => ({ data: null, error: { message: 'boom' } }) });

    const result = await runArchivalExport({ client, request: {}, pageSize: 2, maxRows: 10 });

    expect(result.truncated).toBe(false);
  });
});

describe('validation and empty results', () => {
  test('an unknown duty type is rejected before any request is made', async () => {
    const client = makeClient();
    const result = await runArchivalExport({ client, request: { dutyType: 'XX' } });

    expect(result.status).toBe('invalid');
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.queries.length).toBe(0);
  });

  test('dateFrom after dateTo is rejected', async () => {
    const result = await runArchivalExport({
      client: makeClient(),
      request: { dateFrom: '2024-12-31', dateTo: '2024-01-01' },
    });
    expect(result.status).toBe('invalid');
  });

  test('a filtered download without a duty type is rejected when the caller asks for that rule', async () => {
    const result = await runArchivalExport({ client: makeClient(), request: {}, requireDutyType: true });
    expect(result.status).toBe('invalid');
    expect(result.message).toMatch(/duty type/i);
  });

  test('no rows anywhere is empty, not a zero-byte file', async () => {
    const client = makeClient({ rows: [], rpc: async () => ({ data: '', error: null }) });
    const result = await runArchivalExport({ client, request: {} });
    expect(result.status).toBe('empty');
    expect(result.blob).toBeUndefined();
  });

  test('an unexpected failure is an error result, never a thrown exception at the call site', async () => {
    const client = makeClient();
    client.from = () => {
      throw new Error('client exploded');
    };
    client.rpc = async () => ({ data: null, error: { message: 'no rpc' } });

    const result = await runArchivalExport({ client, request: {} });
    expect(result.status).toBe('error');
    expect(result.message).toMatch(/client exploded|download/i);
  });
});

describe('artifact requester', () => {
  const session = (token) => ({ auth: { getSession: async () => ({ data: { session: token ? { access_token: token } : null } }) } });

  test('posts the request with the caller token and returns the parsed body', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: 'ready', url: 'u' }) }));

    const body = await requestArchivalArtifact(
      session('tok'),
      { dutyType: 'D' },
      { endpoint: 'https://x/functions/v1/request-archival-export', anonKey: 'anon', fetchImpl },
    );

    expect(body).toEqual({ status: 'ready', url: 'u' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://x/functions/v1/request-archival-export');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers.apikey).toBe('anon');
    expect(JSON.parse(init.body)).toEqual({ dutyType: 'D', dateFrom: null, dateTo: null });
  });

  test('throws when the endpoint is not configured, so the RPC path takes over', async () => {
    await expect(requestArchivalArtifact(session('tok'), {}, { endpoint: '' })).rejects.toThrow(/not configured/i);
  });

  test('throws on a non-ok response and on a missing session', async () => {
    const failing = async () => ({ ok: false, status: 401, json: async () => ({}) });
    await expect(
      requestArchivalArtifact(session('tok'), {}, { endpoint: 'https://x/req', fetchImpl: failing }),
    ).rejects.toThrow(/401/);
    await expect(
      requestArchivalArtifact(session(null), {}, { endpoint: 'https://x/req', fetchImpl: failing }),
    ).rejects.toThrow(/signed in/i);
  });
});

describe('shared contract', () => {
  test('strategy names are ordered and stable', () => {
    expect(EXPORT_STRATEGIES).toEqual(['artifact', 'rpc', 'client']);
  });

  test('the duty type list matches the worker and the SQL CHECK constraint', () => {
    const worker = readFileSync(join(repoRoot, 'tools', 'archival_export_worker.mjs'), 'utf8');
    const workerList = worker.match(/DUTY_TYPES = \[([^\]]+)\]/)[1].replace(/['\s]/g, '').split(',');
    expect([...DUTY_TYPES].sort()).toEqual([...workerList].sort());

    const schema = readFileSync(join(repoRoot, 'sql', 'archival_attendance_schema.sql'), 'utf8');
    const check = schema.match(/duty_type IN \(([^)]+)\)/)[1].replace(/['\s]/g, '').split(',');
    expect([...DUTY_TYPES].sort()).toEqual([...check].sort());
  });

  test('the browser fallback cap is large enough for the live table, and bounded', () => {
    expect(CLIENT_FALLBACK_MAX_ROWS).toBe(650000);
    expect(CLIENT_FALLBACK_MAX_ROWS).toBeGreaterThan(615724); // live row count
  });
});
