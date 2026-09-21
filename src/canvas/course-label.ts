// src/canvas/course-label.ts

/**
 * Shortens the course name Canvas puts in a SUMMARY's trailing bracket, for
 * display only.
 *
 *   "MUSC_V 103 002 2026W1"              -> "MUSC 103 002"
 *   "GEOG_V 122 004/005 2026W1"      -> "CPSC 110"
 *   "HIST_V 102 101/102/103 2026W1"  -> "DSCI 100"
 *
 * UBC's Canvas writes "<SUBJ>_V <NUMBER> <SECTIONS> <TERM>". The "_V" is the
 * Vancouver campus marker, the term repeats on every row of a page a student
 * is reading this term, and a run of slash-joined sections is a cross-listing
 * rather than anything the student picked. Stripped, the badge says the one
 * thing that identifies the course.
 *
 * Display only. The raw name stays the identity everywhere it matters: it is
 * what the colour is hashed from and what a mute preference is stored under,
 * so shortening can never change which course something belongs to, and a
 * name that does not fit the pattern comes back untouched rather than
 * half-mangled.
 */
const UBC = /^([A-Z]{2,5})_V (\d{2,3}[A-Z]?) (\S+)(?: (\d{4}[WS]\d?))?$/;

export function shortCourseLabel(courseName: string): string {
  const m = courseName.trim().match(UBC);
  if (!m) return courseName;
  const [, subject, number, sections] = m;
  // A single section is worth keeping, since a student in one of several
  // lectures wants to know which. A cross-listed run of them is noise.
  const keepSections = !sections.includes('/');
  return keepSections ? `${subject} ${number} ${sections}` : `${subject} ${number}`;
}
