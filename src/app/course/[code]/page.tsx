import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { parseCourseCode } from '@/lib/format';
import { auth } from '@/lib/auth';
import { canReview } from '@/lib/gate';
import { aggregateCourseReviews, aggregateInstructorReviews } from '@/reviews/aggregate';
import { aggregateDistributions } from '@/grades/aggregate';
import GradeChart from '@/components/GradeChart';
import { addSection } from '@/app/actions/schedule';
import RatingsBox from '@/components/RatingsBox';
import CourseScheduleBox from '@/components/CourseScheduleBox';
import RequirementSidebar from '@/components/RequirementSidebar';
import ReviewCard from '@/components/ReviewCard';
import type { Requirement } from '@/prereqs/parse';

const GRADE_DATA_SOURCE = 'https://github.com/DonneyF/ubc-pair-grade-data';

// Lecture/lab/tutorial first, in the order a student encounters them;
// anything else (Thesis, Independent Study, ...) sorts after, alphabetically.
const ACTIVITY_ORDER = ['Lecture', 'Laboratory', 'Discussion', 'Recitation', 'Seminar'];
function activityRank(activity: string | null): number {
  const i = ACTIVITY_ORDER.indexOf(activity ?? '');
  return i === -1 ? ACTIVITY_ORDER.length : i;
}

