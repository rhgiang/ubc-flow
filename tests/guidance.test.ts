import { describe, expect, it } from 'vitest';
import { type CourseRef, type CourseSet, type Rule, courseLevel, matches, obligations, walk } from '@/guidance/rules';
import { type Completion, outstanding, progress } from '@/guidance/progress';
import {
  type PlannedTerm,
  type PlanTerm,
  type Placement,
  type SolverInput,
  depth,
  solve,
  tightenNotes,
  treeMet,
} from '@/guidance/solver';

/** Concrete courses in a planned term; slots carry no course. */
const coursesIn = (t: PlannedTerm): CourseRef[] =>
  t.placements.flatMap((p) => (p.kind === 'course' ? [p.course] : []));
const isCourse = (p: Placement): p is Extract<Placement, { kind: 'course' }> => p.kind === 'course';
import type { Requirement } from '@/prereqs/parse';
import { parseFacultyIndex, parseFacultySubjects } from '@/scrape/parse-faculties';
import { parseCourseDescriptions, subjectPath } from '@/scrape/parse-course-descriptions';
import { codesOnPage } from '@/guidance/jobs/verify';
import { validateProgram } from '@/guidance/validate';
import { artsFacultyCore2026W } from '@/guidance/programs/arts-faculty-core-2026w';
import type { Program } from '@/guidance/rules';

/** courseId doubles as the code in these fixtures, so a tree is easy to build. */
const need = (code: string): Requirement => ({ type: 'course', code, courseId: code });
const allOf = (...c: string[]): Requirement => ({ type: 'and', items: c.map(need) });
const oneOf = (...c: string[]): Requirement => ({ type: 'or', items: c.map(need) });

const course = (code: string, credits = 3, faculty: string | null = 'Science'): CourseRef => {
  const [subject, number] = code.split(' ');
  return { id: code, subject, number, code, credits, faculty };
};

const CAT: CourseRef[] = [
  course('CPSC 110', 4),
  course('CPSC 121', 4),
  course('CPSC 210', 4),
  course('CPSC 213', 4),
  course('CPSC 221', 4),
  course('CPSC 310', 4),
  course('CPSC 320', 3),
  course('CPSC 404', 3),
  course('CPSC 416', 3),
  course('ENGL 112', 3, 'Arts'),
  course('HIST 102', 3, 'Arts'),
  course('PHIL 220', 6, 'Arts'),
  // Breadth categories need real courses to draw examples from.
  course('CHEM 121', 3),
  course('PHYS 117', 3),
  course('BIOL 200', 3),
];

const passed = (...codes: string[]): Completion[] =>
  codes.map((c) => ({ course: course(c, CAT.find((x) => x.code === c)?.credits ?? 3), status: 'passed' }));

describe('rules', () => {
  it('reads a level off a number with a trailing letter', () => {
    expect(courseLevel('310')).toBe(310);
    expect(courseLevel('491A')).toBe(491);
  });

  it('matches a pattern by subject and level, honouring exclusions', () => {
    const set: CourseSet = { kind: 'pattern', subjects: ['CPSC'], levelMin: 300, exclude: ['CPSC 310'] };
    expect(matches(set, course('CPSC 320'))).toBe(true);
    expect(matches(set, course('CPSC 310'))).toBe(false); // excluded
    expect(matches(set, course('CPSC 210'))).toBe(false); // too low
    expect(matches(set, course('MATH 320'))).toBe(false); // wrong subject
  });

  it('matches nothing rather than everything when faculty data is missing', () => {
    // The guard that stops an unpopulated Subject.faculty turning
    // "12 credits of Arts" into "any 12 credits".
    const set: CourseSet = { kind: 'pattern', faculty: 'Arts' };
    expect(matches(set, course('ENGL 112', 3, 'Arts'))).toBe(true);
    expect(matches(set, course('ENGL 112', 3, null))).toBe(false);
  });

  it('flattens groups but keeps chooseN whole', () => {
    const rules: Rule[] = [
      {
        id: 'g',
        kind: 'group',
        label: 'g',
        items: [
          { id: 'a', kind: 'course', label: 'a', code: 'CPSC 110' },
          { id: 'c', kind: 'chooseN', label: 'c', n: 1, of: [{ id: 'c1', kind: 'course', label: 'c1', code: 'CPSC 121' }] },
        ],
      },
    ];
    expect(obligations(rules).map((r) => r.id)).toEqual(['a', 'c']);
  });
});

