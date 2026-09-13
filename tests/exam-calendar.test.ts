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

  it('pads the first week so day 1 sits under its real weekday', () => {
    // Dec 1 2026 is a Tuesday, so two blanks (Sun, Mon) precede it.
    const { months } = examCalendar([exam({ id: 'a' })]);
    const cells = months[0].cells;
    expect(cells.slice(0, 2).every((c) => c.day === null)).toBe(true);
    expect(cells[2].day).toBe(1);
    expect(cells.length % 7).toBe(0);
    // December has 31 days; the last one must still be there.
    expect(cellFor(cells, 31)).toBeDefined();
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
