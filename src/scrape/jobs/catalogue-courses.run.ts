import { db } from '@/lib/db';
import { scrapeCatalogueCourses } from '@/scrape/jobs/catalogue-courses';

scrapeCatalogueCourses()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
