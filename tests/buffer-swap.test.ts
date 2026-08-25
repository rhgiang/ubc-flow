import { describe, it, expect } from 'vitest';
import { swapSection } from '@/schedule/buffer';
import type { SectionHit } from '@/lib/search';

const hit = (sectionId: string): SectionHit => ({
  sectionId,
  courseId: 'course-1',
  code: 'MATH 101',
  title: 'Integral Calculus',
  sectionCode: sectionId,
  activity: 'Lecture',
  meetings: 'Tue 10:00-12:00',
  meetingTimes: [],
  instructors: [],
});

describe('swapSection', () => {
  it('replaces the section in place, keeping its position', () => {
    const chosen = [hit('a'), hit('b'), hit('c')];
    const out = swapSection(chosen, 'b', hit('z'));
    expect(out.map((s) => s.sectionId)).toEqual(['a', 'z', 'c']);
  });

  it('does not mutate the input', () => {
    const chosen = [hit('a'), hit('b')];
    swapSection(chosen, 'b', hit('z'));
    expect(chosen.map((s) => s.sectionId)).toEqual(['a', 'b']);
  });

  it('drops the old section without duplicating one already held', () => {
    const chosen = [hit('a'), hit('b'), hit('c')];
    const out = swapSection(chosen, 'a', hit('c'));
    expect(out.map((s) => s.sectionId)).toEqual(['b', 'c']);
  });

  it('is a no-op when swapping a section for itself', () => {
    const chosen = [hit('a'), hit('b')];
    const out = swapSection(chosen, 'a', hit('a'));
    expect(out.map((s) => s.sectionId)).toEqual(['a', 'b']);
  });

  it('leaves the list alone when the old section is not held', () => {
    const chosen = [hit('a'), hit('b')];
    const out = swapSection(chosen, 'missing', hit('z'));
    expect(out.map((s) => s.sectionId)).toEqual(['a', 'b']);
  });
});
