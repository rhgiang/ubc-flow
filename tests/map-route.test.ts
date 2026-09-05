import { describe, it, expect } from 'vitest';
import { dayRoute, metresBetween, walkMinutes } from '@/map/route';
import { findBuilding } from '@/map/buildings';
import type { CalendarEntry } from '@/components/schedule/ScheduleCalendar';

function entry(partial: Partial<CalendarEntry> & { day: string }): CalendarEntry {
  return {
    id: Math.random().toString(36).slice(2),
    sectionId: 's1',
    label: 'CPSC 110 101',
    courseCode: 'CPSC 110',
    startTime: null,
    endTime: null,
    ...partial,
  } as CalendarEntry;
}

describe('metresBetween / walkMinutes', () => {
  it('measures a known campus pair to a sane figure', () => {
    // ICCS to the Nest is a familiar ~500m walk; accept a broad band so the
    // test pins sanity, not survey precision.
    const iccs = findBuilding('ICCS')!;
    const math = findBuilding('MATH')!;
    const m = metresBetween(iccs, math);
    expect(m).toBeGreaterThan(200);
    expect(m).toBeLessThan(1500);
    // Walk estimate scales from that distance and is never zero.
    expect(walkMinutes(iccs, math)).toBeGreaterThan(0);
    expect(walkMinutes(iccs, math)).toBeLessThan(30);
  });

  it('is zero metres from a building to itself', () => {
    const b = findBuilding('ICCS')!;
    expect(metresBetween(b, b)).toBe(0);
  });
});

describe('dayRoute', () => {
  it('orders stops by start time and computes gap vs walk', () => {
    const { stops, legs } = dayRoute(
      [
        entry({ day: 'Mon', building: 'MATH', startTime: '14:00', endTime: '15:00', courseCode: 'MATH 200' }),
        entry({ day: 'Mon', building: 'ICCS', startTime: '09:00', endTime: '10:00', courseCode: 'CPSC 110' }),
      ],
      'Mon',
    );
    expect(stops.map((s) => s.code)).toEqual(['ICCS', 'MATH']);
    expect(legs).toHaveLength(1);
    expect(legs[0].gapMin).toBe(240);
    expect(legs[0].tight).toBe(false);
  });

  it('merges consecutive classes in the same building into one stop', () => {
    const { stops, legs } = dayRoute(
      [
        entry({ day: 'Tue', building: 'SWNG', startTime: '09:00', endTime: '10:00' }),
        entry({ day: 'Tue', building: 'SWNG', startTime: '10:00', endTime: '11:00', courseCode: 'MATH 200' }),
      ],
      'Tue',
    );
    expect(stops).toHaveLength(1);
    expect(stops[0].labels).toHaveLength(2);
    expect(stops[0].end).toBe(11 * 60);
    expect(legs).toHaveLength(0);
  });

  it('flags a leg whose walk exceeds the gap', () => {
    // Zero-minute gap between two distinct buildings can never be walked.
    const { legs } = dayRoute(
      [
        entry({ day: 'Wed', building: 'ICCS', startTime: '09:00', endTime: '10:00' }),
        entry({ day: 'Wed', building: 'MATH', startTime: '10:00', endTime: '11:00' }),
      ],
      'Wed',
    );
    expect(legs[0].gapMin).toBe(0);
    expect(legs[0].tight).toBe(true);
  });

  it('skips entries without a time or a locatable building, and says so', () => {
    const { stops, skipped } = dayRoute(
      [
        entry({ day: 'Thu', building: 'ICCS', startTime: '09:00', endTime: '10:00' }),
        entry({ day: 'Thu', building: 'NOPE', startTime: '11:00', endTime: '12:00', courseCode: 'BIOL 121' }),
        entry({ day: 'Thu', building: 'MATH', courseCode: 'STAT 201' }), // untimed
      ],
      'Thu',
    );
    expect(stops).toHaveLength(1);
    expect([...skipped].sort()).toEqual(['BIOL 121', 'STAT 201']);
  });

  it('only takes the asked-for day', () => {
    const { stops } = dayRoute(
      [entry({ day: 'Mon', building: 'ICCS', startTime: '09:00', endTime: '10:00' })],
      'Fri',
    );
    expect(stops).toHaveLength(0);
  });
});
