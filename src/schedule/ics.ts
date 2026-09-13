import type { ExamListItem } from '@/schedule/exams';

export type IcsEvent = {
  uid: string;
  title: string;
  /** null means a single occurrence (e.g. an exam), not a weekly meeting. */
  day: string | null;
  startTime: string | null;
  endTime: string | null;
  startDate: Date | null;
  endDate: Date | null;
  /** "BUCH A101". Omitted from the event entirely when there is none. */
  location?: string | null;
  /** Spec §6: discloses when a time on the event is our assumption, not UBC's. */
  description?: string | null;
};

const TZID = 'America/Vancouver';

/** The EnrollmentMeeting fields an ICS event needs - see schema.prisma. */
export type MeetingLike = {
  id: string;
  sectionCode: string | null;
  activity: string | null;
  days: string[];
  startTime: string | null;
  endTime: string | null;
  startDate: Date | null;
  endDate: Date | null;
  building?: string | null;
  room?: string | null;
};

/**
 * One meeting row fans out to one event per weekday it meets: a Mon/Wed/Fri
 * lecture is three weekly recurrences, not one. The uid carries the day, or
 * the three would collide and calendars would keep only the last.
 */
export function meetingEvents(courseLabel: string, m: MeetingLike): IcsEvent[] {
  const title = [courseLabel, m.activity, m.sectionCode && `(${m.sectionCode})`]
    .filter(Boolean)
    .join(' ');
  const location = [m.building, m.room].filter(Boolean).join(' ') || null;
  return m.days.map((day) => ({
    uid: `${m.id}-${day}`,
    title,
    day,
    startTime: m.startTime,
    endTime: m.endTime,
    startDate: m.startDate,
    endDate: m.endDate,
    location,
  }));
}

// ICS weekday tokens, indexed to match JS getUTCDay() (0 = Sunday).
const ICS_DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** RFC 5545 escapes: backslash first, or it double-escapes the others. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function dateStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/**
 * The first occurrence on or after the section's start date. A section
 * starting Wednesday with Monday meetings first meets the following Monday -
 * anchoring DTSTART to the start date itself would place it on the wrong day.
 */
