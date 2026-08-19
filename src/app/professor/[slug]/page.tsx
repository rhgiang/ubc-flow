import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';

export default async function ProfessorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const instructor = await db.instructor.findUnique({
    where: { slug },
    include: {
      sections: {
        include: {
          section: {
            include: { term: true, course: { include: { subject: true } } },
          },
        },
      },
    },
  });
  if (!instructor) notFound();

  // One row per course, newest term first.
  const byCourse = new Map<
    string,
    { code: string; title: string; terms: Set<string> }
  >();
  for (const { section } of instructor.sections) {
    const code = `${section.course.subject.code} ${section.course.number}`;
    const entry = byCourse.get(code) ?? {
      code,
      title: section.course.title,
      terms: new Set<string>(),
    };
    entry.terms.add(section.term.name);
    byCourse.set(code, entry);
  }
  const courses = [...byCourse.values()].sort((a, b) => a.code.localeCompare(b.code));

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-3xl font-semibold">{instructor.name}</h1>
      <p className="mt-1 text-sm text-slate-500">
        {courses.length} course{courses.length === 1 ? '' : 's'} taught
      </p>

      <h2 className="mt-10 text-xl font-semibold">Courses</h2>
      {courses.length === 0 ? (
        <p className="mt-2 text-slate-500">No courses on record.</p>
      ) : (
        <ul className="mt-4 divide-y">
          {courses.map((c) => (
            <li key={c.code} className="py-3">
              <Link
                href={`/course/${c.code.toLowerCase().replace(' ', '-')}`}
                className="font-medium text-blue-700 hover:underline"
              >
                {c.code}
              </Link>
              <span className="ml-2 text-slate-700">{c.title}</span>
              <p className="mt-1 text-sm text-slate-500">{[...c.terms].join(' · ')}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
