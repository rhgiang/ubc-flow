import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '@/lib/db';
import { matchWorkdayRows } from '@/upload/match-schedule';
import type { EnrollmentRow } from '@/upload/parse-workday';

type Fixture = {
  subjectCode: string;
  courseNumber: string;
  sectionCode: string;
  campus: string;
  termYear: number;
  termSession: string;
  termNumber: number | null;
  termId: string;
};

let fixture: Fixture;

beforeAll(async () => {
  const section = await db.section.findFirstOrThrow({
    where: { course: { subject: { code: { not: null } } } },
    include: { term: true, course: { include: { subject: true } } },
  });
  fixture = {
    subjectCode: section.course.subject.code!,
    courseNumber: section.course.number,
    sectionCode: section.sectionCode,
    campus: section.course.campus,
    termYear: section.term.year,
    termSession: section.term.session,
    termNumber: section.term.termNumber,
    termId: section.term.id,
  };
});

function row(over: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    subjectCode: fixture.subjectCode,
    campus: fixture.campus,
    courseNumber: fixture.courseNumber,
    sectionCode: fixture.sectionCode,
    activity: 'Lecture',
    building: null,
    room: null,
    startDate: '2026-09-09',
    termYear: fixture.termYear,
    termSession: fixture.termSession,
    termNumber: fixture.termNumber,
    days: ['Mon'],
    meetingStartTime: '10:00',
    meetingEndTime: '11:00',
    meetingEndDate: null,
    floor: null,
    credits: null,
    registrationStatus: null,
    deliveryMode: null,
    instructor: null,
    sectionStartDate: null,
    sectionEndDate: null,
    ...over,
  };
}

describe('matchWorkdayRows', () => {
  it('resolves a real registration row to its catalogue section', async () => {
    const result = await matchWorkdayRows([row()]);
    expect(result).not.toBeNull();
    expect(result!.terms).toHaveLength(1);
    expect(result!.terms[0].termId).toBe(fixture.termId);
    expect(result!.terms[0].matched).toHaveLength(1);
    expect(result!.terms[0].matched[0].sectionCode).toBe(fixture.sectionCode);
    expect(result!.terms[0].matched[0].courseId).toBeTruthy();
    expect(result!.terms[0].unmatched).toEqual([]);
  });

  it('reports a section code that does not exist, rather than dropping it', async () => {
    const result = await matchWorkdayRows([row({ sectionCode: 'ZZZ999' })]);
    expect(result).not.toBeNull();
    expect(result!.terms[0].matched).toEqual([]);
    expect(result!.terms[0].unmatched).toHaveLength(1);
    expect(result!.terms[0].unmatched[0]).toContain(fixture.subjectCode);
    expect(result!.terms[0].unmatched[0]).toContain('ZZZ999');
  });

  it('reports a course that is not in the catalogue at all', async () => {
    const result = await matchWorkdayRows([row({ subjectCode: 'ZZZZ', courseNumber: '999' })]);
    expect(result).not.toBeNull();
    expect(result!.terms[0].unmatched).toHaveLength(1);
    expect(result!.terms[0].unmatched[0]).toContain('ZZZZ 999');
  });

  it('refuses to guess a section when the export has no section number', async () => {
    const result = await matchWorkdayRows([row({ sectionCode: null })]);
    expect(result).not.toBeNull();
    expect(result!.terms[0].matched).toEqual([]);
    expect(result!.terms[0].unmatched).toHaveLength(1);
    expect(result!.terms[0].unmatched[0]).toContain('no section number');
  });

  it('fills the room and instructor the catalogue lacks from the export', async () => {
    // The fixture section's real meeting days, so the overlay applies.
    const days = (await matchWorkdayRows([row()]))!.terms[0].matched[0].meetingTimes.map(
      (m) => m.day,
    );
    const result = await matchWorkdayRows([
      row({ days, building: 'HENN', room: '202', instructor: 'Export Only' }),
    ]);
    const hit = result!.terms[0].matched[0];

    for (const m of hit.meetingTimes) {
      // The catalogue has no location for any section, so every one is filled.
      expect(m.building).toBe('HENN');
      expect(m.room).toBe('202');
    }
    // The catalogue wins when it knows the instructor; the export fills a gap.
    expect(hit.instructors.length).toBeGreaterThan(0);
  });

  it('de-duplicates a section that appears twice in the export', async () => {
    const result = await matchWorkdayRows([row(), row()]);
    expect(result!.terms[0].matched).toHaveLength(1);
  });

  it('returns null when no row resolves to a known term', async () => {
    const result = await matchWorkdayRows([row({ termYear: 1899, termSession: 'W', termNumber: 1 })]);
    expect(result).toBeNull();
  });

  it('returns EVERY term in the export, most sections first', async () => {
    const otherTerm = await db.term.findFirst({
      where: { campus: fixture.campus, id: { not: fixture.termId } },
      select: { year: true, session: true, termNumber: true },
    });
    if (!otherTerm) return; // single-term dataset

    const result = await matchWorkdayRows([
      row(),
      row(),
      row({
        termYear: otherTerm.year,
        termSession: otherTerm.session,
        termNumber: otherTerm.termNumber,
      }),
    ]);
    // Both terms come back so the student can build a schedule for each,
    // rather than the smaller one being stranded as "a different term".
    expect(result!.terms).toHaveLength(2);
    expect(result!.terms[0].termId).toBe(fixture.termId);
    expect(result!.terms[0].matched.length).toBeGreaterThanOrEqual(
      result!.terms[1].matched.length,
    );
    expect(result!.terms.map((t) => t.termId)).toContain(fixture.termId);
  });
});
