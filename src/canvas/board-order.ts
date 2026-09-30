// src/canvas/board-order.ts
/**
 * How the todo board is ordered, with no database in it, on purpose.
 *
 * TodoBoard is a client component and imports `sortBoard` from here. A
 * `@/lib/db` import anywhere in this file's module graph would drag pg into
 * the browser bundle and fail the build on `dns` - the same split, for the
 * same reason, as src/schedule/exams.ts against exam-queries.ts.
 *
 * It also has to run in the browser rather than on the server: ticking a row
 * off is optimistic, and the sort has to see the optimistic value or the row
 * would not sink until the next refresh.
 */

/**
 * One row on the board, whichever table it came from.
 *
 * Reduced to the few fields the order depends on, so the comparator below is
 * pure and testable and never has to know what a CanvasDeadline is. `dueAtMs`
 * is a number rather than a Date because this shape crosses to the browser,
 * where the board re-sorts after every optimistic tick.
 */
export type BoardItem = {
  id: string;
  kind: 'deadline' | 'todo';
  title: string;
  done: boolean;
  /** Where the student dragged it. Null means they never did. */
  boardOrder: number | null;
  /** Deadlines only. Null for a todo, which sorts by title instead. */
  dueAtMs: number | null;
};

/**
 * The board's order, as one comparator over both kinds of row.
 *
 * Three tiers, in this order:
 *
 *   1. Unfinished above finished. Ticking something off sinks it, which is
 *      the whole reason this exists.
 *   2. Rows the student placed by hand, in their order, above rows they
 *      never touched. Once someone has taken control of the order, the app
 *      does not get to reshuffle around them.
 *   3. Everything unplaced in the default order: things with a real due date
 *      first, by when they are due, then the rest alphabetically. A deadline
 *      is sorted by WHEN because that is the fact about it that matters; a
 *      todo has no date to sort by, so its name is all there is.
 *
 * Tier 2 applies within the finished group too, rather than finished rows
 * reverting to default order. It is the same rule either side of the line,
 * and the only way to notice is to drag two rows and then tick both, where
 * keeping the order you chose is the better answer anyway.
 *
 * Ties break on id so the order is total: equal-comparing rows must not swap
 * places between renders.
 */
export function compareBoardItems(a: BoardItem, b: BoardItem): number {
  if (a.done !== b.done) return a.done ? 1 : -1;

  const placed = (i: BoardItem) => i.boardOrder !== null;
  if (placed(a) !== placed(b)) return placed(a) ? -1 : 1;
  if (placed(a) && placed(b)) return a.boardOrder! - b.boardOrder! || a.id.localeCompare(b.id);

  // Neither has been moved: the default order.
  const dated = (i: BoardItem) => i.dueAtMs !== null;
  if (dated(a) !== dated(b)) return dated(a) ? -1 : 1;
  if (dated(a) && dated(b)) return a.dueAtMs! - b.dueAtMs! || a.id.localeCompare(b.id);

  // Two todos. Case-insensitive and digit-aware, so "Reading 2" comes before
  // "Reading 10" rather than after it the way a plain string compare has it.
  return (
    a.title.localeCompare(b.title, 'en', { sensitivity: 'base', numeric: true }) ||
    a.id.localeCompare(b.id)
  );
}

export function sortBoard(items: BoardItem[]): BoardItem[] {
  return [...items].sort(compareBoardItems);
}
