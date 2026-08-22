'use client';

import { useState } from 'react';
import type { Histogram } from '@/reviews/aggregate';

type Metric = { label: string; mean: number | null; histogram: Histogram };

export default function RatingsBox({
  likedPercent,
  reviewCount,
  metrics,
}: {
  likedPercent: number | null;
  reviewCount: number;
  metrics: [Metric, Metric];
}) {
  const [open, setOpen] = useState<number | null>(null);

  // (mean - 1) / 4 * 100 — the box's own convention (spec 5.3), distinct
  // from the X.X/5 format used elsewhere on this site (Explore table etc.),
  // which this component does not touch.
  const asPercent = (mean: number | null) => (mean === null ? null : Math.round(((mean - 1) / 4) * 100));

  const ringPercent = likedPercent ?? 0;
  const circumference = 2 * Math.PI * 54;
  const dash = (ringPercent / 100) * circumference;

  if (reviewCount === 0) {
    return <p className="text-sm text-text-secondary">No reviews yet.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-8 rounded-card border border-border bg-surface p-6">
      <div className="relative flex h-32 w-32 shrink-0 items-center justify-center">
        <svg viewBox="0 0 120 120" className="h-32 w-32 -rotate-90">
          <circle cx="60" cy="60" r="54" fill="none" stroke="var(--border)" strokeWidth="10" />
          <circle
            cx="60"
            cy="60"
            r="54"
            fill="none"
            stroke="var(--brand)"
            strokeWidth="10"
            strokeDasharray={`${dash} ${circumference}`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className="text-2xl font-semibold text-foreground">
            {likedPercent !== null ? `${likedPercent}%` : '—'}
          </span>
          <span className="text-xs text-text-secondary">liked</span>
        </div>
      </div>

      <div className="min-w-[220px] flex-1 space-y-3">
        {metrics.map((m, i) => (
          <div key={m.label} className="relative">
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => setOpen(open === i ? null : i)}
                className="flex items-center gap-1.5 font-medium text-foreground"
              >
                {m.label}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-3.5 w-3.5">
                  <rect x="4" y="10" width="3" height="8" />
                  <rect x="10.5" y="6" width="3" height="12" />
                  <rect x="17" y="2" width="3" height="16" />
                </svg>
              </button>
              <span className="text-text-secondary">
                {asPercent(m.mean) !== null ? `${asPercent(m.mean)}%` : '—'}
              </span>
            </div>
            <div className="mt-1 h-2 w-full rounded-full bg-surface-muted">
              <div
                className="h-2 rounded-full bg-brand"
                style={{ width: `${asPercent(m.mean) ?? 0}%` }}
              />
            </div>

            {open === i && (
              <div className="absolute left-0 top-full z-20 mt-2 w-64 rounded-card border border-border bg-surface p-4 shadow-lg">
                <p className="text-sm font-semibold text-foreground">{m.label} Distribution</p>
                <div className="mt-3 space-y-1.5">
                  {([5, 4, 3, 2, 1] as const).map((star) => {
                    const count = m.histogram[star];
                    const max = Math.max(1, ...Object.values(m.histogram));
                    return (
                      <div key={star} className="flex items-center gap-2 text-xs">
                        <span className="w-3 text-text-secondary">{star}</span>
                        <div className="h-2 flex-1 rounded-full bg-surface-muted">
                          <div
                            className="h-2 rounded-full bg-brand"
                            style={{ width: `${(count / max) * 100}%` }}
                          />
                        </div>
                        <span className="w-8 text-right text-text-secondary">({count})</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="w-full text-xs text-text-secondary">
        Based on {reviewCount} review{reviewCount === 1 ? '' : 's'}
      </p>
    </div>
  );
}
