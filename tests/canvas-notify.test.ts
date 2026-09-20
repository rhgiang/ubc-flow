// tests/canvas-notify.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { db } from '@/lib/db';

// connectCanvasFeedFor proves the feed answers and then syncs it. Stub the
// fetch, never the network.
vi.mock('@/canvas/fetch-feed', () => ({
  fetchFeed: vi.fn(async () => ({
    status: 200,
    body: ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:event-assignment-1', 'SUMMARY:A [C 1]',
      'DTSTART:20261127T065959Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'),
  })),
  FEED_TIMEOUT_MS: 1,
  FEED_MAX_BYTES: 1,
}));

const sent: { to: string; subject: string; body: string }[] = [];
vi.mock('@/lib/mail', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/mail')>();
  return {
    ...real,
    sendMail: vi.fn(async (to: string, subject: string, body: string) => {
      sent.push({ to, subject, body });
      return true;
    }),
  };
});

import { notifyFor } from '@/canvas/jobs/notify';
import { connectCanvasFeedFor } from '@/canvas/connect';

const E = 'zz-canvas-notify@example.com';
const FEED = 'https://canvas.ubc.ca/feeds/calendars/user_notify.ics';
let userId: string;
const NOW = new Date('2026-10-24T15:00:00Z');
const H = 3600_000;
const at = (h: number) => new Date(NOW.getTime() + h * H);

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
  await db.canvasDeadline.deleteMany({ where: { userId } });
  await db.canvasFeed.deleteMany({ where: { userId } });
  await db.reminderPreference.deleteMany({ where: { userId } });
  await db.canvasFeed.create({ data: { userId, encryptedUrl: 'x', firstSyncedAt: NOW } });
  await db.reminderPreference.create({ data: { userId } });
});

const seed = (uid: string, dueAt: Date, course = 'CPSC 110') =>
  db.canvasDeadline.create({ data: { userId, uid, kind: 'assignment', title: uid, courseName: course, dueAt } });

describe('notifyFor', () => {
  it('sends one email per run per student, however many notices, and claims each', async () => {
    await seed('a', at(70));
    await seed('b', at(71));
    const r = await notifyFor(userId, NOW);
    expect(r.sent).toBe(2);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain('a');
    expect(sent[0].body).toContain('b');
    const rows = await db.reminderSent.findMany({ where: { userId } });
    expect(rows.map((x) => x.notice).sort()).toEqual([`lead:72:${at(70).toISOString()}`, `lead:72:${at(71).toISOString()}`]);
    expect(rows.every((x) => x.deliveredAt !== null)).toBe(true);
  });

  it('never sends the same notice twice, even across a second run', async () => {
    await seed('a', at(70));
    await notifyFor(userId, NOW);
    const again = await notifyFor(userId, new Date(NOW.getTime() + H));
    expect(again.sent).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('sends the welcome and no per-item reminders on the first sync', async () => {
    await db.canvasFeed.update({ where: { userId }, data: { firstSyncedAt: null } });
    await seed('a', at(70));
    const r = await notifyFor(userId, NOW);
    expect(r.sent).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/connected/i);
    expect((await db.canvasFeed.findUniqueOrThrow({ where: { userId } })).firstSyncedAt).not.toBeNull();
    expect(await db.reminderSent.count({ where: { userId } })).toBe(0);
  });

  it('sends no welcome to a student with reminders off, and still stamps firstSyncedAt', async () => {
    await db.canvasFeed.update({ where: { userId }, data: { firstSyncedAt: null } });
    await db.reminderPreference.update({ where: { userId }, data: { enabled: false } });
    await seed('a', at(70));
    expect(await notifyFor(userId, NOW)).toEqual({ sent: 0 });
    expect(sent).toHaveLength(0);
    expect((await db.canvasFeed.findUniqueOrThrow({ where: { userId } })).firstSyncedAt).not.toBeNull();
  });

  it('does not send a second welcome after a reconnect', async () => {
    await db.canvasFeed.deleteMany({ where: { userId } });
    expect(await connectCanvasFeedFor(userId, FEED)).toEqual({ ok: true });
    await notifyFor(userId, NOW);
    expect(sent.map((m) => m.subject)).toEqual(['Canvas connected: your upcoming deadlines']);
    // Pasting a fresh link keeps firstSyncedAt, so the welcome is not re-sent.
    expect(await connectCanvasFeedFor(userId, FEED)).toEqual({ ok: true });
    await notifyFor(userId, new Date(NOW.getTime() + H));
    expect(sent.map((m) => m.subject)).toEqual(['Canvas connected: your upcoming deadlines']);
  });

  it('retries a claimed notice whose send failed', async () => {
    await seed('a', at(70));
    const { sendMail } = await import('@/lib/mail');
    (sendMail as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    await notifyFor(userId, NOW);
    let rows = await db.reminderSent.findMany({ where: { userId } });
    expect(rows[0].deliveredAt).toBeNull();
    await notifyFor(userId, new Date(NOW.getTime() + H));
    rows = await db.reminderSent.findMany({ where: { userId } });
    expect(rows[0].deliveredAt).not.toBeNull();
    expect(sent).toHaveLength(1);
  });

  it('every email carries a mute link and never the feed URL', async () => {
    await seed('a', at(70));
    await notifyFor(userId, NOW);
    expect(sent[0].body).toMatch(/\/reminders\/[0-9a-f]{64}/);
    expect(sent[0].body).not.toContain('feeds/calendars');
  });
});
