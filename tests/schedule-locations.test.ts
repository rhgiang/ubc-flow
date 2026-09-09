import { describe, it, expect } from 'vitest';
import {
  collectSectionLocations,
  sanitizeSectionLocations,
  applySectionLocations,
} from '@/schedule/locations';
import type { SectionHit } from '@/lib/search';

/**
 * A section as the builder holds it. The catalogue never supplies building or
 * room (UBC's API has none), so anything here came from a Workday import.
 */
function hit(sectionId: string, meetings: { building?: string | null; room?: string | null }[]): SectionHit {
  return {
    sectionId,
    courseId: `course-${sectionId}`,
    code: 'CPSC 110',
    title: 'Computation, Programs, and Programming',
    sectionCode: '101',
    activity: 'Lecture',
    status: 'Open',
    meetings: 'Mon 09:00–10:00',
    meetingTimes: meetings.map((m, i) => ({
      day: ['Mon', 'Wed', 'Fri'][i] ?? 'Mon',
      startTime: '09:00',
      endTime: '10:00',
      building: m.building ?? null,
      room: m.room ?? null,
    })),
    instructors: [],
  };
}

describe('collectSectionLocations', () => {
  it('keeps one place per section, from the first meeting that has one', () => {
    const sections = [hit('s1', [{}, { building: 'BUCH', room: 'A101' }])];
    expect(collectSectionLocations(sections)).toEqual([
      { sectionId: 's1', building: 'BUCH', room: 'A101' },
    ]);
  });

  it('skips sections with nowhere to be — a catalogue-only pick has no room', () => {
    expect(collectSectionLocations([hit('s1', [{}, {}])])).toEqual([]);
  });

  it('keeps a room that arrived without a building', () => {
    expect(collectSectionLocations([hit('s1', [{ room: '1250' }])])).toEqual([
      { sectionId: 's1', building: null, room: '1250' },
    ]);
  });

  it('trims blanks away rather than storing whitespace', () => {
    expect(collectSectionLocations([hit('s1', [{ building: '  ', room: '  ' }])])).toEqual([]);
  });
});

describe('sanitizeSectionLocations', () => {
  const allowed = ['s1', 's2'];

  it('drops sections that are not in the schedule being saved', () => {
    const sent = [
      { sectionId: 's1', building: 'BUCH', room: 'A101' },
      { sectionId: 'not-mine', building: 'IKB', room: '182' },
    ];
    expect(sanitizeSectionLocations(sent, allowed)).toEqual([
      { sectionId: 's1', building: 'BUCH', room: 'A101' },
    ]);
  });

  it('caps a hand-crafted request rather than storing an essay', () => {
    const [kept] = sanitizeSectionLocations(
      [{ sectionId: 's1', building: 'B'.repeat(500), room: null }],
      allowed,
    );
    expect(kept.building).toHaveLength(40);
  });

  it('keeps the first mention when a section is sent twice', () => {
    const sent = [
      { sectionId: 's2', building: 'BUCH', room: 'A101' },
      { sectionId: 's2', building: 'IKB', room: '182' },
    ];
    expect(sanitizeSectionLocations(sent, allowed)).toEqual([
      { sectionId: 's2', building: 'BUCH', room: 'A101' },
    ]);
  });

  it('treats nothing sent as nothing to store', () => {
    expect(sanitizeSectionLocations(undefined, allowed)).toEqual([]);
    expect(sanitizeSectionLocations([], allowed)).toEqual([]);
  });
});

describe('applySectionLocations', () => {
  it('puts a saved room back on every meeting of its section', () => {
    const [restored] = applySectionLocations(
      [hit('s1', [{}, {}])],
      [{ sectionId: 's1', building: 'BUCH', room: 'A101' }],
    );
    expect(restored.meetingTimes.map((m) => [m.building, m.room])).toEqual([
      ['BUCH', 'A101'],
      ['BUCH', 'A101'],
    ]);
  });

  it('leaves a catalogue room alone if one ever appears', () => {
    const [restored] = applySectionLocations(
      [hit('s1', [{ building: 'SWNG', room: '121' }])],
      [{ sectionId: 's1', building: 'BUCH', room: 'A101' }],
    );
    expect(restored.meetingTimes[0]).toMatchObject({ building: 'SWNG', room: '121' });
  });

  it('leaves sections with nothing saved untouched', () => {
    const sections = [hit('s1', [{}])];
    expect(applySectionLocations(sections, [])).toBe(sections);
    expect(applySectionLocations(sections, [{ sectionId: 'other', building: 'X', room: '1' }])[0])
      .toMatchObject({ meetingTimes: [{ building: null, room: null }] });
  });

  it('survives the save-then-load round trip, which is the whole bug', () => {
    const imported = [hit('s1', [{ building: 'BUCH', room: 'A101' }, {}])];
    const saved = sanitizeSectionLocations(collectSectionLocations(imported), ['s1']);
    // Reloading rebuilds sections from the catalogue, where there is no room.
    const fromCatalogue = [hit('s1', [{}, {}])];
    const [reloaded] = applySectionLocations(fromCatalogue, saved);
    expect(reloaded.meetingTimes[0]).toMatchObject({ building: 'BUCH', room: 'A101' });
  });
});
