/** Number of course-colour slots defined in globals.css (--course-N-bg/accent). */
export const COURSE_COLOR_COUNT = 8;

/**
 * Stable colour slot for a course code, 1-based to match the CSS variable
 * names (`--course-3-bg`).
 *
 * Deterministic so a course keeps its colour across reloads and matches
 * between the calendar and the left panel. Same shape as the placeholder-avatar
 * hash in ReviewCard, but with multiplier 33 rather than 31: at 31, two courses
 * in one subject collide often enough to matter — "CPSC 110" and "CPSC 121"
 * both land in slot 6, which is exactly the pair a student sees side by side.
 */
export function courseColorIndex(code: string): number {
  let hash = 0;
  for (let i = 0; i < code.length; i++) hash = (hash * 33 + code.charCodeAt(i)) | 0;
  return (Math.abs(hash) % COURSE_COLOR_COUNT) + 1;
}
