import { describe, it, expect } from 'vitest';
import { parseCourseCode, formatMeeting } from '@/lib/format';

describe('parseCourseCode', () => {
  it('splits a url slug into subject and number', () => {
    expect(parseCourseCode('cpsc-221')).toEqual({ subjectCode: 'CPSC', number: '221' });
  });

  it('handles a lettered course number', () => {
    expect(parseCourseCode('math-100a')).toEqual({ subjectCode: 'MATH', number: '100A' });
  });

  it('returns null on garbage', () => {
    expect(parseCourseCode('nonsense')).toBeNull();
  });
});

describe('formatMeeting', () => {
  it('renders day, time and place', () => {
    expect(
      formatMeeting({
        day: 'Mon',
        startTime: '09:00',
        endTime: '10:00',
        building: 'SWNG',
        room: '222',
      }),
    ).toBe('Mon 09:00-10:00 · SWNG 222');
  });

  it('omits the place when unknown', () => {
    expect(
      formatMeeting({ day: 'Tue', startTime: '13:00', endTime: '14:00', building: null, room: null }),
    ).toBe('Tue 13:00-14:00');
  });

  it('handles a day with no time', () => {
    expect(
      formatMeeting({ day: 'Wed', startTime: null, endTime: null, building: null, room: null }),
    ).toBe('Wed');
  });
});
