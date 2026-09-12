import { describe, it, expect } from 'vitest';
import { buildIcs, meetingEvents, examEvent, EXAM_DEFAULT_MINUTES, type IcsEvent } from '@/schedule/ics';

const event: IcsEvent = {
  uid: 'section-1-Mon',
  title: 'CPSC 221 Lecture',
  day: 'Mon',
  startTime: '14:00',
  endTime: '15:00',
  startDate: new Date('2027-01-06T00:00:00Z'),
  endDate: new Date('2027-02-12T00:00:00Z'),
};

describe('buildIcs', () => {
  const ics = buildIcs('My Schedule', [event]);

  it('produces a well-formed calendar envelope', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
  });

  it('names the calendar', () => {
    expect(ics).toContain('X-WR-CALNAME:My Schedule');
  });

  it('emits one event with its title', () => {
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('SUMMARY:CPSC 221 Lecture');
  });

  it('recurs weekly on the right day, bounded by the real end date', () => {
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20270212T235959Z');
  });

  it('starts on the first matching weekday on or after the start date', () => {
    // 2027-01-06 is a Wednesday; the first Monday on/after it is 2027-01-11.
    expect(ics).toContain('DTSTART;TZID=America/Vancouver:20270111T140000');
    expect(ics).toContain('DTEND;TZID=America/Vancouver:20270111T150000');
  });

  it('uses CRLF line endings as the spec requires', () => {
    expect(ics).toContain('\r\n');
  });

  it('escapes characters that would corrupt a line', () => {
    const out = buildIcs('X', [{ ...event, title: 'A, B; C\\D' }]);
    expect(out).toContain('SUMMARY:A\\, B\\; C\\\\D');
  });

  it('omits events that have no usable time or date', () => {
    const out = buildIcs('X', [{ ...event, startTime: null }]);
    expect(out).not.toContain('BEGIN:VEVENT');
  });

  it('produces a valid empty calendar for no events', () => {
    const out = buildIcs('Empty', []);
    expect(out).toContain('BEGIN:VCALENDAR');
    expect(out).not.toContain('BEGIN:VEVENT');
  });
});

describe('meetingEvents', () => {
  const meeting = {
    id: 'meet-1',
    sectionCode: '201',
    activity: 'Lecture',
    days: ['Mon', 'Wed', 'Fri'],
    startTime: '10:00',
    endTime: '11:00',
    startDate: new Date('2026-09-08T00:00:00Z'),
    endDate: new Date('2026-12-07T00:00:00Z'),
  };

  it('fans one meeting out to one event per weekday, with distinct uids', () => {
    const events = meetingEvents('CPSC 210', meeting);
    expect(events.map((e) => e.day)).toEqual(['Mon', 'Wed', 'Fri']);
    expect(new Set(events.map((e) => e.uid)).size).toBe(3);
    expect(events[0].title).toBe('CPSC 210 Lecture (201)');
  });

  it('leaves out the parts Workday did not give', () => {
    const [event] = meetingEvents('CPSC 210', {
      ...meeting,
      days: ['Tue'],
      activity: null,
      sectionCode: null,
    });
    expect(event.title).toBe('CPSC 210');
  });

  it('produces events buildIcs actually renders', () => {
    const ics = buildIcs('Term', meetingEvents('CPSC 210', meeting));
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain('BYDAY=MO');
    expect(ics).toContain('BYDAY=FR');
  });
});

/**
 * The room is what a phone offers directions from, so it is worth carrying
 * into the subscribed calendar rather than leaving in the web page.
 */
describe('event location', () => {
  it('writes LOCATION when the meeting has a place', () => {
    const ics = buildIcs('My Schedule', [{ ...event, location: 'BUCH A101' }]);
    expect(ics).toContain('LOCATION:BUCH A101');
  });

  it('omits the field entirely rather than writing an empty one', () => {
    expect(buildIcs('My Schedule', [event])).not.toContain('LOCATION:');
    expect(buildIcs('My Schedule', [{ ...event, location: null }])).not.toContain('LOCATION:');
  });

  it('escapes a comma the way RFC 5545 asks', () => {
    const ics = buildIcs('My Schedule', [{ ...event, location: 'BUCH, A101' }]);
    expect(ics).toContain(String.raw`LOCATION:BUCH\, A101`);
  });

  it('builds the place from an enrolled meeting row', () => {
    const [first] = meetingEvents('CPSC 110', {
      id: 'm1',
      sectionCode: '101',
      activity: 'Lecture',
      days: ['Mon'],
      startTime: '09:00',
      endTime: '10:00',
      startDate: null,
      endDate: null,
      building: 'CIRS',
      room: '1250',
    });
    expect(first.location).toBe('CIRS 1250');
  });
});

describe('one-off events', () => {
  const exam: IcsEvent = {
    uid: 'exam-1', title: 'BIOC 302 Final', day: null,
    startTime: '12:00', endTime: '14:30',
    startDate: new Date('2026-08-18T00:00:00Z'),
    endDate: new Date('2026-08-18T00:00:00Z'),
    location: 'BIOL 1000',
  };

  it('emits no RRULE for an event with no weekday', () => {
    const ics = buildIcs('Exams', [exam]);
    expect(ics).toContain('DTSTART;TZID=America/Vancouver:20260818T120000');
    expect(ics).not.toContain('RRULE');
  });

  it('still repeats a weekly meeting', () => {
    const weekly: IcsEvent = { ...exam, uid: 'w', day: 'Mon',
      endDate: new Date('2026-12-04T00:00:00Z') };
    expect(buildIcs('Term', [weekly])).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO');
  });
});

describe('examEvent', () => {
  const base = {
    id: 'e1', courseLabel: 'BIOC 302', sectionCode: '951',
    date: new Date('2026-08-18T00:00:00Z'), startTime: '12:00',
    location: 'BIOL 1000', alphaSplit: null, notes: null,
    cancelled: false, source: 'ubc' as const, kind: 'final' as const,
  };

  // UBC publishes no end time. The event still needs one, so it is ours.
  it('ends an exam a default duration after it starts', () => {
    expect(EXAM_DEFAULT_MINUTES).toBe(150);
    expect(examEvent(base)!.endTime).toBe('14:30');
  });

  it('rolls the default duration over an hour boundary correctly', () => {
    expect(examEvent({ ...base, startTime: '15:30' })!.endTime).toBe('18:00');
  });

  // Spec §6: the end time is our assumption, so the event has to say so.
  it('discloses the assumed end time in the event description', () => {
    const ics = buildIcs('Exams', [examEvent(base)!]);
    expect(ics).toMatch(/DESCRIPTION:.*UBC publishes a start time only/);
  });

  it('drops a cancelled exam from the feed', () => {
    expect(examEvent({ ...base, cancelled: true })).toBeNull();
  });

  it('drops a dateless exam rather than guessing', () => {
    expect(examEvent({ ...base, date: null, startTime: null })).toBeNull();
  });
});
