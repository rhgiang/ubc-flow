'use client';

import { useState } from 'react';

export type HistoricalGradeTerm = { year: number; session: string; average: number | null };

const CHART_H = 280;
const AXIS = { left: 34, right: 8, top: 12, bottom: 62 };
const PLOT_H = CHART_H - AXIS.top - AXIS.bottom;
const GRID = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const MAX_X_LABELS = 16; // beyond this the rotated labels start colliding

/** "2009W" — year first, matching ubcgrades.com's own axis labels. */
function termLabel(t: HistoricalGradeTerm): string {
  return `${t.year}${t.session}`;
}

function termFullLabel(t: HistoricalGradeTerm): string {
  return `${t.session === 'W' ? 'Winter' : 'Summer'} ${t.year}`;
}

/**
 * Line chart of a course's average grade per term, from ubcgrades.com's
 * per-term distributions (see src/grades/jobs/ingest-historical.ts).
 * Mirrors ubcgrades.com's own chart — zero-based 0-100 axis, one point per
 * term, Past 5 Years / All Years toggle — in this app's theme.
 *
 * Fully width-responsive: points are positioned as percentages and the SVG
 * stretches with its container (`preserveAspectRatio="none"`), so a short
 * 5-year range fills the same space a 15-year one does. Strokes carry
 * `vector-effect="non-scaling-stroke"` so that stretch never distorts line
 * thickness, and all text lives in HTML rather than the stretched SVG.
 */
export default function HistoricalGradesTimeline({ terms }: { terms: HistoricalGradeTerm[] }) {
  const [showAll, setShowAll] = useState(false);

  const sorted = [...terms].sort(
    (a, b) => a.year - b.year || a.session.localeCompare(b.session),
  );

  if (sorted.length === 0 || sorted.every((t) => t.average === null)) {
    return <p className="text-sm text-text-secondary">No historical term-by-term data available.</p>;
  }

  const latestYear = Math.max(...sorted.map((t) => t.year));
  const shown = showAll ? sorted : sorted.filter((t) => t.year >= latestYear - 4);

  // Percentage across the plot area, so the line spans the full width
  // whatever the term count.
  const xPct = (i: number) => (shown.length === 1 ? 50 : (i / (shown.length - 1)) * 100);
  const yPct = (v: number) => 100 - v; // grades are already a 0-100 scale

  // Break the line wherever a term has no computable average, so a gap reads
  // as missing data rather than a straight line drawn through it.
  const segments: { i: number; v: number }[][] = [];
  let run: { i: number; v: number }[] = [];
  shown.forEach((t, i) => {
    if (t.average === null) {
      if (run.length) segments.push(run);
      run = [];
    } else {
      run.push({ i, v: t.average });
    }
  });
  if (run.length) segments.push(run);

  const labelStep = Math.ceil(shown.length / MAX_X_LABELS);

  return (
    <div>
      <div className="mb-3 flex justify-end gap-2">
        {([
          ['Past 5 Years', false],
          ['All Years', true],
        ] as const).map(([label, value]) => (
          <button
            key={label}
            type="button"
            onClick={() => setShowAll(value)}
            className={`rounded-input px-3 py-1 text-xs font-medium transition-colors ${
              showAll === value
                ? 'bg-brand text-white'
                : 'border border-border text-text-secondary hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="relative w-full" style={{ height: CHART_H }}>
        {GRID.map((gv) => (
          <span
            key={`y-${gv}`}
            className="absolute text-right text-[10px] text-text-secondary"
            style={{
              left: 0,
              width: AXIS.left - 6,
              top: AXIS.top + (yPct(gv) / 100) * PLOT_H - 6,
            }}
          >
            {gv}
          </span>
        ))}

        <div
          className="absolute"
          style={{ left: AXIS.left, right: AXIS.right, top: AXIS.top, height: PLOT_H }}
        >
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            {GRID.map((gv) => (
              <line
                key={`grid-${gv}`}
                x1="0"
                x2="100"
                y1={yPct(gv)}
                y2={yPct(gv)}
                stroke="var(--border)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {segments.map((seg, si) =>
              seg.length === 1 ? null : (
                <polyline
                  key={si}
                  points={seg.map((p) => `${xPct(p.i)},${yPct(p.v)}`).join(' ')}
                  fill="none"
                  stroke="var(--brand)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ),
            )}
          </svg>

          {shown.map((t, i) =>
            t.average === null ? null : (
              <div
                key={`${t.year}-${t.session}`}
                className="group absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${xPct(i)}%`, top: `${yPct(t.average)}%` }}
              >
                <div className="h-2 w-2 rounded-full bg-brand transition-transform group-hover:scale-150" />
                <div
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
                >
                  {termFullLabel(t)}: {t.average.toFixed(1)}%
                </div>
              </div>
            ),
          )}
        </div>

        <div
          className="absolute"
          style={{ left: AXIS.left, right: AXIS.right, top: CHART_H - AXIS.bottom + 6 }}
        >
          {shown.map((t, i) =>
            i % labelStep === 0 ? (
              <span
                key={`x-${t.year}-${t.session}`}
                className="absolute whitespace-nowrap text-[10px] text-text-secondary"
                style={{
                  left: `${xPct(i)}%`,
                  transformOrigin: 'top right',
                  transform: 'translateX(-100%) rotate(-45deg)',
                }}
              >
                {termLabel(t)}
              </span>
            ) : null,
          )}
        </div>
      </div>
    </div>
  );
}
