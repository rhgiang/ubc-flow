import { db } from '@/lib/db';
import { fetchText } from '@/scrape/http';
import { normalizeInstructorName } from '@/scrape/names';
import { parseGradeCsv, type RawGradeRow } from '@/grades/parse-csv';

const REPO = 'https://raw.githubusercontent.com/DonneyF/ubc-pair-grade-data/master';
const V1_BASE = `${REPO}/tableau-dashboard/UBCV`;
const V2_BASE = `${REPO}/tableau-dashboard-v2/UBCV`;

/**
 * The pre-2021 export. Its columns differ slightly from the current one
 * (Enrolled/Std dev rather than Reported/Median) - parseGradeCsv looks
 * columns up by header name and handles both.
 *
 * Stops at 2020W even though the directory also holds 2021S and 2021W:
 * those two sessions exist in BOTH exports, and ingesting them twice would
 * double every 2021 section's students in the aggregate. V2 is the
 * authoritative copy for them.
 */
export const V1_SESSIONS = [
  '2014S', '2014W', '2015S', '2015W', '2016S', '2016W', '2017S',
  '2017W', '2018S', '2018W', '2019S', '2019W', '2020S', '2020W',
] as const;

/** Sessions available in the current format - verified 2026-08-20. */
export const V2_SESSIONS = [
  '2021S', '2021W', '2022S', '2022W', '2023S',
  '2023W', '2024S', '2024W', '2025S', '2025W',
] as const;

export const SESSIONS = [...V1_SESSIONS, ...V2_SESSIONS] as const;

export function gradeCsvUrl(session: string, subject: string): string {
  const base = (V1_SESSIONS as readonly string[]).includes(session) ? V1_BASE : V2_BASE;
  return `${base}/${session}/UBCV-${session}-${subject}.csv`;
}

export type IngestResult = {
  written: number;
  skippedNoCourse: number;
  unmatchedProfessors: string[];
};

export async function ingestRows(rows: RawGradeRow[]): Promise<IngestResult> {
  let written = 0;
  let skippedNoCourse = 0;
  const unmatched = new Set<string>();

  for (const row of rows) {
    // The pre-2021 export carries an "OVERALL" rollup row per course whose
    // count is the sum of that course's real sections. Storing it as a
    // section would double every student in studentCount and in every
    // distribution bucket, and inflate sectionCount. The rollup is
    // recomputed by aggregateDistributions anyway.
    if (row.sectionCode === 'OVERALL') continue;

    const course = await db.course.findFirst({
      where: {
        number: row.courseNumber,
        subject: { code: row.subject, campus: 'V' },
      },
      select: { id: true },
    });

    // Reported, never silently dropped - a gap here means our catalogue is
    // missing something, which is worth knowing.
    if (!course) {
      skippedNoCourse += 1;
      continue;
    }

    const term = await db.term.findFirst({
      where: { year: row.year, session: row.session, campus: 'V' },
      select: { id: true },
    });

    // Our Term catalogue only covers current/near-term periods (Phase 1
    // scraped current terms, not history), while grade data spans several
    // past years. Falling back to a bare "" sentinel for every unmatched
    // year would collapse ALL unmatched years onto the same compound key,
    // silently overwriting one year's grades with the next's. Encode the
    // row's own year+session into the sentinel so distinct years stay
    // distinct even without a real Term match.
    const termId = term?.id ?? `unmatched-${row.year}${row.session}`;

    const distribution = await db.gradeDistribution.upsert({
      where: {
        // "" sentinels, not null: Prisma rejects nullable fields in a
        // compound-key where clause (same constraint Phase 3 hit).
        courseId_termId_sectionCode_detail: {
          courseId: course.id,
          termId,
          sectionCode: row.sectionCode,
          detail: row.detail ?? '',
        },
      },
      create: {
        courseId: course.id,
        termId,
        sectionCode: row.sectionCode,
        detail: row.detail ?? '',
        average: row.average,
        median: row.median,
        high: row.high,
        low: row.low,
        count: row.reported,
        distribution: row.distribution,
      },
      update: {
        average: row.average,
        median: row.median,
        high: row.high,
        low: row.low,
        count: row.reported,
        distribution: row.distribution,
      },
      select: { id: true },
    });
    written += 1;

    // Replace links wholesale so a corrected upstream professor list doesn't
    // leave a stale attribution behind.
    await db.gradeDistributionInstructor.deleteMany({
      where: { distributionId: distribution.id },
    });

    // One row can name the same person twice under spelling variants that
    // normalize to a single slug - real 2015S data lists both
    // "Brianne Orr Alvarez" and "Brianne Orr-Alvarez" on SPAN 102. Linking
    // twice violates GradeDistributionInstructor's (distributionId,
    // instructorId) primary key and aborts the whole ingest.
    const linkedSlugs = new Set<string>();

    for (const raw of row.professors) {
      const { slug } = normalizeInstructorName(raw);
      if (!slug || linkedSlugs.has(slug)) continue;
      linkedSlugs.add(slug);

      const instructor = await db.instructor.findUnique({
        where: { slug },
        select: { id: true },
      });

      // Exact match only. Attaching one professor's grades to a similarly
      // named person is worse than showing no attribution (spec 5).
      if (!instructor) {
        unmatched.add(raw);
        continue;
      }

      await db.gradeDistributionInstructor.create({
        data: { distributionId: distribution.id, instructorId: instructor.id },
      });
    }
  }

  return { written, skippedNoCourse, unmatchedProfessors: [...unmatched] };
}

export async function ingestGrades() {
  const subjects = await db.subject.findMany({
    where: { campus: 'V', code: { not: null } },
    select: { code: true },
  });

  let written = 0;
  let skipped = 0;
  const unmatched = new Set<string>();

  for (const session of SESSIONS) {
    for (const { code } of subjects) {
      let csv: string;
      try {
        csv = await fetchText(gradeCsvUrl(session, code!));
      } catch {
        // Not every subject exists in every session - a 404 is normal here.
        continue;
      }

      const result = await ingestRows(parseGradeCsv(csv));
      written += result.written;
      skipped += result.skippedNoCourse;
      result.unmatchedProfessors.forEach((p) => unmatched.add(p));
    }
    console.log(`${session}: ${written} rows so far`);
  }

  console.log(
    `Done. ${written} distributions, ${skipped} rows skipped (course not in catalogue), ` +
      `${unmatched.size} professor names unmatched.`,
  );
}
