'use client';

import { useState, useTransition, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import {
  addDeadline,
  addTodo,
  reorderBoard,
  removeDeadline,
  removeTodo,
  setDeadlineDone,
  setDeadlineOnBoard,
  setRemindersEnabled,
  setTodoDone,
  updateReminderPreferences,
} from '@/app/actions/canvas';
import { settled } from '@/lib/action-result';
import CoursePill from '@/components/CoursePill';
import CanvasConnect from '@/components/CanvasConnect';
import DeadlinesCalendar from '@/components/DeadlinesCalendar';
import TodoBoard, { type FinishedRow, type TodoRow } from '@/components/TodoBoard';

// Labels for src/canvas/prefs.ts's LEAD_CHOICES ([24, 48, 72, 168]). The
// values themselves come in as a prop rather than an import: prefs.ts also
// exports a db-touching function, and this is a client component.
const LEAD_LABELS: Record<number, string> = { 24: '1 day', 48: '2 days', 72: '3 days', 168: '1 week' };

/** What every action on this page answers with. Spelled out here rather than
 *  imported from src/canvas/connect.ts, which is where it is declared: that
 *  module reaches the database, and a value import of it from a client
 *  component drags pg into the browser bundle and fails the build on `dns`.
 *  A type import would erase, but this is one line and leaves nothing to
 *  get wrong later. */
type Result = { ok: true } | { ok: false; error: string };

export type DeadlineRow = {
  id: string;
  /** Typed in by the student rather than read out of the feed. Those are
   *  theirs to delete; a feed row is only ever marked removed. */
  manual: boolean;
  /** On this week's todo board. The page applies the week rule; this is just
   *  the answer. */
  onBoard: boolean;
  /** Due soon enough (or already overdue) to be worth offering for the board.
   *  Decided on the server, like every other date-derived field here. */
  comingUp: boolean;
  /** Where the student dragged this row on the board, and when it is due as a
   *  plain number. Both feed the board's comparator, which runs here so the
   *  order can follow an optimistic tick. */
  boardOrder: number | null;
  dueAtMs: number;
  title: string;
  /** Canvas's raw bracket. The identity behind the colour and the mute list,
   *  never rendered; courseLabel is what a student reads. */
  courseName: string;
  courseLabel: string;
  url: string | null;
  /** True only when removedAt is set and within the last 14 days: the page
   *  never sends an older removed row at all. */
  removed: boolean;
  /** Ticked off by the student. */
  done: boolean;
  /** Past its due date and neither done nor withdrawn. */
  overdue: boolean;
  /** Every one of these was formatted on the server. See the note on toRow in
   *  src/app/deadlines/page.tsx: formatting a date in here uses the browser's
   *  own tzdata, which disagrees with Node's about Vancouver after November
   *  2026, and would leave the page an hour off from the reminder email. */
  dueLabel: string;
  dayLabel: string;
  dayKey: string;
  timeLabel: string;
  relativeLabel: string;
  movedFromLabel: string | null;
};

type View = 'list' | 'calendar' | 'todo';

export default function DeadlinesList({
  connectedLabel,
  lastReadLabel,
  broken,
  failing,
  enabled,
  leadHours,
  mutedCourses,
  leadChoices,
  deadlines,
  todos,
  weekLabel,
  isCurrentWeek,
  prevWeek,
  nextWeek,
  finished,
  todayKey,
}: {
  connectedLabel: string | null;
  lastReadLabel: string | null;
  broken: boolean;
  /** Last read failed, but the feed has retries left. The dates below are
   *  the last good ones, so say so rather than letting them look current. */
  failing: boolean;
  enabled: boolean;
  leadHours: number[];
  mutedCourses: string[];
  leadChoices: readonly number[];
  deadlines: DeadlineRow[];
  todos: TodoRow[];
  /** "Sep 28 to Oct 4", formatted on the server with every other date here. */
  weekLabel: string;
  /** False when ?week= points at a week already finished, which makes the
   *  board a read-only record rather than something to plan with. */
  isCurrentWeek: boolean;
  prevWeek: string;
  nextWeek: string | null;
  /** Null in the current week; otherwise what was ticked off in that one. */
  finished: FinishedRow[] | null;
  todayKey: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>('list');
  const [hideDone, setHideDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Ticking a box must feel instant, so the row flips here and the server
  // catches up. router.refresh() then replaces this with the truth; on a
  // failure the override is dropped and the real value comes back.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  // The same trick for putting a deadline on the board. It matters more here
  // than for a checkbox: this moves the row between the two columns of the
  // Todo view, and without it nothing happens at all until the action AND the
  // refresh have both come back, which measured about 1.4s of a click that
  // looked ignored.
  const [optimisticBoard, setOptimisticBoard] = useState<Record<string, boolean>>({});
  const rows = deadlines.map((d) => {
    if (!(d.id in optimistic) && !(d.id in optimisticBoard)) return d;
    return {
      ...d,
      ...(d.id in optimistic ? { done: optimistic[d.id] } : {}),
      ...(d.id in optimisticBoard ? { onBoard: optimisticBoard[d.id] } : {}),
    };
  });

  /**
   * Every action this page calls goes through here.
   *
   * The point is the catch. A Server Action whose request never lands rejects
   * rather than returning { ok: false }, and each handler used to await the
   * call bare - so a dropped connection threw past the revert, left the
   * optimistic change on screen, showed no error, and surfaced as an
   * unhandled "Failed to fetch". The row then claimed to be ticked, or on
   * your board, when the server had never heard of it, until something
   * happened to reload the page. On campus wifi that is not a rare path.
   *
   * A rejection has to land exactly where { ok: false } lands, and the only
   * way to be sure of that for every caller is for there to be one place.
   * `revert` undoes whatever the handler did optimistically.
   */
  async function submit(call: Promise<Result>, revert?: () => void): Promise<void> {
    setError(null);
    const result = await settled(call);
    if (!result.ok) {
      revert?.();
      return setError(result.error);
    }
    startTransition(() => router.refresh());
  }

  /** Drops an optimistic override, so the row snaps back to the server's answer. */
  function forget(set: Dispatch<SetStateAction<Record<string, boolean>>>, id: string) {
    return () =>
      set((o) => {
        const rest = { ...o };
        delete rest[id];
        return rest;
      });
  }

  async function toggleDone(item: DeadlineRow) {
    const next = !item.done;
    setOptimistic((o) => ({ ...o, [item.id]: next }));
    setBusyId(item.id);
    await submit(setDeadlineDone(item.id, next), forget(setOptimistic, item.id));
    setBusyId(null);
  }

  async function removeOne(item: DeadlineRow) {
    setBusyId(item.id);
    await submit(removeDeadline(item.id));
    setBusyId(null);
  }

  // Optimistic like toggleDone above: the board is for ticking things off,
  // and a checkbox that waits on a round trip feels broken.
  const [optimisticTodo, setOptimisticTodo] = useState<Record<string, boolean>>({});
  const todoRows = todos.map((t) => (t.id in optimisticTodo ? { ...t, done: optimisticTodo[t.id] } : t));

  async function toggleTodo(item: TodoRow) {
    const next = !item.done;
    setOptimisticTodo((o) => ({ ...o, [item.id]: next }));
    setBusyId(item.id);
    await submit(setTodoDone(item.id, next), forget(setOptimisticTodo, item.id));
    setBusyId(null);
  }

  async function addTodoItem(title: string) {
    await submit(addTodo(title));
  }

  async function removeTodoItem(item: TodoRow) {
    setBusyId(item.id);
    await submit(removeTodo(item.id));
    setBusyId(null);
  }

  // No optimistic bookkeeping and no refresh: the board already shows the
  // new order, because the drag is what put it there. Only the failure needs
  // saying, and submit() handles that.
  async function reorder(order: { id: string; kind: 'deadline' | 'todo' }[]) {
    await submit(reorderBoard(order));
  }

  // Un-ticking something in a past week puts it back among the unfinished,
  // which means it reappears on the CURRENT board. That is the honest result:
  // it is not done, and the current board is where not-done things live.
  async function toggleFinished(row: FinishedRow) {
    setBusyId(row.id);
    await submit(row.kind === 'todo' ? setTodoDone(row.id, false) : setDeadlineDone(row.id, false));
    setBusyId(null);
  }

  async function toggleOnBoard(item: DeadlineRow) {
    const next = !item.onBoard;
    // Moves columns immediately; the server catches up behind it.
    //
    // No busyId here, unlike the tick handlers. Those leave the row where it
    // is, so dimming it reads as "working on it"; this one has already jumped
    // to the other column, and dimming the row that just arrived reads as a
    // glitch. There is nothing to protect against a second click either: the
    // Add button went with it, and the control it turned into undoes it.
    setOptimisticBoard((o) => ({ ...o, [item.id]: next }));
    await submit(setDeadlineOnBoard(item.id, next), forget(setOptimisticBoard, item.id));
  }

  async function toggleEnabled() {
    setBusy(true);
    await submit(setRemindersEnabled(!enabled));
    setBusy(false);
  }

  async function savePrefs(next: { leadHours: number[]; mutedCourses: string[] }) {
    setBusy(true);
    await submit(updateReminderPreferences(next));
    setBusy(false);
  }

  // An event whose SUMMARY had no trailing [Course] has an empty name. It
  // would render as a checkbox with no label, and ticking it would send '',
  // which the action drops, so the tick would silently undo itself.
  const courseNames = [...new Set(rows.map((d) => d.courseName))].filter(Boolean).sort();
  const labelFor = new Map(rows.map((d) => [d.courseName, d.courseLabel]));

  const doneCount = rows.filter((d) => d.done).length;
  const openCount = rows.filter((d) => !d.done && !d.removed).length;
  const visible = hideDone ? rows.filter((d) => !d.done) : rows;

  // Deadlines already arrive soonest first, so a run of the same Vancouver
  // day stays contiguous: one pass groups them without a re-sort.
  const groups: { key: string; label: string; items: DeadlineRow[] }[] = [];
  for (const d of visible) {
    const current = groups[groups.length - 1];
    if (current && current.key === d.dayKey) current.items.push(d);
    else groups.push({ key: d.dayKey, label: d.dayLabel, items: [d] });
  }

  return (
    // A month grid needs about twice the width a readable list wants, so the
    // container follows the view rather than splitting the difference and
    // serving both badly.
    <div
      className={`mx-auto w-full space-y-5 ${
        // The month grid and the board both want the room - a past week keeps
        // the two columns, since Coming up stays beside it.
        view === 'list' ? 'max-w-2xl' : 'max-w-5xl'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="sky-hero text-2xl font-semibold">Deadlines</h1>
        <div className="flex items-center gap-3">
          {doneCount > 0 && (
            <label className="sky-hero flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={hideDone}
                onChange={() => setHideDone((v) => !v)}
                className="h-4 w-4 rounded border-border"
              />
              Hide done
            </label>
          )}
          <div className="sky-hero flex rounded-pill border border-border p-0.5" role="tablist">
            {(['list', 'calendar', 'todo'] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={`rounded-pill px-3 py-1 text-sm font-medium capitalize transition ${
                  view === v
                    ? 'bg-brand text-brand-foreground'
                    : 'text-text-secondary hover:text-foreground'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Both closed by default. Open they would push the deadlines off the
          first screen, which is what the original layout did; shut they are
          two lines that say where the reminders stand and when the feed was
          last read, which is worth having in reach. */}
      <details className="rounded-card border border-border bg-surface">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-foreground">
          Reminder settings
          <span className="ml-2 font-normal text-text-secondary">
            {enabled
              ? leadHours.length
                ? `on, ${[...leadHours].sort((a, b) => a - b).map((h) => LEAD_LABELS[h] ?? `${h}h`).join(', ')} before`
                : 'on, no lead times picked'
              : 'off'}
          </span>
        </summary>

        <div className="border-t border-border px-4 py-3">
          <label className="flex items-center gap-2 text-sm font-medium text-foreground">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={toggleEnabled}
              className="h-4 w-4 rounded border-border"
            />
            Email me before each deadline
          </label>

          {enabled && (
            <>
              <fieldset className="mt-4" disabled={busy}>
                <legend className="text-sm font-medium text-foreground">Remind me</legend>
                <div className="mt-2 flex flex-wrap gap-3">
                  {leadChoices.map((h) => (
                    <label key={h} className="flex items-center gap-1.5 text-sm text-text-secondary">
                      <input
                        type="checkbox"
                        checked={leadHours.includes(h)}
                        onChange={() =>
                          savePrefs({
                            leadHours: leadHours.includes(h)
                              ? leadHours.filter((x) => x !== h)
                              : [...leadHours, h],
                            mutedCourses,
                          })
                        }
                        className="h-4 w-4 rounded border-border"
                      />
                      {LEAD_LABELS[h] ?? `${h}h`}
                    </label>
                  ))}
                </div>
              </fieldset>

              {courseNames.length > 0 && (
                <fieldset className="mt-4" disabled={busy}>
                  <legend className="text-sm font-medium text-foreground">Mute a course</legend>
                  <div className="mt-2 flex flex-col gap-2">
                    {courseNames.map((c) => (
                      <label key={c} className="flex items-center gap-2 text-sm text-text-secondary">
                        <input
                          type="checkbox"
                          checked={mutedCourses.includes(c)}
                          onChange={() =>
                            savePrefs({
                              leadHours,
                              mutedCourses: mutedCourses.includes(c)
                                ? mutedCourses.filter((x) => x !== c)
                                : [...mutedCourses, c],
                            })
                          }
                          className="h-4 w-4 rounded border-border"
                        />
                        <CoursePill name={c} label={labelFor.get(c) ?? c} />
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
            </>
          )}
        </div>
      </details>

      <details className="rounded-card border border-border bg-surface">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-foreground">
          Your Canvas connection
        </summary>
        <div className="border-t border-border px-4 py-3">
          {/* No failing prop: this page says it once, at the top, next to the
              list it affects. */}
          <CanvasConnect connectedLabel={connectedLabel} lastReadLabel={lastReadLabel} broken={broken} />
        </div>
      </details>

      {/* The row itself is shown in every view, including a week already
          gone: Add a deadline adds to your deadlines, not to the week on
          screen, and hiding the row took its height with it, so both columns
          jumped the moment you pressed the back arrow.

          The COUNT sits out the Todo tab. It is every outstanding deadline
          you have, which read as a contradiction directly above a heading
          saying "Week of Oct 12" - and the board already carries the right
          number for whichever week is open, in that heading. An empty span
          rather than nothing, so justify-between still has two children and
          the button does not slide to the left. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {view === 'todo' ? (
          <span aria-hidden />
        ) : (
          <p className="sky-hero text-sm">
            {openCount === 0 ? 'Nothing outstanding.' : `${openCount} to go`}
            {doneCount > 0 && <span className="opacity-75">{` · ${doneCount} done`}</span>}
          </p>
        )}
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="sky-hero text-sm font-medium underline-offset-2 hover:underline"
          >
            Add a deadline
          </button>
        )}
      </div>

      {adding && (
        <AddDeadlineForm
          courseNames={courseNames}
          labelFor={labelFor}
          onCancel={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            startTransition(() => router.refresh());
          }}
        />
      )}

      {failing && (
        <p className="rounded-card border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger">
          The last read of your Canvas feed failed. What is below is the last good read, so it may be
          out of date.
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="sky-hero text-sm">
          Nothing due yet. New deadlines show up here once Canvas has them.
        </p>
      ) : view === 'todo' ? (
        <TodoBoard
          weekLabel={weekLabel}
          isCurrentWeek={isCurrentWeek}
          prevWeek={prevWeek}
          nextWeek={nextWeek}
          finished={finished}
          onToggleFinished={toggleFinished}
          deadlines={rows.filter((d) => d.onBoard)}
          // What the student can put on the board without leaving this view:
          // near-term, still outstanding, and not already on it.
          comingUp={rows.filter((d) => d.comingUp && !d.onBoard && !d.done && !d.removed)}
          todos={todoRows}
          busyId={busyId}
          onToggleDeadline={toggleDone}
          onRemoveFromBoard={toggleOnBoard}
          onAddToBoard={toggleOnBoard}
          onAddTodo={addTodoItem}
          onToggleTodo={toggleTodo}
          onRemoveTodo={removeTodoItem}
          onReorder={reorder}
        />
      ) : view === 'calendar' ? (
        <DeadlinesCalendar deadlines={visible} todayKey={todayKey} onToggle={toggleDone} busyId={busyId} />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.key}>
              <h3 className="sky-hero text-xs font-semibold uppercase tracking-wide opacity-90">
                {g.label}
              </h3>
              <ul className="mt-1.5 divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
                {g.items.map((d) => (
                  <DeadlineItem
                    key={d.id}
                    item={d}
                    muted={mutedCourses.includes(d.courseName)}
                    busy={busyId === d.id}
                    onToggle={toggleDone}
                    onRemove={removeOne}
                    onToggleBoard={toggleOnBoard}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}

/**
 * One row. The title leads, because that is what a student scans for. The
 * course is a coloured badge underneath rather than the headline, which is
 * how the old card had it, and the whole title is the link into Canvas so
 * there is no separate "Open in Canvas" line on every single row.
 */
function DeadlineItem({
  item,
  muted,
  busy,
  onToggle,
  onRemove,
  onToggleBoard,
}: {
  item: DeadlineRow;
  muted: boolean;
  busy: boolean;
  onToggle: (d: DeadlineRow) => void;
  onRemove: (d: DeadlineRow) => void;
  onToggleBoard: (d: DeadlineRow) => void;
}) {
  const struck = item.done || item.removed;
  return (
    <li className={`flex items-start gap-3 px-3 py-2.5 ${muted ? 'opacity-60' : ''} ${busy ? 'opacity-50' : ''}`}>
      {/* The box stays 16px because that is what a checkbox looks like, but
          the padded label around it gives a finger roughly 40px to land on.
          A mobile audit found the bare input was a 16px target, and ticking
          things off is the main thing this page is for. */}
      <label className="-m-3.5 flex shrink-0 cursor-pointer items-start p-3.5">
        <input
          type="checkbox"
          checked={item.done}
          disabled={busy || item.removed}
          onChange={() => onToggle(item)}
          aria-label={`Mark "${item.title}" ${item.done ? 'not done' : 'done'}`}
          className="mt-0.5 h-4 w-4 rounded border-border"
        />
      </label>

      <div className="min-w-0 flex-1">
        {item.url && !item.removed ? (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className={`block text-sm font-medium text-foreground hover:text-brand-accent hover:underline ${struck ? 'line-through' : ''}`}
          >
            {item.title}
          </a>
        ) : (
          <p className={`text-sm font-medium text-foreground ${struck ? 'line-through' : ''}`}>
            {item.title}
          </p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* An item with no course - the feed's un-bracketed events, and
              anything added without picking one - would otherwise render an
              empty coloured pill. */}
          {item.courseName && <CoursePill name={item.courseName} label={item.courseLabel} />}
          {item.manual && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onRemove(item)}
              className="text-xs text-text-tertiary hover:text-danger hover:underline disabled:opacity-50"
            >
              Remove
            </button>
          )}
          {/* Not offered on a withdrawn deadline: there is nothing left to
              plan a week around. */}
          {!item.removed && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onToggleBoard(item)}
              className="text-xs text-text-tertiary hover:text-brand-accent hover:underline disabled:opacity-50"
            >
              {item.onBoard ? 'On your board' : 'Add to board'}
            </button>
          )}
          {item.movedFromLabel && (
            <span className="text-xs text-text-tertiary">Moved from {item.movedFromLabel}</span>
          )}
          {item.removed && <span className="text-xs text-danger">Removed by your instructor</span>}
        </div>
      </div>

      <div className="shrink-0 text-right">
        {item.timeLabel && <div className="text-sm text-text-secondary">{item.timeLabel}</div>}
        {!struck && (
          <div className={`text-xs ${item.overdue ? 'text-danger' : 'text-text-tertiary'}`}>
            {item.relativeLabel}
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * Something Canvas does not know about: a midterm, a club meeting, a form the
 * department wants by Friday.
 *
 * It writes a real CanvasDeadline, so the added item is a deadline in every
 * sense the rest of this page already means - it groups by day, ticks off,
 * shows on the month grid, rides the subscribed feed, and earns the same
 * reminder emails. The one difference is the Remove control on its row.
 *
 * Course is a pick from the ones already in the feed rather than free text:
 * the colour hashes from that exact string and a mute is stored under it, so
 * a typed "CPSC 110" that does not match the bracket Canvas sends would get
 * its own colour and dodge the mute. No course is a fine answer.
 */
function AddDeadlineForm({
  courseNames,
  labelFor,
  onCancel,
  onDone,
}: {
  courseNames: string[];
  labelFor: Map<string, string>;
  onCancel: () => void;
  onDone: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(form: FormData) {
    setSaving(true);
    setError(null);
    const r = await addDeadline({
      title: String(form.get('title') ?? ''),
      courseName: String(form.get('courseName') ?? ''),
      date: String(form.get('date') ?? ''),
      // Blank means all day, which is stored as 11:59 p.m. Vancouver, the
      // same convention every all-day feed item lands on.
      time: String(form.get('time') ?? ''),
    });
    setSaving(false);
    if (!r.ok) return setError(r.error);
    onDone();
  }

  const field = 'mt-1 w-full rounded-input border border-border bg-surface px-2 py-1.5 text-sm text-foreground';

  return (
    <form action={submit} className="rounded-card border border-border bg-surface p-4">
      <p className="text-sm font-medium text-foreground">Add a deadline</p>
      <p className="mt-1 text-xs text-text-tertiary">
        For anything Canvas does not carry. It is yours: nothing from your feed will move or
        remove it, and you can take it off again from its row.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-xs text-text-tertiary">What is due</span>
          <input type="text" name="title" required maxLength={200} className={field} />
        </label>

        <label className="block">
          <span className="text-xs text-text-tertiary">Course (optional)</span>
          <select name="courseName" className={field} defaultValue="">
            <option value="">No course</option>
            {courseNames.map((c) => (
              <option key={c} value={c}>
                {labelFor.get(c) ?? c}
              </option>
            ))}
          </select>
        </label>

        {/* Native date and time inputs: the browser already knows this
            student's locale and gives them a picker for free. */}
        <label className="block">
          <span className="text-xs text-text-tertiary">Due</span>
          <input type="date" name="date" required className={field} />
        </label>

        <label className="block">
          <span className="text-xs text-text-tertiary">Time (optional)</span>
          <input type="time" name="time" className={field} />
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-pill bg-brand px-4 py-2 text-sm font-medium text-brand-foreground disabled:opacity-50"
        >
          {saving ? 'Adding…' : 'Add deadline'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-text-secondary hover:underline"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
