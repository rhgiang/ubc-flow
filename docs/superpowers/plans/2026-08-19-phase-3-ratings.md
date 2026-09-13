# UBC Flow Phase 3: Ratings and Reviews - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A verified student can rate a course they actually took and the instructors who taught it, in one form, then edit or delete that review - with aggregate ratings shown on course and professor pages and no reviewer identity visible anywhere.

**Architecture:** Continues the Next.js + Prisma monolith. Phase 2's `canReview` stays the sole server-side authority on write permission. Aggregation is a **pure function** over already-fetched rows, following the pattern that kept Phases 1 and 2 testable offline. Writes go through server actions, not API routes, since there is no external consumer.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Prisma 7 (driver adapter), Postgres, Tailwind, Vitest. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-08-19-phase-3-ratings-design.md`](../specs/2026-08-19-phase-3-ratings-design.md)

## Global Constraints

- **Node.js 20+**, npm. No bun, no pnpm.
- **Every review write calls `canReview(userId, courseId)` server-side.** UI visibility is never the control. A forged request to a server action must be rejected by the same check.
- **Edit and delete verify ownership** - never trust a client-supplied review id alone.
- **`userId` never reaches a page, an API response, or a client prop** for a review being displayed. It exists only to support edit, delete, and one-review-per-course enforcement.
- **`difficulty` increases with difficulty.** 0 = easiest, 4 = hardest. Never store or display it inverted.
- **Scores are stored 0-4 and shown to users as 1-5.** Convert at the boundary; never store 1-5.
- **Review text renders as text, never HTML.** No `dangerouslySetInnerHTML` on user content anywhere.
- Aggregation functions are **pure**: no I/O, no Prisma, no `fetch`.
- Tests live in `tests/**/*.test.ts`.

---

## Plan-level decisions

**1. Server actions, not API routes.** Phase 2 used a route handler for upload because it takes a file and could plausibly get an external client. Reviews are same-origin form submissions with no external consumer, so server actions are less machinery for the same result. Matches `src/app/actions/auth.ts` from Phase 2.

**2. Prisma's interactive transaction for the write.** The spec requires the `CourseReview` and its `InstructorReview` rows to land atomically. `db.$transaction(async (tx) => …)` is the mechanism; every write inside uses `tx`, not `db`.

**3. Aggregates computed in the page's existing query, not a denormalized column.** Review volume will be tiny for a long time, and a cached average column is a cache-invalidation problem for no measurable gain. Revisit only if a page is measurably slow.

---

## File Structure

```
prisma/schema.prisma            - drop CourseReview.instructorId (only schema change)
src/reviews/aggregate.ts        - PURE: review rows -> aggregate stats
src/reviews/validate.ts         - PURE: score/text/workload validation
src/app/actions/reviews.ts      - server actions: submitReview, deleteReview
src/app/course/[code]/page.tsx  - MODIFY: aggregates, review list, form entry
src/app/course/[code]/review/page.tsx - the combined review form
src/app/professor/[slug]/page.tsx     - MODIFY: aggregates + review list
tests/aggregate.test.ts
tests/validate.test.ts
tests/reviews-gate.test.ts      - the security tests (negative cases)
```

---

### Task 1: Schema cleanup and pure validation

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/reviews/validate.ts`
- Test: `tests/validate.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `validateCourseRating(input): { ok: true; value: CourseRatingInput } | { ok: false; error: string }`
  - `validateInstructorRating(input): { ok: true; value: InstructorRatingInput } | { ok: false; error: string }`
  - types `CourseRatingInput`, `InstructorRatingInput`

**Schema changes:** two, both safe on empty tables.

1. **Drop `CourseReview.instructorId`.** `InstructorReview` already models the
   course-instructor relationship with correct multiplicity. Nothing has ever written
   to this column (Phases 1-2 never touched review tables), so no data is at risk.

2. **Make `InstructorReview.courseId` required** (`String?` -> `String`). It is
   currently nullable, but it participates in `@@unique([userId, instructorId, courseId])`,
   and **Prisma will not accept a nullable field inside a compound-key `where` clause** -
   so the `instructorReview.upsert({ where: { userId_instructorId_courseId: … } })` in
   Task 3 does not typecheck while it stays optional. It is semantically required here
   anyway: spec §3 only ever creates an instructor review in the context of a specific
   course review. The table is empty, so tightening it now costs nothing; discovering it
   mid-Task-3 would mean an unplanned migration on a branch with half-written code.

**Migration note - this environment blocks `prisma migrate dev`.** Prisma 7 hard-blocks
it outside a TTY. Phase 2 established the working sequence; reuse it exactly:

