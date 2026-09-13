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

  // Flipped: this used to expect the edited row to REPLACE the scraped one.
  // Nothing displaces a scraped row any more; both stay, each labelled.
  it('keeps a student-edited final beside the scraped one, never instead of it', () => {
    const edited = { ...syllabusFinal, editedByUser: true,
      date: new Date('2026-12-16T00:00:00Z') };
    const out = mergeExams([scrapedFinal], [edited]);
    expect(out.map((e) => e.id).sort()).toEqual(['syl-1', 'ubc-1']);
    expect(out.find((e) => e.id === 'ubc-1')).toEqual(scrapedFinal);
  });

  // The C1 scenario. September: the student types "CPSC 110 / Final exam"
  // with no date (every manual row is editedByUser). November: scrape:exams
  // writes UBC's row. The old rule dropped UBC's row for a course with one
  // scraped final, so the page said "Date TBA" and the feed carried nothing.
  it('never lets a hand-typed dateless final hide the final UBC published', () => {
    const typed: ExamListItem = {
      ...syllabusFinal, id: 'manual-1', courseLabel: 'CPSC 110', editedByUser: true,
      notes: 'Final exam',
    };
    const published: ExamListItem = {
      ...scrapedFinal, id: 'ubc-cpsc', courseLabel: 'CPSC 110', sectionCode: '101',
      date: new Date('2026-12-12T00:00:00Z'), startTime: '15:30', location: 'ESB 1013',
    };
    const out = mergeExams([published], [typed]);
    expect(out.map((e) => e.id)).toEqual(['ubc-cpsc', 'manual-1']);
    expect(out[0]).toEqual(published);
  });

  // Same rule, worse consequence: the scraped row was a cancellation notice.
  it('never lets a hand-typed final swallow a cancelled scraped final', () => {
    const typed: ExamListItem = { ...syllabusFinal, id: 'manual-1', editedByUser: true };
    const cancelled: ExamListItem = {
      ...scrapedFinal, id: 'ubc-cancelled', cancelled: true, date: null, startTime: null,
      location: null, notes: 'Cancelled: December 15 2026, 12:00pm',
    };
    const out = mergeExams([cancelled], [typed]);
    expect(out.map((e) => e.id).sort()).toEqual(['manual-1', 'ubc-cancelled']);
    expect(out.find((e) => e.id === 'ubc-cancelled')?.cancelled).toBe(true);
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
  // let the cancelled row land last and erase the live one - the student's
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

  // Correcting a date on the confirm screen is ordinary use, and it must not
  // take either of the course's rooms off the page.
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
