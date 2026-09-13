import { auth } from '@/lib/auth';
import { formatRoom } from '@/lib/format';
import { db } from '@/lib/db';
import CreateScheduleModal from '@/components/CreateScheduleModal';
import ScheduleTabs, {
  type SectionLite,
  type TermGroup,
  type CalendarTermGroup,
  type ExamsTabData,
} from '@/components/ScheduleTabs';
import type { CalendarEntry } from '@/components/schedule/ScheduleCalendar';
import type { SyllabusListItem } from '@/components/SyllabusList';
import {
  examRowsForUser,
  syllabusExamRowsForUser,
  hiddenExamRowsForUser,
  mergeExams,
  examCoverage,
  courseLabel,
} from '@/schedule/exams';
import { toSavedAssessmentRow } from '@/syllabus/schema';
import { isPlannableTerm, isUpcomingTerm, getCurrentAndNextTerm } from '@/schedule/terms';

function courseHref(subjectCode: string, number: string): string {
  return `/course/${`${subjectCode} ${number}`.toLowerCase().replace(/\s+/g, '-')}`;
}

/** Identity of the section a meeting belongs to, for the catalogue lookup. */
function sectionKey(m: { courseId: string; termId: string; sectionCode: string | null }): string {
  return `${m.courseId}:${m.termId}:${m.sectionCode ?? ''}`;
}

/** Everything the Exams tab renders, for a signed-in student. Null for a
 *  signed-out visitor - the rest of this page is browsable without an account,
 *  and the tab says so rather than the whole page redirecting to /login. */
