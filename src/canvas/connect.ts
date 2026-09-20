// src/canvas/connect.ts  (plain module, no 'use server')
import { db } from '@/lib/db';
import { encryptFeedUrl } from '@/canvas/crypto';
import { normalizeFeedUrl } from '@/canvas/feed-url';
import { fetchFeed } from '@/canvas/fetch-feed';
import { isCalendarBody } from '@/canvas/parse-ics';
import { syncFeedFor } from '@/canvas/jobs/sync';

export type Result = { ok: true } | { ok: false; error: string };

/** One connect attempt per minute per account. Each one is a 20 second fetch
 *  at canvas.ubc.ca on our IP, and signup is open. */
const COOLDOWN_MS = 60 * 1000;

/**
 * Validates, proves the feed answers, encrypts, stores, and syncs once so the
 * deadlines page is populated before the student gets there. The URL never
 * appears in a log line, an error string, or a response: failures name the
 * HTTP status and nothing else. Reconnecting replaces the URL and clears a broken
 * flag but keeps firstSyncedAt, so a reconnect does not send a second
 * welcome email.
 */
export async function connectCanvasFeedFor(userId: string, input: string): Promise<Result> {
  const normalized = normalizeFeedUrl(input);
  if (!normalized.ok) return normalized;

  // Charged after validation (a typo should not cost a minute) and before the
  // fetch, which is what it bounds. One statement tests and stamps, the same
  // shape as the syllabus cap in src/app/api/syllabus/extract/route.ts: the
  // WHERE re-encodes the condition, so two concurrent submits contend on the
  // row and the loser gets count 0 back rather than both reading "clear"
  // first. A read followed by a write would let both through.
  const claim = await db.user.updateMany({
    where: {
      id: userId,
      OR: [
        { canvasConnectAttemptAt: null },
        { canvasConnectAttemptAt: { lt: new Date(Date.now() - COOLDOWN_MS) } },
      ],
    },
    data: { canvasConnectAttemptAt: new Date() },
  });
  if (claim.count === 0) {
    return { ok: false, error: 'Give that a minute, then try again.' };
  }

  const { status, body } = await fetchFeed(normalized.url);
  if (status !== 200 || body === null) {
    return { ok: false, error: `Canvas answered ${status || 'with no response'}. Check the link and try again.` };
  }
  if (!isCalendarBody(body)) {
    return { ok: false, error: 'That link did not return a calendar. In Canvas, open Calendar and click Calendar Feed.' };
  }

  const encryptedUrl = encryptFeedUrl(normalized.url);
  await db.$transaction([
    db.canvasFeed.upsert({
      where: { userId },
      create: { userId, encryptedUrl },
      update: { encryptedUrl, connectedAt: new Date(), brokenAt: null, failureCount: 0, lastStatus: null },
    }),
    db.reminderPreference.upsert({ where: { userId }, create: { userId }, update: {} }),
  ]);

  // Populate the page now rather than leaving "Nothing due yet" for up to
  // four hours. Not notifyFor: the welcome email waits for the scheduled
  // run, and an inline send would make the student wait for it. A failure
  // here is not a failed connect, the row is stored and the job will retry.
  try {
    await syncFeedFor(userId, new Date());
  } catch (e) {
    console.error('canvas connect: first sync failed, leaving it to the job:', e instanceof Error ? e.message : e);
  }
  return { ok: true };
}

/** Deletes the feed and every deadline and sent-log row under it. Explicit
 *  rather than cascade because deadlines hang off the user, not the feed. */
export async function disconnectCanvasFeedFor(userId: string): Promise<Result> {
  const feed = await db.canvasFeed.findUnique({ where: { userId }, select: { id: true } });
  if (!feed) return { ok: false, error: 'Not found.' };
  await db.$transaction([
    db.canvasDeadline.deleteMany({ where: { userId } }), // ReminderSent cascades
    db.canvasFeed.delete({ where: { id: feed.id } }),
  ]);
  return { ok: true };
}
