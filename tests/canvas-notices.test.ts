// tests/canvas-notices.test.ts
import { describe, it, expect } from 'vitest';
import { selectNotices, stillWorthShowing, RECENT_MS, type DeadlineForNotice, type Prefs } from '@/canvas/notices';

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
    expect(keys(selectNotices([dl({ id: 'a', dueAt: at(70) })], prefs, NOW))).toEqual([`lead:72:${at(70).toISOString()}`]);
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
    expect(keys(selectNotices([dl({ id: 'a', dueAt: at(23) })], prefs, NOW))).toEqual([`lead:24:${at(23).toISOString()}`]);
  });

  it('never fires for something already due, removed, or in a muted course', () => {
    expect(selectNotices([dl({ id: 'a', dueAt: at(-1) })], prefs, NOW)).toEqual([]);
    expect(selectNotices([dl({ id: 'b', dueAt: at(70), removedAt: NOW })], prefs, NOW).filter((n) => n.kind === 'lead')).toEqual([]);
    expect(selectNotices([dl({ id: 'c', dueAt: at(70), courseName: 'MATH 200' })], { ...prefs, mutedCourses: ['MATH 200'] }, NOW)).toEqual([]);
  });

  it('gives a moved deadline a lead key the old date cannot have claimed', () => {
    // Due Nov 10; the 72h lead fires and is claimed on Nov 7.
    const nov7 = new Date('2026-11-07T12:00:00Z');
    const before = selectNotices([dl({ id: 'a', dueAt: new Date('2026-11-10T08:00:00Z') })], prefs, nov7);
    expect(before.map((n) => n.key)).toEqual(['lead:72:2026-11-10T08:00:00.000Z']);
    // The prof moves it to Dec 1. On Nov 28 the 72h window reopens.
    const nov28 = new Date('2026-11-28T12:00:00Z');
    const after = selectNotices([dl({ id: 'a', dueAt: new Date('2026-12-01T08:00:00Z') })], prefs, nov28);
    expect(after.map((n) => n.key)).toEqual(['lead:72:2026-12-01T08:00:00.000Z']);
    expect(after[0].key).not.toBe(before[0].key);
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

  it('does not notice a move made months before the deadline came into range', () => {
    // Shifted in September, due in December: the page stopped showing the
    // move weeks ago, so the email must not announce it as news.
    const stale = dl({
      id: 'a', dueAt: at(60), movedFrom: at(30), movedAt: new Date(NOW.getTime() - RECENT_MS - 1),
    });
    expect(selectNotices([stale], prefs, NOW).filter((x) => x.kind === 'moved')).toEqual([]);
  });

  it('notices a removal inside the window, with a fixed key', () => {
    const gone = dl({ id: 'a', dueAt: at(20), removedAt: NOW });
    const n = selectNotices([gone], prefs, NOW);
    expect(n.map((x) => x.key)).toEqual(['removed']);
  });
});

describe('stillWorthShowing', () => {
  const t = NOW.getTime();
  const row = (over: Partial<{ dueAt: Date; movedAt: Date | null; removedAt: Date | null }>) => ({
    dueAt: at(24), movedAt: null, removedAt: null, ...over,
  });

  it('keeps what is still to come', () => {
    expect(stillWorthShowing(row({ dueAt: at(1) }), t)).toBe(true);
    expect(stillWorthShowing(row({ dueAt: at(-1) }), t)).toBe(true);
  });

  it('drops a deadline more than a day past, so September does not sit above November', () => {
    expect(stillWorthShowing(row({ dueAt: at(-25) }), t)).toBe(false);
    expect(stillWorthShowing(row({ dueAt: at(-24 * 60) }), t)).toBe(false);
  });

  it('keeps a past deadline whose move or removal is still recent, and drops it once it is not', () => {
    expect(stillWorthShowing(row({ dueAt: at(-25), movedAt: NOW }), t)).toBe(true);
    expect(stillWorthShowing(row({ dueAt: at(-25), removedAt: NOW }), t)).toBe(true);
    const old = new Date(t - RECENT_MS - 1);
    expect(stillWorthShowing(row({ dueAt: at(-25), movedAt: old }), t)).toBe(false);
    expect(stillWorthShowing(row({ dueAt: at(48), removedAt: old }), t)).toBe(false);
  });
});
