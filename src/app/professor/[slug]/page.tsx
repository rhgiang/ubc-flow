import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { aggregateInstructorReviews } from '@/reviews/aggregate';
import { aggregateDistributions } from '@/grades/aggregate';
import GradeChart from '@/components/GradeChart';
import RatingsBox from '@/components/RatingsBox';
import ReviewCard from '@/components/ReviewCard';
import { rmpSearchHref } from '@/lib/rmp';

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
      courseId: true,
      liked: true,
      clear: true,
      engaging: true,
      text: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const stats = aggregateInstructorReviews(reviews);

  // InstructorReview.courseId has no Prisma relation to Course (raw FK, same
  // convention as SavedSchedule.termId elsewhere in this app) — resolve each
  // review's course code/title via a fresh lookup rather than joining
  // against `instructor.sections` below (that list is keyed by course code
  // string, not courseId, so it can't be joined directly).
  const reviewCourseIds = [...new Set(reviews.map((r) => r.courseId))];
  const reviewCourses = await db.course.findMany({
    where: { id: { in: reviewCourseIds } },
    include: { subject: true },
  });
  const courseById = new Map(
    reviewCourses.map((c) => [c.id, { code: `${c.subject.code} ${c.number}`, title: c.title }]),
  );

  const reviewsByCourse = new Map<
    string,
    { code: string; title: string; reviews: typeof reviews }
  >();
  for (const r of reviews) {
    const info = courseById.get(r.courseId);
    if (!info) continue;
    const entry = reviewsByCourse.get(r.courseId) ?? { ...info, reviews: [] };
    entry.reviews.push(r);
    reviewsByCourse.set(r.courseId, entry);
  }
  // Most-reviewed course first, matching UW Flow's "Sort courses: most reviews" default.
  const courseGroups = [...reviewsByCourse.entries()]
    .map(([courseId, group]) => ({ courseId, ...group }))
    .sort((a, b) => b.reviews.length - a.reviews.length);

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

  const rmpHref = rmpSearchHref(instructor.name);

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      {/* Professor identity sits on the sky; everything below it lives on one
          solid panel, so the background reads as a border around the content. */}
      <div className="sky-hero">
        <h1 className="text-3xl font-semibold">{instructor.name}</h1>
        <p className="mt-1 text-sm text-text-tertiary">
          {courses.length} course{courses.length === 1 ? '' : 's'} taught
        </p>
      </div>

      <div className="sky-panel mt-6 p-6 sm:p-8">
      <a
        href={rmpHref}
        target="_blank"
        rel="noreferrer"
        className="mt-4 inline-flex items-center gap-1.5 text-sm text-brand-accent hover:underline"
      >
        Find {instructor.name} on RateMyProfessors
      </a>

      <h2 className="mt-10 text-xl font-semibold">Ratings</h2>
      <div className="mt-4">
        <RatingsBox
          likedPercent={stats.likedPercent}
          reviewCount={stats.count}
          metrics={[
            { label: 'Clear', mean: stats.clear, histogram: stats.histograms.clear },
            { label: 'Engaging', mean: stats.engaging, histogram: stats.histograms.engaging },
          ]}
          externalLink={{ href: rmpHref, label: 'View on RateMyProfessors' }}
        />
      </div>

      {courseGroups.length > 0 && (
        <div className="mt-6 space-y-8">
          {courseGroups.map((group) => (
            <div key={group.courseId}>
              <Link
                href={`/course/${group.code.toLowerCase().replace(' ', '-')}`}
                className="text-lg font-semibold text-brand-accent hover:underline"
              >
                {group.code}
              </Link>
              <p className="text-sm text-text-secondary">{group.title}</p>
              <ul className="mt-3 space-y-3">
                {group.reviews.map((r) => (
                  <ReviewCard
                    key={r.id}
                    id={r.id}
                    text={r.text}
                    tags={[
                      ...(r.liked !== null ? [{ label: 'Liked', value: r.liked ? 'Yes' : 'No' }] : []),
                      ...(r.clear !== null ? [{ label: 'Clear', value: `${r.clear + 1}/5` }] : []),
                      ...(r.engaging !== null ? [{ label: 'Engaging', value: `${r.engaging + 1}/5` }] : []),
                    ]}
                    attribution="A student"
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <h2 className="mt-10 text-xl font-semibold">Grades</h2>
      {grades.sectionCount === 0 ? (
        <p className="mt-2 text-text-tertiary">No grade data available.</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border p-4">
              <p className="text-xs text-text-tertiary">Average</p>
              <p className="text-lg font-semibold">
                {grades.average !== null ? `${grades.average.toFixed(1)}%` : '—'}
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-text-tertiary">Students</p>
              <p className="text-lg font-semibold">{grades.studentCount}</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="text-xs text-text-tertiary">Sections</p>
              <p className="text-lg font-semibold">{grades.sectionCount}</p>
            </div>
          </div>
          <div className="mt-4 rounded-lg border p-4">
            <GradeChart distribution={grades.distribution} />
          </div>
          {grades.suppressed && (
            <p className="mt-2 text-sm text-text-tertiary">
              Some grade ranges were withheld by UBC to protect student privacy and are not
              shown above.
            </p>
          )}
          <p className="mt-2 text-xs text-text-tertiary">
            Grade data from{' '}
            <a
              href={GRADE_DATA_SOURCE}
              className="text-brand-accent hover:underline"
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
        <p className="mt-2 text-text-tertiary">No courses on record.</p>
      ) : (
        <ul className="mt-4 divide-y">
          {courses.map((c) => (
            <li key={c.code} className="py-3">
              <Link
                href={`/course/${c.code.toLowerCase().replace(' ', '-')}`}
                className="font-medium text-brand-accent hover:underline"
              >
                {c.code}
              </Link>
              <span className="ml-2 text-foreground">{c.title}</span>
              <p className="mt-1 text-sm text-text-tertiary">{[...c.terms].join(' · ')}</p>
            </li>
          ))}
        </ul>
      )}
      </div>
    </main>
  );
}
