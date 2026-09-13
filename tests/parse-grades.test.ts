import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGradeCsv } from '@/grades/parse-csv';

const csv = readFileSync('tests/fixtures/grades-sample.csv', 'utf8');
const rows = parseGradeCsv(csv);

describe('parseGradeCsv', () => {
  it('parses every data row, skipping the header', () => {
    expect(rows).toHaveLength(7);
  });

  it('extracts course identity', () => {
    expect(rows[0].subject).toBe('CPSC');
    expect(rows[0].courseNumber).toBe('100');
    expect(rows[0].sectionCode).toBe('101');
    expect(rows[0].year).toBe(2025);
    expect(rows[0].session).toBe('W');
  });

  it('parses statistics as numbers', () => {
    expect(rows[0].average).toBeCloseTo(86.4);
    expect(rows[0].median).toBeCloseTo(90);
    expect(rows[0].high).toBe(97);
    expect(rows[0].low).toBe(42);
    expect(rows[0].reported).toBe(116);
  });

  it('treats <50 as a student count, never a percentage', () => {
    // Real data: 54 students below 50 out of 221 reported.
    const row = rows.find((r) => r.courseNumber === '103')!;
    expect(row.reported).toBe(221);
    expect(row.distribution['<50']).toBe(54);
  });

  it('splits co-taught professors on semicolons', () => {
    const row = rows.find((r) => r.courseNumber === '310')!;
    expect(row.professors).toEqual(['Thomas Pasquier', 'Norman Hutchinson']);
  });

  it('returns an empty professor list for a blank professor field', () => {
    const row = rows.find((r) => r.courseNumber === '448')!;
    expect(row.professors).toEqual([]);
  });

  it('captures Detail as part of section identity', () => {
    const row = rows.find((r) => r.courseNumber === '449')!;
    expect(row.detail).toBe('A');
    expect(row.sectionCode).toBe('V01');
  });

  it('keeps non-numeric section codes intact', () => {
    expect(rows.find((r) => r.courseNumber === '555')!.sectionCode).toBe('CH1');
  });

  it('parses a fully suppressed row as nulls, never zeros', () => {
    const row = rows.find((r) => r.courseNumber === '449')!;
    expect(row.average).toBeNull();
    expect(row.median).toBeNull();
    // A suppressed bucket is unknown, NOT zero - collapsing it would invent data.
    expect(row.distribution['<50']).toBeNull();
  });

  it('parses partially suppressed buckets as null while keeping present ones', () => {
    const row = rows.find((r) => r.courseNumber === '555')!;
    expect(row.average).toBeCloseTo(91);
    expect(row.distribution['<50']).toBe(0);
    expect(row.distribution['50-54']).toBeNull();
    expect(row.distribution['90-100']).toBe(4);
  });

  it('returns an empty array for header-only input', () => {
    const header = csv.split('\n')[0];
    expect(parseGradeCsv(header)).toEqual([]);
  });

  it('tolerates a trailing newline', () => {
    expect(parseGradeCsv(`${csv}\n`)).toHaveLength(7);
  });

  it('does not let a comma inside a quoted title shift downstream columns', () => {
    // Real upstream data: CPSC 110's title is quoted because it contains
    // commas. A naive line.split(',') breaks inside the quotes and shifts
    // every numeric column that follows - this reproduces that exact shape.
    const row = rows.find((r) => r.courseNumber === '110')!;
    expect(row.title).toBe('Computation, Programs, and Programming');
    expect(row.professors).toEqual(['Nick Bradley']);
    expect(row.reported).toBe(50);
    expect(row.average).toBeCloseTo(79.1);
    expect(row.median).toBeCloseTo(84);
    expect(row.high).toBe(99);
    expect(row.low).toBe(0);
    expect(row.distribution['<50']).toBe(2);
    expect(row.distribution['90-100']).toBe(3);
  });
});

// The pre-2021 export (tableau-dashboard) differs from the current one:
// the student count is "Enrolled" rather than "Reported", and there is a
// "Std dev" column where the newer files carry Median/percentiles.
describe('parseGradeCsv on the pre-2021 (v1) export', () => {
  const v1 = readFileSync('tests/fixtures/grades-sample-v1.csv', 'utf8');
  const v1Rows = parseGradeCsv(v1);

  it('reads the student count from Enrolled when Reported is absent', () => {
    // Without this the count is null, and a null count drops the row from
    // aggregateDistributions' weighted average entirely - the whole of
    // 2014-2020 would silently stop counting toward a course average.
    expect(v1Rows[0].reported).toBe(85);
    expect(v1Rows[1].reported).toBe(121);
  });

  it('parses identity and statistics despite the reordered columns', () => {
    expect(v1Rows[0].subject).toBe('CPSC');
    expect(v1Rows[0].courseNumber).toBe('100');
    expect(v1Rows[0].sectionCode).toBe('101');
    expect(v1Rows[0].year).toBe(2016);
    expect(v1Rows[0].average).toBeCloseTo(81.6);
    expect(v1Rows[0].high).toBe(99);
    expect(v1Rows[0].low).toBe(55);
    expect(v1Rows[0].distribution['90-100']).toBe(21);
  });

  it('leaves median null - the v1 export has no Median column', () => {
    expect(v1Rows[0].median).toBeNull();
  });

  it('still surfaces the OVERALL rollup row for the caller to filter', () => {
    // Parsing stays faithful to the file; dropping the rollup is the
    // ingest's decision (it is not a real section), not the parser's.
    expect(v1Rows.map((r) => r.sectionCode)).toContain('OVERALL');
  });
});
