import { describe, it, expect } from 'vitest';
import { shortCourseLabel } from '@/canvas/course-label';

describe('shortCourseLabel', () => {
  it('shortens the real shapes from the captured feed', () => {
    // Every one of these is verbatim from tests/fixtures/canvas-feed.ics.
    expect(shortCourseLabel('MUSC_V 103 002 2026W1')).toBe('MUSC 103 002');
    expect(shortCourseLabel('GEOG_V 122 004/005 2026W1')).toBe('CPSC 110');
    expect(shortCourseLabel('HIST_V 102 101/102/103 2026W1')).toBe('DSCI 100');
    expect(shortCourseLabel('ASTR_V 101 001 2026W1')).toBe('ASTR 101 001');
    expect(shortCourseLabel('PHIL_V 120 12A 2026W1')).toBe('BIOL 121 124');
  });

  it('keeps a single section, because a student wants to know which one', () => {
    expect(shortCourseLabel('MATH_V 100 101 2026W1')).toBe('MATH 100 101');
  });

  it('drops a cross-listed run of sections, which is noise', () => {
    expect(shortCourseLabel('PHYS_V 117 201/202 2026W1')).toBe('PHYS 117');
  });

  it('handles a course number with a trailing letter', () => {
    expect(shortCourseLabel('ENGL_V 110A 001 2026W1')).toBe('ENGL 110A 001');
  });

  it('works without a term suffix', () => {
    expect(shortCourseLabel('CPSC_V 121 200')).toBe('CPSC 121 200');
  });

  it('returns anything it does not recognise untouched', () => {
    // Half-mangling a name is worse than leaving it alone: the badge is the
    // only thing telling a student which course a deadline belongs to.
    expect(shortCourseLabel('Some Ad Hoc Canvas Course')).toBe('Some Ad Hoc Canvas Course');
    expect(shortCourseLabel('CPSC 110')).toBe('CPSC 110');
    expect(shortCourseLabel('')).toBe('');
  });

  it('never changes the identity the colour and the mute list are keyed on', () => {
    // Two different courses must not shorten to the same badge by accident.
    const a = shortCourseLabel('CPSC_V 110 101 2026W1');
    const b = shortCourseLabel('CPSC_V 110 102 2026W1');
    expect(a).not.toBe(b);
  });
});
