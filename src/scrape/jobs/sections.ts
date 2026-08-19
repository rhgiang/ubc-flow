import { db } from '@/lib/db';
import { sectionPages } from '@/scrape/fetch-json';
import {
  buildIncludedMap,
  parseSectionNode,
  type RawSection,
} from '@/scrape/parse-nodes';
import { normalizeInstructorName } from '@/scrape/names';

const CAMPUS = 'V';
const MIN_RETAINED_FRACTION = 0.8;

export async function fetchSectionsForTerm(ubcPeriodId: string): Promise<RawSection[]> {
  const out: RawSection[] = [];
  for await (const { data, included } of sectionPages(ubcPeriodId)) {
    const map = buildIncludedMap(included);
    for (const node of data) out.push(parseSectionNode(node, map));
  }
  return out;
}

/** Returns the count of rows actually written (reached db.section.upsert), not merely parsed. */
export async function upsertSections(rows: RawSection[], termId: string): Promise<number> {
  let written = 0;
  for (const row of rows) {
    // A section whose course is missing or unparseable has nothing to hang off.
    if (!row.course || row.course.campus !== CAMPUS) continue;
    if (!row.sectionCode) continue;

    // Exact match on UBC's own subject id — the same value Task 5 stored from the
    // dropdown. Never match on name or code: the dropdown says "Computer Science
    // (Vancouver)", course rows say "CPSC", and those never compare equal.
    if (!row.course.ubcSubjectId) continue;
    const subject = await db.subject.findUnique({
      where: {
        ubcSubjectId_campus: { ubcSubjectId: row.course.ubcSubjectId, campus: CAMPUS },
      },
    });
    if (!subject) continue;

    // Subject codes appear only on course rows, never the dropdown — fill in on sight.
    if (!subject.code) {
      await db.subject.update({
        where: { id: subject.id },
        data: { code: row.course.subjectCode },
      });
    }

    const course = await db.course.upsert({
      where: { subjectId_number: { subjectId: subject.id, number: row.course.number } },
      create: {
        subjectId: subject.id,
        number: row.course.number,
        title: row.course.title,
        credits: row.course.credits,
        campus: CAMPUS,
        description: row.course.bodyHtml,
      },
      update: {
        title: row.course.title,
        credits: row.course.credits,
        description: row.course.bodyHtml,
      },
    });

    const section = await db.section.upsert({
      where: {
        courseId_termId_sectionCode: {
          courseId: course.id,
          termId,
          sectionCode: row.sectionCode,
        },
      },
      create: {
        courseId: course.id,
        termId,
        sectionCode: row.sectionCode,
        activity: row.activity,
        status: row.status,
        deliveryMode: row.deliveryMode,
      },
      update: {
        activity: row.activity,
        status: row.status,
        deliveryMode: row.deliveryMode,
      },
    });
    written++;

    // Meetings have no natural key; replace wholesale so re-runs stay idempotent.
    await db.meetingTime.deleteMany({ where: { sectionId: section.id } });
    if (row.meetings.length) {
      await db.meetingTime.createMany({
        data: row.meetings.map((m) => ({ ...m, sectionId: section.id })),
      });
    }

    for (const raw of row.instructorNames) {
      const { name, slug } = normalizeInstructorName(raw);
      if (!slug) continue;
      const instructor = await db.instructor.upsert({
        where: { slug },
        create: { name, slug, campus: CAMPUS },
        update: {},
      });
      await db.sectionInstructor.upsert({
        where: {
          sectionId_instructorId: { sectionId: section.id, instructorId: instructor.id },
        },
        create: { sectionId: section.id, instructorId: instructor.id },
        update: {},
      });
    }
  }
  return written;
}

export async function scrapeSections() {
  const now = new Date().getFullYear();
  const terms = await db.term.findMany({
    where: { campus: CAMPUS, year: { gte: now - 2, lte: now + 1 } },
    orderBy: { year: 'asc' },
  });

  for (const term of terms) {
    let rows: RawSection[];
    try {
      rows = await fetchSectionsForTerm(term.ubcPeriodId);
    } catch (e) {
      console.error(`Fetch failed for ${term.name}:`, e);
      continue;
    }

    const usable = rows.filter((r) => r.course && r.course.campus === CAMPUS);
    if (usable.length === 0) {
      console.log(`${term.name}: no Vancouver sections, skipping`);
      continue;
    }

    const previous = await db.section.count({ where: { termId: term.id } });
    if (previous > 0 && usable.length < previous * MIN_RETAINED_FRACTION) {
      console.error(
        `ABORT ${term.name}: parsed ${usable.length} sections vs ${previous} previously. ` +
          'UBC API likely changed — refusing to write.',
      );
      continue;
    }

    const written = await upsertSections(usable, term.id);
    if (written < usable.length * 0.95) {
      console.warn(
        `${term.name}: parsed ${usable.length} sections but only wrote ${written} — ` +
          'check subject/instructor resolution',
      );
    }
    console.log(`${term.name}: ${written} sections`);
  }
}
