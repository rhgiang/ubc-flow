import { describe, expect, it } from 'vitest';
import type { PlanTerm } from '@/guidance/solver';
import {
  COOP_PATTERNS,
  applyCoop,
  degreeYears,
  fromFirstWinter,
  getCoopPattern,
  workTermIds,
} from '@/guidance/coop';

/** The shape loadTerms produces: a summer, then the Winter session beside it. */
const terms: PlanTerm[] = [];
for (let y = 2026; y < 2032; y++) {
  terms.push({ id: `p-${y}S`, name: `${y} Summer Session`, available: true, projected: true });
  terms.push({ id: `p-${y}W1`, name: `${y}-${String(y + 1).slice(2)} Winter Term 1`, available: true, projected: true });
  terms.push({ id: `p-${y}W2`, name: `${y}-${String(y + 1).slice(2)} Winter Term 2`, available: true, projected: true });
}
const nameOf = (id: string) => terms.find((t) => t.id === id)!.name;

describe('co-op work terms', () => {
  it('reads a summer as belonging to the year it follows', () => {
    // Terms arrive in calendar order, so "2027 Summer Session" comes after
    // 2026-27 Winter Term 2 and is therefore the summer after FIRST year —
    // not the summer before the 2027-28 session it is named beside.
    const ids = workTermIds(terms, getCoopPattern('std'));
    expect([...ids].map(nameOf)).toEqual([
      '2028 Summer Session',
      '2028-29 Winter Term 1',
      '2029 Summer Session',
      '2029-30 Winter Term 1',
    ]);
  });

  it('places every pattern as four work terms with at least one in Winter', () => {
    // The Calendar's stated rules for Applied Science co-op.
    for (const pattern of COOP_PATTERNS) {
      const names = [...workTermIds(terms, pattern)].map(nameOf);
      expect(names).toHaveLength(4);
      expect(names.some((n) => /winter/i.test(n))).toBe(true);
    }
  });

  it('closes work terms to coursework and leaves everything else open', () => {
    const masked = applyCoop(terms, getCoopPattern('std'));
    const closed = masked.filter((t) => !t.available).map((t) => t.name);
    expect(closed).toHaveLength(4);
    expect(closed).toContain('2028-29 Winter Term 1');
    expect(masked.filter((t) => t.available)).toHaveLength(terms.length - 4);
  });

  it('does nothing without a pattern', () => {
    expect(applyCoop(terms, null)).toBe(terms);
    expect(workTermIds(terms, null).size).toBe(0);
    expect(getCoopPattern(undefined)).toBeNull();
    expect(getCoopPattern('nonsense')).toBeNull();
  });
});

describe('a degree starts in September', () => {
  it('closes the summer that precedes the first Winter Term 1', () => {
    // With summer enabled the solver filled that leading summer, so first year
    // opened with a 15-credit term nobody registers in and every year label
    // after it was off by half a year.
    const open = fromFirstWinter(terms);
    expect(open[0].name).toBe('2026 Summer Session');
    expect(open[0].available).toBe(false);
    expect(open[1].name).toBe('2026-27 Winter Term 1');
    expect(open[1].available).toBe(true);
  });

  it('leaves later summers alone', () => {
    const open = fromFirstWinter(terms);
    expect(open.find((t) => t.name === '2027 Summer Session')!.available).toBe(true);
  });
});

describe('degree years', () => {
  it('counts a year from each Winter Term 1, not from the row number', () => {
    const years = degreeYears(terms);
    expect(years.get('p-2026W1')).toBe(1);
    expect(years.get('p-2026W2')).toBe(1);
    expect(years.get('p-2027S')).toBe(1); // the summer AFTER first year
    expect(years.get('p-2027W1')).toBe(2);
    expect(years.get('p-2029W1')).toBe(4);
  });
});
