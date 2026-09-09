import { db } from '@/lib/db';
import { icsFilename, icsResponse, type IcsEvent } from '@/schedule/ics';

// The whole value of this feature is that a subscribed calendar sees current
// state. Any caching here silently reintroduces the staleness every existing
// UBC calendar tool suffers from.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const record = await db.calendarToken.findUnique({
    where: { token },
    select: {
      schedule: {
        select: {
          name: true,
          sections: { select: { sectionId: true, building: true, room: true } },
        },
      },
    },
  });

  if (!record?.schedule) {
    return new Response('Not found', { status: 404 });
  }

  // ponytail: ScheduleSection.sectionId is a raw FK with no Prisma relation to
  // Section (same cross-phase convention as CourseReview.courseId etc.), so
  // the join is a second query rather than a nested select.
  const sections = await db.section.findMany({
    where: { id: { in: record.schedule.sections.map((s) => s.sectionId) } },
    select: {
      id: true,
      sectionCode: true,
      activity: true,
      meetingTimes: true,
      course: { select: { number: true, subject: { select: { code: true } } } },
    },
  });

  // The room is saved with the schedule, not carried by the section: the
  // catalogue has no location for anything (see schedule/locations).
  const placeBySection = new Map(
    record.schedule.sections.map((s) => [
      s.sectionId,
      [s.building, s.room].filter(Boolean).join(' ') || null,
    ]),
  );

  const events: IcsEvent[] = [];
  for (const section of sections) {
    const label = `${section.course.subject.code ?? ''} ${section.course.number}`.trim();
    const title = `${label} ${section.activity ?? ''}`.trim();

    for (const m of section.meetingTimes) {
      events.push({
        uid: `${section.id}-${m.id}`,
        title: `${title} (${section.sectionCode})`,
        day: m.day,
        startTime: m.startTime,
        endTime: m.endTime,
        startDate: m.startDate,
        endDate: m.endDate,
        location: [m.building, m.room].filter(Boolean).join(' ') || placeBySection.get(section.id) || null,
      });
    }
  }

  const download = new URL(req.url).searchParams.get('download') === '1';
  const name = record.schedule.name;
  return icsResponse(name, events, download ? icsFilename(name) : null);
}
