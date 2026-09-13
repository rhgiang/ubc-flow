'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import type { Histogram } from '@/reviews/aggregate';

type Metric = {
  label: string;
  mean: number | null;
  histogram: Histogram;
  /**
   * Whether a high score is good news. Useful: yes. Difficulty: no - 100%
   * difficult is the red end, not the green one, so its colour reads off the
   * inverse. Only the colour flips; the bar still shows the real number.
   */
  higherIsBetter?: boolean;
};

/**
 * Red through amber to green across 0-100, deep at the left and bright at the
 * right. Hue carries the score - 0deg red, 140deg green, amber falling where
 * it should - and is fixed across the bar: shifting it would put a green
 * shoulder on a red one and read as a different number. The sheen is
 * saturation and lightness only.
 *
 * Softened off the full-strength pair: enough saturation to read as red or
 * green at a glance, light enough to sit on the frosted card without shouting.
 * Both stops live here so the bars and the ring can never drift apart.
 */
const SCALE_DEEP = { saturation: 58, lightness: 52 };
const SCALE_BRIGHT = { saturation: 72, lightness: 68 };

function scaleHue(percent: number): number {
  return Math.round((percent / 100) * 140);
}

function scaleStops(hue: number): [string, string] {
  return [
    `hsl(${hue} ${SCALE_DEEP.saturation}% ${SCALE_DEEP.lightness}%)`,
    `hsl(${hue} ${SCALE_BRIGHT.saturation}% ${SCALE_BRIGHT.lightness}%)`,
  ];
}

function scaleGradient(percent: number, angle = '90deg'): string {
  const [deep, bright] = scaleStops(scaleHue(percent));
  return `linear-gradient(${angle}, ${deep}, ${bright})`;
}

/**
 * Timings lifted from UW Flow so the box fills the way theirs does: the ring
 * sweeps over 1.5s from the moment it mounts (their recharts pie default),
 * and the bars run 1s ease-in-out starting half a second in, so the numbers
 * are readable before anything moves and the two do not race each other.
 */
const RING_MS = 1500;
const BAR_DELAY_MS = 500;

