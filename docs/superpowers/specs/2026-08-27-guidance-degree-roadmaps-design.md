# Guidance: degree roadmaps and course routing

**Status:** approved, implementation started
**Date:** 2026-08-27
**Branch:** `feature/guidance`

## Problem

A student knows the courses they have taken and, vaguely, the ones their degree
demands. What they do not have is the ordering: which courses to take next
term so that prerequisites are satisfied, the course is actually offered, and
they graduate on time. UBC publishes requirements as prose in the Academic
Calendar and a suggested sequence per department; neither is personalised and
neither knows what the student has already done.

Guidance answers one question: **given what I have taken, what should I take
each term until I graduate?**

## Scope of v1

One program, end to end: **Computer Science Major (BSc), catalog year 2026W**.

The narrowness is deliberate and confined to data. The rule language, database
model, progress engine, solver, and UI are all program-agnostic; the only
CPSC-specific artefacts are two checked-in data files. A second program is a
data task, not a code task.

Explicitly out of scope for v1: catalog years other than 2026W, honours and
co-op variants (see *Forward constraints*), dual majors, minors, and campuses
other than Vancouver.

## What already exists

Established by inspection of the repository and a query against the
development database, not assumed:

| Capability | State |
|---|---|
| Prereq graph | `CoursePrereqEdge`, 3,479 edges. CPSC/MATH/STAT parse at **100%** (57/57, 84/84, 23/23 of courses that have prereq text). The full core CPSC chain is machine-readable. |
| Course credits | Populated on all 7,336 Vancouver courses. |
| Term offerings | `Section` + `Term` - which courses actually run when. |
| Requirement tree type | `Requirement` union in `src/prereqs/parse.ts` (`course`/`and`/`or`/`note`). |
| Student history | `Enrollment` (user, course, term). |

Two gaps, both material:

1. **`Enrollment` records registration, not completion.** No grade, no status. A
   failed course is indistinguishable from a passed one. The Workday export
   *does* carry a grade column - `src/upload/parse-workday.ts` reads it today
   only to detect `TR` and discard transfer credits outright.
2. **`Subject.faculty` is null for all 367 subjects.** The column exists and was
   never populated. Breadth requirements are defined in terms of faculty, so
   this blocks the breadth modelling.

`parseRequirements` deliberately bails on `"one of"`, `"N of"`, `"either"`, and
program restrictions via its `AMBIGUOUS`/`BAILOUT` guards. Degree requirements
consist largely of those constructs, so that parser does **not** transfer to
this problem. Degree rules need their own language.

## Design

### Rule language

```ts
type CourseSet =
  | { kind: 'codes';   codes: string[] }
  | { kind: 'pattern'; subject?: string; faculty?: string;
      levelMin?: number; levelMax?: number; exclude?: string[] };

type Rule =
  | { kind: 'course';  code: string }
  | { kind: 'chooseN'; n: number; of: Rule[] }
  | { kind: 'credits'; n: number; from: CourseSet }
  | { kind: 'group';   label: string; items: Rule[] };
```

Every rule additionally carries `id`, `label`, `sourceUrl`, and
`confidence: 'stated' | 'inferred'`.

`confidence` is the mitigation for modelling breadth. Breadth rules are the
most exception-ridden part of the Calendar, and a confidently wrong graduation
plan is worse than no plan. Any rule the curator inferred rather than read
verbatim is marked `inferred`, and the UI renders an advisor caveat wherever
one appears in a student's outstanding set.

Breadth is expressed as `credits` over a `pattern` carrying `faculty`, which
is why populating `Subject.faculty` is a prerequisite rather than a nicety.

### Composition

```
Program
  code      "cpsc-major-bsc-2026w"
  extends   ["science-faculty-core-2026w"]
  rules     Json    // only the CPSC-specific rules
```

A program's effective requirements are its `extends` chain resolved, then
merged with its own rules. `science-faculty-core-2026w` is an ordinary
`Program` row with an empty `extends`.

This exists from the start because it is expensive to retrofit. Majors within
a faculty share their entire non-major requirement set - Communication, Arts,
Science breadth, credit minimums. Without composition, program #2 means
copy-pasting the Science core into a second file, and the two drift. With it,
the expensive breadth modelling is written once per faculty and reused by every
major in that faculty.

### Schema changes

```
Program      code @unique, name, degree, faculty, catalogYear,
             extends String[], sourceUrl, rules Json, updatedAt
Enrollment   + grade String?
             + status String   // passed | failed | in_progress | transfer | withdrawn
User         + programCode String?
Subject      faculty populated (data only; column already exists)
```

Requirement rules are stored as JSON on `Program` rather than in a normalised
`ProgramRule` table. One program is roughly sixty rules, and nothing in v1 asks
a cross-program question such as "which programs require CPSC 310". A
self-referential rule table would be real schema cost for a query nobody makes.
The checked-in file remains the source of truth; the database is the query
surface. If cross-program queries arrive later, normalising is a migration, not
a redesign.

`User.program` - an existing free-text `String?`, read in two places and never
written - is left untouched. `programCode` is added beside it so this feature
does not silently change what those read sites see. The dead field is flagged
for separate cleanup.

### Components

Each is independently testable and depends only on those above it.

**`src/guidance/rules.ts`** - the rule language, and `resolveSet(CourseSet)`
turning a set into concrete course IDs. Depends on `Course`, `Subject`.

**`src/guidance/programs/*.ts`** - checked-in program data.
`science-faculty-core-2026w.ts` and `cpsc-major-2026w.ts`. Plain data, no logic.

