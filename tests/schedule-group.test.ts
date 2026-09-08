import { describe, it, expect } from 'vitest';
import { groupSectionsByCourse } from '@/schedule/group';
import type { SectionHit } from '@/lib/search';

function hit(code: string, sectionCode: string, title = `${code} title`): SectionHit {
  return {
    sectionId: `${code}-${sectionCode}`,
    courseId: `course-${code}`,
    code,
    title,
    sectionCode,
    activity: 'Lecture',
    status: null,
    meetings: 'Mon 10:00–11:00',
    meetingTimes: [],
    instructors: [],
  };
}

describe('groupSectionsByCourse', () => {
  it('collapses every section of one course into a single group', () => {
    const groups = groupSectionsByCourse([hit('CPSC 110', '101'), hit('CPSC 110', 'L1A')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].code).toBe('CPSC 110');
    expect(groups[0].sections.map((s) => s.sectionCode)).toEqual(['101', 'L1A']);
  });

  it('keeps courses in the order they first appear', () => {
    const groups = groupSectionsByCourse([
      hit('MATH 200', '103'),
      hit('CPSC 110', '101'),
      hit('MATH 200', '104'),
    ]);
    expect(groups.map((g) => g.code)).toEqual(['MATH 200', 'CPSC 110']);
    expect(groups[0].sections).toHaveLength(2);
  });

  it('returns nothing for no hits', () => {
    expect(groupSectionsByCourse([])).toEqual([]);
  });

  it('carries the courseId of the course it grouped', () => {
    const groups = groupSectionsByCourse([hit('CPSC 110', '101'), hit('CPSC 110', 'L1A')]);
    expect(groups[0].courseId).toBe('course-CPSC 110');
  });
});
