import { describe, it, expect } from 'vitest';
import { conflictKey, type ConflictPair } from '@/schedule/conflicts';

const pair = (a: string, b: string): ConflictPair => ({
  a: { sectionId: a, label: a, day: 'Mon', startTime: '09:00', endTime: '10:00' },
  b: { sectionId: b, label: b, day: 'Mon', startTime: '09:30', endTime: '10:30' },
});

describe('conflictKey', () => {
  it('is empty for no conflicts', () => {
    expect(conflictKey([])).toBe('');
  });

  it('is stable regardless of the order within a pair', () => {
    expect(conflictKey([pair('a', 'b')])).toBe(conflictKey([pair('b', 'a')]));
  });

  it('is stable regardless of the order of pairs', () => {
    expect(conflictKey([pair('a', 'b'), pair('c', 'd')])).toBe(
      conflictKey([pair('c', 'd'), pair('a', 'b')]),
    );
  });

  it('changes when a new conflict appears', () => {
    expect(conflictKey([pair('a', 'b')])).not.toBe(
      conflictKey([pair('a', 'b'), pair('c', 'd')]),
    );
  });

  it('changes when one conflict is replaced by a different one', () => {
    expect(conflictKey([pair('a', 'b')])).not.toBe(conflictKey([pair('a', 'c')]));
  });

  // The property that makes the stale-dismissal bug possible: the key is a
  // pure function of the current set, with no memory of anything the set
  // passed through earlier (like being empty). Rebuilding the same set from
  // scratch must produce the identical key.
  it('is identical when the same set of pairs is rebuilt from scratch', () => {
    expect(conflictKey([pair('a', 'b')])).toBe(conflictKey([pair('a', 'b')]));
  });
});
