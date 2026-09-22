import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { db } from '@/lib/db';

const feedResponse = { status: 200, body: '' };
const fetchFeed = vi.fn(async () => feedResponse);
vi.mock('@/canvas/fetch-feed', () => ({ fetchFeed: (u: string) => fetchFeed(u), FEED_TIMEOUT_MS: 1, FEED_MAX_BYTES: 1 }));

const sent: unknown[] = [];
vi.mock('@/lib/mail', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/mail')>();
  return { ...real, sendMail: vi.fn(async (...a: unknown[]) => { sent.push(a); return true; }) };
});

import { refreshCanvasFeedFor, connectCanvasFeedFor } from '@/canvas/connect';
import { encryptFeedUrl } from '@/canvas/crypto';

const E = 'zz-canvas-refresh@example.com';
const GOOD = 'https://canvas.ubc.ca/feeds/calendars/user_refresh.ics';
let userId: string;
const cal = (ev: string[]) => ['BEGIN:VCALENDAR', ...ev, 'END:VCALENDAR'].join('\r\n');
const ev = (uid: string, dt: string) =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:T ${uid} [CPSC 110]\r\nDTSTART:${dt}\r\nEND:VEVENT`;

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
  sent.length = 0;
  fetchFeed.mockClear();
  await db.canvasDeadline.deleteMany({ where: { userId } });
  await db.canvasFeed.deleteMany({ where: { userId } });
  await db.user.update({ where: { id: userId }, data: { canvasConnectAttemptAt: null } });
  feedResponse.status = 200;
  feedResponse.body = cal([ev('event-assignment-1', '20261027T065959Z')]);
});

describe('refreshCanvasFeedFor', () => {
  it('picks up an assignment added since the last read, without reconnecting', async () => {
    await db.canvasFeed.create({
      data: { userId, encryptedUrl: encryptFeedUrl(GOOD), firstSyncedAt: new Date() },
    });
    expect(await refreshCanvasFeedFor(userId)).toEqual({ ok: true });
    expect(await db.canvasDeadline.count({ where: { userId } })).toBe(1);

    // A professor adds one. No new link, no reconnect.
    feedResponse.body = cal([
      ev('event-assignment-1', '20261027T065959Z'),
      ev('event-assignment-2', '20261101T065959Z'),
    ]);
    await db.user.update({ where: { id: userId }, data: { canvasConnectAttemptAt: null } });
    expect(await refreshCanvasFeedFor(userId)).toEqual({ ok: true });
    const uids = (await db.canvasDeadline.findMany({ where: { userId } })).map((d) => d.uid).sort();
    expect(uids).toEqual(['event-assignment-1', 'event-assignment-2']);
  });

  it('sends no email, which is the whole point of not reconnecting', async () => {
    await db.canvasFeed.create({
      data: { userId, encryptedUrl: encryptFeedUrl(GOOD), firstSyncedAt: new Date() },
    });
    await refreshCanvasFeedFor(userId);
    expect(sent).toHaveLength(0);
  });

  it('keeps firstSyncedAt, so no second welcome is queued up', async () => {
    const stamped = new Date('2026-09-01T00:00:00Z');
    await db.canvasFeed.create({ data: { userId, encryptedUrl: encryptFeedUrl(GOOD), firstSyncedAt: stamped } });
    await refreshCanvasFeedFor(userId);
    const feed = await db.canvasFeed.findUniqueOrThrow({ where: { userId } });
    expect(feed.firstSyncedAt?.toISOString()).toBe(stamped.toISOString());
  });

  it('shares the one-a-minute fetch cooldown with connecting', async () => {
    expect(await connectCanvasFeedFor(userId, GOOD)).toEqual({ ok: true });
    const r = await refreshCanvasFeedFor(userId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/minute/i);
  });

  it('is a 404 shape for a student with nothing connected', async () => {
    expect(await refreshCanvasFeedFor(userId)).toEqual({ ok: false, error: 'Not found.' });
  });

  it('tells a broken feed to reconnect rather than silently doing nothing', async () => {
    await db.canvasFeed.create({
      data: { userId, encryptedUrl: encryptFeedUrl(GOOD), brokenAt: new Date() },
    });
    const r = await refreshCanvasFeedFor(userId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/reconnect/i);
    expect(fetchFeed).not.toHaveBeenCalled();
  });

  it('leaves deadlines alone when Canvas does not answer', async () => {
    await db.canvasFeed.create({
      data: { userId, encryptedUrl: encryptFeedUrl(GOOD), firstSyncedAt: new Date() },
    });
    await refreshCanvasFeedFor(userId);
    expect(await db.canvasDeadline.count({ where: { userId } })).toBe(1);

    feedResponse.status = 500;
    feedResponse.body = '';
    await db.user.update({ where: { id: userId }, data: { canvasConnectAttemptAt: null } });
    const r = await refreshCanvasFeedFor(userId);
    expect(r.ok).toBe(false);
    expect(await db.canvasDeadline.count({ where: { userId } })).toBe(1);
  });
});
