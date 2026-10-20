'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { sortBoard, type BoardItem } from '@/canvas/board-order';
import CoursePill from '@/components/CoursePill';
import type { DeadlineRow } from '@/components/DeadlinesList';

export type TodoRow = { id: string; title: string; done: boolean; boardOrder: number | null };

/** One thing ticked off during a week already finished. Flat and already
 *  formatted: a past week is a record, so nothing here needs a due date, an
 *  order, or any of the board's machinery. */
export type FinishedRow = {
  id: string;
  kind: 'deadline' | 'todo';
  title: string;
  courseName: string;
  courseLabel: string;
  /** "Mon, Oct 12" - the day it was ticked off, formatted on the server. */
  dayLabel: string;
};

/** Unique across both tables, since a Todo and a CanvasDeadline could in
 *  principle share an id and the drag list needs one key space. */
function keyOf(item: { kind: string; id: string }): string {
  return `${item.kind}:${item.id}`;
}

/**
 * This week's work, in one list: the deadlines the student pulled over from
 * the other views, and the things they wrote themselves.
 *
 * Deliberately not a third rendering of a deadline. A deadline on the board
 * is the SAME row as in the list, ticked with the same action, so ticking it
 * here ticks it there; what the board adds is which ones the student decided
 * were this week's problem, and what order they want to work through them in.
 *
 * The order comes from compareBoardItems (src/canvas/todos.ts), applied HERE
 * rather than on the server: a tick has to sink a row immediately, and the
 * tick is optimistic, so the sort has to see the optimistic value.
 */
