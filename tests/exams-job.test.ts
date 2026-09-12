import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { db } from '@/lib/db';
import { ingestExams } from '@/scrape/jobs/exams';

const html = readFileSync('tests/fixtures/exam-schedule.html', 'utf8');

describe('ingestExams', () => {
  it('writes every fixture row and skips none', async () => {
    const result = await ingestExams(html);
    expect(result.skipped).toEqual([]);
    expect(result.written).toBe(7);
  });

  it('is idempotent: a second run writes the same rows, not duplicates', async () => {
    await ingestExams(html);
    const before = await db.finalExam.count();
    const second = await ingestExams(html);
    expect(await db.finalExam.count()).toBe(before);
    expect(second.written).toBe(7);
  });

  it('keeps both rooms of an alpha-split course', async () => {
    await ingestExams(html);
    const course = await db.course.findFirstOrThrow({
      where: { number: '123', subject: { code: 'CHEM', campus: 'V' } },
    });
    const rows = await db.finalExam.findMany({
      where: { courseId: course.id, sectionCode: '921' },
      orderBy: { room: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => `${r.building} ${r.room}`)).toEqual(['IRC 2', 'IRC 6']);
    expect(rows.map((r) => r.alphaSplit).sort()).toEqual(['ADI-SUN', 'TAZ-ZHU']);
  });

  it('stores a cancelled exam with no date and keeps its note', async () => {
    await ingestExams(html);
    const course = await db.course.findFirstOrThrow({
      where: { number: '230', subject: { code: 'ENGL', campus: 'V' } },
    });
    const row = await db.finalExam.findFirstOrThrow({ where: { courseId: course.id } });
    expect(row.cancelled).toBe(true);
    expect(row.date).toBeNull();
    expect(row.startTime).toBeNull();
    expect(row.notes).toBe('Cancelled: August 17 2026, 3:30pm');
  });
});