```bash
npx prisma migrate diff \
  --from-schema-datamodel prisma/schema.prisma \
  --to-schema-datasource prisma/schema.prisma \
  --script > /tmp/down.sql   # inspect only; not applied
```

The actual procedure that worked in Phase 2: generate the SQL with
`prisma migrate diff`, hand-place it in a timestamped folder under
`prisma/migrations/`, run `npx prisma migrate deploy`, then `npx prisma generate`.
Verify afterwards with `npx prisma migrate status` - it must report the schema is
up to date, proving the hand-placed migration and `schema.prisma` agree with no drift.

- [ ] **Step 1: Apply both schema edits**

In `prisma/schema.prisma`, remove this single line from `model CourseReview`:

```prisma
  instructorId  String?
```

And in `model InstructorReview`, make `courseId` required:

```prisma
  courseId     String     // was String?
```

Leave every other field - including `CourseReview.termId` - untouched.

- [ ] **Step 2: Generate, place, and apply the migration**

Follow the Phase 2 sequence above. The generated SQL should be exactly two
statements - a `DROP COLUMN "instructorId"` on `CourseReview`, and a
`SET NOT NULL` on `InstructorReview."courseId"`. Inspect it before applying - if it
contains anything else (especially any `DROP TABLE` or a drop on a column not named
above), stop and report, because that means the schema drifted somewhere unexpected.

The `SET NOT NULL` is only safe because the table is empty - confirm that first:

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select count(*) from \"InstructorReview\";"
```

It must be `0`. If it is not, stop - a `SET NOT NULL` against existing rows with
nulls will fail, and the plan's assumption that these tables are untouched is wrong.

Verify data safety (these tables are empty, but prove it rather than assume):

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select (select count(*) from \"CourseReview\") reviews, (select count(*) from \"Course\") courses, (select count(*) from \"Enrollment\") enrollments;"
```

Course and Enrollment counts must be unchanged from before the migration.

- [ ] **Step 3: Write the failing validation tests**

Create `tests/validate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateCourseRating, validateInstructorRating } from '@/reviews/validate';

const validCourse = {
  liked: true,
  useful: 3,
  difficulty: 2,
  workloadHours: 8,
  text: 'Solid course.',
};

describe('validateCourseRating', () => {
  it('accepts a well-formed rating', () => {
    const r = validateCourseRating(validCourse);
    expect(r.ok).toBe(true);
  });

  it('accepts the full 0-4 score range at both ends', () => {
    expect(validateCourseRating({ ...validCourse, useful: 0, difficulty: 0 }).ok).toBe(true);
    expect(validateCourseRating({ ...validCourse, useful: 4, difficulty: 4 }).ok).toBe(true);
  });

  it('rejects a score above the stored range', () => {
    // 5 is the DISPLAY value; storage is 0-4. A 5 reaching this layer means
    // the 1-5 -> 0-4 conversion was skipped somewhere.
    expect(validateCourseRating({ ...validCourse, useful: 5 }).ok).toBe(false);
  });

  it('rejects a negative score', () => {
    expect(validateCourseRating({ ...validCourse, difficulty: -1 }).ok).toBe(false);
  });

  it('rejects a non-integer score', () => {
    expect(validateCourseRating({ ...validCourse, useful: 2.5 }).ok).toBe(false);
  });

  it('allows omitted optional scores', () => {
    const r = validateCourseRating({ liked: null, useful: null, difficulty: null, workloadHours: null, text: null });
    expect(r.ok).toBe(true);
  });

  it('rejects absurd workload hours', () => {
    expect(validateCourseRating({ ...validCourse, workloadHours: -5 }).ok).toBe(false);
    expect(validateCourseRating({ ...validCourse, workloadHours: 200 }).ok).toBe(false);
  });

  it('rejects text beyond the length cap', () => {
    expect(validateCourseRating({ ...validCourse, text: 'x'.repeat(5001) }).ok).toBe(false);
  });

  it('trims text and treats whitespace-only as absent', () => {
    const r = validateCourseRating({ ...validCourse, text: '   ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBeNull();
  });
});

describe('validateInstructorRating', () => {
  it('accepts a well-formed instructor rating', () => {
    expect(validateInstructorRating({ liked: true, clear: 4, engaging: 3, text: 'Great.' }).ok).toBe(true);
  });

  it('rejects an out-of-range clarity score', () => {
    expect(validateInstructorRating({ liked: true, clear: 9, engaging: 3, text: null }).ok).toBe(false);
  });

  it('allows an all-empty instructor rating', () => {
    expect(validateInstructorRating({ liked: null, clear: null, engaging: null, text: null }).ok).toBe(true);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test -- validate`