**`src/guidance/seed.ts`** - validates and loads program files into `Program`.
Validation asserts every `course` code resolves to a real course and every
`pattern` matches at least one. A typo fails the seed rather than silently
dropping a requirement.

**`src/guidance/progress.ts`** - pure function
`(completed: CourseRef[], program: Program) => RuleProgress[]`, marking each
rule satisfied, partial, or outstanding, and recording which course satisfied
which rule. No I/O. This is where the correctness tests concentrate.

**`src/guidance/solver.ts`** - pure function
`(outstanding: Rule[], graph, offerings, prefs) => Plan`. Assigns courses to
terms respecting prerequisite depth, real term offerings, and the requested
load. Reports infeasibility rather than silently producing a plan that cannot
happen.

**`src/app/guidance/`** - the page. Nav pill beside Schedules.

### Data flow

```
Workday import ─┐
                ├─→ Enrollment (+grade, +status) ─┐
manual editor ──┘                                 │
                                                  ├─→ progress ─→ outstanding rules ─┐
Program file ─→ seed ─→ Program (rules JSON) ─────┘                                  │
                                                                                     ├─→ solver ─→ Plan ─→ UI
CoursePrereqEdge ────────────────────────────────────────────────────────────────────┤
Section + Term (offerings) ──────────────────────────────────────────────────────────┘
```

### Solver behaviour

Three student-facing controls: **course load** per term, **use summer
sessions**, and **target graduation term**.

The solver walks outstanding rules in prerequisite-depth order, placing each
course in the earliest term where its prerequisites are already satisfied by
the plan-so-far and the course is actually offered. Elective and credit-count
rules are filled from their resolved set, preferring courses that unlock the
most downstream requirements.

When the target graduation term cannot be met at the requested load, the solver
does not quietly overfill terms. It reports the shortfall in the student's own
terms: *"graduating by 2028W requires 5.5 courses per term, or one summer
session."*

### Signed-out behaviour

`/guidance` is **public**. A signed-out visitor picks a program and sees the
generic roadmap for a student starting fresh, which is genuinely useful and is
the page's best advertisement. Personalisation - reading `Enrollment`, marking
progress, saving a plan - requires signing in, consistent with Schedules.

## Testing

The engine is two pure functions, so the valuable tests need no database.

- `progress.ts`: student fixtures - fresh, mid-degree, a failed course, transfer
  credit, a partially satisfied credit-count rule - asserted against expected
  rule states.
- `solver.ts`: the invariant that matters is **a plan never violates a
  prerequisite and never places a course in a term it is not offered**. Asserted
  across generated student states rather than one hand-picked case.
- `seed.ts`: a program file with a bad course code fails validation.
- The existing suite (42 files, 387 tests) must stay green.

## Phasing

| Phase | Delivers | Gate |
|---|---|---|
| 0 | `Subject.faculty` populated; `Enrollment.grade`/`status`; transfer credit recorded instead of discarded | "What has this student passed?" is answerable |
| 1 | Rule language, `Program` model, seed + validator, Science core and CPSC data files | Program loads; every rule resolves to real courses |
| 2 | Progress engine | Correct for fresh / mid-degree / failed-course fixtures |
| 3 | Roadmap solver | Never violates a prereq or places an unoffered course |
| 4 | Guidance page, nav pill, controls, advisor caveats | A student can see their roadmap |
| 5 | Manual completion editor (transfer, AP/IB, exchange) | History correctable without Workday |

Phases 0–3 carry no UI and are testable in isolation.

## Forward constraints

Recorded now because they shape the rule language, though nothing in v1
implements them.

**Co-op.** A co-op designation is not a course requirement; it is a sequencing
constraint. Co-op students alternate study and work terms, so the solver must
be able to mark a term unavailable for coursework and continue placing around
it. This is a solver input (a per-term availability mask), not a new rule kind
- the v1 solver should keep term availability as data rather than assuming
every term is placeable, so co-op does not require restructuring it.

**Honours.** An honours variant is largely the major's requirements plus extra
rules and higher credit floors. The `extends` mechanism already models this:
`cpsc-honours-bsc-2026w` extends both the Science core and the CPSC major, and
adds its own rules. What it will additionally need is a **grade-floor rule kind**
(honours typically demands a minimum average in the major), which v1 does not
have. That is an additive rule kind, not a redesign - and it is a reason the
rule union should stay easy to extend.

**Dual majors, minors, specialisations.** Composition covers the requirement
merge; what they need beyond it is a rule for *double-counting limits* ("at
most 6 credits may count toward both"). Deferred, and worth noting that it is
the one construct the current language genuinely cannot express.

## Risks

**Data fidelity is the whole risk.** The engine is the easy part - the prereq
graph is fully parsed for the subjects that matter and credits are populated
everywhere. What can go wrong is a mis-transcribed requirement producing a
confident, wrong graduation plan. Mitigations: per-rule `sourceUrl` and
`confidence`, seed-time validation that rules resolve to real courses, and an
advisor caveat surfaced wherever an `inferred` rule affects the student.

**Breadth specifically.** Modelling breadth was an explicit decision taken over
a recommendation to defer it. It is the most exception-ridden part of the
Calendar. The `confidence` field exists primarily for it.

**Catalog drift.** Requirements change per catalog year. v1 pins 2026W and
stores `catalogYear` on `Program`, so a second year is another row rather than
an edit that silently rewrites history for current students.
