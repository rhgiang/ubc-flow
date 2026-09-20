// src/canvas/jobs/sync.ts
import { db } from '@/lib/db';
import { decryptFeedUrl } from '@/canvas/crypto';
import { normalizeFeedUrl } from '@/canvas/feed-url';
import { fetchFeed } from '@/canvas/fetch-feed';
import { parseCanvasFeed } from '@/canvas/parse-ics';
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
  // request to an arbitrary host. The URL itself is never logged.
  const url = normalizeFeedUrl(decryptFeedUrl(feed.encryptedUrl));
  if (!url.ok) {
    await db.canvasFeed.update({ where: { userId }, data: { brokenAt: now, lastFetchedAt: now } });
    console.error('canvas sync: stored feed URL failed validation for one user; marked broken');
    return 'broken';
  }

  const { status, body } = await fetchFeed(url.url);
  if (status !== 200 || body === null) {
    const failures = feed.failureCount + 1;
    const dead = status === 401 || status === 404 || failures >= BROKEN_AFTER_FAILURES;
    await db.canvasFeed.update({
      where: { userId },
      data: { lastFetchedAt: now, lastStatus: status, failureCount: failures, brokenAt: dead ? now : null },
    });
    return dead ? 'broken' : 'transient';
  }

  const parsed = parseCanvasFeed(body);
  const stored = await db.canvasDeadline.findMany({
    where: { userId },
    select: { id: true, uid: true, dueAt: true, removedAt: true },
  });
  await applyDiff(userId, diffFeed(stored, parsed.items), now);
  await db.canvasFeed.update({
    where: { userId },
    data: { lastFetchedAt: now, lastStatus: 200, failureCount: 0 },
  });
  return 'ok';
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
    ...(diff.restore.length
      ? [db.canvasDeadline.updateMany({ where: { id: { in: diff.restore } }, data: { removedAt: null } })]
      : []),
    ...(diff.remove.length
      ? [db.canvasDeadline.updateMany({ where: { id: { in: diff.remove } }, data: { removedAt: now } })]
      : []),
  ]);
}
