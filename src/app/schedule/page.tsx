import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import CreateScheduleModal from '@/components/CreateScheduleModal';
import ScheduleTabs, {
  type SectionLite,
  type TermGroup,
  type CalendarTermGroup,
} from '@/components/ScheduleTabs';
import type { WeekGridEntry } from '@/components/WeekGrid';
import { isPlannableTerm, isUpcomingTerm } from '@/schedule/terms';

function courseHref(subjectCode: string, number: string): string {
  return `/course/${`${subjectCode} ${number}`.toLowerCase().replace(/\s+/g, '-')}`;
}

export default async function SchedulePage() {
  const session = await auth();
  const userId = session?.user?.id;

  const [user, schedules, terms, meetings] = await Promise.all([
    userId ? db.user.findUnique({ where: { id: userId }, select: { program: true } }) : null,
    userId
      ? db.savedSchedule.findMany({ where: { userId }, include: { sections: true } })
      : Promise.resolve([]),
    // SavedSchedule.termId is a raw FK (same cross-domain convention as
    // ScheduleSection.sectionId) — no Prisma relation, so terms are fetched
    // separately and joined in JS.
    db.term.findMany({
      where: { campus: 'V' },
      orderBy: [{ year: 'desc' }, { termNumber: 'desc' }],
    }),
    // Meeting patterns parsed straight from the student's Workday export
    // (see src/upload/import.ts) — the real day/time data behind "View
    // Calendar", independent of anything saved in the schedule builder.
    userId ? db.enrollmentMeeting.findMany({ where: { userId } }) : Promise.resolve([]),
  ]);

  const termById = new Map(terms.map((t) => [t.id, t]));
  const plannableTerms = terms.filter(isPlannableTerm);

  // Course-section labels for every schedule, batched in two queries rather
  // than N+1 — schedule.sections is a raw-FK join table (see above), and
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

  // "View Calendar" — real weekly grids for the upcoming plannable terms,
  // built from the Workday-parsed meeting patterns rather than anything
  // saved in the schedule builder.
  const meetingCourseIds = [...new Set(meetings.map((m) => m.courseId))];
  const meetingCourses = meetingCourseIds.length
    ? await db.course.findMany({
        where: { id: { in: meetingCourseIds } },
        include: { subject: true },
      })
    : [];
  const courseById = new Map(meetingCourses.map((c) => [c.id, c]));

  const calendarByTerm = new Map<string, CalendarTermGroup>(
    [...plannableTerms]
      .sort((a, b) => a.year - b.year || (a.termNumber ?? 0) - (b.termNumber ?? 0))
      .map((t) => [t.id, { termId: t.id, termName: t.name, entries: [] }]),
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
        day,
        startTime: m.startTime,
        endTime: m.endTime,
      } satisfies WeekGridEntry);
    });
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold text-foreground">My Schedules</h1>
        <CreateScheduleModal terms={plannableTerms} />
      </div>

      {!userId && (
        <p className="mt-4 text-sm text-text-secondary">
          You can build a schedule without an account — you&apos;ll only need to sign in when
          you&apos;re ready to save it.
        </p>
      )}

      <ScheduleTabs
        program={user?.program ?? null}
        upcoming={[...upcomingByTerm.values()]}
        past={[...pastByTerm.values()]}
        calendar={[...calendarByTerm.values()]}
      />
    </main>
  );
}
