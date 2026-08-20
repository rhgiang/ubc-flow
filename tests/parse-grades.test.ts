import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGradeCsv } from '@/grades/parse-csv';

const csv = readFileSync('tests/fixtures/grades-sample.csv', 'utf8');
const rows = parseGradeCsv(csv);

describe('parseGradeCsv', () => {
  it('parses every data row, skipping the header', () => {
    expect(rows).toHaveLength(6);
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
    // A suppressed bucket is unknown, NOT zero — collapsing it would invent data.
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
    expect(parseGradeCsv(`${csv}\n`)).toHaveLength(6);
  });
});
