import { db } from '@/lib/db';
import { toSectionHit, type SectionHit } from '@/lib/search';
import type { EnrollmentRow } from '@/upload/parse-workday';

export type ScheduleImport = {
  termId: string;
  termName: string;
  matched: SectionHit[];
  /** "CPSC 110-L1U" for rows whose section is not in our catalogue. */
  unmatched: string[];
  /** Rows for a real term other than the one being imported. */
  otherTerm: string[];
};

function label(row: EnrollmentRow): string {
  return `${row.subjectCode} ${row.courseNumber}${row.sectionCode ? `-${row.sectionCode}` : ''}`;
}

/**
 * Resolves parsed Workday registration rows to catalogue sections. Writes
 * nothing — this exists so a student can preview their real timetable in the
 * builder without the identity binding that /api/upload performs.
 *
 * A schedule covers ONE term, but an export can span two (a student registered
 * in both Winter terms). The term with the most rows wins and the rest are
 * reported, never silently dropped.
 *
 * ponytail: dominant-term-wins rather than a term picker. If real exports turn
 * out to routinely straddle terms, this is where a picker goes.
 */
export async function matchWorkdayRows(rows: EnrollmentRow[]): Promise<ScheduleImport | null> {
  // Resolve each row's term once. Distinct terms per export are few, so this
  // is a handful of queries rather than one per row.
  const termCache = new Map<string, { id: string; name: string } | null>();
  const resolved: { row: EnrollmentRow; term: { id: string; name: string } | null }[] = [];

  for (const row of rows) {
    const key = `${row.termYear}|${row.termSession}|${row.termNumber}|${row.campus}`;
    if (!termCache.has(key)) {
      termCache.set(
        key,
        await db.term.findFirst({
          where: {
            year: row.termYear,
            session: row.termSession,
            termNumber: row.termNumber,
            campus: row.campus,
          },
          select: { id: true, name: true },
        }),
      );
    }
    resolved.push({ row, term: termCache.get(key)! });
  }

  const counts = new Map<string, number>();
  for (const { term } of resolved) {
    if (term) counts.set(term.id, (counts.get(term.id) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  const [dominantId] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const dominant = resolved.find((r) => r.term?.id === dominantId)!.term!;

  const matched: SectionHit[] = [];
  const unmatched = new Set<string>();
  const otherTerm: string[] = [];
  const seen = new Set<string>();

  for (const { row, term } of resolved) {
    if (!term) {
      unmatched.add(`${label(row)} — term not in our catalogue`);
      continue;
    }
    if (term.id !== dominantId) {
      otherTerm.push(`${label(row)} (${term.name})`);
      continue;
    }
    // Refuse to guess: with no section code, findFirst below would return an
    // arbitrary section for the course (e.g. the lecture instead of the lab).
    if (!row.sectionCode) {
      unmatched.add(`${label(row)} — no section number in the export`);
      continue;
    }

    const section = await db.section.findFirst({
      where: {
        termId: dominantId,
        sectionCode: row.sectionCode,
        course: {
          number: row.courseNumber,
          campus: row.campus,
          subject: { code: row.subjectCode },
        },
      },
      include: { meetingTimes: true, course: { include: { subject: true } } },
    });

    if (!section) {
      unmatched.add(`${label(row)} — no matching section`);
      continue;
    }
    // An export lists a section once per meeting block, so the same section
    // can appear more than once.
    if (seen.has(section.id)) continue;
    seen.add(section.id);
    matched.push(toSectionHit(section));
  }

  return { termId: dominant.id, termName: dominant.name, matched, unmatched: [...unmatched], otherTerm };
}
