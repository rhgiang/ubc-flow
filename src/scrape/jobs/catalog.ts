import { db } from '@/lib/db';
import { fetchText } from '@/scrape/http';
import { parseCatalogForm } from '@/scrape/parse-catalog';

const SEARCH_URL = 'https://courses.students.ubc.ca/course-search';
const MIN_RETAINED_FRACTION = 0.8;

export async function scrapeCatalog() {
  const html = await fetchText(SEARCH_URL);
  const { terms, subjects } = parseCatalogForm(html);

  if (terms.length === 0 || subjects.length === 0) {
    throw new Error(
      `Refusing to write: parsed ${terms.length} terms, ${subjects.length} subjects. ` +
        'UBC markup likely changed.',
    );
  }

  const previousTerms = await db.term.count();
  const previousSubjects = await db.subject.count();
  if (
    (previousTerms > 0 && terms.length < previousTerms * MIN_RETAINED_FRACTION) ||
    (previousSubjects > 0 && subjects.length < previousSubjects * MIN_RETAINED_FRACTION)
  ) {
    console.error(
      `ABORT: parsed ${terms.length} terms (had ${previousTerms}), ${subjects.length} subjects ` +
        `(had ${previousSubjects}). UBC markup likely changed — refusing to write.`,
    );
    return;
  }

  for (const t of terms) {
    await db.term.upsert({
      where: { ubcPeriodId: t.ubcPeriodId },
      create: t,
      update: t,
    });
  }

  for (const s of subjects) {
    await db.subject.upsert({
      where: { ubcSubjectId_campus: { ubcSubjectId: s.ubcSubjectId, campus: s.campus } },
      create: s,
      update: { name: s.name },
    });
  }

  console.log(`Upserted ${terms.length} terms, ${subjects.length} subjects.`);
}
