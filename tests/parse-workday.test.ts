import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readWorkbookGrid } from '@/upload/read-grid';
import {
  parseStudentNumber,
  parseSectionCode,
  parseMeetingPatterns,
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

describe('parseMeetingPatterns', () => {
  it('extracts the date range from a pipe-delimited pattern', () => {
    const [r] = parseMeetingPatterns('2026-09-09 - 2026-12-04 | Wed Fri | 10:00 a.m. - 11:00 a.m.');
    expect(r.startDate).toBe('2026-09-09');
    expect(r.endDate).toBe('2026-12-04');
  });

  it('extracts days and converts the time range to 24-hour', () => {
    const [r] = parseMeetingPatterns('2026-09-09 - 2026-12-04 | Wed Fri | 10:00 a.m. - 11:30 a.m. | UBCV');
    expect(r.days).toEqual(['Wed', 'Fri']);
    expect(r.startTime).toBe('10:00');
    expect(r.endTime).toBe('11:30');
  });

  it('converts a p.m. time range correctly, including the 12 p.m./a.m. edge cases', () => {
    const [r] = parseMeetingPatterns('2026-09-09 - 2026-12-04 | Mon | 12:00 p.m. - 1:30 p.m.');
    expect(r.startTime).toBe('12:00');
    expect(r.endTime).toBe('13:30');
    const [midnight] = parseMeetingPatterns('2026-09-09 - 2026-12-04 | Mon | 12:00 a.m. - 1:00 a.m.');
    expect(midnight.startTime).toBe('00:00');
  });

  it('merges blocks that repeat one weekly pattern into a single span', () => {
    // A course split around reading week: same days, time and room, so it is
    // ONE pattern running from the first block's start to the last block's end.
    const r = parseMeetingPatterns(
      '2027-01-06 - 2027-02-12 | Mon Wed Fri | 10:00 a.m. - 11:00 a.m.\n\n2027-02-22 - 2027-04-12 | Mon Wed Fri | 10:00 a.m. - 11:00 a.m.',
    );
    expect(r).toHaveLength(1);
    expect(r[0].startDate).toBe('2027-01-06');
    expect(r[0].endDate).toBe('2027-04-12');
    expect(r[0].days).toEqual(['Mon', 'Wed', 'Fri']);
  });

  it('keeps a block with a different day, time or room as its OWN pattern', () => {
    // MANU_V 261's real cell: Mon Wed 1–2 plus Fri 2–3. Reading only the
    // first block dropped the Friday class from student calendars.
    const r = parseMeetingPatterns(
      '2026-09-09 - 2026-12-07 | Mon Wed | 1:00 p.m. - 2:00 p.m. | UBCV | Frank Forward Building (FORW) | Floor: 2 | Room: 217\n\n' +
        '2026-09-11 - 2026-12-04 | Fri | 2:00 p.m. - 3:00 p.m. | UBCV | Frank Forward Building (FORW) | Floor: 2 | Room: 217',
    );
    expect(r).toHaveLength(2);
    expect(r[0].days).toEqual(['Mon', 'Wed']);
    expect(r[0].startTime).toBe('13:00');
    expect(r[1].days).toEqual(['Fri']);
    expect(r[1].startTime).toBe('14:00');
    expect(r[1].endTime).toBe('15:00');
    expect(r[1].room).toBe('217');
  });

  it('returns no patterns for an empty cell', () => {
    expect(parseMeetingPatterns('')).toEqual([]);
  });

  it('extracts the building code from the trailing parenthetical', () => {
    const cell =
      '2026-09-09 - 2026-12-04 | Wed Fri | 10:00 a.m. - 11:30 a.m. | UBCV | Hennings Building (HENN) | Floor: 1 | Room: 202';
    const [m] = parseMeetingPatterns(cell);
    expect(m.building).toBe('HENN');
    expect(m.room).toBe('202');
  });

  it('takes the LAST parenthetical when the name repeats the code', () => {
    const cell =
      '2026-09-09 - 2026-12-04 | Wed | 10:00 a.m. - 11:30 a.m. | UBCV | CIRS (Centre for Interactive Research on Sustainability) (CIRS) | Floor: 1 | Room: 1250';
    expect(parseMeetingPatterns(cell)[0].building).toBe('CIRS');
  });

  it('handles a room with a letter prefix and a negative floor', () => {
    const cell =
      '2026-09-09 - 2026-12-04 | Mon | 2:00 p.m. - 3:30 p.m. | UBCV | Gordon B. Shrum Building (SHRM) | Floor: -1 | Room: B1001';
    const [m] = parseMeetingPatterns(cell);
    expect(m.building).toBe('SHRM');
    expect(m.room).toBe('B1001');
  });

  it('returns nulls when the cell carries no location segments', () => {
    const [m] = parseMeetingPatterns('2026-09-09 - 2026-12-04 | Wed | 10:00 a.m. - 11:30 a.m.');
    expect(m.building).toBeNull();
    expect(m.room).toBeNull();
    // The fields it already parsed must be unaffected.
    expect(m.days).toEqual(['Wed']);
    expect(m.startTime).toBe('10:00');
  });

  it('falls back to the raw building segment when it has no parenthetical', () => {
    const cell = '2026-09-09 - 2026-12-04 | Wed | 10:00 a.m. - 11:30 a.m. | UBCV | Some Hall | Floor: 2 | Room: 5';
    expect(parseMeetingPatterns(cell)[0].building).toBe('Some Hall');
  });
});

describe('parseWorkdayExport - one row per weekly pattern', () => {
  it('emits a row for EACH weekly pattern of a section', () => {
    // MANU_V 231's real shape: the lecture meets Wed 2–3 in one room and
    // Fri 1–2 in another, in one Meeting Patterns cell.
    const grid = [
      ['', 'Course Listing', 'Section', 'Instructional Format', 'Meeting Patterns'],
      [
        'A Student (12345678) - Faculty',
        'MANU_V 231 - Introduction to Manufacturing Engineering',
        'MANU_V 231-101 - Introduction to Manufacturing Engineering',
        'Lecture',
        '2026-09-09 - 2026-12-02 | Wed | 2:00 p.m. - 3:00 p.m. | UBCV | Civil and Mechanical Engineering Building (CEME) | Floor: 1 | Room: 1204\n\n' +
          '2026-09-11 - 2026-12-04 | Fri | 1:00 p.m. - 2:00 p.m. | UBCV | Civil and Mechanical Engineering Building (CEME) | Floor: 1 | Room: 1202',
      ],
    ];
    const r = parseWorkdayExport(grid);
    expect(r.rows).toHaveLength(2);
    expect(r.rows.map((x) => x.sectionCode)).toEqual(['101', '101']);
    expect(r.rows[0].days).toEqual(['Wed']);
    expect(r.rows[0].meetingStartTime).toBe('14:00');
    expect(r.rows[0].room).toBe('1204');
    expect(r.rows[1].days).toEqual(['Fri']);
    expect(r.rows[1].meetingStartTime).toBe('13:00');
    expect(r.rows[1].room).toBe('1202');
    // Both rows carry the same September-inferred term.
    expect(r.rows.every((x) => x.termYear === 2026 && x.termNumber === 1)).toBe(true);
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

describe('parseWorkdayExport - current courses fixture', () => {
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

  it('spans more than one term - the export is not single-term', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-current.xlsx'));
    const r = parseWorkdayExport(grid);
    const terms = new Set(r.rows.map((x) => `${x.termYear}-${x.termSession}${x.termNumber}`));
    expect(terms.size).toBeGreaterThan(1);
  });

  it('excludes nothing as transfer in a current-courses export', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-current.xlsx'));
    expect(parseWorkdayExport(grid).excluded).toHaveLength(0);
  });

  it('carries every enrolled-section column except grading', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-current.xlsx'));
    const r = parseWorkdayExport(grid);

    const dsci = r.rows.find((x) => x.subjectCode === 'DSCI' && x.courseNumber === '100')!;
    expect(dsci.sectionCode).toBe('004');
    expect(dsci.activity).toBe('Lecture');
    expect(dsci.deliveryMode).toBe('In Person Learning');
    expect(dsci.registrationStatus).toBe('Registered');
    expect(dsci.instructor).toBe('Lasantha Premarathna Wijendra Acharige');
    expect(dsci.credits).toBe(3);
    expect(dsci.building).toBe('SHRM');
    expect(dsci.floor).toBe('-1');
    expect(dsci.room).toBe('B1001');
    expect(dsci.days).toEqual(['Mon', 'Wed']);
    expect(dsci.meetingStartTime).toBe('14:00');
    expect(dsci.meetingEndTime).toBe('15:30');
    expect(dsci.sectionStartDate).toBe('2026-09-09');
    expect(dsci.sectionEndDate).toBe('2026-12-07');

    // A section split around reading week spans to the LAST block's end.
    const cpsc210 = r.rows.find((x) => x.courseNumber === '210' && x.sectionCode === '201')!;
    expect(cpsc210.startDate).toBe('2027-01-06');
    expect(cpsc210.meetingEndDate).toBe('2027-04-12');

    // Labs and tutorials carry no instructor in Workday - null, not ''.
    const lab = r.rows.find((x) => x.activity === 'Laboratory')!;
    expect(lab.instructor).toBeNull();
    expect(lab.building).not.toBeNull();
  });
});

describe('parseWorkdayExport - academic record fixture', () => {
  it('never turns transfer credit into an enrollment', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-record.xlsx'));
    const r = parseWorkdayExport(grid);

    // The sample record is entirely transfer credit from another institution.
    // Keeping it out of `rows` is the safety property: the review gate reads
    // enrollments, so a course taken elsewhere can never earn review rights
    // for UBC's version of it.
    expect(r.rows).toHaveLength(0);
  });

  it('keeps transfer credit instead of discarding it', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-record.xlsx'));
    const r = parseWorkdayExport(grid);

    // It used to be dropped, which understated a transfer student's progress
    // - UBC granted the credit, so a degree plan that ignores it overstates
    // what they still owe.
    expect(r.transfers.length).toBeGreaterThan(5);
    for (const t of r.transfers) expect(t.raw).toBeTruthy();
  });

  it('carries unassigned transfer credit, which is not a course at all', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-record.xlsx'));
    const r = parseWorkdayExport(grid);

    // "PHYS_V 1ST" is first-year credit in a subject rather than a specific
    // course. It counts toward a degree total but resolves to no course, which
    // is why TransferCredit.courseId is nullable.
    const unassigned = r.transfers.filter((t) => t.courseNumber === null);
    expect(unassigned.length).toBeGreaterThan(0);
    expect(unassigned.every((t) => t.raw.includes('1ST'))).toBe(true);
  });

  it('still reads the student number from a record export', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-record.xlsx'));
    expect(parseWorkdayExport(grid).studentNumber).toBe('99999999');
  });
});

