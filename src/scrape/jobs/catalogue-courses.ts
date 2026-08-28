import { db } from '@/lib/db';
import { fetchText } from '@/scrape/http';
import { parseCourseDescriptions, subjectPath } from '@/scrape/parse-course-descriptions';

const BASE = 'https://vancouver.calendar.ubc.ca';
const CAMPUS = 'V';

/** Same refusal threshold the other scrapers use. */
const MIN_RETAINED_FRACTION = 0.8;

/**
 * Create Course rows for every course the Calendar lists, offered or not.
 *
 * The sections scraper creates a course only when it meets a section, so the
 * course table has been "courses offered in a term we scraped" rather than
 * the catalogue. Courses on hiatus, or running only in terms outside the
 * scraped window, were absent entirely — no Explore result, no course page,
 * no reviews, and a hole in the prerequisite graph wherever one was required.
 *
 * One request per subject, rate-limited to one a second by fetchText, so
 * roughly four minutes for Vancouver. Kept out of scrape:all: the catalogue
 * changes on the Calendar's yearly cycle, not per term.
 *
 * Existing rows are updated in title and credits only. Descriptions,
 * prerequisite text and the parsed trees belong to the descriptions and
 * prereq jobs, and clobbering them here would quietly undo that work.
 */
export async function scrapeCatalogueCourses() {
  const subjects = await db.subject.findMany({
    where: { campus: CAMPUS, code: { not: null } },
    select: { id: true, code: true },
    orderBy: { code: 'asc' },
  });
  if (subjects.length === 0) {
    throw new Error('Refusing to run: no subjects. Run scrape:catalog first.');
  }
  console.log(`${subjects.length} subjects to read`);

  const before = await db.course.count({ where: { campus: CAMPUS } });
  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const subject of subjects) {
    const code = subject.code as string;
    let courses;
    try {
      courses = parseCourseDescriptions(
        await fetchText(`${BASE}${subjectPath(code, CAMPUS)}`),
        CAMPUS,
      );
    } catch {
      // A subject with no Calendar page is normal — not every subject code in
      // the course-search dropdown has a description page.
      failed++;
      continue;
    }

    for (const c of courses) {
      if (c.subjectCode !== code) continue; // a page can cite other subjects
      const existing = await db.course.findUnique({
        where: { subjectId_number: { subjectId: subject.id, number: c.number } },
        select: { id: true },
      });
      if (existing) {
        await db.course.update({
          where: { id: existing.id },
          data: { title: c.title, ...(c.credits === null ? {} : { credits: c.credits }) },
        });
        updated++;
      } else {
        await db.course.create({
          data: {
            subjectId: subject.id,
            number: c.number,
            title: c.title,
            credits: c.credits,
            campus: CAMPUS,
          },
        });
        created++;
      }
    }
  }

  const after = await db.course.count({ where: { campus: CAMPUS } });
  if (before > 0 && after < before * MIN_RETAINED_FRACTION) {
    console.error(`ABORT-WORTHY: course count fell from ${before} to ${after}.`);
  }
  console.log(
    `created ${created}, updated ${updated}, ${failed} subject page(s) unavailable. ` +
      `Courses: ${before} -> ${after}.`,
  );
}
