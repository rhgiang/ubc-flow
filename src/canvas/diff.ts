// src/canvas/diff.ts
import type { FeedItem } from './parse-ics';

/** The fields a poll can change without the deadline having moved. */
export type Details = { title: string; courseName: string; url: string | null; allDay: boolean };

export type StoredDeadline = Details & { id: string; uid: string; dueAt: Date; removedAt: Date | null };

export type FeedDiff = {
  create: FeedItem[];
  move: { id: string; from: Date; to: Date; restored: boolean }[];
  /** A rename, a re-bracketed course, a new URL, or an all-day flip. Kept
   *  out of `move` on purpose: none of it is worth emailing about, and the
   *  "moved" notice reads off that bucket. */
  update: (Details & { id: string })[];
  restore: string[];
  remove: string[];
};

/** An all-day deadline has no clock time of its own. vancouverEndOfDayUtc
 *  turns its date into an absolute instant using whatever tzdata the running
 *  Node has, so the SAME feed line yields a different instant after a tzdata
 *  update that changes America/Vancouver. One just landed: tzdata 2026b puts
 *  BC on permanent daylight time, and older releases do not, an hour apart
 *  for every date after November 2026.
 *
 *  Without this, the first deploy that picks up a new tzdata would re-read
 *  every feed, see every all-day deadline shift by an hour, and email each
 *  student that their instructor moved all of them. Nothing moved. A real
 *  all-day move is at least a day, so anything under twelve hours is the
 *  clock, not the professor. Timed deadlines carry an explicit UTC instant
 *  in the feed and are compared exactly.
 */
const ALLDAY_SLOP_MS = 12 * 60 * 60 * 1000;

function movedMeaningfully(s: StoredDeadline, it: FeedItem): boolean {
  const delta = Math.abs(s.dueAt.getTime() - it.dueAt.getTime());
  if (delta === 0) return false;
  return s.allDay && it.allDay ? delta >= ALLDAY_SLOP_MS : true;
}

/** Pure. Keyed on Canvas's UID, which is stable across polls. A row that
 *  drops out of the feed is marked removed once and left alone after; a row
 *  that comes back is restored, moved or not. */
export function diffFeed(stored: StoredDeadline[], items: FeedItem[]): FeedDiff {
  const byUid = new Map(stored.map((s) => [s.uid, s]));
  const seen = new Set<string>();
  const diff: FeedDiff = { create: [], move: [], update: [], restore: [], remove: [] };

  for (const it of items) {
    // First occurrence wins. RFC 5545 lets a recurrence override repeat a UID
    // with a RECURRENCE-ID, and the parser reads neither, so a feed can hand
    // us the same uid twice. Two creates for one uid means P2002 on
    // @@unique([userId, uid]), which aborts applyDiff's whole transaction and
    // loses every other new deadline in the same run, every run, forever.
    if (seen.has(it.uid)) continue;
    seen.add(it.uid);
    const s = byUid.get(it.uid);
    if (!s) {
      diff.create.push(it);
      continue;
    }
    const wasRemoved = s.removedAt !== null;
    if (movedMeaningfully(s, it)) {
      diff.move.push({ id: s.id, from: s.dueAt, to: it.dueAt, restored: wasRemoved });
    } else if (wasRemoved) {
      diff.restore.push(s.id);
    }
    // Independent of the move above: a prof can rename and reschedule in the
    // same edit, and without this the stored title, course, link and all-day
    // flag stay at whatever the row was first created with, for its life.
    if (s.title !== it.title || s.courseName !== it.courseName || s.url !== it.url || s.allDay !== it.allDay) {
      diff.update.push({ id: s.id, title: it.title, courseName: it.courseName, url: it.url, allDay: it.allDay });
    }
  }
  for (const s of stored) {
    if (!seen.has(s.uid) && s.removedAt === null) diff.remove.push(s.id);
  }
  return diff;
}
