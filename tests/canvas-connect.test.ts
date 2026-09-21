import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { db } from '@/lib/db';

// The action fetches the feed once to prove it works. Stub that, never the network.
vi.mock('@/canvas/fetch-feed', () => ({
  fetchFeed: vi.fn(async (url: string) =>
    url.includes('dead')
      ? { status: 404, body: null }
      : url.includes('unreachable')
      ? { status: 0, body: null } // a DNS failure, connect timeout or reset
      : { status: 200, body: 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:event-assignment-1\r\nSUMMARY:A [C 1]\r\nDTSTART:20261027T065959Z\r\nEND:VEVENT\r\nEND:VCALENDAR' },
  ),
  FEED_TIMEOUT_MS: 1,
  FEED_MAX_BYTES: 1,
}));

import { connectCanvasFeedFor, disconnectCanvasFeedFor } from '@/canvas/connect';

const A = 'zz-canvas-a@example.com';
const B = 'zz-canvas-b@example.com';
let userA: string;
let userB: string;
const GOOD = 'https://canvas.ubc.ca/feeds/calendars/user_good.ics';

beforeAll(async () => {
  process.env.FEED_ENCRYPTION_KEY ??= '00'.repeat(31) + '01';
  await db.user.deleteMany({ where: { email: { in: [A, B] } } });
  userA = (await db.user.create({ data: { email: A } })).id;
  userB = (await db.user.create({ data: { email: B } })).id;
});
afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: [A, B] } } });
  await db.$disconnect();
});
// Connecting is capped at one attempt a minute per account; these tests
// connect repeatedly on purpose, so the stamp is cleared between them. The
// cooldown itself has its own test below.
beforeEach(async () => {
  await db.user.updateMany({
    where: { email: { in: [A, B] } },
    data: { canvasConnectAttemptAt: null },
  });
});

describe('connectCanvasFeedFor', () => {
  it('stores the feed encrypted and creates default preferences', async () => {
    const r = await connectCanvasFeedFor(userA, GOOD);
    expect(r).toEqual({ ok: true });
    const feed = await db.canvasFeed.findUniqueOrThrow({ where: { userId: userA } });
    expect(feed.encryptedUrl).not.toContain('canvas.ubc.ca');
    expect(feed.brokenAt).toBeNull();
    const prefs = await db.reminderPreference.findUniqueOrThrow({ where: { userId: userA } });
    expect(prefs.leadHours).toEqual([72, 24]);
  });

  it('rejects a link that is not the Canvas feed, before any fetch', async () => {
    const r = await connectCanvasFeedFor(userA, 'https://evil.example/feeds/calendars/x.ics');
    expect(r.ok).toBe(false);
  });

  it('rejects a feed that does not answer 200, and names the status not the URL', async () => {
    const r = await connectCanvasFeedFor(userA, 'https://canvas.ubc.ca/feeds/calendars/user_dead.ics');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/404/);
      expect(r.error).not.toContain('user_dead');
    }
  });

  it('blames the network, not the link, when the request never completed', async () => {
    // fetchFeed returns status 0 for a DNS failure, a connect timeout or a
    // reset. The old copy said "Canvas answered with no response. Check the
    // link and try again." on a link that was perfectly good, which is what
    // it looked like in practice on a brief outage.
    const r = await connectCanvasFeedFor(userA, 'https://canvas.ubc.ca/feeds/calendars/user_unreachable.ics');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/could not reach canvas/i);
      expect(r.error).not.toMatch(/check the link/i);
    }
  });

  it('reconnecting replaces the URL and clears a broken flag', async () => {
    await db.canvasFeed.update({ where: { userId: userA }, data: { brokenAt: new Date(), failureCount: 3 } });
    await connectCanvasFeedFor(userA, GOOD);
    const feed = await db.canvasFeed.findUniqueOrThrow({ where: { userId: userA } });
    expect(feed.brokenAt).toBeNull();
    expect(feed.failureCount).toBe(0);
  });

  it('populates the deadlines page straight away instead of after the next run', async () => {
    await db.canvasDeadline.deleteMany({ where: { userId: userA } });
    expect(await connectCanvasFeedFor(userA, GOOD)).toEqual({ ok: true });
    const rows = await db.canvasDeadline.findMany({ where: { userId: userA } });
    expect(rows.map((r) => r.uid)).toEqual(['event-assignment-1']);
    // The welcome email still waits for the scheduled run.
    expect((await db.canvasFeed.findUniqueOrThrow({ where: { userId: userA } })).firstSyncedAt).toBeNull();
  });

  it('refuses a second attempt inside the cooldown, without fetching again', async () => {
    const { fetchFeed } = await import('@/canvas/fetch-feed');
    expect(await connectCanvasFeedFor(userA, GOOD)).toEqual({ ok: true });
    const calls = (fetchFeed as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    const second = await connectCanvasFeedFor(userA, GOOD);
    expect(second.ok).toBe(false);
    expect((fetchFeed as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
    // It is per account: another student is not held up by this one.
    expect(await connectCanvasFeedFor(userB, GOOD)).toEqual({ ok: true });
  });

  it('does not spend the cooldown on a link that never had a chance', async () => {
    expect((await connectCanvasFeedFor(userA, 'https://evil.example/feeds/calendars/x.ics')).ok).toBe(false);
    expect(await connectCanvasFeedFor(userA, GOOD)).toEqual({ ok: true });
  });
});

describe('disconnectCanvasFeedFor', () => {
  it('removes the feed and every deadline under it, and only for that student', async () => {
    await connectCanvasFeedFor(userB, GOOD);
    await db.canvasDeadline.create({
      data: { userId: userB, uid: 'event-assignment-9', kind: 'assignment', title: 'x', courseName: 'C', dueAt: new Date() },
    });
    const r = await disconnectCanvasFeedFor(userB);
    expect(r).toEqual({ ok: true });
    expect(await db.canvasFeed.findUnique({ where: { userId: userB } })).toBeNull();
    expect(await db.canvasDeadline.count({ where: { userId: userB } })).toBe(0);
    // Student A's feed is untouched.
    expect(await db.canvasFeed.findUnique({ where: { userId: userA } })).not.toBeNull();
  });

  it('leaves the reminder preference standing, so a muted student stays muted', async () => {
    await connectCanvasFeedFor(userB, GOOD);
    await db.reminderPreference.update({ where: { userId: userB }, data: { enabled: false } });
    await disconnectCanvasFeedFor(userB);
    // Load bearing: the row surviving is the only reason connectCanvasFeedFor's
    // update: {} can preserve enabled false, which is what keeps notifyFor from
    // welcoming a student who asked for no email. Deleting it here would be
    // silent.
    const pref = await db.reminderPreference.findUnique({ where: { userId: userB } });
    expect(pref?.enabled).toBe(false);
  });

  it('is a 404 shape for a student with nothing connected', async () => {
    const r = await disconnectCanvasFeedFor(userB);
    expect(r).toEqual({ ok: false, error: 'Not found.' });
  });
});
