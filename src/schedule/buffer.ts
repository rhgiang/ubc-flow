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
