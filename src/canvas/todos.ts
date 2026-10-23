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

/** A jot, not a document: a few lines under the title. */
const MAX_NOTE = 500;

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

/**
 * How far ahead the board offers deadlines to put on it.
 *
 * Not "this week": by Friday there is almost nothing left in the current week,
 * and Friday is exactly when someone is deciding what next week looks like.
 * Two weeks keeps that decision possible all week long.
 */
const COMING_UP_DAYS = 14;

/**
 * Whether a deadline is worth offering for the board yet.
 *
 * Overdue counts, and deliberately so: something already blown past is the
 * first thing that belongs on this week's board, and a window that only
 * looked forward would hide exactly the row the student most needs to see.
 */
export function isComingUp(dueAt: Date, now: Date): boolean {
  return dueAt.getTime() <= now.getTime() + COMING_UP_DAYS * 24 * 3600_000;
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
    select: { id: true, title: true, completedAt: true, boardOrder: true, note: true },
  });
}

/**
 * The Monday of the week a `?week=YYYY-MM-DD` parameter names, or null if it
 * names nothing we can use.
 *
 * Deliberately strict rather than forgiving: a week the student did not ask
 * for, silently substituted for one they did, is worse than falling back to
 * this week. Any date inside the week resolves to its Monday, so a link to
 * mid-week still lands somewhere sensible.
 */
export function weekStartFromParam(raw: string | undefined, now: Date): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  // Noon, not midnight: the parameter is a calendar day, and noon in
  // Vancouver is the same calendar day whatever the offset does around it.
  const at = zonedToUtc(y, m, d, 12, 0, 0, VANCOUVER);
  if (Number.isNaN(at.getTime())) return null;
  const start = vancouverWeekStartUtc(at);
  // A week in the future has nothing finished in it and no board to plan, so
  // it is not a week this view can show.
  return start > vancouverWeekStartUtc(now) ? null : start;
}

/** "2026-10-12", the value `?week=` wants for a given Monday. */
export function weekParam(weekStart: Date): string {
  return vancouverDayKey(weekStart);
}

/** The Monday before and after, for the arrows. `next` is null in the current
 *  week, which is what disables the forward arrow. */
export function adjacentWeeks(weekStart: Date, now: Date): { prev: Date; next: Date | null } {
  const shift = (days: number) => vancouverWeekStartUtc(new Date(weekStart.getTime() + days * 24 * 3600_000 + 12 * 3600_000));
  const next = shift(7);
  return { prev: shift(-7), next: next > vancouverWeekStartUtc(now) ? null : next };
}

/**
 * Everything the student finished during one week - both tables, regardless
 * of whether it ever sat on the board.
 *
 * Only completions, and that is not a shortfall. An unfinished row has no
 * week to belong to: it never leaves, so it is equally a member of every week
 * since it was written, and filing it under one of them would be a small lie.
 * What it means in practice is that nothing falls through the gap - anything
 * unfinished from a past week is still on the CURRENT board, in front of you.
 *
 * The window is inclusive at both ends, which is the whole subtlety: a thing
 * ticked off at 00:00:00 on the Monday belongs to that week, and so does one
 * ticked at 23:59:59 on the Sunday.
 */
export async function finishedInWeek(userId: string, weekStart: Date) {
  const weekEnd = vancouverWeekEndUtc(weekStart);
  const window = { gte: weekStart, lte: weekEnd };

  const [todos, deadlines] = await Promise.all([
    db.todo.findMany({
      where: { userId, completedAt: window },
      orderBy: { completedAt: 'asc' },
      select: { id: true, title: true, completedAt: true },
    }),
    db.canvasDeadline.findMany({
      where: { userId, completedAt: window },
      orderBy: { completedAt: 'asc' },
      select: { id: true, title: true, courseName: true, completedAt: true },
    }),
  ]);
  return { todos, deadlines };
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

/**
 * Writes the order the student just dragged the board into.
 *
 * Takes the whole list rather than "move row X to slot 3": positions are
 * rewritten from the array index, so there is no fractional-index arithmetic
 * to drift and no way for two rows to end up claiming the same slot. The
 * board is a handful of rows, so writing all of them costs nothing.
 *
 * Both tables in one transaction, because a half-applied order is a board
 * that reads as neither the old one nor the new one.
 */
export async function reorderBoardFor(
  userId: string,
  order: { id: string; kind: 'deadline' | 'todo' }[],
): Promise<Result> {
  if (order.length === 0) return { ok: true };
  if (order.length > MAX_TODOS) return { ok: false, error: 'That is more rows than one board can hold.' };

  // Scoped to this user in each WHERE, so a request naming someone else's row
  // updates nothing rather than being refused - the same shape every other
  // write on this page uses.
  await db.$transaction(
    order.map(({ id, kind }, index) =>
      kind === 'todo'
        ? db.todo.updateMany({ where: { id, userId }, data: { boardOrder: index } })
        : db.canvasDeadline.updateMany({ where: { id, userId }, data: { boardOrder: index } }),
    ),
  );
  return { ok: true };
}

/**
 * Writes the student's note on a board row, either kind.
 *
 * Emptying the box is how a note is deleted, so blank becomes null rather
 * than an empty string the board would still draw. Scoped to this user in the
 * WHERE, like every other write here.
 */
export async function setBoardNoteFor(
  userId: string,
  kind: 'deadline' | 'todo',
  id: string,
  rawNote: string,
): Promise<Result> {
  const note = rawNote.trim().slice(0, MAX_NOTE) || null;
  const where = { id, userId };
  const { count } =
    kind === 'todo'
      ? await db.todo.updateMany({ where, data: { note } })
      : await db.canvasDeadline.updateMany({ where, data: { note } });
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
