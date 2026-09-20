// tests/canvas-sync.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { db } from '@/lib/db';

const feedResponse = { status: 200, body: '' };
vi.mock('@/canvas/fetch-feed', () => ({
  fetchFeed: vi.fn(async () => feedResponse),
  FEED_TIMEOUT_MS: 1,
  FEED_MAX_BYTES: 1,
}));

import { encryptFeedUrl } from '@/canvas/crypto';
import { syncFeedFor, BROKEN_AFTER_FAILURES } from '@/canvas/jobs/sync';

const E = 'zz-canvas-sync@example.com';
let userId: string;
const NOW = new Date('2026-10-20T15:00:00Z');
const cal = (events: string[]) => ['BEGIN:VCALENDAR', ...events, 'END:VCALENDAR'].join('\r\n');
const ev = (uid: string, dt: string, course = 'CPSC 110 101') =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:T [${course}]\r\nDTSTART:${dt}\r\nEND:VEVENT`;

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
  feedResponse.body = cal([ev('event-assignment-1', '20261027T065959Z'), ev('event-assignment-2', '20261030T065959Z')]);
});

describe('syncFeedFor', () => {
  it('stores every dated item on first sync and records the fetch', async () => {
    expect(await syncFeedFor(userId, NOW)).toBe('ok');
    const rows = await db.canvasDeadline.findMany({ where: { userId }, orderBy: { uid: 'asc' } });
    expect(rows.map((r) => r.uid)).toEqual(['event-assignment-1', 'event-assignment-2']);
    const feed = await db.canvasFeed.findUniqueOrThrow({ where: { userId } });
    expect(feed.lastStatus).toBe(200);
    expect(feed.failureCount).toBe(0);
  });

  it('marks a move and a removal on the next sync, and restores on the one after', async () => {
    await syncFeedFor(userId, NOW);
    feedResponse.body = cal([ev('event-assignment-1', '20261029T065959Z')]); // 1 moved, 2 gone
    await syncFeedFor(userId, NOW);
    const one = await db.canvasDeadline.findFirstOrThrow({ where: { userId, uid: 'event-assignment-1' } });
    expect(one.movedFrom?.toISOString()).toBe('2026-10-27T06:59:59.000Z');
    expect(one.dueAt.toISOString()).toBe('2026-10-29T06:59:59.000Z');
    const two = await db.canvasDeadline.findFirstOrThrow({ where: { userId, uid: 'event-assignment-2' } });
    expect(two.removedAt).not.toBeNull();

    feedResponse.body = cal([ev('event-assignment-1', '20261029T065959Z'), ev('event-assignment-2', '20261030T065959Z')]);
    await syncFeedFor(userId, NOW);
    const back = await db.canvasDeadline.findFirstOrThrow({ where: { userId, uid: 'event-assignment-2' } });
    expect(back.removedAt).toBeNull();
  });

  it('treats a timeout as transient and does not touch deadlines', async () => {
    await syncFeedFor(userId, NOW);
    feedResponse.status = 0;
    feedResponse.body = null as unknown as string;
    expect(await syncFeedFor(userId, NOW)).toBe('transient');
    expect(await db.canvasDeadline.count({ where: { userId, removedAt: null } })).toBe(2);
    const feed = await db.canvasFeed.findUniqueOrThrow({ where: { userId } });
    expect(feed.failureCount).toBe(1);
    expect(feed.brokenAt).toBeNull();
  });

  it('leaves lastFetchedAt on the last good read, so a failing feed cannot look fresh', async () => {
    const good = new Date('2026-10-20T03:00:00Z');
    await syncFeedFor(userId, good);
    feedResponse.status = 503;
    feedResponse.body = null as unknown as string;
    expect(await syncFeedFor(userId, new Date('2026-10-20T15:00:00Z'))).toBe('transient');
    const feed = await db.canvasFeed.findUniqueOrThrow({ where: { userId } });
    expect(feed.lastFetchedAt?.toISOString()).toBe(good.toISOString());
    expect(feed.lastStatus).toBe(503);
    expect(feed.failureCount).toBe(1);
  });

  it('treats a 200 with a non-calendar body as transient, recording it as 0, and does not touch deadlines', async () => {
    await syncFeedFor(userId, NOW);
    feedResponse.status = 200;
    feedResponse.body = '<html><body>Please log in to Canvas</body></html>';
    expect(await syncFeedFor(userId, NOW)).toBe('transient');
    expect(await db.canvasDeadline.count({ where: { userId, removedAt: null } })).toBe(2);
    const feed = await db.canvasFeed.findUniqueOrThrow({ where: { userId } });
    expect(feed.failureCount).toBe(1);
    expect(feed.brokenAt).toBeNull();
    // 0, not 200: nothing usable came back, whatever the status line said.
    expect(feed.lastStatus).toBe(0);
  });

  it('marks a feed broken instead of throwing when the stored URL cannot be decrypted', async () => {
    await db.canvasFeed.update({ where: { userId }, data: { encryptedUrl: 'not-valid-base64-ciphertext' } });
    expect(await syncFeedFor(userId, NOW)).toBe('broken');
    expect((await db.canvasFeed.findUniqueOrThrow({ where: { userId } })).brokenAt).not.toBeNull();
  });

  it('breaks on a 404 immediately, and on repeated failures', async () => {
    feedResponse.status = 404;
    feedResponse.body = null as unknown as string;
    expect(await syncFeedFor(userId, NOW)).toBe('broken');
    expect((await db.canvasFeed.findUniqueOrThrow({ where: { userId } })).brokenAt).not.toBeNull();

    await db.canvasFeed.update({ where: { userId }, data: { brokenAt: null, failureCount: 0 } });
    feedResponse.status = 503;
    for (let i = 1; i < BROKEN_AFTER_FAILURES; i++) expect(await syncFeedFor(userId, NOW)).toBe('transient');
    expect(await syncFeedFor(userId, NOW)).toBe('broken');
  });

  it('skips a feed already marked broken', async () => {
    await db.canvasFeed.update({ where: { userId }, data: { brokenAt: NOW } });
    expect(await syncFeedFor(userId, NOW)).toBe('skipped');
  });
});
