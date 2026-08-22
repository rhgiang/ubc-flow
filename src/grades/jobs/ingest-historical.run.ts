import { db } from '@/lib/db';
import { ingestHistoricalGrades } from '@/grades/jobs/ingest-historical';

ingestHistoricalGrades()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
