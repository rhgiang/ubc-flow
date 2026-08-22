# UBC Flow: Course & Professor Page Redesign + Historical Grades — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Course and professor pages match UW Flow's real feature set (within our theme): a click-to-reveal ratings distribution, a collapsible current-year schedule, a full prerequisite/corequisite/antirequisite/leads-to sidebar, and a new historical-averages grade section sitting beside the existing distribution chart.

**Architecture:** Continues the Next.js + Prisma monolith. Aggregation stays pure functions (`src/reviews/aggregate.ts`, extended). The historical-grades ingest is a rate-limited job reusing the existing `fetchText`. The antireq/leads-to reverse index piggybacks on the tree-walk `enrich:prereqs` already performs — no new full-table scans.

**Tech Stack:** Next.js 16, TypeScript, Prisma 7, Postgres, Tailwind, Vitest. **No new dependencies** — donut/bar/popover UI is hand-rolled SVG/CSS, same discipline as every prior phase's charts.

**Spec:** [`docs/superpowers/specs/2026-08-22-course-professor-pages-design.md`](../specs/2026-08-22-course-professor-pages-design.md)

## Global Constraints

- **Node.js 20+**, npm. No bun, no pnpm.
- **Grade Distribution and Historical Averages are two separate sections, never merged into one chart.** Different bucket granularities (spec §3) make a merge misleading.
- **The ratings box's Useful/Easy percentages use `(mean − 1) / 4 × 100`** — a deliberate exception to this app's existing `X.X/5` convention (Explore table, current stat cards), which is NOT touched by this plan.
- **Antirequisites and course/coreq codes are resolved with the exact same campus rule already established**: `_O` (Okanagan) codes never resolve to a link; unresolved codes still display as plain text, never dropped.
- **The historical-grades ingest reuses `fetchText`** (`@/scrape/http`) — same 1 req/sec limiter as every other job. A 404 (course has no grade history) is normal, not an error — caught and skipped, same posture as every prior "not every X exists" job in this codebase.
- **`CoursePrereqEdge` is rebuilt wholesale on every `enrich:prereqs` run** (`deleteMany` then fresh inserts), matching the existing overwrite-not-accumulate idempotency rule `prereqTree`/`coreqTree` already follow.
- Pure functions (`src/reviews/aggregate.ts`, `src/prereqs/parse.ts`) do no I/O.
- Tests live in `tests/**/*.test.ts`.
- No new dependencies.

---

## Verified facts this plan is grounded in

**Current baseline:** `npm test` passes **254/254**. This plan's task-by-task counts build from that number — if a fix-loop round changes the running count, trust the ledger over this plan's numbers (established precedent from every prior phase).

**Real UBCGrades API responses** (fetched directly during spec research, still valid):
```
GET https://ubcgrades.com/api/v2/course-statistics/UBCV/CPSC/110
{"average":74.32815216682194,"average_past_5_yrs":74.93280888477317,"campus":"UBCV",
 "course":"110","course_title":"Computation, Programs, and Programming","detail":"",
 "faculty_title":"Faculty of Science","max_course_avg":91,"min_course_avg":64.06626506,
 "stdev":19.163549407185215,"subject":"CPSC","subject_title":"Computer Science"}

GET https://ubcgrades.com/api/v2/course-statistics/UBCV/ZZZZ/999
→ HTTP 404 (confirmed live — the "course has no data" case)
```

