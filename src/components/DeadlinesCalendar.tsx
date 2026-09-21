'use client';

import { buildMonths } from '@/canvas/calendar';
import { courseColorIndex } from '@/schedule/colors';
import type { DeadlineRow } from '@/components/DeadlinesList';

/** Sunday first, matching the grid buildMonths produces. */
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

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
  const months = buildMonths(deadlines);

  if (months.length === 0) {
    return <p className="text-sm text-text-secondary">Nothing to put on a calendar yet.</p>;
  }

  return (
    <div className="space-y-8">
      {months.map((month) => (
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

            {month.cells.map((cell) => {
              const isToday = cell.key === todayKey;
              return (
                <div
                  key={cell.key}
                  className={`min-h-14 bg-surface p-1 align-top sm:min-h-20 ${cell.day === null ? 'opacity-40' : ''}`}
                >
                  {cell.day !== null && (
                    <div
                      className={
                        isToday
                          ? 'mb-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-accent text-xs font-semibold text-brand-foreground'
                          : 'mb-1 inline-block px-1 text-xs text-text-tertiary'
                      }
                    >
                      {cell.day}
                    </div>
                  )}

                  {/* A seven column grid cannot hold a readable title at
                      phone width: every chip truncated to "Wri...". Phones get
                      a dot per deadline, which is what a month view is for
                      anyway, and the list view is where you read and tick
                      things off. */}
                  <div className="flex flex-wrap gap-1 sm:hidden">
                    {cell.items.map((item) => (
                      <Dot key={item.id} item={item} />
                    ))}
                  </div>

                  <div className="hidden space-y-1 sm:block">
                    {cell.items.map((item) => (
                      <Chip key={item.id} item={item} onToggle={onToggle} busy={busyId === item.id} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
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

/** The phone-width stand-in for a chip: presence and course, nothing else. */
function Dot({ item }: { item: DeadlineRow }) {
  const slot = courseColorIndex(item.courseName);
  return (
    <span
      title={`${item.courseLabel}: ${item.title}`}
      className={`h-2 w-2 rounded-full ${item.done || item.removed ? 'opacity-30' : ''}`}
      style={{ background: `var(--course-${slot}-accent)` }}
    />
  );
}
