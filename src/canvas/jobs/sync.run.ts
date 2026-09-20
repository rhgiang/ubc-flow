import { db } from '@/lib/db';
import { syncAllFeeds } from '@/canvas/jobs/sync-all';

syncAllFeeds()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
