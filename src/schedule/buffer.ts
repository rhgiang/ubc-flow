import type { SectionHit } from '@/lib/search';

export type SectionDiff = { added: string[]; removed: string[] };

/**
 * What must change to turn `current` into `next`.
 *
 * Both sides are de-duplicated first: a schedule holds a SET of sections
 * (ScheduleSection is keyed on (scheduleId, sectionId)), so a repeated id can
 * never mean two rows, and emitting it twice would make createMany fail on the
 * unique constraint.
 */
export function diffSections(current: string[], next: string[]): SectionDiff {
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  return {
    added: [...nextSet].filter((id) => !currentSet.has(id)),
    removed: [...currentSet].filter((id) => !nextSet.has(id)),
  };
}

/**
 * Replaces one held section with another, in a single pass.
 *
 * Deliberately not remove-then-add: two sequential updates render an
 * intermediate state with the course missing from the calendar, and appending
 * would move the section to the end of the panel instead of leaving it where
 * the student is already looking.
 */
export function swapSection(
  chosen: SectionHit[],
  oldSectionId: string,
  next: SectionHit,
): SectionHit[] {
  if (next.sectionId === oldSectionId) return chosen;

  const index = chosen.findIndex((s) => s.sectionId === oldSectionId);
  if (index === -1) return chosen;

  // Already held elsewhere - a schedule holds a set, so take the old one out
  // rather than creating a second row for the same section.
  if (chosen.some((s) => s.sectionId === next.sectionId)) {
    return chosen.filter((s) => s.sectionId !== oldSectionId);
  }

  const out = [...chosen];
  out[index] = next;
  return out;
}
