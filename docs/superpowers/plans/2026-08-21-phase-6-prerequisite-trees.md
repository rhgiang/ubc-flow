# UBC Flow Phase 6: Prerequisite Trees — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student opens a course and sees its prerequisites and corequisites as a structured, linked requirement tree — with the original calendar sentence always shown alongside, and anything unparseable left as verbatim text rather than guessed at.

**Architecture:** Continues the Next.js + Prisma monolith. Parsing is a **pure function** (no I/O), matching every prior phase. The build job is a local DB-to-DB transform with **no network calls** — the source text is already in our database from Phase 1. The renderer is a hand-rolled recursive server component.

**Tech Stack:** Next.js 16, TypeScript, Prisma 7, Postgres, Tailwind, Vitest. **No new dependencies.**

**Spec:** [`docs/superpowers/specs/2026-08-21-phase-6-prerequisite-trees-design.md`](../specs/2026-08-21-phase-6-prerequisite-trees-design.md)

## Global Constraints

- **Node.js 20+**, npm. No bun, no pnpm.
- **Never overclaim.** Any clause not positively matched by a rule becomes a verbatim `note` leaf. Ambiguous grouping (`either`, `(a)`/`(b)`, a standalone `or`) is NEVER flattened into an `and`. A wrong requirement is worse than an unparsed one.
- **The ambiguity guard runs BEFORE the `One of` / `All of` rules.** Real row `KIN 211` reads `"All of (a) KIN_V 110 or HES_O 120 and (b) KIN_V 131 or HES_O 101 or BIOL_O 131."` — it starts with `All of` but is not a plain AND. Rule order is load-bearing, not stylistic.
- **`Equivalency:` clauses are stripped**, never rendered as requirements. They are credit exclusions, not prerequisites.
- **`_O` (Okanagan) codes never resolve to a link.** They display as text. Stripping the suffix and resolving against `campus: 'V'` would attach the wrong course.
- **Purity:** `src/prereqs/parse.ts` performs no I/O — no `fetch`, no `prisma`, no `@/lib/db`, no `readFile`.
- **The original calendar text is always displayed** alongside the tree, even when parsing is perfectly clean.
- **Idempotent:** re-running the build job produces identical trees.
- Tests live in `tests/**/*.test.ts`.
- No new dependencies. Parser and renderer are both hand-rolled.

---

## Verified data facts

All confirmed by querying the live dev database on 2026-08-21 — build against these, not assumptions.

| Fact | Value |
|---|---|
| UBCV courses with `prereqText` | 2,250 |
| UBCV courses with `coreqText` | 234 |
| `prereqText` rows containing `Equivalency:` | 139 |
| `ECON 101`, `ECON 102` exist in the catalogue (resolution test targets) | yes |

**Real rows used as fixtures** (verbatim, copy exactly):

```
CHEM 121  :: One of CHEM_V 12, CHEM_V 100. Equivalency: CHEM_V 141
POLI 482  :: All of POLI_V 310, POLI_V 380, POLI_V 381.
FNH 325   :: FNH 200.
MINE 590Q :: Permission of instructor is required.
KIN 211   :: All of (a) KIN_V 110 or HES_O 120 and (b) KIN_V 131 or HES_O 101 or BIOL_O 131.
CPSC 314  :: CPSC_V 221 and one of MATH_V 200, MATH_V 217, MATH_V 226, MATH_V 253, MATH_O 200 and one of MATH_V 152, MATH_V 221, MATH_V 223, MATH_O 222.
COMM 294  :: One of COEC_V 293, COMM_V 293, MGMT_O 301. Equivalency: COEC_V 294, MGMT_O 202.
COMM 459  :: COMM_V 293, COMM_V 298 and COMM_V 370.
FRST 305  :: One of FRST 201, NRES 201 and one of FRST 350, FRST 351, UFOR 400.
MDIA 490  :: MDIA_V 350. Restricted to BMS students with 4th year standing.
VISA 250  :: A score of 72% or higher in two of VISA 110, VISA 180, VISA 183.
SCIE 300 (coreq) :: One of BIOL_V 300, STAT_V 200, STAT_V 241 and 3rd or 4th year standing in Combined Major in Science.
```

**Existing code this plan touches:**

`src/app/course/[code]/page.tsx` currently renders prereqs as flat text, and does **not** render coreqs at all:

```tsx
      {course.prereqText && (
        <p className="mt-4 text-sm text-slate-600">
          <span className="font-medium">Prerequisites: </span>
          {course.prereqText}
        </p>
      )}
```

