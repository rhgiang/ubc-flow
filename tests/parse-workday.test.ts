import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readWorkbookGrid } from '@/upload/read-grid';
import {
  parseStudentNumber,
  parseSectionCode,
  parseMeetingPattern,
  inferTerm,
  parseWorkdayExport,
} from '@/upload/parse-workday';

describe('parseStudentNumber', () => {
  it('extracts the number from the identity cell', () => {
    expect(parseStudentNumber('Test Student (99999999) - Faculty of Science')).toBe('99999999');
  });

  it('returns null when no number is present', () => {
    expect(parseStudentNumber('Course Listing')).toBeNull();
    expect(parseStudentNumber('')).toBeNull();
  });

  it('does not match a bare number outside parentheses', () => {
    expect(parseStudentNumber('CPSC_V 110 - 12345678 things')).toBeNull();
  });
});

describe('parseSectionCode', () => {
  it('pulls the section off a section cell', () => {
    expect(parseSectionCode('CPSC_V 110-L1U - Computation, Programs')).toBe('L1U');
    expect(parseSectionCode('MATH_V 200-103 - Calculus III')).toBe('103');
  });

  it('returns null on an unparseable cell', () => {
    expect(parseSectionCode('')).toBeNull();
    expect(parseSectionCode('nonsense')).toBeNull();
  });
});

describe('parseMeetingPattern', () => {
  it('extracts the date range from a pipe-delimited pattern', () => {
    const r = parseMeetingPattern('2026-09-09 - 2026-12-04 | Wed Fri | 10:00 a.m. - 11:00 a.m.');
    expect(r.startDate).toBe('2026-09-09');
    expect(r.endDate).toBe('2026-12-04');
  });

  it('returns nulls when no dates are present', () => {
    expect(parseMeetingPattern('')).toEqual({ startDate: null, endDate: null });
  });
});

describe('inferTerm', () => {
  it('maps September to Winter Term 1 of that academic year', () => {
    expect(inferTerm('2026-09-09')).toEqual({ year: 2026, session: 'W', termNumber: 1 });
  });

  it('maps January to Winter Term 2 of the PREVIOUS academic year', () => {
    expect(inferTerm('2027-01-06')).toEqual({ year: 2026, session: 'W', termNumber: 2 });
  });

  it('maps June to Summer Session', () => {
    expect(inferTerm('2026-06-01')).toEqual({ year: 2026, session: 'S', termNumber: null });
  });

  it('returns null on garbage', () => {
    expect(inferTerm('not-a-date')).toBeNull();
  });
});

describe('parseWorkdayExport — current courses fixture', () => {
  it('parses the fixture end to end', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-current.xlsx'));
    const r = parseWorkdayExport(grid);

    expect(r.studentNumber).toBe('99999999');
    expect(r.rows.length).toBeGreaterThan(5);

    for (const row of r.rows) {
      expect(row.subjectCode).toMatch(/^[A-Z]{2,6}$/);
      expect(row.courseNumber).toMatch(/^\d{3}[A-Z]?$/);
      expect(row.campus).toBe('V');
    }
  });

  it('finds a known course from the fixture', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-current.xlsx'));
    const r = parseWorkdayExport(grid);
    expect(r.rows.some((x) => x.subjectCode === 'CPSC' && x.courseNumber === '110')).toBe(true);
  });

  it('spans more than one term — the export is not single-term', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-current.xlsx'));
    const r = parseWorkdayExport(grid);
    const terms = new Set(r.rows.map((x) => `${x.termYear}-${x.termSession}${x.termNumber}`));
    expect(terms.size).toBeGreaterThan(1);
  });

  it('excludes nothing as transfer in a current-courses export', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-current.xlsx'));
    expect(parseWorkdayExport(grid).excluded).toHaveLength(0);
  });
});

describe('parseWorkdayExport — academic record fixture', () => {
  it('excludes every transfer-credit row from enrollment', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-record.xlsx'));
    const r = parseWorkdayExport(grid);

    // The sample record is entirely transfer credit from another institution.
    expect(r.excluded.length).toBeGreaterThan(5);
    expect(r.rows).toHaveLength(0);
  });

  it('reports why each row was excluded', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-record.xlsx'));
    const r = parseWorkdayExport(grid);
    for (const e of r.excluded) expect(e.reason).toBe('transfer_credit');
  });

  it('still reads the student number from a record export', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-record.xlsx'));
    expect(parseWorkdayExport(grid).studentNumber).toBe('99999999');
  });
});

describe('parseWorkdayExport — safety', () => {
  it('rejects a file containing two different student numbers', () => {
    const grid = [
      ['', 'Course Listing', '', '', '', '', 'Section', 'Registration Status'],
      ['Student A (11111111) - Faculty', 'CPSC_V 110 - Thing', '', '', '', '', 'CPSC_V 110-101 - Thing', 'Registered'],
      ['Student B (22222222) - Faculty', 'CPSC_V 121 - Thing', '', '', '', '', 'CPSC_V 121-101 - Thing', 'Registered'],
    ];
    expect(() => parseWorkdayExport(grid)).toThrow(/one student/i);
  });

  it('returns an empty result rather than throwing on an unrecognised grid', () => {
    const r = parseWorkdayExport([['nothing', 'useful', 'here']]);
    expect(r.rows).toHaveLength(0);
    expect(r.studentNumber).toBeNull();
  });
});

describe('parseWorkdayExport — unknown tables', () => {
  it('reports a second table rather than silently ignoring it', () => {
    const grid = [
      ['', 'Course Listing', 'Section', 'Registration Status', 'Meeting Patterns'],
      ['Test Student (99999999) - Faculty', 'CPSC_V 110 - Thing', 'CPSC_V 110-101 - Thing', 'Registered', '2026-09-09 - 2026-12-04'],
      ['', '', '', '', ''],
      ['', 'Completed Coursework', 'Grade', '', ''],
      ['Test Student (99999999) - Faculty', 'MATH_V 100 - Thing', 'A', '', ''],
    ];
    const r = parseWorkdayExport(grid);
    expect(r.rows).toHaveLength(1);
    expect(r.unparsedTables.length).toBeGreaterThan(0);
    expect(r.unparsedTables.join(' ')).toMatch(/Completed Coursework/);
  });

  it('reports no unknown tables for the single-table fixtures', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-current.xlsx'));
    expect(parseWorkdayExport(grid).unparsedTables).toHaveLength(0);
  });

  it('stops at the first table boundary instead of reading a second real table through the first table\'s column map', async () => {
    const current = await readWorkbookGrid(readFileSync('tests/fixtures/workday-current.xlsx'));
    const record = await readWorkbookGrid(readFileSync('tests/fixtures/workday-record.xlsx'));

    const soloRows = parseWorkdayExport(current).rows;
    const r = parseWorkdayExport([...current, ...record]);

    // No rows leaked from the second table via the first table's column map.
    expect(r.rows).toHaveLength(soloRows.length);
    // The second table is reported, not silently dropped.
    expect(r.unparsedTables.length).toBeGreaterThan(0);
    // None of the transfer-credit rows from the second table appear in `rows`.
    expect(r.rows.some((x) => x.subjectCode === 'MATH' && x.courseNumber === '101')).toBe(false);
  });
});
