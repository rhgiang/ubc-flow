import { describe, it, expect } from 'vitest';
import { mergeExams, type ExamListItem } from '@/schedule/exams';

const scrapedFinal: ExamListItem = {
  id: 'ubc-1', courseLabel: 'BIOC 302', sectionCode: '951', kind: 'final',
  date: new Date('2026-12-15T00:00:00Z'), startTime: '12:00',
  location: 'BIOL 1000', alphaSplit: null, notes: null,
  cancelled: false, source: 'ubc',
};
const syllabusFinal: ExamListItem = {
  ...scrapedFinal, id: 'syl-1', date: null, startTime: null,
  location: null, source: 'syllabus',
};
const midterm: ExamListItem = {
  ...syllabusFinal, id: 'syl-2', kind: 'midterm',
  date: new Date('2026-10-14T00:00:00Z'), startTime: '18:00',
};
const datelessMidterm: ExamListItem = {
  ...syllabusFinal, id: 'syl-3', kind: 'midterm', courseLabel: 'MATH 101',
};

describe('mergeExams', () => {
  it('prefers UBC over a syllabus final for the same course', () => {
    const out = mergeExams([scrapedFinal], [syllabusFinal]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('ubc');
    expect(out[0].location).toBe('BIOL 1000');
  });

  it('keeps midterms, which never collide with scraped finals', () => {
    const out = mergeExams([scrapedFinal], [midterm]);
    expect(out).toHaveLength(2);
  });

  it('lets a student-edited row win over the scraped one', () => {
    const edited = { ...syllabusFinal, editedByUser: true,
      date: new Date('2026-12-16T00:00:00Z') };
    const out = mergeExams([scrapedFinal], [edited]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('syllabus');
  });

  it('sorts by date with dateless entries last', () => {
    const out = mergeExams([scrapedFinal], [midterm, datelessMidterm]);
    expect(out.map((e) => e.id)).toEqual(['syl-2', 'ubc-1', 'syl-3']);
    expect(out[out.length - 1].date).toBeNull();
  });

  it('does not merge finals from different courses', () => {
    const other = { ...scrapedFinal, id: 'ubc-2', courseLabel: 'MATH 101' };
    expect(mergeExams([scrapedFinal, other], [])).toHaveLength(2);
  });

  it('keeps every midterm of a course, not just the last', () => {
    const m1 = midterm;
    const m2 = { ...midterm, id: 'syl-m2', date: new Date('2026-11-12T00:00:00Z') };
    const out = mergeExams([], [m1, m2]);
    expect(out.map((e) => e.id).sort()).toEqual(['syl-2', 'syl-m2']);
  });

  it('still collapses a duplicate final for the same course', () => {
    const out = mergeExams([scrapedFinal], [syllabusFinal]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('ubc');
  });

  // Enrollment carries no section, so examRowsForUser returns EVERY FinalExam
  // row for the course. CHEM 123 splits by surname across two rooms; keeping
  // one of them sends half the class to the wrong building.
  it('keeps both halves of an alpha-split final', () => {
    const adi: ExamListItem = {
      ...scrapedFinal, id: 'ubc-adi', courseLabel: 'CHEM 123', sectionCode: '921',
      alphaSplit: 'ADI-SUN', location: 'IRC 2', startTime: '08:30',
    };
    const taz: ExamListItem = { ...adi, id: 'ubc-taz', alphaSplit: 'TAZ-ZHU', location: 'IRC 6' };
    const out = mergeExams([adi, taz], []);
    expect(out.map((e) => e.location).sort()).toEqual(['IRC 2', 'IRC 6']);
  });

  // examRowsForUser sorts cancelled/dateless rows last, so a per-course key
  // let the cancelled row land last and erase the live one — the student's
  // real exam replaced by a struck-through "cancelled" card.
  it('never lets a cancelled scraped final replace a live one for the same course', () => {
    const live: ExamListItem = { ...scrapedFinal, id: 'ubc-live', sectionCode: '921' };
    const cancelled: ExamListItem = {
      ...scrapedFinal, id: 'ubc-cancelled', sectionCode: '951', cancelled: true,
      date: null, startTime: null, location: null, notes: 'Cancelled',
    };
    const out = mergeExams([live, cancelled], []);
    expect(out.map((e) => e.id)).toEqual(['ubc-live', 'ubc-cancelled']);
    expect(out[0].cancelled).toBe(false);
  });

  // An edited syllabus final wins over THE scraped final (spec §9: "when the
  // same exam appears twice"). A sibling alpha-split row is not the same exam,
  // so correcting a date on the confirm screen — ordinary use — must not take
  // both of the course's rooms off the page.
  it('keeps both alpha-split finals even when the student edited a syllabus final', () => {
    const adi: ExamListItem = {
      ...scrapedFinal, id: 'ubc-adi', courseLabel: 'CHEM 123', sectionCode: '921',
      alphaSplit: 'ADI-SUN', location: 'IRC 2', startTime: '08:30',
    };
    const taz: ExamListItem = { ...adi, id: 'ubc-taz', alphaSplit: 'TAZ-ZHU', location: 'IRC 6' };
    const edited: ExamListItem = {
      ...syllabusFinal, id: 'syl-chem', courseLabel: 'CHEM 123', editedByUser: true,
      date: new Date('2026-12-16T00:00:00Z'), startTime: '09:00',
    };

    const out = mergeExams([adi, taz], [edited]);
    expect(out.map((e) => e.id).sort()).toEqual(['syl-chem', 'ubc-adi', 'ubc-taz']);
    expect(out.map((e) => e.location)).toContain('IRC 2');
    expect(out.map((e) => e.location)).toContain('IRC 6');
  });
});
