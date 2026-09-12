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
});
