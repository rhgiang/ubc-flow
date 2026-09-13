import { db } from '@/lib/db';
import { icsFilename, icsResponse, meetingEvents, examEvent, type IcsEvent } from '@/schedule/ics';
import { examRowsForUser, syllabusExamRowsForUser } from '@/schedule/exam-queries';
import { mergeExams, groupExams } from '@/schedule/exams';

// Same reasoning as /api/calendar/[token]: a subscribed calendar is only worth
// anything if it reflects current state, so nothing here may be cached.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const record = await db.enrollmentCalendarToken.findUnique({
    where: { token },
    select: { userId: true, termId: true },
  });
  if (!record) return new Response('Not found', { status: 404 });

  const [meetings, term] = await Promise.all([
    db.enrollmentMeeting.findMany({
      where: { userId: record.userId, termId: record.termId },
    }),
    db.term.findUnique({ where: { id: record.termId }, select: { name: true } }),
  ]);
  if (!term) return new Response('Not found', { status: 404 });

  // courseId is a raw FK with no Prisma relation (the same cross-domain
  // convention as EnrollmentMeeting's other ids), so labels are a second query.
  const courses = meetings.length
    ? await db.course.findMany({
        where: { id: { in: [...new Set(meetings.map((m) => m.courseId))] } },
        include: { subject: true },
      })
    : [];
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const events: IcsEvent[] = [];
  for (const m of meetings) {
    const course = courseById.get(m.courseId);
    if (!course) continue;
    events.push(...meetingEvents(`${course.subject.code} ${course.number}`, m));
  }

  // The same merged list the exams tab renders, not just the scraped finals
  // - spec §1 wants syllabus midterms in the subscribed calendar too, and one
  // source of truth for precedence beats two. Grouped the same way too, so an
  // exam UBC split across rooms by surname is one event, not one per room.
  const [scraped, fromSyllabus] = await Promise.all([
    examRowsForUser(record.userId, record.termId),
    syllabusExamRowsForUser(record.userId, record.termId),
  ]);
  for (const group of groupExams(mergeExams(scraped, fromSyllabus))) {
    const event = examEvent(group);
    if (event) events.push(event);
  }

  const download = new URL(req.url).searchParams.get('download') === '1';
  return icsResponse(term.name, events, download ? icsFilename(term.name) : null);
}