Expected: FAIL - cannot resolve `@/reviews/validate`.

- [ ] **Step 5: Implement validation**

Create `src/reviews/validate.ts`:

```ts
const MAX_TEXT = 5000;
const MAX_WORKLOAD_HOURS = 100;

export type CourseRatingInput = {
  liked: boolean | null;
  useful: number | null;
  difficulty: number | null;
  workloadHours: number | null;
  text: string | null;
};

export type InstructorRatingInput = {
  liked: boolean | null;
  clear: number | null;
  engaging: number | null;
  text: string | null;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Scores are STORED 0-4. A 5 arriving here means a 1-5 display value leaked through. */
function badScore(v: number | null): boolean {
  if (v === null) return false;
  return !Number.isInteger(v) || v < 0 || v > 4;
}

function cleanText(text: string | null): string | null {
  if (text === null || text === undefined) return null;
  const trimmed = String(text).trim();
  return trimmed.length ? trimmed : null;
}

function textTooLong(text: string | null): boolean {
  return text !== null && text.length > MAX_TEXT;
}

export function validateCourseRating(input: CourseRatingInput): Result<CourseRatingInput> {
  if (badScore(input.useful)) return { ok: false, error: 'Usefulness must be a whole number from 1 to 5.' };
  if (badScore(input.difficulty)) return { ok: false, error: 'Difficulty must be a whole number from 1 to 5.' };

  const w = input.workloadHours;
  if (w !== null && (!Number.isInteger(w) || w < 0 || w > MAX_WORKLOAD_HOURS)) {
    return { ok: false, error: `Workload must be between 0 and ${MAX_WORKLOAD_HOURS} hours.` };
  }

  const text = cleanText(input.text);
  if (textTooLong(text)) return { ok: false, error: `Review must be under ${MAX_TEXT} characters.` };

  return { ok: true, value: { ...input, text } };
}

export function validateInstructorRating(
  input: InstructorRatingInput,
): Result<InstructorRatingInput> {
  if (badScore(input.clear)) return { ok: false, error: 'Clarity must be a whole number from 1 to 5.' };
  if (badScore(input.engaging)) return { ok: false, error: 'Engagement must be a whole number from 1 to 5.' };

  const text = cleanText(input.text);
  if (textTooLong(text)) return { ok: false, error: `Review must be under ${MAX_TEXT} characters.` };

  return { ok: true, value: { ...input, text } };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- validate`
Expected: PASS, 12 tests.

- [ ] **Step 7: Full suite and typecheck**

Run: `npm test` (report old 127 vs new total) and `npx tsc --noEmit` (clean).

- [ ] **Step 8: Commit**

```bash
git add prisma src/reviews/validate.ts tests/validate.test.ts
git commit -m "feat: drop redundant review column and add rating validation"
```

---

### Task 2: Pure aggregation

**Files:**
- Create: `src/reviews/aggregate.ts`
- Test: `tests/aggregate.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions over plain objects)
- Produces:
  - `aggregateCourseReviews(rows): CourseAggregate`
  - `aggregateInstructorReviews(rows): InstructorAggregate`
  - `toDisplayScore(stored: number | null): number | null` - 0-4 storage to 1-5 display
  - `toStoredScore(display: number | null): number | null` - 1-5 display to 0-4 storage
  - types `CourseAggregate`, `InstructorAggregate`

**Display rules (spec §6.2):** scalar dimensions show a mean out of 5; `liked` shows
as a percentage; counts always accompany aggregates; **no reviews shows an empty
state, never `0/5`** - a zero would read as a terrible score rather than no data.

- [ ] **Step 1: Write the failing tests**

Create `tests/aggregate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  aggregateCourseReviews,
  aggregateInstructorReviews,
  toDisplayScore,
  toStoredScore,
} from '@/reviews/aggregate';

describe('score conversion', () => {
  it('converts storage 0-4 to display 1-5', () => {
    expect(toDisplayScore(0)).toBe(1);
    expect(toDisplayScore(4)).toBe(5);
  });

  it('converts display 1-5 to storage 0-4', () => {
    expect(toStoredScore(1)).toBe(0);
    expect(toStoredScore(5)).toBe(4);
  });

  it('round-trips', () => {
    for (const d of [1, 2, 3, 4, 5]) expect(toDisplayScore(toStoredScore(d))).toBe(d);
  });

  it('passes null through both ways', () => {
    expect(toDisplayScore(null)).toBeNull();
    expect(toStoredScore(null)).toBeNull();
  });
});

