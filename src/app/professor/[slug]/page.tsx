import { notFound } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth';
import { aggregateInstructorReviews } from '@/reviews/aggregate';
import { aggregateDistributions } from '@/grades/aggregate';
import GradeChart from '@/components/GradeChart';
import RatingsBox from '@/components/RatingsBox';
import ReviewCard from '@/components/ReviewCard';
import { timeAgo } from '@/lib/relative-time';
import { voteSummary } from '@/reviews/votes';
import { rmpSearchHref } from '@/lib/rmp';

const GRADE_DATA_SOURCE = 'https://github.com/DonneyF/ubc-pair-grade-data';

/**
 * The whole page is visitor-independent, so all of it caches under the
 * 'catalogue' tag (review writes revalidate the tag). createdAt is flattened
 * to epoch ms: the cache round-trips through JSON, which would otherwise
 * silently turn Dates into strings.
 */
async function loadProfessorData(slug: string) {
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
  if (!instructor) return null;

  // Independent of one another - one round trip, not two.
  const [reviewRows, gradeRows] = await Promise.all([
    db.instructorReview.findMany({
      where: { instructorId: instructor.id },
      // userId is deliberately NOT selected - reviews are anonymous (spec 5).
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
    }),
    db.gradeDistribution.findMany({
      where: { instructors: { some: { instructorId: instructor.id } } },
      select: { average: true, count: true, distribution: true },
    }),
  ]);

  // InstructorReview.courseId has no Prisma relation to Course (raw FK, same
  // convention as SavedSchedule.termId elsewhere in this app) - resolve each
  // review's course code/title via a fresh lookup rather than joining
  // against `instructor.sections` (that list is keyed by course code string,
  // not courseId, so it can't be joined directly).
  const reviewCourseIds = [...new Set(reviewRows.map((r) => r.courseId))];
  const reviewCourses = reviewCourseIds.length
    ? await db.course.findMany({
        where: { id: { in: reviewCourseIds } },
        include: { subject: true },
      })
    : [];

  return {
    instructor,
    reviews: reviewRows.map((r) => ({ ...r, createdAt: r.createdAt.getTime() })),
    reviewCourses,
    gradeRows,
  };
}

const getProfessorData = unstable_cache(loadProfessorData, ['professor-page'], {
  revalidate: 86400,
  tags: ['catalogue'],
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getProfessorData(slug);
  if (!data) return {};
  const { instructor } = data;
  const description = `Student ratings, grade distributions and courses taught by ${instructor.name} at UBC.`;
  return {
    title: instructor.name,
    description,
    alternates: { canonical: `/professor/${slug}` },
    openGraph: { title: instructor.name, description },
  };
}

export default async function ProfessorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const data = await getProfessorData(slug);
  if (!data) notFound();
  const { instructor, reviews, reviewCourses, gradeRows } = data;

  const stats = aggregateInstructorReviews(reviews);

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

  const session = await auth();
  const viewerId = session?.user?.id ?? null;
  const { counts: voteCounts, mine: myVotes } = await voteSummary(
    reviews.map((r) => r.id),
    viewerId,
  );

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      {/* Same arrangement as a course page: identity and blurb on the sky at
          the left, the ratings card floating beside them. */}
      <div className="grid gap-8 lg:grid-cols-[1fr_32rem] lg:items-start">
        <div className="sky-hero min-w-0">
          <h1 className="text-3xl font-semibold">{instructor.name}</h1>
          <p className="mt-1 text-sm text-text-tertiary">
            {courses.length} course{courses.length === 1 ? '' : 's'} taught
          </p>

          <p className="mt-4 leading-relaxed">
            Ratings come from students who took a course with {instructor.name} and reviewed it
            here. Their comments sit under each course below.
          </p>

          <a
            href={rmpHref}
            target="_blank"
            rel="noreferrer"
            className="sky-capsule mt-5 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] active:scale-100"
          >
            Find {instructor.name} on RateMyProfessors
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              aria-hidden
              className="h-3.5 w-3.5 shrink-0"
            >
              <path d="M14 4h6v6M20 4l-8 8" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" strokeLinecap="round" />
            </svg>
          </a>
        </div>

        <div className="min-w-0">
          <RatingsBox
            tone="glass"
            noun="professor"
            likedPercent={stats.likedPercent}
            ratingCount={stats.count}
            commentCount={reviews.filter((r) => r.text !== null).length}
            metrics={[
              { label: 'Clear', mean: stats.clear, histogram: stats.histograms.clear },
              { label: 'Engaging', mean: stats.engaging, histogram: stats.histograms.engaging },
            ]}
          />
        </div>
      </div>

      <div className="sky-panel mt-8 p-6 sm:p-8">
      <h2 className="text-xl font-semibold">Grades</h2>
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

      <h2 id="reviews" className="mt-10 scroll-mt-24 text-xl font-semibold">Student reviews</h2>
      {courseGroups.length === 0 ? (
        <p className="mt-2 text-text-tertiary">No reviews yet.</p>
      ) : (
        <div className="mt-4 space-y-8">
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
                    liked={r.liked}
                    tags={[
                      ...(r.clear !== null ? [{ label: 'Clear', value: `${r.clear + 1}/5` }] : []),
                      ...(r.engaging !== null ? [{ label: 'Engaging', value: `${r.engaging + 1}/5` }] : []),
                    ]}
                    attribution="A student"
                    when={timeAgo(new Date(r.createdAt))}
                    vote={{
                      kind: 'instructor',
                      votes: voteCounts.get(r.id) ?? 0,
                      voted: myVotes.has(r.id),
                      signedIn: viewerId !== null,
                    }}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      </div>
    </main>
  );
}