`package.json` scripts currently end with:

```json
    "scrape:all": "npm run scrape:catalog && npm run scrape:sections && npm run scrape:descriptions",
    "ingest:grades": "tsx src/grades/jobs/ingest.run.ts"
```

`prisma/schema.prisma`'s `Course` model currently has `prereqText String?` and `coreqText String?` at lines 33-34.

**Prisma 7 migration procedure in this environment** (established Phase 2, used every phase since — `prisma migrate dev` hard-blocks outside a TTY here):

```bash
npx prisma migrate diff --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --script
# inspect the SQL, hand-place it at prisma/migrations/<timestamp>_<name>/migration.sql
npx prisma migrate deploy
npx prisma generate
npx prisma migrate status   # must report no drift
```

---

## Task 1: Pure requirement parser

**Files:**
- Create: `src/prereqs/parse.ts`
- Test: `tests/parse-prereqs.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no imports from this project)
- Produces:
  - `type Requirement`
  - `parseRequirements(text: string | null): Requirement | null`

This is the correctness heart of the phase. Rule ORDER is load-bearing (see Global Constraints).

- [ ] **Step 1: Write the failing tests**

Create `tests/parse-prereqs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseRequirements, type Requirement } from '@/prereqs/parse';

/** Collect every course code in a tree, for terse assertions. */
function codes(node: Requirement | null): string[] {
  if (!node) return [];
  if (node.type === 'course') return [node.code];
  if (node.type === 'note') return [];
  return node.items.flatMap(codes);
}

