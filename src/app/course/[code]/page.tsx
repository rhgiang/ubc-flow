import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { parseCourseCode, formatMeeting } from '@/lib/format';
import { auth } from '@/lib/auth';
import { canReview } from '@/lib/gate';
import { aggregateCourseReviews } from '@/reviews/aggregate';
import { aggregateDistributions } from '@/grades/aggregate';
import GradeChart from '@/components/GradeChart';
import { addSection } from '@/app/actions/schedule';
import RequirementTree from '@/components/RequirementTree';
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

      {(course.prereqText || course.coreqText) && (
        <div className="mt-6 space-y-4">
          {(
            [
              ['Prerequisites', course.prereqTree, course.prereqText],
              ['Corequisites', course.coreqTree, course.coreqText],
            ] as const
          ).map(([label, tree, text]) =>
            text ? (
              <div key={label} className="rounded-lg border p-4">
                <p className="text-sm font-medium">{label}</p>
                {tree && (
                  <div className="mt-2 text-sm">
                    <RequirementTree node={tree as unknown as Requirement} />
                  </div>
                )}
                {/* The calendar is the authority; our parse is an
                    interpretation, so the original stays one glance away. */}
                <p className="mt-3 text-xs text-slate-500">
                  As published in the calendar: {text}
                </p>
              </div>
            ) : null,
          )}
        </div>
      )}

      <div className="mt-10 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Ratings</h2>
        {mayReview && (
          <Link href={`/course/${code}/review`} className="text-sm text-blue-700 hover:underline">
            {myReview ? 'Edit your review' : 'Write a review'}
          </Link>
        )}
      </div>
      {stats.count === 0 ? (
        <p className="mt-2 text-slate-500">No reviews yet.</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-lg border p-4">
            <p className="text-xs text-slate-500">Liked</p>
            <p className="text-lg font-semibold">
              {stats.likedPercent !== null ? `${stats.likedPercent}%` : '—'}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-slate-500">Usefulness</p>
            <p className="text-lg font-semibold">
              {stats.useful !== null ? `${stats.useful.toFixed(1)}/5` : '—'}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-slate-500">Difficulty</p>
            <p className="text-lg font-semibold">
              {stats.difficulty !== null ? `${stats.difficulty.toFixed(1)}/5` : '—'}
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <p className="text-xs text-slate-500">Workload</p>
            <p className="text-lg font-semibold">
              {stats.workloadHours !== null ? `${stats.workloadHours.toFixed(1)} hrs/wk` : '—'}
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
                {r.liked !== null && <span>{r.liked ? 'Liked it' : 'Did not like it'}</span>}
                {r.useful !== null && <span>Usefulness: {r.useful + 1}/5</span>}
                {r.difficulty !== null && <span>Difficulty: {r.difficulty + 1}/5</span>}
                {r.workloadHours !== null && <span>Workload: {r.workloadHours} hrs/wk</span>}
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

      <h2 className="mt-10 text-xl font-semibold">Sections</h2>
      {course.sections.length === 0 ? (
        <p className="mt-2 text-slate-500">No scheduled sections.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-slate-500">
              <tr>
                <th className="py-2 pr-4">Section</th>
                <th className="py-2 pr-4">Term</th>
                <th className="py-2 pr-4">Activity</th>
                <th className="py-2 pr-4">Times</th>
                <th className="py-2">Instructor</th>
                {session?.user?.id && <th className="py-2 pl-4">Schedule</th>}
              </tr>
            </thead>
            <tbody>
              {course.sections.map((s) => {
                const matchingSchedules = mySchedules.filter((sc) => sc.termId === s.termId);

                async function addToScheduleAction(formData: FormData) {
                  'use server';
                  const scheduleId = String(formData.get('scheduleId') ?? '');
                  if (scheduleId) await addSection(scheduleId, s.id);
                }

                return (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium">{s.sectionCode}</td>
                    <td className="py-2 pr-4">{s.term.name}</td>
                    <td className="py-2 pr-4">{s.activity ?? '—'}</td>
                    <td className="py-2 pr-4">
                      {s.meetingTimes.length
                        ? s.meetingTimes.map((m) => formatMeeting(m)).join(', ')
                        : '—'}
                    </td>
                    <td className="py-2">
                      {s.instructors.length
                        ? s.instructors.map((si) => (
                            <Link
                              key={si.instructorId}
                              href={`/professor/${si.instructor.slug}`}
                              className="text-blue-700 hover:underline"
                            >
                              {si.instructor.name}
                            </Link>
                          ))
                        : '—'}
                    </td>
                    {session?.user?.id && (
                      <td className="py-2 pl-4">
                        {matchingSchedules.length > 0 ? (
                          <form action={addToScheduleAction} className="flex items-center gap-1">
                            {matchingSchedules.length > 1 ? (
                              <select
                                name="scheduleId"
                                className="rounded border px-1 py-0.5 text-xs"
                              >
                                {matchingSchedules.map((sc) => (
                                  <option key={sc.id} value={sc.id}>
                                    {sc.name}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <input type="hidden" name="scheduleId" value={matchingSchedules[0].id} />
                            )}
                            <button
                              type="submit"
                              className="inline-block text-xs text-blue-700 transition-transform duration-150 ease-out hover:scale-105 hover:underline active:scale-100"
                            >
                              + Add
                            </button>
                          </form>
                        ) : (
                          <Link href="/schedule" className="text-xs text-blue-700 hover:underline">
                            Create a schedule
                          </Link>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
