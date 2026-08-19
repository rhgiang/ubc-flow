import { db } from '@/lib/db';
import { fetchText } from '@/scrape/http';
import { parseCatalogForm } from '@/scrape/parse-catalog';

const SEARCH_URL = 'https://courses.students.ubc.ca/course-search';

export async function scrapeCatalog() {
  const html = await fetchText(SEARCH_URL);
  const { terms, subjects } = parseCatalogForm(html);

  if (terms.length === 0 || subjects.length === 0) {
    throw new Error(
      `Refusing to write: parsed ${terms.length} terms, ${subjects.length} subjects. ` +
        'UBC markup likely changed.',
    );
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

scrapeCatalog()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