export default function TodoBoard({
  weekLabel,
  isCurrentWeek,
  prevWeek,
  nextWeek,
  finished,
  onToggleFinished,
  deadlines,
  comingUp,
  todos,
  busyId,
  onToggleDeadline,
  onRemoveFromBoard,
  onAddToBoard,
  onAddTodo,
  onToggleTodo,
  onRemoveTodo,
  onReorder,
}: {
  weekLabel: string;
  isCurrentWeek: boolean;
  prevWeek: string;
  nextWeek: string | null;
  finished: FinishedRow[] | null;
  onToggleFinished: (row: FinishedRow) => void;
  /** Only the ones on the board; the page has already applied the week rule. */
  deadlines: DeadlineRow[];
  /** Deadlines near enough to be worth putting on the board, already filtered
   *  by the page: outstanding, not withdrawn, and not on the board yet. */
  comingUp: DeadlineRow[];
  todos: TodoRow[];
  busyId: string | null;
  onToggleDeadline: (d: DeadlineRow) => void;
  onRemoveFromBoard: (d: DeadlineRow) => void;
  onAddToBoard: (d: DeadlineRow) => void;
  onAddTodo: (title: string) => Promise<void>;
  onToggleTodo: (t: TodoRow) => void;
  onRemoveTodo: (t: TodoRow) => void;
  onReorder: (order: { id: string; kind: 'deadline' | 'todo' }[]) => void;
}) {
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  // The order the student just dragged into, held until the next server read
  // carries it. Without it the row springs back to its old slot the moment
  // this component re-renders, which is every tick.
  const [dragged, setDragged] = useState<string[] | null>(null);

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so a click on the checkbox
    // or the Delete link is still a click.
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    // Touch holds instead of moves: a swipe on a list has to stay a scroll,
    // so this is a press-and-hold, the way it is in Notes.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const items: BoardItem[] = [
    ...deadlines.map((d) => ({
      id: d.id, kind: 'deadline' as const, title: d.title,
      done: d.done, boardOrder: d.boardOrder, dueAtMs: d.dueAtMs,
    })),
    ...todos.map((t) => ({
      id: t.id, kind: 'todo' as const, title: t.title,
      done: t.done, boardOrder: t.boardOrder, dueAtMs: null,
    })),
  ];

  const sorted = sortBoard(items);
  const open = sorted.filter((i) => !i.done);
  const doneThisWeek = sorted.filter((i) => i.done);

  // The held order is dropped the moment it stops describing the list: an
  // item added, ticked or removed changes which rows are open, and applying
  // a stale order would drop the new one at the top.
  const openKeys = open.map(keyOf);
  const usable =
    dragged !== null &&
    dragged.length === openKeys.length &&
    openKeys.every((k) => dragged.includes(k));
  const ordered = usable
    ? [...open].sort((a, b) => dragged!.indexOf(keyOf(a)) - dragged!.indexOf(keyOf(b)))
    : open;

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const keys = ordered.map(keyOf);
    const from = keys.indexOf(String(active.id));
    const to = keys.indexOf(String(over.id));
    if (from === -1 || to === -1) return;

    const next = [...keys];
    next.splice(to, 0, ...next.splice(from, 1));
    setDragged(next);
    onReorder(
      next.map((k) => {
        const [kind, ...rest] = k.split(':');
        return { kind: kind as 'deadline' | 'todo', id: rest.join(':') };
      }),
    );
  }

  const byKey = new Map<string, DeadlineRow | TodoRow>([
    ...deadlines.map((d) => [`deadline:${d.id}`, d] as [string, DeadlineRow]),
    ...todos.map((t) => [`todo:${t.id}`, t] as [string, TodoRow]),
  ]);

  function rowFor(item: BoardItem) {
    const source = byKey.get(keyOf(item));
    if (!source) return null;
    const isDeadline = item.kind === 'deadline';
    const d = source as DeadlineRow;
    return {
      title: item.title,
      done: item.done,
      busy: busyId === item.id,
      meta: isDeadline
        ? `${d.courseLabel}${d.timeLabel ? ` · ${d.timeLabel}` : ''} · ${d.relativeLabel}`
        : undefined,
      overdue: isDeadline ? d.overdue : false,
      onToggle: () => (isDeadline ? onToggleDeadline(d) : onToggleTodo(source as TodoRow)),
      removeLabel: isDeadline ? 'Take off board' : 'Delete',
      onRemove: () => (isDeadline ? onRemoveFromBoard(d) : onRemoveTodo(source as TodoRow)),
    };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim() === '') return;
    setSaving(true);
    await onAddTodo(title);
    setSaving(false);
    // Cleared whatever happened: on success it is on the board, and on a
    // failure the list above says why, with the text still in the error.
    setTitle('');
  }

  // A week already gone is a record, not a plan, so the left column loses the
  // add box and the dragging. Coming up stays: the two columns answer
  // different questions, and the right one is always about now - you look
  // back at what you did, then put the next thing on today's board.
  if (!isCurrentWeek && finished !== null) {
    return (
      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-5">
          <WeekNav
            weekLabel={weekLabel}
            isCurrentWeek={false}
            prevWeek={prevWeek}
            nextWeek={nextWeek}
            trailing={
              <p className="sky-hero text-sm opacity-80">
                {finished.length === 0 ? 'Nothing finished.' : `${finished.length} finished`}
              </p>
            }
          />
          <FinishedWeek rows={finished} busyId={busyId} onToggle={onToggleFinished} />
        </div>

        <ComingUp items={comingUp} busyId={busyId} onAdd={onAddToBoard} />
      </div>
    );
  }

  return (
    // Two columns where there is room, board first on a phone. The board is
    // the point; Coming up is the drawer you reach into, so it never goes
    // above the thing it feeds.
    <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-5">
        <WeekNav
          weekLabel={weekLabel}
          isCurrentWeek={isCurrentWeek}
          prevWeek={prevWeek}
          nextWeek={nextWeek}
          trailing={
            <p className="sky-hero text-sm opacity-80">
              {open.length === 0 ? 'Nothing left.' : `${open.length} left`}
            </p>
          }
        />

        {items.length === 0 ? (
          <p className="sky-hero text-sm opacity-90">
            Nothing on your board yet. Write a todo below, or add one of the deadlines beside it.
          </p>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              // A list only moves up and down, and a row dragged out of the
              // card has nowhere to land.
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
              onDragEnd={onDragEnd}
            >
              {/* Only the unfinished rows are sortable. Finished ones live
                  below, outside this context, so a row cannot be dropped into
                  the done section: ticking it is what puts it there. */}
              <SortableContext items={ordered.map(keyOf)} strategy={verticalListSortingStrategy}>
                <ul className="divide-y divide-border">
                  {ordered.map((item) => {
                    const row = rowFor(item);
                    return row && <SortableRow key={keyOf(item)} id={keyOf(item)} {...row} />;
                  })}
                </ul>
              </SortableContext>
            </DndContext>

            {doneThisWeek.length > 0 && (
              <ul className="divide-y divide-border">
                {doneThisWeek.map((item) => {
                  const row = rowFor(item);
                  return row && <BoardItemRow key={keyOf(item)} {...row} />;
                })}
              </ul>
            )}
          </div>
        )}

        <form onSubmit={submit} className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="Something else to get done"
            aria-label="Add a todo"
            className="min-w-0 flex-1 rounded-input border border-border bg-surface px-3 py-2 text-sm text-foreground"
          />
          <button
            type="submit"
            disabled={saving || title.trim() === ''}
            className="shrink-0 rounded-pill bg-brand px-4 py-2 text-sm font-medium text-brand-foreground disabled:opacity-50"
          >
            {saving ? 'Adding…' : 'Add'}
          </button>
        </form>
      </div>

      <ComingUp items={comingUp} busyId={busyId} onAdd={onAddToBoard} />
    </div>
  );
}