describe('aggregateCourseReviews', () => {
  it('returns an empty aggregate for no reviews', () => {
    const a = aggregateCourseReviews([]);
    expect(a.count).toBe(0);
    // Never 0 - a zero would render as a terrible score rather than "no data".
    expect(a.useful).toBeNull();
    expect(a.difficulty).toBeNull();
    expect(a.likedPercent).toBeNull();
  });

  it('averages scores and reports them on the 1-5 display scale', () => {
    const a = aggregateCourseReviews([
      { liked: true, useful: 4, difficulty: 2, workloadHours: 10 },
      { liked: true, useful: 2, difficulty: 0, workloadHours: 6 },
    ]);
    expect(a.count).toBe(2);
    // stored mean 3 -> display 4
    expect(a.useful).toBeCloseTo(4);
    // stored mean 1 -> display 2
    expect(a.difficulty).toBeCloseTo(2);
  });

  it('computes liked as a percentage', () => {
    const a = aggregateCourseReviews([
      { liked: true, useful: null, difficulty: null, workloadHours: null },
      { liked: false, useful: null, difficulty: null, workloadHours: null },
      { liked: true, useful: null, difficulty: null, workloadHours: null },
    ]);
    expect(a.likedPercent).toBe(67);
  });

  it('ignores nulls rather than counting them as zero', () => {
    const a = aggregateCourseReviews([
      { liked: null, useful: 4, difficulty: null, workloadHours: null },
      { liked: null, useful: null, difficulty: null, workloadHours: null },
    ]);
    expect(a.useful).toBeCloseTo(5);
    expect(a.difficulty).toBeNull();
    expect(a.likedPercent).toBeNull();
  });

  it('averages workload in raw hours, not on the 1-5 scale', () => {
    const a = aggregateCourseReviews([
      { liked: null, useful: null, difficulty: null, workloadHours: 10 },
      { liked: null, useful: null, difficulty: null, workloadHours: 20 },
    ]);
    expect(a.workloadHours).toBeCloseTo(15);
  });
});