describe('parseWorkdayExport - safety', () => {
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

describe('parseWorkdayExport - unknown tables', () => {
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

describe('unrecognised exports', () => {
  it('reports header-shaped rows when no known table exists', async () => {
    const { parseWorkdayExport } = await import('../src/upload/parse-workday');
    const grid = [
      ['View My Academic Record', '', '', ''],
      ['', 'Completed Coursework', 'Grade', 'Credits'],
      ['Test Student (99999999)', 'CPSC_V 110', 'A', '4'],
    ];
    const parsed = parseWorkdayExport(grid);
    expect(parsed.studentNumber).toBeNull();
    expect(parsed.unparsedTables.length).toBeGreaterThan(0);
    expect(parsed.unparsedTables[0]).toContain('Completed Coursework');
  });
});

describe('academic record export (Enrollments table)', () => {
  it('parses courses and grades with no term, and finds the student', async () => {
    const { parseWorkdayExport } = await import('../src/upload/parse-workday');
    const grid = [
      ['Enrollments', '', '', '', ''],
      ['', 'Course', 'Grade', 'Percentage Grades', 'Credits'],
      ['A Student (12345678) - Faculty of Science', 'BIOL_V 112 - Biology of the Cell', 'A', '85', '3'],
      ['A Student (12345678) - Faculty of Science', 'MATH_V 101 - Integral Calculus', 'F', '42', '3'],
    ];
    const parsed = parseWorkdayExport(grid);
    expect(parsed.studentNumber).toBe('12345678');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.excluded).toHaveLength(0);
    // No dates anywhere in this export, so no term can be claimed.
    expect(parsed.rows[0].termYear).toBeNull();
    expect(parsed.rows[0].termSession).toBeNull();
    expect(parsed.rows[0].subjectCode).toBe('BIOL');
    expect(parsed.rows[0].status).toBe('passed');
    expect(parsed.rows[1].status).toBe('failed');
  });

  it('still excludes an undated row from a table that does carry dates', async () => {
    const { parseWorkdayExport } = await import('../src/upload/parse-workday');
    const grid = [
      ['My Enrolled Courses', '', '', ''],
      ['', 'Course Listing', 'Meeting Patterns', 'Start Date'],
      ['A Student (12345678)', 'CPSC_V 110 - Computation', '', ''],
    ];
    const parsed = parseWorkdayExport(grid);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.excluded[0]?.reason).toBe('no_term');
  });
});
