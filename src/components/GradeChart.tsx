import { GRADE_BUCKETS } from '@/grades/parse-csv';

const CHART_HEIGHT = 96; // px
// The tallest bar maps to this fraction of CHART_HEIGHT, not all of it — full
// height left the tallest bar flush against the container's rounded top
// corner, visually poking through it (most visible on the last column, right
// next to the corner's curve).
const MAX_BAR_FRACTION = 0.88;
const SUPPRESSED_STUB_HEIGHT = 10; // px — enough to read as "withheld", not "zero"

/**
 * Bar chart of a grade distribution, one bar per GRADE_BUCKETS entry.
 * A suppressed bucket (null — UBC withheld it for privacy, spec 6) renders as
 * a short hatched grey stub, never as an empty/zero-height bar: the two must
 * stay visibly distinct or the suppression is silently lost.
 *
 * Each bar has a hover tooltip (pure CSS group-hover, no client JS needed)
 * showing the exact count and percentage of the offering's total students.
 */
export default function GradeChart({
  distribution,
}: {
  distribution: Record<string, number | null>;
}) {
  const max = Math.max(1, ...GRADE_BUCKETS.map((b) => distribution[b] ?? 0));
  const total = GRADE_BUCKETS.reduce((sum, b) => sum + (distribution[b] ?? 0), 0);

  return (
    <div className="flex items-end gap-1" style={{ height: CHART_HEIGHT }}>
      {GRADE_BUCKETS.map((bucket) => {
        const value = distribution[bucket] ?? null;
        const suppressed = value === null;
        const height = suppressed
          ? SUPPRESSED_STUB_HEIGHT
          : Math.round((value / max) * CHART_HEIGHT * MAX_BAR_FRACTION);
        const percent = !suppressed && total > 0 ? Math.round((value / total) * 100) : null;

        return (
          <div key={bucket} className="flex flex-1 flex-col items-center gap-1">
            <div className="group relative flex w-full flex-1 items-end justify-center">
              <div
                role="tooltip"
                className="pointer-events-none absolute bottom-full mb-1 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
              >
                {suppressed
                  ? `${bucket}: withheld by UBC for privacy`
                  : `${bucket}: ${value} student${value === 1 ? '' : 's'} (${percent}%)`}
              </div>
              <div
                className={
                  suppressed
                    ? 'w-full rounded-t border border-dashed border-slate-400 bg-slate-200'
                    : 'w-full rounded-t bg-blue-700'
                }
                style={{
                  height,
                  ...(suppressed
                    ? {
                        backgroundImage:
                          'repeating-linear-gradient(45deg, transparent, transparent 3px, rgb(148 163 184) 3px, rgb(148 163 184) 4px)',
                      }
                    : {}),
                }}
              />
            </div>
            <span className="text-[10px] text-slate-500">{bucket}</span>
          </div>
        );
      })}
    </div>
  );
}
