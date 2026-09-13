# UBC Flow - Phase 6: Prerequisite Trees (Design)

**Date:** 2026-08-21
**Status:** Approved for planning
**Phase:** 6 of 6
**Depends on:** [Phase 1: Foundation](2026-08-19-ubc-flow-foundation-design.md) · [Phase 2: Accounts + Workday Import](2026-08-19-phase-2-accounts-workday-import-design.md) · [Phase 3: Ratings and Reviews](2026-08-19-phase-3-ratings-design.md) · [Phase 4: Schedule Planner](2026-08-20-phase-4-schedule-planner-design.md) · [Phase 5: Grade Distributions](2026-08-20-phase-5-grade-distributions-design.md) - all merged

## 1. Why this phase exists

Phase 1 scrapes prerequisite text into `Course.prereqText` and renders it as one
flat sentence: *"One of CHEM_V 12, CHEM_V 100."* The course codes inside it are
dead text - a student reading CPSC 221's page cannot click through to CPSC 210,
and cannot see at a glance whether two requirements are alternatives or both
mandatory.

This phase turns that prose into structured AND/OR data and renders it as a
navigable, linked requirement tree.

**Done when:** a student opens a course and sees its prerequisites and
corequisites as a structured list with working links to each required course -
and, where the text cannot be parsed safely, sees the original sentence
unchanged rather than a guess.

---

## 2. The data, measured

All figures below were counted against the live dev database on 2026-08-21, not
estimated.

| Fact | Count |
|---|---|
| UBCV courses with `prereqText` | 2,250 |
| …containing eligibility prose (standing/permission/GPA/program words) | 721 |
| …reading as course-code boolean logic | 1,478 |
| UBCV courses with `coreqText` | 234 |
| `prereqText` values containing an `Equivalency:` clause | 139 |

### 2.1 This is human-written calendar text, not a machine feed

Unlike Phase 5's CSVs, this text was written by many departments over many years
with no consistent grammar. Real examples, verbatim:

```
One of CHEM_V 12, CHEM_V 100. Equivalency: CHEM_V 141
All of POLI_V 310, POLI_V 380, POLI_V 381.
CHBE_V 241 and one of CHBE_V 251, CIVL_V 215. Not for credit for CHBE students.
A score of 72% or higher in two of VISA 110, VISA 180, VISA 183.
At least one of LING 201/PHIL 220/PHIL 222, plus 6 additional credits of PHIL/LING at the 200-level or above.
Either (a) all of NURS_V 345, NURS_V 365 or (b) all of NURS_V 346, NURS_V 366 or (c) all of NURS_V 303, NURS_V 363.
Permission of instructor is required.
Fourth-year standing and at least 80% average in third-year courses and permission of instructor.
```

**Roughly a third of this text is not a course dependency at all.** Standing
requirements, instructor permission, GPA thresholds, and program restrictions
cannot be expressed as a tree of course codes, and no parser should pretend
otherwise.

### 2.2 Why a deterministic parser, not an LLM

An LLM would read the messy third more gracefully. It was considered and
rejected: it introduces an external dependency, an API key and per-run cost, and
non-determinism - the same input could parse differently across runs, breaking
the pure/testable/idempotent pattern every prior phase holds to. A hand-rolled
parser that falls back to verbatim text on anything it does not positively
recognize is the lower-risk failure mode, and the fallback is already required
by §6 regardless.

---

## 3. Schema

Two new nullable `Json` columns on `Course`:

```prisma
model Course {
  // ...existing fields
  prereqText  String?
  coreqText   String?
  prereqTree  Json?    // NEW - Requirement, see below
  coreqTree   Json?    // NEW
}
```

The stored shape:

```ts
type Requirement =
  | { type: 'course'; code: string; courseId: string | null }
  | { type: 'and'; items: Requirement[] }
  | { type: 'or'; items: Requirement[] }
  | { type: 'note'; text: string };
```

**JSON on the row, not a normalized `RequirementNode` table.** This mirrors
Phase 5's `GradeDistribution.distribution`: the tree is only ever read or written
whole, for one course at a time, and is never queried across courses. A
relational table would buy joins and migration complexity for no query we intend
to run.

**`courseId` is resolved at build time, not read time.** Storing it denormalized
means the course page renders links without an N+1 lookup per node.
`courseId: null` is a legitimate, expected value (§5.2) - not an error state.

**No migration risk to existing data.** Both columns are nullable additions;
every existing row keeps working, and a course whose tree is never built simply
renders exactly as it does today.

