import { db } from '@/lib/db';
import { verifyPrograms } from '@/guidance/jobs/verify';

verifyPrograms()
  .then(async (errors) => {
    await db.$disconnect();
    process.exit(errors === 0 ? 0 : 1);
  })
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
