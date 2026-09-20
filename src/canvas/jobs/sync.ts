// src/canvas/jobs/sync.ts
import { db } from '@/lib/db';
import { decryptFeedUrl } from '@/canvas/crypto';
import { normalizeFeedUrl } from '@/canvas/feed-url';
import { fetchFeed } from '@/canvas/fetch-feed';
import { isCalendarBody, parseCanvasFeed } from '@/canvas/parse-ics';
import { diffFeed, type FeedDiff } from '@/canvas/diff';

export const BROKEN_AFTER_FAILURES = 3;
export type SyncOutcome = 'ok' | 'transient' | 'broken' | 'skipped';

/**
 * Refreshes one student's deadlines from their feed. Never sends anything;
 * notices are Task 5's job and run after every feed has synced.
 *
 * A 401 or 404 means the student regenerated or revoked the feed in Canvas
 * and it will never answer again: broken at once. Anything else non-200 is
 * transient until it has happened BROKEN_AFTER_FAILURES times in a row.
 * A broken feed is skipped until the student reconnects. Nothing here ever
 * deletes a deadline row: a failed fetch leaves last time's data alone.
 */
export async function syncFeedFor(userId: string, now: Date): Promise<SyncOutcome> {
  const feed = await db.canvasFeed.findUnique({ where: { userId } });
  if (!feed || feed.brokenAt) return 'skipped';

  // Re-validated after decrypting, so a key or data problem cannot become a
  // request to an arbitrary host. The URL itself is never logged. A corrupted
  // row or a rotated key makes decryptFeedUrl throw; that is handled exactly
  // like a failed validation, not left to reject the promise.
  let url: ReturnType<typeof normalizeFeedUrl>;
  try {
    url = normalizeFeedUrl(decryptFeedUrl(feed.encryptedUrl));
  } catch {
    url = { ok: false, error: 'could not be decrypted' };
  }
  if (!url.ok) {
    await db.canvasFeed.update({ where: { userId }, data: { brokenAt: now, lastFetchedAt: now } });
    console.error('canvas sync: stored feed URL failed validation for one user; marked broken');
    return 'broken';
  }

  const { status, body } = await fetchFeed(url.url);
  // A 200 with no calendar in it is not a valid empty feed: diffFeed would
  // mark every stored deadline removed. Treat it as a failure, like a non-200.
  const notCalendar = !isCalendarBody(body);
  if (status !== 200 || notCalendar) {
    const failures = feed.failureCount + 1;
    const dead = status === 401 || status === 404 || failures >= BROKEN_AFTER_FAILURES;
    await db.canvasFeed.update({
      where: { userId },
      data: {
        // lastFetchedAt is NOT written here. The page renders it as "last
        // read", and a feed failing for twelve hours must not claim it was
        // read three minutes ago beside half day old data. It means the last
        // read that actually produced deadlines. failureCount is what says
        // the most recent attempt failed.
        //
        // A 200 whose body was not a calendar records 0, the same value a
        // network failure records: nothing usable came back, whatever the
        // status line said. With failureCount that is enough to tell a
        // content failure from a plain HTTP one, which reports its own code.
        lastStatus: notCalendar && status === 200 ? 0 : status,
        failureCount: failures,
        brokenAt: dead ? now : null,
      },
    });
    return dead ? 'broken' : 'transient';
  }

  await applyFeedBody(userId, body, now);
  return 'ok';
}

/**
 * Everything syncFeedFor does once it holds a calendar body. Split out so the
 * connect action, which has already fetched and validated the body, can store
 * it without a second 20 second round trip to canvas.ubc.ca. The caller must
 * have proved the body is a calendar; handing an HTML login page to this
 * would mark every stored deadline removed.
 */
export async function applyFeedBody(userId: string, body: string, now: Date): Promise<void> {
  const parsed = parseCanvasFeed(body);
  // diffFeed keeps the first of a repeated uid, because two creates for one
  // uid abort the whole transaction. That is the right call, but it is
  // invisible, so say it here: this is the log line to look for if a student
  // reports a deadline that never appears.
  const unique = new Set(parsed.items.map((i) => i.uid)).size;
  if (unique !== parsed.items.length) {
    console.warn(`canvas sync: feed repeated ${parsed.items.length - unique} uid(s); kept the first of each`);
  }
  const stored = await db.canvasDeadline.findMany({
    where: { userId },
    select: { id: true, uid: true, dueAt: true, removedAt: true, title: true, courseName: true, url: true, allDay: true },
  });
  await applyDiff(userId, diffFeed(stored, parsed.items), now);
  await db.canvasFeed.update({
    where: { userId },
    data: { lastFetchedAt: now, lastStatus: 200, failureCount: 0 },
  });
}

export async function applyDiff(userId: string, diff: FeedDiff, now: Date): Promise<void> {
  await db.$transaction([
    ...diff.create.map((it) =>
      db.canvasDeadline.create({
        data: {
          userId, uid: it.uid, kind: it.kind, title: it.title, courseName: it.courseName,
          dueAt: it.dueAt, allDay: it.allDay, url: it.url, firstSeenAt: now,
        },
      }),
    ),
    ...diff.move.map((m) =>
      db.canvasDeadline.update({
        where: { id: m.id },
        data: { dueAt: m.to, movedFrom: m.from, movedAt: now, ...(m.restored ? { removedAt: null } : {}) },
      }),
    ),
    ...diff.update.map((u) =>
      db.canvasDeadline.update({
        where: { id: u.id },
        data: { title: u.title, courseName: u.courseName, url: u.url, allDay: u.allDay },
      }),
    ),
    ...(diff.restore.length
      ? [db.canvasDeadline.updateMany({ where: { id: { in: diff.restore } }, data: { removedAt: null } })]
      : []),
    ...(diff.remove.length
      ? [db.canvasDeadline.updateMany({ where: { id: { in: diff.remove } }, data: { removedAt: now } })]
      : []),
  ]);
}
