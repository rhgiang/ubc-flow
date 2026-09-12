import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getCurrentAndNextTerm } from '@/schedule/terms';
import SyllabusList, { type SyllabusListItem } from '@/components/SyllabusList';

export default async function SyllabusPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/login');

  const terms = await db.term.findMany({ where: { campus: 'V' } });
  const currentTermId = getCurrentAndNextTerm(terms).current?.id ?? null;

  const enrollments = currentTermId
    ? await db.enrollment.findMany({ where: { userId, termId: currentTermId }, select: { courseId: true } })
    : [];
  const courseIds = [...new Set(enrollments.map((e) => e.courseId))];

  const courses = courseIds.length
    ? await db.course.findMany({ where: { id: { in: courseIds } }, include: { subject: true } })
    : [];

  const syllabi = currentTermId && courseIds.length
    ? await db.syllabus.findMany({ where: { userId, termId: currentTermId, courseId: { in: courseIds } } })
    : [];
  const syllabusByCourse = new Map(syllabi.map((s) => [s.courseId, s]));

  const items: SyllabusListItem[] = courses
    .map((c) => ({
      courseId: c.id,
      courseLabel: `${c.subject.code?.replace(/_[A-Z]$/, '') ?? ''} ${c.number}`.trim(),
      syllabus: (() => {
        const s = syllabusByCourse.get(c.id);
        return s
          ? { id: s.id, filename: s.filename, size: s.size, extractedAt: s.extractedAt?.toISOString() ?? null }
          : null;
      })(),
    }))
    .sort((a, b) => a.courseLabel.localeCompare(b.courseLabel));

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-semibold sm:text-3xl text-foreground">Syllabus</h1>
      <p className="mt-2 text-sm text-text-secondary">
        Keep this term&apos;s syllabi in one place — private to you.
      </p>

      {!currentTermId ? (
        <p className="mt-6 text-sm text-text-secondary">We couldn&apos;t find the current term.</p>
      ) : items.length === 0 ? (
        <p className="mt-6 text-sm text-text-secondary">
          No courses found for this term yet. Upload your Workday export from the Account page first.
        </p>
      ) : (
        <div className="sky-panel mt-6 p-3 sm:p-8">
          <SyllabusList termId={currentTermId} items={items} />
        </div>
      )}
    </main>
  );
}
