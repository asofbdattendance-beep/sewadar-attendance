// Archival export worker — unit tests for the pure helpers.
// Run: node --test tools/
//
// These tests deliberately pin the values that must agree with the SQL side:
//   * csvEscapeCell  == public.csv_field     (sql/archival_download_rpc.sql)
//   * scopeFingerprint == public.archival_scope_fingerprint
//                                          (sql/archival_export_jobs.sql)
// The SQL files are read from disk in the last test so drift fails here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ARCHIVAL_COLUMNS,
  ARCHIVAL_HEADERS,
  CSV_EOL,
  csvHeader,
  csvEscapeCell,
  rowsToCsv,
  toDDMMYYYY,
  scopeFingerprint,
  isSafePathSegment,
  buildObjectPath,
  artifactFilename,
  parseArgs,
  EMPTY_SCOPE_ERROR,
  resolveJobScope,
} from './archival_export_worker.mjs';

const md5 = (s) => createHash('md5').update(s).digest('hex');
const repoFile = (rel) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

// ---------------------------------------------------------------------------
// Column contract
// ---------------------------------------------------------------------------

test('ARCHIVAL_COLUMNS matches the RPC column order', () => {
  assert.deepEqual(ARCHIVAL_COLUMNS.map((c) => c.key), [
    'sewadar_name',
    'badge_number',
    'father_husband_name',
    'gender',
    'age',
    'department_name',
    'department_id',
    'area_name',
    'centre_name',
    'status',
    'duty_type',
    'duty_date',
    'deployed_department',
    'deployed_centre',
  ]);
});

test('ARCHIVAL_HEADERS is byte-identical to the header the RPC emits', () => {
  // The odd lowercase 'gender'/'age' are in the shipped file already; changing
  // them would change the delivered CSV, so they are pinned here.
  assert.deepEqual(ARCHIVAL_HEADERS, [
    'Sewadar Name',
    'Badge Number',
    'Father/Husband Name',
    'gender',
    'age',
    'Department Name',
    'Department Id',
    'Area Name',
    'Centre Name',
    'Status',
    'Duty Type',
    'Duty Date',
    'Deployed Department',
    'Deployed Centre',
  ]);
});

test('ARCHIVAL_HEADERS is derived from ARCHIVAL_COLUMNS', () => {
  assert.equal(CSV_EOL, '\r\n');
  assert.equal(csvHeader(), ARCHIVAL_HEADERS.join(','));
  assert.equal(csvHeader(), ARCHIVAL_COLUMNS.map((c) => c.header).join(','));
});

// ---------------------------------------------------------------------------
// csvEscapeCell — must mirror public.csv_field
// ---------------------------------------------------------------------------

test('csvEscapeCell: null/undefined/empty become the empty string', () => {
  assert.equal(csvEscapeCell(null), '');
  assert.equal(csvEscapeCell(undefined), '');
  assert.equal(csvEscapeCell(''), '');
});

test('csvEscapeCell: plain values pass through unquoted', () => {
  assert.equal(csvEscapeCell('Ravi Kumar'), 'Ravi Kumar');
  assert.equal(csvEscapeCell('01-05-2024'), '01-05-2024');
  assert.equal(csvEscapeCell(42), '42');
  assert.equal(csvEscapeCell(0), '0');
});

test('csvEscapeCell: RFC4180 quoting', () => {
  assert.equal(csvEscapeCell('a,b'), '"a,b"');
  assert.equal(csvEscapeCell('x"y'), '"x""y"');
  assert.equal(csvEscapeCell('l1\nl2'), '"l1\nl2"');
  assert.equal(csvEscapeCell('l1\rl2'), '"l1\rl2"');
  assert.equal(csvEscapeCell('a,b"c'), '"a,b""c"');
});

test('csvEscapeCell: neutralises every formula prefix with a leading apostrophe', () => {
  assert.equal(csvEscapeCell('=2+2'), "'=2+2");
  assert.equal(csvEscapeCell('-BAD'), "'-BAD");
  assert.equal(csvEscapeCell('+A'), "'+A");
  assert.equal(csvEscapeCell('@A'), "'@A");
  assert.equal(csvEscapeCell('\tA'), "'\tA"); // tab-only needs no RFC4180 quotes
  assert.equal(csvEscapeCell('\rA'), "\"'\rA\""); // CR forces quoting
  // A value that both looks dangerous and contains a comma gets both treatments.
  assert.equal(csvEscapeCell('=SUM(a,b)'), "\"'=SUM(a,b)\"");
});