async function examsTabData(
  userId: string,
  currentTermId: string | null,
  shareToken: string | null,
): Promise<ExamsTabData> {
  if (!currentTermId) {
    return {
      items: [], termId: null, coverage: { published: false }, hidden: [],
      syllabi: [], shareToken: null,
    };
  }

  const [scraped, fromSyllabus, hidden, enrollments, anyExamThisTerm] = await Promise.all([
    examRowsForUser(userId, currentTermId),
    syllabusExamRowsForUser(userId, currentTermId),
    hiddenExamRowsForUser(userId, currentTermId),
    db.enrollment.findMany({ where: { userId, termId: currentTermId }, select: { courseId: true } }),
    // Deliberately NOT scoped to this student: one published row anywhere in
    // the term means the whole schedule is out (see `examCoverage`). Scoping
    // it to their courses would make "no exams for me" indistinguishable from
    // "UBC hasn't published anything yet", which is the bug this answers.
    db.finalExam.findFirst({ where: { termId: currentTermId }, select: { id: true } }),
  ]);

  const courseIds = [...new Set(enrollments.map((e) => e.courseId))];
  const [courses, syllabi] = courseIds.length
    ? await Promise.all([
        db.course.findMany({ where: { id: { in: courseIds } }, include: { subject: true } }),
        db.syllabus.findMany({
          where: { userId, termId: currentTermId, courseId: { in: courseIds } },
          // The saved rows go down to the confirm table so a wrong date can be
          // corrected there, with no second extraction call.
          include: { assessments: true },
        }),
      ])
    : [[], []];
  const syllabusByCourse = new Map(syllabi.map((s) => [s.courseId, s]));

  const items = mergeExams(scraped, fromSyllabus);

  return {
    items,
    termId: currentTermId,
    shareToken,
    hidden,
    // Hidden exams count as covered. They are still in UBC's schedule - the
    // student only took them off their own page - and a course whose final is
    // hidden must never be named below as having no final.
    coverage: examCoverage([...items, ...hidden], courses.map(courseLabel), anyExamThisTerm !== null),
    syllabi: courses
      .map((c): SyllabusListItem => {
        const s = syllabusByCourse.get(c.id);
        return {
          courseId: c.id,
          courseLabel: courseLabel(c),
          syllabus: s
            ? {
                id: s.id,
                filename: s.filename,
                size: s.size,
                url: s.url,
                sourceText: s.sourceText,
                extractedAt: s.extractedAt?.toISOString() ?? null,
                assessments: s.assessments
                  .map(toSavedAssessmentRow)
                  .filter((a) => a !== null),
              }
            : null,
        };
      })
      .sort((a, b) => a.courseLabel.localeCompare(b.courseLabel)),
  };
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const session = await auth();
  const userId = session?.user?.id;
  // /exams and /syllabus redirect here with ?tab=exams, so a bookmark from
  // before those pages folded in still lands on their content.
  const requestedTab = (await searchParams).tab;

  const [user, schedules, terms, meetings, enrollmentShares] = await Promise.all([
    userId ? db.user.findUnique({ where: { id: userId }, select: { program: true } }) : null,
    userId
      ? db.savedSchedule.findMany({ where: { userId }, include: { sections: true } })
      : Promise.resolve([]),
    // SavedSchedule.termId is a raw FK (same cross-domain convention as
    // ScheduleSection.sectionId) - no Prisma relation, so terms are fetched
    // separately and joined in JS.
    db.term.findMany({
      where: { campus: 'V' },
      orderBy: [{ year: 'desc' }, { termNumber: 'desc' }],
    }),
    // Meeting patterns parsed straight from the student's Workday export
    // (see src/upload/import.ts) - the real day/time data behind "View
    // Calendar", independent of anything saved in the schedule builder.
    userId ? db.enrollmentMeeting.findMany({ where: { userId } }) : Promise.resolve([]),
    // Existing share links per term, so the Share menu opens knowing its state.
    userId ? db.enrollmentShareToken.findMany({ where: { userId } }) : Promise.resolve([]),
  ]);
  const shareByTerm = new Map(enrollmentShares.map((s) => [s.termId, s.token]));

  const termById = new Map(terms.map((t) => [t.id, t]));
  const plannableTerms = terms.filter(isPlannableTerm);

  // Course-section labels for every schedule, batched in two queries rather
  // than N+1 - schedule.sections is a raw-FK join table (see above), and
  // Section itself has no back-relation to it either.
  const sectionIds = [...new Set(schedules.flatMap((s) => s.sections.map((ss) => ss.sectionId)))];
  const sectionRows = sectionIds.length
    ? await db.section.findMany({
        where: { id: { in: sectionIds } },
        include: { course: { include: { subject: true } } },
      })
    : [];
  const sectionById = new Map(sectionRows.map((s) => [s.id, s]));

  const sorted = [...schedules].sort((a, b) => {
    const ta = termById.get(a.termId);
    const tb = termById.get(b.termId);
    return (
      (tb?.year ?? 0) - (ta?.year ?? 0) ||
      (tb?.termNumber ?? 0) - (ta?.termNumber ?? 0) ||
      a.name.localeCompare(b.name)
    );
  });

  const upcomingByTerm = new Map<string, TermGroup>();
  const pastByTerm = new Map<string, TermGroup>();
  for (const s of sorted) {
    const term = termById.get(s.termId);
    const bucket = term && !isUpcomingTerm(term) ? pastByTerm : upcomingByTerm;
    const sections: SectionLite[] = s.sections
      .map((ss) => sectionById.get(ss.sectionId))
      .filter((sec) => sec !== undefined)
      .map((sec) => ({
        id: sec.id,
        label: `${sec.course.subject.code}_${sec.course.campus} ${sec.course.number}-${sec.sectionCode} - ${sec.course.title}`,
        href: courseHref(sec.course.subject.code ?? '', sec.course.number),
      }));

    const group = bucket.get(s.termId) ?? { termId: s.termId, termName: term?.name ?? 'Unknown term', rows: [] };
    group.rows.push({ id: s.id, name: s.name, sections });
    bucket.set(s.termId, group);
  }

  // "View Calendar" - real weekly grids for the upcoming plannable terms,
  // built from the Workday-parsed meeting patterns rather than anything
  // saved in the schedule builder.
  // Our catalogue's own view of these sections, for the instructor Workday
  // left blank. Keyed on the same (course, term, section) the meeting names.
  const catalogueSections = meetings.length
    ? await db.section.findMany({
        where: {
          courseId: { in: [...new Set(meetings.map((m) => m.courseId))] },
          termId: { in: [...new Set(meetings.map((m) => m.termId))] },
        },
        select: {
          courseId: true,
          termId: true,
          sectionCode: true,
          instructors: { select: { instructor: { select: { name: true } } } },
        },
      })
    : [];
  const catalogueInstructor = new Map(
    catalogueSections
      .filter((sec) => sec.instructors.length > 0)
      .map((sec) => [
        sectionKey(sec),
        sec.instructors.map((si) => si.instructor.name).join(', '),
      ]),
  );

  const meetingCourseIds = [...new Set(meetings.map((m) => m.courseId))];
  const meetingCourses = meetingCourseIds.length
    ? await db.course.findMany({
        where: { id: { in: meetingCourseIds } },
        include: { subject: true },
      })
    : [];
  const courseById = new Map(meetingCourses.map((c) => [c.id, c]));

  const currentTermId = getCurrentAndNextTerm(terms).current?.id ?? null;
  const exams = userId
    ? await examsTabData(userId, currentTermId, currentTermId ? shareByTerm.get(currentTermId) ?? null : null)
    : null;

  const calendarByTerm = new Map<string, CalendarTermGroup>(
    [...plannableTerms]
      .sort((a, b) => a.year - b.year || (a.termNumber ?? 0) - (b.termNumber ?? 0))
      .map((t) => [
        t.id,
        {
          termId: t.id,
          termName: t.name,
          entries: [],
          isCurrentTerm: t.id === currentTermId,
          shareToken: shareByTerm.get(t.id) ?? null,
        },
      ]),
  );
  for (const m of meetings) {
    const group = calendarByTerm.get(m.termId);
    const course = courseById.get(m.courseId);
    if (!group || !course) continue;
    const label = `${course.subject.code}_${course.campus} ${course.number}${m.sectionCode ? `-${m.sectionCode}` : ''}`;
    m.days.forEach((day, i) => {
      group.entries.push({
        id: `${m.id}-${i}`,
        sectionId: m.id,
        label,
        // Keyed on the same value ScheduleBuilder uses (SectionHit.code, e.g.
        // "CPSC 110") - no campus suffix - so a course gets the same colour
        // slot in both consumers.
        courseCode: `${course.subject.code} ${course.number}`,
        courseId: m.courseId,
        day,
        startTime: m.startTime,
        endTime: m.endTime,
        location: formatRoom(m),
        // Workday names the lecture's instructor and usually nobody else's, so
        // a lab or tutorial arrives blank. Our own catalogue often knows who
        // teaches that section - use it rather than showing nothing.
        instructor: m.instructor ?? catalogueInstructor.get(sectionKey(m)) ?? null,
        building: m.building,
        room: m.room,
      } satisfies CalendarEntry);
    });
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
      <div className="sky-hero flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold sm:text-3xl text-foreground">My Schedules</h1>
        <CreateScheduleModal terms={plannableTerms} loggedIn={userId !== undefined} />
      </div>

      {/* Tabs and their contents sit on one solid panel - term headings and
          section labels are small secondary text the sky washes out. */}
      {/* p-3 on phones: the panel and the page were charging 96px of the 390px
          screen in padding, which came straight out of the calendar's five day
          columns. */}
      <div className="sky-panel mt-6 p-3 sm:p-8">
        {!userId && (
          <p className="mb-4 text-sm text-text-secondary">
            Sign in to build or import a schedule. You can look around this page first.
          </p>
        )}

        <ScheduleTabs
          program={user?.program ?? null}
          upcoming={[...upcomingByTerm.values()]}
          past={[...pastByTerm.values()]}
          calendar={[...calendarByTerm.values()]}
          exams={exams}
          initialTab={requestedTab === 'exams' ? 'exams' : 'upcoming'}
        />
      </div>
    </main>
  );
}
