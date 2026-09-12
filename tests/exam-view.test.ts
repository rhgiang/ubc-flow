import { describe, it, expect } from 'vitest';
import { toExamListItem } from '@/schedule/exams';

describe('toExamListItem', () => {
  it('joins building and room into one location string', () => {
    const item = toExamListItem({
      id: 'e1', sectionCode: '951', date: new Date('2026-08-18T00:00:00Z'),
      startTime: '12:00', building: 'BIOL', room: '1000', alphaSplit: null,
      notes: null, cancelled: false,
      course: { number: '302', subject: { code: 'BIOC_V' } },
    });
    expect(item.location).toBe('BIOL 1000');
    expect(item.courseLabel).toBe('BIOC 302');
  });

  // "BIOC_V" is the Workday/scrape spelling; students read "BIOC".
  it('strips the campus suffix from the subject code', () => {
    const item = toExamListItem({
      id: 'e2', sectionCode: '001', date: null, startTime: null,
      building: null, room: null, alphaSplit: null,
      notes: 'Cancelled: August 17 2026, 3:30pm', cancelled: true,
      course: { number: '230', subject: { code: 'ENGL_V' } },
    });
    expect(item.courseLabel).toBe('ENGL 230');
    expect(item.location).toBeNull();
    expect(item.cancelled).toBe(true);
  });

  it('marks every scraped row as a final', () => {
    const item = toExamListItem({
      id: 'e3', sectionCode: '921', date: new Date('2026-08-18T00:00:00Z'),
      startTime: '08:30', building: 'IRC', room: '2', alphaSplit: 'ADI-SUN',
      notes: null, cancelled: false,
      course: { number: '123', subject: { code: 'CHEM' } },
    });
    expect(item.kind).toBe('final');
    expect(item.source).toBe('ubc');
    expect(item.alphaSplit).toBe('ADI-SUN');
  });
});
