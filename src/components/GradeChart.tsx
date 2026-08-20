import { GRADE_BUCKETS } from '@/grades/parse-csv';

const CHART_HEIGHT = 96; // px
const SUPPRESSED_STUB_HEIGHT = 10; // px — enough to read as "withheld", not "zero"

/**
 * Bar chart of a grade distribution, one bar per GRADE_BUCKETS entry.
 * A suppressed bucket (null — UBC withheld it for privacy, spec 6) renders as
 * a short hatched grey stub, never as an empty/zero-height bar: the two must
 * stay visibly distinct or the suppression is silently lost.
 */
export default function GradeChart({
  distribution,
}: {
  distribution: Record<string, number | null>;
}) {
  const max = Math.max(1, ...GRADE_BUCKETS.map((b) => distribution[b] ?? 0));

  return (
    <div className="flex items-end gap-1" style={{ height: CHART_HEIGHT }}>
      {GRADE_BUCKETS.map((bucket) => {
        const value = distribution[bucket] ?? null;
        const suppressed = value === null;
        const height = suppressed
          ? SUPPRESSED_STUB_HEIGHT
          : Math.round((value / max) * CHART_HEIGHT);

        return (
          <div key={bucket} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex w-full flex-1 items-end justify-center">
              <div
                title={
                  suppressed
                    ? `${bucket}: withheld by UBC for privacy`
                    : `${bucket}: ${value} student${value === 1 ? '' : 's'}`
                }
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
