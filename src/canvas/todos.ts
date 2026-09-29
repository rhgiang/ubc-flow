// src/canvas/todos.ts
import { db } from '@/lib/db';
import type { Result } from '@/canvas/connect';
import { VANCOUVER, vancouverDayKey, zonedToUtc } from '@/canvas/tz';

/**
 * The todo board: this week's work, in one list.
 *
 * Two kinds of row sit on it. A `Todo` is something the student wrote that
 * Canvas knows nothing about and that has no due date worth reminding
 * against. A `CanvasDeadline` with `onBoardAt` set is a real deadline the
 * student pulled onto the board, held by REFERENCE and never copied, so a
 * title or date the professor changes still reaches it and ticking it here is
 * the same tick as ticking it in the list.
 *
 * NOTHING HERE STORES A WEEK. The board shows unfinished rows plus whatever
 * was finished since Monday, which gives the two behaviours asked for without
 * a week column and without a job to advance one:
 *
 *   - an unfinished item rolls over because it never leaves, and it does so
 *     whether or not anyone opened the page;
 *   - a finished item stays visible for the rest of the week, then drops off
 *     when Monday moves underneath it.
 *
 * A stored week would need something to advance it, and a job that did not
 * run is a board that is quietly wrong on Monday morning. This cannot be.
 */

/** As many as one board can hold. A week has a dozen things on it; this is
 *  only here so a scripted client cannot write an unbounded table. */
const MAX_TODOS = 200;

/** As long as a title gets to be before it is not a title. Matches the cap on
 *  a hand-added deadline, since they are the same kind of thing typed twice. */
const MAX_TITLE = 200;

/**
 * Monday 00:00 Vancouver of the week containing `now`, as a UTC instant.
 *
 * Pure, and takes `now` rather than reading the clock, so the boundary can be
 * tested from both sides. Monday because a school week starts there, which is
 * also what the board's date range says.
 *
 * The weekday comes off the Vancouver CALENDAR DAY, not off the UTC instant:
 * between 4pm and midnight Pacific those are different days, and reading the
 * weekday off the instant would roll the board over on Sunday afternoon.
 */
export function vancouverWeekStartUtc(now: Date): Date {
  const [y, m, d] = vancouverDayKey(now).split('-').map(Number);
  // A plain calendar date, so UTC here is arithmetic on Y/M/D and not a time
  // zone claim. getUTCDay: 0 is Sunday, so Sunday is 6 days into the week.
  const daysSinceMonday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(y, m - 1, d - daysSinceMonday));
  return zonedToUtc(
    monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(),
    0, 0, 0, VANCOUVER,
  );
}

/**
 * Whether a row belongs on the board right now: unfinished, or finished
 * during the week that `weekStart` opens.
 *
 * One rule, applied to both kinds of row, so a todo and a pulled deadline
 * cannot start disagreeing about when Monday is.
 */
export function stillOnBoard(row: { completedAt: Date | null }, weekStart: Date): boolean {
  return row.completedAt === null || row.completedAt >= weekStart;
}

/** The end of the board's week, for the date range in its header. */
export function vancouverWeekEndUtc(weekStart: Date): Date {
  return new Date(weekStart.getTime() + 7 * 24 * 3600_000 - 1);
}

export async function todosForBoard(userId: string, now: Date) {
  const weekStart = vancouverWeekStartUtc(now);
  // Filtered in the query rather than in JS: a student who has used this for
  // a year has a year of finished todos, and only this week's are wanted.
  return db.todo.findMany({
    where: { userId, OR: [{ completedAt: null }, { completedAt: { gte: weekStart } }] },
    orderBy: { createdAt: 'asc' },
    select: { id: true, title: true, completedAt: true },
  });
}

export async function addTodoFor(userId: string, rawTitle: string): Promise<Result> {
  const title = rawTitle.trim().slice(0, MAX_TITLE);
  if (title === '') return { ok: false, error: 'Give it a name.' };

  const existing = await db.todo.count({ where: { userId, completedAt: null } });
  if (existing >= MAX_TODOS) {
    return { ok: false, error: 'That is more todos than one board can hold.' };
  }

  await db.todo.create({ data: { userId, title } });
  return { ok: true };
}

/**
 * Tick a todo off, or un-tick it.
 *
 * The userId is part of the WHERE rather than checked first, so a request
 * naming someone else's todo matches no row and changes nothing - the same
 * shape setDeadlineDone uses, and the same reason it reports "Not found."
 * either way: a caller must not be able to tell a real id from a made-up one.
 */
export async function setTodoDoneFor(userId: string, id: string, done: boolean): Promise<Result> {
  const { count } = await db.todo.updateMany({
    where: { id, userId },
    data: { completedAt: done ? new Date() : null },
  });
  return count === 0 ? { ok: false, error: 'Not found.' } : { ok: true };
}

export async function removeTodoFor(userId: string, id: string): Promise<Result> {
  const { count } = await db.todo.deleteMany({ where: { id, userId } });
  return count === 0 ? { ok: false, error: 'Not found.' } : { ok: true };
}

/**
 * Put a deadline on the board, or take it off.
 *
 * Only ever touches `onBoardAt`. Taking a deadline off the board is not
 * removing the deadline, and must never look like one: it keeps its place in
 * the list, its reminders and its done state.
 */
export async function setDeadlineOnBoardFor(
  userId: string,
  id: string,
  onBoard: boolean,
): Promise<Result> {
  const { count } = await db.canvasDeadline.updateMany({
    where: { id, userId },
    data: { onBoardAt: onBoard ? new Date() : null },
  });
  return count === 0 ? { ok: false, error: 'Not found.' } : { ok: true };
}
