'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { setRemindersEnabled, updateReminderPreferences } from '@/app/actions/canvas';
import { formatVancouver } from '@/canvas/tz';
import CanvasConnect from '@/components/CanvasConnect';

// Labels for src/canvas/prefs.ts's LEAD_CHOICES ([24, 48, 72, 168]). The
// values themselves come in as a prop rather than an import: prefs.ts also
// exports a db-touching function, and this is a client component.
const LEAD_LABELS: Record<number, string> = { 24: '1 day', 48: '2 days', 72: '3 days', 168: '1 week' };

export type DeadlineRow = {
  id: string;
  title: string;
  courseName: string;
  dueAt: string;
  allDay: boolean;
  url: string | null;
  /** True only when removedAt is set and within the last 14 days: the page
   *  never sends an older removed row at all. */
  removed: boolean;
  /** The old due date, ISO, only when the move happened in the last 14 days. */
  movedFrom: string | null;
};

function DeadlineCard({ item, muted }: { item: DeadlineRow; muted: boolean }) {
  const due = formatVancouver(new Date(item.dueAt), item.allDay);
  return (
    <li
      className={`rounded-card border border-border bg-surface p-4 ${muted ? 'opacity-50' : ''}`}
    >
      <div className={item.removed ? 'line-through decoration-2' : ''}>
        <div className="flex items-start justify-between gap-2">
          <span className="font-medium text-foreground">{item.courseName}</span>
          <span className="text-sm text-text-secondary">{due}</span>
        </div>
        <p className="mt-1 text-sm text-text-secondary">{item.title}</p>
      </div>
      {item.movedFrom && (
        <p className="mt-1 text-xs text-text-tertiary">
          Moved from {formatVancouver(new Date(item.movedFrom), item.allDay)}
        </p>
      )}
      {item.removed && <p className="mt-1 text-xs text-danger">Removed by your instructor</p>}
      {item.url && !item.removed && (
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-sm text-brand-accent hover:underline"
        >
          Open in Canvas
        </a>
      )}
    </li>
  );
}

export default function DeadlinesList({
  connectedAt,
  lastFetchedAt,
  broken,
  enabled,
  leadHours,
  mutedCourses,
  leadChoices,
  deadlines,
}: {
  connectedAt: string | null;
  lastFetchedAt: string | null;
  broken: boolean;
  enabled: boolean;
  leadHours: number[];
  mutedCourses: string[];
  leadChoices: readonly number[];
  deadlines: DeadlineRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const courseNames = [...new Set(deadlines.map((d) => d.courseName))].sort();

  // Deadlines already arrive soonest first, so a run of the same Vancouver
  // day stays contiguous: one pass groups them without a re-sort.
  const groups: { key: string; items: DeadlineRow[] }[] = [];
  for (const d of deadlines) {
    const key = formatVancouver(new Date(d.dueAt), true);
    const current = groups[groups.length - 1];
    if (current && current.key === key) current.items.push(d);
    else groups.push({ key, items: [d] });
  }

  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-card border border-border bg-surface p-4">
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
                <div className="mt-2 flex flex-wrap gap-3">
                  {courseNames.map((c) => (
                    <label key={c} className="flex items-center gap-1.5 text-sm text-text-secondary">
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
                      {c}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </section>

      <section className="rounded-card border border-border bg-surface p-4">
        <h2 className="text-sm font-semibold text-foreground">Your Canvas connection</h2>
        <div className="mt-2">
          <CanvasConnect connectedAt={connectedAt} lastFetchedAt={lastFetchedAt} broken={broken} />
        </div>
      </section>

      {deadlines.length === 0 ? (
        <p className="text-sm text-text-secondary">
          Nothing due yet. New deadlines show up here once Canvas has them.
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.key}>
              <h3 className="text-sm font-semibold text-text-secondary">{g.key}</h3>
              <ul className="mt-2 space-y-2">
                {g.items.map((d) => (
                  <DeadlineCard key={d.id} item={d} muted={mutedCourses.includes(d.courseName)} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
