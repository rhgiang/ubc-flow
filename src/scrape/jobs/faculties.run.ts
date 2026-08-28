import { db } from '@/lib/db';
import { scrapeFaculties } from '@/scrape/jobs/faculties';

scrapeFaculties()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
