import { db } from '@/lib/db';
import { scrapeDescriptions } from '@/scrape/jobs/descriptions';

scrapeDescriptions()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
