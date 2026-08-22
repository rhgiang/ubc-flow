import type { SectionHit } from '@/lib/search';

export type CourseGroup = { code: string; title: string; sections: SectionHit[] };

/**
 * Sections collapsed to one entry per course, preserving the order courses
 * first appear in.
 *
 * searchSectionsForTerm returns one row per SECTION, so an ungrouped list
 * repeats "CPSC 110" once per lecture, lab and tutorial — which is exactly
 * what the old flat sidebar did.
 */
export function groupSectionsByCourse(hits: SectionHit[]): CourseGroup[] {
  const byCode = new Map<string, CourseGroup>();
  for (const hit of hits) {
    const group = byCode.get(hit.code);
    if (group) group.sections.push(hit);
    else byCode.set(hit.code, { code: hit.code, title: hit.title, sections: [hit] });
  }
  return [...byCode.values()];
}
