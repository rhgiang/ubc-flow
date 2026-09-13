import type { SectionHit } from '@/lib/search';
import { COMPANION_ACTIVITIES } from '@/schedule/companions';

/**
 * The schedule generator: every conflict-free way to take a set of courses,
 * ranked by what the student said they want.
 *
 * Deliberately not machine learning. Every preference is a visible weight on
 * a visible measurement (minutes before your earliest, class time on a day
 * you wanted free, gap minutes, instructor scores), so every ranking can be
 * explained back to the student in the results list - and a schedule you
 * can't explain is one nobody trusts enough to register from.
 *
 * Every preference is also SOFT: a want, not a filter. Filtering would make
 * "keep Friday free" silently delete the only workable timetable; scoring
 * instead surfaces it last with an honest note that Friday couldn't be kept.
 *
 * Pure and synchronous, so it runs in the browser: the sections are already
 * in client state and a permutation search is exactly the kind of work the
 * server should never be billed for.
 */

export type GeneratePrefs = {
  /** Minutes from midnight; class time before this counts against. Null: any. */
  earliest: number | null;
  /** Minutes from midnight; class time after this counts against. Null: any. */
  latest: number | null;
  /**
   * 'compact': minimize dead time. 'lunch': the in-between - packed, but
   * insist on a real break (30+ min) somewhere in 11:00–14:00 each day.
   * 'spread': room to breathe between classes.
   */
  rhythm: 'compact' | 'lunch' | 'spread' | 'whatever';
  /** Squeeze the week into as few days on campus as possible. */
  fewerDays: boolean;
  /** Days to try to keep clear of classes entirely (0 = Mon … 6 = Sun). */
  freeDays: number[];
  /** Prefer sections whose instructors rate well (reviews, then grade history). */
  bestProfs: boolean;
};

export const DEFAULT_PREFS: GeneratePrefs = {
  earliest: null,
  latest: null,
  rhythm: 'whatever',
  fewerDays: false,
  freeDays: [],
  bestProfs: false,
};

export type GeneratedSchedule = {
  sectionIds: string[];
  score: number;
  /** Human sentences explaining why this option ranked where it did. */
  notes: string[];
};

export type GenerateResult = {
  /** Best first. Empty when no conflict-free combination exists. */
  schedules: GeneratedSchedule[];
  /** The search hit its caps, so the ranking is over a sample, not everything. */
  truncated: boolean;
  /** Courses whose own sections can't form a bundle (or that have none). */
  unplaceable: string[];
};

// ── internal shapes ─────────────────────────────────────────────────────────

type Meet = { day: number; start: number; end: number };
type Cand = { hit: SectionHit; meets: Meet[]; prof: number | null };
type Bundle = { sections: Cand[]; meets: Meet[] };

const DAY_INDEX: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
};
const DAY_NAME = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Search caps. A five-course load stays far under these; they exist so a
// pathological term (huge multi-section service courses) degrades to "ranked
// over a large sample" instead of freezing the tab.
const MAX_BUNDLES_PER_COURSE = 300;
const MAX_COLLECTED = 3000;
const MAX_VISITS = 60_000;

const LUNCH_FROM = 11 * 60;
const LUNCH_TO = 14 * 60;
const LUNCH_MIN_BREAK = 30;

