import { db } from '@/lib/db';
import { ingestGrades } from '@/grades/jobs/ingest';

ingestGrades()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