test('csvEscapeCell: only a LEADING dangerous char is neutralised', () => {
  assert.equal(csvEscapeCell('a=b'), 'a=b');
  assert.equal(csvEscapeCell('total-1'), 'total-1');
});

test('toDDMMYYYY: converts ISO dates, tolerates timestamps and blanks', () => {
  assert.equal(toDDMMYYYY('2024-05-01'), '01-05-2024');
  assert.equal(toDDMMYYYY('2024-05-01T12:30:00Z'), '01-05-2024');
  assert.equal(toDDMMYYYY(null), '');
  assert.equal(toDDMMYYYY(undefined), '');
  assert.equal(toDDMMYYYY(''), '');
});

// ---------------------------------------------------------------------------
// rowsToCsv
// ---------------------------------------------------------------------------

test('rowsToCsv emits header, CRLF, one line per row, DD-MM-YYYY dates', () => {
  const csv = rowsToCsv([{ sewadar_name: 'Ravi', duty_date: '2024-05-01' }]);
  const expected = ['Ravi', '', '', '', '', '', '', '', '', '', '', '01-05-2024', '', ''].join(',');
  assert.equal(csv, `${csvHeader()}${CSV_EOL}${expected}`);
  assert.ok(!csv.endsWith(CSV_EOL), 'no trailing newline');
});

test('rowsToCsv: multiple rows are CRLF-joined and values are escaped', () => {
  const csv = rowsToCsv([
    { sewadar_name: 'A,B', badge_number: '=EVIL' },
    { sewadar_name: 'Plain', badge_number: null },
  ]);
  const lines = csv.split(CSV_EOL);
  assert.equal(lines.length, 3);
  assert.equal(lines[0], csvHeader());
  assert.equal(lines[1], ['"A,B"', "'=EVIL", '', '', '', '', '', '', '', '', '', '', '', ''].join(','));
  assert.equal(lines[2], ['Plain', '', '', '', '', '', '', '', '', '', '', '', '', ''].join(','));
});

test('rowsToCsv with no rows still emits the header', () => {
  assert.equal(rowsToCsv([]), csvHeader());
  assert.equal(rowsToCsv(null), csvHeader());
});

// ---------------------------------------------------------------------------
// scopeFingerprint — must mirror public.archival_scope_fingerprint
// ---------------------------------------------------------------------------

test('scopeFingerprint: empty / blank-only / missing input is the empty string', () => {
  assert.equal(scopeFingerprint([]), '');
  assert.equal(scopeFingerprint(null), '');
  assert.equal(scopeFingerprint(undefined), '');
  assert.equal(scopeFingerprint(['', '   ', '\t']), '');
});

test('scopeFingerprint: sorted, de-duplicated, raw values', () => {
  assert.equal(scopeFingerprint(['B', 'A', 'A', null, '']), md5('A|B'));
  assert.equal(scopeFingerprint(['B', 'A', 'A', null, '']), '685d9b3124d3d6e4e6260e32506211d7');
  // Values are joined RAW: ' A ' and 'A' are different centres.
  assert.equal(scopeFingerprint([' A ']), '951196ca354c5c72b8356494f97c3b5d');
  assert.notEqual(scopeFingerprint([' A ']), scopeFingerprint(['A']));
});

test('scopeFingerprint: C-collation order (uppercase before lowercase)', () => {
  assert.equal(scopeFingerprint(['b', 'A']), md5('A|b'));
  // Sanity: this is NOT the case-insensitive order en_US.UTF-8 would produce,
  // and not the insertion order either.
  assert.notEqual(scopeFingerprint(['b', 'A']), md5('b|A'));
  assert.equal(scopeFingerprint(['Zone 1', 'area 2']), md5('Zone 1|area 2'));
});

// ---------------------------------------------------------------------------
// isSafePathSegment / buildObjectPath
// ---------------------------------------------------------------------------

test('isSafePathSegment accepts the shapes we generate', () => {
  for (const ok of [
    'global',
    'centre',
    'D',
    'JMC',
    'all',
    'none',
    'v1',
    '2024-01-01',
    '2024-01-01_2024-12-31',
    'start_end',
    '685d9b3124d3d6e4e6260e32506211d7',
    'archival_all.csv',
    'archival_D_2024-01-01_to_end.csv',
  ]) {
    assert.equal(isSafePathSegment(ok), true, `should accept ${ok}`);
  }
});

