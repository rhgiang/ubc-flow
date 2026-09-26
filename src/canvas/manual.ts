// src/canvas/manual.ts
import { db } from '@/lib/db';
import type { Result } from '@/canvas/connect';
import { MANUAL_UID_PREFIX } from '@/canvas/diff';
import { VANCOUVER, vancouverDayKey, vancouverEndOfDayUtc, zonedToUtc } from '@/canvas/tz';

/**
 * Deadlines the student typed in themselves, alongside the ones Canvas sends.
 *
 * They share `CanvasDeadline` rather than getting a table of their own, which
 * is the whole point: the list, the month grid, the done tick, the course
 * colours, the reminder emails and the subscribed feed all read that table,
 * and a second table would mean teaching every one of them about a second
 * shape. What separates the two is the uid: a hand-added row carries
 * MANUAL_UID_PREFIX, and the sync leaves those alone (see sync.ts).
 *
 * The *For functions take a userId and are called by the actions in
 * src/app/actions/canvas.ts, which read the session. Same split as
 * connect.ts and prefs.ts: an export from an actions file is an endpoint.
 */

/** One term's worth of hand-typed items. A student adds a handful; this is
 *  only here so a scripted client cannot write an unbounded table. */
const MAX_MANUAL_DEADLINES = 200;

/** As long as a title gets to be before it is not a title any more. The feed's
 *  own summaries run to a sentence, so this is generous on purpose. */
const MAX_TITLE = 200;

export type ManualDeadlineInput = {
  title: string;
  /** The course this belongs to, as the feed brackets it, or '' for none.
   *  The colour hashes from it and a mute is stored under it, so it has to be
   *  a name the feed already uses or nothing at all - see addManualDeadlineFor. */
  courseName: string;
  /** YYYY-MM-DD, Vancouver. */
  date: string;
  /** HH:MM, Vancouver, or '' for an all-day item. */
  time: string;
};

/**
 * Pure. The fields a row needs, or null if the student gave us something we
 * cannot make a deadline out of.
 *
 * `dueAt` is resolved HERE, on the server, against Vancouver: an all-day item
 * lands at 23:59:59 like every feed row (so "due Friday" reminds before
 * Friday ends), and a timed one at the wall clock the student typed. Doing
 * this in the browser would use the browser's own tzdata, which disagrees
 * with Node's about Vancouver after November 2026 - the same trap the note in
 * src/app/deadlines/page.tsx describes.
 */
export function normalizeManualDeadline(
  input: ManualDeadlineInput,
): { title: string; courseName: string; dueAt: Date; allDay: boolean } | null {
  const title = input.title.trim().slice(0, MAX_TITLE);
  if (title === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return null;

  const allDay = input.time === '';
  if (!allDay && !/^\d{2}:\d{2}$/.test(input.time)) return null;

  const [y, mo, d] = input.date.split('-').map(Number);
  const dueAt = allDay
    ? vancouverEndOfDayUtc(input.date)
    : zonedToUtc(y, mo, d, Number(input.time.slice(0, 2)), Number(input.time.slice(3, 5)), 0, VANCOUVER);
  // Both regexes above are shape checks, and a shape is not a range: Date.UTC
  // rolls "99:99" forward to the 31st and "2026-02-30" into March rather than
  // refusing either, so a crafted request could store a date nobody typed.
  // Reading the day back is the exact test - it is the same key the list and
  // the month grid place the row by, so anything that landed somewhere else
  // is refused here.
  if (vancouverDayKey(dueAt) !== input.date) return null;

  return { title, courseName: input.courseName.trim().slice(0, 120), dueAt, allDay };
}

export async function addManualDeadlineFor(userId: string, input: ManualDeadlineInput): Promise<Result> {
  const fields = normalizeManualDeadline(input);
  if (!fields) return { ok: false, error: 'Give it a name and a date.' };

  const existing = await db.canvasDeadline.count({
    where: { userId, uid: { startsWith: MANUAL_UID_PREFIX } },
  });
  if (existing >= MAX_MANUAL_DEADLINES) {
    return { ok: false, error: 'That is more added deadlines than we can keep for one account.' };
  }

  await db.canvasDeadline.create({
    data: {
      userId,
      // Unique per row, so @@unique([userId, uid]) cannot collide and the
      // prefix is what marks the origin. Nothing reads the rest of it.
      uid: `${MANUAL_UID_PREFIX}${crypto.randomUUID()}`,
      // Not "assignment": that word means Canvas had an assignment object for
      // it, and this is the student's own note.
      kind: 'event',
      title: fields.title,
      courseName: fields.courseName,
      dueAt: fields.dueAt,
      allDay: fields.allDay,
      url: null,
    },
  });
  return { ok: true };
}

/**
 * Deletes one, for real.
 *
 * A feed row is never deleted - `removedAt` marks it, because a professor
 * withdrawing an assignment is a fact worth showing. A row the student typed
 * has no such story: they added it, they can take it back. The uid filter is
 * what keeps this from being a way to delete a feed row, and the userId is
 * part of the WHERE so someone else's id matches nothing.
 */
export async function removeManualDeadlineFor(userId: string, id: string): Promise<Result> {
  const { count } = await db.canvasDeadline.deleteMany({
    where: { id, userId, uid: { startsWith: MANUAL_UID_PREFIX } },
  });
  if (count === 0) return { ok: false, error: 'Not found.' };
  return { ok: true };
}
