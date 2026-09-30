/**
 * Calling a Server Action from the browser, without the failure that does not
 * look like one.
 *
 * Every action in this app answers `{ ok: true } | { ok: false, error }`, and
 * handlers are written around that. But an action whose REQUEST never lands -
 * a dropped connection, a dead tab coming back, campus wifi between buildings
 * - does not answer at all: the promise rejects. A handler that awaits the
 * call bare therefore throws straight past its own error branch, which is
 * where the damage is:
 *
 *   - an optimistic change stays on screen claiming something the server
 *     never heard (a vote counted, a row ticked off);
 *   - a `setBusy(false)` never runs, so the control stays disabled for good;
 *   - nothing is shown to the person, and it surfaces only as an unhandled
 *     "Failed to fetch" in a console nobody has open.
 *
 * `settled` makes a rejection land exactly where `{ ok: false }` lands, so
 * one error branch covers both. There is nothing clever here; the point is
 * that it is in one place rather than written out at every call site, where
 * being forgotten once is invisible until someone's work quietly goes
 * nowhere.
 *
 * For actions that answer with a VALUE rather than a Result - a search, a
 * course lookup - the equivalent is `.catch(() => fallback)` at the call
 * site, which is what this codebase already does in CalendarSubscribeMenu
 * and ScheduleBuilder. There is no helper for those: the fallback differs
 * every time, and a wrapper would only hide it.
 *
 * This module is imported by client components, so it must never reach
 * `@/lib/db`. That is also why the Result shape is written out here rather
 * than imported from canvas/connect.ts, where it is declared.
 */

/** What the person is told when the request never made it. Deliberately about
 *  the connection rather than about the app: the server did not refuse, it
 *  was never asked. */
export const UNREACHABLE = 'Could not reach the server. Check your connection and try again.';

export async function settled<T extends { ok: boolean }>(
  call: Promise<T>,
): Promise<T | { ok: false; error: string }> {
  try {
    return await call;
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}
