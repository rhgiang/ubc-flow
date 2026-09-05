'use client';

import { useEffect, useRef, useState } from 'react';
import { findConflicts, type ScheduleEntry } from '@/schedule/conflicts';
import { courseColorIndex } from '@/schedule/colors';
import { layoutDayColumns } from '@/schedule/layout';

export type CalendarEntry = ScheduleEntry & {
  id: string;
  location?: string | null;
  /** Blank on most lab/tutorial rows — Workday only names the lecture's. */
  instructor?: string | null;
  /** Colour is keyed on this when present, else on `label`. */
  courseCode?: string | null;
  /** Set when the block should be clickable to open the course overlay. */
  courseId?: string | null;
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
// Sized off the tightest real block: a 1-hour meeting has to hold four lines
// — code, time, room, instructor — without the text filling it wall to wall.
const HOUR_PX = 76;
// The grid always covers the whole day and scrolls, the way Workday's and
// Google's do — rather than resizing itself to whatever the current selection
// happens to span, which made the rows jump whenever a section was added.
const HOURS = Array.from({ length: 24 }, (_, i) => i);
// Opening scroll position. A day's classes live roughly 8 AM-5 PM, so the
// grid opens there; the small hours stay one scroll away rather than eating
// the viewport.
const OPENING_HOUR = 8;
// Tall enough to show ~9 hours at once, capped so several stacked calendars
// on /schedule stay navigable.
const VIEWPORT_MAX_PX = 680;

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
  onSwap,
  showNowIndicator = false,
  onSelectCourse,
}: {
  entries: CalendarEntry[];
  onRemove?: (sectionId: string) => void;
  onSwap?: (sectionId: string) => void;
  /** Only true when viewing the term that contains today (spec §current-time
   *  indicator). Also gates the 60s clock timer so calendars for terms that
   *  haven't started don't run a redundant interval. */
  showNowIndicator?: boolean;
  onSelectCourse?: (courseId: string) => void;
}) {
  // Both the indicator position AND which column counts as "today" are
  // resolved only after mount. The server's clock and timezone need not match
  // the viewer's, so deriving either during render would hydrate-mismatch —
  // including the day-header highlight, which is easy to overlook.
  const scrollRef = useRef<HTMLDivElement>(null);
  // Open on the earliest class rather than on midnight, so a term that starts
  // at 8 or at 13:00 is on screen without scrolling either way; 8 AM is the
  // fallback when nothing is timed. The offset keeps that first hour label
  // clear of the sticky header instead of half-tucked under it.
  const starts = entries.filter((e) => e.startTime).map((e) => toMinutes(e.startTime!));
  const earliestStart = starts.length ? Math.min(...starts) : OPENING_HOUR * 60;
  // Keyed on the earliest start, not on `entries`: re-anchoring every time a
  // section is added would yank the builder's view out from under the user,
  // but a class earlier than anything else is worth scrolling up to reveal.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = Math.max(0, (earliestStart / 60) * HOUR_PX - 12);
    }
  }, [earliestStart]);

  // Fit-the-week by default: a phone showing three and a half days makes the
  // student swipe to answer "am I free Thursday", which is the question the
  // calendar exists for. Expanded restores the readable-detail width and
  // scrolls, for when they want the room and the section code.
  const [expanded, setExpanded] = useState(false);

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

  // One entry per course, in the order they first appear in the week.
  const legend = [
    ...new Map(
      timed.map((e) => {
        const label = e.courseCode ?? e.label;
        return [label, { label, slot: courseColorIndex(label) }] as const;
      }),
    ).values(),
  ];

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

      {/* Phones only: the desktop grid is already wide enough to read. The
          legend shares this row so the key sits above the calendar rather than
          below 680px of it. */}
      <div className="mb-2 flex items-start justify-between gap-3 sm:hidden">
        {!expanded && legend.length > 0 ? (
          <ul className="flex flex-1 flex-wrap gap-x-3 gap-y-1">
            {legend.map((c) => (
              <li
                key={c.label}
                className="flex items-center gap-1.5 text-[11px] text-text-secondary"
              >
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: `var(--course-${c.slot}-accent)` }}
                />
                {c.label}
              </li>
            ))}
          </ul>
        ) : (
          <span className="flex-1" />
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-pressed={expanded}
          className="flex items-center gap-1.5 rounded-pill border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-muted active:bg-surface-muted"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden className="h-3.5 w-3.5">
            {expanded ? (
              <path d="M9 4v5H4M15 20v-5h5M4 15h5v5M20 9h-5V4" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
          {expanded ? 'Fit week' : 'Zoom in'}
        </button>
      </div>

      <div
        ref={scrollRef}
        className="overflow-auto rounded-card border border-border"
        style={{ maxHeight: VIEWPORT_MAX_PX }}
      >
        <div className={`flex sm:min-w-[680px] ${expanded ? 'min-w-[560px]' : 'min-w-0'}`}>
          <div className={`shrink-0 sm:w-16 ${expanded ? 'w-10' : 'w-7'}`}>
            <div className="sticky top-0 z-20 h-9 border-b border-border bg-background" />
            {HOURS.map((h) => (
              <div
                key={h}
                className="relative pr-2 text-right"
                style={{ height: HOUR_PX }}
              >
                {/* The topmost label would straddle the container edge and clip,
                    so it is omitted — the same thing Google Calendar does. */}
                {h !== 0 && (
                  <span
                    className={`absolute -top-2 text-text-tertiary ${
                      expanded ? 'right-2 text-[11px]' : 'right-1 text-[10px] sm:right-2 sm:text-[11px]'
                    }`}
                  >
                    {/* A 28px gutter has no room for "9 AM"; the bare hour is
                        unambiguous next to a grid of them. */}
                    <span className={expanded ? '' : 'sm:hidden'}>
                      {expanded ? formatHour(h) : h % 12 === 0 ? 12 : h % 12}
                    </span>
                    {!expanded && <span className="hidden sm:inline">{formatHour(h)}</span>}
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
                <span className={expanded ? '' : 'sm:hidden'}>
                  {expanded ? day : day.charAt(0)}
                </span>
                {!expanded && <span className="hidden sm:inline">{day}</span>}
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
                            : `${e.label} · ${e.startTime}–${e.endTime}${
                                e.instructor ? ` · ${e.instructor}` : ''
                              }`
                        }
                        className={`group absolute overflow-hidden rounded-md py-1.5 leading-tight ${
                          expanded ? 'pl-2 pr-1 text-[11px]' : 'pl-1 pr-0 text-[9px] sm:pl-2 sm:pr-1 sm:text-[11px]'
                        } ${
                          conflictLabels ? 'ring-1 ring-danger-border' : ''
                        } ${onSelectCourse && e.courseId ? 'cursor-pointer' : ''}`}
                        style={{
                          top,
                          height,
                          left: `calc(${column * widthPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          background: `var(--course-${slot}-bg)`,
                          boxShadow: `inset 3px 0 0 0 var(--course-${slot}-accent)`,
                        }}
                        onClick={
                          onSelectCourse && e.courseId
                            ? () => onSelectCourse(e.courseId!)
                            : undefined
                        }
                        role={onSelectCourse && e.courseId ? 'button' : undefined}
                        tabIndex={onSelectCourse && e.courseId ? 0 : undefined}
                        onKeyDown={
                          onSelectCourse && e.courseId
                            ? (ev) => {
                                // Only when the BLOCK itself is focused — a keydown
                                // bubbling up from the nested remove button must not
                                // also open the overlay (click and keydown are
                                // independent events, so the button's onClick
                                // stopPropagation does not cover this path).
                                if (ev.target !== ev.currentTarget) return;
                                if (ev.key === 'Enter' || ev.key === ' ') {
                                  ev.preventDefault();
                                  onSelectCourse(e.courseId!);
                                }
                              }
                            : undefined
                        }
                      >
                        {onSwap && (
                          <button
                            type="button"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              onSwap(e.sectionId);
                            }}
                            aria-label={`Swap ${e.label}`}
                            title="Swap section"
                            className="pointer-events-none absolute right-6 top-0.5 rounded px-1 text-text-secondary opacity-0 transition-opacity hover:text-foreground group-hover:pointer-events-auto group-hover:opacity-100 focus:pointer-events-auto group-focus-within:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100"
                          >
                            ⇄
                          </button>
                        )}
                        {onRemove && (
                          <button
                            type="button"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              onRemove(e.sectionId);
                            }}
                            aria-label={`Remove ${e.label}`}
                            className="pointer-events-none absolute right-0.5 top-0.5 rounded px-1 text-text-secondary opacity-0 transition-opacity hover:text-foreground group-hover:pointer-events-auto group-hover:opacity-100 focus:pointer-events-auto group-focus-within:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100"
                          >
                            ×
                          </button>
                        )}
                        {/* Fitted columns are ~60px wide: the full
                            "CPSC_V 110-101" wraps to three broken lines, while
                            the course code alone reads at a glance. Tapping the
                            block still opens everything. */}
                        {/* Nothing readable fits a fitted column once two
                            courses share an hour, so the fitted view drops the
                            text and lets colour carry it - decoded by the
                            legend under the grid, or by tapping the block. */}
                        <p
                          className={`truncate font-medium text-foreground ${
                            expanded ? '' : 'max-sm:hidden'
                          }`}
                        >
                          {e.label}
                        </p>
                        {/* Two courses at the same hour split a fitted column
                            in half, leaving ~25px - not enough for a time as
                            well as a name. The block's position already says
                            when; the label says what. */}
                        <p
                          className={`truncate text-text-secondary ${
                            expanded ? '' : 'max-sm:hidden'
                          }`}
                        >
                          {e.startTime}–{e.endTime}
                        </p>
                        {e.location && (
                          <p
                            className={`truncate text-text-tertiary ${
                              expanded ? '' : 'max-sm:hidden'
                            }`}
                          >
                            {e.location}
                          </p>
                        )}
                        {e.instructor && (
                          <p className="truncate text-text-tertiary max-sm:hidden">{e.instructor}</p>
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
