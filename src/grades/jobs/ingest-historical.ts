import { db } from '@/lib/db';
import { fetchText } from '@/scrape/http';

const BASE = 'https://ubcgrades.com/api/v2/course-statistics';
const DISTRIBUTIONS_BASE = 'https://ubcgrades.com/api/v2/course-statistics/distributions';

export function historicalGradesUrl(campus: string, subject: string, number: string): string {
  return `${BASE}/${campus}/${subject}/${number}`;
}

export function historicalGradesDistributionsUrl(
  campus: string,
  subject: string,
  number: string,
): string {
  return `${DISTRIBUTIONS_BASE}/${campus}/${subject}/${number}`;
}

type ApiResponse = {
  average: number | null;
  average_past_5_yrs: number | null;
  min_course_avg: number | null;
  max_course_avg: number | null;
  stdev: number | null;
};

export type HistoricalGradesResponse = ApiResponse | null;

// ponytail: the real API returns "" (not null) for stats it can't compute
// (e.g. average_past_5_yrs on a course with too little history) — coerce any
// non-finite-number field to null before it reaches Prisma's Float? columns.
function toNullableFloat(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** A 404 means "no grade history for this course" — normal, not an error,
 * same posture as every other "not every X exists" job in this codebase. */
export async function fetchHistoricalGrades(
  subject: string,
  number: string,
): Promise<HistoricalGradesResponse> {
  try {
    const text = await fetchText(historicalGradesUrl('UBCV', subject, number));
    const raw = JSON.parse(text) as Record<string, unknown>;
    return {
      average: toNullableFloat(raw.average),
      average_past_5_yrs: toNullableFloat(raw.average_past_5_yrs),
      min_course_avg: toNullableFloat(raw.min_course_avg),
      max_course_avg: toNullableFloat(raw.max_course_avg),
      stdev: toNullableFloat(raw.stdev),
    };
  } catch {
    return null;
  }
}

type DistributionEntry = {
  year: string;
  session: string;
  grades: Record<string, number | null>;
};

// Non-"<50%" buckets, with their midpoint grade — used to compute a
// weighted-average per term from ubcgrades.com's distribution buckets.
// Different bucket set/shape than this app's own GradeDistribution data
// (spec: deliberately not merged, see docs/superpowers/specs), so this
// average is only ever compared against other ubcgrades.com-sourced numbers.
const BUCKET_MIDPOINTS: Record<string, number> = {
  '0-9%': 4.5,
  '10-19%': 14.5,
  '20-29%': 24.5,
  '30-39%': 34.5,
  '40-49%': 44.5,
  '50-54%': 52,
  '55-59%': 57,
  '60-63%': 61.5,
  '64-67%': 65.5,
  '68-71%': 69.5,
  '72-75%': 73.5,
  '76-79%': 77.5,
  '80-84%': 82,
  '85-89%': 87,
  '90-100%': 95,
};
const SUB_50_BUCKETS = ['0-9%', '10-19%', '20-29%', '30-39%', '40-49%'];
const SUB_50_MIDPOINT = 25; // midpoint of the rolled-up "<50%" bucket's 0-49 range

/**
 * A term's average from its raw grade-bucket counts. In earlier years UBC
 * reported the sub-50% range as five granular buckets; in later years those
 * are all null and only the rolled-up "<50%" bucket has a real count — using
 * both at once would double-count the same students, so "<50%" is only used
 * as a fallback when none of the granular sub-50 buckets have data.
 */
export function averageFromBuckets(grades: Record<string, number | null>): number | null {
  const hasGranularSub50 = SUB_50_BUCKETS.some((b) => grades[b] != null);

  let weightedSum = 0;
  let count = 0;
  for (const [bucket, midpoint] of Object.entries(BUCKET_MIDPOINTS)) {
    const value = grades[bucket];
    if (value == null) continue;
    weightedSum += value * midpoint;
    count += value;
  }
  if (!hasGranularSub50 && grades['<50%'] != null) {
    weightedSum += grades['<50%'] * SUB_50_MIDPOINT;
    count += grades['<50%'];
  }

  return count > 0 ? weightedSum / count : null;
}

/** Per-term averages for a course, computed from the real distributions
 * endpoint. A 404/empty response means no history — normal, returns []. */
export async function fetchHistoricalGradesByTerm(
  subject: string,
  number: string,
): Promise<{ year: number; session: string; average: number | null }[]> {
  try {
    const text = await fetchText(historicalGradesDistributionsUrl('UBCV', subject, number));
    const entries = JSON.parse(text) as DistributionEntry[];
    return entries.map((entry) => ({
      year: Number(entry.year),
      session: entry.session,
      average: averageFromBuckets(entry.grades),
    }));
  } catch {
    return [];
  }
}

export async function ingestHistoricalGrades(): Promise<{ updated: number; skipped: number }> {
  const courses = await db.course.findMany({
    where: { campus: 'V' },
    select: { id: true, number: true, subject: { select: { code: true } } },
  });

  let updated = 0;
  let skipped = 0;

  for (const course of courses) {
    if (!course.subject.code) {
      skipped += 1;
      continue;
    }
    const stats = await fetchHistoricalGrades(course.subject.code, course.number);
    if (!stats) {
      skipped += 1;
      continue;
    }

    await db.courseHistoricalGrades.upsert({
      where: { courseId: course.id },
      create: {
        courseId: course.id,
        average: stats.average,
        averagePast5Years: stats.average_past_5_yrs,
        minSectionAverage: stats.min_course_avg,
        maxSectionAverage: stats.max_course_avg,
        stddev: stats.stdev,
      },
      update: {
        average: stats.average,
        averagePast5Years: stats.average_past_5_yrs,
        minSectionAverage: stats.min_course_avg,
        maxSectionAverage: stats.max_course_avg,
        stddev: stats.stdev,
      },
    });
    updated += 1;

    const byTerm = await fetchHistoricalGradesByTerm(course.subject.code, course.number);
    for (const term of byTerm) {
      await db.courseHistoricalGradesByTerm.upsert({
        where: { courseId_year_session: { courseId: course.id, year: term.year, session: term.session } },
        create: { courseId: course.id, year: term.year, session: term.session, average: term.average },
        update: { average: term.average },
      });
    }
  }

  console.log(`Historical grades: ${updated} courses updated, ${skipped} skipped (no data).`);
  return { updated, skipped };
}
