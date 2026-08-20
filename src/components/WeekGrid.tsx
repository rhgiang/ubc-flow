import { findConflicts, type ScheduleEntry } from '@/schedule/conflicts';

export type WeekGridEntry = ScheduleEntry & { id: string; location?: string | null };

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
const HOUR_PX = 48;
// Always visible so the grid is a stable reference frame while searching and
// adding sections, not just whatever the current selection happens to span.
const BASE_START_HOUR = 7;
const BASE_END_HOUR = 17;

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

/**
 * Weekly Mon-Fri timetable. Rows always span at least 7 AM-5 PM as a stable
 * baseline, expanding beyond it only when a real meeting falls outside that
 * range — never clipping data to fit. A conflicting block is still rendered —
 * flagged with a red border and an explanatory title, never hidden
 * (conflicts are advisory only).
 */
export default function WeekGrid({ entries }: { entries: WeekGridEntry[] }) {
  const timed = entries.filter(
    (e): e is WeekGridEntry & { startTime: string; endTime: string } =>
      (DAYS as readonly string[]).includes(e.day) && e.startTime !== null && e.endTime !== null,
  );
  const timedSet = new Set<WeekGridEntry>(timed);
  const untimed = entries.filter((e) => !timedSet.has(e));

  // findConflicts returns pairs referencing the same objects passed in, so we
  // can key off object identity to know which blocks to flag.
  const conflictsByEntry = new Map<ScheduleEntry, string[]>();
  for (const { a, b } of findConflicts(timed)) {
    conflictsByEntry.set(a, [...(conflictsByEntry.get(a) ?? []), b.label]);
    conflictsByEntry.set(b, [...(conflictsByEntry.get(b) ?? []), a.label]);
  }

  const starts = timed.map((e) => toMinutes(e.startTime));
  const ends = timed.map((e) => toMinutes(e.endTime));
  const minHour = Math.min(BASE_START_HOUR, ...(starts.length ? [Math.floor(Math.min(...starts) / 60)] : []));
  const maxHour = Math.max(BASE_END_HOUR, ...(ends.length ? [Math.ceil(Math.max(...ends) / 60)] : []));
  const hours = Array.from({ length: maxHour - minHour }, (_, i) => minHour + i);
  const gridStartMin = minHour * 60;
  const totalHeight = hours.length * HOUR_PX;

  return (
    <div className="overflow-x-auto">
      <div className="flex border-t border-l" style={{ minWidth: 640 }}>
        <div className="w-14 shrink-0">
          <div className="h-8 border-r border-b" />
          {hours.map((h) => (
            <div
              key={h}
              className="border-r border-b pr-1 text-right text-xs text-slate-500"
              style={{ height: HOUR_PX }}
            >
              {formatHour(h)}
            </div>
          ))}
        </div>

        {DAYS.map((day) => (
          <div key={day} className="min-w-[110px] flex-1">
            <div className="flex h-8 items-center justify-center border-r border-b text-sm font-medium">
              {day}
            </div>
            <div className="relative border-r" style={{ height: totalHeight }}>
              {hours.map((h) => (
                <div key={h} className="border-b" style={{ height: HOUR_PX }} />
              ))}
              {timed
                .filter((e) => e.day === day)
                .map((e) => {
                  const top = ((toMinutes(e.startTime) - gridStartMin) / 60) * HOUR_PX;
                  const height = ((toMinutes(e.endTime) - toMinutes(e.startTime)) / 60) * HOUR_PX;
                  const conflictLabels = conflictsByEntry.get(e);
                  const conflicted = conflictLabels !== undefined;

                  return (
                    <div
                      key={e.id}
                      title={
                        conflicted
                          ? `Conflicts with ${conflictLabels.join(', ')}`
                          : `${e.label} · ${e.startTime}–${e.endTime}`
                      }
                      className={`absolute inset-x-0.5 overflow-hidden rounded border px-1 py-0.5 text-xs ${
                        conflicted
                          ? 'border-2 border-red-600 bg-red-50'
                          : 'border-blue-700 bg-blue-50'
                      }`}
                      style={{ top, height }}
                    >
                      <p className="truncate font-medium">{e.label}</p>
                      <p className="truncate text-slate-600">
                        {e.startTime}–{e.endTime}
                      </p>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>

      {untimed.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          Not shown above (no fixed day/time): {untimed.map((e) => e.label).join(', ')}
        </p>
      )}
    </div>
  );
}
