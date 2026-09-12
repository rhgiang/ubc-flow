import { describe, it, expect } from 'vitest';
import { toExamListItem } from '@/schedule/exams';
import { formatDate, groupExams } from '@/components/ExamList';

describe('toExamListItem', () => {
  it('joins building and room into one location string', () => {
    const item = toExamListItem({
      id: 'e1', sectionCode: '951', date: new Date('2026-08-18T00:00:00Z'),
      startTime: '12:00', building: 'BIOL', room: '1000', alphaSplit: null,
      notes: null, cancelled: false,
      course: { number: '302', subject: { code: 'BIOC_V' } },
    });
    expect(item.location).toBe('BIOL 1000');
    expect(item.courseLabel).toBe('BIOC 302');
  });

  // "BIOC_V" is the Workday/scrape spelling; students read "BIOC".
  it('strips the campus suffix from the subject code', () => {
    const item = toExamListItem({
      id: 'e2', sectionCode: '001', date: null, startTime: null,
      building: null, room: null, alphaSplit: null,
      notes: 'Cancelled: August 17 2026, 3:30pm', cancelled: true,
      course: { number: '230', subject: { code: 'ENGL_V' } },
    });
    expect(item.courseLabel).toBe('ENGL 230');
    expect(item.location).toBeNull();
    expect(item.cancelled).toBe(true);
  });

  it('marks every scraped row as a final', () => {
    const item = toExamListItem({
      id: 'e3', sectionCode: '921', date: new Date('2026-08-18T00:00:00Z'),
      startTime: '08:30', building: 'IRC', room: '2', alphaSplit: 'ADI-SUN',
      notes: null, cancelled: false,
      course: { number: '123', subject: { code: 'CHEM' } },
    });
    expect(item.kind).toBe('final');
    expect(item.source).toBe('ubc');
    expect(item.alphaSplit).toBe('ADI-SUN');
  });
});

// Exam dates are stored as UTC midnight. Without an explicit timeZone this
// formats in the server's zone, and every date west of Greenwich renders a
// day early — "Mon, Aug 17" for a Tuesday exam.
describe('formatDate', () => {
  it('reads a UTC-midnight date back in UTC, not the server zone', () => {
    expect(formatDate(new Date('2026-08-18T00:00:00Z'))).toBe('Tue, Aug 18');
  });

  it('holds even when the process runs in America/Vancouver', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/Vancouver';
    try {
      expect(formatDate(new Date('2026-12-15T00:00:00Z'))).toBe('Tue, Dec 15');
    } finally {
      // Assigning an undefined `tz` back would set the literal string
      // "undefined", and fileParallelism:false leaks that into every later
      // test file in the run.
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
  });
});

// UBC splits a big exam across rooms by surname and publishes one row per
// room. Rendering those as separate cards read as "you have two BIOL 121
// exams" to the first person who saw the page.
describe('groupExams', () => {
  const base = {
    courseLabel: 'BIOL 121', sectionCode: '201', kind: 'final' as const,
    date: new Date('2026-12-12T00:00:00Z'), startTime: '15:30',
    notes: null, cancelled: false, source: 'ubc' as const,
  };
  const adi = { ...base, id: 'a', alphaSplit: 'ABB-MEN', location: 'IRC 2' };
  const taz = { ...base, id: 'b', alphaSplit: 'MER-ZHU', location: 'IRC 6' };

  it('collapses rooms of one split exam into a single group', () => {
    const groups = groupExams([adi, taz]);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((r) => r.location)).toEqual(['IRC 2', 'IRC 6']);
  });

  it('keeps a midterm and a final for one course apart', () => {
    const midterm = { ...adi, id: 'c', kind: 'midterm' as const };
    expect(groupExams([adi, midterm])).toHaveLength(2);
  });

  it('keeps two exams of the same kind on different dates apart', () => {
    const later = { ...adi, id: 'd', date: new Date('2026-12-19T00:00:00Z') };
    expect(groupExams([adi, later])).toHaveLength(2);
  });

  it('keeps a scraped and a syllabus row apart even when they align', () => {
    const fromSyllabus = { ...adi, id: 'e', source: 'syllabus' as const };
    expect(groupExams([adi, fromSyllabus])).toHaveLength(2);
  });
});
