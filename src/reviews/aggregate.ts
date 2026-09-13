export type CourseReviewRow = {
  liked: boolean | null;
  useful: number | null;
  difficulty: number | null;
  workloadHours: number | null;
};

export type InstructorReviewRow = {
  liked: boolean | null;
  clear: number | null;
  engaging: number | null;
};

export type Histogram = Record<1 | 2 | 3 | 4 | 5, number>;

export type CourseAggregate = {
  count: number;
  likedPercent: number | null;
  useful: number | null;
  difficulty: number | null;
  workloadHours: number | null;
  histograms: { useful: Histogram; difficulty: Histogram };
};

export type InstructorAggregate = {
  count: number;
  likedPercent: number | null;
  clear: number | null;
  engaging: number | null;
  histograms: { clear: Histogram; engaging: Histogram };
};

/** Storage is 0-4; users see 1-5. Convert only at the boundary. */
export function toDisplayScore(stored: number | null): number | null {
  return stored === null ? null : stored + 1;
}

export function toStoredScore(display: number | null): number | null {
  return display === null ? null : display - 1;
}

/** Mean of the non-null values, or null when there are none. */
function meanOf(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null && v !== undefined);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

/** Mean on the 1-5 display scale. Null stays null - never rendered as 0. */
function meanDisplay(values: (number | null)[]): number | null {
  const mean = meanOf(values);
  return mean === null ? null : mean + 1;
}

function likedPercent(values: (boolean | null)[]): number | null {
  const present = values.filter((v): v is boolean => v === true || v === false);
  if (present.length === 0) return null;
  return Math.round((present.filter(Boolean).length / present.length) * 100);
}

function emptyHistogram(): Histogram {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

/** Counts each 0-4 stored rating into its 1-5 display bucket. Nulls are
 * excluded entirely - an unrated review contributes to no bucket, never a
 * fabricated "1". */
function histogramOf(values: (number | null)[]): Histogram {
  const h = emptyHistogram();
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const display = (v + 1) as 1 | 2 | 3 | 4 | 5;
    if (display >= 1 && display <= 5) h[display] += 1;
  }
  return h;
}

export function aggregateCourseReviews(rows: CourseReviewRow[]): CourseAggregate {
  return {
    count: rows.length,
    likedPercent: likedPercent(rows.map((r) => r.liked)),
    useful: meanDisplay(rows.map((r) => r.useful)),
    difficulty: meanDisplay(rows.map((r) => r.difficulty)),
    // Workload is raw hours, not a 1-5 score - no display offset.
    workloadHours: meanOf(rows.map((r) => r.workloadHours)),
    histograms: {
      useful: histogramOf(rows.map((r) => r.useful)),
      difficulty: histogramOf(rows.map((r) => r.difficulty)),
    },
  };
}

export function aggregateInstructorReviews(rows: InstructorReviewRow[]): InstructorAggregate {
  return {
    count: rows.length,
    likedPercent: likedPercent(rows.map((r) => r.liked)),
    clear: meanDisplay(rows.map((r) => r.clear)),
    engaging: meanDisplay(rows.map((r) => r.engaging)),
    histograms: {
      clear: histogramOf(rows.map((r) => r.clear)),
      engaging: histogramOf(rows.map((r) => r.engaging)),
    },
  };
}