function minutes(hhmm: string | null): number | null {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function fmt(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
}

function toMeets(hit: SectionHit): Meet[] {
  const meets: Meet[] = [];
  for (const m of hit.meetingTimes) {
    const day = DAY_INDEX[m.day];
    const start = minutes(m.startTime);
    const end = minutes(m.endTime);
    // An unscheduled meeting can't conflict and can't be scored - same rule
    // as findConflicts: never guess.
    if (day === undefined || start === null || end === null || end <= start) continue;
    meets.push({ day, start, end });
  }
  return meets;
}

/** Strict inequality: back-to-back is not a conflict, matching findConflicts. */
function clashes(a: Meet[], b: Meet[]): boolean {
  for (const x of a) {
    for (const y of b) {
      if (x.day === y.day && x.start < y.end && y.start < x.end) return true;
    }
  }
  return false;
}

/**
 * Every way to take one course: one section per companion activity it offers
 * this term (the same rule the missing-companion save gate checks), with
 * internally clashing combinations dropped. Deterministic order.
 */
function courseBundles(sections: Cand[]): { bundles: Bundle[]; truncated: boolean } {
  const byActivity = new Map<string, Cand[]>();
  for (const s of sections) {
    const activity = s.hit.activity ?? '';
    if (!COMPANION_ACTIVITIES.includes(activity)) continue;
    (byActivity.get(activity) ?? byActivity.set(activity, []).get(activity)!).push(s);
  }
  // COMPANION_ACTIVITIES order so a bundle always reads Lecture, Lab, Tutorial.
  const groups = COMPANION_ACTIVITIES.filter((a) => byActivity.has(a)).map((a) => {
    const g = byActivity.get(a)!;
    g.sort((x, y) => x.hit.sectionCode.localeCompare(y.hit.sectionCode));
    return g;
  });
  if (groups.length === 0) return { bundles: [], truncated: false };

  let truncated = false;
  const bundles: Bundle[] = [];
  const pick: Cand[] = [];
  const walk = (depth: number) => {
    if (bundles.length >= MAX_BUNDLES_PER_COURSE) {
      truncated = true;
      return;
    }
    if (depth === groups.length) {
      bundles.push({ sections: [...pick], meets: pick.flatMap((s) => s.meets) });
      return;
    }
    for (const cand of groups[depth]) {
      if (pick.some((p) => clashes(p.meets, cand.meets))) continue;
      pick.push(cand);
      walk(depth + 1);
      pick.pop();
    }
  };
  walk(0);
  return { bundles, truncated };
}

// ── measuring a week ────────────────────────────────────────────────────────

type Gap = { from: number; to: number };
type DayShape = { day: number; first: number; last: number; gaps: Gap[] };

function dayShapes(meets: Meet[]): DayShape[] {
  const byDay = new Map<number, Meet[]>();
  for (const m of meets) (byDay.get(m.day) ?? byDay.set(m.day, []).get(m.day)!).push(m);
  const shapes: DayShape[] = [];
  for (const [day, list] of byDay) {
    list.sort((a, b) => a.start - b.start);
    const gaps: Gap[] = [];
    let reach = list[0].end;
    for (let i = 1; i < list.length; i += 1) {
      if (list[i].start > reach) gaps.push({ from: reach, to: list[i].start });
      reach = Math.max(reach, list[i].end);
    }
    shapes.push({ day, first: list[0].start, last: reach, gaps });
  }
  return shapes.sort((a, b) => a.day - b.day);
}

/** Class minutes inside [from, to) across the week. */
function minutesWithin(meets: Meet[], from: number, to: number): number {
  let total = 0;
  for (const m of meets) total += Math.max(0, Math.min(m.end, to) - Math.max(m.start, from));
  return total;
}

/**
 * A day fails lunch when classes leave no 30-minute free run anywhere in
 * 11:00–14:00. A day that never touches the window passes trivially - an
 * empty campus day IS a lunch break.
 */
function daysWithoutLunch(shapes: DayShape[]): number[] {
  const failed: number[] = [];
  for (const s of shapes) {
    // Free runs inside the window: before the first class, each gap, after
    // the last class - clipped to the window.
    const runs: Gap[] = [
      { from: LUNCH_FROM, to: Math.min(s.first, LUNCH_TO) },
      ...s.gaps,
      { from: Math.max(s.last, LUNCH_FROM), to: LUNCH_TO },
    ];
    const free = runs.some(
      (r) => Math.min(r.to, LUNCH_TO) - Math.max(r.from, LUNCH_FROM) >= LUNCH_MIN_BREAK,
    );
    if (!free) failed.push(s.day);
  }
  return failed;
}

function statusPenalty(status: string | null): number {
  if (status === 'Waitlist') return 80;
  if (status === 'Closed' || status === 'Full') return 160;
  return 0;
}

function scoreSchedule(sections: Cand[], prefs: GeneratePrefs): number {
  const meets = sections.flatMap((s) => s.meets);
  const shapes = dayShapes(meets);
  let score = 0;

  if (prefs.earliest !== null) score -= 1.2 * minutesWithin(meets, 0, prefs.earliest);
  if (prefs.latest !== null) score -= 1.2 * minutesWithin(meets, prefs.latest, 24 * 60);

  // A day you asked to keep free weighs more than a merely early class:
  // people plan work shifts and commutes around it.
  for (const day of prefs.freeDays) {
    score -= 2.5 * minutesWithin(meets.filter((m) => m.day === day), 0, 24 * 60);
  }

  const gapWidths = shapes.flatMap((s) => s.gaps.map((g) => g.to - g.from));
  if (prefs.rhythm === 'compact') score -= 0.8 * gapWidths.reduce((a, g) => a + g, 0);
  if (prefs.rhythm === 'lunch') {
    // The in-between: still packed (at half the compact weight, so a lunch
    // gap isn't punished into oblivion), but a day with no room to eat costs
    // more than the gap that would have fixed it.
    score -= 0.4 * gapWidths.reduce((a, g) => a + g, 0);
    score -= 60 * daysWithoutLunch(shapes).length;
  }
  if (prefs.rhythm === 'spread') {
    // Breathing room is a gap you can use; a three-hour stranding is not.
    score += 0.5 * gapWidths.reduce((a, g) => a + Math.min(g, 90), 0);
    score -= 0.5 * gapWidths.reduce((a, g) => a + Math.max(0, g - 180), 0);
    score -= 25 * gapWidths.filter((g) => g < 15).length;
  }

  if (prefs.fewerDays) score -= 140 * shapes.length;

  if (prefs.bestProfs) {
    const scored = sections.filter((s) => s.prof !== null);
    if (scored.length) {
      score += 250 * (scored.reduce((a, s) => a + s.prof!, 0) / sections.length);
    }
  }

  for (const s of sections) score -= statusPenalty(s.hit.status);
  return score;
}

function listDays(days: number[], full = true): string {
  const names = days.map((d) => (full ? DAY_FULL[d] : DAY_NAME[d]));
  return names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function notes(sections: Cand[], prefs: GeneratePrefs): string[] {
  const meets = sections.flatMap((s) => s.meets);
  const shapes = dayShapes(meets);
  const lines: string[] = [];
  if (shapes.length === 0) return ['No scheduled meeting times to compare.'];

  /*
    The span always leads, whether or not it was asked about. With notes tied
    only to the preferences, someone who expressed none got five options
    reading "5 days on campus" and nothing else - five identical-looking
    schedules that were in fact quite different. An option has to say enough
    to be chosen between.
  */
  const firstStart = Math.min(...shapes.map((s) => s.first));
  const lastEnd = Math.max(...shapes.map((s) => s.last));
  lines.push(`Classes run ${fmt(firstStart)}–${fmt(lastEnd)}`);

  // A satisfied bound is already visible in the span above; only a MISSED one
  // needs saying, and it needs saying plainly.
  if (prefs.earliest !== null && firstStart < prefs.earliest) {
    lines.push(`Couldn't start after ${fmt(prefs.earliest)} - earliest is ${fmt(firstStart)}`);
  }
  if (prefs.latest !== null && lastEnd > prefs.latest) {
    lines.push(`Couldn't finish by ${fmt(prefs.latest)} - runs to ${fmt(lastEnd)}`);
  }

  if (prefs.freeDays.length) {
    const busy = new Set(shapes.map((s) => s.day));
    const kept = prefs.freeDays.filter((d) => !busy.has(d));
    const missed = prefs.freeDays.filter((d) => busy.has(d));
    if (kept.length) lines.push(`${listDays(kept)} kept free`);
    if (missed.length) lines.push(`Couldn't keep ${listDays(missed)} free`);
  }

  if (prefs.rhythm === 'lunch') {
    const failed = daysWithoutLunch(shapes);
    lines.push(
      failed.length === 0
        ? 'Room for lunch every day'
        : `No lunch break on ${listDays(failed, false)}`,
    );
  }

  const dayNames = shapes.map((s) => DAY_NAME[s.day]);
  lines.push(
    `${shapes.length} day${shapes.length === 1 ? '' : 's'} on campus${
      shapes.length <= 3 ? ` (${dayNames.join(', ')})` : ''
    }`,
  );

  // Also unconditional: dead time between classes is the thing people compare
  // two timetables on, whether or not they thought to ask about it.
  const widths = shapes.flatMap((s) => s.gaps.map((g) => g.to - g.from));
  const longest = widths.length ? Math.max(...widths) : 0;
  lines.push(
    longest === 0
      ? 'Back-to-back, no waiting around'
      : `Longest gap ${
          longest >= 60 ? `${Math.round((longest / 60) * 10) / 10}h` : `${longest} min`
        }`,
  );

  if (prefs.bestProfs) {
    const rated = sections.filter((s) => s.prof !== null && s.prof >= 0.7);
    const unrated = sections.filter((s) => s.prof === null).length;
    if (rated.length) {
      const names = [...new Set(rated.map((s) => s.hit.instructors[0]).filter(Boolean))];
      lines.push(`Well-rated: ${names.slice(0, 3).join(', ')}`);
    } else if (unrated === sections.length) {
      lines.push('No instructor ratings yet for these sections');
    }
  }

  const notOpen = sections.filter((s) => statusPenalty(s.hit.status) > 0);
  lines.push(
    notOpen.length === 0
      ? 'Every section currently open'
      : notOpen
          .map(
            (s) =>
              `${s.hit.code} ${s.hit.sectionCode} is ${s.hit.status === 'Waitlist' ? 'waitlisted' : 'full'}`,
          )
          .join(' · '),
  );

  return lines;
}

// ── the search ──────────────────────────────────────────────────────────────

/**
 * Generates the top `limit` conflict-free timetables for the given pool of
 * sections (every section the chosen courses offer this term), ranked by the
 * preferences. `profScores` maps sectionId to a 0..1 instructor quality
 * signal where one exists - reviews first, grade history as fallback,
 * absence scored as absence rather than as bad.
 */
export function generateSchedules(
  pool: SectionHit[],
  prefs: GeneratePrefs,
  profScores: Record<string, number | null> = {},
  limit = 5,
): GenerateResult {
  const byCourse = new Map<string, Cand[]>();
  for (const hit of pool) {
    const cand: Cand = { hit, meets: toMeets(hit), prof: profScores[hit.sectionId] ?? null };
    (byCourse.get(hit.courseId) ?? byCourse.set(hit.courseId, []).get(hit.courseId)!).push(cand);
  }

  let truncated = false;
  const unplaceable: string[] = [];
  const perCourse: Bundle[][] = [];
  for (const [, sections] of byCourse) {
    const { bundles, truncated: cut } = courseBundles(sections);
    truncated ||= cut;
    if (bundles.length === 0) {
      unplaceable.push(sections[0].hit.code);
      continue;
    }
    perCourse.push(bundles);
  }
  unplaceable.sort();

  if (perCourse.length === 0) return { schedules: [], truncated, unplaceable };

  // Fewest options first: a course with 2 bundles prunes the tree far better
  // at the top than one with 80.
  perCourse.sort((a, b) => a.length - b.length);

  const collected: Cand[][] = [];
  let visits = 0;
  const occupied: Meet[][] = [];
  const picked: Bundle[] = [];

  const walk = (depth: number) => {
    if (collected.length >= MAX_COLLECTED || visits >= MAX_VISITS) return;
    if (depth === perCourse.length) {
      collected.push(picked.flatMap((b) => b.sections));
      return;
    }
    for (const bundle of perCourse[depth]) {
      visits += 1;
      if (occupied.some((m) => clashes(m, bundle.meets))) continue;
      occupied.push(bundle.meets);
      picked.push(bundle);
      walk(depth + 1);
      occupied.pop();
      picked.pop();
      if (collected.length >= MAX_COLLECTED || visits >= MAX_VISITS) return;
    }
  };
  walk(0);
  // Conservative: a search that ended exactly at a cap may have been complete,
  // but claiming "ranked over everything" when it wasn't is the worse error.
  truncated ||= collected.length >= MAX_COLLECTED || visits >= MAX_VISITS;

  const ranked = collected
    .map((sections) => ({ sections, score: scoreSchedule(sections, prefs) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.sections
          .map((s) => s.hit.sectionId)
          .join()
          .localeCompare(b.sections.map((s) => s.hit.sectionId).join()),
    );

  /*
    Five options that draw the same week are one option shown five times.
    Ranking by score alone did exactly that: swapping a lab for another lab at
    the same hour scores identically and looks identical, so the list filled
    with near-duplicates while genuinely different weeks never surfaced. Keep
    the best-scoring schedule per week SHAPE - the times actually occupied -
    and the five on offer are five real choices.
  */
  const shape = (sections: Cand[]) =>
    sections
      .flatMap((s) => s.meets)
      .map((m) => `${m.day}:${m.start}-${m.end}`)
      .sort()
      .join('|');

  const distinct: typeof ranked = [];
  const seenShapes = new Set<string>();
  for (const candidate of ranked) {
    const sig = shape(candidate.sections);
    if (seenShapes.has(sig)) continue;
    seenShapes.add(sig);
    distinct.push(candidate);
    if (distinct.length >= limit) break;
  }

  return {
    schedules: distinct.map(({ sections, score }) => ({
      sectionIds: sections.map((s) => s.hit.sectionId),
      score,
      notes: notes(sections, prefs),
    })),
    truncated,
    unplaceable,
  };
}
