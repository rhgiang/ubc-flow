import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ScheduleCalendar, {
  courseNumberOnly,
  type CalendarEntry,
} from '@/components/schedule/ScheduleCalendar';

describe('courseNumberOnly', () => {
  it('keeps the number, which is what distinguishes two courses in one subject', () => {
    expect(courseNumberOnly('CPSC 110')).toBe('110');
    expect(courseNumberOnly('CPSC 121')).toBe('121');
    expect(courseNumberOnly('MATH 200')).toBe('200');
  });

  it('keeps a trailing letter - 101A and 101B are different courses', () => {
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

// Where a label lands in the rendered markup: the strip above the grid whose
// heading is `strip`, or anywhere else (the grid or the legend).
function stripContaining(entries: CalendarEntry[], label: string, strip: string): boolean {
  const html = renderToStaticMarkup(createElement(ScheduleCalendar, { entries }));
  const a = html.indexOf(strip);
  if (a === -1) return false;
  const b = html.indexOf('</ul>', a);
  const i = html.indexOf(label);
  return i > a && i < b;
}

const entry = (over: Partial<CalendarEntry>): CalendarEntry => ({
  id: 'lab-0',
  sectionId: 'lab',
  label: 'CPSC_V 110-L1U',
  courseCode: 'CPSC 110',
  day: 'Thu',
  startTime: '09:00',
  endTime: '12:00',
  ...over,
});

describe('ScheduleCalendar strips above the grid', () => {
  it('files a Saturday lab with a time under Weekend, with its day and time', () => {
    const html = renderToStaticMarkup(
      createElement(ScheduleCalendar, { entries: [entry({ day: 'Sat' })] }),
    );
    expect(stripContaining([entry({ day: 'Sat' })], 'CPSC_V 110-L1U', 'Weekend')).toBe(true);
    expect(html).toContain('Sat 09:00\u201312:00');
    expect(html).not.toContain('No fixed meeting time');
  });

  it('keeps an entry with no time under No fixed meeting time', () => {
    const e = entry({ startTime: null, endTime: null });
    expect(stripContaining([e], 'CPSC_V 110-L1U', 'No fixed meeting time')).toBe(true);
    expect(stripContaining([e], 'CPSC_V 110-L1U', 'Weekend')).toBe(false);
  });

  it('puts a weekday entry with a time in neither strip', () => {
    const html = renderToStaticMarkup(createElement(ScheduleCalendar, { entries: [entry({})] }));
    expect(html).toContain('CPSC_V 110-L1U');
    expect(html).not.toContain('Weekend');
    expect(html).not.toContain('No fixed meeting time');
  });
});
