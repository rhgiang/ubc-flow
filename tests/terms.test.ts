import { describe, it, expect, vi, afterEach } from 'vitest';
import { getCurrentAndNextTerm, isUpcomingTerm, isPlannableTerm, compareTerms } from '@/schedule/terms';

const TERMS = [
  { id: 'w1-25', year: 2025, session: 'W', termNumber: 1 },
  { id: 'w2-25', year: 2025, session: 'W', termNumber: 2 },
  { id: 's-26', year: 2026, session: 'S', termNumber: null },
  { id: 'w1-26', year: 2026, session: 'W', termNumber: 1 },
  { id: 'w2-26', year: 2026, session: 'W', termNumber: 2 },
];

afterEach(() => {
  vi.useRealTimers();
});

describe('getCurrentAndNextTerm', () => {
  it('picks Summer as current and Winter T1 as next, in August', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 22)); // Aug 22 — month index 7
    const { current, next } = getCurrentAndNextTerm(TERMS);
    expect(current?.id).toBe('s-26');
    expect(next?.id).toBe('w1-26');
  });

  it('picks Winter T1 as current and Winter T2 as next, in October', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1));
    const { current, next } = getCurrentAndNextTerm(TERMS);
    expect(current?.id).toBe('w1-26');
    expect(next?.id).toBe('w2-26');
  });

  it('picks Winter T2 as current using the PRIOR academic year, in February', () => {
    // Feb 2026 falls in "2025-26 Winter Term 2" — academic year 2025, not 2026.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 1, 1));
    const { current, next } = getCurrentAndNextTerm(TERMS);
    expect(current?.id).toBe('w2-25');
    expect(next?.id).toBe('s-26');
  });

  it('returns null for both when nothing in the list is current or later', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2030, 0, 1));
    const { current, next } = getCurrentAndNextTerm(TERMS);
    expect(current).toBeNull();
    expect(next).toBeNull();
  });

  it('returns a null next term when current is the last term in the list', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 1));
    const { current, next } = getCurrentAndNextTerm(TERMS.slice(0, 4)); // no w2-26
    expect(current?.id).toBe('w1-26');
    expect(next).toBeNull();
  });
});

describe('isUpcomingTerm', () => {
  it('is true for the current term and every term after it, in August', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 22));
    expect(isUpcomingTerm(TERMS.find((t) => t.id === 's-26')!)).toBe(true);
    expect(isUpcomingTerm(TERMS.find((t) => t.id === 'w1-26')!)).toBe(true);
    expect(isUpcomingTerm(TERMS.find((t) => t.id === 'w2-26')!)).toBe(true);
  });

  it('is false for a term that has already passed, in August', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 22));
    expect(isUpcomingTerm(TERMS.find((t) => t.id === 'w2-25')!)).toBe(false);
    expect(isUpcomingTerm(TERMS.find((t) => t.id === 'w1-25')!)).toBe(false);
  });
});

describe('compareTerms', () => {
  it('orders Summer before Winter T1 before Winter T2 within an academic year', () => {
    const shuffled = [
      { id: 'w2-26', year: 2026, session: 'W', termNumber: 2 },
      { id: 's-26', year: 2026, session: 'S', termNumber: null },
      { id: 'w1-26', year: 2026, session: 'W', termNumber: 1 },
    ];
    expect([...shuffled].sort(compareTerms).map((t) => t.id)).toEqual(['s-26', 'w1-26', 'w2-26']);
  });

  it('sorts across academic years, keeping Winter T2 with the year it started', () => {
    // 2025 Winter T2 runs Jan-Apr 2026 but is stored as year 2025, so it must
    // still sort before Summer 2026 — a plain year comparison gets this wrong.
    expect([...TERMS].sort(compareTerms).map((t) => t.id)).toEqual([
      'w1-25',
      'w2-25',
      's-26',
      'w1-26',
      'w2-26',
    ]);
  });
});

describe('isPlannableTerm', () => {
  it('is true in January for the Winter Term 2 that started the PRIOR academic year', () => {
    // "2026-27 Winter Term 2" runs Jan-Apr 2027 but is stored as year: 2026 —
    // a plain year >= currentYear check wrongly excludes it from 1 Jan onward.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-15'));
    expect(isPlannableTerm({ year: 2026, session: 'W', termNumber: 2 })).toBe(true);
  });

  it('is false for a term that has genuinely already finished', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-15'));
    expect(isPlannableTerm({ year: 2025, session: 'W', termNumber: 2 })).toBe(false);
  });
});