describe('progress', () => {
  const rules: Rule[] = [
    { id: 'r.110', kind: 'course', label: 'CPSC 110', code: 'CPSC 110' },
    {
      id: 'r.choose',
      kind: 'chooseN',
      label: 'one of 213/221',
      n: 1,
      of: [
        { id: 'r.choose.213', kind: 'course', label: '213', code: 'CPSC 213' },
        { id: 'r.choose.221', kind: 'course', label: '221', code: 'CPSC 221' },
      ],
    },
    {
      id: 'r.upper',
      kind: 'credits',
      label: '6 credits CPSC 300+',
      n: 6,
      from: { kind: 'pattern', subjects: ['CPSC'], levelMin: 300 },
    },
    { id: 'r.note', kind: 'note', label: 'breadth', detail: 'ask an advisor' },
  ];

  it('reports everything outstanding for a fresh student', () => {
    const p = progress([], rules);
    expect(p.map((x) => x.state)).toEqual(['outstanding', 'outstanding', 'outstanding', 'unevaluated']);
  });

  it('counts a passed course toward its rule', () => {
    const p = progress(passed('CPSC 110'), rules);
    expect(p[0].state).toBe('satisfied');
  });

  it('does NOT count a failed course', () => {
    // The whole reason Enrollment needs a status: a failed course must stay
    // on the roadmap rather than reading as done.
    const p = progress([{ course: course('CPSC 110', 4), status: 'failed' }], rules);
    expect(p[0].state).toBe('outstanding');
  });

  it('counts transfer credit', () => {
    const p = progress([{ course: course('CPSC 110', 4), status: 'transfer' }], rules);
    expect(p[0].state).toBe('satisfied');
  });

  it('does not count an in-progress course as done', () => {
    const p = progress([{ course: course('CPSC 110', 4), status: 'in_progress' }], rules);
    expect(p[0].state).toBe('outstanding');
  });

  it('satisfies a chooseN from any one branch', () => {
    expect(progress(passed('CPSC 221'), rules)[1].state).toBe('satisfied');
  });

  it('reports a credit rule as partial and tracks the shortfall', () => {
    const p = progress(passed('CPSC 320'), rules)[2]; // 3 of 6
    expect(p.state).toBe('partial');
    expect(p.credits).toEqual({ earned: 3, needed: 6 });
  });

  it('never marks a note satisfied, however much is completed', () => {
    const p = progress(passed('CPSC 110', 'CPSC 213', 'CPSC 320', 'CPSC 404'), rules);
    expect(p[3].state).toBe('unevaluated');
  });

  it('does not spend one course on two rules', () => {
    // CPSC 320 could serve the credit rule twice over if double-counted.
    const p = progress(passed('CPSC 320'), rules)[2];
    expect(p.satisfiedBy).toHaveLength(1);
  });

  it('outstanding() drops satisfied rules and groups', () => {
    const ids = outstanding(passed('CPSC 110'), rules).map((x) => x.rule.id);
    expect(ids).not.toContain('r.110');
    expect(ids).toContain('r.upper');
  });
});

