/**
 * Course grade history derived from our own PAIR rows.
 *
 * Everything here comes from the same GradeDistribution data that feeds the
 * grade-distribution chart, so a course page tells one consistent story over
 * one window (2014-2025, whatever the ingest currently holds). It replaces
 * the ubcgrades.com-derived figures, which covered a different span and whose
 * per-term averages had to be estimated from grade bands rather than read
 * from the reported section averages.
 */

export type TermGradeRow = {
  termId: string;
  average: number | null;
  count: number | null;
};

export type TermGradePoint = {
  year: number;
  session: string;
  /** Student-weighted mean of that term's section averages. */
  average: number;
  students: number;
};

export type CourseGradeHistory = {
  terms: TermGradePoint[];
  /** Lowest and highest single-section average across the window. */
  lowestSection: number | null;
  highestSection: number | null;
};

/** Year+session for a termId, whether it's a real Term or an ingest sentinel. */
export function resolveTermKey(
  termId: string,
  terms: Map<string, { year: number; session: string }>,
): { year: number; session: string } | null {
  // The grade ingest encodes the period into a sentinel when our Term
  // catalogue has no row for it - see src/grades/jobs/ingest.ts.
  const sentinel = /^unmatched-(\d{4})([SW])$/.exec(termId);
  if (sentinel) return { year: Number(sentinel[1]), session: sentinel[2] };
  return terms.get(termId) ?? null;
}

export function buildCourseGradeHistory(
  rows: TermGradeRow[],
  terms: Map<string, { year: number; session: string }>,
): CourseGradeHistory {
  const byTerm = new Map<string, { year: number; session: string; weighted: number; students: number }>();
  let lowestSection: number | null = null;
  let highestSection: number | null = null;

  for (const row of rows) {
    // A section with no reported average or headcount can't be weighted, and
    // treating either as 0 would drag the whole term down.
    if (row.average === null || row.count === null || row.count <= 0) continue;

    lowestSection = lowestSection === null ? row.average : Math.min(lowestSection, row.average);
    highestSection = highestSection === null ? row.average : Math.max(highestSection, row.average);

    const key = resolveTermKey(row.termId, terms);
    if (!key) continue;

    const id = `${key.year}${key.session}`;
    const bucket = byTerm.get(id) ?? { ...key, weighted: 0, students: 0 };
    bucket.weighted += row.average * row.count;
    bucket.students += row.count;
    byTerm.set(id, bucket);
  }

  const termPoints = [...byTerm.values()]
    .map((b) => ({
      year: b.year,
      session: b.session,
      average: b.weighted / b.students,
      students: b.students,
    }))
    // Summer runs before Winter within an academic year, matching how the
    // rest of the app orders terms.
    .sort((a, b) => a.year - b.year || a.session.localeCompare(b.session));

  return { terms: termPoints, lowestSection, highestSection };
}