export default function RatingsBox({
  likedPercent,
  ratingCount,
  commentCount,
  metrics,
  reviewsHref = '#reviews',
  action,
  tone = 'panel',
  noun = 'course',
}: {
  likedPercent: number | null;
  /** Every review, with or without written comments. */
  ratingCount: number;
  /** The subset that wrote something - the count worth jumping to. */
  commentCount: number;
  metrics: [Metric, Metric];
  reviewsHref?: string;
  /** Sits in the footer beside the counts - the review button, on both pages. */
  action?: ReactNode;
  /** 'glass' when the box floats on the sky rather than sitting on a panel. */
  tone?: 'panel' | 'glass';
  /** What there are no ratings *of*, for the empty state's copy. */
  noun?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [filled, setFilled] = useState(false);
  // Two boxes can share a page (a course and its professor), so the gradient
  // needs an id of its own or the second would reference the first's.
  const ringGradientId = `ring-${useId()}`;

  // Painted empty, then filled: a bar that starts at its final width has
  // nothing to animate. Set from a timer, not synchronously, so the first
  // paint is the empty state.
  useEffect(() => {
    const ring = requestAnimationFrame(() => setFilled(true));
    return () => cancelAnimationFrame(ring);
  }, []);

  // (mean - 1) / 4 * 100 - the box's own convention (spec 5.3), distinct
  // from the X.X/5 format used elsewhere on this site (Explore table etc.),
  // which this component does not touch.
  const asPercent = (mean: number | null) =>
    mean === null ? null : Math.round(((mean - 1) / 4) * 100);

  const [ringDeep, ringBright] = scaleStops(scaleHue(likedPercent ?? 0));
  const circumference = 2 * Math.PI * 54;
  const dash = ((likedPercent ?? 0) / 100) * circumference;

  const shell =
    tone === 'glass' ? 'sky-glass p-6' : 'rounded-card border border-border bg-surface p-6';

  // Same card, same footprint, an empty ring - rather than a line of grey text
  // floating where a card should be, which read as a page that had failed to
  // load rather than one nobody has reviewed yet.
  if (ratingCount === 0) {
    return (
      <div className={shell}>
        <div className="flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
          <div className="relative flex h-40 w-40 shrink-0 items-center justify-center">
            <svg viewBox="0 0 120 120" className="h-40 w-40">
              <circle
                cx="60"
                cy="60"
                r="54"
                fill="none"
                stroke="var(--border)"
                strokeWidth="10"
                strokeDasharray="4 10"
                strokeLinecap="round"
              />
            </svg>
            <span className="absolute text-2xl font-semibold text-text-tertiary">—</span>
          </div>

          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">No ratings yet</p>
            <p className="mt-1 text-xs text-text-secondary">
              Be the first to review this {noun}.
            </p>
            {action && <div className="mt-4">{action}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={shell}>
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
        <div className="relative flex h-40 w-40 shrink-0 items-center justify-center">
          <svg viewBox="0 0 120 120" className="h-40 w-40 -rotate-90">
            <defs>
              <linearGradient id={ringGradientId} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={ringDeep} />
                <stop offset="100%" stopColor={ringBright} />
              </linearGradient>
            </defs>
            <circle cx="60" cy="60" r="54" fill="none" stroke="var(--border)" strokeWidth="10" />
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke={likedPercent === null ? 'var(--brand)' : `url(#${ringGradientId})`}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              // Offset rather than dash length: one property to animate, and
              // it sweeps round instead of growing out of nothing.
              strokeDashoffset={filled ? circumference - dash : circumference}
              className="transition-[stroke-dashoffset] ease-in-out motion-reduce:transition-none"
              style={{ transitionDuration: `${RING_MS}ms` }}
            />
          </svg>
          <div className="absolute flex flex-col items-center">
            <span className="text-3xl font-semibold text-foreground">
              {likedPercent !== null ? `${likedPercent}%` : '—'}
            </span>
            <span className="text-xs text-text-secondary">liked</span>
          </div>
        </div>

        <div className="w-full min-w-0 flex-1 space-y-4">
          {metrics.map((m, i) => (
            <div key={m.label} className="relative">
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => setOpen(open === i ? null : i)}
                  aria-expanded={open === i}
                  className="flex items-center gap-1.5 font-medium text-foreground"
                >
                  {m.label}
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.75}
                    className="h-3.5 w-3.5"
                  >
                    <rect x="4" y="10" width="3" height="8" />
                    <rect x="10.5" y="6" width="3" height="12" />
                    <rect x="17" y="2" width="3" height="16" />
                  </svg>
                </button>
                <span className="text-text-secondary">
                  {asPercent(m.mean) !== null ? `${asPercent(m.mean)}%` : '—'}
                </span>
              </div>
              <div className="mt-1.5 h-2.5 w-full rounded-full bg-surface-muted">
                <div
                  className="h-2.5 rounded-full transition-[width] duration-1000 ease-in-out motion-reduce:transition-none"
                  style={{
                    width: filled ? `${asPercent(m.mean) ?? 0}%` : '0%',
                    transitionDelay: `${BAR_DELAY_MS}ms`,
                    background:
                      asPercent(m.mean) === null
                        ? 'var(--brand)'
                        : scaleGradient(
                            m.higherIsBetter === false
                              ? 100 - (asPercent(m.mean) as number)
                              : (asPercent(m.mean) as number),
                          ),
                  }}
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
      </div>

      {/* Comments and ratings counted separately, as UW Flow does: a rating is
          a set of numbers, a comment is someone who wrote something, and only
          the second is worth scrolling to. */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="flex items-center gap-3 text-xs">
          {commentCount > 0 ? (
            <a href={reviewsHref} className="font-medium text-brand-accent hover:underline">
              {commentCount} comment{commentCount === 1 ? '' : 's'}
            </a>
          ) : (
            <span className="text-text-tertiary">No comments</span>
          )}
          <span className="text-text-tertiary">·</span>
          <span className="text-text-secondary">
            {ratingCount} rating{ratingCount === 1 ? '' : 's'}
          </span>
        </div>
        {action}
      </div>
    </div>
  );
}
