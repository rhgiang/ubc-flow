import { db } from '@/lib/db';
import { scrapeCatalog } from '@/scrape/jobs/catalog';

scrapeCatalog()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
