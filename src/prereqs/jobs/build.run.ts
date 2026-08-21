import { db } from '@/lib/db';
import { buildRequirementTrees } from '@/prereqs/jobs/build';

buildRequirementTrees()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