describe('solver', () => {
  // 110 → 210 → 310, and 121 → 221
  const prereqs = new Map<string, Requirement | null>([
    // The real shape: 210 accepts EITHER intro course.
    ['CPSC 210', oneOf('CPSC 107', 'CPSC 110')],
    ['CPSC 310', allOf('CPSC 210')],
    ['CPSC 221', allOf('CPSC 121')],
    ['CPSC 320', allOf('CPSC 221')],
  ]);

  const terms: PlanTerm[] = [
    { id: 't1', name: '2026W Term 1', available: true },
    { id: 't2', name: '2026W Term 2', available: true },
    { id: 't3', name: '2027S Summer', available: true },
    { id: 't4', name: '2027W Term 1', available: true },
    { id: 't5', name: '2027W Term 2', available: true },
  ];

  const base = (over: Partial<SolverInput> = {}): SolverInput => ({
    outstanding: outstanding([], [
      { id: 'r.110', kind: 'course', label: '110', code: 'CPSC 110' },
      { id: 'r.210', kind: 'course', label: '210', code: 'CPSC 210' },
      { id: 'r.310', kind: 'course', label: '310', code: 'CPSC 310' },
    ]),
    completed: [],
    catalogue: CAT,
    prereqs,
    offerings: new Map(),
    terms,
    prefs: { creditsPerTerm: 8, useSummer: false, targetTermId: null },
    ...over,
  });

  it('computes prerequisite depth along a chain', () => {
    expect(depth('CPSC 110', prereqs)).toBe(0);
    expect(depth('CPSC 210', prereqs)).toBe(1);
    expect(depth('CPSC 310', prereqs)).toBe(2);
  });

  it('satisfies an OR prerequisite from either branch', () => {
    // The bug this guards: CoursePrereqEdge flattens "One of 107, 110" into
    // two edges, and requiring both made CPSC 210 — and everything after it —
    // impossible to place.
    expect(treeMet(oneOf('CPSC 107', 'CPSC 110'), new Set(['CPSC 110']))).toBe(true);
    expect(treeMet(oneOf('CPSC 107', 'CPSC 110'), new Set(['CPSC 107']))).toBe(true);
    expect(treeMet(allOf('CPSC 107', 'CPSC 110'), new Set(['CPSC 110']))).toBe(false);
  });

  it('does not let eligibility prose block a course', () => {
    // "fourth-year standing" is not a course dependency and must not gate.
    expect(treeMet({ type: 'note', text: 'fourth-year standing' }, new Set())).toBe(true);
  });

  it('takes the cheaper branch of an OR when measuring depth', () => {
    const trees = new Map<string, Requirement | null>([
      ['X', { type: 'or', items: [need('CPSC 110'), need('CPSC 310')] }],
      ['CPSC 310', allOf('CPSC 210')],
      ['CPSC 210', oneOf('CPSC 110')],
    ]);
    // via CPSC 110 that is depth 1, not the 3 the deep branch would give.
    expect(depth('X', trees)).toBe(1);
  });

  it('turns a bailed-out note naming courses into a real dependency', () => {
    // CPSC 313's actual text. parseRequirements bails on "either" and emits a
    // note; treating that as non-blocking put 313 in the same term as 213.
    const ids = new Map([['CPSC 213', 'CPSC 213'], ['CPSC 221', 'CPSC 221']]);
    const tightened = tightenNotes(
      { type: 'note', text: 'CPSC_V 213 and either CPSC_V 221 or DSCI_V 221.' },
      ids,
    );
    expect(treeMet(tightened, new Set())).toBe(false);
    // "either 221 or DSCI 221" is an OR, so 213 alone is not enough but
    // 213 + 221 is — and 221 alone is not, because 213 is a separate conjunct.
    expect(treeMet(tightened, new Set(['CPSC 221']))).toBe(false);
    expect(treeMet(tightened, new Set(['CPSC 213', 'CPSC 221']))).toBe(true);
  });

  it('reads "one of A, B and one of C, D" as a conjunction of alternatives', () => {
    // CPSC 221's actual text. Reading it as "all four" made 221 — and the
    // whole upper-year chain behind it — impossible to place.
    const ids = new Map([
      ['CPSC 210', 'CPSC 210'], ['CPSC 260', 'CPSC 260'],
      ['CPSC 121', 'CPSC 121'], ['MATH 220', 'MATH 220'],
    ]);
    const t = tightenNotes(
      { type: 'note', text: 'One of CPSC_V 210, CPSC_V 260 and one of CPSC_V 121, MATH_V 220.' },
      ids,
    );
    expect(treeMet(t, new Set(['CPSC 210', 'CPSC 121']))).toBe(true);
    expect(treeMet(t, new Set(['CPSC 260', 'MATH 220']))).toBe(true);
    expect(treeMet(t, new Set(['CPSC 210']))).toBe(false); // second conjunct unmet
  });

  it('drops codes the catalogue cannot resolve rather than blocking on them', () => {
    // DSCI is outside a CS program's subjects, so it must not gate the plan.
    const tightened = tightenNotes(
      { type: 'note', text: 'CPSC_V 213 and either CPSC_V 221 or DSCI_V 221.' },
      new Map([['CPSC 213', 'CPSC 213'], ['CPSC 221', 'CPSC 221']]),
    );
    const codes = tightened?.type === 'and' ? tightened.items.map((i) => (i.type === 'course' ? i.code : '')) : [];
    expect(codes).not.toContain('DSCI 221');
  });

  it('leaves genuine eligibility prose non-blocking', () => {
    // "Third-year standing" names no course and must not gate anything.
    const t = tightenNotes({ type: 'note', text: 'Third-year standing in Computer Science' }, new Map());
    expect(treeMet(t, new Set())).toBe(true);
  });

  it('survives a cycle in the prereq graph', () => {
    const bad = new Map<string, Requirement | null>([['A', need('B')], ['B', need('A')]]);
    expect(() => depth('A', bad)).not.toThrow();
  });

  it('NEVER places a course before its prerequisites', () => {
    // The invariant the whole feature rests on.
    const plan = solve(base());
    const seen = new Set<string>();
    for (const t of plan.terms) {
      for (const c of coursesIn(t)) {
        // Everything this course needs must already be satisfied by an
        // EARLIER term — not by anything sharing its own term.
        expect(treeMet(prereqs.get(c.id), seen)).toBe(true);
      }
      for (const c of coursesIn(t)) seen.add(c.id);
    }
  });

  it('does not let two courses in the same term satisfy each other', () => {
    const plan = solve(base({ prefs: { creditsPerTerm: 20, useSummer: false, targetTermId: null } }));
    const first = plan.terms[0] ? coursesIn(plan.terms[0]).map((c) => c.code) : [];
    expect(first).toContain('CPSC 110');
    expect(first).not.toContain('CPSC 210'); // needs 110, placed same term
  });

  it('never places a course in a term it is not offered', () => {
    const offerings = new Map([['CPSC 110', new Set(['t2'])]]);
    const plan = solve(base({ offerings }));
    for (const t of plan.terms) {
      for (const c of coursesIn(t)) {
        const when = offerings.get(c.id);
        if (when) expect(when.has(t.term.id)).toBe(true);
      }
    }
  });

  it('respects the credit load per term', () => {
    const plan = solve(base({ prefs: { creditsPerTerm: 4, useSummer: false, targetTermId: null } }));
    for (const t of plan.terms) expect(coursesIn(t).reduce((n, c) => n + c.credits, 0)).toBeLessThanOrEqual(4);
  });

  it('skips summer sessions unless asked', () => {
    const plan = solve(base());
    expect(plan.terms.map((t) => t.term.id)).not.toContain('t3');
    const withSummer = solve(base({ prefs: { creditsPerTerm: 8, useSummer: true, targetTermId: null } }));
    expect(withSummer.terms.length).toBeGreaterThan(0);
  });

  it('skips a term marked unavailable — the co-op work-term case', () => {
    const coop = terms.map((t) => (t.id === 't1' ? { ...t, available: false } : t));
    const plan = solve(base({ terms: coop }));
    expect(plan.terms.map((t) => t.term.id)).not.toContain('t1');
  });

  it('treats already-completed courses as satisfying prerequisites', () => {
    const plan = solve(
      base({
        completed: [course('CPSC 110', 4)],
        outstanding: outstanding([], [{ id: 'r.210', kind: 'course', label: '210', code: 'CPSC 210' }]),
      }),
    );
    expect(coursesIn(plan.terms[0])[0].code).toBe('CPSC 210');
  });

  it('can plan a multi-course alternative, not just single-course branches', () => {
    // "CPSC 110, or CPSC 103 and 107" with 110 unavailable. An earlier version
    // only looked at single-course branches and silently dropped the pair, so
    // a program whose only route was a bundle could never be planned.
    const rule: Rule = {
      id: 'r.intro', kind: 'chooseN', label: 'intro', n: 1,
      of: [
        { id: 'r.intro.110', kind: 'course', label: '110', code: 'CPSC 110' },
        {
          id: 'r.intro.pair', kind: 'group', label: '103 + 107',
          items: [
            { id: 'r.intro.103', kind: 'course', label: '103', code: 'CPSC 103' },
            { id: 'r.intro.107', kind: 'course', label: '107', code: 'CPSC 107' },
          ],
        },
      ],
    };
    const plan = solve(
      base({
        outstanding: outstanding([], [rule]),
        catalogue: [course('CPSC 103'), course('CPSC 107')], // no 110
        prereqs: new Map(),
        prefs: { creditsPerTerm: 12, useSummer: false, targetTermId: null },
      }),
    );
    expect(coursesIn(plan.terms[0]).map((c) => c.code).sort()).toEqual(['CPSC 103', 'CPSC 107']);
  });

  it('does not split a bundle across the load limit', () => {
    // Placing only half of "103 and 107" would satisfy nothing.
    const rule: Rule = {
      id: 'r.intro', kind: 'chooseN', label: 'intro', n: 1,
      of: [{
        id: 'r.intro.pair', kind: 'group', label: '103 + 107',
        items: [
          { id: 'r.intro.103', kind: 'course', label: '103', code: 'CPSC 103' },
          { id: 'r.intro.107', kind: 'course', label: '107', code: 'CPSC 107' },
        ],
      }],
    };
    const plan = solve(
      base({
        outstanding: outstanding([], [rule]),
        catalogue: [course('CPSC 103'), course('CPSC 107')],
        prereqs: new Map(),
        prefs: { creditsPerTerm: 4, useSummer: false, targetTermId: null }, // room for one
      }),
    );
    expect(plan.terms.flatMap(coursesIn)).toHaveLength(0);
  });

  it('emits a slot for a requirement that names an amount, not a course', () => {
    const plan = solve(
      base({
        outstanding: outstanding([], [
          { id: 'r.arts', kind: 'credits', label: 'Arts credits', n: 6, from: { kind: 'codes', codes: [] } },
        ]),
        prefs: { creditsPerTerm: 15, useSummer: false, targetTermId: null },
      }),
    );
    const slots = plan.terms.flatMap((t) => t.placements).filter((p) => p.kind === 'slot');
    // Unresolvable set, so no concrete course — but still planned, not dropped.
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.reduce((s, p) => s + (p.kind === 'slot' ? p.credits : 0), 0)).toBe(6);
    expect(plan.terms.flatMap(coursesIn)).toHaveLength(0);
  });

  it('offers a breadth category once, not once per term', () => {
    const breadth: Rule = {
      id: 'r.breadth', kind: 'chooseN', label: 'Science Breadth — 3 credits from any 2 of 3', n: 2,
      of: [
        { id: 'b.chem', kind: 'credits', label: 'Chemistry', n: 3, from: { kind: 'pattern', subjects: ['CHEM'] } },
        { id: 'b.phys', kind: 'credits', label: 'Physics', n: 3, from: { kind: 'pattern', subjects: ['PHYS'] } },
        { id: 'b.biol', kind: 'credits', label: 'Life Science', n: 3, from: { kind: 'pattern', subjects: ['BIOL'] } },
      ],
    };
    const plan = solve(
      base({
        outstanding: outstanding([], [breadth]),
        prereqs: new Map(),
        prefs: { creditsPerTerm: 4, useSummer: false, targetTermId: null }, // forces a spread across terms
      }),
    );
    // Slots are labelled generically now — "Science Breadth", not
    // "Science Breadth: Chemistry" — because the category is the student's
    // choice. Identity is checked through the example courses instead.
    const slots = plan.terms.flatMap((t) => t.placements).flatMap((p) => (p.kind === 'slot' ? [p] : []));
    expect(slots).toHaveLength(2); // n = 2
    const subjects = slots.map((s) => s.examples[0]?.subject);
    expect(new Set(subjects).size).toBe(subjects.length); // no category twice
  });

  it('skips a breadth category the major already covers', () => {
    // n = 2 on purpose. With n = 1 the student's CPSC course satisfies the
    // whole requirement and offering anything more would be wrong; asking for
    // two categories is what makes "which one is still owed" observable.
    const breadth: Rule = {
      id: 'r.breadth', kind: 'chooseN', label: 'Science Breadth', n: 2,
      of: [
        { id: 'b.cpsc', kind: 'credits', label: 'Computer Science', n: 3, from: { kind: 'pattern', subjects: ['CPSC'] } },
        { id: 'b.chem', kind: 'credits', label: 'Chemistry', n: 3, from: { kind: 'pattern', subjects: ['CHEM'] } },
      ],
    };
    const plan = solve(
      base({
        outstanding: outstanding([], [breadth]),
        completed: [course('CPSC 110', 4)], // CS category already covered
        prereqs: new Map(),
        prefs: { creditsPerTerm: 8, useSummer: false, targetTermId: null },
      }),
    );
    const subjects = plan.terms
      .flatMap((t) => t.placements)
      .flatMap((p) => (p.kind === 'slot' ? p.examples.map((e) => e.subject) : []));
    expect(subjects).toContain('CHEM');   // the category still owed
    expect(subjects).not.toContain('CPSC'); // the one the major already covers
  });

  it('reports what it could not place rather than dropping it', () => {
    const plan = solve(
      base({
        outstanding: outstanding([], [{ id: 'r.x', kind: 'course', label: 'x', code: 'CPSC 999' }]),
      }),
    );
    expect(plan.unplaced).toHaveLength(1);
    expect(plan.unplaced[0].rule.id).toBe('r.x');
  });

  it('warns that un-evaluated requirements need an advisor', () => {
    const plan = solve(
      base({
        outstanding: [
          { rule: { id: 'n', kind: 'note', label: 'breadth', detail: 'd' }, state: 'unevaluated', satisfiedBy: [], detail: 'd' },
        ],
      }),
    );
    expect(plan.warnings.join(' ')).toMatch(/advisor/i);
  });

  it('fills a credit rule up to its credit total, not its course count', () => {
    const plan = solve(
      base({
        outstanding: outstanding([], [
          { id: 'r.u', kind: 'credits', label: '6cr', n: 6, from: { kind: 'pattern', subjects: ['CPSC'], levelMin: 400 } },
        ]),
        prefs: { creditsPerTerm: 20, useSummer: false, targetTermId: null },
      }),
    );
    // A credits rule now yields SLOTS rather than arbitrary concrete courses.
    const slots = plan.terms.flatMap((t) => t.placements).filter((p) => p.kind === 'slot');
    expect(slots.reduce((s, p) => s + (p.kind === 'slot' ? p.credits : 0), 0)).toBeGreaterThanOrEqual(6);
    expect(slots[0].kind === 'slot' && slots[0].label).toContain('6cr');
  });
});

