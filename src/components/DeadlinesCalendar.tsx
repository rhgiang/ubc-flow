'use client';

import { useState } from 'react';
import { buildMonths, type DayCell } from '@/canvas/calendar';
import { courseColorIndex } from '@/schedule/colors';
import type { DeadlineRow } from '@/components/DeadlinesList';

/** Sunday first, matching the grid buildMonths produces. */
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Chips a square shows before it gives up and counts the rest. Every square
 *  is the same height, so a Monday with seven things due must not be allowed
 *  to stretch its whole row. */
const MAX_CHIPS = 3;

/**
 * A month view of everything due. The question a list cannot answer is "how
 * bad is that week", and this is the shape that answers it.
 *
 * No time axis: deadlines are points, not blocks, and almost all of them land
 * at the same late-evening hour anyway. The clock is a label on the chip.
 *
 * Every date decision was made on the server. This component reads dayKey and
 * never constructs a Date, so nothing here can disagree with the list or the
 * reminder emails about which day something falls on.
 */
export default function DeadlinesCalendar({
  deadlines,
  todayKey,
  onToggle,
  busyId,
}: {
  deadlines: DeadlineRow[];
  /** "2026-09-20" from the server, so the highlight cannot hydrate-mismatch. */
  todayKey: string;
  onToggle: (d: DeadlineRow) => void;
  busyId: string | null;
}) {
  // Which square is open. At phone width a square is a handful of dots and
  // nothing else fits, so tapping one has to be how you read it: the dots
  // said something was due and refused to say what. On a wide screen the
  // chips carry their own titles, and this is what "+2 more" opens.
  const [openDay, setOpenDay] = useState<string | null>(null);
  const months = buildMonths(deadlines);

  if (months.length === 0) {
    return <p className="text-sm text-text-secondary">Nothing to put on a calendar yet.</p>;
  }

  return (
    <div className="space-y-8">
      {months.map((month) => {
        const open = month.cells.find((c) => c.key === openDay && c.items.length > 0) ?? null;
        return (
          <section key={month.key}>
            <h3 className="text-base font-semibold text-foreground">{month.label}</h3>

            <div className="mt-3 grid grid-cols-7 gap-px overflow-hidden rounded-card border border-border bg-border">
              {WEEKDAYS.map((w, i) => (
                <div
                  key={i}
                  className="bg-surface-muted py-1.5 text-center text-xs font-medium text-text-secondary"
                >
                  {w}
                </div>
              ))}

              {month.cells.map((cell) => (
                <Cell
                  key={cell.key}
                  cell={cell}
                  today={cell.key === todayKey}
                  selected={cell.key === openDay}
                  onOpen={() => setOpenDay(cell.key === openDay ? null : cell.key)}
                  onToggle={onToggle}
                  busyId={busyId}
                />
              ))}
            </div>

            {open && (
              <DayPanel
                cell={open}
                onClose={() => setOpenDay(null)}
                onToggle={onToggle}
                busyId={busyId}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}

function Cell({
  cell,
  today,
  selected,
  onOpen,
  onToggle,
  busyId,
}: {
  cell: DayCell<DeadlineRow>;
  today: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggle: (d: DeadlineRow) => void;
  busyId: string | null;
}) {
  return (
    // Fixed height, not min-height: every square the same size is what makes
    // the grid read as a calendar at a glance.
    <div
      className={`relative h-16 overflow-hidden bg-surface p-1 align-top sm:h-28 ${
        cell.day === null ? 'opacity-40' : ''
      } ${selected ? 'ring-2 ring-inset ring-brand-accent' : ''}`}
    >
      {cell.day !== null && (
        <div
          className={
            today
              ? 'mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-accent text-xs font-semibold text-brand-foreground'
              : 'mb-1 inline-block px-1 text-xs text-text-tertiary'
          }
        >
          {cell.day}
        </div>
      )}

      {/* Phone: the whole square is the button, because a handful of two
          pixel dots is not a tap target and the dots cannot say what is due.
          Covers the square so the finger has the full 16 by 50 to aim at. */}
      {cell.items.length > 0 && (
        <button
          type="button"
          onClick={onOpen}
          aria-expanded={selected}
          aria-label={`${cell.items.length} due on the ${cell.day}. Show them.`}
          className="absolute inset-0 flex flex-wrap content-start gap-1 p-1 pt-6 text-left sm:hidden"
        >
          {cell.items.map((item) => (
            <Dot key={item.id} item={item} />
          ))}
        </button>
      )}

      <div className="hidden space-y-1 sm:block">
        {cell.items.slice(0, MAX_CHIPS).map((item) => (
          <Chip key={item.id} item={item} onToggle={onToggle} busy={busyId === item.id} />
        ))}
        {cell.items.length > MAX_CHIPS && (
          <button
            type="button"
            onClick={onOpen}
            aria-expanded={selected}
            className="block w-full px-1 text-left text-xs text-text-tertiary hover:text-foreground hover:underline"
          >
            {`+${cell.items.length - MAX_CHIPS} more`}
          </button>
        )}
      </div>
    </div>
  );
}

/** Everything due on one day, opened by tapping its square. Also what the
 *  "+2 more" on a crowded desktop square opens, since those items are
 *  otherwise unreachable from the calendar. */
function DayPanel({
  cell,
  onClose,
  onToggle,
  busyId,
}: {
  cell: DayCell<DeadlineRow>;
  onClose: () => void;
  onToggle: (d: DeadlineRow) => void;
  busyId: string | null;
}) {
  return (
    <div className="mt-3 rounded-card border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="text-sm font-semibold text-foreground">{cell.items[0].dayLabel}</p>
        <button
          type="button"
          onClick={onClose}
          className="-m-2 p-2 text-sm font-medium text-text-secondary hover:text-foreground"
        >
          Close
        </button>
      </div>

      <ul className="divide-y divide-border">
        {cell.items.map((item) => {
          const struck = item.done || item.removed;
          const slot = courseColorIndex(item.courseName);
          return (
            <li
              key={item.id}
              className={`flex items-start gap-2 px-3 py-2.5 ${busyId === item.id ? 'opacity-50' : ''}`}
            >
              <label className="-m-3.5 flex cursor-pointer items-start p-3.5">
                <input
                  type="checkbox"
                  checked={item.done}
                  disabled={busyId === item.id || item.removed}
                  onChange={() => onToggle(item)}
                  aria-label={`Mark "${item.title}" ${item.done ? 'not done' : 'done'}`}
                  className="h-4 w-4 rounded border-border"
                />
              </label>

              <div className="min-w-0 flex-1">
                {item.url && !item.removed ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className={`block py-0.5 text-sm font-medium text-foreground hover:text-brand-accent hover:underline ${struck ? 'line-through' : ''}`}
                  >
                    {item.title}
                  </a>
                ) : (
                  <p className={`py-0.5 text-sm font-medium text-foreground ${struck ? 'line-through' : ''}`}>
                    {item.title}
                  </p>
                )}
                <span
                  className="mt-1 inline-block rounded-pill px-1.5 py-0.5 text-xs font-medium"
                  style={{
                    background: `var(--course-${slot}-bg)`,
                    color: `var(--course-${slot}-accent)`,
                  }}
                >
                  {item.courseLabel}
                </span>
                {item.removed && <p className="mt-1 text-xs text-danger">Removed by your instructor</p>}
              </div>

              {item.timeLabel && (
                <div className="shrink-0 pt-0.5 text-sm text-text-secondary">{item.timeLabel}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * One deadline in a day square, in its course's colour, the same slot that
 * course gets in the schedule grid. Clicking it ticks it off, which is the
 * only action a square this small has room for; the list is where the link
 * and the detail live.
 */
function Chip({
  item,
  onToggle,
  busy,
}: {
  item: DeadlineRow;
  onToggle: (d: DeadlineRow) => void;
  busy: boolean;
}) {
  const slot = courseColorIndex(item.courseName);
  const dim = item.done || item.removed;
  return (
    <button
      type="button"
      onClick={() => !item.removed && onToggle(item)}
      disabled={busy || item.removed}
      title={`${item.courseLabel}: ${item.title}${item.timeLabel ? ` at ${item.timeLabel}` : ''}`}
      aria-label={`${item.done ? 'Mark not done' : 'Mark done'}: ${item.title}`}
      className={`block w-full truncate rounded-input px-1 py-0.5 text-left text-xs leading-tight transition
        ${dim ? 'opacity-45 line-through' : 'hover:brightness-95'}
        ${busy ? 'opacity-60' : ''}`}
      style={{
        background: `var(--course-${slot}-bg)`,
        color: `var(--course-${slot}-accent)`,
      }}
    >
      {item.done && <span aria-hidden>{'✓ '}</span>}
      {item.title}
    </button>
  );
}

/** The phone-width stand-in for a chip: presence and course, nothing else.
 *  Not a button itself; the square around it is. */
function Dot({ item }: { item: DeadlineRow }) {
  const slot = courseColorIndex(item.courseName);
  return (
    <span
      className={`h-2 w-2 rounded-full ${item.done || item.removed ? 'opacity-30' : ''}`}
      style={{ background: `var(--course-${slot}-accent)` }}
    />
  );
}
