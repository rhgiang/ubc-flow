// tests/canvas-notices.test.ts
import { describe, it, expect } from 'vitest';
import { selectNotices, type DeadlineForNotice, type Prefs } from '@/canvas/notices';

const H = 60 * 60 * 1000;
const NOW = new Date('2026-10-24T15:00:00Z');
const at = (hoursFromNow: number) => new Date(NOW.getTime() + hoursFromNow * H);
const dl = (over: Partial<DeadlineForNotice> & { id: string }): DeadlineForNotice => ({
  title: 'T', courseName: 'CPSC 110', dueAt: at(48), allDay: false, url: null,
  movedFrom: null, movedAt: null, removedAt: null, ...over,
});
const prefs: Prefs = { enabled: true, leadHours: [72, 24], mutedCourses: [] };
const keys = (n: ReturnType<typeof selectNotices>) => n.map((x) => x.key).sort();

describe('selectNotices, lead reminders', () => {
  it('fires a lead whose window opened within the last 24 hours', () => {
    // Due in 70h: the 72h window opened 2h ago. The 24h window is not open.
    expect(keys(selectNotices([dl({ id: 'a', dueAt: at(70) })], prefs, NOW))).toEqual(['lead:72']);
  });

  it('does not fire a window that has not opened', () => {
    expect(selectNotices([dl({ id: 'a', dueAt: at(100) })], prefs, NOW)).toEqual([]);
  });

  it('does not fire a stale window, one that opened more than 24 hours ago', () => {
    // Due in 40h: 72h window opened 32h ago (stale), 24h not yet open.
    expect(selectNotices([dl({ id: 'a', dueAt: at(40) })], prefs, NOW)).toEqual([]);
  });

  it('fires both leads when both windows opened recently', () => {
    // Due in 23h: 24h window opened 1h ago; 72h opened 49h ago (stale).
    expect(keys(selectNotices([dl({ id: 'a', dueAt: at(23) })], prefs, NOW))).toEqual(['lead:24']);
  });

  it('never fires for something already due, removed, or in a muted course', () => {
    expect(selectNotices([dl({ id: 'a', dueAt: at(-1) })], prefs, NOW)).toEqual([]);
    expect(selectNotices([dl({ id: 'b', dueAt: at(70), removedAt: NOW })], prefs, NOW).filter((n) => n.kind === 'lead')).toEqual([]);
    expect(selectNotices([dl({ id: 'c', dueAt: at(70), courseName: 'MATH 200' })], { ...prefs, mutedCourses: ['MATH 200'] }, NOW)).toEqual([]);
  });

  it('fires nothing when reminders are disabled', () => {
    expect(selectNotices([dl({ id: 'a', dueAt: at(70) })], { ...prefs, enabled: false }, NOW)).toEqual([]);
  });
});

describe('selectNotices, moved and removed', () => {
  it('notices a move whose new or old date is inside the largest window', () => {
    const moved = dl({ id: 'a', dueAt: at(60), movedFrom: at(30), movedAt: NOW });
    const n = selectNotices([moved], prefs, NOW).filter((x) => x.kind === 'moved');
    expect(n).toHaveLength(1);
    expect(n[0].key).toBe(`moved:${at(60).toISOString()}`);
  });

  it('records but does not notice a move six weeks out', () => {
    const far = dl({ id: 'a', dueAt: at(24 * 42), movedFrom: at(24 * 40), movedAt: NOW });
    expect(selectNotices([far], prefs, NOW).filter((x) => x.kind === 'moved')).toEqual([]);
  });

  it('notices a removal inside the window, with a fixed key', () => {
    const gone = dl({ id: 'a', dueAt: at(20), removedAt: NOW });
    const n = selectNotices([gone], prefs, NOW);
    expect(n.map((x) => x.key)).toEqual(['removed']);
  });
});
