// tests/canvas-parse.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseCanvasFeed, splitSummary, unfoldLines } from '@/canvas/parse-ics';
import { vancouverEndOfDayUtc, zonedToUtc } from '@/canvas/tz';

// Built from the shape a working Canvas feed parser was verified against:
// assignments carry "assignment" in the UID, the course rides in a trailing
// bracket on SUMMARY, all-day items are VALUE=DATE, timed items are UTC.
// Long lines are folded with a leading space, as RFC 5545 requires.
const SYNTHETIC = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Instructure//Canvas//EN',
  'BEGIN:VEVENT',
  'UID:event-assignment-123456',
  'SUMMARY:Problem Set 3 [CPSC 110 101 2026W1]',
  'DTSTART:20261027T065959Z',
  'DTEND:20261027T065959Z',
  'URL:https://canvas.ubc.ca/courses/1111/assignments/123456',
  'DESCRIPTION:Submit on Gradescope\\, not here. See the course page for the',
  '  full rubric and late policy.',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-assignment-override-777',
  'SUMMARY:Midterm 1 [BIOL 121 124 2026W1]',
  'DTSTART;VALUE=DATE:20261026',
  'DTEND;VALUE=DATE:20261027',
  'URL:https://canvas.ubc.ca/courses/2222/assignments/777',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-calendar-event-9',
  'SUMMARY:Guest lecture [MATH 200 103 2026W1]',
  'DTSTART;TZID=America/Vancouver:20261103T140000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-assignment-no-date',
  'SUMMARY:Reading response [CPSC 110 101 2026W1]',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-assignment-bad-date',
  'SUMMARY:Broken [CPSC 110 101 2026W1]',
  'DTSTART:not-a-date',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('unfoldLines', () => {
  it('joins a continuation line onto the line before it', () => {
    const lines = unfoldLines('A:first\r\n  continued\r\nB:second');
    expect(lines).toEqual(['A:first continued', 'B:second']);
  });
});

describe('splitSummary', () => {
  it('splits the trailing bracket into the course', () => {
    expect(splitSummary('Problem Set 3 [CPSC 110 101 2026W1]')).toEqual({
      title: 'Problem Set 3',
      courseName: 'CPSC 110 101 2026W1',
    });
  });
  it('leaves a bracket that is not trailing in the title', () => {
    expect(splitSummary('Quiz [open book] 2')).toEqual({ title: 'Quiz [open book] 2', courseName: '' });
  });
  it('returns an empty course when there is no bracket', () => {
    expect(splitSummary('Office hours')).toEqual({ title: 'Office hours', courseName: '' });
  });
});

describe('zonedToUtc and vancouverEndOfDayUtc', () => {
  it('converts 23:59:59 Vancouver on a PDT date to the UTC instant', () => {
    // PDT is UTC-7, so 23:59:59 on Oct 26 is 06:59:59Z on Oct 27.
    expect(vancouverEndOfDayUtc('20261026').toISOString()).toBe('2026-10-27T06:59:59.000Z');
    expect(vancouverEndOfDayUtc('2026-10-26').toISOString()).toBe('2026-10-27T06:59:59.000Z');
  });
  it('stays on Pacific Daylight Time in December, since BC ended the fall-back in 2026', () => {
    // BC adopted permanent Daylight Saving Time with the March 8, 2026 change
    // and did not fall back that November, so Vancouver stays at UTC-7 year
    // round from then on: 23:59:59 on Dec 4 is 06:59:59Z on Dec 5.
    expect(vancouverEndOfDayUtc('20261204').toISOString()).toBe('2026-12-05T06:59:59.000Z');
  });
  it('converts a zoned wall-clock time', () => {
    // Also UTC-7: BC's permanent Daylight Saving Time means Nov 3, 2026 did
    // not revert to UTC-8.
    expect(zonedToUtc(2026, 11, 3, 14, 0, 0, 'America/Vancouver').toISOString()).toBe('2026-11-03T21:00:00.000Z');
  });
});