describe('faculty index parsing', () => {
  it('reads faculties and their institution paths off the index', () => {
    const html = `<ul>
      <li><a href="/course-descriptions/institution/120">Faculty of Science</a></li>
      <li><a href="/course-descriptions/institution/88">Faculty of Arts</a></li>
      <li><a href="/course-descriptions/institution/120">Faculty of Science</a></li>
      <li><a href="/somewhere-else">Not a faculty</a></li>
    </ul>`;
    const out = parseFacultyIndex(html);
    expect(out).toHaveLength(2); // deduped, and the unrelated link ignored
    expect(out[0]).toEqual({ name: 'Faculty of Science', path: '/course-descriptions/institution/120' });
  });

  it('reads subject codes and strips the campus suffix', () => {
    // Exactly how the Calendar writes them.
    const html = `<div><a>CPSC_V - Computer Science</a><a>MATH_V - Mathematics</a>
      <a>EOSC_V - Earth and Ocean Sciences</a><p>ASTR_V – Astronomy</p></div>`;
    const codes = parseFacultySubjects(html);
    expect(codes).toContain('CPSC');
    expect(codes).toContain('MATH');
    expect(codes).toContain('ASTR'); // en-dash separator too
    expect(codes.some((c) => c.includes('_'))).toBe(false);
  });

  it('does not invent codes from ordinary prose', () => {
    expect(parseFacultySubjects('<p>Courses offered by the Faculty of Science.</p>')).toEqual([]);
  });
});

