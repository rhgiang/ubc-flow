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

export type CourseAggregate = {
  count: number;
  likedPercent: number | null;
  useful: number | null;
  difficulty: number | null;
  workloadHours: number | null;
};

export type InstructorAggregate = {
  count: number;
  likedPercent: number | null;
  clear: number | null;
  engaging: number | null;
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

/** Mean on the 1-5 display scale. Null stays null — never rendered as 0. */
function meanDisplay(values: (number | null)[]): number | null {
  const mean = meanOf(values);
  return mean === null ? null : mean + 1;
}

function likedPercent(values: (boolean | null)[]): number | null {
  const present = values.filter((v): v is boolean => v === true || v === false);
  if (present.length === 0) return null;
  return Math.round((present.filter(Boolean).length / present.length) * 100);
}

export function aggregateCourseReviews(rows: CourseReviewRow[]): CourseAggregate {
  return {
    count: rows.length,
    likedPercent: likedPercent(rows.map((r) => r.liked)),
    useful: meanDisplay(rows.map((r) => r.useful)),
    difficulty: meanDisplay(rows.map((r) => r.difficulty)),
    // Workload is raw hours, not a 1-5 score — no display offset.
    workloadHours: meanOf(rows.map((r) => r.workloadHours)),
  };
}

export function aggregateInstructorReviews(rows: InstructorReviewRow[]): InstructorAggregate {
  return {
    count: rows.length,
    likedPercent: likedPercent(rows.map((r) => r.liked)),
    clear: meanDisplay(rows.map((r) => r.clear)),
    engaging: meanDisplay(rows.map((r) => r.engaging)),
  };
}
