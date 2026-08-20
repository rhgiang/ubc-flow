import { describe, it, expect } from 'vitest';
import { findConflicts, type ScheduleEntry } from '@/schedule/conflicts';

const entry = (
  sectionId: string,
  day: string,
  startTime: string,
  endTime: string,
): ScheduleEntry => ({ sectionId, label: sectionId, day, startTime, endTime });

describe('findConflicts', () => {
  it('finds none for a clear schedule', () => {
    expect(
      findConflicts([entry('a', 'Mon', '09:00', '10:00'), entry('b', 'Mon', '10:00', '11:00')]),
    ).toEqual([]);
  });

  it('ignores different days at the same time', () => {
    expect(
      findConflicts([entry('a', 'Mon', '09:00', '10:00'), entry('b', 'Tue', '09:00', '10:00')]),
    ).toEqual([]);
  });

  it('detects a partial overlap', () => {
    const c = findConflicts([
      entry('a', 'Mon', '09:00', '10:30'),
      entry('b', 'Mon', '10:00', '11:00'),
    ]);
    expect(c).toHaveLength(1);
    expect(new Set([c[0].a.sectionId, c[0].b.sectionId])).toEqual(new Set(['a', 'b']));
  });

  it('detects full containment', () => {
    expect(
      findConflicts([entry('a', 'Mon', '09:00', '12:00'), entry('b', 'Mon', '10:00', '11:00')]),
    ).toHaveLength(1);
  });

  it('treats back-to-back as non-overlapping', () => {
    // A class ending exactly when another starts is not a conflict.
    expect(
      findConflicts([entry('a', 'Mon', '09:00', '10:00'), entry('b', 'Mon', '10:00', '11:00')]),
    ).toEqual([]);
  });

  it('never reports a section against itself', () => {
    expect(findConflicts([entry('a', 'Mon', '09:00', '10:00')])).toEqual([]);
  });

  it('reports each conflicting pair once, not twice', () => {
    expect(
      findConflicts([entry('a', 'Mon', '09:00', '11:00'), entry('b', 'Mon', '10:00', '12:00')]),
    ).toHaveLength(1);
  });

  it('skips entries with missing times rather than guessing', () => {
    const c = findConflicts([
      { sectionId: 'a', label: 'a', day: 'Mon', startTime: null, endTime: null },
      entry('b', 'Mon', '09:00', '10:00'),
    ]);
    expect(c).toEqual([]);
  });
});