describe('transcription verification', () => {
  it('reads the Calendar\'s subject-carrying shorthand', () => {
    // "CPSC_V 310, 313, 320" — only the first number carries a subject.
    const found = codesOnPage('<td>CPSC_V 310, 313, 320</td>');
    expect([...found].sort()).toEqual(['CPSC 310', 'CPSC 313', 'CPSC 320']);
  });

  it('strips footnote markers glued to a course number', () => {
    // The rendered table writes CPSC 121 with footnote 3 as "CPSC_V 1213".
    expect([...codesOnPage('<td>CPSC_V 1213</td>')]).toEqual(['CPSC 121']);
    expect([...codesOnPage('<td>STAT_V 2512</td>')]).toEqual(['STAT 251']);
  });

  it('stops carrying a subject across a sentence end', () => {
    const found = codesOnPage('<p>CPSC_V 110 is recommended. See 350 for details.</p>');
    expect(found.has('CPSC 110')).toBe(true);
    expect(found.has('CPSC 350')).toBe(false); // different sentence
  });

  it('flags a duplicate rule id', () => {
    const dup: Program = {
      code: 'x', name: 'x', degree: 'BSc', faculty: 'Science', catalogYear: '2026W',
      extends: [], sourceUrl: 'u', totalCredits: 120,
      rules: [
        { id: 'a', kind: 'course', label: 'a', code: 'CPSC 110', sourceUrl: 'u' },
        { id: 'a', kind: 'course', label: 'b', code: 'CPSC 121', sourceUrl: 'u' },
      ],
    };
    const errs = validateProgram(dup, new Set()).filter((i) => i.severity === 'error');
    expect(errs.map((e) => e.message)).toContain('duplicate rule id');
  });

  it('flags a choice asking for more branches than it offers', () => {
    const bad: Program = {
      code: 'x', name: 'x', degree: 'BSc', faculty: 'Science', catalogYear: '2026W',
      extends: [], sourceUrl: 'u', totalCredits: 120,
      rules: [{
        id: 'c', kind: 'chooseN', label: 'c', n: 3, sourceUrl: 'u',
        of: [{ id: 'c1', kind: 'course', label: 'c1', code: 'CPSC 110', sourceUrl: 'u' }],
      }],
    };
    const errs = validateProgram(bad, new Set()).filter((i) => i.severity === 'error');
    expect(errs[0].message).toMatch(/can never be satisfied/);
  });

  it('flags an extends pointing at nothing', () => {
    const orphan: Program = {
      code: 'x', name: 'x', degree: 'BSc', faculty: 'Science', catalogYear: '2026W',
      extends: ['does-not-exist'], sourceUrl: 'u', totalCredits: 120, rules: [],
    };
    expect(validateProgram(orphan, new Set()).some((i) => i.severity === 'error')).toBe(true);
  });
});

