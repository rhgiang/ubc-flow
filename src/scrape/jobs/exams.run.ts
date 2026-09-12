import { db } from '@/lib/db';
import { fetchExamSchedule, ingestExams } from './exams';

async function main() {
  const html = await fetchExamSchedule();
  const { written, skipped } = await ingestExams(html);
  console.log(`exams: wrote ${written} rows`);
  if (skipped.length > 0) {
    console.log(`exams: skipped ${skipped.length} not in catalogue:`, skipped.slice(0, 20));
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
