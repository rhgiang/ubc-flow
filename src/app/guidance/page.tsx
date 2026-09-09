import Link from 'next/link';
import { effectiveRules, fullLoadFor, getProgram } from '@/guidance/registry';
import Landing from './Landing';
import {
  loadCatalogue,
  loadCompletions,
  loadOfferings,
  loadPrereqs,
  loadTerms,
} from '@/guidance/load';
import { auth } from '@/lib/auth';
import { obligations, walk, type CourseSet, type Rule } from '@/guidance/rules';
import { progress, outstanding, type Completion } from '@/guidance/progress';
import { solve } from '@/guidance/solver';
import {
  COOP_PATTERNS,
  applyCoop,
  degreeYears,
  fromFirstWinter,
  getCoopPattern,
  workTermIds,
} from '@/guidance/coop';


// `credits`, not `load`. The control used to mean courses per term and the
// parameter was called load; changing its meaning to credits while keeping the
// name left every existing link and bookmark reading "4" as four CREDITS —
// one course a term, a twelve-term plan. A new name lets stale links fall
// through to the default instead of silently meaning something else.
type SP = { program?: string; credits?: string; summer?: string; coop?: string };


/** Course pages are keyed the way /explore links them: "cpsc-310". */
const courseHref = (code: string) => `/course/${code.toLowerCase().replace(' ', '-')}`;

/** Subjects any rule in the program mentions — what the catalogue query needs. */
function subjectsUsed(rules: Rule[]): string[] {
  const out = new Set<string>();
  walk(rules, (r) => {
    if (r.kind === 'course') out.add(r.code.split(' ')[0]);
    if (r.kind === 'credits' && r.from.kind === 'pattern') r.from.subjects?.forEach((s) => out.add(s));
    if (r.kind === 'credits' && r.from.kind === 'codes') r.from.codes.forEach((c) => out.add(c.split(' ')[0]));
  });
  return [...out];
}


/** A course set in words, so a student can see what a rule actually accepts. */
function describeSet(set: CourseSet): string {
  if (set.kind === 'codes') {
    return set.codes.length > 0 ? set.codes.join(', ') : 'an approved list (not yet transcribed)';
  }
  const bits: string[] = [];
  if (set.subjects?.length) bits.push(set.subjects.join(' or '));
  if (set.faculty) bits.push(`any ${set.faculty} subject`);
  if (set.levelMin && set.levelMax) bits.push(`${set.levelMin}–${set.levelMax}`);
  else if (set.levelMin) bits.push(`${set.levelMin} or higher`);
  else if (set.levelMax) bits.push(`up to ${set.levelMax}`);
  if (set.exclude?.length) bits.push(`excluding ${set.exclude.join(', ')}`);
  return bits.join(', ') || 'any course';
}

/**
 * The sub-requirements behind a rule, for the expandable detail. Breadth is
 * the case that needs it — "any 6 of 7 categories" means nothing without the
 * list of categories and what counts in each.
 */
function breakdown(rule: Rule): { label: string; detail: string }[] {
  if (rule.kind === 'chooseN') {
    return rule.of.map((b) => ({
      label: b.label,
      detail:
        b.kind === 'credits'
          ? `${b.n} credits from ${describeSet(b.from)}`
          : b.kind === 'course'
            ? b.code
            : b.kind === 'group'
              ? b.items.map((i) => (i.kind === 'course' ? i.code : i.label)).join(' + ')
              : '',
    }));
  }
  if (rule.kind === 'credits') {
    return [{ label: `${rule.n} credits`, detail: describeSet(rule.from) }];
  }
  return [];
}

