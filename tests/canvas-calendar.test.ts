import { describe, it, expect } from 'vitest';
import { buildMonths, weekdayOf, daysInMonth } from '@/canvas/calendar';

const at = (dayKey: string, id = dayKey) => ({ dayKey, id });

describe('weekdayOf', () => {
  it('knows a few days everyone can check', () => {
    expect(weekdayOf(2026, 9, 20)).toBe(0); // Sunday
    expect(weekdayOf(2026, 9, 21)).toBe(1);
    expect(weekdayOf(2000, 1, 1)).toBe(6); // Saturday
    expect(weekdayOf(2026, 1, 1)).toBe(4); // Thursday
  });
});

describe('daysInMonth', () => {
  it('handles the leap rules, including the century exceptions', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28); // divisible by 100, not 400
    expect(daysInMonth(2000, 2)).toBe(29); // divisible by 400
    expect(daysInMonth(2026, 9)).toBe(30);
  });
});

describe('buildMonths', () => {
  it('returns nothing for nothing', () => {
    expect(buildMonths([])).toEqual([]);
  });

  it('keeps whole rows and pads the ragged ends of a full month', () => {
    // Items in the first and last week, so nothing is trimmed away.
    const [m] = buildMonths([at('2026-09-01'), at('2026-09-30')]);
    expect(m.key).toBe('2026-09');
    expect(m.label).toBe('September 2026');
    expect(m.cells.length % 7).toBe(0);
    // Sep 1 2026 is a Tuesday, so two blanks lead the grid.
    expect(m.cells.slice(0, 2).every((c) => c.day === null)).toBe(true);
    expect(m.cells[2].day).toBe(1);
    expect(m.cells.filter((c) => c.day !== null)).toHaveLength(30);
  });

  it('drops whole empty weeks at the start and end of a month', () => {
    // One item on Sep 20. Sep 1 is a Tuesday, so weeks 1 to 3 hold nothing
    // and a student should not scroll past three blank rows to reach it.
    const [m] = buildMonths([at('2026-09-20')]);
    expect(m.cells).toHaveLength(7);
    expect(m.cells[0].day).toBe(20); // Sep 20 is a Sunday
    expect(m.cells.some((c) => c.items.length > 0)).toBe(true);
  });

  it('keeps the week between two busy ones even when it is empty', () => {
    const [m] = buildMonths([at('2026-09-07'), at('2026-09-21')]);
    expect(m.cells.length).toBe(21); // three weeks, middle one blank
    expect(m.cells.slice(7, 14).every((c) => c.items.length === 0)).toBe(true);
  });

  it('puts an item in its own day and leaves the rest empty', () => {
    const [m] = buildMonths([at('2026-09-20', 'a')]);
    const twentieth = m.cells.find((c) => c.day === 20)!;
    expect(twentieth.items.map((i) => i.id)).toEqual(['a']);
    expect(m.cells.filter((c) => c.items.length > 0)).toHaveLength(1);
  });

  it('stacks several items on one day, keeping their order', () => {
    const [m] = buildMonths([at('2026-09-20', 'a'), at('2026-09-20', 'b'), at('2026-09-20', 'c')]);
    expect(m.cells.find((c) => c.day === 20)!.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('orders months and skips the empty ones between them', () => {
    // Nothing in October: a student with a quiet month should not scroll past
    // a blank grid to reach November.
    const months = buildMonths([at('2026-11-03'), at('2026-09-20'), at('2026-12-01')]);
    expect(months.map((m) => m.key)).toEqual(['2026-09', '2026-11', '2026-12']);
  });

  it('crosses a year boundary in the right order', () => {
    expect(buildMonths([at('2027-01-05'), at('2026-12-31')]).map((m) => m.key)).toEqual(['2026-12', '2027-01']);
  });

  it('handles February in a leap year', () => {
    // Items in the first and last week so the trim leaves the month whole.
    const [m] = buildMonths([at('2028-02-01'), at('2028-02-29')]);
    expect(m.cells.filter((c) => c.day !== null)).toHaveLength(29);
    expect(m.cells.find((c) => c.day === 29)!.items).toHaveLength(1);
    expect(m.cells.length % 7).toBe(0);
  });

  it('drops a malformed key rather than taking the whole grid down', () => {
    expect(buildMonths([at('not-a-date'), at('2026-09-20', 'good')])).toHaveLength(1);
  });

  it('gives every cell a unique key, blanks included', () => {
    const [m] = buildMonths([at('2026-09-20')]);
    expect(new Set(m.cells.map((c) => c.key)).size).toBe(m.cells.length);
  });
});
