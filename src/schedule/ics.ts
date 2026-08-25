export type IcsEvent = {
  uid: string;
  title: string;
  day: string;
  startTime: string | null;
  endTime: string | null;
  startDate: Date | null;
  endDate: Date | null;
};

const TZID = 'America/Vancouver';

/** The EnrollmentMeeting fields an ICS event needs — see schema.prisma. */
export type MeetingLike = {
  id: string;
  sectionCode: string | null;
  activity: string | null;
  days: string[];
  startTime: string | null;
  endTime: string | null;
  startDate: Date | null;
  endDate: Date | null;
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
  return m.days.map((day) => ({
    uid: `${m.id}-${day}`,
    title,
    day,
    startTime: m.startTime,
    endTime: m.endTime,
    startDate: m.startDate,
    endDate: m.endDate,
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
 * starting Wednesday with Monday meetings first meets the following Monday —
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
    const dayIndex = DAY_INDEX[e.day];
    // Skip rather than guess: an unscheduled meeting has no correct rendering.
    if (dayIndex === undefined) continue;
    if (!e.startTime || !e.endTime || !e.startDate || !e.endDate) continue;

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
