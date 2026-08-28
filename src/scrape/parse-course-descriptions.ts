import * as cheerio from 'cheerio';

/**
 * The Academic Calendar's per-subject course listing.
 *
 * This is the only complete catalogue we have. Course rows are otherwise
 * created solely by the sections scraper — it holds the single course.upsert
 * in the codebase — so a course exists only if some scraped term happened to
 * offer it. MATH 102 and 104 are ordinary current courses that no scraped
 * term runs, and to the app they simply did not exist.
 */

export type RawCourse = {
  subjectCode: string;
  number: string;
  title: string;
  credits: number | null;
};

/** "MATH_V 102 (3)  Differential Calculus with Applications to Life Sciences" */
const HEADING = /^([A-Z]{2,5})_([VO])\s+(\d{2,3}[A-Z]?)\s*\(([^)]*)\)\s*(.+)$/;

/**
 * Credits are usually a plain number but the Calendar also writes ranges and
 * variable values — "3", "1-6", "3/6 d". Take the first number and let the
 * rest go; a range's lower bound is the honest default for planning, and the
 * alternative is treating the course as creditless.
 */
function parseCredits(raw: string): number | null {
  const m = /(\d+(?:\.\d+)?)/.exec(raw);
  return m ? Number(m[1]) : null;
}

export function parseCourseDescriptions(html: string, campus: string): RawCourse[] {
  const $ = cheerio.load(html);
  const out: RawCourse[] = [];
  const seen = new Set<string>();

  $('h3').each((_, el) => {
    const heading = $(el).text().replace(/\s+/g, ' ').trim();
    const m = HEADING.exec(heading);
    if (!m) return;
    const [, subjectCode, campusLetter, number, credits, title] = m;
    if (campusLetter !== campus) return;
    const key = `${subjectCode} ${number}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      subjectCode,
      number,
      title: title.trim(),
      credits: parseCredits(credits),
    });
  });

  return out;
}

/** "MATH" + "V" -> the Calendar's subject page path. */
export function subjectPath(subjectCode: string, campus: string): string {
  return `/course-descriptions/subject/${subjectCode.toLowerCase()}${campus.toLowerCase()}`;
}
