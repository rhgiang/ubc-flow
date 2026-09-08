/**
 * Which companion sections a course still needs.
 *
 * UBC's rule of thumb: when a course fields Laboratory / Tutorial / Discussion
 * / Seminar sections in a term, registering means taking one of each alongside
 * the lecture. The builder can't know the true requirement (Workday holds it),
 * but "the course offers this activity and you picked none of it" is right
 * often enough to be worth a question at save time — and only a question:
 * some seminars really are optional, so the answer stays advisory, exactly
 * like the time-conflict gate.
 */

/** Activity types that, when offered, a registration normally includes one of.
 *  Deliberately a closed list: UBC data also carries "Waiting List",
 *  "Work Placement", "Thesis" and friends, none of which anyone plans. */
const COMPANION_ACTIVITIES = ['Lecture', 'Laboratory', 'Tutorial', 'Discussion', 'Seminar'];

export type SectionActivity = { code: string; activity: string | null };
export type MissingCompanions = { code: string; missing: string[] };

/**
 * `offered` is every section the chosen courses field this term; `chosen` is
 * what's in the schedule. Returns one row per course that offers an activity
 * type the student picked nothing of, in course order.
 */
export function findMissingCompanions(
  offered: SectionActivity[],
  chosen: SectionActivity[],
): MissingCompanions[] {
  const offeredByCourse = new Map<string, Set<string>>();
  for (const s of offered) {
    if (!s.activity || !COMPANION_ACTIVITIES.includes(s.activity)) continue;
    (offeredByCourse.get(s.code) ?? offeredByCourse.set(s.code, new Set()).get(s.code)!).add(
      s.activity,
    );
  }

  const chosenByCourse = new Map<string, Set<string>>();
  for (const s of chosen) {
    (chosenByCourse.get(s.code) ?? chosenByCourse.set(s.code, new Set()).get(s.code)!).add(
      s.activity ?? '',
    );
  }

  const out: MissingCompanions[] = [];
  for (const [code, have] of chosenByCourse) {
    const required = offeredByCourse.get(code);
    if (!required) continue;
    // COMPANION_ACTIVITIES order, so "Lecture, Laboratory" never reads shuffled.
    const missing = COMPANION_ACTIVITIES.filter((a) => required.has(a) && !have.has(a));
    if (missing.length) out.push({ code, missing });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code));
}