**Real Equivalency clauses** (from the live database, `Course.prereqText`):
```
FIPR 437  :: FIPR 337. Equivalency: FILM437
COMM 396  :: COMM 196. Equivalency: COMM_V 390
```
(`FILM437` has no space between subject and number — confirms the existing `COURSE_CODE` regex's `\s?` must stay optional, which it already is.)

**Existing code this plan builds on** (read in full before starting — do not re-derive from memory):
- `src/prereqs/parse.ts` — `Requirement` type, `COURSE_CODE`/`BAILOUT`/`AMBIGUOUS` regexes, `stripEquivalency`, `toCourseNode`, `extractCodes` (all currently unexported module-private helpers).
- `src/prereqs/jobs/build.ts` — `resolveTree`, `vancouverCode`, `buildRequirementTrees` (currently processes ALL courses unconditionally, per an earlier fix-loop ruling — do not reintroduce a `WHERE` filter).
- `src/reviews/aggregate.ts` — `aggregateCourseReviews`, `aggregateInstructorReviews`, `meanDisplay`, `likedPercent` (all shown in full below).
- `src/schedule/terms.ts` — `isUpcomingTerm(term)` already exists (added since Phase 6, **has no test coverage yet** — Task 1 adds it) — use this for "current and upcoming terms," not `isPlannableTerm` (that one is deliberately coarser, for the schedule planner).
- `src/scrape/http.ts` — `fetchText(url)`, throws on non-OK response, 1 req/sec.
- `src/components/RequirementTree.tsx` — reused as-is for prereq/coreq rendering inside the new sidebar.
- `src/components/GradeChart.tsx` — reused as-is; **not modified by this plan** (no bug was found in it during spec research — the "percentages peak outside the box" report traced to the ratings *stat cards*, not this chart; Task 5 replaces those cards with the new ratings box).

**Prisma 7 migration procedure in this environment** (`prisma migrate dev` hard-blocks outside a TTY here):
```bash
npx prisma migrate diff --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --script
# inspect the SQL, hand-place it at prisma/migrations/<timestamp>_<name>/migration.sql
npx prisma migrate deploy
npx prisma generate
npx prisma migrate status   # must report no drift
```
Latest existing migration directory: `20260821000000_add_requirement_trees` — this plan's migration timestamp must sort after it.

---

## Task 1: Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_grades_and_prereq_edges/migration.sql`
- Test: `tests/terms.test.ts` (add coverage for the pre-existing, currently-untested `isUpcomingTerm`)

**Interfaces:**
- Produces: `CourseHistoricalGrades`, `CoursePrereqEdge` models; `Course.antireqCodes Json?`

- [ ] **Step 1: Add the schema**

In `prisma/schema.prisma`, in the `Course` model, immediately after `coreqTree Json?`, add:

```prisma
  /** Resolved-or-not course refs from "Equivalency:" clauses — see
    * src/prereqs/parse.ts:extractAntireqCodes. Same array shape a flat
    * Requirement course list would use: {code, courseId}[]. */
  antireqCodes Json?
```

Add two new models (after `GradeDistributionInstructor`):

```prisma
model CourseHistoricalGrades {
  courseId          String   @id
  course            Course   @relation(fields: [courseId], references: [id], onDelete: Cascade)
  average           Float?
  averagePast5Years Float?
  minSectionAverage Float?
  maxSectionAverage Float?
  stddev            Float?
  updatedAt         DateTime @updatedAt
}

// Reverse index for "leads to": which courses require courseId as a
// prerequisite. Built during enrich:prereqs's existing tree-walk (Task 2),
// not computed by scanning prereqTree JSON at page-render time.
model CoursePrereqEdge {
  courseId         String
  course           Course  @relation("PrereqEdgeFrom", fields: [courseId], references: [id], onDelete: Cascade)
  requiredCourseId String
  requiredCourse   Course  @relation("PrereqEdgeTo", fields: [requiredCourseId], references: [id], onDelete: Cascade)

  @@id([courseId, requiredCourseId])
  @@index([requiredCourseId])
}
```

Add the back-relations to `Course` (alongside the existing `sections`/`gradeDistributions` relation fields):

```prisma
  historicalGrades  CourseHistoricalGrades?
  prereqEdgesFrom   CoursePrereqEdge[] @relation("PrereqEdgeFrom")
  prereqEdgesTo     CoursePrereqEdge[] @relation("PrereqEdgeTo")
```

- [ ] **Step 2: Generate and hand-place the migration**

```bash
npx prisma migrate diff --from-config-datasource prisma.config.ts --to-schema prisma/schema.prisma --script
```

Expected shape (verify before placing): one `CREATE TABLE "CourseHistoricalGrades"`, one `CREATE TABLE "CoursePrereqEdge"`, one `ALTER TABLE "Course" ADD COLUMN "antireqCodes" JSONB`, plus the FK constraints and the `requiredCourseId` index. Nothing else.

Write it to `prisma/migrations/<timestamp>_grades_and_prereq_edges/migration.sql`, timestamp later than `20260821000000`.

- [ ] **Step 3: Apply and verify**

```bash
npx prisma migrate deploy
npx prisma generate
npx prisma migrate status   # must say up to date, no drift
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c '\d "CourseHistoricalGrades"'
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c '\d "CoursePrereqEdge"'
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select count(*) courses from \"Course\";"   # must still be 7337 — additive only
```

- [ ] **Step 4: Add test coverage for the pre-existing `isUpcomingTerm`**

It already exists in `src/schedule/terms.ts` but has zero tests. Add to `tests/terms.test.ts` (append to the existing file — do not remove the existing `getCurrentAndNextTerm` tests):

```ts
import { isUpcomingTerm } from '@/schedule/terms';

// ...inside the existing top-level TERMS fixture already defined in this file...

describe('isUpcomingTerm', () => {
  it('is true for the current term and every term after it, in August', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 22));
    expect(isUpcomingTerm(TERMS.find((t) => t.id === 's-26')!)).toBe(true);
    expect(isUpcomingTerm(TERMS.find((t) => t.id === 'w1-26')!)).toBe(true);
    expect(isUpcomingTerm(TERMS.find((t) => t.id === 'w2-26')!)).toBe(true);
  });

  it('is false for a term that has already passed, in August', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 22));
    expect(isUpcomingTerm(TERMS.find((t) => t.id === 'w2-25')!)).toBe(false);
    expect(isUpcomingTerm(TERMS.find((t) => t.id === 'w1-25')!)).toBe(false);
  });
});
```

- [ ] **Step 5: Verify and commit**

```bash
npm test -- terms   # PASS, existing tests + 2 new
npm test            # 256 passing (254 + 2)
npx tsc --noEmit    # clean
```

```bash
git add prisma/schema.prisma prisma/migrations tests/terms.test.ts
git commit -m "feat: add CourseHistoricalGrades, CoursePrereqEdge, Course.antireqCodes"
```

---

## Task 2: Prereq system extensions — antirequisites + leads-to

**Files:**
- Modify: `src/prereqs/parse.ts`, `src/prereqs/jobs/build.ts`
- Test: `tests/parse-prereqs.test.ts`, `tests/prereqs-build.test.ts`

**Interfaces:**
- Consumes: `Course.antireqCodes`, `CoursePrereqEdge` (Task 1)
- Produces:
  - `extractAntireqCodes(text: string | null): string[]` (exported from `parse.ts`)
  - `type AntireqRef = { code: string; courseId: string | null }`
  - `resolveAntireqCodes(codes: string[]): Promise<AntireqRef[]>` (exported from `build.ts`)
  - `buildRequirementTrees()` also populates `CoursePrereqEdge` and `Course.antireqCodes`

- [ ] **Step 1: Write the failing tests**

Add to `tests/parse-prereqs.test.ts` (append — do not remove existing tests):

```ts
import { extractAntireqCodes } from '@/prereqs/parse';

describe('extractAntireqCodes', () => {
  it('extracts a single equivalency code with no space before the number', () => {
    // Real row: FIPR 437.
    expect(extractAntireqCodes('FIPR 337. Equivalency: FILM437')).toEqual(['FILM 437']);
  });

  it('extracts an equivalency code with a campus suffix', () => {
    // Real row: COMM 396.
    expect(extractAntireqCodes('COMM 196. Equivalency: COMM_V 390')).toEqual(['COMM 390']);
  });

  it('extracts multiple comma-separated equivalency codes', () => {
    // Real row: LLED 402 (from Phase 6 research).
    expect(
      extractAntireqCodes(
        'Fourth-year standing. Equivalency: APSC402, ASTU402, FRST402, LFS 402, PHAR402',
      ),
    ).toEqual(['APSC 402', 'ASTU 402', 'FRST 402', 'LFS 402', 'PHAR 402']);
  });

  it('returns an empty array when there is no Equivalency clause', () => {
    expect(extractAntireqCodes('CPSC_V 221 and one of MATH_V 200, MATH_V 217.')).toEqual([]);
  });

  it('returns an empty array for null input', () => {
    expect(extractAntireqCodes(null)).toEqual([]);
  });
});
```

Add to `tests/prereqs-build.test.ts` (append):

```ts
import { resolveAntireqCodes } from '@/prereqs/jobs/build';

describe('resolveAntireqCodes', () => {
  it('resolves a real Vancouver course code', async () => {
    const [ref] = await resolveAntireqCodes(['ECON 101']);
    expect(ref.code).toBe('ECON 101');
    expect(ref.courseId).not.toBeNull();
  });

  it('leaves an Okanagan code unresolved but present', async () => {
    const [ref] = await resolveAntireqCodes(['MGMT_O 301']);
    expect(ref.code).toBe('MGMT_O 301');
    expect(ref.courseId).toBeNull();
  });

  it('returns an empty array for an empty input', async () => {
    expect(await resolveAntireqCodes([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- parse-prereqs   # FAIL — extractAntireqCodes not exported
npm test -- prereqs-build   # FAIL — resolveAntireqCodes not exported
```

- [ ] **Step 3: Implement**

In `src/prereqs/parse.ts`, the module already has `extractCodes` and `toCourseNode` as private helpers — reuse them, do not duplicate the regex. Add, near `stripEquivalency`:

```ts
/**
 * The codes inside an "Equivalency:" clause — captured, not discarded, the
 * way stripEquivalency (used by parseRequirements) throws them away. These
 * are credit exclusions, not prerequisites, so they never enter a
 * Requirement tree — they're a separate flat list (spec §4.1).
 */
export function extractAntireqCodes(text: string | null): string[] {
  if (!text) return [];
  const matches = text.match(/\bEquivalenc(?:y|ies)\s*:[^.]*\.?/gi);
  if (!matches) return [];
  return matches.flatMap((clause) => extractCodes(clause)).map((c) => toCourseNode(c).code);
}
```

In `src/prereqs/jobs/build.ts`, add (reusing the existing private `vancouverCode`):

```ts
export type AntireqRef = { code: string; courseId: string | null };

export async function resolveAntireqCodes(codes: string[]): Promise<AntireqRef[]> {
  const refs: AntireqRef[] = [];
  for (const code of codes) {
    const parts = vancouverCode(code);
    if (!parts) {
      refs.push({ code, courseId: null });
      continue;
    }
    const course = await db.course.findFirst({
      where: { number: parts.number, campus: 'V', subject: { code: parts.subject } },
      select: { id: true },
    });
    refs.push({ code, courseId: course?.id ?? null });
  }
  return refs;
}

/** Every resolved courseId referenced anywhere in a tree, deduplicated —
 * the set of edges buildRequirementTrees writes to CoursePrereqEdge. */
function collectResolvedCourseIds(tree: Requirement | null): Set<string> {
  const ids = new Set<string>();
  function walk(node: Requirement | null) {
    if (!node) return;
    if (node.type === 'course') {
      if (node.courseId) ids.add(node.courseId);
      return;
    }
    if (node.type === 'note') return;
    node.items.forEach(walk);
  }
  walk(tree);
  return ids;
}
```

Modify `buildRequirementTrees` — add `antireqCodes` to the write, and after the existing per-course loop, populate `CoursePrereqEdge`:

```ts
export async function buildRequirementTrees(): Promise<BuildResult> {
  const courses = await db.course.findMany({
    select: { id: true, prereqText: true, coreqText: true },
  });

  const unresolved = new Set<string>();
  let updated = 0;
  let resolved = 0;

  // Wholesale rebuild — matches how prereqTree/coreqTree are already
  // overwritten every run (Global Constraints).
  await db.coursePrereqEdge.deleteMany({});

  for (const course of courses) {
    const prereqTree = await resolveTree(parseRequirements(course.prereqText), unresolved);
    const coreqTree = await resolveTree(parseRequirements(course.coreqText), unresolved);
    const antireqRefs = await resolveAntireqCodes(extractAntireqCodes(course.prereqText));

    await db.course.update({
      where: { id: course.id },
      data: {
        prereqTree: prereqTree ?? Prisma.DbNull,
        coreqTree: coreqTree ?? Prisma.DbNull,
        antireqCodes: antireqRefs.length ? antireqRefs : Prisma.DbNull,
      },
    });

    const requiredIds = collectResolvedCourseIds(prereqTree);
    if (requiredIds.size > 0) {
      await db.coursePrereqEdge.createMany({
        data: [...requiredIds].map((requiredCourseId) => ({
          courseId: course.id,
          requiredCourseId,
        })),
        skipDuplicates: true,
      });
    }

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

Add the import: `extractAntireqCodes` alongside the existing `parseRequirements` import from `@/prereqs/parse`.

- [ ] **Step 4: Verify**

```bash
npm test -- parse-prereqs    # PASS, existing + 5 new
npm test -- prereqs-build    # PASS, existing + 3 new
npm test                     # 264 passing (256 + 5 + 3)
npx tsc --noEmit
grep -nE "fetch|@/lib/db|readFile|require\(" src/prereqs/parse.ts   # purity — must print nothing
```

- [ ] **Step 5: Commit**

```bash
git add src/prereqs/parse.ts src/prereqs/jobs/build.ts tests/parse-prereqs.test.ts tests/prereqs-build.test.ts
git commit -m "feat: capture antirequisites and build a leads-to reverse index"
```

---

## Task 3: Historical grades ingest job

**Files:**
- Create: `src/grades/jobs/ingest-historical.ts`, `src/grades/jobs/ingest-historical.run.ts`
- Test: `tests/grades-ingest-historical.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `fetchText` (`@/scrape/http`), `db`, `CourseHistoricalGrades` (Task 1)
- Produces:
  - `historicalGradesUrl(campus: string, subject: string, number: string): string`
  - `type HistoricalGradesResponse = { average: number; average_past_5_yrs: number; min_course_avg: number; max_course_avg: number; stdev: number } | null`
  - `fetchHistoricalGrades(subject: string, number: string): Promise<HistoricalGradesResponse>`
  - `ingestHistoricalGrades(): Promise<{ updated: number; skipped: number }>`
  - `npm run ingest:historical-grades`

- [ ] **Step 1: Write the failing tests**

Create `tests/grades-ingest-historical.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { historicalGradesUrl, fetchHistoricalGrades } from '@/grades/jobs/ingest-historical';

afterAll(async () => {
  await db.$disconnect();
});

describe('historicalGradesUrl', () => {
  it('builds the verified real endpoint', () => {
    expect(historicalGradesUrl('UBCV', 'CPSC', '110')).toBe(
      'https://ubcgrades.com/api/v2/course-statistics/UBCV/CPSC/110',
    );
  });
});

describe('fetchHistoricalGrades', () => {
  it('returns real stats for a course with grade history', async () => {
    const result = await fetchHistoricalGrades('CPSC', '110');
    expect(result).not.toBeNull();
    expect(result!.average).toBeGreaterThan(0);
    expect(result!.average).toBeLessThanOrEqual(100);
    expect(result!.average_past_5_yrs).toBeGreaterThan(0);
  });

  it('returns null for a course with no grade history, not an error', async () => {
    // Real 404 confirmed live during spec research.
    const result = await fetchHistoricalGrades('ZZZZ', '999');
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npm test -- grades-ingest-historical   # FAIL — module missing
```

- [ ] **Step 3: Implement**

Create `src/grades/jobs/ingest-historical.ts`:

```ts
import { db } from '@/lib/db';
import { fetchText } from '@/scrape/http';

const BASE = 'https://ubcgrades.com/api/v2/course-statistics';

export function historicalGradesUrl(campus: string, subject: string, number: string): string {
  return `${BASE}/${campus}/${subject}/${number}`;
}

type ApiResponse = {
  average: number;
  average_past_5_yrs: number;
  min_course_avg: number;
  max_course_avg: number;
  stdev: number;
};

export type HistoricalGradesResponse = ApiResponse | null;

/** A 404 means "no grade history for this course" — normal, not an error,
 * same posture as every other "not every X exists" job in this codebase. */
export async function fetchHistoricalGrades(
  subject: string,
  number: string,
): Promise<HistoricalGradesResponse> {
  try {
    const text = await fetchText(historicalGradesUrl('UBCV', subject, number));
    return JSON.parse(text) as ApiResponse;
  } catch {
    return null;
  }
}

export async function ingestHistoricalGrades(): Promise<{ updated: number; skipped: number }> {
  const courses = await db.course.findMany({
    where: { campus: 'V' },
    select: { id: true, number: true, subject: { select: { code: true } } },
  });

  let updated = 0;
  let skipped = 0;

  for (const course of courses) {
    if (!course.subject.code) {
      skipped += 1;
      continue;
    }
    const stats = await fetchHistoricalGrades(course.subject.code, course.number);
    if (!stats) {
      skipped += 1;
      continue;
    }

    await db.courseHistoricalGrades.upsert({
      where: { courseId: course.id },
      create: {
        courseId: course.id,
        average: stats.average,
        averagePast5Years: stats.average_past_5_yrs,
        minSectionAverage: stats.min_course_avg,
        maxSectionAverage: stats.max_course_avg,
        stddev: stats.stdev,
      },
      update: {
        average: stats.average,
        averagePast5Years: stats.average_past_5_yrs,
        minSectionAverage: stats.min_course_avg,
        maxSectionAverage: stats.max_course_avg,
        stddev: stats.stdev,
      },
    });
    updated += 1;
  }

  console.log(`Historical grades: ${updated} courses updated, ${skipped} skipped (no data).`);
  return { updated, skipped };
}
```

Create `src/grades/jobs/ingest-historical.run.ts` (matches the existing `*.run.ts` pattern):

```ts
import { db } from '@/lib/db';
import { ingestHistoricalGrades } from '@/grades/jobs/ingest-historical';

ingestHistoricalGrades()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
```

Add to `package.json` scripts (alongside the existing `ingest:grades`):

```json
    "ingest:historical-grades": "tsx src/grades/jobs/ingest-historical.run.ts"
```

- [ ] **Step 4: Verify**

```bash
npm test -- grades-ingest-historical   # PASS, 3 tests
npm test                               # 267 passing (264 + 3)
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/grades/jobs/ingest-historical.ts src/grades/jobs/ingest-historical.run.ts tests/grades-ingest-historical.test.ts package.json
git commit -m "feat: ingest historical grade averages from the UBCGrades API"
```

---

## Task 4: Review aggregate histograms

**Files:**
- Modify: `src/reviews/aggregate.ts`
- Test: `tests/reviews-aggregate.test.ts` (create if it doesn't exist — check first; if `aggregateCourseReviews`/`aggregateInstructorReviews` are already covered elsewhere, add to that file instead of creating a duplicate)

**Interfaces:**
- Produces: `CourseAggregate.histograms`, `InstructorAggregate.histograms` — `Record<'useful' | 'difficulty', Record<1 | 2 | 3 | 4 | 5, number>>` / `Record<'clear' | 'engaging', ...>`

- [ ] **Step 1: Check for existing test coverage**

```bash
grep -rl "aggregateCourseReviews\|aggregateInstructorReviews" tests/
```

If a test file already covers these functions, add the new tests there. Otherwise create `tests/reviews-aggregate.test.ts`.

- [ ] **Step 2: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { aggregateCourseReviews, aggregateInstructorReviews } from '@/reviews/aggregate';

describe('aggregateCourseReviews histograms', () => {
  it('counts each display-scale rating (1-5) for useful and difficulty', () => {
    // Stored 0-4 -> displayed 1-5.
    const rows = [
      { liked: true, useful: 4, difficulty: 0, workloadHours: null },
      { liked: true, useful: 4, difficulty: 0, workloadHours: null },
      { liked: false, useful: 0, difficulty: 3, workloadHours: null },
    ];
    const { histograms } = aggregateCourseReviews(rows);
    expect(histograms.useful).toEqual({ 1: 1, 2: 0, 3: 0, 4: 0, 5: 2 });
    expect(histograms.difficulty).toEqual({ 1: 2, 2: 0, 3: 0, 4: 1, 5: 0 });
  });

  it('excludes null ratings from the histogram, not as a 0 bucket', () => {
    const { histograms } = aggregateCourseReviews([
      { liked: null, useful: null, difficulty: null, workloadHours: null },
    ]);
    expect(histograms.useful).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });

  it('returns all-zero histograms for no reviews, never undefined', () => {
    const { histograms } = aggregateCourseReviews([]);
    expect(histograms.useful).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    expect(histograms.difficulty).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });
});

describe('aggregateInstructorReviews histograms', () => {
  it('counts clear and engaging ratings', () => {
    const { histograms } = aggregateInstructorReviews([
      { liked: true, clear: 4, engaging: 4 },
      { liked: true, clear: 2, engaging: 4 },
    ]);
    expect(histograms.clear).toEqual({ 1: 0, 2: 0, 3: 1, 4: 0, 5: 1 });
    expect(histograms.engaging).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 2 });
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
npm test -- reviews-aggregate   # FAIL — histograms is undefined
```

- [ ] **Step 4: Implement**

In `src/reviews/aggregate.ts`, add:

```ts
export type Histogram = Record<1 | 2 | 3 | 4 | 5, number>;

function emptyHistogram(): Histogram {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

/** Counts each 0-4 stored rating into its 1-5 display bucket. Nulls are
 * excluded entirely — an unrated review contributes to no bucket, never a
 * fabricated "1". */
function histogramOf(values: (number | null)[]): Histogram {
  const h = emptyHistogram();
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const display = (v + 1) as 1 | 2 | 3 | 4 | 5;
    if (display >= 1 && display <= 5) h[display] += 1;
  }
  return h;
}
```

Update the two `*Aggregate` types and the two aggregate functions:

```ts
export type CourseAggregate = {
  count: number;
  likedPercent: number | null;
  useful: number | null;
  difficulty: number | null;
  workloadHours: number | null;
  histograms: { useful: Histogram; difficulty: Histogram };
};

export type InstructorAggregate = {
  count: number;
  likedPercent: number | null;
  clear: number | null;
  engaging: number | null;
  histograms: { clear: Histogram; engaging: Histogram };
};

export function aggregateCourseReviews(rows: CourseReviewRow[]): CourseAggregate {
  return {
    count: rows.length,
    likedPercent: likedPercent(rows.map((r) => r.liked)),
    useful: meanDisplay(rows.map((r) => r.useful)),
    difficulty: meanDisplay(rows.map((r) => r.difficulty)),
    workloadHours: meanOf(rows.map((r) => r.workloadHours)),
    histograms: {
      useful: histogramOf(rows.map((r) => r.useful)),
      difficulty: histogramOf(rows.map((r) => r.difficulty)),
    },
  };
}

export function aggregateInstructorReviews(rows: InstructorReviewRow[]): InstructorAggregate {
  return {
    count: rows.length,
    likedPercent: likedPercent(rows.map((r) => r.liked)),
    clear: meanDisplay(rows.map((r) => r.clear)),
    engaging: meanDisplay(rows.map((r) => r.engaging)),
    histograms: {
      clear: histogramOf(rows.map((r) => r.clear)),
      engaging: histogramOf(rows.map((r) => r.engaging)),
    },
  };
}
```

- [ ] **Step 5: Verify**

```bash
npm test -- reviews-aggregate   # PASS, 4 new tests
npm test                        # 271 passing (267 + 4)
npx tsc --noEmit
```

This changes `CourseAggregate`/`InstructorAggregate`'s shape — `tsc` will catch any caller that destructures these types without accounting for the new required `histograms` field. Fix any such caller by threading the field through, not by making it optional.

- [ ] **Step 6: Commit**

```bash
git add src/reviews/aggregate.ts tests/reviews-aggregate.test.ts
git commit -m "feat: add per-rating 1-5 histograms to review aggregates"
```

---

## Task 5: RatingsBox component

**Files:**
- Create: `src/components/RatingsBox.tsx`

**Interfaces:**
- Consumes: `CourseAggregate` or `InstructorAggregate` (Task 4), specifically `{ count, likedPercent, histograms }` plus two named metrics
- Produces: `RatingsBox` (client component — needs click state for the popover)

This is the "1:1" recreation piece (spec §5.3): a liked-percent ring, two labeled bars using the `(mean−1)/4×100` convention, each bar's icon opening a 1-5 histogram popover on click.

- [ ] **Step 1: Implement**

Create `src/components/RatingsBox.tsx`:

```tsx
'use client';

import { useState } from 'react';
import type { Histogram } from '@/reviews/aggregate';

type Metric = { label: string; mean: number | null; histogram: Histogram };

export default function RatingsBox({
  likedPercent,
  reviewCount,
  metrics,
}: {
  likedPercent: number | null;
  reviewCount: number;
  metrics: [Metric, Metric];
}) {
  const [open, setOpen] = useState<number | null>(null);

  // (mean - 1) / 4 * 100 — the box's own convention (spec 5.3), distinct
  // from the X.X/5 format used elsewhere on this site (Explore table etc.),
  // which this component does not touch.
  const asPercent = (mean: number | null) => (mean === null ? null : Math.round(((mean - 1) / 4) * 100));

  const ringPercent = likedPercent ?? 0;
  const circumference = 2 * Math.PI * 54;
  const dash = (ringPercent / 100) * circumference;

  if (reviewCount === 0) {
    return <p className="text-sm text-text-secondary">No reviews yet.</p>;
  }

  return (
    <div className="flex flex-wrap items-center gap-8 rounded-card border border-border bg-surface p-6">
      <div className="relative flex h-32 w-32 shrink-0 items-center justify-center">
        <svg viewBox="0 0 120 120" className="h-32 w-32 -rotate-90">
          <circle cx="60" cy="60" r="54" fill="none" stroke="var(--border)" strokeWidth="10" />
          <circle
            cx="60"
            cy="60"
            r="54"
            fill="none"
            stroke="var(--brand)"
            strokeWidth="10"
            strokeDasharray={`${dash} ${circumference}`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className="text-2xl font-semibold text-foreground">
            {likedPercent !== null ? `${likedPercent}%` : '—'}
          </span>
          <span className="text-xs text-text-secondary">liked</span>
        </div>
      </div>

      <div className="min-w-[220px] flex-1 space-y-3">
        {metrics.map((m, i) => (
          <div key={m.label} className="relative">
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => setOpen(open === i ? null : i)}
                className="flex items-center gap-1.5 font-medium text-foreground"
              >
                {m.label}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-3.5 w-3.5">
                  <rect x="4" y="10" width="3" height="8" />
                  <rect x="10.5" y="6" width="3" height="12" />
                  <rect x="17" y="2" width="3" height="16" />
                </svg>
              </button>
              <span className="text-text-secondary">
                {asPercent(m.mean) !== null ? `${asPercent(m.mean)}%` : '—'}
              </span>
            </div>
            <div className="mt-1 h-2 w-full rounded-full bg-surface-muted">
              <div
                className="h-2 rounded-full bg-brand"
                style={{ width: `${asPercent(m.mean) ?? 0}%` }}
              />
            </div>

            {open === i && (
              <div className="absolute left-0 top-full z-20 mt-2 w-64 rounded-card border border-border bg-surface p-4 shadow-lg">
                <p className="text-sm font-semibold text-foreground">{m.label} Distribution</p>
                <div className="mt-3 space-y-1.5">
                  {([5, 4, 3, 2, 1] as const).map((star) => {
                    const count = m.histogram[star];
                    const max = Math.max(1, ...Object.values(m.histogram));
                    return (
                      <div key={star} className="flex items-center gap-2 text-xs">
                        <span className="w-3 text-text-secondary">{star}</span>
                        <div className="h-2 flex-1 rounded-full bg-surface-muted">
                          <div
                            className="h-2 rounded-full bg-brand"
                            style={{ width: `${(count / max) * 100}%` }}
                          />
                        </div>
                        <span className="w-8 text-right text-text-secondary">({count})</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="w-full text-xs text-text-secondary">
        Based on {reviewCount} review{reviewCount === 1 ? '' : 's'}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verify live**

No automated test for this component (display-only, matches the established pattern from Phase 5/6's chart components — verified live instead). After Task 9 wires it in, check:
1. The ring fill matches `likedPercent`.
2. Clicking a metric's chart icon opens its popover with the real 1-5 counts; clicking again closes it; clicking the other metric switches which is open.
3. A metric with `mean: null` shows `—` and an empty (0-width) bar, never `0%`.

(This live check happens as part of Task 9's verification — this task just needs `npx tsc --noEmit` clean and `npx eslint .` clean now.)

```bash
npx tsc --noEmit
npx eslint src/components/RatingsBox.tsx
```

- [ ] **Step 3: Commit**

```bash
git add src/components/RatingsBox.tsx
git commit -m "feat: add RatingsBox with click-to-reveal rating distribution"
```

---

## Task 6: CourseScheduleBox component

**Files:**
- Create: `src/components/CourseScheduleBox.tsx`

**Interfaces:**
- Consumes: `isUpcomingTerm` (`@/schedule/terms`, pre-existing)
- Produces: `CourseScheduleBox` (client component — needs collapse/tab state)

Collapsible, tabbed by term, limited to current-and-upcoming terms (spec §5.5).

- [ ] **Step 1: Implement**

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatMeeting } from '@/lib/format';
import { isUpcomingTerm } from '@/schedule/terms';

type SectionRow = {
  id: string;
  sectionCode: string;
  activity: string | null;
  enrolTotal: number | null;
  enrolCap: number | null;
  meetingTimes: { day: string; startTime: string | null; endTime: string | null; building: string | null; room: string | null }[];
  instructors: { instructorId: string; instructor: { name: string; slug: string } }[];
  term: { id: string; name: string; year: number; session: string; termNumber: number | null };
};

export default function CourseScheduleBox({ sections }: { sections: SectionRow[] }) {
  const [collapsed, setCollapsed] = useState(false);

  const upcoming = sections.filter((s) => isUpcomingTerm(s.term));
  const termGroups = new Map<string, { term: SectionRow['term']; rows: SectionRow[] }>();
  for (const s of upcoming) {
    const entry = termGroups.get(s.term.id) ?? { term: s.term, rows: [] };
    entry.rows.push(s);
    termGroups.set(s.term.id, entry);
  }
  const terms = [...termGroups.values()].sort(
    (a, b) => a.term.year - b.term.year || (a.term.termNumber ?? 0) - (b.term.termNumber ?? 0),
  );
  const [activeTermId, setActiveTermId] = useState<string | undefined>(terms[0]?.term.id);
  const active = terms.find((t) => t.term.id === activeTermId) ?? terms[0];

  return (
    <div className="rounded-card border border-border">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <p className="text-lg font-semibold text-foreground">Course Schedule</p>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          className={`h-5 w-5 text-text-secondary transition-transform ${collapsed ? '' : 'rotate-180'}`}
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {!collapsed && (
        <div className="border-t border-border">
          {terms.length === 0 ? (
            <p className="p-4 text-sm text-text-secondary">
              No sections scheduled for the current or upcoming terms.
            </p>
          ) : (
            <>
              <div className="flex overflow-x-auto border-b border-border">
                {terms.map(({ term }) => (
                  <button
                    key={term.id}
                    type="button"
                    onClick={() => setActiveTermId(term.id)}
                    className={`shrink-0 px-4 py-2 text-sm font-medium ${
                      activeTermId === term.id
                        ? 'border-b-2 border-brand text-foreground'
                        : 'text-text-secondary hover:text-foreground'
                    }`}
                  >
                    {term.name}
                  </button>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-text-secondary">
                    <tr>
                      <th className="px-4 py-2 font-medium">Section</th>
                      <th className="px-4 py-2 font-medium">Activity</th>
                      <th className="px-4 py-2 font-medium">Enrolled</th>
                      <th className="px-4 py-2 font-medium">Time</th>
                      <th className="px-4 py-2 font-medium">Instructor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active?.rows.map((s) => (
                      <tr key={s.id} className="border-t border-border">
                        <td className="px-4 py-2 font-medium text-foreground">{s.sectionCode}</td>
                        <td className="px-4 py-2 text-text-secondary">{s.activity ?? '—'}</td>
                        <td className="px-4 py-2 text-text-secondary">
                          {s.enrolTotal !== null && s.enrolCap !== null
                            ? `${s.enrolTotal}/${s.enrolCap}`
                            : '—'}
                        </td>
                        <td className="px-4 py-2 text-text-secondary">
                          {s.meetingTimes.length ? s.meetingTimes.map((m) => formatMeeting(m)).join(', ') : '—'}
                        </td>
                        <td className="px-4 py-2">
                          {s.instructors.length
                            ? s.instructors.map((si) => (
                                <Link
                                  key={si.instructorId}
                                  href={`/professor/${si.instructor.slug}`}
                                  className="text-brand hover:underline"
                                >
                                  {si.instructor.name}
                                </Link>
                              ))
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
npx eslint src/components/CourseScheduleBox.tsx
```

Live verification (a real course with sections in a past term AND an upcoming term — confirm past terms never appear as tabs) happens in Task 9.

- [ ] **Step 3: Commit**

```bash
git add src/components/CourseScheduleBox.tsx
git commit -m "feat: add collapsible, current-year-only CourseScheduleBox"
```

---

## Task 7: RequirementSidebar component

**Files:**
- Create: `src/components/RequirementSidebar.tsx`

**Interfaces:**
- Consumes: `RequirementTree` (existing, reused as-is), `Requirement` type, `AntireqRef` (Task 2)
- Produces: `RequirementSidebar` (server component — no interactivity needed)

Prerequisites / Corequisites (reusing the existing `RequirementTree` renderer) / Antirequisites / Leads to, matching spec §5.6.

- [ ] **Step 1: Implement**

```tsx
import Link from 'next/link';
import RequirementTree from '@/components/RequirementTree';
import type { Requirement } from '@/prereqs/parse';

type AntireqRef = { code: string; courseId: string | null };
type LeadsToRef = { code: string; courseId: string };

function courseHref(code: string): string {
  return `/course/${code.toLowerCase().replace(/\s+/g, '-')}`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-5 first:mt-0">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <div className="mt-2 text-sm text-text-secondary">{children}</div>
    </div>
  );
}

export default function RequirementSidebar({
  courseCode,
  prereqTree,
  coreqTree,
  antireqs,
  leadsTo,
}: {
  courseCode: string;
  prereqTree: Requirement | null;
  coreqTree: Requirement | null;
  antireqs: AntireqRef[];
  leadsTo: LeadsToRef[];
}) {
  return (
    <aside className="rounded-card border border-border p-5">
      <Section title={`${courseCode} prerequisites`}>
        {prereqTree ? <RequirementTree node={prereqTree} /> : 'No prerequisites'}
      </Section>

      <Section title={`${courseCode} corequisites`}>
        {coreqTree ? <RequirementTree node={coreqTree} /> : 'No corequisites'}
      </Section>

      <Section title={`${courseCode} antirequisites`}>
        {antireqs.length === 0 ? (
          'No antirequisites'
        ) : (
          <ul className="space-y-1">
            {antireqs.map((a) => (
              <li key={a.code}>
                {a.courseId ? (
                  <Link href={courseHref(a.code)} className="text-brand hover:underline">
                    {a.code}
                  </Link>
                ) : (
                  <span>{a.code}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`${courseCode} leads to`}>
        {leadsTo.length === 0 ? (
          'No courses require this one'
        ) : (
          <ul className="space-y-1">
            {leadsTo.map((c) => (
              <li key={c.courseId}>
                <Link href={courseHref(c.code)} className="text-brand hover:underline">
                  {c.code}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </aside>
  );
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
npx eslint src/components/RequirementSidebar.tsx
```

- [ ] **Step 3: Commit**

```bash
git add src/components/RequirementSidebar.tsx
git commit -m "feat: add RequirementSidebar with antirequisites and leads-to"
```

---

## Task 8: ReviewCard component

**Files:**
- Create: `src/components/ReviewCard.tsx`

**Interfaces:**
- Produces: `ReviewCard` (server component)

Shared between course and professor pages. Deterministic colored placeholder avatar (spec §6) — hashed from the review's `id`, not random per render.

- [ ] **Step 1: Implement**

```tsx
const AVATAR_COLORS = ['#002145', '#04316b', '#5c6770', '#7a8791', '#3a5a78', '#1f4e79'];

/** Same review id -> same color, every render — not Math.random(). */
function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function Avatar({ id }: { id: string }) {
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
      style={{ backgroundColor: colorFor(id) }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    </div>
  );
}

export default function ReviewCard({
  id,
  text,
  tags,
  attribution,
}: {
  id: string;
  text: string | null;
  tags: { label: string; value: string }[];
  attribution: string;
}) {
  return (
    <div className="flex gap-3 rounded-card border border-border p-4">
      <Avatar id={id} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
          {tags.map((t) => (
            <span key={t.label}>
              {t.label}: {t.value}
            </span>
          ))}
        </div>
        {text && <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{text}</p>}
        <p className="mt-2 text-xs italic text-text-tertiary">{attribution}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit
npx eslint src/components/ReviewCard.tsx
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ReviewCard.tsx
git commit -m "feat: add shared ReviewCard with deterministic placeholder avatar"
```

---

## Task 9: Course page reassembly

**Files:**
- Modify: `src/app/course/[code]/page.tsx`

**Interfaces:**
- Consumes: `RatingsBox` (5), `CourseScheduleBox` (6), `RequirementSidebar` (7), `ReviewCard` (8), `CourseHistoricalGrades`/`CoursePrereqEdge`/`Course.antireqCodes` (1, 2)

Reassembles the page in the order: header → description → RatingsBox → Grade Distribution (existing `GradeChart`, unmodified) → Historical Averages (new, inline in this task — small enough not to warrant its own component per the plan's task-sizing) → CourseScheduleBox → two-column layout with RequirementSidebar → course/professor review tabs using ReviewCard.

- [ ] **Step 1: Update the data fetching**

In `src/app/course/[code]/page.tsx`, extend the existing `course` query's `include` to also fetch `sections.enrolTotal`/`enrolCap` (already selected implicitly via the existing `sections: { include: {...} }` — confirm no `select` is narrowing it out; if the current query already includes full `Section` rows, no change needed here).

Add these queries alongside the existing `gradeRows`/`reviews` fetches:

```ts
  const historicalGrades = await db.courseHistoricalGrades.findUnique({
    where: { courseId: course.id },
  });

  const leadsToEdges = await db.coursePrereqEdge.findMany({
    where: { requiredCourseId: course.id },
    include: { course: { include: { subject: true } } },
  });
  const leadsTo = leadsToEdges.map((e) => ({
    code: `${e.course.subject.code} ${e.course.number}`,
    courseId: e.courseId,
  }));

  const antireqs = (course.antireqCodes as { code: string; courseId: string | null }[] | null) ?? [];

  const instructorReviews = await db.instructorReview.findMany({
    where: { courseId: course.id },
    select: { id: true, liked: true, clear: true, engaging: true, text: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  const instructorStats = aggregateInstructorReviews(instructorReviews);
```

Add the import: `aggregateInstructorReviews` alongside the existing `aggregateCourseReviews` import.

- [ ] **Step 2: Replace the Ratings stat-card block with RatingsBox**

Replace the existing block from `<div className="mt-10 flex items-center justify-between">` (the "Ratings" heading + stat-card grid, roughly lines 149-191 of the current file) with:

```tsx
      <div className="mt-10 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Ratings</h2>
        {mayReview && (
          <Link href={`/course/${code}/review`} className="text-sm text-brand hover:underline">
            {myReview ? 'Edit your review' : 'Write a review'}
          </Link>
        )}
      </div>
      <div className="mt-4">
        <RatingsBox
          likedPercent={stats.likedPercent}
          reviewCount={stats.count}
          metrics={[
            { label: 'Useful', mean: stats.useful, histogram: stats.histograms.useful },
            { label: 'Easy', mean: stats.difficulty, histogram: stats.histograms.difficulty },
          ]}
        />
      </div>
```

(The review list that currently follows moves into the new tabbed section in Step 4 — remove the old inline `<ul>` review list here.)

- [ ] **Step 3: Add Historical Averages beneath the existing Grade Distribution**

Immediately after the existing `<GradeChart distribution={grades.distribution} />` block (inside the same `grades.sectionCount === 0 ? ... : (<>...)` branch, before the closing `</>`), add:

```tsx
          {historicalGrades && (
            <div className="mt-6 rounded-card border border-border p-4">
              <p className="text-sm font-semibold text-foreground">Historical Averages</p>
              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-xs text-text-secondary">Overall average</p>
                  <p className="text-lg font-semibold text-foreground">
                    {historicalGrades.average !== null ? `${historicalGrades.average.toFixed(1)}%` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-secondary">Past 5 years</p>
                  <p className="text-lg font-semibold text-foreground">
                    {historicalGrades.averagePast5Years !== null
                      ? `${historicalGrades.averagePast5Years.toFixed(1)}%`
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-secondary">Lowest section avg</p>
                  <p className="text-lg font-semibold text-foreground">
                    {historicalGrades.minSectionAverage !== null
                      ? `${historicalGrades.minSectionAverage.toFixed(1)}%`
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-text-secondary">Highest section avg</p>
                  <p className="text-lg font-semibold text-foreground">
                    {historicalGrades.maxSectionAverage !== null
                      ? `${historicalGrades.maxSectionAverage.toFixed(1)}%`
                      : '—'}
                  </p>
                </div>
              </div>
              <p className="mt-3 text-xs text-text-secondary">
                Historical data from{' '}
                <a
                  href="https://ubcgrades.com"
                  className="text-brand hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  ubcgrades.com
                </a>
                .
              </p>
            </div>
          )}
```

- [ ] **Step 4: Replace the Sections table with CourseScheduleBox + two-column layout**

Replace the existing `<h2>Sections</h2>` block and its table (from `<h2 className="mt-10 text-xl font-semibold">Sections</h2>` to the end of the component) with:

```tsx
      <div className="mt-10">
        <CourseScheduleBox
          sections={course.sections.map((s) => ({
            id: s.id,
            sectionCode: s.sectionCode,
            activity: s.activity,
            enrolTotal: s.enrolTotal,
            enrolCap: s.enrolCap,
            meetingTimes: s.meetingTimes,
            instructors: s.instructors,
            term: s.term,
          }))}
        />
      </div>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_300px]">
        <div>
          <div className="flex gap-2 border-b border-border">
            <button
              type="button"
              className="border-b-2 border-brand px-4 py-2 text-sm font-semibold text-foreground"
            >
              Course reviews ({stats.count})
            </button>
            <span className="px-4 py-2 text-sm font-semibold text-text-secondary">
              Professor reviews ({instructorStats.count})
            </span>
          </div>

          {stats.count === 0 ? (
            <p className="mt-4 text-sm text-text-secondary">No reviews yet.</p>
          ) : (
            <ul className="mt-4 space-y-4">
              {reviews.map((r) => (
                <ReviewCard
                  key={r.id}
                  id={r.id}
                  text={r.text}
                  tags={[
                    ...(r.liked !== null ? [{ label: 'Liked', value: r.liked ? 'Yes' : 'No' }] : []),
                    ...(r.useful !== null ? [{ label: 'Useful', value: `${r.useful + 1}/5` }] : []),
                    ...(r.difficulty !== null ? [{ label: 'Easy', value: `${r.difficulty + 1}/5` }] : []),
                    ...(r.workloadHours !== null
                      ? [{ label: 'Workload', value: `${r.workloadHours} hrs/wk` }]
                      : []),
                  ]}
                  attribution="A student"
                />
              ))}
            </ul>
          )}

          {instructorStats.count > 0 && (
            <ul className="mt-4 space-y-4">
              {instructorReviews.map((r) => (
                <ReviewCard
                  key={r.id}
                  id={r.id}
                  text={r.text}
                  tags={[
                    ...(r.liked !== null ? [{ label: 'Liked', value: r.liked ? 'Yes' : 'No' }] : []),
                    ...(r.clear !== null ? [{ label: 'Clear', value: `${r.clear + 1}/5` }] : []),
                    ...(r.engaging !== null ? [{ label: 'Engaging', value: `${r.engaging + 1}/5` }] : []),
                  ]}
                  attribution="A student"
                />
              ))}
            </ul>
          )}
        </div>

        <RequirementSidebar
          courseCode={`${course.subject.code} ${course.number}`}
          prereqTree={course.prereqTree as unknown as Requirement | null}
          coreqTree={course.coreqTree as unknown as Requirement | null}
          antireqs={antireqs}
          leadsTo={leadsTo}
        />
      </div>
    </main>
  );
}
```

**Note on the tabs above:** this step ships both review lists visible at once with only the "Course reviews" tab styled active (no client-side toggle yet) — a deliberate, minimal first cut. If you want a real client-side tab toggle between the two lists, that requires converting this section into a small client component; do NOT do that inline in this server component. Flag it as a concern in your report rather than silently expanding scope — the controller will decide whether a follow-up task is warranted.

Remove the now-unused old prereq/coreq inline block (the one using `RequirementTree` directly, replaced by `RequirementSidebar`) and its now-unused `Requirement` import path if `RequirementSidebar` is the only remaining consumer — keep the `import type { Requirement }` line since it's still used for the `as unknown as Requirement` casts passed into `RequirementSidebar`.

- [ ] **Step 5: Verify live**

```bash
npm run dev
```

Check `/course/cpsc-110` (has a real review, per prior phases) and `/course/cpsc-314` (has real prerequisites from Phase 6):
1. RatingsBox shows real liked%/useful/easy, popover opens on icon click with real 1-5 counts.
2. Grade Distribution renders unchanged (Phase 5 chart, untouched).
3. Historical Averages appears beneath it if `CourseHistoricalGrades` has a row (won't yet — Task 11 runs the real ingest; verify the "not shown when absent" behavior instead by confirming no empty section renders for a course with no row).
4. CourseScheduleBox: only current/upcoming term tabs appear, collapses on click.
5. RequirementSidebar shows real prereq/coreq/antireq/leads-to (leads-to and antireq will be empty until Task 11's `enrich:prereqs` re-run populates them — verify the "No antirequisites"/"No courses require this one" empty states instead).
6. Course reviews render via ReviewCard with a colored avatar.

Stop the dev server.

- [ ] **Step 6: Full verification and commit**

```bash
npm test          # 271 passing (unchanged — this task has no new tests, display-only)
npx tsc --noEmit
npx eslint .
npm run build
```

```bash
git add "src/app/course/[code]/page.tsx"
git commit -m "feat: reassemble the course page with RatingsBox, schedule, and sidebar"
```

---

## Task 10: Professor page reassembly

**Files:**
- Modify: `src/app/professor/[slug]/page.tsx`

**Interfaces:**
- Consumes: `RatingsBox` (5), `ReviewCard` (8)

Same RatingsBox pattern (Clear/Engaging), reviews grouped by course taught (spec §8) instead of a flat list.

- [ ] **Step 1: Group reviews by course**

Add, after the existing `reviews`/`stats` computation:

```ts
  const reviewsByCourse = new Map<string, { code: string; title: string; reviews: typeof reviews }>();
  for (const r of reviews) {
    // InstructorReview.courseId has no Prisma relation to Course (raw FK,
    // same convention as SavedSchedule.termId elsewhere in this app) — the
    // course code/title for each group comes from the existing `courses`
    // list already built below from instructor.sections, matched by code.
  }
```

Actually — reorder: the existing `courses` derivation (from `instructor.sections`) already has course code/title per course this instructor teaches. Build the grouping directly from `reviews` keyed by `courseId`, then resolve each group's display code/title via a fresh lookup (the existing `instructor.sections` data is keyed by course code string, not `courseId`, so it can't be joined directly — fetch course code/title for the review's `courseId` values instead):

```ts
  const reviewCourseIds = [...new Set(reviews.map((r) => r.courseId))];
  const reviewCourses = await db.course.findMany({
    where: { id: { in: reviewCourseIds } },
    include: { subject: true },
  });
  const courseById = new Map(
    reviewCourses.map((c) => [c.id, { code: `${c.subject.code} ${c.number}`, title: c.title }]),
  );

  const reviewsByCourse = new Map<
    string,
    { code: string; title: string; reviews: typeof reviews }
  >();
  for (const r of reviews) {
    const info = courseById.get(r.courseId);
    if (!info) continue;
    const entry = reviewsByCourse.get(r.courseId) ?? { ...info, reviews: [] };
    entry.reviews.push(r);
    reviewsByCourse.set(r.courseId, entry);
  }
  // Most-reviewed course first, matching UW Flow's "Sort courses: most reviews" default.
  const courseGroups = [...reviewsByCourse.entries()]
    .map(([courseId, group]) => ({ courseId, ...group }))
    .sort((a, b) => b.reviews.length - a.reviews.length);
```

Note: `InstructorReview` needs `courseId` selected in the existing `reviews` query — confirm it already is (it is, per the current file's `select` block).

- [ ] **Step 2: Replace the Ratings stat-card block with RatingsBox**

Same substitution pattern as Task 9 Step 2, using Clear/Engaging:

```tsx
      <h2 className="mt-10 text-xl font-semibold">Ratings</h2>
      <div className="mt-4">
        <RatingsBox
          likedPercent={stats.likedPercent}
          reviewCount={stats.count}
          metrics={[
            { label: 'Clear', mean: stats.clear, histogram: stats.histograms.clear },
            { label: 'Engaging', mean: stats.engaging, histogram: stats.histograms.engaging },
          ]}
        />
      </div>
```

- [ ] **Step 3: Replace the flat review list with course-grouped ReviewCard sections**

Replace the existing `{stats.count > 0 && (<ul>...reviews.map...</ul>)}` block with:

```tsx
      {courseGroups.length > 0 && (
        <div className="mt-6 space-y-8">
          {courseGroups.map((group) => (
            <div key={group.courseId}>
              <Link
                href={`/course/${group.code.toLowerCase().replace(' ', '-')}`}
                className="text-lg font-semibold text-brand hover:underline"
              >
                {group.code}
              </Link>
              <p className="text-sm text-text-secondary">{group.title}</p>
              <ul className="mt-3 space-y-3">
                {group.reviews.map((r) => (
                  <ReviewCard
                    key={r.id}
                    id={r.id}
                    text={r.text}
                    tags={[
                      ...(r.liked !== null ? [{ label: 'Liked', value: r.liked ? 'Yes' : 'No' }] : []),
                      ...(r.clear !== null ? [{ label: 'Clear', value: `${r.clear + 1}/5` }] : []),
                      ...(r.engaging !== null ? [{ label: 'Engaging', value: `${r.engaging + 1}/5` }] : []),
                    ]}
                    attribution="A student"
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
```

- [ ] **Step 4: Add Historical Averages to this page's Grades section too**

Same block as Task 9 Step 3, using this page's already-fetched `historicalGrades` — add the identical query (`db.courseHistoricalGrades` doesn't apply directly to an instructor; this page's Grades section aggregates across courses the instructor taught via `gradeDistributions`, which already has no direct historical-grades equivalent). **Skip this step** — historical averages are a per-course concept (spec §3), and the professor page's existing Grades section already aggregates distribution data across multiple courses, which historical averages cannot be meaningfully summed into. Leave the professor page's Grades section as Grade Distribution only, unchanged from its current form. (This is a deliberate scope note, not an oversight — record it in your report.)

- [ ] **Step 5: Verify live and full check**

```bash
npm run dev
```
Check `/professor/nick-bradley` (taught CPSC 110, has a real review) — confirm RatingsBox shows Clear/Engaging, review appears grouped under its course.

```bash
npm test          # 271 passing (unchanged)
npx tsc --noEmit
npx eslint .
npm run build
```

```bash
git add "src/app/professor/[slug]/page.tsx"
git commit -m "feat: reassemble the professor page with RatingsBox and course-grouped reviews"
```

---

## Task 11: Full ingest run + verification

**Files:** none — this task runs the jobs and verifies the result.

- [ ] **Step 1: Re-run enrich:prereqs to populate antireqCodes and CoursePrereqEdge**

```bash
npm run enrich:prereqs
```

Expect it to complete in under two minutes (local job, no network — same as the original Phase 6 run).

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select count(*) from \"Course\" where \"antireqCodes\" is not null;"
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c "select count(*) from \"CoursePrereqEdge\";"
```

Spot-check the real fixtures used in Task 2's tests:

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c "
select s.code, c.number, c.\"antireqCodes\"
from \"Course\" c join \"Subject\" s on s.id=c.\"subjectId\"
where (s.code, c.number) in (('FIPR','437'),('COMM','396'));"
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c "
select s.code, c.number
from \"CoursePrereqEdge\" e
join \"Course\" c on c.id=e.\"courseId\"
join \"Subject\" s on s.id=c.\"subjectId\"
join \"Course\" rc on rc.id=e.\"requiredCourseId\"
join \"Subject\" rs on rs.id=rc.\"subjectId\"
where rs.code='CPSC' and rc.number='110';"
```

The last query is CPSC 110's real "leads to" list — confirm it's non-empty and every code is a real course that plausibly requires CPSC 110.

- [ ] **Step 2: Run the historical grades ingest for real**

```bash
npm run ingest:historical-grades
```

This makes one request per Vancouver course (~7337, rate-limited to 1/sec) — expect roughly **two hours**. Run it via a detached background process and poll, the same way Phase 5/6's long-running ingests were supervised (do not run it as a blocking foreground call that will exceed a tool timeout).

- [ ] **Step 3: Verify the result**

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c "select count(*) from \"CourseHistoricalGrades\";"
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select min(average), max(average), avg(average) from \"CourseHistoricalGrades\" where average is not null;"
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c "
select s.code, c.number, h.average, h.\"averagePast5Years\"
from \"CourseHistoricalGrades\" h
join \"Course\" c on c.id=h.\"courseId\"
join \"Subject\" s on s.id=c.\"subjectId\"
where s.code='CPSC' and c.number='110';"
```

Confirm: row count is a plausible fraction of 7337 (not every course has grade history), min/max/avg are plausible grade percentages (0-100 range, mean in the 70s-80s, matching the pattern established in Phase 5), and CPSC 110's row matches the real API response captured in this plan's "Verified facts" section (`average` ≈ 74.3, `averagePast5Years` ≈ 74.9).

- [ ] **Step 4: Confirm the pages work with full data**

Start the dev server, open `/course/cpsc-110`:
1. Historical Averages now renders with real numbers.
2. RequirementSidebar's "Leads to" list is populated for a course with real dependents (check a foundational course like CPSC 110 or CPSC 121).
3. A course with a real Equivalency clause (e.g. `/course/comm-396`) shows a populated Antirequisites list.

Stop the dev server.

- [ ] **Step 5: Final full verification**

```bash
npm test          # 271/271
npx tsc --noEmit
npx eslint .
npm run build
```
