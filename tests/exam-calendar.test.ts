import { describe, it, expect } from 'vitest';
import { examCalendar, type ExamDayCell } from '@/schedule/exam-calendar';
import type { ExamListItem } from '@/schedule/exams';

function exam(over: Partial<ExamListItem> & { id: string }): ExamListItem {
  return {
    courseLabel: 'MATH 200',
    sectionCode: '101',
    date: new Date('2026-12-10T00:00:00Z'),
    startTime: '12:00',
    location: 'MATH 100',
    alphaSplit: null,
    notes: null,
    cancelled: false,
    source: 'ubc',
    kind: 'final',
    ...over,
  };
}

/** Cell index of a given day-of-month, so a test can say "Dec 10". */
function cellFor(cells: ExamDayCell[], day: number): ExamDayCell {
  return cells.find((c) => c.day === day)!;
}

describe('examCalendar', () => {
  it('puts an exam in the day cell its UTC date names', () => {
    // 2026-12-10T00:00:00Z is midnight UTC — a local-time read in Vancouver
    // would call this Dec 9. It must land on 10.
    const { months } = examCalendar([exam({ id: 'a' })]);
    expect(months).toHaveLength(1);
    expect(cellFor(months[0].cells, 10).groups).toHaveLength(1);
    expect(cellFor(months[0].cells, 9).groups).toHaveLength(0);
  });

  // Weeks with no exam are trimmed off the top and bottom (see trimEmptyWeeks),
  // so the grid no longer necessarily starts at day 1 — but whatever weeks
  // survive must still sit under the right weekday headers. That is the part
  // that matters, so assert it directly rather than via the leading padding.
  it('keeps every day under its real weekday column', () => {
    const { months } = examCalendar([exam({ id: 'a' })]);
    const cells = months[0].cells;
    expect(cells.length % 7).toBe(0);
    for (const [i, cell] of cells.entries()) {
      if (cell.day === null) continue;
      const weekday = new Date(Date.UTC(2026, 11, cell.day)).getUTCDay();
      expect(i % 7).toBe(weekday);
    }
  });

  it('shows only the months exams fall in, in order — December is not special', () => {
    const { months } = examCalendar([
      exam({ id: 'a', date: new Date('2026-08-18T00:00:00Z') }),
      exam({ id: 'b', date: new Date('2026-04-02T00:00:00Z') }),
    ]);
    expect(months.map((m) => m.key)).toEqual(['2026-04', '2026-08']);
    expect(months[1].label).toBe('August 2026');
  });

  it('keeps two exams on one day in the same cell, earliest first', () => {
    const { months } = examCalendar([
      exam({ id: 'a', courseLabel: 'CPSC 110', startTime: '15:30' }),
      exam({ id: 'b', courseLabel: 'DSCI 100', startTime: '08:30' }),
    ]);
    const groups = cellFor(months[0].cells, 10).groups;
    expect(groups.map((g) => g[0].courseLabel)).toEqual(['DSCI 100', 'CPSC 110']);
  });

  it('counts one exam split across rooms as one entry, not two', () => {
    const { months } = examCalendar([
      exam({ id: 'a', courseLabel: 'BIOL 121', alphaSplit: 'ADI-SUN', location: 'IRC 2' }),
      exam({ id: 'b', courseLabel: 'BIOL 121', alphaSplit: 'TAZ-ZHU', location: 'IRC 6' }),
    ]);
    const groups = cellFor(months[0].cells, 10).groups;
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });

  it('surfaces a cancelled exam as unscheduled instead of dropping it', () => {
    const { months, unscheduled } = examCalendar([
      exam({ id: 'a', cancelled: true, date: null, notes: 'Cancelled: Dec 10 2026' }),
    ]);
    expect(months).toHaveLength(0);
    expect(unscheduled).toHaveLength(1);
    expect(unscheduled[0][0].cancelled).toBe(true);
  });

  // A cancelled row's date is NULL in practice, but a stale date must never
  // put it on the grid as if it were a normal exam.
  it('never gives a cancelled exam a day cell even when it has a date', () => {
    const { months, unscheduled } = examCalendar([exam({ id: 'a', cancelled: true })]);
    expect(months).toHaveLength(0);
    expect(unscheduled).toHaveLength(1);
  });

  it('surfaces a dateless syllabus final as unscheduled', () => {
    const { months, unscheduled } = examCalendar([
      exam({ id: 'a', date: null, startTime: null, source: 'syllabus', notes: 'Final exam' }),
    ]);
    expect(months).toHaveLength(0);
    expect(unscheduled[0][0].source).toBe('syllabus');
  });

  it('grids the dated exams and still hands back the ones that cannot be gridded', () => {
    const { months, unscheduled } = examCalendar([
      exam({ id: 'a' }),
      exam({ id: 'b', courseLabel: 'ENGL 230', cancelled: true, date: null }),
      exam({ id: 'c', courseLabel: 'CHEM 121', date: null, source: 'syllabus', kind: 'midterm' }),
    ]);
    expect(cellFor(months[0].cells, 10).groups).toHaveLength(1);
    expect(unscheduled.map((g) => g[0].courseLabel).sort()).toEqual(['CHEM 121', 'ENGL 230']);
  });

  it('returns nothing at all for a student with no exams', () => {
    expect(examCalendar([])).toEqual({ months: [], unscheduled: [] });
  });
});

// A December grid is five rows but an exam period is about two. The empty
// leading and trailing weeks were half the grid's height, which is what forced
// the mobile chips down to an unreadable 9px.
describe('trimming empty weeks', () => {
  const exam = (day: number, label = 'BIOL 121') => ({
    id: `e${day}${label}`, courseLabel: label, sectionCode: '201',
    kind: 'final' as const, date: new Date(Date.UTC(2026, 11, day)),
    startTime: '12:00', location: 'IRC 2', alphaSplit: null, notes: null,
    cancelled: false, source: 'ubc' as const,
  });

  it('drops leading and trailing weeks with no exams', () => {
    // Dec 2026: Dec 1 is a Tuesday, so the full grid is 5 weeks / 35 cells.
    const full = examCalendar([exam(12), exam(21)]);
    expect(full.months[0].cells.length).toBeLessThan(35);
    // Whole weeks only, so the columns stay under the right weekday headers.
    expect(full.months[0].cells.length % 7).toBe(0);
  });

  it('keeps every week between the first and last exam, even empty ones', () => {
    const spread = examCalendar([exam(1), exam(31)]);
    expect(spread.months[0].cells).toHaveLength(35);
  });

  it('keeps the days of the exams it trims around', () => {
    const cal = examCalendar([exam(12), exam(21)]);
    const days = cal.months[0].cells.filter((c) => c.groups.length > 0).map((c) => c.day);
    expect(days).toEqual([12, 21]);
  });
});
