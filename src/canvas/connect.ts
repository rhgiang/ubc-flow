// src/canvas/connect.ts  (plain module, no 'use server')
import { db } from '@/lib/db';
import { encryptFeedUrl } from '@/canvas/crypto';
import { normalizeFeedUrl } from '@/canvas/feed-url';
import { fetchFeed } from '@/canvas/fetch-feed';
import { isCalendarBody } from '@/canvas/parse-ics';
import { applyFeedBody, syncFeedFor } from '@/canvas/jobs/sync';

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
/**
 * Status 0 out of fetchFeed means the request never completed: a DNS failure,
 * a connect timeout, a reset. That is almost always our side or the network,
 * not the link, so it must not tell the student to go check their link. The
 * old copy read "Canvas answered with no response. Check the link and try
 * again." and sent someone hunting a fault in a URL that was perfectly good.
 */
function describeFetchFailure(status: number, body: string | null): string {
  if (status === 0) return 'Could not reach Canvas just now. That is usually a passing network problem, not your link. Wait a moment and try again.';
  if (status === 401 || status === 403) return `Canvas refused that link (${status}). Open Calendar in Canvas, click Calendar Feed, and copy a fresh link.`;
  if (status === 404) return 'Canvas does not recognise that link any more (404). It was probably reset. Open Calendar in Canvas, click Calendar Feed, and copy the new one.';
  if (status === 200 && body === null) return 'That feed is too large to read. Please get in touch so we can take a look.';
  return `Canvas answered ${status}. That is usually temporary, so try again in a moment.`;
}

export const COOLING_DOWN: Result = { ok: false, error: 'Give that a minute, then try again.' };

/**
 * One outbound fetch at canvas.ubc.ca per account per minute, shared by
 * connecting and refreshing: both cost the same request on our IP, and
 * signup is open.
 *
 * One statement tests and stamps, the same shape as the syllabus cap in
 * src/app/api/syllabus/extract/route.ts. The WHERE re-encodes the condition,
 * so two concurrent submits contend on the row and the loser gets count 0
 * back rather than both reading "clear" first. A read followed by a write
 * would let both through.
 *
 * The slot is spent whether or not Canvas answers. The resource being capped
 * is the request, which happened either way, and refunding on failure is the
 * hole an attacker would drive through, failure being the cheap outcome to
 * induce.
 */
async function claimFetchSlot(userId: string): Promise<boolean> {
  const { count } = await db.user.updateMany({
    where: {
      id: userId,
      OR: [
        { canvasConnectAttemptAt: null },
        { canvasConnectAttemptAt: { lt: new Date(Date.now() - COOLDOWN_MS) } },
      ],
    },
    data: { canvasConnectAttemptAt: new Date() },
  });
  return count > 0;
}

export async function connectCanvasFeedFor(userId: string, input: string): Promise<Result> {
  const normalized = normalizeFeedUrl(input);
  if (!normalized.ok) return normalized;

  // Charged after validation (a typo should not cost a minute) and before the
  // fetch, which is what it bounds. One statement tests and stamps, the same
  // shape as the syllabus cap in src/app/api/syllabus/extract/route.ts: the
  // WHERE re-encodes the condition, so two concurrent submits contend on the
  // row and the loser gets count 0 back rather than both reading "clear"
  // first. A read followed by a write would let both through.
  if (!(await claimFetchSlot(userId))) return COOLING_DOWN;

  const { status, body } = await fetchFeed(normalized.url);
  if (status !== 200 || body === null) {
    return { ok: false, error: describeFetchFailure(status, body) };
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
  // four hours. The body above is reused rather than refetched: syncFeedFor
  // would go back to canvas.ubc.ca for a second 20 second fetch, doubling
  // both the wait and the load the cooldown above exists to bound, and a
  // throttled second fetch would paint "last read failed" on a connection
  // that just worked. Not notifyFor: the welcome email waits for the
  // scheduled run, and an inline send would make the student wait for it. A
  // failure here is not a failed connect, the row is stored and the job will
  // retry.
  try {
    await applyFeedBody(userId, body, new Date());
  } catch (e) {
    console.error('canvas connect: first sync failed, leaving it to the job:', e instanceof Error ? e.message : e);
  }
  return { ok: true };
}

/**
 * Deletes the feed and every deadline and sent-log row under it. Explicit
 * rather than cascade because deadlines hang off the user, not the feed.
 *
 * ReminderPreference is deliberately left standing: it is what remembers that
 * a student turned reminders off, and connectCanvasFeedFor's `update: {}`
 * relies on it to keep them off through a reconnect. firstSyncedAt does go,
 * because it lives on the feed row, so an enabled student who fully
 * disconnects and comes back is welcomed again. That is intended; a full
 * disconnect is a fresh start.
 */
export async function disconnectCanvasFeedFor(userId: string): Promise<Result> {
  const feed = await db.canvasFeed.findUnique({ where: { userId }, select: { id: true } });
  if (!feed) return { ok: false, error: 'Not found.' };
  await db.$transaction([
    db.canvasDeadline.deleteMany({ where: { userId } }), // ReminderSent cascades
    db.canvasFeed.delete({ where: { id: feed.id } }),
  ]);
  return { ok: true };
}

/**
 * Re-read the feed now, for a student who just added something in Canvas and
 * does not want to wait up to four hours.
 *
 * Deliberately not disconnect-and-reconnect, which is what people were doing:
 * that throws away every stored deadline and clears firstSyncedAt, so the
 * next job run sends the whole welcome email over again. This changes nothing
 * but the deadlines themselves and sends no mail at all; a move found here
 * still earns its notice on the next scheduled run.
 */
export async function refreshCanvasFeedFor(userId: string): Promise<Result> {
  const feed = await db.canvasFeed.findUnique({ where: { userId }, select: { brokenAt: true } });
  if (!feed) return { ok: false, error: 'Not found.' };
  if (feed.brokenAt) {
    return { ok: false, error: 'Canvas stopped answering this link. Paste a fresh Calendar Feed link to reconnect.' };
  }
  if (!(await claimFetchSlot(userId))) return COOLING_DOWN;

  const outcome = await syncFeedFor(userId, new Date());
  if (outcome === 'ok') return { ok: true };
  if (outcome === 'broken') {
    return { ok: false, error: 'Canvas stopped answering this link. Paste a fresh Calendar Feed link to reconnect.' };
  }
  return { ok: false, error: 'Could not read Canvas just now. Your deadlines are unchanged. Try again in a moment.' };
}
