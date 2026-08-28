import * as cheerio from 'cheerio';

/**
 * The Academic Calendar's course index, which is the only place that says
 * which faculty a subject belongs to.
 *
 * The course-search page the catalogue scraper reads offers subjects as a
 * flat <select> of id/name/campus — no faculty anywhere. Subject.faculty has
 * been an empty column since it was added; this is what fills it.
 */

export type RawFaculty = { name: string; path: string };

/** "/course-descriptions/institution/120" -> Faculty of Science */
export function parseFacultyIndex(html: string): RawFaculty[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const out: RawFaculty[] = [];
  $('a[href*="/course-descriptions/institution/"]').each((_, el) => {
    const path = ($(el).attr('href') ?? '').trim();
    const name = $(el).text().trim();
    if (!path || !name || seen.has(path)) return;
    seen.add(path);
    out.push({ name, path });
  });
  return out;
}

/**
 * Subject codes on a faculty's page, written "CPSC_V - Computer Science".
 *
 * The _V/_O suffix is the campus, which Subject stores separately, so it is
 * stripped here to match how codes are held in the database.
 */
export function parseFacultySubjects(html: string): string[] {
  const $ = cheerio.load(html);
  const codes = new Set<string>();

  // Per anchor first. Reading $.text() alone is not enough: cheerio
  // concatenates adjacent links with no separator, so "…Computer Science"
  // runs straight into "MATH_V - Mathematics" and a \b-anchored match skips
  // every subject that follows another one.
  $('a').each((_, el) => {
    const m = /^\s*([A-Z]{2,5})_[VO]\s*[-–]/.exec($(el).text());
    if (m) codes.add(m[1]);
  });

  // Then the page text, for faculties that render the list without links.
  //
  // cheerio's .text() joins sibling elements with no separator at all — not
  // even for block tags — so "…Ocean SciencesASTR_V – Astronomy" is one run.
  // A \b or [^A-Za-z] guard drops every code glued to the previous entry.
  // The lookbehind allows a letter before the code while still refusing to
  // start mid-way through a longer run of capitals.
  for (const m of $.text().matchAll(/(?<![A-Z])([A-Z]{2,5})_[VO]\s*[-–]\s*\S/g)) {
    codes.add(m[1]);
  }
  return [...codes];
}
