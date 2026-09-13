import { describe, it, expect } from 'vitest';
import { filterToOwnSection, examCoverage, groupExams, type ExamListItem } from '@/schedule/exams';

/**
 * `Enrollment` carries no section, so joining it to `FinalExam` on course+term
 * brings back EVERY published section - and 8 of the 108 courses in UBC's real
 * table publish more than one (PHIL_V 347 001/002, ENGL_V 110 JL1/JL2, LAW_V
 * 505 98A/98B, BUSI_V 393 951/971). A student in one section was shown both
 * exams, at different times in different buildings.
 */
const base = {
  kind: 'final' as const,
  date: new Date('2026-12-12T00:00:00Z'),
  startTime: '15:30',
  alphaSplit: null,
  notes: null,
  cancelled: false,
  source: 'ubc' as const,
};

function exam(over: Partial<ExamListItem> & { id: string }): ExamListItem {
  return { courseLabel: 'PHIL 347', sectionCode: '001', location: 'BUCH A101', ...base, ...over };
}

describe('filterToOwnSection', () => {
  // 100 of the 108 courses. This path must stay a no-op.
  it('leaves a course with one published section alone, section known or not', () => {
    const only = [exam({ id: 'a', courseLabel: 'MATH 200', sectionCode: '103' })];
    expect(filterToOwnSection(only, new Map())).toEqual(only);
    expect(filterToOwnSection(only, new Map([['MATH 200', '999']]))).toEqual(only);
  });

  it('keeps only the student\'s own section when the course published several', () => {
    const mine = exam({ id: 'a', sectionCode: '001', startTime: '08:30' });
    const theirs = exam({ id: 'b', sectionCode: '002', startTime: '15:30', location: 'SWNG 222' });

    const kept = filterToOwnSection([mine, theirs], new Map([['PHIL 347', '001']]));
    expect(kept).toEqual([mine]);
    expect(kept[0].ambiguousSection).toBeUndefined();
  });

  // Never silently pick one: the sections sit at different times in different
  // buildings, so a guess sends someone to the wrong room.
  it('shows every section, flagged, when the student\'s section is unknown', () => {
    const rows = [exam({ id: 'a', sectionCode: '001' }), exam({ id: 'b', sectionCode: '002' })];

    const kept = filterToOwnSection(rows, new Map());
    expect(kept.map((r) => r.id)).toEqual(['a', 'b']);
    expect(kept.every((r) => r.ambiguousSection)).toBe(true);
  });

  // Never hide a real exam because our matching failed - a stale import, a
  // section code UBC spells differently, anything.
  it('falls back to all sections, flagged, when the known section matches none', () => {
    const rows = [exam({ id: 'a', sectionCode: 'JL1' }), exam({ id: 'b', sectionCode: 'JL2' })];

    const kept = filterToOwnSection(rows, new Map([['PHIL 347', '105']]));
    expect(kept.map((r) => r.id)).toEqual(['a', 'b']);
    expect(kept.every((r) => r.ambiguousSection)).toBe(true);
  });

  it('matches across whitespace and case, the two transcriptions of one code', () => {
    const mine = exam({ id: 'a', sectionCode: '98A' });
    const theirs = exam({ id: 'b', sectionCode: '98B' });
    expect(filterToOwnSection([mine, theirs], new Map([['PHIL 347', ' 98a ']]))).toEqual([mine]);
  });

  it('filters each course independently', () => {
    const rows = [
      exam({ id: 'a', courseLabel: 'MATH 200', sectionCode: '103' }),
      exam({ id: 'b', courseLabel: 'PHIL 347', sectionCode: '001' }),
      exam({ id: 'c', courseLabel: 'PHIL 347', sectionCode: '002' }),
      exam({ id: 'd', courseLabel: 'ENGL 110', sectionCode: 'JL1' }),
      exam({ id: 'e', courseLabel: 'ENGL 110', sectionCode: 'JL2' }),
    ];

    const kept = filterToOwnSection(rows, new Map([['PHIL 347', '002']]));
    expect(kept.map((r) => r.id)).toEqual(['a', 'c', 'd', 'e']);
    expect(kept.filter((r) => r.ambiguousSection).map((r) => r.id)).toEqual(['d', 'e']);
  });

  // alphaSplit is a different axis: rows sharing a sectionCode are ONE exam in
  // several rooms, and groupExams collapses them AFTER this runs.
  it('keeps every room of an alpha-split exam, and drops the other section\'s', () => {
    const rows = [
      exam({ id: 'a', sectionCode: '001', alphaSplit: 'ABB-MEN', location: 'IRC 2' }),
      exam({ id: 'b', sectionCode: '001', alphaSplit: 'MER-ZHU', location: 'IRC 6' }),
      exam({ id: 'c', sectionCode: '002', alphaSplit: 'ABB-ZHU', location: 'SWNG 222' }),
    ];

    const kept = filterToOwnSection(rows, new Map([['PHIL 347', '001']]));
    expect(kept.map((r) => r.id)).toEqual(['a', 'b']);

    const groups = groupExams(kept);
    expect(groups).toHaveLength(1);
    expect(groups[0].map((r) => r.location)).toEqual(['IRC 2', 'IRC 6']);
  });

  it('groups an unknown-section split exam per section, not into one card', () => {
    const rows = [
      exam({ id: 'a', sectionCode: '001', startTime: '08:30', alphaSplit: 'ABB-MEN' }),
      exam({ id: 'b', sectionCode: '001', startTime: '08:30', alphaSplit: 'MER-ZHU' }),
      exam({ id: 'c', sectionCode: '002', startTime: '15:30' }),
    ];
    expect(groupExams(filterToOwnSection(rows, new Map()))).toHaveLength(2);
  });

  // A cancelled row is still that section's exam: it must survive filtering to
  // be shown struck through, and it must not drag a live sibling section in.
  it('keeps a cancelled exam when it is the student\'s own section', () => {
    const rows = [
      exam({ id: 'a', sectionCode: '001', cancelled: true, date: null, startTime: null,
        notes: 'Cancelled: August 17 2026, 3:30pm' }),
      exam({ id: 'b', sectionCode: '002' }),
    ];
    expect(filterToOwnSection(rows, new Map([['PHIL 347', '001']])).map((r) => r.id)).toEqual(['a']);
  });

  it('does not lose a dateless exam', () => {
    const rows = [
      exam({ id: 'a', sectionCode: '001', date: null, startTime: null }),
      exam({ id: 'b', sectionCode: '002' }),
    ];
    expect(filterToOwnSection(rows, new Map([['PHIL 347', '001']])).map((r) => r.id)).toEqual(['a']);
    expect(filterToOwnSection(rows, new Map()).map((r) => r.id)).toEqual(['a', 'b']);
  });

  // The coverage note names courses with NO registrar-scheduled final. Section
  // filtering must never empty a course that had one, or the page would claim
  // a course the student has an exam for has none.
  it('never empties a course, so examCoverage keeps telling the truth', () => {
    const rows = [exam({ id: 'a', sectionCode: '001' }), exam({ id: 'b', sectionCode: '002' })];
    for (const known of [new Map(), new Map([['PHIL 347', '001']]), new Map([['PHIL 347', 'zzz']])]) {
      const kept = filterToOwnSection(rows, known as Map<string, string>);
      expect(kept.length).toBeGreaterThan(0);
      expect(examCoverage(kept, ['PHIL 347'], true)).toEqual({ published: true, noFinal: [] });
    }
  });
});
