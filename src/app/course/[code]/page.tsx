import { notFound } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db';
import { parseCourseCode } from '@/lib/format';
import { auth } from '@/lib/auth';
import { canReview } from '@/lib/gate';
import { aggregateCourseReviews } from '@/reviews/aggregate';
import { aggregateDistributions } from '@/grades/aggregate';
import GradeChart from '@/components/GradeChart';
import { addSection } from '@/app/actions/schedule';
import RatingsBox from '@/components/RatingsBox';
import RedditButton from '@/components/RedditButton';
import CourseScheduleBox from '@/components/CourseScheduleBox';
import RequirementSidebar from '@/components/RequirementSidebar';
import CourseReviewTabs, {
  type ProfessorGroup,
  type ReviewItem,
} from '@/components/CourseReviewTabs';
import type { TaughtBy } from '@/components/ReviewCard';
import { timeAgo } from '@/lib/relative-time';
import { voteSummary } from '@/reviews/votes';
import HistoricalGradesTimeline from '@/components/HistoricalGradesTimeline';
import { buildCourseGradeHistory } from '@/grades/history';
import { isUpcomingTerm } from '@/schedule/terms';
import type { Requirement } from '@/prereqs/parse';

const GRADE_DATA_SOURCE = 'https://github.com/DonneyF/ubc-pair-grade-data';

// Lecture/lab/tutorial first, in the order a student encounters them;
// anything else (Thesis, Independent Study, ...) sorts after, alphabetically.
const ACTIVITY_ORDER = ['Lecture', 'Laboratory', 'Discussion', 'Recitation', 'Seminar'];
function activityRank(activity: string | null): number {
  const i = ACTIVITY_ORDER.indexOf(activity ?? '');
  return i === -1 ? ACTIVITY_ORDER.length : i;
}

/**
 * Everything on this page that is identical for every visitor, cached for an
 * hour under the 'catalogue' tag. Review writes call revalidateTag('catalogue')
 * so a fresh review shows up immediately rather than after the hour.
 *
 * On a cache hit none of these queries run, which also sidesteps Neon's
 * scale-to-zero wake for the whole catalogue half of the page. Only the
 * per-user queries below (session, votes, my review, my schedules) can ever
 * touch a cold database, and they go out in one parallel wave.
 *
 * createdAt is flattened to epoch ms before returning: the cache round-trips
 * through JSON, which would otherwise silently turn Dates into strings.
 */