describe('aggregateInstructorReviews', () => {
  it('returns an empty aggregate for no reviews', () => {
    const a = aggregateInstructorReviews([]);
    expect(a.count).toBe(0);
    expect(a.clear).toBeNull();
    expect(a.engaging).toBeNull();
    expect(a.likedPercent).toBeNull();
  });

  it('averages clarity and engagement on the display scale', () => {
    const a = aggregateInstructorReviews([
      { liked: true, clear: 4, engaging: 4 },
      { liked: false, clear: 2, engaging: 0 },
    ]);
    expect(a.count).toBe(2);
    expect(a.clear).toBeCloseTo(4);
    expect(a.engaging).toBeCloseTo(3);
    expect(a.likedPercent).toBe(50);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- aggregate`
Expected: FAIL - cannot resolve `@/reviews/aggregate`.

- [ ] **Step 3: Implement aggregation**

Create `src/reviews/aggregate.ts`:

```ts
export type CourseReviewRow = {
  liked: boolean | null;
  useful: number | null;
  difficulty: number | null;
  workloadHours: number | null;
};

export type InstructorReviewRow = {
  liked: boolean | null;
  clear: number | null;
  engaging: number | null;
};

export type CourseAggregate = {
  count: number;
  likedPercent: number | null;
  useful: number | null;
  difficulty: number | null;
  workloadHours: number | null;
};

export type InstructorAggregate = {
  count: number;
  likedPercent: number | null;
  clear: number | null;
  engaging: number | null;
};

/** Storage is 0-4; users see 1-5. Convert only at the boundary. */
export function toDisplayScore(stored: number | null): number | null {
  return stored === null ? null : stored + 1;
}

export function toStoredScore(display: number | null): number | null {
  return display === null ? null : display - 1;
}

/** Mean of the non-null values, or null when there are none. */
function meanOf(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null && v !== undefined);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
}

/** Mean on the 1-5 display scale. Null stays null - never rendered as 0. */
function meanDisplay(values: (number | null)[]): number | null {
  const mean = meanOf(values);
  return mean === null ? null : mean + 1;
}

function likedPercent(values: (boolean | null)[]): number | null {
  const present = values.filter((v): v is boolean => v === true || v === false);
  if (present.length === 0) return null;
  return Math.round((present.filter(Boolean).length / present.length) * 100);
}

export function aggregateCourseReviews(rows: CourseReviewRow[]): CourseAggregate {
  return {
    count: rows.length,
    likedPercent: likedPercent(rows.map((r) => r.liked)),
    useful: meanDisplay(rows.map((r) => r.useful)),
    difficulty: meanDisplay(rows.map((r) => r.difficulty)),
    // Workload is raw hours, not a 1-5 score - no display offset.
    workloadHours: meanOf(rows.map((r) => r.workloadHours)),
  };
}

export function aggregateInstructorReviews(rows: InstructorReviewRow[]): InstructorAggregate {
  return {
    count: rows.length,
    likedPercent: likedPercent(rows.map((r) => r.liked)),
    clear: meanDisplay(rows.map((r) => r.clear)),
    engaging: meanDisplay(rows.map((r) => r.engaging)),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- aggregate`
Expected: PASS, 11 tests.

- [ ] **Step 5: Confirm purity**

```bash
grep -nE "fetch|prisma|@/lib/db|readFile|require\(" src/reviews/aggregate.ts
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/reviews/aggregate.ts tests/aggregate.test.ts
git commit -m "feat: aggregate review scores with empty-state handling"
```

---

### Task 3: Server actions - the security boundary

**Files:**
- Create: `src/app/actions/reviews.ts`
- Test: `tests/reviews-gate.test.ts`

**Interfaces:**
- Consumes: `canReview` (`@/lib/gate`), `validateCourseRating`/`validateInstructorRating`, `db`, `auth`
- Produces:
  - `submitReview(courseId, course, instructors): Promise<{ ok: true } | { ok: false; error: string }>`
  - `deleteReview(courseId): Promise<{ ok: true } | { ok: false; error: string }>`
  - `getMyReview(courseId)` - loads the current user's review for pre-filling the form

**This is the task where a mistake is expensive and quiet.** The tests below assert
the NEGATIVE cases - a non-enrolled user rejected, another user's review untouchable.
A happy-path-only test suite here would pass while the gate is wide open.

- [ ] **Step 1: Write the failing security tests**

Create `tests/reviews-gate.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { writeReviewForUser, deleteReviewForUser } from '@/app/actions/reviews';

const ENROLLED = 'zz-review-enrolled@example.com';
const STRANGER = 'zz-review-stranger@example.com';

let enrolledId: string;
let strangerId: string;
let courseId: string;
let otherCourseId: string;

beforeAll(async () => {
  process.env.SERVER_SECRET ??= 'test-secret';
  await db.user.deleteMany({ where: { email: { in: [ENROLLED, STRANGER] } } });

  enrolledId = (await db.user.create({ data: { email: ENROLLED } })).id;
  strangerId = (await db.user.create({ data: { email: STRANGER } })).id;

  const courses = await db.course.findMany({ take: 2, select: { id: true } });
  courseId = courses[0].id;
  otherCourseId = courses[1].id;

  const term = await db.term.findFirstOrThrow({ select: { id: true } });
  await db.enrollment.create({
    data: { userId: enrolledId, courseId, termId: term.id, source: 'workday', verified: true },
  });
});

afterAll(async () => {
  await db.courseReview.deleteMany({ where: { userId: { in: [enrolledId, strangerId] } } });
  await db.instructorReview.deleteMany({ where: { userId: { in: [enrolledId, strangerId] } } });
  await db.enrollment.deleteMany({ where: { userId: { in: [enrolledId, strangerId] } } });
  await db.user.deleteMany({ where: { email: { in: [ENROLLED, STRANGER] } } });
  await db.$disconnect();
});

const rating = { liked: true, useful: 3, difficulty: 2, workloadHours: 8, text: 'Fine.' };

describe('the review gate', () => {
  it('lets a verified-enrolled user write a review', async () => {
    const r = await writeReviewForUser(enrolledId, courseId, rating, []);
    expect(r.ok).toBe(true);
    expect(await db.courseReview.count({ where: { userId: enrolledId, courseId } })).toBe(1);
  });

  it('REJECTS a user with no enrollment in that course', async () => {
    const r = await writeReviewForUser(strangerId, courseId, rating, []);
    expect(r.ok).toBe(false);
    expect(await db.courseReview.count({ where: { userId: strangerId } })).toBe(0);
  });

  it('REJECTS a course the user is not enrolled in, even though they are enrolled elsewhere', async () => {
    const r = await writeReviewForUser(enrolledId, otherCourseId, rating, []);
    expect(r.ok).toBe(false);
    expect(await db.courseReview.count({ where: { userId: enrolledId, courseId: otherCourseId } })).toBe(0);
  });

  it('REJECTS a write when the enrollment exists but is unverified', async () => {
    await db.enrollment.updateMany({ where: { userId: enrolledId, courseId }, data: { verified: false } });
    const r = await writeReviewForUser(enrolledId, courseId, rating, []);
    expect(r.ok).toBe(false);
    await db.enrollment.updateMany({ where: { userId: enrolledId, courseId }, data: { verified: true } });
  });

  it('rejects an out-of-range score before touching the database', async () => {
    const r = await writeReviewForUser(enrolledId, courseId, { ...rating, useful: 99 }, []);
    expect(r.ok).toBe(false);
  });

  it('is an upsert - a second submission edits rather than duplicating', async () => {
    await writeReviewForUser(enrolledId, courseId, { ...rating, useful: 4 }, []);
    const rows = await db.courseReview.findMany({ where: { userId: enrolledId, courseId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].useful).toBe(4);
  });
});

describe('delete', () => {
  it('deletes only the requesting user\'s own review', async () => {
    await writeReviewForUser(enrolledId, courseId, rating, []);
    // A stranger cannot delete someone else's review for that course.
    const bad = await deleteReviewForUser(strangerId, courseId);
    expect(bad.ok).toBe(false);
    expect(await db.courseReview.count({ where: { userId: enrolledId, courseId } })).toBe(1);

    const good = await deleteReviewForUser(enrolledId, courseId);
    expect(good.ok).toBe(true);
    expect(await db.courseReview.count({ where: { userId: enrolledId, courseId } })).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- reviews-gate`
Expected: FAIL - cannot resolve `@/app/actions/reviews`.

- [ ] **Step 3: Implement the actions**

Create `src/app/actions/reviews.ts`. Note the split: the exported server actions
resolve the user from the session, then delegate to `writeReviewForUser` /
`deleteReviewForUser`, which take an explicit `userId`. That split is what makes
the gate testable without a live session - the tests above call the inner
functions directly.

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth';
import { canReview } from '@/lib/gate';
import {
  validateCourseRating,
  validateInstructorRating,
  type CourseRatingInput,
  type InstructorRatingInput,
} from '@/reviews/validate';

export type InstructorRatingSubmission = InstructorRatingInput & { instructorId: string };
type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * The gate lives here, server-side. Hiding the form in the UI is a
 * convenience, not a control - a forged request lands in this function.
 */
export async function writeReviewForUser(
  userId: string,
  courseId: string,
  course: CourseRatingInput,
  instructors: InstructorRatingSubmission[],
): Promise<ActionResult> {
  if (!(await canReview(userId, courseId))) {
    return { ok: false, error: 'You can only review courses you have taken.' };
  }

  const courseCheck = validateCourseRating(course);
  if (!courseCheck.ok) return courseCheck;

  const checked: InstructorRatingSubmission[] = [];
  for (const entry of instructors) {
    const result = validateInstructorRating(entry);
    if (!result.ok) return result;
    checked.push({ ...result.value, instructorId: entry.instructorId });
  }

  await db.$transaction(async (tx) => {
    await tx.courseReview.upsert({
      where: { userId_courseId: { userId, courseId } },
      create: { userId, courseId, ...courseCheck.value },
      update: { ...courseCheck.value },
    });

    // The submitted selection is the complete intended state, so instructor
    // reviews the user removed must be deleted, not left behind.
    await tx.instructorReview.deleteMany({
      where: {
        userId,
        courseId,
        instructorId: { notIn: checked.map((c) => c.instructorId) },
      },
    });

    for (const entry of checked) {
      const { instructorId, ...values } = entry;
      await tx.instructorReview.upsert({
        where: { userId_instructorId_courseId: { userId, instructorId, courseId } },
        create: { userId, instructorId, courseId, ...values },
        update: { ...values },
      });
    }
  });

  return { ok: true };
}

export async function deleteReviewForUser(
  userId: string,
  courseId: string,
): Promise<ActionResult> {
  const existing = await db.courseReview.findUnique({
    where: { userId_courseId: { userId, courseId } },
    select: { id: true },
  });
  // Ownership is enforced by the composite key, not a client-supplied id.
  if (!existing) return { ok: false, error: 'No review to delete.' };

  await db.$transaction(async (tx) => {
    await tx.instructorReview.deleteMany({ where: { userId, courseId } });
    await tx.courseReview.delete({ where: { userId_courseId: { userId, courseId } } });
  });

  return { ok: true };
}

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function submitReview(
  courseId: string,
  courseCode: string,
  course: CourseRatingInput,
  instructors: InstructorRatingSubmission[],
): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to write a review.' };

  const result = await writeReviewForUser(userId, courseId, course, instructors);
  if (result.ok) revalidatePath(`/course/${courseCode}`);
  return result;
}

export async function deleteReview(
  courseId: string,
  courseCode: string,
): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to manage your reviews.' };

  const result = await deleteReviewForUser(userId, courseId);
  if (result.ok) revalidatePath(`/course/${courseCode}`);
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- reviews-gate`
Expected: PASS, 7 tests.

- [ ] **Step 5: Full suite and typecheck**

Run `npm test` and `npx tsc --noEmit`; both clean. Report totals.

- [ ] **Step 6: Commit**

```bash
git add src/app/actions/reviews.ts tests/reviews-gate.test.ts
git commit -m "feat: add gate-checked review write and delete actions"
```

---

### Task 4: The review form

**Files:**
- Create: `src/app/course/[code]/review/page.tsx`, `src/app/course/[code]/review/form.tsx`

**Interfaces:**
- Consumes: `submitReview`, `deleteReview` (Task 3); `canReview` (Phase 2); `toDisplayScore`/`toStoredScore` (Task 2); `db`
- Produces: route `/course/<code>/review`

**Behaviour:**
- Server component loads the course, checks `canReview`, and redirects to the course
  page if the gate fails - the form is never rendered to someone who cannot submit.
- Loads any existing review and passes it to the client form for **pre-filling**.
- Instructor dropdown lists every instructor who taught this course, from
  `SectionInstructor` - de-duplicated, since one instructor teaches many sections.
- Scores render as 1-5 and convert to 0-4 storage on submit (`toStoredScore`).

- [ ] **Step 1: Build the server component**

Create `src/app/course/[code]/review/page.tsx`:

```tsx
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { canReview } from '@/lib/gate';
import { parseCourseCode } from '@/lib/format';
import { ReviewForm } from './form';

export default async function ReviewPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const parsed = parseCourseCode(code);
  if (!parsed) notFound();

  const session = await auth();
  if (!session?.user?.id) redirect(`/login`);

  const course = await db.course.findFirst({
    where: { number: parsed.number, subject: { code: parsed.subjectCode, campus: 'V' } },
    include: {
      subject: true,
      sections: { include: { instructors: { include: { instructor: true } } } },
    },
  });
  if (!course) notFound();

  // The gate decides, server-side. Never render the form to someone who
  // cannot submit - and the action re-checks anyway.
  if (!(await canReview(session.user.id, course.id))) redirect(`/course/${code}`);

  // One instructor teaches many sections; show each once.
  const instructors = [
    ...new Map(
      course.sections
        .flatMap((s) => s.instructors.map((si) => si.instructor))
        .map((i) => [i.id, i]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const existing = await db.courseReview.findUnique({
    where: { userId_courseId: { userId: session.user.id, courseId: course.id } },
  });

  const existingInstructors = await db.instructorReview.findMany({
    where: { userId: session.user.id, courseId: course.id },
  });

  return (
    <ReviewForm
      courseId={course.id}
      courseCode={code}
      courseLabel={`${course.subject.code} ${course.number}`}
      courseTitle={course.title}
      instructors={instructors.map((i) => ({ id: i.id, name: i.name }))}
      existing={
        existing && {
          liked: existing.liked,
          useful: existing.useful,
          difficulty: existing.difficulty,
          workloadHours: existing.workloadHours,
          text: existing.text,
        }
      }
      existingInstructors={existingInstructors.map((r) => ({
        instructorId: r.instructorId,
        liked: r.liked,
        clear: r.clear,
        engaging: r.engaging,
        text: r.text,
      }))}
    />
  );
}
```

Note what is **not** passed to the client: no `userId`, no other user's review data.

- [ ] **Step 2: Build the client form**

Create `src/app/course/[code]/review/form.tsx` as a client component (`'use client'`).

Requirements, all load-bearing:

1. **Course section**: `liked` (yes/no toggle), `useful` and `difficulty` as 1-5
   button groups, `workloadHours` number input, `text` textarea.
2. **Difficulty must be labelled so its direction is unambiguous** - e.g.
   `1 = very easy` … `5 = very hard`. The spec's whole point about direction is
   defeated if the UI leaves users guessing.
3. **Instructor section**: a checkbox per instructor from `instructors`; checking one
   reveals its `liked` / `clear` / `engaging` / `text` inputs. Pre-check any instructor
   present in `existingInstructors`.
4. On submit, call `submitReview(courseId, courseCode, course, instructors)` with scores
   converted via `toStoredScore`, then `router.push('/course/' + courseCode)`.
5. Show a **delete button only when `existing` is non-null**, calling `deleteReview`.
6. Show returned errors inline; never swallow a failed submission silently.
7. Match the established visual style: `mx-auto max-w-2xl px-6 py-10`, `slate` text,
   `bg-blue-700` buttons.

- [ ] **Step 3: Verify the gate live**

Start the dev server. As a signed-in user WITHOUT an enrollment in some course,
visit `/course/<that-code>/review` and confirm you are redirected to the course
page rather than shown the form.

Then, as a user WITH a verified enrollment (upload a real Workday export via
`/onboarding` if needed), visit the review route for one of those courses and
confirm the form renders with the correct instructor list.

- [ ] **Step 4: Commit**

```bash
git add "src/app/course/[code]/review"
git commit -m "feat: add the combined course and instructor review form"
```

---

### Task 5: Display on course and professor pages

**Files:**
- Modify: `src/app/course/[code]/page.tsx`, `src/app/professor/[slug]/page.tsx`

**Interfaces:**
- Consumes: `aggregateCourseReviews`, `aggregateInstructorReviews` (Task 2); `canReview`; `auth`; `db`

**Requirements:**
- Course page shows the course aggregate (`liked %`, `useful`, `difficulty`, average
  workload) with the review count, then the anonymous review list, newest first.
- Professor page shows the instructor aggregate and their reviews.
- **No author identity is rendered anywhere.** Do not select `userId` into anything
  that reaches the markup.
- A "Write a review" link appears only when `canReview` passes; if the user already
  has a review, it reads "Edit your review".
- **Empty state**: no reviews shows an explicit message, never `0/5`.
- Review text renders as plain text - no `dangerouslySetInnerHTML`.

- [ ] **Step 1: Add aggregates and the review list to the course page**

Modify `src/app/course/[code]/page.tsx`. Fetch reviews alongside the existing query,
selecting only display-safe fields:

```ts
  const reviews = await db.courseReview.findMany({
    where: { courseId: course.id },
    // userId is deliberately NOT selected - reviews are anonymous (spec 5).
    select: {
      id: true,
      liked: true,
      useful: true,
      difficulty: true,
      workloadHours: true,
      text: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const stats = aggregateCourseReviews(reviews);

  const session = await auth();
  const mayReview = session?.user?.id
    ? await canReview(session.user.id, course.id)
    : false;
  const myReview = session?.user?.id
    ? await db.courseReview.findUnique({
        where: { userId_courseId: { userId: session.user.id, courseId: course.id } },
        select: { id: true },
      })
    : null;
```

Render a ratings block above the sections table, and the review list below it.
Show `stats.count` next to the aggregates. When `stats.count === 0`, render
"No reviews yet" rather than any numeric score.

- [ ] **Step 2: Add the same to the professor page**

Modify `src/app/professor/[slug]/page.tsx` to fetch `instructorReview` rows for that
instructor (again **without** `userId`), aggregate them, and render the stats plus the
anonymous review list.

- [ ] **Step 3: Verify no identity leaks**

This is a spec-mandated security property, so check it directly rather than by eye:

```bash
grep -n "userId" "src/app/course/[code]/page.tsx" "src/app/professor/[slug]/page.tsx"
```

Every hit must be inside a `where:` clause (querying the signed-in user's OWN review),
never inside a `select:` for the public list and never passed into JSX.

- [ ] **Step 4: Verify live end to end**

Start the dev server and, as a verified-enrolled user:
1. Write a review via `/course/<code>/review`.
2. Confirm the course page now shows the aggregate with a count of 1 and your review text.
3. Confirm the professor page for a rated instructor shows their aggregate.
4. Edit the review; confirm the page updates rather than gaining a second review.
5. Delete it; confirm the page returns to the empty state and shows no `0/5`.
6. View the same course page **signed out** and confirm no author information appears.

- [ ] **Step 5: Full verification**

Run `npm test`, `npx tsc --noEmit`, `npx eslint .`, and `npm run build` - all clean.
Report totals.

- [ ] **Step 6: Commit**

```bash
git add "src/app/course/[code]/page.tsx" "src/app/professor/[slug]/page.tsx"
git commit -m "feat: show review aggregates and anonymous review lists"
```

---

## Phase 3 completion criteria

- [ ] `npm test` passes; `npx tsc --noEmit`, `npx eslint .`, and `npm run build` all clean
- [ ] A verified-enrolled student can submit a combined course + instructor review
- [ ] A student with no verified enrollment is rejected **server-side**, not merely hidden from the UI
- [ ] Re-submitting edits rather than duplicating; delete removes the review and its instructor reviews
- [ ] Deselecting an instructor on edit removes that instructor review
- [ ] Course and professor pages show aggregates with counts, and an empty state rather than `0/5`
- [ ] No reviewer identity appears anywhere in the rendered output
- [ ] `difficulty` is stored and displayed with higher = harder, and the form labels the direction