describe('a four-year degree plans in four years', () => {
  it('a constraint is spent from the elective pool, not added to it', () => {
    // "12 credits of Arts" is 12 OF the electives, not 12 beyond them.
    // Counting them separately turned a 120-credit degree into 135 and
    // stretched the plan by a year and a half.
    const rules: Rule[] = [
      { id: 'elect', kind: 'credits', label: 'Electives', n: 24, from: { kind: 'codes', codes: [] } },
      { id: 'arts', kind: 'credits', label: 'Arts credits', n: 12, constraint: true, from: { kind: 'codes', codes: [] } },
    ];
    const plan = solve({
      outstanding: outstanding([], rules), completed: [], catalogue: [],
      prereqs: new Map(), offerings: new Map(),
      terms: Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, available: true, projected: true })),
      prefs: { creditsPerTerm: 15, useSummer: false, targetTermId: null },
    });
    const total = plan.terms
      .flatMap((t) => t.placements)
      .reduce((n, p) => n + (p.kind === 'slot' ? p.credits : p.course.credits), 0);
    expect(total).toBe(24); // NOT 36
  });

  it('stops asking for categories the plan itself satisfies', () => {
    // Science Breadth asks for 6 of 7 and a CS major covers three through its
    // own required courses. Counting `left` once at the start left those three
    // permanently owed, so the rule reported itself unplaceable however many
    // slots it got.
    const breadth: Rule = {
      id: 'r.b', kind: 'chooseN', label: 'Breadth', n: 2, constraint: true,
      of: [
        { id: 'b.cpsc', kind: 'credits', label: 'Computer Science', n: 3, from: { kind: 'pattern', subjects: ['CPSC'] } },
        { id: 'b.chem', kind: 'credits', label: 'Chemistry', n: 3, from: { kind: 'pattern', subjects: ['CHEM'] } },
      ],
    };
    const plan = solve({
      outstanding: outstanding([], [breadth]),
      completed: [course('CPSC 110', 4)], // one category already met
      catalogue: [course('CPSC 110', 4)],
      prereqs: new Map(), offerings: new Map(),
      terms: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, available: true, projected: true })),
      prefs: { creditsPerTerm: 15, useSummer: false, targetTermId: null },
    });
    expect(plan.unplaced).toHaveLength(0); // the remaining one gets a slot
  });

  it('a slot rule never falls through to placing individual courses', () => {
    // Once every breadth category is slotted the rule yields no more specs;
    // falling through put unrelated MATH courses in fourth year.
    const breadth: Rule = {
      id: 'b', kind: 'chooseN', label: 'Breadth', n: 1, constraint: true,
      of: [{ id: 'b.m', kind: 'credits', label: 'Mathematics', n: 3, from: { kind: 'pattern', subjects: ['CPSC'] } }],
    };
    const plan = solve({
      outstanding: outstanding([], [breadth]), completed: [],
      catalogue: [course('CPSC 110', 4), course('CPSC 121', 4), course('CPSC 310', 4)],
      prereqs: new Map(), offerings: new Map(),
      terms: Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, available: true, projected: true })),
      prefs: { creditsPerTerm: 15, useSummer: false, targetTermId: null },
    });
    expect(plan.terms.flatMap(coursesIn)).toHaveLength(0); // slots only
  });
});