/**
 * The week this view is showing, with a way back and forward.
 *
 * Links, not buttons: the week lives in the URL, so the back button works,
 * a week can be sent to someone, and the server does every date calculation.
 * Forward is absent in the current week rather than disabled - there is no
 * week ahead to look at, and a dead control invites clicking.
 */
function WeekNav({
  weekLabel,
  isCurrentWeek,
  prevWeek,
  nextWeek,
  trailing,
}: {
  weekLabel: string;
  isCurrentWeek: boolean;
  prevWeek: string;
  nextWeek: string | null;
  trailing: React.ReactNode;
}) {
  const arrow = 'sky-hero rounded-pill px-2 py-1 text-sm leading-none hover:bg-white/15';
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1">
        <Link href={`/deadlines?week=${prevWeek}`} aria-label="The week before" className={arrow}>
          ‹
        </Link>
        <h2 className="sky-hero text-sm font-semibold uppercase tracking-wide">
          {isCurrentWeek ? 'This week' : 'Week of'}
          <span className="ml-2 font-normal normal-case opacity-80">{weekLabel}</span>
        </h2>
        {nextWeek ? (
          <Link href={`/deadlines?week=${nextWeek}`} aria-label="The week after" className={arrow}>
            ›
          </Link>
        ) : (
          // Holds the space so the heading does not shift when you step back.
          <span className={`${arrow} invisible`} aria-hidden>
            ›
          </span>
        )}
      </div>
      {trailing}
    </div>
  );
}

/**
 * A week already finished: what was ticked off in it, by the day it was
 * ticked. Read only by design - there is no board to plan in a week that has
 * gone, and no Coming up, no add box and nothing to drag.
 *
 * Unticking is the one thing left, and it does the obvious thing: the row
 * stops being done, so it reappears on the current board.
 */
