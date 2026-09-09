import { db } from '@/lib/db';
import { toSectionHit, sectionHitInclude, type SectionHit } from '@/lib/search';
import type { EnrollmentRow } from '@/upload/parse-workday';

/** One term's worth of an export. A schedule covers exactly one of these. */
export type ImportedTerm = {
  termId: string;
  termName: string;
  matched: SectionHit[];
  /** "CPSC 110-L1U" for rows in this term whose section we couldn't resolve. */
  unmatched: string[];
};

export type ScheduleImport = {
  /** Every term present in the export, most sections first. */
  terms: ImportedTerm[];
  /** Rows whose term isn't in our catalogue at all, so no schedule can hold them. */
  unknownTerm: string[];
};

function label(row: EnrollmentRow): string {
  return `${row.subjectCode} ${row.courseNumber}${row.sectionCode ? `-${row.sectionCode}` : ''}`;
}

/**
 * The catalogue carries no room at all — UBC's course API exposes no location
 * anywhere (see scrape/parse-nodes) — and lags on instructors, but the
 * student's own Workday export has both. Fill only what the catalogue left
 * empty, so the catalogue stays authoritative wherever it has an answer.
 */
function withExportDetails(hit: SectionHit, row: EnrollmentRow): SectionHit {
  return {
    ...hit,
    meetingTimes: hit.meetingTimes.map((m) =>
      m.building || m.room || !row.days.includes(m.day)
        ? m
        : { ...m, building: row.building, room: row.room },
    ),
    instructors:
      hit.instructors.length > 0 || !row.instructor ? hit.instructors : [row.instructor],
  };
}

/**
 * Resolves parsed Workday registration rows to catalogue sections. Writes
 * nothing — this exists so a student can preview their real timetable in the
 * builder without the identity binding that /api/upload performs.
 *
 * A schedule covers ONE term, but a real export usually spans two — a student
 * registered in both Winter terms exports both at once. Every term is
 * resolved and returned so the caller can offer a choice (and a schedule per
 * term); this used to keep only the term with the most rows and list the
 * rest as "a different term", which silently stranded half a timetable.
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
        // An academic-record row has no term to resolve; it is not a schedule
        // and never appears in the term picker.
        row.termYear === null || row.termSession === null
          ? null
          : await db.term.findFirst({
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

  if (resolved.every((r) => r.term === null)) return null;

  // One bucket per real term, built in first-seen order and sorted at the end.
  const byTerm = new Map<string, ImportedTerm>();
  const unknownTerm: string[] = [];
  const seen = new Set<string>();

  for (const { row, term } of resolved) {
    if (!term) {
      unknownTerm.push(`${label(row)}: term not in our catalogue`);
      continue;
    }

    let bucket = byTerm.get(term.id);
    if (!bucket) {
      bucket = { termId: term.id, termName: term.name, matched: [], unmatched: [] };
      byTerm.set(term.id, bucket);
    }

    // Refuse to guess: with no section code, findFirst below would return an
    // arbitrary section for the course (e.g. the lecture instead of the lab).
    if (!row.sectionCode) {
      bucket.unmatched.push(`${label(row)}: no section number in the export`);
      continue;
    }

    const section = await db.section.findFirst({
      where: {
        termId: term.id,
        sectionCode: row.sectionCode,
        course: {
          number: row.courseNumber,
          campus: row.campus,
          subject: { code: row.subjectCode },
        },
      },
      include: sectionHitInclude,
    });

    if (!section) {
      bucket.unmatched.push(`${label(row)}: no matching section`);
      continue;
    }
    // A section parses to one row per weekly pattern, so the same section can
    // appear more than once. It is matched once; each later row still fills
    // its own days' rooms (a Friday class can be in a different room).
    if (seen.has(section.id)) {
      const i = bucket.matched.findIndex((h) => h.sectionId === section.id);
      if (i !== -1) bucket.matched[i] = withExportDetails(bucket.matched[i], row);
      continue;
    }
    seen.add(section.id);
    bucket.matched.push(withExportDetails(toSectionHit(section), row));
  }

  // Most sections first: whichever term the export is mostly about is the one
  // the student most likely wants loaded first.
  const terms = [...byTerm.values()].sort((a, b) => b.matched.length - a.matched.length);

  // De-duplicate the per-term unmatched lists, which can repeat a course that
  // appears once per meeting block.
  for (const t of terms) t.unmatched = [...new Set(t.unmatched)];

  return { terms, unknownTerm: [...new Set(unknownTerm)] };
}