---

## 4. Parsing

A pure function in `src/prereqs/parse.ts`, following the pattern of every prior
phase's parser (Phase 1's `parse-body.ts`, Phase 5's `parse-csv.ts`): no I/O, no
database, no network, unit-tested against fixtures drawn from real rows.

```ts
export function parseRequirements(text: string | null): Requirement | null;
```

Returns `null` for null/empty input (the course simply has no such requirement).
Otherwise returns a top-level `and` whose items are the parsed clauses - because
UBC's convention is that separate sentences in a requirement are jointly
required.

### 4.1 Pre-processing: drop `Equivalency:` clauses

An `Equivalency:` clause (139 rows) states which course this one is
credit-excluded against. It is **not a requirement**, and asserting it as one
would be actively wrong rather than merely imprecise. These clauses are stripped
before any parsing.

### 4.2 Clause splitting

Split on `.` and `;`. Each resulting clause is parsed independently and becomes
one item under the top-level `and`.

### 4.3 Per-clause rules, first match wins

1. **Bail-out signal words** - a clause containing any of
   `standing|permission|restrict|credit|average|score|instructor|major|program|enrol|department|faculty|recommend`
   becomes a `note` leaf immediately, with **no boolean parsing attempted**.

   This is deliberately conservative. *"A score of 72% or higher in two of VISA
   110, VISA 180, VISA 183"* contains three course codes, but the real
   requirement is two-of-three **with a grade floor**; emitting a plain `or`
   would materially understate it. Refusing to assert structure is the honest
   outcome.

2. **Ambiguity guard** - a clause that survived rule 1 but contains a
   boolean/grouping token the rules below do not positively handle
   (`either`, standalone `or`, `any`, lettered alternatives like `(a)`/`(b)`)
   becomes a `note` leaf.

   This exists because of real rows like NURS 323's *"Either (a) all of NURS_V
   345, NURS_V 365 or (b) all of NURS_V 346, NURS_V 366…"*. Without this guard,
   rule 7's bare-list handling would flatten it into an `and` of all eight
   courses - claiming a student must take every one, when in truth they need one
   pair. **A wrong requirement is worse than an unparsed one**, because a
   student could plan a whole term around it.

3. **`One of A, B, C`** (separated by `,` or `/`) → `or` of `course` nodes.

4. **`All of A, B, C`** → `and` of `course` nodes.

5. **Mixed groups** - `A and one of B, C`, `one of A, B and one of C, D` →
   `and` of sub-groups, splitting on an `and` that sits outside any comma list.

6. **A single course code alone** → a bare `course` node.

