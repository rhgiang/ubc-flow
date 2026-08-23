'use client';

import { useEffect, useRef, useState } from 'react';
import { findConflicts, type ScheduleEntry } from '@/schedule/conflicts';
import { courseColorIndex } from '@/schedule/colors';
import { layoutDayColumns } from '@/schedule/layout';

export type CalendarEntry = ScheduleEntry & {
  id: string;
  location?: string | null;
  /** Colour is keyed on this when present, else on `label`. */
  courseCode?: string | null;
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
const HOUR_PX = 56;
// The grid always covers the whole day and scrolls, the way Workday's and
// Google's do — rather than resizing itself to whatever the current selection
// happens to span, which made the rows jump whenever a section was added.
const HOURS = Array.from({ length: 24 }, (_, i) => i);
// Opening scroll position. A day's classes live roughly 8 AM-5 PM, so the
// grid opens there; the small hours stay one scroll away rather than eating
// the viewport.
const OPENING_HOUR = 8;
// Tall enough to show ~8 AM-6 PM at once, capped so several stacked calendars
// on /schedule stay navigable.
const VIEWPORT_MAX_PX = 600;

/** "14:30" -> 870. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function formatHour(h: number): string {
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${period}`;
}

/** Minutes since midnight, or null when today is not a weekday we render. */
function nowMinutesOnWeekday(): number | null {
  const now = new Date();
  const day = now.getDay(); // 0 = Sun
  if (day < 1 || day > 5) return null;
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Weekly Mon-Fri calendar, styled after Notion Calendar: hairline grid, soft
 * per-course pastel blocks with a saturated left accent bar, and a
 * current-time indicator.
 *
 * The grid renders all 24 hours and scrolls, opening at 8 AM — so no meeting
 * can ever be out of reach, and the rows stay a fixed reference frame instead
 * of resizing as sections are added. Day headers stick to the top while the
 * hours scroll under them.
 *
 * A conflicting block is still rendered, flagged with a danger ring, never
 * hidden: conflicts are advisory (UBC's meeting data can't always prove one
 * is real).
 */
export default function ScheduleCalendar({
  entries,
  onRemove,
  showNowIndicator = false,
}: {
  entries: CalendarEntry[];
  onRemove?: (sectionId: string) => void;
  /** Only true when viewing the term that contains today (spec §current-time
   *  indicator). Also gates the 60s clock timer so calendars for terms that
   *  haven't started don't run a redundant interval. */
  showNowIndicator?: boolean;
}) {
  // Both the indicator position AND which column counts as "today" are
  // resolved only after mount. The server's clock and timezone need not match
  // the viewer's, so deriving either during render would hydrate-mismatch —
  // including the day-header highlight, which is easy to overlook.
  const scrollRef = useRef<HTMLDivElement>(null);
  // Open on the working day rather than on midnight. The extra offset keeps the
  // 8 AM label clear of the sticky header instead of half-tucked under it.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = OPENING_HOUR * HOUR_PX - 12;
  }, []);

  const [now, setNow] = useState<{ minutes: number | null; dayIndex: number } | null>(null);
  useEffect(() => {
    if (!showNowIndicator) return;
    const read = () => setNow({ minutes: nowMinutesOnWeekday(), dayIndex: new Date().getDay() - 1 });
    read();
    const timer = setInterval(read, 60_000);
    return () => clearInterval(timer);
  }, [showNowIndicator]);
  const nowMin = showNowIndicator ? now?.minutes ?? null : null;
  // -1 until mounted, so no column is highlighted during SSR.
  const todayIndex = showNowIndicator ? now?.dayIndex ?? -1 : -1;

  const timed = entries.filter(
    (e): e is CalendarEntry & { startTime: string; endTime: string } =>
      (DAYS as readonly string[]).includes(e.day) && e.startTime !== null && e.endTime !== null,
  );
  const timedSet = new Set<CalendarEntry>(timed);
  const untimed = entries.filter((e) => !timedSet.has(e));

  // findConflicts returns pairs referencing the same objects passed in, so
  // object identity tells us which blocks to flag.
  const conflictsByEntry = new Map<ScheduleEntry, string[]>();
  for (const { a, b } of findConflicts(timed)) {
    conflictsByEntry.set(a, [...(conflictsByEntry.get(a) ?? []), b.label]);
    conflictsByEntry.set(b, [...(conflictsByEntry.get(b) ?? []), a.label]);
  }

  const totalHeight = HOURS.length * HOUR_PX;
  // The grid starts at midnight, so a time's offset is just its own minutes.
  const nowTop = nowMin !== null ? (nowMin / 60) * HOUR_PX : null;

  return (
    <div>
      {untimed.length > 0 && (
        <div className="mb-3 rounded-card border border-border bg-surface-muted px-3 py-2">
          <p className="text-xs font-medium text-foreground">No fixed meeting time</p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {untimed.map((e) => (
              <li key={e.id} className="flex items-center gap-1.5 text-xs text-text-secondary">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background: `var(--course-${courseColorIndex(e.courseCode ?? e.label)}-accent)`,
                  }}
                />
                {e.label}
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(e.sectionId)}
                    aria-label={`Remove ${e.label}`}
                    className="text-text-tertiary hover:text-foreground"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        ref={scrollRef}
        className="overflow-auto rounded-card border border-border"
        style={{ maxHeight: VIEWPORT_MAX_PX }}
      >
        <div className="flex min-w-[680px]">
          <div className="w-16 shrink-0">
            <div className="sticky top-0 z-20 h-9 border-b border-border bg-background" />
            {HOURS.map((h) => (
              <div
                key={h}
                className="relative border-b border-border-hairline pr-2 text-right"
                style={{ height: HOUR_PX }}
              >
                {/* The topmost label would straddle the container edge and clip,
                    so it is omitted — the same thing Google Calendar does. */}
                {h !== 0 && (
                  <span className="absolute -top-2 right-2 text-[11px] text-text-tertiary">
                    {formatHour(h)}
                  </span>
                )}
              </div>
            ))}
          </div>

          {DAYS.map((day, dayIndex) => (
            <div key={day} className="min-w-0 flex-1 border-l border-border-hairline">
              <div
                className={`sticky top-0 z-20 flex h-9 items-center justify-center border-b border-border bg-background text-xs font-medium ${
                  dayIndex === todayIndex ? 'text-brand-accent' : 'text-text-secondary'
                }`}
              >
                {day}
              </div>

              <div className="relative" style={{ height: totalHeight }}>
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="border-b border-border-hairline"
                    style={{ height: HOUR_PX }}
                  />
                ))}

                {nowTop !== null && dayIndex === todayIndex && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 z-10 border-t border-brand-accent"
                    style={{ top: nowTop }}
                  >
                    <span className="absolute -left-1 -top-1 block h-2 w-2 rounded-full bg-brand-accent" />
                  </div>
                )}

                {(() => {
                  const dayEntries = timed.filter((e) => e.day === day);
                  // Side-by-side columns for overlapping classes, as Google
                  // Calendar and Notion Calendar do — without this the lower
                  // block is completely hidden behind the upper one.
                  const columns = layoutDayColumns(dayEntries, (e) => ({
                    start: toMinutes(e.startTime),
                    end: toMinutes(e.endTime),
                  }));

                  return dayEntries.map((e) => {
                    const top = (toMinutes(e.startTime) / 60) * HOUR_PX;
                    const height =
                      ((toMinutes(e.endTime) - toMinutes(e.startTime)) / 60) * HOUR_PX;
                    const conflictLabels = conflictsByEntry.get(e);
                    const slot = courseColorIndex(e.courseCode ?? e.label);
                    const { column, columns: colCount } = columns.get(e) ?? {
                      column: 0,
                      columns: 1,
                    };
                    const widthPct = 100 / colCount;

                    return (
                      <div
                        key={e.id}
                        title={
                          conflictLabels
                            ? `Conflicts with ${conflictLabels.join(', ')}`
                            : `${e.label} · ${e.startTime}–${e.endTime}`
                        }
                        className={`group absolute overflow-hidden rounded-md pl-2 pr-1 py-1 text-[11px] leading-tight ${
                          conflictLabels ? 'ring-1 ring-danger-border' : ''
                        }`}
                        style={{
                          top,
                          height,
                          left: `calc(${column * widthPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          background: `var(--course-${slot}-bg)`,
                          boxShadow: `inset 3px 0 0 0 var(--course-${slot}-accent)`,
                        }}
                      >
                        {onRemove && (
                          <button
                            type="button"
                            onClick={() => onRemove(e.sectionId)}
                            aria-label={`Remove ${e.label}`}
                            className="pointer-events-none absolute right-0.5 top-0.5 rounded px-1 text-text-secondary opacity-0 transition-opacity hover:text-foreground group-hover:pointer-events-auto group-hover:opacity-100 focus:pointer-events-auto group-focus-within:opacity-100"
                          >
                            ×
                          </button>
                        )}
                        <p className="truncate font-medium text-foreground">{e.label}</p>
                        <p className="truncate text-text-secondary">
                          {e.startTime}–{e.endTime}
                        </p>
                        {e.location && (
                          <p className="truncate text-text-tertiary">{e.location}</p>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
