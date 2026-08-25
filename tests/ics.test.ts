import { describe, it, expect } from 'vitest';
import { buildIcs, meetingEvents, type IcsEvent } from '@/schedule/ics';

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
