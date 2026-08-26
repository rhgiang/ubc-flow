import { describe, it, expect } from 'vitest';
import { timeAgo } from '@/lib/relative-time';

const now = new Date('2026-08-25T12:00:00Z');
const ago = (ms: number) => timeAgo(new Date(now.getTime() - ms), now);

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('timeAgo', () => {
  it('climbs to the largest unit that still reads as a whole number', () => {
    expect(ago(30 * SECOND)).toBe('30 seconds ago');
    expect(ago(5 * MINUTE)).toBe('5 minutes ago');
    expect(ago(3 * HOUR)).toBe('3 hours ago');
    expect(ago(3 * DAY)).toBe('3 days ago');
    expect(ago(14 * DAY)).toBe('2 weeks ago');
    expect(ago(200 * DAY)).toBe('7 months ago');
    expect(ago(800 * DAY)).toBe('2 years ago');
  });

  it('uses the words a person would, not a count of one', () => {
    expect(ago(DAY)).toBe('yesterday');
    expect(ago(0)).toBe('now');
  });

  it('does not round a fresh review up to a unit it has not reached', () => {
    // 6 days is not "last week" yet — the week division starts at 7.
    expect(ago(6 * DAY)).toBe('6 days ago');
  });
});
