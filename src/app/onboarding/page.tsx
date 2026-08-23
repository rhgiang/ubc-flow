import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { isUpcomingTerm } from '@/schedule/terms';
import SignOutButton from '@/components/SignOutButton';
import UploadCoursesForm from '@/components/UploadCoursesForm';

function courseHref(subjectCode: string, number: string): string {
  return `/course/${`${subjectCode} ${number}`.toLowerCase().replace(/\s+/g, '-')}`;
}

/** "10:00" -> "10:00 AM", "15:30" -> "3:30 PM". */
function formatTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

const MONTH_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/** Sep 8, 2026 – Dec 7, 2026 -> "Sep 8 – Dec 7, 2026" (year shown once, off the end date). */
function formatDateRange(start: Date, end: Date): string {
  return `${MONTH_DAY.format(start)} – ${MONTH_DAY.format(end)}, ${end.getFullYear()}`;
}

type MeetingLite = {
  id: string;
  activity: string | null;
  days: string[];
  startTime: string | null;
  endTime: string | null;
  building: string | null;
  room: string | null;
  instructor: string | null;
  startDate: Date | null;
  endDate: Date | null;
};

type CourseRow = { id: string; code: string; title: string; href: string; meetings: MeetingLite[] };
type TermGroup = { termId: string; termName: string; rows: CourseRow[] };

function MeetingLine({ m }: { m: MeetingLite }) {
  const location = m.building ? `${m.building}${m.room ? ` ${m.room}` : ''}` : null;
  const time = m.startTime && m.endTime ? `${formatTime(m.startTime)} – ${formatTime(m.endTime)}` : null;
  const dateRange = m.startDate && m.endDate ? formatDateRange(m.startDate, m.endDate) : null;

  return (
    <div className="text-xs">
      <p className="font-medium text-foreground">
        {m.activity ?? 'Class'}
        {m.instructor && <span className="font-normal text-text-secondary"> · {m.instructor}</span>}
      </p>
      <p className="mt-0.5 text-text-secondary">
        {[m.days.length > 0 ? m.days.join(' ') : null, time, location].filter(Boolean).join(' · ') ||
          'No fixed meeting time'}
      </p>
      {dateRange && <p className="mt-0.5 text-text-tertiary">{dateRange}</p>}
    </div>
  );
}

function CourseCard({ course }: { course: CourseRow }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <p>
        <Link href={course.href} className="font-medium text-brand-accent hover:underline">
          {course.code}
        </Link>
        <span className="ml-2 text-sm text-text-secondary">{course.title}</span>
      </p>

      {course.meetings.length > 0 && (
        <div className="mt-3 space-y-3 border-t border-border pt-3">
          {course.meetings.map((m) => (
            <MeetingLine key={m.id} m={m} />
          ))}
        </div>
      )}
    </div>
  );
}

function CourseGroup({ group, first }: { group: TermGroup; first: boolean }) {
  return (
    <div className={first ? '' : 'mt-5'}>
      <h3 className="text-sm font-medium text-foreground">{group.termName}</h3>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {group.rows.map((r) => (
          <CourseCard key={r.id} course={r} />
        ))}
      </div>
    </div>
  );
}

export default async function OnboardingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const userId = session.user.id;

  const [user, enrollments, meetings, terms] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { verifiedAt: true } }),
    db.enrollment.findMany({ where: { userId } }),
    db.enrollmentMeeting.findMany({ where: { userId } }),
    db.term.findMany({ where: { campus: 'V' }, orderBy: [{ year: 'desc' }, { termNumber: 'desc' }] }),
  ]);

  const termById = new Map(terms.map((t) => [t.id, t]));
  const courseIds = [...new Set(enrollments.map((e) => e.courseId))];
  const courses = courseIds.length
    ? await db.course.findMany({ where: { id: { in: courseIds } }, include: { subject: true } })
    : [];
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const meetingsByKey = new Map<string, MeetingLite[]>();
  for (const m of meetings) {
    const key = `${m.courseId}:${m.termId}`;
    const list = meetingsByKey.get(key) ?? [];
    list.push(m);
    meetingsByKey.set(key, list);
  }

  const currentByTerm = new Map<string, TermGroup>();
  const pastByTerm = new Map<string, TermGroup>();
  for (const e of enrollments) {
    const term = termById.get(e.termId);
    const course = courseById.get(e.courseId);
    if (!term || !course) continue;
    const bucket = isUpcomingTerm(term) ? currentByTerm : pastByTerm;
    const group = bucket.get(e.termId) ?? { termId: e.termId, termName: term.name, rows: [] };
    group.rows.push({
      id: e.id,
      code: `${course.subject.code} ${course.number}`,
      title: course.title,
      href: courseHref(course.subject.code ?? '', course.number),
      meetings: meetingsByKey.get(`${e.courseId}:${e.termId}`) ?? [],
    });
    bucket.set(e.termId, group);
  }

  const verified = Boolean(user?.verifiedAt);

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold text-foreground">Account</h1>
        <SignOutButton />
      </div>

      {verified ? (
        <>
          <div className="mt-6 flex items-center gap-2 rounded-card border border-border bg-surface-muted px-4 py-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-5 w-5 shrink-0 text-brand-accent">
              <circle cx="12" cy="12" r="9" />
              <path d="m8 12.5 2.5 2.5L16 9.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-sm font-medium text-foreground">UBC Student — Verified</p>
          </div>

          <section className="mt-6">
            <h2 className="text-xl font-semibold text-foreground">Current courses</h2>
            {currentByTerm.size === 0 ? (
              <p className="mt-2 text-sm text-text-secondary">No current courses on record.</p>
            ) : (
              [...currentByTerm.values()].map((g, i) => <CourseGroup key={g.termId} group={g} first={i === 0} />)
            )}
          </section>

          <section className="mt-6">
            <h2 className="text-xl font-semibold text-foreground">Past courses</h2>
            {pastByTerm.size === 0 ? (
              <p className="mt-2 text-sm text-text-secondary">No past courses on record.</p>
            ) : (
              [...pastByTerm.values()].map((g, i) => <CourseGroup key={g.termId} group={g} first={i === 0} />)
            )}
          </section>

          <div className="mt-8 border-t border-border pt-6">
            <UploadCoursesForm verified />
          </div>
        </>
      ) : (
        <div className="mt-6">
          <UploadCoursesForm verified={false} />
        </div>
      )}
    </main>
  );
}
