import type { Metadata } from 'next';
import { formatRoom } from '@/lib/format';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import ScheduleCalendar, { type CalendarEntry } from '@/components/schedule/ScheduleCalendar';

/**
 * A term's Workday-imported calendar, read-only, for anyone holding the link —
 * the enrollment sibling of /shared/[token], under the same rules: the token
 * IS the capability, no session is read, and nothing about the owner renders.
 * Data loads exactly the way /api/calendar/enrolled builds its ICS feed.
 */
export const dynamic = 'force-dynamic';

async function load(token: string) {
  const record = await db.enrollmentShareToken.findUnique({
    where: { token },
    select: { userId: true, termId: true },
  });
  if (!record) return null;

  const [meetings, term] = await Promise.all([
    db.enrollmentMeeting.findMany({
      where: { userId: record.userId, termId: record.termId },
    }),
    db.term.findUnique({ where: { id: record.termId }, select: { name: true } }),
  ]);
  if (!term) return null;

  // courseId is a raw FK with no Prisma relation (the same cross-domain
  // convention as EnrollmentMeeting's other ids), so labels are a second query.
  const courses = meetings.length
    ? await db.course.findMany({
        where: { id: { in: [...new Set(meetings.map((m) => m.courseId))] } },
        include: { subject: true },
      })
    : [];
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const entries: CalendarEntry[] = [];
  for (const m of meetings) {
    const course = courseById.get(m.courseId);
    if (!course) continue;
    m.days.forEach((day, i) => {
      entries.push({
        id: `${m.id}-${i}`,
        sectionId: m.id,
        label: `${course.subject.code} ${course.number}${m.sectionCode ? `-${m.sectionCode}` : ''}`,
        courseCode: `${course.subject.code} ${course.number}`,
        // No courseId: that is what makes a block clickable into the course
        // overlay, and this page is for looking, not navigating.
        courseId: null,
        day,
        startTime: m.startTime,
        endTime: m.endTime,
        location: formatRoom(m),
        instructor: m.instructor,
      });
    });
  }
  return { termName: term.name, entries };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const data = await load((await params).token);
  // Pasted into group chats, so it gets a real preview — but noindex, because
  // these are personal and should never turn up in search.
  return {
    title: data ? `${data.termName} · shared calendar` : 'Shared calendar',
    robots: { index: false, follow: false },
  };
}

export default async function SharedEnrolledPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const data = await load((await params).token);
  // A revoked link and a link that never existed are the same 404 on purpose.
  if (!data) notFound();

  // Padding and heading sized as on /shared/[token]: both are a calendar on a
  // phone, and the page charging px-6 twice over came out of the five day
  // columns, which is where a course code stops fitting.
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <div className="sky-hero">
        <p className="text-sm text-text-tertiary">Shared calendar</p>
        <h1 className="text-xl font-semibold sm:text-3xl">{data.termName}</h1>
      </div>

      <div className="sky-panel mt-6 p-3 sm:p-6">
        {data.entries.length === 0 ? (
          <p className="text-sm text-text-secondary">No courses on this calendar yet.</p>
        ) : (
          <ScheduleCalendar entries={data.entries} />
        )}
      </div>

      <p className="sky-hero mt-6 text-sm">
        <Link href="/schedule" className="font-medium underline underline-offset-4">
          Build your own schedule
        </Link>{' '}
        on UBC Flow.
      </p>
    </main>
  );
}