7. **A bare comma-separated course list with no connector** → `and`. UBC's
   convention is that an unqualified list means all are required (e.g. *"COMM_V
   293, COMM_V 298 and COMM_V 370."*). Reachable only after rule 2 has cleared
   the clause of ambiguity markers.

8. **No recognizable course-code token at all** → `note` leaf. Catches pure
   prose ("Permission of instructor is required") that the signal-word list
   might miss.

### 4.4 Course code extraction

Regex: `[A-Z]{2,5}(_[A-Z])?\s?\d{3}[A-Z]?` - subject code, optional `_V`/`_O`
campus suffix, three-digit number, optional trailing letter (`405Y`, `201A`).

This step produces **code strings only**. Resolving them to real `Course.id`
values is not this function's job, which keeps it pure and testable against
plain string fixtures with no database.

---

## 5. Building the trees

`src/prereqs/jobs/build.ts`, run via `npm run enrich:prereqs`.

**No network calls.** Unlike every prior ingest phase, the source text already
sits in our own database from Phase 1's `descriptions` scrape. This job is a
pure local transform: read `prereqText`/`coreqText`, parse, resolve, write back.

### 5.1 Resolution

For each `course` node, strip the `_V`/`_O` suffix and look up
`Subject.code` + `Course.number`, filtered to `campus: 'V'` - matching the
Vancouver-only scope Phase 5 established.

### 5.2 Unresolvable codes still render

A code that resolves gets its `courseId`; one that does not gets `courseId:
null` and renders as plain, non-clickable text **in place**. Okanagan-only
courses (`_O`), discontinued numbers, and calendar typos all land here.

This is the same posture as Phase 5's unmatched professors: show what the source
says, do not silently drop it, do not overclaim a link we cannot verify. The job
reports a count of unresolved codes so the gap is visible rather than invisible.

### 5.3 Idempotency

Trees are overwritten wholesale on each run - no upsert key, no accumulation, so
re-running is trivially safe. It should be re-run after any
`scrape:descriptions`, and `scrape:all` is extended to chain it.

---

## 6. Display

`src/components/RequirementTree.tsx` - a recursive server component. Nested
`<ul>` elements with `One of:` / `All of:` group labels, course nodes rendered as
links to `/course/[code]` using the same slug convention the page already uses
for instructor links. No new dependency, consistent with Phase 5's hand-rolled
chart and Phase 4's dependency-free ICS generation.

### 6.1 Depth

The tree renders **one course's own requirement**, at whatever AND/OR depth that
requirement actually has (typically one or two levels). It does **not** recurse
into a linked course's own prerequisites - clicking through does that, exactly
as normal browsing already works.

Recursive expansion was considered and declined: it needs cycle-safety, produces
very large trees for upper-year courses, and buys little for a student who is
looking at one course at a time. The data model supports adding it later.

### 6.2 The original text always stays visible

Beneath every rendered tree, the source sentence remains, in muted text, labelled
as published in the calendar - **even when the tree parses perfectly**. The
parser is an interpretation; the calendar is the authority, and it stays one
glance away rather than buried behind our reading of it.

### 6.3 Empty state

A course with no `prereqText`/`coreqText` omits the section entirely - no
placeholder. This matches how `credits` and `description` already behave when
absent. Unlike Phase 5's suppressed buckets, an absent prerequisite is a
structural non-applicability, not a data-coverage gap worth labelling.

---

## 7. Architecture

Continues the established monolith. No new services, no new dependencies.

```
prisma/schema.prisma                - Course gains prereqTree / coreqTree
src/prereqs/parse.ts                - PURE: text -> Requirement
src/prereqs/jobs/build.ts           - resolve codes -> ids, write trees
src/prereqs/jobs/build.run.ts       - CLI entrypoint (matches the *.run.ts pattern)
src/components/RequirementTree.tsx  - recursive renderer
src/app/course/[code]/page.tsx      - MODIFY: render trees + source text
package.json                        - enrich:prereqs script, chained into scrape:all
```

---

## 8. Correctness requirements

| Area | Requirement |
|---|---|
| Never overclaim | Any clause not positively matched by a rule becomes a verbatim `note`. Ambiguous grouping (`either`, `(a)/(b)`, stray `or`) is never flattened into `and`. |
| Equivalency | `Equivalency:` clauses are stripped, never rendered as requirements. |
| Grade-qualified lists | A list gated on a score/average (e.g. "72% in two of…") is a `note`, never a plain `or`. |
| Purity | `parse.ts` performs no I/O and is tested against fixtures only. |
| Unresolved codes | Still rendered, as plain text, and counted in the job's report. |
| Source text | The original sentence is always displayed alongside the tree. |
| Idempotency | Re-running the build job produces the same trees; no duplication. |
| No new dependencies | Parser and renderer are both hand-rolled. |

---

## 9. Testing

Fixtures are taken verbatim from the real rows sampled in §2.1 - the parser is
tested against the text it will actually meet, not invented examples.

**`tests/parse-prereqs.test.ts`** (pure, no DB), one case per rule:
clean `One of` → OR; clean `All of` → AND; mixed `A and one of B, C`; bail-out on
each signal-word family; the NURS 323 lettered-alternative guard; `Equivalency:`
stripping; bare single course; bare list without connector; slash-separated
alternatives; null/empty input.

**`tests/prereqs-build.test.ts`** (integration, real dev DB, matching Phase 5's
`grades-ingest.test.ts` pattern): resolution of a known-good code to a real
`courseId`; an `_O` Okanagan code resolving to `null` while still appearing in
the tree; idempotency across two consecutive runs.

---

## 10. Out of scope

- **Recursive multi-level expansion** and **graph/node-edge visualization** -
  both considered and declined (§6.1); the data model supports either later.
- **"Am I eligible?" checking** against the user's Workday-imported transcript.
  Tempting, since Phase 2 has the completed-course data, but eligibility depends
  on the unparseable third (standing, program, GPA) and a confident wrong answer
  about a student's eligibility is the worst failure this app could produce.
- **LLM-assisted parsing** of the messy third (§2.2).
- **Corequisite-specific semantics** - coreqs are parsed and displayed with the
  same machinery as prereqs; the distinction between "before" and "alongside" is
  carried by the label only.
- UBC Okanagan courses as tree *targets* (they parse and display, but never
  resolve to a link - the app is Vancouver-only).
