// tests/canvas-manual-deadline.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { db } from '@/lib/db';

const feedResponse = { status: 200, body: '' };
vi.mock('@/canvas/fetch-feed', () => ({
  fetchFeed: vi.fn(async () => feedResponse),
  FEED_TIMEOUT_MS: 1,
  FEED_MAX_BYTES: 1,
}));

import { encryptFeedUrl } from '@/canvas/crypto';
import { syncFeedFor } from '@/canvas/jobs/sync';
import {
  addManualDeadlineFor,
  normalizeManualDeadline,
  removeManualDeadlineFor,
} from '@/canvas/manual';

const E = 'zz-manual-deadline@example.com';
let userId: string;
const NOW = new Date('2026-10-20T15:00:00Z');
const cal = (events: string[]) => ['BEGIN:VCALENDAR', ...events, 'END:VCALENDAR'].join('\r\n');
const ev = (uid: string, dt: string) =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:T [CPSC 110 101]\r\nDTSTART:${dt}\r\nEND:VEVENT`;

beforeAll(async () => {
  process.env.FEED_ENCRYPTION_KEY ??= '00'.repeat(31) + '01';
  await db.user.deleteMany({ where: { email: E } });
  userId = (await db.user.create({ data: { email: E } })).id;
});
afterAll(async () => {
  await db.user.deleteMany({ where: { email: E } });
  await db.$disconnect();
});
beforeEach(async () => {
  await db.canvasDeadline.deleteMany({ where: { userId } });
  await db.canvasFeed.deleteMany({ where: { userId } });
  await db.canvasFeed.create({
    data: { userId, encryptedUrl: encryptFeedUrl('https://canvas.ubc.ca/feeds/calendars/user_t.ics') },
  });
  feedResponse.status = 200;
  feedResponse.body = cal([ev('event-assignment-1', '20261027T065959Z')]);
});

describe('normalizeManualDeadline', () => {
  const base = { title: 'Lab report', courseName: 'CPSC 110 101', date: '2026-10-27', time: '' };

  it('puts an all-day item at 11:59 p.m. Vancouver, like every all-day feed row', () => {
    const out = normalizeManualDeadline(base)!;
    expect(out.allDay).toBe(true);
    // 23:59:59 PDT on Oct 27 2026.
    expect(out.dueAt.toISOString()).toBe('2026-10-28T06:59:59.000Z');
  });

  it('resolves a typed clock time against Vancouver, not the browser', () => {
    const out = normalizeManualDeadline({ ...base, time: '18:00' })!;
    expect(out.allDay).toBe(false);
    expect(out.dueAt.toISOString()).toBe('2026-10-28T01:00:00.000Z');
  });

  it('trims the title and refuses a blank one', () => {
    expect(normalizeManualDeadline({ ...base, title: '  Lab report ' })?.title).toBe('Lab report');
    expect(normalizeManualDeadline({ ...base, title: '   ' })).toBeNull();
  });

  it('refuses a date or a time it cannot read, rather than storing an Invalid Date', () => {
    expect(normalizeManualDeadline({ ...base, date: 'next friday' })).toBeNull();
    expect(normalizeManualDeadline({ ...base, time: '6pm' })).toBeNull();
    expect(normalizeManualDeadline({ ...base, time: '99:99' })).toBeNull();
    expect(normalizeManualDeadline({ ...base, date: '2026-02-30' })).toBeNull();
  });
});

describe('a deadline the student added', () => {
  it('survives every poll, however the feed changes', async () => {
    await syncFeedFor(userId, NOW);
    expect(await addManualDeadlineFor(userId, {
      title: 'CPSC 110 midterm', courseName: 'CPSC 110 101', date: '2026-10-27', time: '18:00',
    })).toEqual({ ok: true });

    // The feed never mentions it, so the diff would mark it removed on the
    // next poll - which is the whole reason manual rows are held out of it.
    // An empty-but-valid calendar is the worst case: everything else IS gone.
    feedResponse.body = cal([]);
    expect(await syncFeedFor(userId, NOW)).toBe('ok');

    const rows = await db.canvasDeadline.findMany({ where: { userId } });
    const manual = rows.find((r) => r.uid.startsWith('manual:'))!;
    expect(manual.removedAt).toBeNull();
    expect(manual.movedAt).toBeNull();
    expect(manual.title).toBe('CPSC 110 midterm');
    // The feed row went the other way, which is the rule this test is not
    // allowed to break in the name of keeping the manual one.
    expect(rows.find((r) => r.uid === 'event-assignment-1')!.removedAt).not.toBeNull();
  });

  it('is deleted outright, where a feed row is only ever marked removed', async () => {
    await syncFeedFor(userId, NOW);
    await addManualDeadlineFor(userId, { title: 'Club meeting', courseName: '', date: '2026-11-03', time: '' });
    const mine = await db.canvasDeadline.findFirstOrThrow({
      where: { userId, uid: { startsWith: 'manual:' } },
    });

    expect(await removeManualDeadlineFor(userId, mine.id)).toEqual({ ok: true });
    expect(await db.canvasDeadline.count({ where: { id: mine.id } })).toBe(0);
  });

  it('is the only kind this can delete: a feed row is not one of these', async () => {
    await syncFeedFor(userId, NOW);
    const fromFeed = await db.canvasDeadline.findFirstOrThrow({ where: { userId, uid: 'event-assignment-1' } });
    expect(await removeManualDeadlineFor(userId, fromFeed.id)).toEqual({ ok: false, error: 'Not found.' });
    expect(await db.canvasDeadline.count({ where: { id: fromFeed.id } })).toBe(1);
  });

  it('belongs to the student who added it, and nobody else can delete it', async () => {
    await addManualDeadlineFor(userId, { title: 'Mine', courseName: '', date: '2026-11-03', time: '' });
    const mine = await db.canvasDeadline.findFirstOrThrow({ where: { userId, uid: { startsWith: 'manual:' } } });
    expect(await removeManualDeadlineFor('someone-else', mine.id)).toEqual({ ok: false, error: 'Not found.' });
    expect(await db.canvasDeadline.count({ where: { id: mine.id } })).toBe(1);
  });
});
