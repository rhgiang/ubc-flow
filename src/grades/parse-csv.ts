export const GRADE_BUCKETS = [
  '<50', '50-54', '55-59', '60-63', '64-67', '68-71',
  '72-75', '76-79', '80-84', '85-89', '90-100',
] as const;

export type GradeBucket = (typeof GRADE_BUCKETS)[number];

export type RawGradeRow = {
  campus: string;
  year: number;
  session: string;
  subject: string;
  courseNumber: string;
  detail: string | null;
  sectionCode: string;
  title: string;
  professors: string[];
  reported: number | null;
  average: number | null;
  median: number | null;
  high: number | null;
  low: number | null;
  /** Suppressed buckets stay null — never coerced to 0 (spec 6). */
  distribution: Record<GradeBucket, number | null>;
};

/** Blank means suppressed or unavailable — null, never 0. */
function num(value: string | undefined): number | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(value: string | undefined): string {
  return (value ?? '').trim();
}

/**
 * Minimal CSV split. This source has no quoted fields or embedded commas —
 * verified against real files — so a full CSV parser would be a dependency
 * bought for nothing.
 */
function splitLine(line: string): string[] {
  return line.split(',');
}

export function parseGradeCsv(text: string): RawGradeRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = splitLine(lines[0]).map((h) => h.trim());
  const index = (name: string) => header.indexOf(name);

  const iYear = index('Year');
  const iSession = index('Session');
  const iSubject = index('Subject');
  const iCourse = index('Course');
  const iDetail = index('Detail');
  const iSection = index('Section');
  const iTitle = index('Title');
  const iProf = index('Professor');
  const iReported = index('Reported');
  const iAvg = index('Avg');
  const iMedian = index('Median');
  const iHigh = index('High');
  const iLow = index('Low');
  const bucketIndex = GRADE_BUCKETS.map((b) => index(b));

  const rows: RawGradeRow[] = [];

  for (const line of lines.slice(1)) {
    const c = splitLine(line);
    const courseNumber = str(c[iCourse]);
    if (!courseNumber) continue;

    const distribution = {} as Record<GradeBucket, number | null>;
    GRADE_BUCKETS.forEach((bucket, i) => {
      distribution[bucket] = num(c[bucketIndex[i]]);
    });

    rows.push({
      campus: str(c[index('Campus')]),
      year: Number(str(c[iYear])),
      session: str(c[iSession]),
      subject: str(c[iSubject]),
      courseNumber,
      detail: str(c[iDetail]) || null,
      sectionCode: str(c[iSection]),
      title: str(c[iTitle]),
      // Co-taught sections list several names; blank means none (spec 5).
      professors: str(c[iProf])
        .split(';')
        .map((p) => p.trim())
        .filter(Boolean),
      reported: num(c[iReported]),
      average: num(c[iAvg]),
      median: num(c[iMedian]),
      high: num(c[iHigh]),
      low: num(c[iLow]),
      distribution,
    });
  }

  return rows;
}
