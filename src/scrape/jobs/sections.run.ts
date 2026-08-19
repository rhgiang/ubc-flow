import { db } from '@/lib/db';
import { scrapeSections } from '@/scrape/jobs/sections';

scrapeSections()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