function firstOccurrence(startDate: Date, dayIndex: number): Date {
  const d = new Date(startDate.getTime());
  const delta = (dayIndex - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

export function buildIcs(calendarName: string, events: IcsEvent[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//UBC Flow//Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    `X-WR-TIMEZONE:${TZID}`,
  ];

  for (const e of events) {
    if (!e.startTime || !e.endTime || !e.startDate) continue;

    // A null day is a single occurrence - an exam, not a weekly meeting.
    if (e.day === null) {
      const stamp = dateStamp(e.startDate);
      lines.push(
        'BEGIN:VEVENT',
        `UID:${e.uid}@ubcflow`,
        `DTSTAMP:${dateStamp(new Date())}T000000Z`,
        `DTSTART;TZID=${TZID}:${stamp}T${e.startTime.replace(':', '')}00`,
        `DTEND;TZID=${TZID}:${stamp}T${e.endTime.replace(':', '')}00`,
        `SUMMARY:${escapeText(e.title)}`,
        ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
        ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
        'END:VEVENT',
      );
      continue;
    }

    const dayIndex = DAY_INDEX[e.day];
    // Skip rather than guess: an unscheduled meeting has no correct rendering.
    if (dayIndex === undefined) continue;
    if (!e.endDate) continue;

    const first = firstOccurrence(e.startDate, dayIndex);
    const stamp = dateStamp(first);
    const start = `${stamp}T${e.startTime.replace(':', '')}00`;
    const end = `${stamp}T${e.endTime.replace(':', '')}00`;

    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@ubcflow`,
      `DTSTAMP:${dateStamp(new Date())}T000000Z`,
      `DTSTART;TZID=${TZID}:${start}`,
      `DTEND;TZID=${TZID}:${end}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${ICS_DAY[dayIndex]};UNTIL=${dateStamp(e.endDate)}T235959Z`,
      `SUMMARY:${escapeText(e.title)}`,
      // Phones offer directions from this field, so it is worth more here than
      // anywhere else on the site. Absent rather than empty when unknown.
      ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  // RFC 5545 mandates CRLF.
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * Both calendar routes answer the same way: a live feed by default, or the
 * same bytes as a one-off file when `?download=1` asks for it.
 */
export function icsResponse(
  calendarName: string,
  events: IcsEvent[],
  downloadName: string | null,
): Response {
  return new Response(buildIcs(calendarName, events), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(downloadName
        ? { 'Content-Disposition': `attachment; filename="${downloadName}"` }
        : {}),
    },
  });
}

/** Filesystem-safe .ics name for a calendar, e.g. "2026 Winter Term 1". */
export function icsFilename(calendarName: string): string {
  return `ubc-flow-${calendarName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics`;
}

/**
 * How long an exam is assumed to run. UBC's published table gives a start
 * time and no end, so this is our assumption, not their data.
 *
 * ponytail: one constant rather than per-faculty rules. If the table ever
 * gains a duration column, or 2.5h proves wrong somewhere, this is the single
 * line to change.
 */
export const EXAM_DEFAULT_MINUTES = 150;

function addMinutes(time: string, minutes: number): string | null {
  const m = time.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const total = Number(m[1]) * 60 + Number(m[2]) + minutes;
  if (total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * One exam, as `groupExams` hands it over (several rows when UBC splits it
 * across rooms by surname), into ONE one-off calendar event. Returns null for
 * exactly the two cases that must never reach a phone: cancelled (would ring
 * an alarm for a test that isn't happening) and dateless (nothing to place it
 * on). Both are still shown on the exams tab - this only guards the feed.
 *
 * It takes the group rather than a row so the feed cannot emit CHEM 123 twice
 * at the same time with one room each. LOCATION carries every room against
 * its surname range ("ADI-SUN: IRC 2; TAZ-ZHU: IRC 6"), which is the part a
 * student reads off their phone on the way in; a single-room exam keeps its
 * plain location.
 *
 * The title comes from `item.kind`, not a hardcoded "Final Exam": the feed
 * carries midterms too (spec §1), and titling one "Final Exam" would be a
 * lie on the student's phone.
 */
export function examEvent(group: ExamListItem[]): IcsEvent | null {
  const item = group[0];
  if (!item || item.cancelled || !item.date || !item.startTime) return null;
  const endTime = addMinutes(item.startTime, EXAM_DEFAULT_MINUTES);
  if (!endTime) return null;

  // A syllabus row is a model's reading of a PDF the student confirmed, not
  // UBC's published schedule - the event has to say which it is, because
  // that's what decides whether it's worth double-checking.
  const description =
    item.source === 'syllabus'
      ? `From the syllabus you uploaded, not UBC's exam schedule. Double-check the date `
        + `and time with your instructor. The ${endTime} end time is an estimate.`
      : `The ${endTime} end time is an estimate - UBC publishes a start time only. `
        + `Confirm with your instructor.`;

  // Several sections of this course have exams and we don't know which is the
  // student's, so the feed carries all of them - the calendar has no card to
  // read the caveat off, so the event says it itself.
  const sectionNote = item.ambiguousSection
    ? ` UBC scheduled more than one section of this course - this is section ${item.sectionCode}, `
      + `which may not be yours.`
    : '';

  return {
    uid: `exam-${item.id}`,
    title: `${item.courseLabel} ${item.kind === 'final' ? 'Final Exam' : 'Midterm'}`,
    day: null,
    startTime: item.startTime,
    endTime,
    startDate: item.date,
    endDate: item.date,
    location: group.length === 1
      ? item.location
      : group
          .map((r) => `${r.alphaSplit ? `${r.alphaSplit}: ` : ''}${r.location ?? 'Location TBA'}`)
          .join('; '),
    description: description + sectionNote,
  };
}
