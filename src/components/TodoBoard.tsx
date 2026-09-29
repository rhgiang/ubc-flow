'use client';

import { useState } from 'react';
import type { DeadlineRow } from '@/components/DeadlinesList';

export type TodoRow = { id: string; title: string; done: boolean };

/**
 * This week's work, in one list: the deadlines the student pulled over from
 * the other two views, and the things they wrote themselves.
 *
 * Deliberately not a third rendering of a deadline. A deadline on the board
 * is the SAME row as in the list, ticked with the same action, so ticking it
 * here ticks it there; what the board adds is which ones the student decided
 * were this week's problem.
 *
 * Nothing here knows about weeks. The page decides what is on the board (see
 * src/canvas/todos.ts) and hands it over already filtered, so the rollover
 * rule lives in one place and this only draws.
 */
export default function TodoBoard({
  weekLabel,
  deadlines,
  todos,
  busyId,
  onToggleDeadline,
  onRemoveFromBoard,
  onAddTodo,
  onToggleTodo,
  onRemoveTodo,
}: {
  weekLabel: string;
  /** Only the ones on the board; the page has already applied the week rule. */
  deadlines: DeadlineRow[];
  todos: TodoRow[];
  busyId: string | null;
  onToggleDeadline: (d: DeadlineRow) => void;
  onRemoveFromBoard: (d: DeadlineRow) => void;
  onAddTodo: (title: string) => Promise<void>;
  onToggleTodo: (t: TodoRow) => void;
  onRemoveTodo: (t: TodoRow) => void;
}) {
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);

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

  // Both kinds carry `done`, which is what lets the board count them as one.
  const left = [...deadlines, ...todos].filter((r) => !r.done).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="sky-hero text-sm font-semibold uppercase tracking-wide">
          This week
          <span className="ml-2 font-normal normal-case opacity-80">{weekLabel}</span>
        </h2>
        <p className="sky-hero text-sm opacity-80">
          {left === 0 ? 'Nothing left.' : `${left} left`}
        </p>
      </div>

      {deadlines.length === 0 && todos.length === 0 ? (
        <p className="sky-hero text-sm opacity-90">
          Nothing on your board yet. Add a todo below, or open the List and put a deadline on it.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
          {deadlines.map((d) => (
            <BoardItem
              key={d.id}
              title={d.title}
              done={d.done}
              busy={busyId === d.id}
              meta={`${d.courseLabel}${d.timeLabel ? ` · ${d.timeLabel}` : ''} · ${d.relativeLabel}`}
              overdue={d.overdue}
              onToggle={() => onToggleDeadline(d)}
              removeLabel="Take off board"
              onRemove={() => onRemoveFromBoard(d)}
            />
          ))}
          {todos.map((t) => (
            <BoardItem
              key={t.id}
              title={t.title}
              done={t.done}
              busy={busyId === t.id}
              onToggle={() => onToggleTodo(t)}
              removeLabel="Delete"
              onRemove={() => onRemoveTodo(t)}
            />
          ))}
        </ul>
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
  );
}

/** One line on the board. Same row shape whichever kind it came from: on the
 *  board they are the same thing, which is the point of the board. */
function BoardItem({
  title,
  done,
  busy,
  meta,
  overdue,
  onToggle,
  removeLabel,
  onRemove,
}: {
  title: string;
  done: boolean;
  busy: boolean;
  meta?: string;
  overdue?: boolean;
  onToggle: () => void;
  removeLabel: string;
  onRemove: () => void;
}) {
  return (
    <li className={`flex items-start gap-3 px-3 py-2.5 ${busy ? 'opacity-50' : ''}`}>
      {/* The same padded hit area the deadlines list uses: the box stays 16px
          because that is what a checkbox looks like, and the label around it
          gives a finger roughly 40px to land on. */}
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
    </li>
  );
}
