import { describe, it, expect } from 'vitest';
import { layoutDayColumns } from '@/schedule/layout';

type E = { id: string; start: number; end: number };
const range = (e: E) => ({ start: e.start, end: e.end });
const at = (id: string, start: number, end: number): E => ({ id, start, end });

describe('layoutDayColumns', () => {
  it('gives a lone entry the full width', () => {
    const a = at('a', 600, 690);
    const out = layoutDayColumns([a], range);
    expect(out.get(a)).toEqual({ column: 0, columns: 1 });
  });

  it('splits two overlapping entries into two side-by-side columns', () => {
    const a = at('a', 600, 720);
    const b = at('b', 660, 780);
    const out = layoutDayColumns([a, b], range);
    expect(out.get(a)).toEqual({ column: 0, columns: 2 });
    expect(out.get(b)).toEqual({ column: 1, columns: 2 });
  });

  it('keeps non-overlapping entries at full width each', () => {
    const a = at('a', 600, 660);
    const b = at('b', 660, 720);
    const out = layoutDayColumns([a, b], range);
    expect(out.get(a)).toEqual({ column: 0, columns: 1 });
    expect(out.get(b)).toEqual({ column: 0, columns: 1 });
  });

  it('treats back-to-back entries as non-overlapping', () => {
    const a = at('a', 600, 690);
    const b = at('b', 690, 780);
    const out = layoutDayColumns([a, b], range);
    expect(out.get(a)?.columns).toBe(1);
    expect(out.get(b)?.columns).toBe(1);
  });

  it('reuses a freed column for a third entry that clears the first', () => {
    const a = at('a', 600, 660);
    const b = at('b', 630, 780);
    const c = at('c', 670, 720);
    const out = layoutDayColumns([a, b, c], range);
    expect(out.get(b)?.column).toBe(1);
    expect(out.get(c)?.column).toBe(0);
  });

  it('handles an empty day', () => {
    expect(layoutDayColumns([], range).size).toBe(0);
  });
});
