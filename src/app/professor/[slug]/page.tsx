import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { aggregateInstructorReviews } from '@/reviews/aggregate';
import { aggregateDistributions } from '@/grades/aggregate';
import GradeChart from '@/components/GradeChart';

const GRADE_DATA_SOURCE = 'https://github.com/DonneyF/ubc-pair-grade-data';

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

  const reviews = await db.instructorReview.findMany({
    where: { instructorId: instructor.id },
    // userId is deliberately NOT selected — reviews are anonymous (spec 5).
    select: {
      id: true,
      liked: true,
      clear: true,
      engaging: true,
      text: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const stats = aggregateInstructorReviews(reviews);

  const gradeRows = await db.gradeDistribution.findMany({
    where: { instructors: { some: { instructorId: instructor.id } } },
    select: { average: true, count: true, distribution: true },
  });
  const grades = aggregateDistributions(
    gradeRows.map((g) => ({
      average: g.average,
      count: g.count,
      distribution: g.distribution as Record<string, number | null> | null,
    })),
  );

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

      <h2 className="mt-10 text-xl font-semibold">Ratings</h2>
      {stats.count === 0 ? (
        <p className="mt-2 text-slate-500">No reviews yet.</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded-lg border p-4">
            <p className="text-xs text-slate-500">Liked</p>
            <p className="text-lg font-semibold">
              {stats.likedPercent !== null ? `${stats.likedPercent}%` : '—'}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-slate-500">Clarity</p>
            <p className="text-lg font-semibold">
              {stats.clear !== null ? `${stats.clear.toFixed(1)}/5` : '—'}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-slate-500">Engagement</p>
            <p className="text-lg font-semibold">
              {stats.engaging !== null ? `${stats.engaging.toFixed(1)}/5` : '—'}
            </p>
          </div>
        </div>
      )}
      {stats.count > 0 && (
        <p className="mt-2 text-sm text-slate-500">
          Based on {stats.count} review{stats.count === 1 ? '' : 's'}
        </p>
      )}

      {stats.count > 0 && (
        <ul className="mt-6 space-y-4">
          {reviews.map((r) => (
            <li key={r.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                {r.liked !== null && <span>{r.liked ? 'Liked' : 'Did not like'}</span>}
                {r.clear !== null && <span>Clarity: {r.clear + 1}/5</span>}
                {r.engaging !== null && <span>Engagement: {r.engaging + 1}/5</span>}
              </div>
              {r.text && <p className="mt-2 whitespace-pre-wrap text-sm">{r.text}</p>}
            </li>
          ))}
        </ul>
      )}

      <h2 className="mt-10 text-xl font-semibold">Grades</h2>
      {grades.sectionCount === 0 ? (
        <p className="mt-2 text-slate-500">No grade data available.</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border p-4">
              <p className="text-xs text-slate-500">Average</p>
              <p className="text-lg font-semibold">
                {grades.average !== null ? `${grades.average.toFixed(1)}%` : '—'}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-slate-500">Students</p>
              <p className="text-lg font-semibold">{grades.studentCount}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-slate-500">Sections</p>
              <p className="text-lg font-semibold">{grades.sectionCount}</p>
            </div>
          </div>
          <div className="mt-4 rounded-lg border p-4">
            <GradeChart distribution={grades.distribution} />
          </div>
          {grades.suppressed && (
            <p className="mt-2 text-sm text-slate-500">
              Some grade ranges were withheld by UBC to protect student privacy and are not
              shown above.
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            Grade data from{' '}
            <a
              href={GRADE_DATA_SOURCE}
              className="text-blue-700 hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              ubc-pair-grade-data
            </a>
            .
          </p>
        </>
      )}

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
