// Archival export — static guards for the Supabase Edge Function and the SQL
// it depends on. Run: node --test tools/
//
// There is no deno in this environment, so the function cannot be type-checked
// or executed here. These assertions are the cheap, durable half of that gap:
// they pin the properties a runtime test would have caught — no secret in a
// response, authorization strictly before privileged access, no client-supplied
// scope, and no accidental re-opening of the jobs table.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(repoRoot, rel), 'utf8');

const FN = 'supabase/functions/request-archival-export/index.ts';
const fn = read(FN);
const jobsSql = read('sql/archival_export_jobs.sql');

test('edge fn: no response body can carry the service-role key or any env value', () => {
  const sites = fn.split('\n').filter((l) => /json\(/.test(l) || /new Response\(/.test(l));
  assert.ok(sites.length > 0, 'expected to find response construction sites');
  for (const line of sites) {
    assert.doesNotMatch(line, /SERVICE_ROLE_KEY|SERVICE_ROLE|Deno\.env/, `leaky response: ${line.trim()}`);
  }
  // And no env value is interpolated into a template either.
  assert.doesNotMatch(fn, /json\(\s*\{[^}]*Deno\.env/s);
});

test('edge fn: authorization strictly precedes the service-role client', () => {
  const at = (needle) => {
    const i = fn.indexOf(needle);
    assert.ok(i > -1, `missing: ${needle}`);
    return i;
  };
  const authUser = at('auth.getUser(token)');
  const permission = at("rpc('has_permission'");
  const centres = at("rpc('get_user_accessible_centres'");
  const admin = at('createClient(SUPABASE_URL, SERVICE_ROLE_KEY');
  assert.ok(authUser < permission, 'identity must be checked before the permission');
  assert.ok(permission < admin, 'permission must be checked before privileged access');
  assert.ok(centres < admin, 'centre scope must be resolved before privileged access');
  // The permission value must gate a response, not just be computed.
  assert.match(fn, /if \(allowed !== true\) return json\(\{ error: 'forbidden' \}, 403\)/);
  assert.match(fn, /if \(allowedCentres\.length === 0\) return json\(\{ error: 'forbidden' \}, 403\)/);
});

test('edge fn: the caller can never supply a scope', () => {
  assert.doesNotMatch(fn, /body\.(centre|centres|scope|role|requested_by|userId)/i);
  assert.doesNotMatch(fn, /body\.permissions/i);
  // The allowlist is only ever the field list parseRequest reads.
  const readFields = [...fn.matchAll(/body\.([A-Za-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(readFields)].sort(), ['dateFrom', 'dateTo', 'dutyType']);
});

test('edge fn: NULL-able filters go through eqOrNull, never eq(col, null)', () => {
  assert.match(fn, /function eqOrNull</, 'eqOrNull helper must exist');
  assert.doesNotMatch(
    fn,
    /\.eq\('(date_from|date_to|duty_type)',\s*(null|requested\.)/,
    'a nullable column filtered with eq() silently matches nothing',
  );
  assert.match(fn, /eqOrNull\(query, 'date_from', requested\.dateFrom\)/);
  assert.match(fn, /eqOrNull\(existingQuery, 'date_from', requested\.dateFrom\)/);
});

test('edge fn: a global job is written as NULL centre_scope, never an empty array', () => {
  assert.match(fn, /centre_scope: isGlobalScope \? null : allowedCentres/);
});

test('jobs SQL: authenticated may SELECT but never INSERT/UPDATE/DELETE', () => {
  assert.match(jobsSql, /DROP POLICY IF EXISTS archival_jobs_insert ON public\.archival_export_jobs/);
  assert.doesNotMatch(jobsSql, /CREATE POLICY archival_jobs_insert/);
  assert.match(jobsSql, /GRANT SELECT ON public\.archival_export_jobs TO authenticated/);
  assert.doesNotMatch(jobsSql, /GRANT[^;]*INSERT[^;]*TO authenticated/i);
  assert.doesNotMatch(jobsSql, /GRANT[^;]*(UPDATE|DELETE)[^;]*TO authenticated/i);
});
