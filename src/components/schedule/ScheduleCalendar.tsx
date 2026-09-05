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
  /** Raw building code and room, for the campus map — `location` above is the
   *  same data pre-joined for display, which a map can't take apart again. */
  building?: string | null;
  room?: string | null;
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
// The row height lives in CSS as --hour (see .cal-rows in globals.css) so
// phones can shorten it without this component knowing the viewport.
//
// The fallback is not decoration. Every row height and block position below is
// a multiple of --hour, so if the variable is ever missing — a stale cached
// stylesheet against fresh JS is how that happens — calc() turns invalid, the
// heights resolve to auto, and the grid collapses to a strip showing no classes
// at all. Missing has to degrade to the desktop hour, never to zero.
const hours = (n: number) => `calc(var(--hour, 76px) * ${n})`;
// The desktop value, duplicated here only for the opening scroll offset, which
// has to be a number. Read back off the DOM so a phone scrolls to the right
// place too.
const HOUR_PX_FALLBACK = 76;
// The grid always covers the whole day and scrolls, the way Workday's and
// Google's do — rather than resizing itself to whatever the current selection
// happens to span, which made the rows jump whenever a section was added.
const HOURS = Array.from({ length: 24 }, (_, i) => i);
// Opening scroll position. A day's classes live roughly 8 AM-5 PM, so the
// grid opens there; the small hours stay one scroll away rather than eating
// the viewport.
const OPENING_HOUR = 8;
// The 680px viewport cap (max-h-[680px] on the scroll box) shows ~9 hours at
// once, so several stacked calendars on /schedule stay navigable; `fill` mode
// lifts it where the calendar owns the page.

/**
 * "CPSC 110" -> "110".
 *
 * For a fitted column split between two overlapping classes, where the subject
 * no longer fits. The number is the more distinguishing half anyway: a term
 * with CPSC 110 and CPSC 121 in it shares the subject but never the number.
 */
