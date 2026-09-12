import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import ExamList from '@/components/ExamList';
import { examRowsForUser, syllabusExamRowsForUser, mergeExams } from '@/schedule/exams';
import { getCurrentAndNextTerm } from '@/schedule/terms';

export default async function ExamsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/login');

  const terms = await db.term.findMany({ where: { campus: 'V' } });
  const currentTermId = getCurrentAndNextTerm(terms).current?.id ?? null;

  const [scraped, fromSyllabus] = currentTermId
    ? await Promise.all([
        examRowsForUser(userId, currentTermId),
        syllabusExamRowsForUser(userId, currentTermId),
      ])
    : [[], []];
  const items = mergeExams(scraped, fromSyllabus);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold sm:text-3xl text-foreground">Exams</h1>

      <div className="sky-panel mt-6 p-3 sm:p-8">
        <ExamList items={items} />
      </div>
    </main>
  );
}
