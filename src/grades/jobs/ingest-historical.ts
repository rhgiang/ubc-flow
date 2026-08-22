import { db } from '@/lib/db';
import { fetchText } from '@/scrape/http';

const BASE = 'https://ubcgrades.com/api/v2/course-statistics';

export function historicalGradesUrl(campus: string, subject: string, number: string): string {
  return `${BASE}/${campus}/${subject}/${number}`;
}

type ApiResponse = {
  average: number;
  average_past_5_yrs: number;
  min_course_avg: number;
  max_course_avg: number;
  stdev: number;
};

export type HistoricalGradesResponse = ApiResponse | null;

/** A 404 means "no grade history for this course" — normal, not an error,
 * same posture as every other "not every X exists" job in this codebase. */
export async function fetchHistoricalGrades(
  subject: string,
  number: string,
): Promise<HistoricalGradesResponse> {
  try {
    const text = await fetchText(historicalGradesUrl('UBCV', subject, number));
    return JSON.parse(text) as ApiResponse;
  } catch {
    return null;
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
  }

  console.log(`Historical grades: ${updated} courses updated, ${skipped} skipped (no data).`);
  return { updated, skipped };
}
