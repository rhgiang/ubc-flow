import { db } from '@/lib/db';
import { fetchText } from '@/scrape/http';
import { parseFacultyIndex, parseFacultySubjects } from '@/scrape/parse-faculties';

const BASE = 'https://vancouver.calendar.ubc.ca';
const INDEX = `${BASE}/course-descriptions/courses-facultyschoolcollege`;

/** Same refusal threshold the catalogue scraper uses. */
const MIN_RETAINED_FRACTION = 0.8;

/**
 * Fill Subject.faculty from the Academic Calendar's course index.
 *
 * One index fetch plus one per faculty - roughly 25 requests, rate-limited to
 * one a second by fetchText. Not part of scrape:all: faculty membership
 * changes about once a year, unlike sections.
 *
 * A subject listed under more than one faculty keeps the first one seen.
 * Cross-listed subjects are a real thing (ASIC is Arts and Science), and
 * picking one is enough for breadth rules, which ask whether a course is Arts
 * rather than which department owns it.
 */
export async function scrapeFaculties() {
  const faculties = parseFacultyIndex(await fetchText(INDEX));
  if (faculties.length === 0) {
    throw new Error('Refusing to write: parsed 0 faculties. Calendar markup likely changed.');
  }
  console.log(`found ${faculties.length} faculties/schools`);

  const facultyOf = new Map<string, string>();
  for (const f of faculties) {
    const subjects = parseFacultySubjects(await fetchText(`${BASE}${f.path}`));
    for (const code of subjects) {
      if (!facultyOf.has(code)) facultyOf.set(code, f.name);
    }
    console.log(`  ${f.name}: ${subjects.length} subjects`);
  }

  const known = await db.subject.count({ where: { code: { not: null } } });
  const matched = [...facultyOf.keys()].length;
  if (known > 0 && matched < known * MIN_RETAINED_FRACTION) {
    console.error(
      `ABORT: mapped ${matched} subject codes but the database holds ${known}. ` +
        'Calendar markup likely changed. Refusing to write.',
    );
    return;
  }

  let updated = 0;
  for (const [code, faculty] of facultyOf) {
    const { count } = await db.subject.updateMany({ where: { code }, data: { faculty } });
    updated += count;
  }
  const unmapped = await db.subject.count({ where: { code: { not: null }, faculty: null } });
  console.log(`updated ${updated} subject rows; ${unmapped} still without a faculty`);
}