describe('calendar course listing', () => {
  const page = `
    <article><h3>MATH_V 100 (3)  Differential Calculus with Applications</h3></article>
    <article><h3>MATH_V 102 (3)  Differential Calculus with Applications to Life Sciences</h3></article>
    <article><h3>MATH_V 449 (3/6) d  Honours Essay</h3></article>
    <article><h3>MATH_O 100 (3)  Okanagan course</h3></article>
    <article><h3>Not a course heading</h3></article>`;

  it('reads code, number, credits and title', () => {
    const out = parseCourseDescriptions(page, 'V');
    expect(out[0]).toEqual({ subjectCode: 'MATH', number: '100', title: 'Differential Calculus with Applications', credits: 3 });
    // The course the sections scraper never sees, because nothing offers it.
    expect(out.some((c) => c.number === '102')).toBe(true);
  });

  it('takes the lower bound of a credit range', () => {
    // "(3/6) d" — variable-credit courses are written this way.
    expect(parseCourseDescriptions(page, 'V').find((c) => c.number === '449')?.credits).toBe(3);
  });

  it('ignores other campuses and non-course headings', () => {
    const out = parseCourseDescriptions(page, 'V');
    expect(out).toHaveLength(3); // 100, 102, 449 — not the _O one, not the prose
  });

  it('builds the subject page path', () => {
    expect(subjectPath('MATH', 'V')).toBe('/course-descriptions/subject/mathv');
    expect(subjectPath('CPSC', 'V')).toBe('/course-descriptions/subject/cpscv');
  });
});

describe('course codes glued to the next word', () => {
  it('does not absorb the following word\'s initial as a course letter', () => {
    // The Calendar's thematic table renders as one run with no separators:
    // "ANTH_V 418, 527, 528BiologyBIOL_V 300, 301Commerce".
    const found = codesOnPage('<td>ANTH_V 418, 527, 528</td><td>Biology</td><td>BIOL_V 300, 301</td><td>Commerce</td>');
    expect(found.has('ANTH 528')).toBe(true);  // not ANTH 528B
    expect(found.has('BIOL 301')).toBe(true);  // not BIOL 301C
    expect(found.has('ANTH 528B')).toBe(false);
  });

  it('still reads a genuine course-letter suffix', () => {
    expect(codesOnPage('<td>CPSC_V 449A and CPSC_V 491</td>').has('CPSC 449A')).toBe(true);
  });
});

describe('lettered prerequisite alternatives', () => {
  it('reads "(a) …; or (b) …" as alternatives, not as a conjunction', () => {
    // STAT 305's real shape. parseRequirements splits on the semicolons and
    // joins the pieces with AND, which demands every option at once —
    // including DSCI 200, which a Statistics major never takes.
    const parsed: Requirement = {
      type: 'and',
      items: [
        { type: 'note', text: 'Either (a) one of STAT_V 200 and one of STAT_V 302' },
        { type: 'note', text: 'or (b) DSCI_V 200 and STAT_V 201 and one of STAT_V 302' },
        { type: 'note', text: 'The Department recommends option (a).' },
      ],
    };
    const ids = new Map([
      ['STAT 200', 'STAT 200'], ['STAT 201', 'STAT 201'],
      ['STAT 302', 'STAT 302'], ['DSCI 200', 'DSCI 200'],
    ]);
    const t = tightenNotes(parsed, ids);
    // Option (a) alone is enough; DSCI 200 is not needed.
    expect(treeMet(t, new Set(['STAT 200', 'STAT 302']))).toBe(true);
    // And option (b) alone is also enough.
    expect(treeMet(t, new Set(['DSCI 200', 'STAT 201', 'STAT 302']))).toBe(true);
    // But nothing at all is still not enough.
    expect(treeMet(t, new Set())).toBe(false);
  });
});

describe('lettered alternatives inside a single note', () => {
  it('splits "(a) … or (b) … or (c) …" into branches before reading "and"', () => {
    // BIOL 200's real prerequisite, all in one sentence. Splitting on "and"
    // first joins clauses that are alternatives, demanding (a) and (c) and
    // (d) together — which nobody satisfies.
    const note: Requirement = {
      type: 'note',
      text:
        'Either (a) BIOL_V 112 and one of CHEM_V 123, CHEM_V 130 or (b) SCIE_V 001 ' +
        'or (c) 8 transfer credits of first-year BIOL_V or (d) one of BIOL_V 112 or BIOL_V 121',
    };
    const ids = new Map([
      ['BIOL 112', 'BIOL 112'], ['BIOL 121', 'BIOL 121'],
      ['CHEM 123', 'CHEM 123'], ['CHEM 130', 'CHEM 130'], ['SCIE 001', 'SCIE 001'],
    ]);
    const t = tightenNotes(note, ids);
    // Branch (a): BIOL 112 AND one of CHEM 123/130.
    expect(treeMet(t, new Set(['BIOL 112', 'CHEM 123']))).toBe(true);
    // Branch (b) alone.
    expect(treeMet(t, new Set(['SCIE 001']))).toBe(true);
    // Branch (d) alone.
    expect(treeMet(t, new Set(['BIOL 121']))).toBe(true);
    // Nothing at all is still not enough.
    expect(treeMet(t, new Set())).toBe(false);
  });
});

describe('subject codes glued to a footnote and the next subject', () => {
  it('does not read the next subject\'s initial as a course-letter suffix', () => {
    // The real run from the Microbiology page: course, footnote marker,
    // credit count and the next subject, with no separator anywhere.
    const found = codesOnPage('<td>MICB_V 471 (or 421 or 447)123MICB_V 305 (or 401 or 475)123</td>');
    expect(found.has('MICB 471')).toBe(true);
    expect(found.has('MICB 305')).toBe(true);
    expect(found.has('MICB 123M')).toBe(false); // the artifact
    expect([...found].some((c) => c.startsWith('ICB'))).toBe(false); // the corrupted subject
  });

  it('still reads a real course-letter suffix', () => {
    expect(codesOnPage('<td>CPSC_V 449A and MATH_V 449</td>').has('CPSC 449A')).toBe(true);
  });
});