describe('parseRequirements', () => {
  it('returns null for empty input', () => {
    expect(parseRequirements(null)).toBeNull();
    expect(parseRequirements('')).toBeNull();
    expect(parseRequirements('   ')).toBeNull();
  });

  it('parses "One of" as an OR', () => {
    // Real row: the first half of FRST 305's requirement.
    const r = parseRequirements('One of FRST 201, NRES 201.')!;
    expect(r.type).toBe('or');
    expect(codes(r)).toEqual(['FRST 201', 'NRES 201']);
  });

  it('parses "All of" as an AND', () => {
    // Real row: POLI 482.
    const r = parseRequirements('All of POLI_V 310, POLI_V 380, POLI_V 381.')!;
    expect(r.type).toBe('and');
    expect(codes(r)).toEqual(['POLI 310', 'POLI 380', 'POLI 381']);
  });

  it('strips the _V campus suffix from displayed codes', () => {
    const r = parseRequirements('FNH 200.')!;
    expect(r).toEqual({ type: 'course', code: 'FNH 200', courseId: null });
  });

  it('keeps the _O campus suffix, since it is a different campus', () => {
    // Must stay distinguishable: resolving MGMT_O 301 against Vancouver would
    // attach the wrong course entirely.
    const r = parseRequirements('One of COMM_V 293, MGMT_O 301.')!;
    expect(codes(r)).toEqual(['COMM 293', 'MGMT_O 301']);
  });

  it('parses a single bare course code', () => {
    // Real row: FNH 325.
    const r = parseRequirements('FNH 200.')!;
    expect(r.type).toBe('course');
  });

  it('treats a bare comma list with a trailing "and" as an AND', () => {
    // Real row: COMM 459. UBC convention: an unqualified list means all required.
    const r = parseRequirements('COMM_V 293, COMM_V 298 and COMM_V 370.')!;
    expect(r.type).toBe('and');
    expect(codes(r)).toEqual(['COMM 293', 'COMM 298', 'COMM 370']);
  });

  it('parses an AND of two OR groups', () => {
    // Real row: FRST 305.
    const r = parseRequirements(
      'One of FRST 201, NRES 201 and one of FRST 350, FRST 351, UFOR 400.',
    )!;
    expect(r.type).toBe('and');
    expect(r.type === 'and' && r.items.map((i) => i.type)).toEqual(['or', 'or']);
    expect(codes(r)).toEqual([
      'FRST 201', 'NRES 201', 'FRST 350', 'FRST 351', 'UFOR 400',
    ]);
  });

  it('parses a course AND-ed with OR groups', () => {
    // Real row: CPSC 314.
    const r = parseRequirements(
      'CPSC_V 221 and one of MATH_V 200, MATH_V 217, MATH_V 226, MATH_V 253, MATH_O 200 and one of MATH_V 152, MATH_V 221, MATH_V 223, MATH_O 222.',
    )!;
    expect(r.type).toBe('and');
    expect(r.type === 'and' && r.items.map((i) => i.type)).toEqual([
      'course', 'or', 'or',
    ]);
    expect(codes(r)[0]).toBe('CPSC 221');
  });

  it('strips Equivalency clauses instead of treating them as requirements', () => {
    // Real row: CHEM 121. CHEM 141 is a credit exclusion, NOT a prerequisite.
    const r = parseRequirements('One of CHEM_V 12, CHEM_V 100. Equivalency: CHEM_V 141')!;
    expect(codes(r)).toEqual(['CHEM 12', 'CHEM 100']);
    expect(codes(r)).not.toContain('CHEM 141');
  });

  it('strips Equivalency clauses that list several codes', () => {
    // Real row: COMM 294.
    const r = parseRequirements(
      'One of COEC_V 293, COMM_V 293, MGMT_O 301. Equivalency: COEC_V 294, MGMT_O 202.',
    )!;
    expect(codes(r)).toEqual(['COEC 293', 'COMM 293', 'MGMT_O 301']);
    expect(codes(r)).not.toContain('COEC 294');
  });

  it('bails out to a note on permission language', () => {
    // Real row: MINE 590Q.
    const r = parseRequirements('Permission of instructor is required.')!;
    expect(r).toEqual({ type: 'note', text: 'Permission of instructor is required' });
  });

  it('bails out to a note on a grade-qualified list, never a plain OR', () => {
    // Real row: VISA 250. The real requirement is TWO of three WITH a grade
    // floor; emitting an OR would say "any one of three" — materially wrong.
    const r = parseRequirements(
      'A score of 72% or higher in two of VISA 110, VISA 180, VISA 183.',
    )!;
    expect(r.type).toBe('note');
  });

  it('bails out to a note on lettered alternatives, even after "All of"', () => {
    // Real row: KIN 211. Starts with "All of" but is really one-of-each-group.
    // Flattening this to an AND would tell a student to take all five courses.
    const r = parseRequirements(
      'All of (a) KIN_V 110 or HES_O 120 and (b) KIN_V 131 or HES_O 101 or BIOL_O 131.',
    )!;
    expect(r.type).toBe('note');
  });

  it('bails out to a note on a standalone "or" it cannot group', () => {
    const r = parseRequirements('CPSC_V 110 or CPSC_V 103.')!;
    expect(r.type).toBe('note');
  });

  it('keeps a parseable clause and notes an unparseable one from the same text', () => {
    // Real row: MDIA 490 — a real requirement plus a program restriction.
    const r = parseRequirements(
      'MDIA_V 350. Restricted to BMS students with 4th year standing.',
    )!;
    expect(r.type).toBe('and');
    expect(r.type === 'and' && r.items.map((i) => i.type)).toEqual(['course', 'note']);
    expect(codes(r)).toEqual(['MDIA 350']);
  });

  it('notes prose that mentions no course code at all', () => {
    const r = parseRequirements('Fourth-year standing.')!;
    expect(r.type).toBe('note');
  });

  it('parses corequisite text with the same machinery', () => {
    // Real coreq row: SCIE 300 — an OR group plus a standing clause.
    const r = parseRequirements(
      'One of BIOL_V 300, STAT_V 200, STAT_V 241 and 3rd or 4th year standing in Combined Major in Science.',
    )!;
    // The whole clause carries "standing", so it bails wholesale rather than
    // half-parsing a requirement whose real gate we cannot express.
    expect(r.type).toBe('note');
  });

  it('never emits an empty group', () => {
    const r = parseRequirements('One of FRST 201, NRES 201 and one of FRST 350, FRST 351.')!;
    const walk = (n: Requirement): void => {
      if (n.type === 'and' || n.type === 'or') {
        expect(n.items.length).toBeGreaterThan(1);
        n.items.forEach(walk);
      }
    };
    walk(r);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- parse-prereqs`
Expected: FAIL — cannot find module `@/prereqs/parse`.

- [ ] **Step 3: Write the implementation**

Create `src/prereqs/parse.ts`:

```ts
export type Requirement =
  | { type: 'course'; code: string; courseId: string | null }
  | { type: 'and'; items: Requirement[] }
  | { type: 'or'; items: Requirement[] }
  | { type: 'note'; text: string };

/** SUBJ[_CAMPUS] NNN[letter] — e.g. CPSC 221, CHEM_V 121, MATH_O 200, FNEL 201A. */
const COURSE_CODE = /\b[A-Z]{2,5}(?:_[A-Z])?\s?\d{2,3}[A-Z]?\b/g;

/**
 * Eligibility language. A clause containing any of this is NOT a course
 * dependency — it is standing, permission, a grade floor, or a program
 * restriction. Parse nothing from it; keep the sentence verbatim.
 */
const BAILOUT =
  /\b(standing|permission|restrict\w*|credits?|average|score|instructor|majors?|programs?|enrol\w*|department|faculty|recommend\w*)\b/i;

/**
 * Grouping we do not positively handle: lettered alternatives, "either", and a
 * standalone "or". Checked BEFORE the One of/All of rules, because real rows
 * like KIN 211 open with "All of" and then use (a)/(b) alternatives — reading
 * that as a flat AND would tell a student to take every listed course.
 */
const AMBIGUOUS = /\([a-z]\)|\beither\b|\bany\b|\bor\b/i;

function stripEquivalency(text: string): string {
  // "Equivalency: CHEM_V 141" is a credit exclusion, not a requirement.
  return text.replace(/\bEquivalenc(?:y|ies)\s*:[^.]*\.?/gi, ' ');
}

function toCourseNode(raw: string): Requirement {
  const m = raw.match(/^([A-Z]{2,5})(?:_([A-Z]))?\s?(\d{2,3}[A-Z]?)$/);
  if (!m) return { type: 'course', code: raw, courseId: null };
  const [, subject, campus, number] = m;
  // Vancouver is this app's default and its suffix is noise; Okanagan must stay
  // visible, since it is a different campus and never resolves to a link.
  const code = campus === 'O' ? `${subject}_O ${number}` : `${subject} ${number}`;
  return { type: 'course', code, courseId: null };
}

function extractCodes(text: string): string[] {
  return [...text.matchAll(COURSE_CODE)].map((m) => m[0]);
}

/** Collapse a group into its single child, and merge same-type nesting. */
function flatten(node: Requirement): Requirement {
  if (node.type !== 'and' && node.type !== 'or') return node;
  const items: Requirement[] = [];
  for (const item of node.items) {
    const f = flatten(item);
    if (f.type === node.type) items.push(...f.items);
    else items.push(f);
  }
  return items.length === 1 ? items[0] : { ...node, items };
}

/** One segment: "one of A, B" -> OR; "A, B" -> AND; "A" -> the course itself. */
function parseGroup(segment: string): Requirement | null {
  const text = segment.trim().replace(/^[,;\s]+|[,;.\s]+$/g, '');
  if (!text) return null;

  const codes = extractCodes(text);
  if (codes.length === 0) return null;

  const nodes = codes.map(toCourseNode);
  if (nodes.length === 1) return nodes[0];

  const isOr = /\bone of\b/i.test(text);
  return { type: isOr ? 'or' : 'and', items: nodes };
}

function parseClause(clause: string): Requirement | null {
  const text = clause.trim().replace(/[.\s]+$/, '');
  if (!text) return null;

  // Order matters — see AMBIGUOUS above.
  if (BAILOUT.test(text) || AMBIGUOUS.test(text)) return { type: 'note', text };
  if (extractCodes(text).length === 0) return { type: 'note', text };

  const groups = splitOnAnd(text)
    .map(parseGroup)
    .filter((g): g is Requirement => g !== null);

  if (groups.length === 0) return { type: 'note', text };
  return flatten(groups.length === 1 ? groups[0] : { type: 'and', items: groups });
}

function splitOnAnd(text: string): string[] {
  return text.split(/\s+and\s+/i);
}

export function parseRequirements(text: string | null): Requirement | null {
  if (!text || !text.trim()) return null;

  const clauses = stripEquivalency(text)
    .split(/[.;]/)
    .map((c) => c.trim())
    .filter(Boolean);

  const items = clauses
    .map(parseClause)
    .filter((r): r is Requirement => r !== null);

  if (items.length === 0) return null;
  return flatten(items.length === 1 ? items[0] : { type: 'and', items });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- parse-prereqs`
Expected: PASS, 19 tests.

Then confirm purity — this must print nothing:

```bash
grep -nE "fetch|prisma|@/lib/db|readFile|require\(" src/prereqs/parse.ts
```

Then the full suite and typecheck:

```bash
npm test          # 217 existing + 19 new = 236 passing
npx tsc --noEmit  # clean
```

- [ ] **Step 5: Commit**

```bash
git add src/prereqs/parse.ts tests/parse-prereqs.test.ts
git commit -m "feat: parse UBC prerequisite prose into AND/OR requirement trees"
```

---

## Task 2: Schema

**Files:**
- Modify: `prisma/schema.prisma` (the `Course` model, lines 24-40)
- Create: `prisma/migrations/<timestamp>_add_requirement_trees/migration.sql`

**Interfaces:**
- Produces: `Course.prereqTree`, `Course.coreqTree` (both `Json?`)

Both columns are **nullable additions** — no existing row changes, no backfill, no data risk.

- [ ] **Step 1: Add the columns**

In `prisma/schema.prisma`, in the `Course` model, immediately after the existing
`coreqText  String?` line, add:

```prisma
  /** Requirement tree parsed from prereqText — see src/prereqs/parse.ts. */
  prereqTree  Json?
  /** Requirement tree parsed from coreqText — same shape as prereqTree. */
  coreqTree   Json?
```

- [ ] **Step 2: Generate and hand-place the migration**

```bash
npx prisma migrate diff --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --script
```

Expected SQL (verify before placing — it must be exactly two nullable `ADD COLUMN`
statements and touch nothing else):

```sql
ALTER TABLE "Course" ADD COLUMN "prereqTree" JSONB;
ALTER TABLE "Course" ADD COLUMN "coreqTree" JSONB;
```

Write it to `prisma/migrations/<timestamp>_add_requirement_trees/migration.sql`,
using a timestamp later than the most recent existing migration directory.

- [ ] **Step 3: Apply and verify**

```bash
npx prisma migrate deploy
npx prisma generate
npx prisma migrate status     # must say the schema is up to date, no drift
```

Confirm the columns exist and that nothing else moved:

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c '\d "Course"'
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select count(*) courses, count(\"prereqText\") with_prereq_text, count(\"prereqTree\") with_tree from \"Course\";"
```

Expected: `prereqTree`/`coreqTree` present and nullable; `courses` = 7337 and
`with_prereq_text` unchanged (2250 for UBCV plus any UBCO rows); `with_tree` = 0.

- [ ] **Step 4: Verify the suite still passes**

```bash
npm test          # still 236 passing — this task adds no tests
npx tsc --noEmit  # clean
```

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add prereqTree and coreqTree columns to Course"
```

---

## Task 3: Build job

**Files:**
- Create: `src/prereqs/jobs/build.ts`, `src/prereqs/jobs/build.run.ts`
- Test: `tests/prereqs-build.test.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `parseRequirements`, `type Requirement` (Task 1); `Course.prereqTree`/`coreqTree` (Task 2); `db`
- Produces:
  - `resolveTree(tree: Requirement | null): Promise<Requirement | null>`
  - `buildRequirementTrees(): Promise<BuildResult>`
  - `type BuildResult = { updated: number; resolved: number; unresolved: string[] }`
  - `npm run enrich:prereqs`

**No network calls.** The source text is already in our database from Phase 1.

- [ ] **Step 1: Write the failing tests**

Create `tests/prereqs-build.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { resolveTree } from '@/prereqs/jobs/build';
import { parseRequirements } from '@/prereqs/parse';

afterAll(async () => {
  await db.$disconnect();
});

describe('resolveTree', () => {
  it('returns null for a null tree', async () => {
    expect(await resolveTree(null)).toBeNull();
  });

  it('resolves a real Vancouver course code to its id', async () => {
    const tree = await resolveTree(parseRequirements('ECON 101.'));
    expect(tree).not.toBeNull();
    expect(tree!.type).toBe('course');
    if (tree!.type === 'course') {
      expect(tree!.code).toBe('ECON 101');
      const course = await db.course.findUniqueOrThrow({
        where: { id: tree!.courseId! },
        include: { subject: true },
      });
      expect(course.subject.code).toBe('ECON');
      expect(course.number).toBe('101');
    }
  });

  it('leaves an Okanagan code unresolved but still present', async () => {
    // Stripping _O and resolving against Vancouver would attach a different
    // course entirely — the code must display as text with no link.
    const tree = await resolveTree(parseRequirements('One of ECON_V 101, MGMT_O 301.'));
    expect(tree!.type).toBe('or');
    if (tree!.type === 'or') {
      const okanagan = tree!.items.find(
        (i) => i.type === 'course' && i.code === 'MGMT_O 301',
      );
      expect(okanagan).toBeDefined();
      expect(okanagan!.type === 'course' && okanagan!.courseId).toBeNull();
    }
  });

  it('leaves a code that is not in our catalogue unresolved', async () => {
    const tree = await resolveTree(parseRequirements('ZZZZ 999.'));
    expect(tree!.type === 'course' && tree!.courseId).toBeNull();
  });

  it('resolves codes nested inside groups', async () => {
    const tree = await resolveTree(parseRequirements('All of ECON_V 101, ECON_V 102.'));
    expect(tree!.type).toBe('and');
    if (tree!.type === 'and') {
      for (const item of tree!.items) {
        expect(item.type === 'course' && item.courseId).toBeTruthy();
      }
    }
  });

  it('passes note leaves through untouched', async () => {
    const tree = await resolveTree(parseRequirements('Permission of instructor is required.'));
    expect(tree).toEqual({ type: 'note', text: 'Permission of instructor is required' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- prereqs-build`
Expected: FAIL — cannot find module `@/prereqs/jobs/build`.

- [ ] **Step 3: Write the implementation**

Create `src/prereqs/jobs/build.ts`:

```ts
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { parseRequirements, type Requirement } from '@/prereqs/parse';

export type BuildResult = {
  updated: number;
  resolved: number;
  unresolved: string[];
};

/** "ECON 101" -> { subject: 'ECON', number: '101' }; "MGMT_O 301" -> null. */
function vancouverCode(code: string): { subject: string; number: string } | null {
  // An _O code is Okanagan. Resolving it against campus 'V' would attach a
  // different course entirely, so it deliberately never resolves.
  const m = code.match(/^([A-Z]{2,5})\s(\d{2,3}[A-Z]?)$/);
  return m ? { subject: m[1], number: m[2] } : null;
}

/**
 * Walks a parsed tree and fills in courseId for every code we can match.
 * Unmatched codes keep courseId: null and still render — as plain text.
 */
export async function resolveTree(
  tree: Requirement | null,
  unresolved?: Set<string>,
): Promise<Requirement | null> {
  if (!tree) return null;

  if (tree.type === 'note') return tree;

  if (tree.type === 'course') {
    const parts = vancouverCode(tree.code);
    if (!parts) {
      unresolved?.add(tree.code);
      return tree;
    }
    const course = await db.course.findFirst({
      where: {
        number: parts.number,
        campus: 'V',
        subject: { code: parts.subject },
      },
      select: { id: true },
    });
    if (!course) unresolved?.add(tree.code);
    return { ...tree, courseId: course?.id ?? null };
  }

  const items: Requirement[] = [];
  for (const item of tree.items) {
    const resolved = await resolveTree(item, unresolved);
    if (resolved) items.push(resolved);
  }
  return { ...tree, items };
}

function countResolved(tree: Requirement | null): number {
  if (!tree) return 0;
  if (tree.type === 'course') return tree.courseId ? 1 : 0;
  if (tree.type === 'note') return 0;
  return tree.items.reduce((n, i) => n + countResolved(i), 0);
}

export async function buildRequirementTrees(): Promise<BuildResult> {
  const courses = await db.course.findMany({
    where: {
      OR: [{ prereqText: { not: null } }, { coreqText: { not: null } }],
    },
    select: { id: true, prereqText: true, coreqText: true },
  });

  const unresolved = new Set<string>();
  let updated = 0;
  let resolved = 0;

  for (const course of courses) {
    const prereqTree = await resolveTree(parseRequirements(course.prereqText), unresolved);
    const coreqTree = await resolveTree(parseRequirements(course.coreqText), unresolved);

    await db.course.update({
      where: { id: course.id },
      // Overwritten wholesale every run — no accumulation, trivially idempotent.
      // Prisma.DbNull, not undefined: undefined means "skip this field", which
      // would leave a stale tree behind if the text stopped parsing.
      data: {
        prereqTree: prereqTree ?? Prisma.DbNull,
        coreqTree: coreqTree ?? Prisma.DbNull,
      },
    });

    resolved += countResolved(prereqTree) + countResolved(coreqTree);
    updated += 1;
  }

  console.log(
    `Built trees for ${updated} courses. ${resolved} course links resolved, ` +
      `${unresolved.size} distinct codes unresolved.`,
  );

  return { updated, resolved, unresolved: [...unresolved] };
}
```

Create `src/prereqs/jobs/build.run.ts` (matching the existing `*.run.ts` pattern
in `src/scrape/jobs/sections.run.ts`):

```ts
import { db } from '@/lib/db';
import { buildRequirementTrees } from '@/prereqs/jobs/build';

buildRequirementTrees()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
```

In `package.json`, add the `enrich:prereqs` script and chain it into
`scrape:all` (it must run after `scrape:descriptions`, which produces its input):

```json
    "scrape:descriptions": "tsx src/scrape/jobs/descriptions.run.ts",
    "enrich:prereqs": "tsx src/prereqs/jobs/build.run.ts",
    "scrape:all": "npm run scrape:catalog && npm run scrape:sections && npm run scrape:descriptions && npm run enrich:prereqs",
    "ingest:grades": "tsx src/grades/jobs/ingest.run.ts"
```

- [ ] **Step 4: Verify**

```bash
npm test -- prereqs-build   # PASS, 6 tests
npm test                    # 242 passing
npx tsc --noEmit            # clean
```

- [ ] **Step 5: Commit**

```bash
git add src/prereqs/jobs tests/prereqs-build.test.ts package.json
git commit -m "feat: build and resolve requirement trees from course text"
```

---

## Task 4: Display

**Files:**
- Create: `src/components/RequirementTree.tsx`
- Modify: `src/app/course/[code]/page.tsx`

**Interfaces:**
- Consumes: `type Requirement` (Task 1), `Course.prereqTree`/`coreqTree` (Task 2)

- [ ] **Step 1: Build the renderer**

Create `src/components/RequirementTree.tsx`:

```tsx
import Link from 'next/link';
import type { Requirement } from '@/prereqs/parse';

/** "CPSC 221" -> "cpsc-221", matching the course page's own slug convention. */
function href(code: string): string {
  return `/course/${code.toLowerCase().replace(/\s+/g, '-')}`;
}

export default function RequirementTree({ node }: { node: Requirement }) {
  if (node.type === 'course') {
    // An unresolved code still shows — we just cannot link it (spec 5.2).
    return node.courseId ? (
      <Link href={href(node.code)} className="text-blue-700 hover:underline">
        {node.code}
      </Link>
    ) : (
      <span className="text-slate-700">{node.code}</span>
    );
  }

  if (node.type === 'note') {
    return <span className="text-slate-600">{node.text}</span>;
  }

  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {node.type === 'or' ? 'One of' : 'All of'}
      </p>
      <ul className="mt-1 space-y-1 border-l pl-4">
        {node.items.map((item, i) => (
          <li key={i}>
            <RequirementTree node={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Render it on the course page**

In `src/app/course/[code]/page.tsx`, add the import alongside the existing ones:

```ts
import RequirementTree from '@/components/RequirementTree';
import type { Requirement } from '@/prereqs/parse';
```

Replace the existing prereq block:

```tsx
      {course.prereqText && (
        <p className="mt-4 text-sm text-slate-600">
          <span className="font-medium">Prerequisites: </span>
          {course.prereqText}
        </p>
      )}
```

with a block that renders both requirement kinds, tree first and source text
always beneath it (spec 6.2):

```tsx
      {(course.prereqText || course.coreqText) && (
        <div className="mt-6 space-y-4">
          {(
            [
              ['Prerequisites', course.prereqTree, course.prereqText],
              ['Corequisites', course.coreqTree, course.coreqText],
            ] as const
          ).map(([label, tree, text]) =>
            text ? (
              <div key={label} className="rounded-lg border p-4">
                <p className="text-sm font-medium">{label}</p>
                {tree && (
                  <div className="mt-2 text-sm">
                    <RequirementTree node={tree as unknown as Requirement} />
                  </div>
                )}
                {/* The calendar is the authority; our parse is an
                    interpretation, so the original stays one glance away. */}
                <p className="mt-3 text-xs text-slate-500">
                  As published in the calendar: {text}
                </p>
              </div>
            ) : null,
          )}
        </div>
      )}
```

- [ ] **Step 3: Verify live**

The trees are not built yet (Task 5 runs the job), so first build a few by hand
to have something to look at:

```bash
npx tsx -e "
import { db } from './src/lib/db';
import { parseRequirements } from './src/prereqs/parse';
import { resolveTree } from './src/prereqs/jobs/build';
(async () => {
  for (const [code, number] of [['CPSC','314'],['POLI','482'],['KIN','211'],['FNH','325']]) {
    const c = await db.course.findFirstOrThrow({ where: { number, campus: 'V', subject: { code } }, select: { id: true, prereqText: true, coreqText: true } });
    await db.course.update({ where: { id: c.id }, data: {
      prereqTree: (await resolveTree(parseRequirements(c.prereqText))) ?? undefined,
      coreqTree: (await resolveTree(parseRequirements(c.coreqText))) ?? undefined,
    }});
    console.log('built', code, number);
  }
  await db.\$disconnect();
})();
"
```

Start the dev server and check each:

1. `/course/cpsc-314` — an AND containing a course and two `One of` groups; the
   course codes are clickable links.
2. `/course/poli-482` — a plain `All of` list.
3. `/course/kin-211` — the ambiguity guard case: renders as the verbatim
   sentence, NOT a list of five courses.
4. `/course/fnh-325` — a single linked course.
5. On all four: the "As published in the calendar:" line appears beneath the tree.
6. Any course with no prereq text at all (e.g. `/course/acam-310`) shows no
   requirements block whatsoever.

Stop the dev server.

- [ ] **Step 4: Full verification**

```bash
npm test          # 242 passing
npx tsc --noEmit  # clean
npx eslint .      # clean
npm run build     # clean
```

- [ ] **Step 5: Commit**

```bash
git add src/components/RequirementTree.tsx "src/app/course/[code]/page.tsx"
git commit -m "feat: render prerequisite and corequisite trees on course pages"
```

---

## Task 5: Full build run and verification

**Files:** none — this task runs the job and verifies the result.

Unlike Phase 5's ingest, this is a local DB transform with no rate limit and no
network: expect it to finish in **under two minutes**, not an hour.

- [ ] **Step 1: Record the before state**

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select count(*) courses, count(\"prereqText\") text_prereq, count(\"prereqTree\") tree_prereq, count(\"coreqTree\") tree_coreq from \"Course\";"
```

- [ ] **Step 2: Run it**

```bash
npm run enrich:prereqs
```

- [ ] **Step 3: Verify the result**

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select count(*) courses, count(\"prereqText\") text_prereq, count(\"prereqTree\") tree_prereq, count(\"coreqTree\") tree_coreq from \"Course\";"
```

Confirm: `tree_prereq` is close to `text_prereq` (a tree exists for essentially
every course that has text), `courses` is **unchanged at 7337** (this job must
never create courses), and `tree_coreq` is roughly 234.

Check the parse-quality split — how many trees are a bare note (unparseable)
versus real structure:

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select \"prereqTree\"->>'type' as kind, count(*) from \"Course\" where \"prereqTree\" is not null group by 1 order by 2 desc;"
```

Expect a healthy mix of `and`/`or`/`course` alongside `note`. If `note`
dominates overwhelmingly (say >70%), the parser is bailing too eagerly —
investigate before proceeding.

Spot-check that the guard cases really did stay verbatim:

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select s.code, c.number, c.\"prereqTree\"->>'type' from \"Course\" c join \"Subject\" s on s.id=c.\"subjectId\" where (s.code,c.number) in (('KIN','211'),('VISA','250'),('CPSC','314'),('POLI','482'));"
```

Expect `KIN 211` and `VISA 250` to be `note`; `CPSC 314` and `POLI 482` to be
`and`.

- [ ] **Step 4: Prove idempotency**

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -tAc \
  "select md5(string_agg(coalesce(\"prereqTree\"::text,''), '' order by id)) from \"Course\";"
npm run enrich:prereqs
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -tAc \
  "select md5(string_agg(coalesce(\"prereqTree\"::text,''), '' order by id)) from \"Course\";"
```

The two hashes must be identical.

- [ ] **Step 5: Confirm the pages work with full data**

Start the dev server, open course pages across several subjects (including at
least one with a clean tree, one that fell back to a note, and one with a
corequisite such as `/course/scie-300`), confirm links navigate correctly and
the calendar text always appears. Stop the server.

---

## Phase 6 completion criteria

- [ ] `npm test`, `npx tsc --noEmit`, `npx eslint .`, `npm run build` all clean
- [ ] No clause is ever flattened into an `and` when its grouping is ambiguous — `KIN 211` and `VISA 250` both render as verbatim notes
- [ ] `Equivalency:` codes never appear as requirements
- [ ] `_O` codes display but never link
- [ ] Unresolvable codes display as plain text and are counted by the job
- [ ] The original calendar sentence is visible on every course that has one
- [ ] Re-running `enrich:prereqs` produces byte-identical trees
- [ ] Courses with no requirement text render no requirements block at all
- [ ] No new dependencies in `package.json`
