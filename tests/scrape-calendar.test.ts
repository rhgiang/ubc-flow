import { describe, expect, it } from 'vitest';
import { parseFacultyIndex, parseFacultySubjects } from '@/scrape/parse-faculties';
import { parseCourseDescriptions, subjectPath } from '@/scrape/parse-course-descriptions';

describe('faculty index', () => {
  it('reads faculties and their institution paths', () => {
    const html = `<ul>
      <li><a href="/course-descriptions/institution/120">Faculty of Science</a></li>
      <li><a href="/course-descriptions/institution/88">Faculty of Arts</a></li>
      <li><a href="/course-descriptions/institution/120">Faculty of Science</a></li>
      <li><a href="/somewhere-else">Not a faculty</a></li>
    </ul>`;
    const out = parseFacultyIndex(html);
    expect(out).toHaveLength(2); // deduped, unrelated link ignored
    expect(out[0]).toEqual({
      name: 'Faculty of Science',
      path: '/course-descriptions/institution/120',
    });
  });

  it('reads subject codes and strips the campus suffix', () => {
    const html = `<div><a>CPSC_V - Computer Science</a><a>MATH_V - Mathematics</a>
      <a>EOSC_V - Earth and Ocean Sciences</a><p>ASTR_V – Astronomy</p></div>`;
    const codes = parseFacultySubjects(html);
    expect(codes).toContain('CPSC');
    expect(codes).toContain('MATH'); // glued to the previous entry's text
    expect(codes).toContain('ASTR'); // en-dash separator
    expect(codes.some((c) => c.includes('_'))).toBe(false);
  });

  it('does not invent codes from ordinary prose', () => {
    expect(parseFacultySubjects('<p>Courses offered by the Faculty of Science.</p>')).toEqual([]);
  });
});

describe('calendar course listing', () => {
  const page = `
    <article><h3>MATH_V 100 (3)  Differential Calculus with Applications</h3></article>
    <article><h3>MATH_V 102 (3)  Differential Calculus with Applications to Life Sciences</h3></article>
    <article><h3>MATH_V 449 (3/6) d  Honours Essay</h3></article>
    <article><h3>MATH_O 100 (3)  Okanagan course</h3></article>
    <article><h3>Not a course heading</h3></article>`;

  it('reads code, number, credits and title', () => {
    const out = parseCourseDescriptions(page, 'V');
    expect(out[0]).toEqual({
      subjectCode: 'MATH',
      number: '100',
      title: 'Differential Calculus with Applications',
      credits: 3,
    });
    // The course the sections scraper never sees, because nothing offers it.
    expect(out.some((c) => c.number === '102')).toBe(true);
  });

  it('takes the lower bound of a credit range', () => {
    expect(parseCourseDescriptions(page, 'V').find((c) => c.number === '449')?.credits).toBe(3);
  });

  it('ignores other campuses and non-course headings', () => {
    expect(parseCourseDescriptions(page, 'V')).toHaveLength(3);
  });

  it('builds the subject page path', () => {
    expect(subjectPath('MATH', 'V')).toBe('/course-descriptions/subject/mathv');
    expect(subjectPath('CPSC', 'V')).toBe('/course-descriptions/subject/cpscv');
  });
});
