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

  // The visual bars carry their values only in hover tooltips, which have no
  // keyboard or screen-reader path. One plain sentence carries the same data.
  const summary = GRADE_BUCKETS.map((b) => {
    const v = distribution[b] ?? null;
    return v === null ? `${b}: withheld` : `${b}: ${v}`;
  }).join(', ');

  return (
    <div>
      <p className="sr-only">Grade distribution. {summary}.</p>
      {/* Bars and labels are separate rows: when a label wrapped inside the
          column, it stole height from the bar area, so a two-line label made
          its bar overflow. Splitting them fixes the baseline at any width. */}
      <div className="flex items-end gap-1" style={{ height: CHART_HEIGHT }}>
        {GRADE_BUCKETS.map((bucket, i) => {
          const value = distribution[bucket] ?? null;
          const suppressed = value === null;
          const height = suppressed
            ? SUPPRESSED_STUB_HEIGHT
            : Math.round((value / max) * CHART_HEIGHT * MAX_BAR_FRACTION);
          const percent = !suppressed && total > 0 ? Math.round((value / total) * 100) : null;

          // The tooltip is wider than the bar it belongs to, so on the end
          // columns it hung past the chart — and an absolutely positioned box
          // past the right edge widens the DOCUMENT, which made the whole
          // professor page scroll sideways on a phone. Anchor the outer
          // columns inward instead of centring them; the middle ones are
          // nowhere near an edge and stay centred.
          const anchor =
            i === 0
              ? 'left-0'
              : i === GRADE_BUCKETS.length - 1
                ? 'right-0'
                : 'left-1/2 -translate-x-1/2';

          return (
            <div key={bucket} className="group relative flex flex-1 items-end justify-center">
              <div
                role="tooltip"
                className={`pointer-events-none absolute bottom-full ${anchor} mb-1 whitespace-nowrap rounded bg-foreground px-2 py-1 text-xs text-background opacity-0 shadow-lg transition-opacity group-hover:opacity-100`}
              >
                {suppressed
                  ? `${bucket}: withheld by UBC for privacy`
                  : `${bucket}: ${value} student${value === 1 ? '' : 's'} (${percent}%)`}
              </div>
              <div
                className={
                  suppressed
                    ? 'w-full rounded-t border border-dashed border-border bg-surface-muted'
                    : 'w-full rounded-t bg-brand-accent'
                }
                style={{
                  height,
                  ...(suppressed
                    ? {
                        backgroundImage:
                          'repeating-linear-gradient(45deg, transparent, transparent 3px, var(--border) 3px, var(--border) 4px)',
                      }
                    : {}),
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-1 flex gap-1">
        {GRADE_BUCKETS.map((bucket) => (
          <span
            key={bucket}
            className="flex-1 text-center text-[10px] leading-tight text-text-tertiary"
          >
            {bucket}
          </span>
        ))}
      </div>
    </div>
  );
}