describe('parseCanvasFeed on the synthetic feed', () => {
  const parsed = parseCanvasFeed(SYNTHETIC);

  it('reads every dated event and counts the ones it had to skip', () => {
    expect(parsed.items).toHaveLength(3);
    expect(parsed.skipped).toBe(2); // no DTSTART, and a malformed one
  });

  it('reads a timed assignment as a UTC instant', () => {
    const ps3 = parsed.items.find((i) => i.uid === 'event-assignment-123456')!;
    expect(ps3).toMatchObject({
      kind: 'assignment',
      title: 'Problem Set 3',
      courseName: 'CPSC 110 101 2026W1',
      allDay: false,
      url: 'https://canvas.ubc.ca/courses/1111/assignments/123456',
    });
    expect(ps3.dueAt.toISOString()).toBe('2026-10-27T06:59:59.000Z');
  });

  it('stores an all-day item as the end of that Vancouver day', () => {
    const mid = parsed.items.find((i) => i.uid === 'event-assignment-override-777')!;
    expect(mid.allDay).toBe(true);
    expect(mid.kind).toBe('assignment');
    expect(mid.dueAt.toISOString()).toBe('2026-10-27T06:59:59.000Z');
  });

  it('converts a TZID wall-clock time and classifies a calendar event', () => {
    const lecture = parsed.items.find((i) => i.uid === 'event-calendar-event-9')!;
    expect(lecture.kind).toBe('event');
    // UTC-7, not the pre-2026 UTC-8: BC's permanent Daylight Saving Time.
    expect(lecture.dueAt.toISOString()).toBe('2026-11-03T21:00:00.000Z');
    expect(lecture.url).toBeNull();
  });

  it('skips an event whose TZID names a zone Intl does not know', () => {
    const bogus = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:event-assignment-bad-tz',
      'SUMMARY:Lab [CPSC 110 101 2026W1]',
      'DTSTART;TZID=Mars/Olympus_Mons:20261103T140000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseCanvasFeed(bogus)).toEqual({ items: [], skipped: 1 });
  });

  it('returns nothing for text that is not a calendar', () => {
    expect(parseCanvasFeed('<html>login</html>')).toEqual({ items: [], skipped: 0 });
  });

  it('counts a one-event feed missing its final END:VEVENT as skipped, not dropped', () => {
    const unclosed = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:event-assignment-unclosed',
      'SUMMARY:Unclosed [CPSC 110 101 2026W1]',
    ].join('\r\n');
    expect(parseCanvasFeed(unclosed)).toEqual({ items: [], skipped: 1 });
  });

  it('accounts for both events when a BEGIN:VEVENT nests before the first END:VEVENT', () => {
    const nested = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:event-assignment-outer',
      'SUMMARY:Outer [CPSC 110 101 2026W1]',
      'BEGIN:VEVENT',
      'UID:event-assignment-inner',
      'SUMMARY:Inner [CPSC 110 101 2026W1]',
      'DTSTART:20261027T065959Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const parsed = parseCanvasFeed(nested);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.skipped).toBe(1);
    expect(parsed.items[0].uid).toBe('event-assignment-inner');
  });
});

// The student's own feed, captured 2026-09-20 and sanitized only by replacing
// the calendar owner's name in X-WR-CALNAME and X-WR-CALDESC. Every line the
// parser reads is verbatim Canvas output, because the shapes are the point.
const REAL = 'tests/fixtures/canvas-feed.ics';
describe.skipIf(!existsSync(REAL))('parseCanvasFeed on the real feed', () => {
  // describe.skipIf still runs this factory body during collection even when
  // the suite is skipped; only the its inside are skipped. Guard the read so
  // a missing fixture does not throw before the skip takes effect.
  const parsed = existsSync(REAL) ? parseCanvasFeed(readFileSync(REAL, 'utf8')) : { items: [], skipped: 0 };

  it('reads every event in the feed and skips none', () => {
    // The fixture holds 71 VEVENTs. Skipping even one would mean a deadline
    // the student can see in Canvas and not here, which is the failure this
    // whole feature cannot have.
    expect(parsed.items).toHaveLength(71);
    expect(parsed.skipped).toBe(0);
  });

  it('gives every item a course, a valid instant and a link', () => {
    for (const i of parsed.items) {
      expect(i.courseName, `blank course on ${i.uid}`).not.toBe('');
      expect(Number.isNaN(i.dueAt.getTime()), `bad date on ${i.uid}`).toBe(false);
      expect(i.url, `no link on ${i.uid}`).toBeTruthy();
    }
    expect(new Set(parsed.items.map((i) => i.courseName)).size).toBe(5);
  });

  it('hands out no repeated uid, so the dedupe in diffFeed is a guard and not a crutch', () => {
    // If this ever fails, a real feed does repeat a uid and diffFeed is
    // silently dropping a genuine event. See the warning logged in
    // applyFeedBody.
    expect(new Set(parsed.items.map((i) => i.uid)).size).toBe(parsed.items.length);
  });

  it("reads Canvas's doubled VALUE=DATE parameter as one all-day due date", () => {
    // Canvas emits `DTSTART;VALUE=DATE;VALUE=DATE:20260921`, repeating the
    // parameter. 29 of the 71 events look like this and the synthetic feed
    // never did. An all-day item is due at the end of that day in Vancouver.
    const allDay = parsed.items.filter((i) => i.allDay);
    expect(allDay).toHaveLength(29);
    const one = allDay.find((i) => i.title === 'Quiz 3: Concepts and Applications');
    expect(one).toBeDefined();
    expect(one!.dueAt.toISOString()).toBe('2026-09-29T06:59:59.000Z');
  });

  it('reads a section override as an ordinary assignment', () => {
    // A per-section due date arrives as `event-assignment-override-<n>`, a
    // uid shape the synthetic feed never had. It must not be skipped, and it
    // must not collide with the base assignment.
    const overrides = parsed.items.filter((i) => i.uid.startsWith('event-assignment-override-'));
    expect(overrides).toHaveLength(4);
    for (const o of overrides) expect(o.kind).toBe('assignment');
  });

  it('splits the course off a SUMMARY that was folded mid-bracket', () => {
    // This one's SUMMARY wraps across a fold inside the trailing [Course]
    // bracket, so it only parses if unfoldLines runs before splitSummary.
    const i = parsed.items.find((x) => x.uid === 'event-assignment-2500037');
    expect(i).toBeDefined();
    expect(i!.title).toBe('Pre-class: Reading Response 1');
    expect(i!.courseName).toBe('ASTR_V 101 001 2026W1');
    expect(i!.dueAt.toISOString()).toBe('2026-09-12T05:00:00.000Z');
  });
});
