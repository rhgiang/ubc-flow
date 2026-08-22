'use client';

import { useState } from 'react';

export type HistoricalGradeTerm = { year: number; session: string; average: number | null };

const COL_W = 30; // px per term
const CHART_H = 280;
const PAD = { top: 12, right: 12, bottom: 62, left: 34 };
const PLOT_H = CHART_H - PAD.top - PAD.bottom;

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
 */
export default function HistoricalGradesTimeline({ terms }: { terms: HistoricalGradeTerm[] }) {
  const [showAll, setShowAll] = useState(true);

  const sorted = [...terms].sort(
    (a, b) => a.year - b.year || a.session.localeCompare(b.session),
  );

  if (sorted.every((t) => t.average === null) || sorted.length === 0) {
    return <p className="text-sm text-text-secondary">No historical term-by-term data available.</p>;
  }

  const latestYear = Math.max(...sorted.map((t) => t.year));
  const shown = showAll ? sorted : sorted.filter((t) => t.year >= latestYear - 4);

  const plotW = shown.length * COL_W;
  const totalW = PAD.left + plotW + PAD.right;

  const x = (i: number) => PAD.left + i * COL_W + COL_W / 2;
  const y = (v: number) => PAD.top + (1 - v / 100) * PLOT_H;

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

  const gridValues = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

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

      <div className="overflow-x-auto">
        <div className="relative" style={{ width: totalW, height: CHART_H }}>
          <svg width={totalW} height={CHART_H} className="block">
            {gridValues.map((gv) => (
              <g key={gv}>
                <line
                  x1={PAD.left}
                  x2={totalW - PAD.right}
                  y1={y(gv)}
                  y2={y(gv)}
                  stroke="var(--border)"
                  strokeWidth="1"
                />
                <text
                  x={PAD.left - 6}
                  y={y(gv) + 3}
                  textAnchor="end"
                  className="fill-text-secondary text-[10px]"
                >
                  {gv}
                </text>
              </g>
            ))}

            {segments.map((seg, si) =>
              seg.length === 1 ? null : (
                <polyline
                  key={si}
                  points={seg.map((p) => `${x(p.i)},${y(p.v)}`).join(' ')}
                  fill="none"
                  stroke="var(--brand)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ),
            )}

            {shown.map((t, i) => (
              <text
                key={`label-${t.year}-${t.session}`}
                x={x(i)}
                y={CHART_H - PAD.bottom + 14}
                textAnchor="end"
                transform={`rotate(-45 ${x(i)} ${CHART_H - PAD.bottom + 14})`}
                className="fill-text-secondary text-[10px]"
              >
                {termLabel(t)}
              </text>
            ))}
          </svg>

          {shown.map((t, i) =>
            t.average === null ? null : (
              <div
                key={`${t.year}-${t.session}`}
                className="group absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: x(i), top: y(t.average) }}
              >
                <div className="h-2 w-2 rounded-full bg-brand transition-transform group-hover:scale-150" />
                <div
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
                >
                  {termFullLabel(t)}: {t.average.toFixed(1)}%
                </div>
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