export default async function CoursePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const parsed = parseCourseCode(code);
  if (!parsed) notFound();

  const course = await db.course.findFirst({
    where: {
      number: parsed.number,
      subject: { code: parsed.subjectCode, campus: 'V' },
    },
    include: {
      subject: true,
      sections: {
        include: {
          term: true,
          meetingTimes: true,
          instructors: { include: { instructor: true } },
        },
        orderBy: [
          { term: { year: 'desc' } },
          { term: { termNumber: 'desc' } },
          { sectionCode: 'asc' },
        ],
      },
    },
  });
  if (!course) notFound();

  // Group lectures with lectures, labs with labs, etc. within each term.
  // Re-derives the term ordering too (not just activity), since a plain
  // comparator replaces Prisma's orderBy rather than refining it.
  course.sections.sort(
    (a, b) =>
      b.term.year - a.term.year ||
      (b.term.termNumber ?? 0) - (a.term.termNumber ?? 0) ||
      activityRank(a.activity) - activityRank(b.activity) ||
      a.sectionCode.localeCompare(b.sectionCode),
  );

  const reviews = await db.courseReview.findMany({
    where: { courseId: course.id },
    // userId is deliberately NOT selected — reviews are anonymous (spec 5).
    select: {
      id: true,
      liked: true,
      useful: true,
      difficulty: true,
      workloadHours: true,
      text: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const stats = aggregateCourseReviews(reviews);

  const gradeRows = await db.gradeDistribution.findMany({
    where: { courseId: course.id },
    select: { average: true, count: true, distribution: true },
  });
  const grades = aggregateDistributions(
    gradeRows.map((g) => ({
      average: g.average,
      count: g.count,
      distribution: g.distribution as Record<string, number | null> | null,
    })),
  );

  const historicalGrades = await db.courseHistoricalGrades.findUnique({
    where: { courseId: course.id },
  });

  const leadsToEdges = await db.coursePrereqEdge.findMany({
    where: { requiredCourseId: course.id },
    include: { course: { include: { subject: true } } },
  });
  const leadsTo = leadsToEdges.map((e) => ({
    code: `${e.course.subject.code} ${e.course.number}`,
    courseId: e.courseId,
  }));

  const antireqs = (course.antireqCodes as { code: string; courseId: string | null }[] | null) ?? [];

  const instructorReviews = await db.instructorReview.findMany({
    where: { courseId: course.id },
    select: { id: true, liked: true, clear: true, engaging: true, text: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  const instructorStats = aggregateInstructorReviews(instructorReviews);

  const session = await auth();
  const mayReview = session?.user?.id
    ? await canReview(session.user.id, course.id)
    : false;
  const myReview = session?.user?.id
    ? await db.courseReview.findUnique({
        where: { userId_courseId: { userId: session.user.id, courseId: course.id } },
        select: { id: true },
      })
    : null;
  const mySchedules = session?.user?.id
    ? await db.savedSchedule.findMany({
        where: { userId: session.user.id },
        select: { id: true, name: true, termId: true },
      })
    : [];

  // One server action per section, closing over its id — same mechanism the
  // old inline sections table used, just built ahead of the client
  // CourseScheduleBox so the actions can be passed down as props.
  const addToScheduleActions: Record<string, (formData: FormData) => Promise<void>> = {};
  for (const s of course.sections) {
    const sectionId = s.id;
    addToScheduleActions[sectionId] = async function addToScheduleAction(formData: FormData) {
      'use server';
      const scheduleId = String(formData.get('scheduleId') ?? '');
      if (scheduleId) await addSection(scheduleId, sectionId);
    };
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-sm text-slate-500">{course.subject.name}</p>
      <h1 className="text-3xl font-semibold">
        {course.subject.code} {course.number}
      </h1>
      <p className="mt-1 text-lg text-slate-700">{course.title}</p>

      {course.credits !== null && (
        <p className="mt-2 text-sm text-slate-500">{course.credits} credits</p>
      )}
      {course.description && <p className="mt-6 leading-relaxed">{course.description}</p>}

      <div className="mt-10 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Ratings</h2>
        {mayReview && (
          <Link href={`/course/${code}/review`} className="text-sm text-brand hover:underline">
            {myReview ? 'Edit your review' : 'Write a review'}
          </Link>
        )}
      </div>
      <div className="mt-4">
        <RatingsBox
          likedPercent={stats.likedPercent}
          reviewCount={stats.count}
          metrics={[
            { label: 'Useful', mean: stats.useful, histogram: stats.histograms.useful },
            { label: 'Easy', mean: stats.difficulty, histogram: stats.histograms.difficulty },
          ]}
        />
      </div>

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

          {historicalGrades && (
            <div className="mt-6 rounded-card border border-border p-4">
              <p className="text-sm font-semibold text-foreground">Historical Averages</p>
              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-text-secondary">Overall average</p>
                  <p className="text-lg font-semibold text-foreground">
                    {historicalGrades.average !== null ? `${historicalGrades.average.toFixed(1)}%` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-secondary">Past 5 years</p>
                  <p className="text-lg font-semibold text-foreground">
                    {historicalGrades.averagePast5Years !== null
                      ? `${historicalGrades.averagePast5Years.toFixed(1)}%`
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-secondary">Lowest section avg</p>
                  <p className="text-lg font-semibold text-foreground">
                    {historicalGrades.minSectionAverage !== null
                      ? `${historicalGrades.minSectionAverage.toFixed(1)}%`
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-secondary">Highest section avg</p>
                  <p className="text-lg font-semibold text-foreground">
                    {historicalGrades.maxSectionAverage !== null
                      ? `${historicalGrades.maxSectionAverage.toFixed(1)}%`
                      : '—'}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs text-text-secondary">
                Historical data from{' '}
                <a
                  href="https://ubcgrades.com"
                  className="text-brand hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  ubcgrades.com
                </a>
                .
              </p>
            </div>
          )}

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

      <div className="mt-10">
        <CourseScheduleBox
          sections={course.sections.map((s) => ({
            id: s.id,
            sectionCode: s.sectionCode,
            activity: s.activity,
            enrolTotal: s.enrolTotal,
            enrolCap: s.enrolCap,
            meetingTimes: s.meetingTimes,
            instructors: s.instructors,
            term: s.term,
          }))}
          mySchedules={session?.user?.id ? mySchedules : undefined}
          addToScheduleActions={addToScheduleActions}
        />
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_300px]">
        <div>
          <div className="flex gap-2 border-b border-border">
            <button
              type="button"
              className="border-b-2 border-brand px-4 py-2 text-sm font-semibold text-foreground"
            >
              Course reviews ({stats.count})
            </button>
            <span className="px-4 py-2 text-sm font-semibold text-text-secondary">
              Professor reviews ({instructorStats.count})
            </span>
          </div>

          {stats.count === 0 ? (
            <p className="mt-4 text-sm text-text-secondary">No reviews yet.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {reviews.map((r) => (
                <ReviewCard
                  key={r.id}
                  id={r.id}
                  text={r.text}
                  tags={[
                    ...(r.liked !== null ? [{ label: 'Liked', value: r.liked ? 'Yes' : 'No' }] : []),
                    ...(r.useful !== null ? [{ label: 'Useful', value: `${r.useful + 1}/5` }] : []),
                    ...(r.difficulty !== null ? [{ label: 'Easy', value: `${r.difficulty + 1}/5` }] : []),
                    ...(r.workloadHours !== null
                      ? [{ label: 'Workload', value: `${r.workloadHours} hrs/wk` }]
                      : []),
                  ]}
                  attribution="A student"
                />
              ))}
            </ul>
          )}

          {instructorStats.count > 0 && (
            <ul className="mt-4 space-y-4">
              {instructorReviews.map((r) => (
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
          )}
        </div>

        <RequirementSidebar
          courseCode={`${course.subject.code} ${course.number}`}
          prereqTree={course.prereqTree as unknown as Requirement | null}
          coreqTree={course.coreqTree as unknown as Requirement | null}
          antireqs={antireqs}
          leadsTo={leadsTo}
        />
      </div>
    </main>
  );
}
