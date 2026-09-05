import { describe, it, expect } from 'vitest';
import { courseNumberOnly } from '@/components/schedule/ScheduleCalendar';

describe('courseNumberOnly', () => {
  it('keeps the number, which is what distinguishes two courses in one subject', () => {
    expect(courseNumberOnly('CPSC 110')).toBe('110');
    expect(courseNumberOnly('CPSC 121')).toBe('121');
    expect(courseNumberOnly('MATH 200')).toBe('200');
  });

  it('keeps a trailing letter — 101A and 101B are different courses', () => {
    expect(courseNumberOnly('BIOL 140A')).toBe('140A');
  });

  it('returns a single-word code unchanged rather than emptying the block', () => {
    expect(courseNumberOnly('CPSC')).toBe('CPSC');
    expect(courseNumberOnly('')).toBe('');
  });

  it('is not confused by extra whitespace from the catalogue', () => {
    expect(courseNumberOnly('  CPSC   110  ')).toBe('110');
  });
});
