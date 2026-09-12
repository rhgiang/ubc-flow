import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseExamSchedule, type ExamRow } from '@/scrape/parse-exams';

const html = readFileSync('tests/fixtures/exam-schedule.html', 'utf8');
const parsed = parseExamSchedule(html);
const find = (course: string, split?: string): ExamRow =>
  parsed.rows.find(
    (r) => `${r.subjectCode} ${r.courseNumber}.${r.sectionCode}` === course &&
      (split === undefined || r.alphaSplit === split),
  )!;

describe('parseExamSchedule', () => {
  it('reads every row in the table', () => {
    expect(parsed.rows).toHaveLength(7);
  });

  it('splits a plain course listing and location', () => {
    const r = find('BIOC_V 302.951');
    expect(r).toMatchObject({
      subjectCode: 'BIOC_V',
      courseNumber: '302',
      sectionCode: '951',
      date: '2026-08-18',
      startTime: '12:00',
      building: 'BIOL',
      room: '1000',
      cancelled: false,
    });
  });

  // "SEE PROF" matches a naive BUILDING ROOM regex. The room must contain a
  // digit, or a student is sent looking for a building called SEE.
  it('treats SEE PROF as no location rather than splitting it', () => {
    const r = find('AMNE_V 101.901');
    expect(r.building).toBeNull();
    expect(r.room).toBeNull();
    expect(r.date).toBe('2026-08-20');
  });

  it('keeps both halves of an alpha-split course', () => {
    expect(find('CHEM_V 123.921', 'ADI-SUN').room).toBe('2');
    expect(find('CHEM_V 123.921', 'ADI-SUN').building).toBe('IRC');
    expect(find('CHEM_V 123.921', 'TAZ-ZHU').room).toBe('6');
  });

  it('parses non-numeric section codes', () => {
    expect(find('FNH_V 497.B_941').sectionCode).toBe('B_941');
    expect(find('AUDI_V 402.98A').sectionCode).toBe('98A');
  });

  it('converts 12-hour times, including noon and midnight-adjacent hours', () => {
    expect(find('BIOC_V 302.951').startTime).toBe('12:00'); // 12:00 PM
    expect(find('CHEM_V 123.921', 'ADI-SUN').startTime).toBe('08:30'); // AM
    expect(find('AUDI_V 402.98A').startTime).toBe('15:30'); // 03:30 PM
  });

  it('flags a cancelled exam and keeps its note, despite empty date cells', () => {
    const r = find('ENGL_V 230.001');
    expect(r.cancelled).toBe(true);
    expect(r.date).toBeNull();
    expect(r.startTime).toBeNull();
    expect(r.notes).toBe('Cancelled: August 17 2026, 3:30pm');
  });

  it('keeps non-cancelling notes without flagging them', () => {
    expect(find('FNH_V 497.B_941').notes).toBe('Location Change (was DMP 201)');
    expect(find('FNH_V 497.B_941').cancelled).toBe(false);
    expect(find('AUDI_V 402.98A').notes).toBe('Late Request');
  });

  // A cancelled row has no date, so per-row inference would drop it into no
  // term at all. One published table is one exam period.
  it('derives one term for the whole run from the dated rows', () => {
    expect(parsed.term).toEqual({ year: 2026, session: 'S', termNumber: null });
  });

  it('returns no rows and no term for markup with no exam table', () => {
    const empty = parseExamSchedule('<html><body><p>Maintenance</p></body></html>');
    expect(empty.rows).toEqual([]);
    expect(empty.term).toBeNull();
  });
});