describe('corequisites', () => {
  const ids = new Map([
    ['BIOC 203', 'BIOC 203'], ['BIOC 303', 'BIOC 303'],
    ['MICB 211', 'MICB 211'], ['BIOL 200', 'BIOL 200'], ['CHEM 233', 'CHEM 233'],
  ]);

  it('does not require a corequisite named in a clause', () => {
    // BIOC 306. Requiring BIOC 303 earlier makes 306 unplaceable against a
    // plan that schedules both in the same year.
    const t = tightenNotes(
      { type: 'note', text: 'BIOC_V 203 and a corequisite of BIOC_V 303' },
      ids,
    );
    expect(treeMet(t, new Set(['BIOC 203']))).toBe(true);
    expect(treeMet(t, new Set())).toBe(false); // the real prerequisite still holds
  });

  it('does not require corequisites listed in their own sentence', () => {
    // MICB 322, which took MICB 323 down with it.
    const t = tightenNotes(
      {
        type: 'note',
        text: 'MICB_V 211 (or 201). Co-requisites: All of BIOL_V 200, CHEM_V 233.',
      },
      ids,
    );
    expect(treeMet(t, new Set(['MICB 211']))).toBe(true);
    expect(treeMet(t, new Set())).toBe(false);
  });
});

describe('one number shared by two subjects', () => {
  it('reads "GEOS_V (or GEOB_V) 270" as both codes', () => {
    // EOSC's second year. Pairing the number with only the nearest subject
    // made GEOS 270 look invented while it sat plainly on the page.
    const found = codesOnPage('<td>EOSC_V 211 or GEOS_V (or GEOB_V) 270</td>');
    expect([...found].sort()).toEqual(['EOSC 211', 'GEOB 270', 'GEOS 270']);
  });

  it('still closes the run at a number', () => {
    // Without that, MICB would stay pending and pick up 305 as well.
    const found = codesOnPage('<td>MICB_V 211 and BIOL_V 200, 305</td>');
    expect([...found].sort()).toEqual(['BIOL 200', 'BIOL 305', 'MICB 211']);
  });
});

describe('Arts faculty core', () => {
  const flat: Rule[] = [];
  walk(artsFacultyCore2026W.rules, (r) => flat.push(r));

  it('reserves exactly the 18 Ways of Knowing breadth credits', () => {
    // 9 in one course code, 6 in another, 3 in the last — the fourth area is
    // covered by the student's own major.
    const wok = flat.filter((r) => r.id.startsWith('arts.wok.') && r.kind === 'credits');
    expect(wok.map((r) => (r as Extract<Rule, { kind: 'credits' }>).n).sort((a, b) => b - a)).toEqual([9, 6, 3]);
  });

  it('offers only 3-credit courses for the Writing Component', () => {
    // Arts One is 18 credits and the CAP seminar is 6. Both satisfy the
    // requirement, but putting them in the choice would have the plan reserve
    // 18 credits for a 3-credit rule, so they are carried as a note instead.
    const choice = flat.find((r) => r.id === 'arts.writing.course');
    expect(choice?.kind).toBe('chooseN');
    const codes = (choice as Extract<Rule, { kind: 'chooseN' }>).of.map(
      (b) => (b as Extract<Rule, { kind: 'course' }>).code,
    );
    expect(codes).not.toContain('ARTS 001');
    expect(codes).not.toContain('ASTU 100');
    expect(codes).toContain('WRDS 150');
  });

  it('carries the Arts credit minimum as a constraint, not a credits bucket', () => {
    // A credits bucket only counts down when the solver slots FOR it, so a
    // 72-credit rule could not see the 42 Arts credits the major already
    // supplies. It scheduled all 72 on top and took the degree to 141.
    const min = flat.find((r) => r.id === 'arts.arts-minimum');
    expect(min?.kind).toBe('note');
    expect(min?.constraint).toBe(true);
  });

  it('a constraint larger than the elective pool overruns the plan', () => {
    // The mechanism behind that bug, pinned on its own: spendFromElectives can
    // only charge against buckets that still have room, so anything past the
    // pool is added on top instead of drawn from it.
    const rules: Rule[] = [
      { id: 'elect', kind: 'credits', label: 'Electives', n: 24, from: { kind: 'codes', codes: [] } },
      { id: 'big', kind: 'credits', label: 'Too big', n: 72, constraint: true, from: { kind: 'codes', codes: [] } },
    ];
    const plan = solve({
      outstanding: outstanding([], rules),
      completed: [], catalogue: [], prereqs: new Map(), offerings: new Map(),
      terms: Array.from({ length: 12 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, available: true, projected: true })),
      prefs: { creditsPerTerm: 15, useSummer: false, targetTermId: null },
    });
    const total = plan.terms
      .flatMap((t) => t.placements)
      .reduce((n, p) => n + (p.kind === 'slot' ? p.credits : p.course.credits), 0);
    expect(total).toBeGreaterThan(24);
  });
});