async function loadCourseData(subjectCode: string, number: string) {
  const course = await db.course.findFirst({
    where: {
      number,
      subject: { code: subjectCode, campus: 'V' },
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
  if (!course) return null;

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

  // Independent of one another - one round trip to Neon, not four.
  const [reviewRows, gradeRows, leadsToEdges, instructorReviewRows] = await Promise.all([
    db.courseReview.findMany({
      where: { courseId: course.id },
      // userId IS selected here, and never leaves the server: it is the only
      // link between a course review and the instructor reviews the same
      // student wrote, which is what "taught by" is built from. Reviews stay
      // anonymous (spec 5) - nothing rendered carries it.
      select: {
        id: true,
        userId: true,
        liked: true,
        useful: true,
        difficulty: true,
        workloadHours: true,
        text: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    // One query serves both the headline aggregate and the history timeline -
    // they were two identical findMany calls over the same rows.
    db.gradeDistribution.findMany({
      where: { courseId: course.id },
      select: { termId: true, average: true, count: true, distribution: true },
    }),
    db.coursePrereqEdge.findMany({
      where: { requiredCourseId: course.id },
      include: { course: { include: { subject: true } } },
    }),
    db.instructorReview.findMany({
      where: { courseId: course.id },
      select: {
        id: true,
        userId: true,
        instructorId: true,
        liked: true,
        clear: true,
        engaging: true,
        text: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const [realTerms, reviewedInstructors] = await Promise.all([
    db.term.findMany({
      where: { id: { in: [...new Set(gradeRows.map((r) => r.termId))] } },
      select: { id: true, year: true, session: true },
    }),
    // instructorId is a raw FK with no Prisma relation (the same cross-domain
    // convention as CourseReview.courseId), so the names are a second query.
    instructorReviewRows.length
      ? db.instructor.findMany({
          where: { id: { in: [...new Set(instructorReviewRows.map((r) => r.instructorId))] } },
          select: { id: true, name: true, slug: true },
        })
      : [],
  ]);

  return {
    course,
    reviews: reviewRows.map((r) => ({ ...r, createdAt: r.createdAt.getTime() })),
    gradeRows,
    realTerms,
    leadsToEdges,
    instructorReviews: instructorReviewRows.map((r) => ({ ...r, createdAt: r.createdAt.getTime() })),
    reviewedInstructors,
  };
}

const getCoursePageData = unstable_cache(loadCourseData, ['course-page'], {
  revalidate: 3600,
  tags: ['catalogue'],
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const parsed = parseCourseCode(code);
  if (!parsed) return {};
  const data = await getCoursePageData(parsed.subjectCode, parsed.number);
  if (!data) return {};
  const { course } = data;
  const codeLabel = `${course.subject.code} ${course.number}`;
  // The description a student would search for, trimmed to snippet length.
  const description = course.description
    ? course.description.length > 160
      ? `${course.description.slice(0, 157)}...`
      : course.description
    : `Grades, reviews, prerequisites and sections for ${codeLabel} at UBC.`;
  const title = `${codeLabel} · ${course.title}`;
  return {
    title,
    description,
    alternates: {
      canonical: `/course/${(course.subject.code ?? parsed.subjectCode).toLowerCase()}-${course.number.toLowerCase()}`,
    },
    openGraph: { title, description },
  };
}

export default async function CoursePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const parsed = parseCourseCode(code);
  if (!parsed) notFound();

  const data = await getCoursePageData(parsed.subjectCode, parsed.number);
  if (!data) notFound();
  const {
    course,
    reviews,
    gradeRows,
    realTerms,
    leadsToEdges,
    instructorReviews,
    reviewedInstructors,
  } = data;

  const stats = aggregateCourseReviews(reviews);
  const grades = aggregateDistributions(
    gradeRows.map((g) => ({
      average: g.average,
      count: g.count,
      distribution: g.distribution as Record<string, number | null> | null,
    })),
  );
  // Grade history from our OWN section rows, so the trend, the section spread
  // and the headline average above all describe the same window and the same
  // underlying numbers.
  const history = buildCourseGradeHistory(
    gradeRows,
    new Map(realTerms.map((t) => [t.id, { year: t.year, session: t.session }])),
  );

  const leadsTo = leadsToEdges.map((e) => ({
    code: `${e.course.subject.code} ${e.course.number}`,
    courseId: e.courseId,
  }));

  const antireqs = (course.antireqCodes as { code: string; courseId: string | null }[] | null) ?? [];

  const instructorById = new Map(reviewedInstructors.map((i) => [i.id, i]));

  // Who each reviewer said taught them, for the "taught by" line. A student may
  // review more than one instructor for a course, so this is a list.
  const taughtByUser = new Map<string, TaughtBy[]>();
  for (const r of instructorReviews) {
    const instructor = instructorById.get(r.instructorId);
    if (!instructor) continue;
    const list = taughtByUser.get(r.userId) ?? [];
    list.push({ name: instructor.name, slug: instructor.slug });
    taughtByUser.set(r.userId, list);
  }

  // The per-user half - never cached, and one parallel wave instead of four
  // sequential awaits.
  const session = await auth();
  const viewerId = session?.user?.id ?? null;
  const [{ counts: voteCounts, mine: myVotes }, mayReview, myReview, mySchedules] =
    await Promise.all([
      voteSummary(
        [...reviews.map((r) => r.id), ...instructorReviews.map((r) => r.id)],
        viewerId,
      ),
      viewerId ? canReview(viewerId, course.id) : false,
      viewerId
        ? db.courseReview.findUnique({
            where: { userId_courseId: { userId: viewerId, courseId: course.id } },
            select: { id: true },
          })
        : null,
      viewerId
        ? db.savedSchedule.findMany({
            where: { userId: viewerId },
            select: { id: true, name: true, termId: true },
          })
        : [],
    ]);

  const now = new Date();

  const courseReviewItems: ReviewItem[] = reviews.map((r) => ({
    id: r.id,
    text: r.text,
    liked: r.liked,
    when: timeAgo(new Date(r.createdAt), now),
    createdAt: r.createdAt,
    votes: voteCounts.get(r.id) ?? 0,
    voted: myVotes.has(r.id),
    taughtBy: taughtByUser.get(r.userId) ?? [],
    tags: [
      ...(r.useful !== null ? [{ label: 'Useful', value: `${r.useful + 1}/5` }] : []),
      ...(r.difficulty !== null ? [{ label: 'Difficulty', value: `${r.difficulty + 1}/5` }] : []),
      ...(r.workloadHours !== null
        ? [{ label: 'Workload', value: `${r.workloadHours} hrs/wk` }]
        : []),
    ],
  }));

  // Grouped under the professor they are about — a flat list never said which
  // one any of them belonged to.
  const professorGroups: ProfessorGroup[] = [];
  const groupByInstructor = new Map<string, ProfessorGroup>();
  for (const r of instructorReviews) {
    const instructor = instructorById.get(r.instructorId);
    if (!instructor) continue;
    let group = groupByInstructor.get(r.instructorId);
    if (!group) {
      group = {
        instructorId: r.instructorId,
        name: instructor.name,
        slug: instructor.slug,
        reviews: [],
      };
      groupByInstructor.set(r.instructorId, group);
      professorGroups.push(group);
    }
    group.reviews.push({
      id: r.id,
      text: r.text,
      liked: r.liked,
      when: timeAgo(new Date(r.createdAt), now),
      createdAt: r.createdAt,
      votes: voteCounts.get(r.id) ?? 0,
      voted: myVotes.has(r.id),
      tags: [
        ...(r.clear !== null ? [{ label: 'Clear', value: `${r.clear + 1}/5` }] : []),
        ...(r.engaging !== null ? [{ label: 'Engaging', value: `${r.engaging + 1}/5` }] : []),
      ],
    });
  }
  professorGroups.sort((a, b) => b.reviews.length - a.reviews.length || a.name.localeCompare(b.name));

  // One server action per section, closing over its id — same mechanism the
  // old inline sections table used, just built ahead of the client
  // CourseScheduleBox so the actions can be passed down as props.
  const addToScheduleActions: Record<string, (formData: FormData) => Promise<void>> = {};
  for (const s of course.sections) {
    if (!isUpcomingTerm(s.term)) continue;
    const sectionId = s.id;
    addToScheduleActions[sectionId] = async function addToScheduleAction(formData: FormData) {
      'use server';
      const scheduleId = String(formData.get('scheduleId') ?? '');
      if (scheduleId) await addSection(scheduleId, sectionId);
    };
  }

  const redditHref = `https://www.reddit.com/r/UBC/search/?q=${encodeURIComponent(`${course.subject.code} ${course.number}`)}`;

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      {/* Course identity sits on the sky; everything below it lives on one
          solid panel, so the background reads as a border around the content. */}
      {/* Identity and ratings side by side on the sky, above the panel: the
          two things you read first, read together. Centred against each other
          rather than top-aligned — the title block is half the card's height,
          and hanging it from the top left an obvious hole under it. */}
      <div className="grid gap-8 lg:grid-cols-[1fr_32rem] lg:items-start">
        <div className="sky-hero min-w-0">
          <p className="text-sm text-text-tertiary">{course.subject.name}</p>
          <h1 className="text-3xl font-semibold">
            {course.subject.code} {course.number}
          </h1>
          <p className="mt-1 text-lg text-foreground">{course.title}</p>

          {course.credits !== null && (
            <p className="mt-2 text-sm text-text-tertiary">{course.credits} credits</p>
          )}

          {/* Description belongs with the title, not buried at the top of the
              panel below it — this is the block a student reads first. */}
          {course.description && (
            <p className="mt-4 leading-relaxed">{course.description}</p>
          )}

          <div className="mt-5">
            <RedditButton
              tone="glass"
              href={redditHref}
              label={`Search Reddit for ${course.subject.code} ${course.number}`}
            />
          </div>
        </div>

        <div className="min-w-0">
          {/* No "Ratings" heading: the card says liked, useful and difficulty
              on its face, and the heading was only there to push it out of
              line with the title. */}
          <div>
            <RatingsBox
              tone="glass"
              action={
                mayReview ? (
                  <Link
                    href={`/course/${code}/review`}
                    className="rounded-pill bg-brand px-4 py-1.5 text-xs font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100"
                  >
                    {myReview ? 'Edit your review' : 'Write a review'}
                  </Link>
                ) : null
              }
              likedPercent={stats.likedPercent}
              ratingCount={stats.count}
              commentCount={courseReviewItems.filter((r) => r.text !== null).length}
              metrics={[
                { label: 'Useful', mean: stats.useful, histogram: stats.histograms.useful },
                {
                  label: 'Difficulty',
                  mean: stats.difficulty,
                  histogram: stats.histograms.difficulty,
                  higherIsBetter: false,
                },
              ]}
            />
          </div>
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

          {history.terms.length > 0 && (
            <div className="mt-6 rounded-card border border-border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">Historical Averages</p>
                <p className="text-xs text-text-tertiary">
                  {history.terms[0].year}–{history.terms[history.terms.length - 1].year}
                </p>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-text-secondary">Lowest section avg</p>
                  <p className="text-lg font-semibold text-foreground">
                    {history.lowestSection !== null
                      ? `${history.lowestSection.toFixed(1)}%`
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-secondary">Highest section avg</p>
                  <p className="text-lg font-semibold text-foreground">
                    {history.highestSection !== null
                      ? `${history.highestSection.toFixed(1)}%`
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-secondary">Terms offered</p>
                  <p className="text-lg font-semibold text-foreground">{history.terms.length}</p>
                </div>
              </div>

              <div className="mt-5">
                <HistoricalGradesTimeline terms={history.terms} />
              </div>
            </div>
          )}

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
          <div id="reviews" className="scroll-mt-24" />
          <CourseReviewTabs
            courseReviews={courseReviewItems}
            professorGroups={professorGroups}
            signedIn={viewerId !== null}
          />
        </div>

        <RequirementSidebar
          courseCode={`${course.subject.code} ${course.number}`}
          prereqTree={course.prereqTree as unknown as Requirement | null}
          coreqTree={course.coreqTree as unknown as Requirement | null}
          prereqText={course.prereqText}
          coreqText={course.coreqText}
          antireqs={antireqs}
          leadsTo={leadsTo}
        />
      </div>
      </div>
    </main>
  );
}
