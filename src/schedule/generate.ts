import type { SectionHit } from '@/lib/search';
import { COMPANION_ACTIVITIES } from '@/schedule/companions';

/**
 * The schedule generator: every conflict-free way to take a set of courses,
 * ranked by what the student said they want.
 *
 * Deliberately not machine learning. Every preference is a visible weight on
 * a visible measurement (minutes before 9:30, gap minutes, days on campus,
 * instructor scores), so every ranking can be explained back to the student
 * in the results list — and a schedule you can't explain is one nobody
 * trusts enough to register from.
 *
 * Pure and synchronous, so it runs in the browser: the sections are already
 * in client state and a permutation search is exactly the kind of work the
 * server should never be billed for.
 */

export type GeneratePrefs = {
  /**
   * 'no-early': keep mornings clear (class time before 9:30 counts against).
   * 'early-bird': start early and be done (class time after 16:00 counts
   * against). 'whatever': time of day is free.
   */
  mornings: 'no-early' | 'early-bird' | 'whatever';
  /** 'compact': minimize dead time. 'spread': room to breathe between classes. */
  rhythm: 'compact' | 'spread' | 'whatever';
  /** Squeeze the week into as few days on campus as possible. */
  fewerDays: boolean;
  /** Prefer sections whose instructors rate well (reviews, then grade history). */
  bestProfs: boolean;
  /** Class time after 18:00 counts against, hard. */
  noEvenings: boolean;
};

export const DEFAULT_PREFS: GeneratePrefs = {
  mornings: 'whatever',
  rhythm: 'whatever',
  fewerDays: false,
  bestProfs: false,
  noEvenings: false,
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

// Search caps. A five-course load stays far under these; they exist so a
// pathological term (huge multi-section service courses) degrades to "ranked
// over a large sample" instead of freezing the tab.
const MAX_BUNDLES_PER_COURSE = 300;
const MAX_COLLECTED = 3000;
const MAX_VISITS = 60_000;

const EARLY = 9 * 60 + 30; // 9:30
const AFTERNOON_END = 16 * 60; // early-bird wants the day over by here
const EVENING = 18 * 60;

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
    // An unscheduled meeting can't conflict and can't be scored — same rule
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

// ── scoring ─────────────────────────────────────────────────────────────────

type DayShape = { day: number; first: number; last: number; gaps: number[] };

function dayShapes(meets: Meet[]): DayShape[] {
  const byDay = new Map<number, Meet[]>();
  for (const m of meets) (byDay.get(m.day) ?? byDay.set(m.day, []).get(m.day)!).push(m);
  const shapes: DayShape[] = [];
  for (const [day, list] of byDay) {
    list.sort((a, b) => a.start - b.start);
    const gaps: number[] = [];
    for (let i = 1; i < list.length; i += 1) {
      const gap = list[i].start - list[i - 1].end;
      if (gap > 0) gaps.push(gap);
    }
    shapes.push({ day, first: list[0].start, last: list[list.length - 1].end, gaps });
  }
  return shapes.sort((a, b) => a.day - b.day);
}

/** Class minutes inside [from, to) across the week. */
function minutesWithin(meets: Meet[], from: number, to: number): number {
  let total = 0;
  for (const m of meets) total += Math.max(0, Math.min(m.end, to) - Math.max(m.start, from));
  return total;
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

  if (prefs.mornings === 'no-early') score -= 1.2 * minutesWithin(meets, 0, EARLY);
  if (prefs.mornings === 'early-bird') score -= 0.8 * minutesWithin(meets, AFTERNOON_END, 24 * 60);
  if (prefs.noEvenings) score -= 1.5 * minutesWithin(meets, EVENING, 24 * 60);

  const gaps = shapes.flatMap((s) => s.gaps);
  if (prefs.rhythm === 'compact') score -= 0.8 * gaps.reduce((a, g) => a + g, 0);
  if (prefs.rhythm === 'spread') {
    // Breathing room is a gap you can use; a three-hour stranding is not.
    score += 0.5 * gaps.reduce((a, g) => a + Math.min(g, 90), 0);
    score -= 0.5 * gaps.reduce((a, g) => a + Math.max(0, g - 180), 0);
    score -= 25 * shapes.reduce((a, s) => a + s.gaps.filter((g) => g < 15).length, 0);
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

function notes(sections: Cand[], prefs: GeneratePrefs): string[] {
  const meets = sections.flatMap((s) => s.meets);
  const shapes = dayShapes(meets);
  const lines: string[] = [];
  if (shapes.length === 0) return ['No scheduled meeting times to compare.'];

  const firstStart = Math.min(...shapes.map((s) => s.first));
  const lastEnd = Math.max(...shapes.map((s) => s.last));
  if (prefs.mornings === 'no-early') {
    lines.push(firstStart >= EARLY ? 'No classes before 9:30' : `Earliest class ${fmt(firstStart)}`);
  } else if (prefs.mornings === 'early-bird' || prefs.noEvenings) {
    lines.push(`Done by ${fmt(lastEnd)} every day`);
  }

  const dayNames = shapes.map((s) => DAY_NAME[s.day]);
  lines.push(
    `${shapes.length} day${shapes.length === 1 ? '' : 's'} on campus${
      shapes.length <= 3 ? ` (${dayNames.join(', ')})` : ''
    }`,
  );

  if (prefs.rhythm !== 'whatever') {
    const gaps = shapes.flatMap((s) => s.gaps);
    const longest = gaps.length ? Math.max(...gaps) : 0;
    lines.push(
      longest === 0
        ? 'Back-to-back, no waiting around'
        : `Longest gap ${
            longest >= 60 ? `${Math.round((longest / 60) * 10) / 10}h` : `${longest} min`
          }`,
    );
  }

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
 * signal where one exists — reviews first, grade history as fallback,
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
    )
    .slice(0, limit);

  return {
    schedules: ranked.map(({ sections, score }) => ({
      sectionIds: sections.map((s) => s.hit.sectionId),
      score,
      notes: notes(sections, prefs),
    })),
    truncated,
    unplaceable,
  };
}