function FinishedWeek({
  rows,
  busyId,
  onToggle,
}: {
  rows: FinishedRow[];
  busyId: string | null;
  onToggle: (row: FinishedRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="sky-hero text-sm opacity-90">
        Nothing was ticked off this week. Anything you did not finish is still on your
        current board.
      </p>
    );
  }
  // Grouped by the day STRING the server sent, never by a Date parsed here.
  const days: { label: string; rows: FinishedRow[] }[] = [];
  for (const r of rows) {
    const last = days[days.length - 1];
    if (last && last.label === r.dayLabel) last.rows.push(r);
    else days.push({ label: r.dayLabel, rows: [r] });
  }

  return (
    <div className="space-y-5">
      {days.map((day) => (
        <div key={day.label}>
          <h3 className="sky-hero text-xs font-semibold uppercase tracking-wide opacity-90">
            {day.label}
          </h3>
          <ul className="mt-1.5 divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
            {day.rows.map((r) => (
              <li
                key={`${r.kind}:${r.id}`}
                className={`flex items-start gap-3 px-3 py-2.5 ${busyId === r.id ? 'opacity-50' : ''}`}
              >
                <label className="-m-3.5 flex shrink-0 cursor-pointer items-start p-3.5">
                  <input
                    type="checkbox"
                    checked
                    disabled={busyId === r.id}
                    onChange={() => onToggle(r)}
                    aria-label={`Mark "${r.title}" not done`}
                    className="mt-0.5 h-4 w-4 rounded border-border"
                  />
                </label>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground line-through">{r.title}</p>
                  {r.courseName && (
                    <div className="mt-1">
                      <CoursePill name={r.courseName} label={r.courseLabel} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

type RowProps = {
  title: string;
  done: boolean;
  busy: boolean;
  meta?: string;
  overdue?: boolean;
  onToggle: () => void;
  removeLabel: string;
  onRemove: () => void;
};

/**
 * An unfinished row, which can be dragged.
 *
 * The pointer listeners go on the whole row, so a press-and-hold anywhere
 * drags it and there is no 20px target to find on a phone. dnd-kit's
 * `attributes` do NOT: they carry role="button" and tabIndex, and this row
 * contains a checkbox and a Delete button. Interactive controls nested inside
 * something claiming to be a button is how a screen reader ends up unable to
 * reach the checkbox, which is the one control on the row that matters.
 *
 * So they go on a real handle instead, which is also the accessible way to
 * drive this from a keyboard: tab to the grip, space to lift, arrows to move.
 */
function SortableRow({ id, ...row }: RowProps & { id: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <BoardItemRow
      {...row}
      dragging={isDragging}
      innerRef={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      handleProps={listeners}
      grip={
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder "${row.title}"`}
          className="-my-1 shrink-0 cursor-grab touch-none rounded p-1 text-text-tertiary hover:text-foreground active:cursor-grabbing"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden>
            <circle cx="6" cy="4" r="1.3" /><circle cx="10" cy="4" r="1.3" />
            <circle cx="6" cy="8" r="1.3" /><circle cx="10" cy="8" r="1.3" />
            <circle cx="6" cy="12" r="1.3" /><circle cx="10" cy="12" r="1.3" />
          </svg>
        </button>
      }
    />
  );
}

/** One line on the board. Same row whichever table it came from: on the board
 *  they are the same thing, which is the point of the board. */
function BoardItemRow({
  title,
  done,
  busy,
  meta,
  overdue,
  onToggle,
  removeLabel,
  onRemove,
  dragging,
  innerRef,
  style,
  handleProps,
  grip,
}: RowProps & {
  dragging?: boolean;
  innerRef?: (node: HTMLElement | null) => void;
  style?: React.CSSProperties;
  handleProps?: Record<string, unknown>;
  grip?: React.ReactNode;
}) {
  return (
    <li
      ref={innerRef}
      style={style}
      // No touch-action: none here. That is what PointerSensor would need,
      // and it would stop a swipe on a row from scrolling the page. The
      // delayed TouchSensor above is chosen so the hold, not the CSS, is
      // what tells a scroll from a drag.
      className={`flex items-start gap-3 bg-surface px-3 py-2.5 ${busy ? 'opacity-50' : ''} ${
        dragging ? 'relative z-10 shadow-lg' : ''
      }`}
      {...handleProps}
    >
      {/* The box stays 16px because that is what a checkbox looks like, but
          the padded label around it gives a finger roughly 40px to land on. */}
      <label className="-m-3.5 flex shrink-0 cursor-pointer items-start p-3.5">
        <input
          type="checkbox"
          checked={done}
          disabled={busy}
          onChange={onToggle}
          aria-label={`Mark "${title}" ${done ? 'not done' : 'done'}`}
          className="mt-0.5 h-4 w-4 rounded border-border"
        />
      </label>

      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium text-foreground ${done ? 'line-through' : ''}`}>
          {title}
        </p>
        {meta && (
          <p className={`mt-0.5 text-xs ${overdue && !done ? 'text-danger' : 'text-text-tertiary'}`}>
            {meta}
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={busy}
        onClick={onRemove}
        className="shrink-0 text-xs text-text-tertiary hover:text-danger hover:underline disabled:opacity-50"
      >
        {removeLabel}
      </button>

      {grip}
    </li>
  );
}

/**
 * The deadlines worth pulling onto the board, so deciding what this week is
 * does not mean leaving the board to go and find them.
 *
 * Scoped rather than complete, and that is the whole reason it can sit here:
 * a student mid-term has fifty-odd deadlines outstanding, and a list of fifty
 * beside a board of six is not a choice, it is a scroll. The page decides the
 * window (see isComingUp in src/canvas/todos.ts).
 */
function ComingUp({
  items,
  busyId,
  onAdd,
}: {
  items: DeadlineRow[];
  busyId: string | null;
  onAdd: (d: DeadlineRow) => void;
}) {
  return (
    <div className="space-y-5">
      <h2 className="sky-hero text-sm font-semibold uppercase tracking-wide">
        Coming up
        <span className="ml-2 font-normal normal-case opacity-80">next two weeks</span>
      </h2>

      {items.length === 0 ? (
        <p className="sky-hero text-sm opacity-90">
          Nothing due in the next two weeks that is not already on your board.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
          {items.map((d) => (
            <li
              key={d.id}
              className={`flex items-start gap-3 px-3 py-2.5 ${busyId === d.id ? 'opacity-50' : ''}`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{d.title}</p>
                <p className="mt-0.5 text-xs">
                  <span className="text-text-tertiary">{d.courseLabel}</span>
                  <span className={d.overdue ? 'text-danger' : 'text-text-tertiary'}>
                    {` · ${d.relativeLabel}`}
                  </span>
                </p>
              </div>
              <button
                type="button"
                disabled={busyId === d.id}
                onClick={() => onAdd(d)}
                aria-label={`Put "${d.title}" on your board`}
                className="shrink-0 rounded-pill border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-surface-muted disabled:opacity-50"
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
