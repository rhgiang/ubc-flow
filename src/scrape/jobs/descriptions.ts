import { db } from '@/lib/db';
import { parseBody } from '@/scrape/parse-body';

/** Converts the raw body HTML staged by the section scrape into clean fields. */
export async function scrapeDescriptions() {
  const courses = await db.course.findMany({
    where: { campus: 'V', description: { startsWith: '<' } },
    select: { id: true, description: true },
  });

  let updated = 0;
  for (const course of courses) {
    const { description, prereqText, coreqText } = parseBody(course.description);
    await db.course.update({
      where: { id: course.id },
      data: { description, prereqText, coreqText },
    });
    updated += 1;
  }

  console.log(`Enriched ${updated} courses.`);
}