const STATE_STYLE: Record<string, string> = {
  satisfied: 'border-brand bg-brand text-brand-foreground',
  partial: 'border-border bg-surface-muted text-foreground',
  outstanding: 'border-border text-text-secondary',
  // A note is something to know, not something wrong. This used to carry the
  // danger palette, which turned the whole sidebar red — the Arts core alone
  // contributes ten notes, and a B.A. showed eleven red blocks against seven
  // ordinary rows. Informational blue instead: a lighter relative of the
  // brand navy, so it belongs to the same family without borrowing brand
  // blue's "selected" meaning.
  unevaluated: 'border-info-border bg-info-surface text-info',
};

export default async function GuidancePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  // No program named, or one that no longer exists: show the picker rather
  // than falling back to a default. Quietly planning Computer Science for
  // someone who asked for a program we dropped is the wrong kind of guess,
  // and this returns before the catalogue, prereq and offerings queries.
  const program = sp.program ? getProgram(sp.program) : null;
  if (!program) return <Landing />;
  const rules = effectiveRules(program);
  const coop = getCoopPattern(sp.coop);
  // Co-op runs year-round — three of the four work terms in a standard
  // sequence are summers — so it opens summer up rather than leaving that
  // to a separate toggle the student would have to find.
  const useSummer = sp.summer === '1' || coop !== null;

  const subjects = subjectsUsed(rules);

  const [catalogue, allTerms] = await Promise.all([loadCatalogue(subjects), loadTerms()]);
  const terms = applyCoop(fromFirstWinter(allTerms), coop);
  const work = workTermIds(allTerms, coop);
  const yearOfTerm = degreeYears(allTerms);
  const ids = catalogue.map((c) => c.id);
  const [prereqs, offerings] = await Promise.all([loadPrereqs(catalogue), loadOfferings(ids)]);

  const fullLoad = fullLoadFor(program);
  const load = Math.min(24, Math.max(3, Number(sp.credits) || fullLoad));
  // The offered loads always include the program's own, so it is selectable
  // and visibly current. Fixed pills of 12/15/18 left engineering showing
  // NOTHING highlighted — its default is 22 — which read as an unset control
  // where 18 looked like the maximum, and there was no way back to 22 once
  // you had clicked away. Commerce had it too, at 16.
  const loads = [...new Set([12, 15, 18, fullLoad])].sort((a, b) => a - b);

  // A signed-out visitor gets the public roadmap: the whole degree from a
  // standing start, which is what someone asking "what does this degree
  // require?" wants. A signed-in one gets their own — the completions feed
  // BOTH the checklist and the solver, so the route is what is left rather
  // than a fresh four years.
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const completions: Completion[] = userId ? await loadCompletions(userId) : [];
  const done = completions.filter((c) => c.status === 'passed' || c.status === 'transfer');
  const plan = solve({
    outstanding: outstanding(completions, rules),
    completed: done.map((c) => c.course),
    catalogue,
    prereqs,
    offerings,
    terms,
    prefs: { creditsPerTerm: load, useSummer, targetTermId: null },
  });

  /**
   * Whether the panel reports on a PERSON or on the plan.
   *
   * True only when there is something real to check against. A signed-in
   * student with nothing uploaded gets the plan view and an invitation, not a
   * zeroed-out list that reads as "you have done nothing".
   */
  const tracking = done.length > 0;
  const creditsDone = done.reduce((n, c) => n + c.course.credits, 0);
  // Counted as passed purely because the term has finished. Grades are not
  // stored yet, so this over-counts anyone who failed or withdrew, and the
  // panel says how many rows rest on that assumption rather than hiding it.
  const assumed = completions.filter((c) => c.status === 'passed').length;

  const plannedCourses = plan.terms.flatMap((t) =>
    t.placements.flatMap((pl) => (pl.kind === 'course' ? [pl.course] : [])),
  );
  /**
   * What the ticks are checked against — the whole difference between the two
   * modes.
   *
   * Tracking checks the person alone. Folding the plan's own courses in here
   * too would make every requirement the route covers read as done, and the
   * panel would say the same thing signed in as signed out.
   *
   * Without a record it checks the plan, because otherwise a rule met by a
   * required course would report "0 of 6" beside a route that schedules three
   * of them — wrong about its own output.
   */
  const checklist = progress(
    tracking
      ? completions
      : [...completions, ...plannedCourses.map((course) => ({ course, status: 'passed' as const }))],
    rules,
  );

  /**
   * Credits the plan reserves as SLOTS, per rule.
   *
   * A slot is not a course, so it never reached progress() and every rule that
   * plans as one reported nothing. "Electives 0 of 18 credits" sat beside a
   * plan reserving exactly 18 for it, and "12 credits of Arts" read as
   * untouched while the route carried all twelve. Both are plan-side
   * requirements the plan genuinely covers.
   */
  const slotted = new Map<string, number>();
  for (const t of plan.terms) {
    for (const pl of t.placements) {
      if (pl.kind !== 'slot') continue;
      for (const id of pl.forRules) slotted.set(id, (slotted.get(id) ?? 0) + pl.credits);
    }
  }
  /** A checklist row with its slot credits folded in. */
  const withSlots = (p: (typeof checklist)[number]) => {
    const extra = slotted.get(p.rule.id) ?? 0;
    if (extra === 0 || p.rule.kind !== 'credits') return p;
    const needed = p.credits?.needed ?? p.rule.n;
    const earned = Math.min(needed, (p.credits?.earned ?? 0) + extra);
    return {
      ...p,
      state: earned >= needed ? ('satisfied' as const) : ('partial' as const),
      detail: `${earned} of ${needed} credits`,
    };
  };

  const totalRules = obligations(rules).filter((r) => r.kind !== 'note').length;
  // A note carries no completion state, so it belongs in its own list rather
  // than among rules a student can actually finish.
  // Slot credits are the PLAN's reservations, so they count only when the
  // panel is reporting on the plan.
  const trackable = checklist
    .filter((p) => p.rule.kind !== 'note')
    .map((p) => (tracking ? p : withSlots(p)));
  const metRules = trackable.filter((p) => p.state === 'satisfied').length;
  const degreeRules = checklist.filter((p) => p.rule.kind === 'note');
  // Work terms hold no coursework, so the solver never returns them. Merge
  // them back in by calendar order — a plan that silently skipped them would
  // show co-op finishing in the same four years as everything else, which is
  // the opposite of what co-op does.
  const planned = new Map(plan.terms.map((t) => [t.term.id, t.placements]));
  const lastId = plan.terms.at(-1)?.term.id;
  // Runs to the last planned term OR the last work term, whichever is later.
  // Cutting at the coursework alone hid the whole sequence for a student who
  // finishes their courses before the work terms begin — which is exactly the
  // case co-op exists to handle, and it reported "no work terms".
  const end = Math.max(
    lastId ? allTerms.findIndex((t) => t.id === lastId) : -1,
    ...[...work].map((id) => allTerms.findIndex((t) => t.id === id)),
  );
  const timeline = allTerms
    .slice(0, end + 1)
    .filter((t) => planned.has(t.id) || work.has(t.id))
    .map((t) => ({ term: t, placements: planned.get(t.id) ?? null }));

  const href = (over: Record<string, string | number>) => {
    const p = new URLSearchParams({
      program: program.code,
      credits: String(load),
      ...(useSummer && !coop ? { summer: '1' } : {}),
      ...(coop ? { coop: coop.id } : {}),
      ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v)])),
    });
    return `/guidance?${p}`;
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      {/*
        The picker is a page of its own now. It used to be twenty-six pills
        wrapped across four lines here, above everything the page is actually
        for — and switching from one carried the OLD program's credit load
        with it, so arriving at a 155-credit B.A.Sc. from a 120-credit B.Sc.
        planned it at 15 a term and drew a ten-term degree. A plain link back
        cannot carry a load it should not.
      */}
      <Link
        href="/guidance"
        className="sky-hero inline-flex items-center gap-1.5 text-sm opacity-80 hover:opacity-100"
      >
        <span aria-hidden>&larr;</span> All programs
      </Link>
      <h1 className="sky-hero mt-2 text-2xl font-semibold sm:text-3xl">{program.name}</h1>
      <p className="sky-hero mt-2 max-w-2xl text-sm">
        {program.degree} &middot; Faculty of {program.faculty} &middot; {program.totalCredits}{' '}
        credits, ordered so prerequisites come first and every course is one UBC actually offers.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <div className="sky-panel p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Suggested route</h2>
                {/*
                  Every rule here was transcribed by hand off one Calendar page,
                  and the Calendar is the authority whenever the two disagree.
                  Linking it is the honest thing to do rather than a courtesy —
                  a student checking a requirement should be one click from the
                  page it came from.
                */}
                <a
                  href={program.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-brand-accent underline decoration-dotted underline-offset-2 hover:decoration-solid"
                >
                  Official UBC Calendar requirements ↗
                </a>
              </div>
              {/*
                The label sits ABOVE the pills on a phone rather than beside
                them. Inline, four credit pills at touch size plus "Use summer"
                could not fit one line, and the row wrapped wherever it ran out
                — orphaning the selected value onto a line of its own, away
                from the three it belongs with.
              */}
              <div className="flex flex-col items-start gap-1.5 sm:flex-row sm:items-center">
                <span className="whitespace-nowrap text-xs text-text-secondary">Credits per term</span>
                <div className="flex flex-wrap items-center gap-1.5">
                {loads.map((n) => (
                  <Link
                    key={n}
                    href={href({ credits: n })}
                    className={`rounded-pill border px-3 py-1 text-xs font-medium max-sm:inline-flex max-sm:min-h-8 max-sm:items-center max-sm:px-4 ${
                      n === load
                        ? 'border-brand bg-brand text-brand-foreground'
                        : 'border-border text-foreground hover:bg-surface-muted'
                    }`}
                  >
                    {n}
                  </Link>
                ))}
                <Link
                  href={href({ summer: useSummer ? '' : '1', coop: '' })}
                  className={`ml-1 rounded-pill border px-3 py-1 text-xs font-medium max-sm:inline-flex max-sm:min-h-8 max-sm:items-center max-sm:px-4 ${
                    useSummer
                      ? 'border-brand bg-brand text-brand-foreground'
                      : 'border-border text-foreground hover:bg-surface-muted'
                  }`}
                >
                  Use summer
                </Link>
                </div>
              </div>
            </div>

            {/*
              Co-op is a separate row rather than another pill beside the credit
              load: it changes the shape of the degree, not its pace. Most
              programs run more than one sequence, so this is a list of them
              rather than an on/off switch.
            */}
            <div className="mt-3 flex flex-col items-start gap-1.5 border-t border-border pt-3 sm:flex-row sm:items-center">
              <span className="whitespace-nowrap text-xs text-text-secondary">Co-op</span>
              <div className="flex flex-wrap items-center gap-1.5">
              <Link
                href={href({ coop: '' })}
                className={`rounded-pill border px-3 py-1 text-xs font-medium max-sm:inline-flex max-sm:min-h-8 max-sm:items-center max-sm:px-4 ${
                  coop === null
                    ? 'border-brand bg-brand text-brand-foreground'
                    : 'border-border text-foreground hover:bg-surface-muted'
                }`}
              >
                None
              </Link>
              {COOP_PATTERNS.map((p) => (
                <Link
                  key={p.id}
                  href={href({ coop: p.id })}
                  className={`rounded-pill border px-3 py-1 text-xs font-medium max-sm:inline-flex max-sm:min-h-8 max-sm:items-center max-sm:px-4 ${
                    coop?.id === p.id
                      ? 'border-brand bg-brand text-brand-foreground'
                      : 'border-border text-foreground hover:bg-surface-muted'
                  }`}
                >
                  {p.label}
                </Link>
              ))}
              </div>
            </div>
            {coop && (
              <p className="mt-2 rounded-card border border-info-border bg-info-surface px-3 py-2 text-xs text-info">
                <span className="font-medium">{coop.work.length} work terms.</span> {coop.detail} The
                Calendar sets the rules (four work terms, at least one in a Winter term, and the
                degree must end on an academic term) but leaves the sequence to each department, so
                check yours for the exact placement. Work terms earn co-op course credit on your
                transcript and none of it counts toward the degree, which is why co-op adds a year.
              </p>
            )}

            {/*
              A degree that runs past four years should say why rather than
              leave the student counting. Engineering is 148 to 158 credits, so
              choosing 18 a term genuinely cannot fit it into eight, since 8 x 18 is
              144, and the plan grows a fifth year. That is arithmetic, not a
              scheduling failure, and it is worth one sentence.
            */}
            {!coop && plan.terms.length > 8 && (
              <p className="mt-3 rounded-card border border-info-border bg-info-surface px-3 py-2 text-xs text-info">
                {program.totalCredits} credits at {load} a term needs {plan.terms.length} terms, so
                this route runs past four years. This program&rsquo;s full load is {fullLoad} a term,
                which fits it into eight.
              </p>
            )}

            {plan.terms.length === 0 ? (
              <p className="mt-4 text-sm text-text-secondary">
                No terms could be planned: the catalogue has no upcoming sections to place
                against.
              </p>
            ) : (
              <ol className="mt-4 space-y-3">
                {timeline.map((t) =>
                  t.placements === null ? (
                    <li
                      key={t.term.id}
                      className="rounded-card border border-dashed border-info-border bg-info-surface p-3"
                    >
                      <p className="flex flex-wrap items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-info">
                        <span className="rounded-pill border border-info-border px-2 py-0.5">
                          Year {yearOfTerm.get(t.term.id) ?? 1}
                        </span>
                        {t.term.name}
                        <span className="ml-auto font-normal normal-case opacity-80">work term</span>
                      </p>
                      <p className="mt-1.5 text-sm">Co-op placement, no coursework this term.</p>
                    </li>
                  ) : (
                  <li key={t.term.id} className="rounded-card border border-border p-3">
                    <p className="flex flex-wrap items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">
                      <span className="rounded-pill bg-surface-muted px-2 py-0.5 text-foreground">
                        Year {yearOfTerm.get(t.term.id) ?? 1}
                      </span>
                      {t.term.name}
                      <span className="ml-auto font-normal normal-case opacity-70">
                        {t.placements.reduce(
                          (n, pl) => n + (pl.kind === 'course' ? pl.course.credits : pl.credits),
                          0,
                        )}{' '}
                        credits
                      </span>
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.placements.map((pl, i) =>
                        pl.kind === 'course' ? (
                          pl.alternatives.length === 0 ? (
                            <Link
                              key={pl.course.id}
                              href={courseHref(pl.course.code)}
                              className="max-sm:inline-flex max-sm:min-h-8 max-sm:items-center rounded-pill border border-border bg-surface-muted px-3 py-1 text-sm font-medium text-foreground hover:border-brand hover:bg-brand hover:text-brand-foreground"
                            >
                              {pl.course.code}
                              <span className="ml-1.5 text-xs opacity-70">{pl.course.credits}cr</span>
                            </Link>
                          ) : (
                            // A requirement with alternatives is shown as one
                            // course, which reads as though that course were
                            // the requirement. The marker says a choice exists
                            // and opens the other routes rather than deciding
                            // silently for the student.
                            <details key={pl.course.id} className="group relative">
                              <summary className="max-sm:inline-flex max-sm:min-h-8 max-sm:items-center cursor-pointer list-none rounded-pill border border-border bg-surface-muted px-3 py-1 text-sm font-medium text-foreground hover:border-brand">
                                {pl.course.code}
                                <span className="ml-1.5 text-xs opacity-70">{pl.course.credits}cr</span>
                                {/*
                                  Underlined and in the accent colour because
                                  it is the only thing on the chip you can act
                                  on. At 60% opacity in the body text colour it
                                  read as a footnote rather than a control, and
                                  a student had no reason to think MATH 104
                                  came with six other routes.
                                */}
                                <span className="ml-1.5 text-xs font-medium text-brand-accent underline decoration-dotted underline-offset-2 group-open:decoration-solid">
                                  or {pl.alternatives.length}
                                </span>
                              </summary>
                              <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-card border border-border bg-surface p-2 shadow-lg">
                                <p className="px-1 pb-1 text-xs text-text-secondary">
                                  Any one of these satisfies it:
                                </p>
                                <Link
                                  href={courseHref(pl.course.code)}
                                  className="block rounded px-1 py-0.5 text-xs font-medium text-foreground hover:bg-surface-muted"
                                >
                                  {pl.course.code} · planned
                                </Link>
                                {pl.alternatives.map((alt) => (
                                  <span key={alt} className="block">
                                    {alt.includes('+') ? (
                                      // "CPSC 103 + CPSC 107" — a pair, not a
                                      // single course, so it is not one link.
                                      <span className="block px-1 py-0.5 text-xs text-text-secondary">
                                        {alt}
                                      </span>
                                    ) : (
                                      <Link
                                        href={courseHref(alt)}
                                        className="block rounded px-1 py-0.5 text-xs text-text-secondary hover:bg-surface-muted hover:text-foreground"
                                      >
                                        {alt}
                                      </Link>
                                    )}
                                  </span>
                                ))}
                              </div>
                            </details>
                          )
                        ) : (
                          // Dashed: a slot is a decision the student still has
                          // to make, not a course we are telling them to take.
                          <span
                            key={`${pl.label}-${i}`}
                            className="max-sm:inline-flex max-sm:min-h-8 max-sm:items-center rounded-pill border border-dashed border-border px-3 py-1 text-sm font-medium text-text-secondary"
                            title={
                              pl.examples.length > 0
                                ? `e.g. ${pl.examples.map((e) => e.code).join(', ')}`
                                : undefined
                            }
                          >
                            {pl.credits}cr · {pl.label}
                            {pl.examples.length > 0 && (
                              <span className="ml-1.5 text-xs opacity-70">
                                e.g. {pl.examples[0].code}
                              </span>
                            )}
                          </span>
                        ),
                      )}
                    </div>
                  </li>
                  ),
                )}
              </ol>
            )}

            {plan.unplaced.length > 0 && (
              <div className="mt-4 rounded-card border border-border p-3">
                <p className="text-xs font-semibold text-text-secondary">Could not be placed</p>
                <ul className="mt-1.5 space-y-1 text-xs text-text-secondary">
                  {plan.unplaced.map((u) => (
                    <li key={u.rule.id}>
                      <span className="font-medium text-foreground">{u.rule.label}</span> · {u.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <aside className="sky-panel h-fit p-5">
          {/*
            Two lists, because they answer different questions. Trackable
            rules are work to do and can be ticked off; degree rules are
            conditions on how the whole degree is spent — residency, the
            outside requirement, credit caps — which no amount of course
            picking "completes". Mixing them made a B.A. look like it had
            thirty requirements when it has nineteen.
          */}
          {/*
            One panel, two modes. A second list of the same requirements — one
            for "the plan covers this" and one for "you have done this" — would
            put the ambiguity in two places instead of removing it. What changes
            between modes is only what the ticks are checked AGAINST.
          */}
          <p className="text-sm font-semibold text-foreground">
            {tracking ? 'Your progress' : 'What this degree requires'}
          </p>
          <p className="mt-1 text-xs text-text-secondary">
            {tracking
              ? `${creditsDone} of ${program.totalCredits} credits · ${totalRules - metRules} requirements left`
              : `${totalRules} to complete · ${program.totalCredits} credits total`}
          </p>

          {tracking ? (
            <p className="mt-2 rounded-card border border-info-border bg-info-surface px-2.5 py-2 text-[0.6875rem] leading-relaxed text-info">
              Checked against your record. The route above starts from what you have left rather
              than from first year.{' '}
              {assumed > 0 && (
                <>
                  {assumed} course{assumed === 1 ? '' : 's'} counted as passed because the term has
                  ended, because grades are not captured yet, so a course you failed or withdrew from would
                  still show here.
                </>
              )}
            </p>
          ) : userId ? (
            <p className="mt-2 rounded-card border border-info-border bg-info-surface px-2.5 py-2 text-[0.6875rem] leading-relaxed text-info">
              Nothing to track against yet. Upload your Workday record from your account page and
              this becomes your own progress. Until then the ticks show what the route above covers.
            </p>
          ) : (
            <p className="mt-2 rounded-card border border-info-border bg-info-surface px-2.5 py-2 text-[0.6875rem] leading-relaxed text-info">
              Ticks show what the route above covers, not a personal record. Sign in and upload your
              courses to track your own progress.
            </p>
          )}

          <ul className="mt-3 space-y-1.5">
            {trackable.map((p) => {
              const parts = breakdown(p.rule);
              const body = (
                <>
                  <span className="font-medium">{p.rule.label}</span>
                  <span className="ml-1.5 opacity-80">{p.detail}</span>
                </>
              );
              return (
                <li
                  key={p.rule.id}
                  className={`rounded-card border px-3 py-2 text-xs ${STATE_STYLE[p.state]}`}
                >
                  {parts.length > 0 ? (
                    // A native disclosure — "any 6 of 7 categories" means
                    // nothing without the categories and what counts in each.
                    <details>
                      <summary className="cursor-pointer list-none">
                        {body}
                        <span className="mt-0.5 block text-[0.6875rem] opacity-60">see requirements</span>
                      </summary>
                      <ul className="mt-1.5 space-y-1 border-t border-current/20 pt-1.5 opacity-90">
                        {parts.map((part) => (
                          <li key={part.label}>
                            <span className="font-medium">{part.label}</span>
                            {part.detail && <span className="opacity-75"> · {part.detail}</span>}
                          </li>
                        ))}
                      </ul>
                      {p.rule.sourceUrl && (
                        <a
                          href={p.rule.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1.5 inline-block underline opacity-70 hover:opacity-100"
                        >
                          UBC Calendar
                        </a>
                      )}
                    </details>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>

          {degreeRules.length > 0 && (
            <>
              <p className="mt-5 border-t border-border pt-4 text-sm font-semibold text-foreground">
                Degree rules
              </p>
              <p className="mt-1 text-xs text-text-secondary">{degreeRules.length} to know</p>
              <ul className="mt-3 space-y-1.5">
                {degreeRules.map((p) => (
                  <li
                    key={p.rule.id}
                    className={`rounded-card border px-3 py-2 text-xs ${STATE_STYLE[p.state]}`}
                  >
                    {/* Collapsed by default: these run to a paragraph each,
                        and expanded they buried the list above them. */}
                    <details>
                      <summary className="cursor-pointer list-none font-medium">
                        {p.rule.label}
                      </summary>
                      <p className="mt-1.5 border-t border-current/20 pt-1.5 opacity-90">
                        {p.detail}
                      </p>
                      {p.rule.sourceUrl && (
                        <a
                          href={p.rule.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1.5 inline-block underline opacity-70 hover:opacity-100"
                        >
                          UBC Calendar
                        </a>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>

      {plan.warnings.length > 0 && (
        <div className="sky-panel mt-6 border border-danger-border bg-danger-surface p-4 text-sm text-danger">
          {plan.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          <p className="mt-1.5 text-xs opacity-80">
            This route is a planning aid, not an official degree audit. Confirm with a Science
            advisor before relying on it.
          </p>
        </div>
      )}
    </main>
  );
}