export function courseNumberOnly(code: string): string {
  const parts = code.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : code;
}

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
  fill = false,
}: {
  entries: CalendarEntry[];
  onRemove?: (sectionId: string) => void;
  onSwap?: (sectionId: string) => void;
  /** Only true when viewing the term that contains today (spec §current-time
   *  indicator). Also gates the 60s clock timer so calendars for terms that
   *  haven't started don't run a redundant interval. */
  showNowIndicator?: boolean;
  onSelectCourse?: (courseId: string) => void;
  /** Take the full height of a flex column instead of capping at 680px — for
   *  the builder, where the calendar IS the page and a fixed cap left a dead
   *  band under the grid on tall monitors. Stacked contexts (the /schedule
   *  tabs, shared pages) keep the cap so five calendars stay navigable. */
  fill?: boolean;
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

  // Fit-the-week by default: a phone showing three and a half days makes the
  // student swipe to answer "am I free Thursday", which is the question the
  // calendar exists for. Expanded restores the readable-detail width and
  // scrolls, for when they want the room and the section code.
  // Declared above the scroll effect below, which depends on it.
  const [expanded, setExpanded] = useState(false);

  // Keyed on the earliest start, not on `entries`: re-anchoring every time a
  // section is added would yank the builder's view out from under the user,
  // but a class earlier than anything else is worth scrolling up to reveal.
  // Re-runs on `expanded` because zooming changes --hour under the same scroll
  // position, which would otherwise land the view on a different hour.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // --hour is whatever the media query settled on, which is the only place
    // that knows whether this is a phone.
    const hourPx =
      parseFloat(getComputedStyle(el).getPropertyValue('--hour')) || HOUR_PX_FALLBACK;
    el.scrollTop = Math.max(0, (earliestStart / 60) * hourPx - 12);
  }, [earliestStart, expanded]);

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

  // Hoisted out of the render so the legend can ask whether any day splits a
  // column before deciding to occupy space above the grid.
  const columnsByDay = new Map(
    DAYS.map((day) => [
      day,
      layoutDayColumns(
        timed.filter((e) => e.day === day),
        (e) => ({ start: toMinutes(e.startTime), end: toMinutes(e.endTime) }),
      ),
    ]),
  );
  // A split column is too narrow for the subject, so those blocks fall back to
  // the bare course number and the legend is what decodes them. With no splits
  // every block names its own course and the legend is a second copy of the
  // grid, charging vertical space on the screen with least to spare.
  const hasSplitColumn = [...columnsByDay.values()].some((day) =>
    [...day.values()].some((c) => c.columns > 1),
  );

  const totalHeight = hours(HOURS.length);
  // The grid starts at midnight, so a time's offset is just its own minutes.
  const nowTop = nowMin !== null ? hours(nowMin / 60) : null;

  return (
    <div className={fill ? 'flex min-h-0 flex-1 flex-col' : ''}>
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
      <div className="mb-1.5 flex items-start justify-between gap-3 sm:hidden">
        {!expanded && hasSplitColumn && legend.length > 0 ? (
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
          // Tight because this sits on its own row above every calendar, and
          // /schedule stacks one per term. Still a 32px-tall tap target.
          className="flex items-center gap-1.5 rounded-pill border border-border px-2.5 py-1 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-muted active:bg-surface-muted"
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
        // cal-rows carries --hour, the row height every position below is a
        // multiple of; cal-rows-zoom opts a zoomed phone back out of the
        // shorter mobile hour. See globals.css.
        className={`cal-rows overflow-auto rounded-card border border-border ${
          expanded ? 'cal-rows-zoom' : ''
        } ${
          // Phones keep the cap even in fill mode: the un-pinned mobile
          // builder scrolls as a page, so an uncapped grid would be 1800px
          // of calendar between the header and the course list.
          //
          // 460px on a phone, not 680: at the shorter mobile hour that is
          // still about 8 hours, a whole class day, and /schedule stacks a
          // calendar per term — two 680px grids is most of a phone screen
          // spent scrolling past one term to reach the next.
          fill
            ? 'max-h-[460px] sm:max-h-[680px] lg:max-h-none lg:min-h-0 lg:flex-1'
            : 'max-h-[460px] sm:max-h-[680px]'
        }`}
      >
        <div className={`flex sm:min-w-[680px] ${expanded ? 'min-w-[560px]' : 'min-w-0'}`}>
          <div className={`shrink-0 sm:w-16 ${expanded ? 'w-10' : 'w-6'}`}>
            <div className="sticky top-0 z-20 h-9 border-b border-border bg-background" />
            {HOURS.map((h) => (
              <div
                key={h}
                className="relative pr-2 text-right"
                style={{ height: 'var(--hour, 76px)' }}
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
                    style={{ height: 'var(--hour, 76px)' }}
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
                  const columns = columnsByDay.get(day)!;

                  return dayEntries.map((e) => {
                    const top = hours(toMinutes(e.startTime) / 60);
                    const durationMin = toMinutes(e.endTime) - toMinutes(e.startTime);
                    const height = hours(durationMin / 60);
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
                        // Tighter padding and leading on phones buy the third
                        // line. Three lines at leading-tight in py-1.5 need
                        // 47px, which does not fit the 44px of a one-hour
                        // class — the most common block on the grid, and the
                        // one whose room was therefore never shown.
                        className={`group absolute overflow-hidden rounded-md py-1 leading-[1.15] sm:py-1.5 sm:leading-tight ${
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
                        {/* A fitted phone column is ~60px: the section code,
                            time and room don't fit, but "CPSC 110" does, and a
                            block with no text at all leaves the calendar's one
                            question — which class is this — to a legend above
                            the grid. Split columns fall back to the number
                            alone. Tapping still opens everything. */}
                        {!expanded && (
                          <>
                            <p
                              // The remove and swap buttons sit in the top-right
                              // and stay visible on touch, so the text has to be
                              // kept out from under them.
                              className={`truncate text-[10px] font-medium text-foreground sm:hidden ${
                                onRemove ? (onSwap ? 'pr-10' : 'pr-4') : ''
                              }`}
                            >
                              {colCount === 1 || !e.courseCode
                                ? e.courseCode ?? e.label
                                : courseNumberOnly(e.courseCode)}
                            </p>
                            {/* Start only, and only on a block tall enough to
                                hold a second line: the end is readable off the
                                block's own bottom edge, and a 30-minute block
                                has room for the course or the time, not both. */}
                            {colCount === 1 && durationMin >= 50 && (
                              <p className="truncate text-[9px] text-text-secondary sm:hidden">
                                {e.startTime}
                              </p>
                            )}
                            {/* Where to actually go. From one hour up, which
                                is where the third line fits once the padding
                                and leading are tightened above — and a full
                                hour is the commonest block on the grid, so
                                gating any higher hid the room on most of a
                                week's classes. */}
                            {colCount === 1 && durationMin >= 60 && e.location && (
                              <p className="truncate text-[9px] text-text-tertiary sm:hidden">
                                {e.location}
                              </p>
                            )}
                          </>
                        )}
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
