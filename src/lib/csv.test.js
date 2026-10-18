// CSV escaping + archival column contract.
//
// The escaping rule is implemented three times by necessity — here, in
// public.csv_field() (sql/archival_download_rpc.sql) and, for the queue worker,
// by this same module — so the last test in this file reads the SQL file from
// disk and fails if the two drift apart.

import { test, describe, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ARCHIVAL_COLUMNS,
  ARCHIVAL_HEADERS,
  CSV_EOL,
  DANGEROUS_LEAD,
  archivalFilename,
  buildCsv,
  csvEscapeCell,
} from './csv.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('csvEscapeCell', () => {
  test('empty-ish values produce an empty field, never the word null', () => {
    expect(csvEscapeCell(null)).toBe('');
    expect(csvEscapeCell(undefined)).toBe('');
    expect(csvEscapeCell('')).toBe('');
    expect(csvEscapeCell(0)).toBe('0');
    expect(csvEscapeCell(false)).toBe('false');
  });

  test('plain values pass through untouched', () => {
    expect(csvEscapeCell('ABC')).toBe('ABC');
    expect(csvEscapeCell('Sector 21')).toBe('Sector 21');
    expect(csvEscapeCell(42)).toBe('42');
  });

  test('spreadsheet formula prefixes are neutralised with a leading quote', () => {
    for (const dangerous of ['=2+2', '-5', '+1', '@SUM(A1)', '\tZ', '\rZ']) {
      const out = csvEscapeCell(dangerous);
      const unquoted = out.startsWith('"') && out.endsWith('"') ? out.slice(1, -1) : out;
      expect(unquoted.startsWith("'"), `${JSON.stringify(dangerous)} → ${JSON.stringify(out)}`).toBe(true);
    }
  });

  test('RFC 4180 quoting for comma, quote, CR and LF', () => {
    expect(csvEscapeCell('a,b')).toBe('"a,b"');
    expect(csvEscapeCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvEscapeCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscapeCell('a\rb')).toBe('"a\rb"');
  });

  test('a value that is both dangerous and needs quoting stays a single quoted field', () => {
    expect(csvEscapeCell('=1,2')).toBe('"\'=1,2"');
    // The quote prefix is inside the quotes, so the value is still one cell.
    const out = csvEscapeCell('=1,2');
    expect(out.startsWith('"') && out.endsWith('"')).toBe(true);
    expect(out.slice(1, -1)).toBe("'=1,2");
  });

  test('dangerous characters in the middle are not neutralised (they are not formula leads)', () => {
    expect(csvEscapeCell('a=b')).toBe('a=b');
    expect(csvEscapeCell('A-2')).toBe('A-2');
  });
});

describe('ARCHIVAL_COLUMNS', () => {
  test('14 columns in the order the live page ships', () => {
    expect(ARCHIVAL_HEADERS).toEqual([
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
    expect(ARCHIVAL_COLUMNS.length).toBe(14);
  });

  test('Duty Date is emitted as DD-MM-YYYY, matching the RPC and the worker', () => {
    const csv = buildCsv([{ sewadar_name: 'A', duty_date: '2024-05-01' }]);
    const cells = csv.split(CSV_EOL)[1].split(',');
    expect(cells[11]).toBe('01-05-2024');
    expect(cells.length).toBe(ARCHIVAL_COLUMNS.length);
  });
});

describe('buildCsv', () => {
  test('header only when there are no rows, and no trailing newline', () => {
    expect(buildCsv([])).toBe(ARCHIVAL_HEADERS.join(','));
    expect(buildCsv(null)).toBe(ARCHIVAL_HEADERS.join(','));
  });

  test('rows are CRLF-joined, cells comma-joined, missing fields blank', () => {
    const csv = buildCsv([{ sewadar_name: 'A', badge_number: 'B1' }, { sewadar_name: 'C' }]);
    const lines = csv.split(CSV_EOL);
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe(ARCHIVAL_HEADERS.join(','));
    expect(lines[1].startsWith('A,B1,')).toBe(true);
    expect(lines[2].startsWith('C,,')).toBe(true);
    expect(csv.endsWith(CSV_EOL)).toBe(false);
  });
});

describe('archivalFilename', () => {
  test('combined vs duty-typed, with and without a date range', () => {
    expect(archivalFilename({})).toBe('archival_all.csv');
    expect(archivalFilename({ dutyType: 'JMC' })).toBe('archival_JMC.csv');
    expect(archivalFilename({ dutyType: 'JMC', dateFrom: '2024-01-01', dateTo: '2024-12-31' })).toBe(
      'archival_JMC_2024-01-01_to_2024-12-31.csv',
    );
    expect(archivalFilename({ dateFrom: '2024-01-01' })).toBe('archival_all_2024-01-01_to_end.csv');
    expect(archivalFilename({ dateTo: '2024-12-31' })).toBe('archival_all_start_to_2024-12-31.csv');
  });
});

describe('drift: the escaping rule matches public.csv_field()', () => {
  test('the SQL bracket expression and the JS guard describe the same character set', () => {
    const sql = readFileSync(join(repoRoot, 'sql', 'archival_download_rpc.sql'), 'utf8');
    const match = sql.match(/~\s*'\^\[([^\]]+)\]'/);
    expect(match, 'expected a ^[...] guard in sql/archival_download_rpc.sql').not.toBeNull();

    const unescape = (s) => s.replace(/\\t/g, '\t').replace(/\\r/g, '\r');
    const sqlClass = unescape(match[1]);
    const jsSource = unescape(DANGEROUS_LEAD.source.replace(/^\^\[/, '').replace(/\]$/, ''));
    expect([...sqlClass].sort()).toEqual([...jsSource].sort());
  });

  test('every character the SQL guard claims is dangerous is neutralised here', () => {
    const jsSource = DANGEROUS_LEAD.source
      .replace(/^\^\[/, '')
      .replace(/\]$/, '')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r');
    for (const ch of jsSource) {
      const out = csvEscapeCell(`${ch}x`);
      const unquoted = out.startsWith('"') && out.endsWith('"') ? out.slice(1, -1) : out;
      expect(unquoted.startsWith("'"), `guard char ${JSON.stringify(ch)}`).toBe(true);
    }
  });
});