test('isSafePathSegment rejects traversal, separators, blanks and junk', () => {
  for (const bad of [
    '',
    ' ',
    '  a  ',
    '.',
    '..',
    '../x',
    '..\\x',
    'a/b',
    'a\\b',
    '/abs',
    'a b',
    'a\tb',
    'a\nb',
    'a\u0000b',
    null,
    undefined,
    42,
    {},
    'x'.repeat(200),
  ]) {
    assert.equal(isSafePathSegment(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

test('buildObjectPath: unscoped global snapshot', () => {
  assert.equal(
    buildObjectPath({
      scope: 'global',
      dutyType: null,
      dateFrom: null,
      dateTo: null,
      fingerprint: '',
      version: 1,
    }),
    'archival/global/all/all/none/v1/archival_all.csv',
  );
});

test('buildObjectPath: duty-type and date filtered snapshot', () => {
  assert.equal(
    buildObjectPath({
      scope: 'global',
      dutyType: 'D',
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31',
      fingerprint: '',
      version: 2,
    }),
    'archival/global/D/2024-01-01_2024-12-31/none/v2/archival_D_2024-01-01_to_2024-12-31.csv',
  );
});

test('buildObjectPath: half-open date range keeps start/end placeholders', () => {
  const p = buildObjectPath({
    scope: 'centre',
    dutyType: 'JMC',
    dateFrom: null,
    dateTo: '2024-12-31',
    fingerprint: '685d9b3124d3d6e4e6260e32506211d7',
    version: 1,
  });
  assert.equal(
    p,
    'archival/centre/JMC/start_2024-12-31/685d9b3124d3d6e4e6260e32506211d7/v1/archival_JMC_start_to_2024-12-31.csv',
  );
});

test('buildObjectPath: every generated path is relative and safe', () => {
  const cases = [
    { scope: 'global', dutyType: null, dateFrom: null, dateTo: null, fingerprint: '', version: 1 },
    { scope: 'centre', dutyType: 'V', dateFrom: '2024-01-01', dateTo: null, fingerprint: 'abc', version: 3 },
  ];
  for (const c of cases) {
    const p = buildObjectPath(c);
    assert.ok(!p.startsWith('/'), p);
    assert.ok(!p.includes('..'), p);
    assert.ok(p.split('/').every(isSafePathSegment), p);
  }
});

test('buildObjectPath throws instead of emitting an unsafe path', () => {
  const base = { scope: 'global', dutyType: null, dateFrom: null, dateTo: null, fingerprint: '', version: 1 };
  assert.throws(() => buildObjectPath({ ...base, scope: '../../etc' }));
  assert.throws(() => buildObjectPath({ ...base, dutyType: 'D/x' }));
  assert.throws(() => buildObjectPath({ ...base, dateFrom: '2024-01-01/../x' }));
  assert.throws(() => buildObjectPath({ ...base, fingerprint: 'a b' }));
  assert.throws(() => buildObjectPath({ ...base, version: 'v1' }));
  assert.throws(() => buildObjectPath({ ...base, version: 0 }));
});

// ---------------------------------------------------------------------------
// artifactFilename — mirrors archivalFileName() in src/pages/ReportsPage.jsx
// ---------------------------------------------------------------------------

test('artifactFilename mirrors the page naming rule', () => {
  assert.equal(artifactFilename({ dutyType: null, dateFrom: null, dateTo: null }), 'archival_all.csv');
  assert.equal(artifactFilename({ dutyType: 'D', dateFrom: null, dateTo: null }), 'archival_D.csv');
  assert.equal(artifactFilename({ dutyType: 'D', dateFrom: '2024-01-01', dateTo: null }), 'archival_D_2024-01-01_to_end.csv');
  assert.equal(artifactFilename({ dutyType: null, dateFrom: null, dateTo: '2024-12-31' }), 'archival_all_start_to_2024-12-31.csv');
  assert.equal(
    artifactFilename({ dutyType: 'JMC', dateFrom: '2024-01-01', dateTo: '2024-12-31' }),
    'archival_JMC_2024-01-01_to_2024-12-31.csv',
  );
});

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

test('parseArgs: modes and flags', () => {
  assert.deepEqual(parseArgs(['--snapshots']), { mode: 'snapshots', dryRun: false, bucket: null, limit: null });
  assert.deepEqual(parseArgs(['--jobs']), { mode: 'jobs', dryRun: false, bucket: null, limit: null });
  assert.deepEqual(parseArgs(['--jobs', '--dry-run']), { mode: 'jobs', dryRun: true, bucket: null, limit: null });
  assert.deepEqual(parseArgs(['--snapshots', '--bucket', 'archival-exports', '--limit', '5']), {
    mode: 'snapshots',
    dryRun: false,
    bucket: 'archival-exports',
    limit: 5,
  });
});

test('parseArgs: fails loudly on missing/conflicting/unknown input', () => {
  assert.throws(() => parseArgs([]));
  assert.throws(() => parseArgs(['--snapshots', '--jobs']));
  assert.throws(() => parseArgs(['--nope']));
  assert.throws(() => parseArgs(['--jobs', '--limit', 'abc']));
  assert.throws(() => parseArgs(['--jobs', '--limit', '-1']));
  assert.throws(() => parseArgs(['--jobs', '--bucket', '../secret']));
});

// ---------------------------------------------------------------------------
// Cross-language drift guards
// ---------------------------------------------------------------------------

test('drift: JS formula guard matches the SQL bracket expression', () => {
  const sql = repoFile('sql/archival_download_rpc.sql');
  const m = sql.match(/t\s*~\s*'\^\[([^\]]+)\]'/);
  assert.ok(m, 'could not find the formula-guard regex in sql/archival_download_rpc.sql');
  // SQL source class -> the literal characters it matches (Postgres ARE
  // understands \t and \r inside a bracket expression; verified against the
  // live database: leading tab/CR match, leading backslash/t/r do not).
  const sqlClass = m[1].replace(/\\t/g, '\t').replace(/\\r/g, '\r');
  const jsGuard = "=+@\t\r-";
  assert.deepEqual([...sqlClass].sort(), [...jsGuard].sort());
  // And behaviourally: every char the SQL claims is dangerous is neutralised.
  // (\r also forces RFC4180 quoting, so strip one optional outer quote first.)
  for (const ch of jsGuard) {
    const escaped = csvEscapeCell(`${ch}x`).replace(/^"/, '');
    assert.ok(escaped.startsWith(`'${ch}`), `guard char ${JSON.stringify(ch)} → ${JSON.stringify(escaped)}`);
  }
});

test('drift: JS scope fingerprint matches the SQL sort/filter rules', () => {
  const sql = repoFile('sql/archival_export_jobs.sql');
  assert.match(sql, /ORDER BY c/, 'SQL fingerprint must order by the centre name');
  assert.match(sql, /COLLATE "C"/, 'SQL fingerprint must sort with COLLATE "C" to match JS sort()');
  assert.match(sql, /!~\s*'\^\[\[:space:\]\]\*\$'/, 'SQL fingerprint must drop whitespace-only entries');
  assert.match(sql, /md5\(/, 'SQL fingerprint must use md5');
  // The empty-set answer is '' on both sides, never md5('').
  assert.notEqual(scopeFingerprint([]), md5(''));
});

// --- resolveJobScope: NULL scope means whole table, [] means refuse ---------
// The request Edge Function writes NULL for an unrestricted caller; an empty
// array is never legitimate and must not be read as "everything".

test('resolveJobScope: NULL centre_scope is a legitimate whole-table job', () => {
  assert.deepEqual(resolveJobScope({ centre_scope: null }), { scope: 'global', centreScope: null });
});

test('resolveJobScope: a missing centre_scope column also reads as whole-table', () => {
  assert.deepEqual(resolveJobScope({}), { scope: 'global', centreScope: null });
  assert.deepEqual(resolveJobScope(undefined), { scope: 'global', centreScope: null });
});

test('resolveJobScope: a non-empty centre set is a centre-scoped job', () => {
  assert.deepEqual(resolveJobScope({ centre_scope: ['A', 'B'] }), { scope: 'centre', centreScope: ['A', 'B'] });
});

test('resolveJobScope: an empty array is refused, never widened to everything', () => {
  assert.throws(() => resolveJobScope({ centre_scope: [] }), { message: EMPTY_SCOPE_ERROR });
});

test('resolveJobScope: blank-only and non-string entries are refused too', () => {
  assert.throws(() => resolveJobScope({ centre_scope: [null, ' ', ''] }), { message: EMPTY_SCOPE_ERROR });
  assert.throws(() => resolveJobScope({ centre_scope: [42] }), { message: EMPTY_SCOPE_ERROR });
});

test('resolveJobScope: blanks mixed with real centres are dropped, not fatal', () => {
  assert.deepEqual(resolveJobScope({ centre_scope: ['A', ' ', null] }), { scope: 'centre', centreScope: ['A'] });
});
