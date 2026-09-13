import { describe, it, expect } from 'vitest';
import { generateSchedules, DEFAULT_PREFS, type GeneratePrefs } from '@/schedule/generate';
import type { SectionHit } from '@/lib/search';

let nextId = 0;

function section(
  courseId: string,
  activity: string,
  meetings: [string, string, string][],
  extra: Partial<SectionHit> = {},
): SectionHit {
  nextId += 1;
  return {
    sectionId: `s${nextId}`,
    courseId,
    code: courseId.toUpperCase(),
    title: 'A course',
    sectionCode: `${activity[0]}${nextId}`,
    activity,
    status: 'Open',
    meetings: 'irrelevant here',
    meetingTimes: meetings.map(([day, startTime, endTime]) => ({
      day,
      startTime,
      endTime,
      building: null,
      room: null,
    })),
    instructors: ['Someone'],
    ...extra,
  };
}

function prefs(p: Partial<GeneratePrefs>): GeneratePrefs {
  return { ...DEFAULT_PREFS, ...p };
}

describe('generateSchedules', () => {
  it('finds the only conflict-free combination', () => {
    const pool = [
      section('cpsc110', 'Lecture', [['Mon', '09:00', '10:00']]),
      section('cpsc110', 'Laboratory', [['Tue', '09:00', '11:00']]),
      // This lab collides with the lecture, so only one bundle survives.
      section('cpsc110', 'Laboratory', [['Mon', '09:30', '11:30']]),
      section('math100', 'Lecture', [['Wed', '09:00', '10:00']]),
    ];
    const result = generateSchedules(pool, DEFAULT_PREFS);
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0].sectionIds).toHaveLength(3);
    expect(result.unplaceable).toEqual([]);
  });

  it('returns nothing when every combination collides across courses', () => {
    const pool = [
      section('cpsc110', 'Lecture', [['Mon', '09:00', '10:00']]),
      section('math100', 'Lecture', [['Mon', '09:30', '10:30']]),
    ];
    const result = generateSchedules(pool, DEFAULT_PREFS);
    expect(result.schedules).toEqual([]);
  });

  it('reports a course whose own lecture and lab always collide as unplaceable', () => {
    const pool = [
      section('cpsc110', 'Lecture', [['Mon', '09:00', '11:00']]),
      section('cpsc110', 'Laboratory', [['Mon', '10:00', '12:00']]),
      section('math100', 'Lecture', [['Wed', '09:00', '10:00']]),
    ];
    const result = generateSchedules(pool, DEFAULT_PREFS);
    expect(result.unplaceable).toEqual(['CPSC110']);
    // The rest of the timetable still generates.
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0].sectionIds).toHaveLength(1);
  });

  it('treats back-to-back classes as compatible, matching the conflict gate', () => {
    const pool = [
      section('cpsc110', 'Lecture', [['Mon', '09:00', '10:00']]),
      section('math100', 'Lecture', [['Mon', '10:00', '11:00']]),
    ];
    expect(generateSchedules(pool, DEFAULT_PREFS).schedules).toHaveLength(1);
  });

  it('never pairs sections of activities nobody plans (Waiting List, Thesis)', () => {
    const pool = [
      section('cpsc110', 'Lecture', [['Mon', '09:00', '10:00']]),
      section('cpsc110', 'Waiting List', [['Mon', '09:00', '10:00']]),
    ];
    const result = generateSchedules(pool, DEFAULT_PREFS);
    expect(result.schedules[0].sectionIds).toHaveLength(1);
  });

  it('ranks the later start first for someone avoiding mornings', () => {
    const early = section('cpsc110', 'Lecture', [['Mon', '08:00', '09:00']]);
    const late = section('cpsc110', 'Lecture', [['Mon', '13:00', '14:00']]);
    const result = generateSchedules([early, late], prefs({ earliest: 570 }));
    expect(result.schedules[0].sectionIds).toEqual([late.sectionId]);
    // The span is always stated; a satisfied bound needs no separate line.
    expect(result.schedules[0].notes).toContain('Classes run 13:00–14:00');
    expect(result.schedules[0].notes.join(' ')).not.toContain("Couldn't start");
  });

  it('says plainly when a time bound could not be met', () => {
    const only = section('cpsc110', 'Lecture', [['Mon', '08:00', '09:00']]);
    const result = generateSchedules([only], prefs({ earliest: 600 }));
    expect(result.schedules[0].notes).toContain(
      "Couldn't start after 10:00 - earliest is 8:00",
    );
  });

  it('ranks the morning section first when the day should end by 3 pm', () => {
    const early = section('cpsc110', 'Lecture', [['Mon', '08:00', '09:00']]);
    const late = section('cpsc110', 'Lecture', [['Mon', '16:00', '17:00']]);
    const result = generateSchedules([early, late], prefs({ latest: 900 }));
    expect(result.schedules[0].sectionIds).toEqual([early.sectionId]);
    expect(result.schedules[0].notes).toContain('Classes run 8:00–9:00');
  });

  it('gives every option enough to tell it apart, even with no preferences set', () => {
    const pool = [
      section('cpsc110', 'Lecture', [['Mon', '09:00', '10:00']]),
      section('cpsc110', 'Lecture', [['Tue', '14:00', '15:00']]),
      section('math100', 'Lecture', [['Mon', '11:00', '12:00']]),
    ];
    const result = generateSchedules(pool, DEFAULT_PREFS);
    expect(result.schedules.length).toBeGreaterThan(1);
    // Span, days and gap are stated regardless of what was asked, so two
    // different timetables never read identically.
    for (const s of result.schedules) {
      expect(s.notes.some((n) => n.startsWith('Classes run'))).toBe(true);
      expect(s.notes.some((n) => n.includes('day') && n.includes('campus'))).toBe(true);
    }
    const first = result.schedules[0].notes.join('|');
    const second = result.schedules[1].notes.join('|');
    expect(first).not.toEqual(second);
  });

  it('keeps a requested day free when it can, and says so', () => {
    const lecture = section('cpsc110', 'Lecture', [['Mon', '09:00', '10:00']]);
    const friday = section('math100', 'Lecture', [['Fri', '09:00', '10:00']]);
    const tuesday = section('math100', 'Lecture', [['Tue', '09:00', '10:00']]);
    const result = generateSchedules([lecture, friday, tuesday], prefs({ freeDays: [4] }));
    expect(result.schedules[0].sectionIds).toContain(tuesday.sectionId);
    expect(result.schedules[0].notes).toContain('Friday kept free');
  });

  it('admits when a requested free day is impossible instead of returning nothing', () => {
    const onlyOption = section('cpsc110', 'Lecture', [['Fri', '09:00', '10:00']]);
    const result = generateSchedules([onlyOption], prefs({ freeDays: [4] }));
    expect(result.schedules).toHaveLength(1);
    expect(result.schedules[0].notes).toContain("Couldn't keep Friday free");
  });

  it('protects a lunch break in the packed-but-fed mode', () => {
    // Two morning-to-afternoon walls vs a version with a noon gap.
    const wallA = section('cpsc110', 'Lecture', [['Mon', '10:00', '12:00']]);
    const wallB = section('math100', 'Lecture', [['Mon', '12:00', '14:00']]);
    const gapped = section('math100', 'Lecture', [['Mon', '13:00', '15:00']]);
    const result = generateSchedules([wallA, wallB, gapped], prefs({ rhythm: 'lunch' }));
    expect(result.schedules[0].sectionIds).toContain(gapped.sectionId);
    expect(result.schedules[0].notes).toContain('Room for lunch every day');
    expect(result.schedules[1].notes).toContain('No lunch break on Mon');
  });

  it('still packs the day outside the lunch window in that mode', () => {
    const lecture = section('cpsc110', 'Lecture', [['Mon', '14:00', '15:00']]);
    const near = section('math100', 'Lecture', [['Mon', '15:00', '16:00']]);
    const far = section('math100', 'Lecture', [['Mon', '18:00', '19:00']]);
    const result = generateSchedules([lecture, near, far], prefs({ rhythm: 'lunch' }));
    expect(result.schedules[0].sectionIds).toContain(near.sectionId);
  });

  it('prefers the compact day when asked to pack classes together', () => {
    const lecture = section('cpsc110', 'Lecture', [['Mon', '09:00', '10:00']]);
    const near = section('math100', 'Lecture', [['Mon', '10:00', '11:00']]);
    const far = section('math100', 'Lecture', [['Mon', '14:00', '15:00']]);
    const result = generateSchedules([lecture, near, far], prefs({ rhythm: 'compact' }));
    expect(result.schedules[0].sectionIds).toContain(near.sectionId);
  });

  it('prefers fewer days on campus when asked', () => {
    const lecture = section('cpsc110', 'Lecture', [['Mon', '09:00', '10:00']]);
    const sameDay = section('math100', 'Lecture', [['Mon', '11:00', '12:00']]);
    const otherDay = section('math100', 'Lecture', [['Thu', '11:00', '12:00']]);
    const result = generateSchedules([lecture, sameDay, otherDay], prefs({ fewerDays: true }));
    expect(result.schedules[0].sectionIds).toContain(sameDay.sectionId);
    expect(result.schedules[0].notes.join(' ')).toContain('1 day on campus');
  });

  it('prefers the well-rated instructor when asked, and says who', () => {
    const rated = section('cpsc110', 'Lecture', [['Mon', '09:00', '10:00']], {
      instructors: ['Great Teacher'],
    });
    const unrated = section('cpsc110', 'Lecture', [['Tue', '09:00', '10:00']]);
    const result = generateSchedules([rated, unrated], prefs({ bestProfs: true }), {
      [rated.sectionId]: 0.9,
    });
    expect(result.schedules[0].sectionIds).toEqual([rated.sectionId]);
    expect(result.schedules[0].notes.join(' ')).toContain('Great Teacher');
  });

  it('prefers an open section over a waitlisted one, all else equal', () => {
    const waitlisted = section('cpsc110', 'Lecture', [['Mon', '09:00', '10:00']], {
      status: 'Waitlist',
    });
    const open = section('cpsc110', 'Lecture', [['Tue', '09:00', '10:00']]);
    const result = generateSchedules([waitlisted, open], DEFAULT_PREFS);
    expect(result.schedules[0].sectionIds).toEqual([open.sectionId]);
    expect(result.schedules[1].notes.join(' ')).toContain('waitlisted');
  });

  it('keeps a section with no fixed meeting time schedulable without letting it conflict', () => {
    const pool = [
      section('cpsc449', 'Lecture', []),
      section('math100', 'Lecture', [['Mon', '09:00', '10:00']]),
    ];
    const result = generateSchedules(pool, DEFAULT_PREFS);
    expect(result.schedules[0].sectionIds).toHaveLength(2);
  });

  it('is deterministic: identical input, identical ranking', () => {
    const pool = [
      section('cpsc110', 'Lecture', [['Mon', '09:00', '10:00']]),
      section('cpsc110', 'Lecture', [['Tue', '09:00', '10:00']]),
      section('math100', 'Lecture', [['Wed', '09:00', '10:00']]),
      section('math100', 'Lecture', [['Thu', '09:00', '10:00']]),
    ];
    const a = generateSchedules(pool, DEFAULT_PREFS);
    const b = generateSchedules(pool, DEFAULT_PREFS);
    expect(a.schedules.map((s) => s.sectionIds)).toEqual(b.schedules.map((s) => s.sectionIds));
  });

  it('survives a big term without hanging, marking the ranking as sampled', () => {
    // Six courses, each with 10 lectures and 10 labs: 10^12 raw combinations.
    const pool: SectionHit[] = [];
    for (let c = 0; c < 6; c += 1) {
      for (let i = 0; i < 10; i += 1) {
        const day = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'][i % 5];
        const hour = 8 + (i % 10);
        pool.push(
          section(`course${c}`, 'Lecture', [[day, `${hour}:00`, `${hour}:50`]]),
          section(`course${c}`, 'Laboratory', [[day, `${hour + 1}:00`, `${hour + 1}:50`]]),
        );
      }
    }
    const started = Date.now();
    const result = generateSchedules(pool, prefs({ rhythm: 'compact' }));
    expect(Date.now() - started).toBeLessThan(3000);
    expect(result.schedules.length).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
  });

  it('never offers the same week twice under different section codes', () => {
    // Two labs at the identical hour: same week, different section codes.
    const pool = [
      section('cpsc110', 'Lecture', [['Mon', '09:00', '10:00']]),
      section('cpsc110', 'Laboratory', [['Tue', '14:00', '15:00']]),
      section('cpsc110', 'Laboratory', [['Tue', '14:00', '15:00']]),
    ];
    const result = generateSchedules(pool, DEFAULT_PREFS);
    expect(result.schedules).toHaveLength(1);
  });

  it('still offers genuinely different weeks', () => {
    const pool = [
      section('cpsc110', 'Lecture', [['Mon', '09:00', '10:00']]),
      section('cpsc110', 'Laboratory', [['Tue', '14:00', '15:00']]),
      section('cpsc110', 'Laboratory', [['Wed', '16:00', '17:00']]),
    ];
    const result = generateSchedules(pool, DEFAULT_PREFS);
    expect(result.schedules).toHaveLength(2);
  });
});
