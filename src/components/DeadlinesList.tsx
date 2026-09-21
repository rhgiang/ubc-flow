'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  setDeadlineDone,
  setRemindersEnabled,
  updateReminderPreferences,
} from '@/app/actions/canvas';
import { courseColorIndex } from '@/schedule/colors';
import CanvasConnect from '@/components/CanvasConnect';
import DeadlinesCalendar from '@/components/DeadlinesCalendar';

// Labels for src/canvas/prefs.ts's LEAD_CHOICES ([24, 48, 72, 168]). The
// values themselves come in as a prop rather than an import: prefs.ts also
// exports a db-touching function, and this is a client component.
const LEAD_LABELS: Record<number, string> = { 24: '1 day', 48: '2 days', 72: '3 days', 168: '1 week' };

export type DeadlineRow = {
  id: string;
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

type View = 'list' | 'calendar';

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
  todayKey: string;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>('list');
  const [hideDone, setHideDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Ticking a box must feel instant, so the row flips here and the server
  // catches up. router.refresh() then replaces this with the truth; on a
  // failure the override is dropped and the real value comes back.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const rows = deadlines.map((d) => (d.id in optimistic ? { ...d, done: optimistic[d.id] } : d));

  async function toggleDone(item: DeadlineRow) {
    const next = !item.done;
    setOptimistic((o) => ({ ...o, [item.id]: next }));
    setBusyId(item.id);
    setError(null);
    const r = await setDeadlineDone(item.id, next);
    setBusyId(null);
    if (!r.ok) {
      // Drop the override so the row snaps back to what the server has.
      setOptimistic((o) => {
        const rest = { ...o };
        delete rest[item.id];
        return rest;
      });
      return setError(r.error);
    }
    startTransition(() => router.refresh());
  }

  async function toggleEnabled() {
    setBusy(true);
    setError(null);
    const r = await setRemindersEnabled(!enabled);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  async function savePrefs(next: { leadHours: number[]; mutedCourses: string[] }) {
    setBusy(true);
    setError(null);
    const r = await updateReminderPreferences(next);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
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
    <div className={`mx-auto w-full space-y-5 ${view === 'calendar' ? 'max-w-5xl' : 'max-w-2xl'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-foreground">Deadlines</h1>
        <div className="flex items-center gap-3">
          {doneCount > 0 && (
            <label className="flex items-center gap-1.5 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={hideDone}
                onChange={() => setHideDone((v) => !v)}
                className="h-4 w-4 rounded border-border"
              />
              Hide done
            </label>
          )}
          <div className="flex rounded-pill border border-border p-0.5" role="tablist">
            {(['list', 'calendar'] as const).map((v) => (
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">
          {openCount === 0 ? 'Nothing outstanding.' : `${openCount} to go`}
          {doneCount > 0 && <span className="text-text-tertiary">{` · ${doneCount} done`}</span>}
        </p>
      </div>

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
        <p className="text-sm text-text-secondary">
          Nothing due yet. New deadlines show up here once Canvas has them.
        </p>
      ) : view === 'calendar' ? (
        <DeadlinesCalendar deadlines={visible} todayKey={todayKey} onToggle={toggleDone} busyId={busyId} />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.key}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
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
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Settings live below the work and closed by default. They are read
          once and then never again, and they used to sit above the list and
          push the actual deadlines off the first screen. */}
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
    </div>
  );
}

/**
 * The course badge, in the colour that course carries everywhere else. The
 * colour is hashed from the raw name, not the shortened one, so two courses
 * that shorten alike still differ and a course keeps its colour if the
 * shortening rules ever change.
 */
function CoursePill({ name, label }: { name: string; label: string }) {
  const slot = courseColorIndex(name);
  return (
    <span
      className="inline-block shrink-0 rounded-pill px-1.5 py-0.5 text-xs font-medium"
      style={{ background: `var(--course-${slot}-bg)`, color: `var(--course-${slot}-accent)` }}
    >
      {label}
    </span>
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
}: {
  item: DeadlineRow;
  muted: boolean;
  busy: boolean;
  onToggle: (d: DeadlineRow) => void;
}) {
  const struck = item.done || item.removed;
  return (
    <li className={`flex items-start gap-3 px-3 py-2.5 ${muted ? 'opacity-60' : ''} ${busy ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        checked={item.done}
        disabled={busy || item.removed}
        onChange={() => onToggle(item)}
        aria-label={`Mark "${item.title}" ${item.done ? 'not done' : 'done'}`}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-border"
      />

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
          <CoursePill name={item.courseName} label={item.courseLabel} />
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
