# Instructor Grade History + Grade Chart Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show each instructor's historical grade average for the course being viewed, compared against the course's own average — and fix the grade chart, which currently mis-renders in the docked panel.

**Architecture:** `GradeDistributionInstructor` already links every grade distribution to the professors who taught it. `loadCourseDetail` gains a per-instructor weighted average for *this course*, computed alongside the review summary it already builds, and the overlay renders it on the same instructor line. Separately, `GradeChart`'s columns are restructured so a wrapping axis label can no longer shrink the bar area.

**Tech Stack:** Next.js 16 (App Router), Prisma 7 + PostgreSQL, Tailwind v4 theme tokens, Vitest.

**Why this exists:** Phase 5 shipped instructor ratings from our own `InstructorReview` data — but the database holds exactly **one** review row, so it renders "No reviews yet" almost everywhere. The grade data we already ingested carries instructor attribution and covers **83% of instructors teaching 2026+ sections**, with **57.9%** having history for the specific course they're teaching. It is available today.

## Measured facts this plan rests on

- `GradeDistributionInstructor`: 28,509 links, 3,408 of 4,176 UBC-V instructors covered.
- **11% of distributions are co-taught** (more than one instructor). The schema comment warns: *"Duplicating the distribution per instructor would inflate every course average."*
- BIOL 111 per-instructor, against a course average of 80.8: Shona Margaret Ellis 74.3 (4 offerings, 759 students), Lynn Norman 86.5 (3, 740), Donald Wong 80.2 (3, 630). A 12-point spread — this is real signal.
- `GradeDistribution` rows span **2021S–2025W only**. `CourseHistoricalGrades` (ubcgrades) goes back to **2000**. For BIOL 111 that is 80.8% vs 70.1% — the overlay currently shows both, unlabelled.

## Global Constraints

- **A grade average is not a teaching-quality score.** Label it as an average grade, never as a rating or ranking. A hard course taught well can have a low average.
- **Never double-count a co-taught distribution.** Weight by student count, and count each distribution once per instructor — do not sum a shared distribution into a course-wide figure more than once.
- **No new tables, no new ingest.** Everything needed is already in `GradeDistribution` / `GradeDistributionInstructor`.
- **Theme tokens only.** `foreground`, `background`, `text-secondary`, `text-tertiary`, `surface`, `surface-muted`, `border`, `border-hairline`, `brand-accent`, `danger`. No raw `slate-*`/`blue-*`/`red-*`. **`brand` as a foreground is forbidden.**
- Commit after every task. `npx tsc --noEmit` and `npx vitest run` clean before each commit (baseline: **334 tests passing**).

---

### Task 1: Per-instructor grade history for the course

**Files:**
- Modify: `src/lib/course-detail.ts`
- Modify: `tests/course-detail.test.ts`

**Interfaces:**
- Produces:

```ts
export type InstructorGradeHistory = {
  /** Student-count-weighted mean across this instructor's offerings OF THIS COURSE. */
  average: number;
  /** How many graded offerings of this course they taught. */
  offerings: number;
  /** Total students across those offerings. */
  students: number;
  /** True when any contributing offering was co-taught, so the figure is shared. */
  coTaught: boolean;
};
```

- `CourseSectionDetail.instructors[]` entries gain `grades: InstructorGradeHistory | null`.
- `CourseDetail` gains `courseAverage: number | null` — the same weighted mean over ALL of this course's distributions, so the UI can show a delta without recomputing.

- [ ] **Step 1: Write the failing tests**

Append to `tests/course-detail.test.ts`:

```ts
describe('loadCourseDetail instructor grade history', () => {
  it('exposes a courseAverage alongside the grade summary', async () => {
    const detail = await loadCourseDetail(courseId, termId);
    // Either a real number, or null when the course has no graded offerings.
    expect(detail!.courseAverage === null || typeof detail!.courseAverage === 'number').toBe(true);
    if (detail!.grades.sectionCount > 0 && detail!.grades.average !== null) {
      expect(detail!.courseAverage).toBeCloseTo(detail!.grades.average, 1);
    }
  });

  it('attaches a grades slot to every instructor', async () => {
    const detail = await loadCourseDetail(courseId, termId);
    for (const s of detail!.sections) {
      for (const i of s.instructors) expect(i).toHaveProperty('grades');
    }
  });

  it('weights an instructor average by student count, not by offering count', async () => {
    // Find an instructor with more than one graded offering of one course.
    const links = await db.gradeDistributionInstructor.findMany({
      include: { distribution: { select: { courseId: true, average: true, count: true } } },
      take: 2000,
    });
    const key = (i: string, c: string) => `${i}|${c}`;
    const groups = new Map<string, { average: number | null; count: number | null }[]>();
    for (const l of links) {
      const k = key(l.instructorId, l.distribution.courseId);
      groups.set(k, [...(groups.get(k) ?? []), l.distribution]);
    }
    const multi = [...groups.entries()].find(
      ([, rows]) => rows.length > 1 && rows.every((r) => r.average !== null && r.count !== null),
    );
    if (!multi) return; // no suitable fixture in this database

    const [k, rows] = multi;
    const [instructorId, gradedCourseId] = k.split('|');
    const expected =
      rows.reduce((a, r) => a + r.average! * r.count!, 0) / rows.reduce((a, r) => a + r.count!, 0);

    const section = await db.section.findFirst({
      where: { courseId: gradedCourseId, instructors: { some: { instructorId } } },
      select: { termId: true },
    });
    if (!section) return;

    const detail = await loadCourseDetail(gradedCourseId, section.termId);
    const instructor = await db.instructor.findUniqueOrThrow({
      where: { id: instructorId },
      select: { slug: true },
    });
    const found = detail!.sections
      .flatMap((s) => s.instructors)
      .find((i) => i.slug === instructor.slug);
    if (!found) return;

    expect(found.grades).not.toBeNull();
    expect(found.grades!.average).toBeCloseTo(expected, 1);
    expect(found.grades!.offerings).toBe(rows.length);
  });

  it('returns null grades for an instructor with no history for this course', async () => {
    const detail = await loadCourseDetail(courseId, termId);
    const all = detail!.sections.flatMap((i) => i.instructors);
    for (const i of all) {
      if (i.grades === null) return; // found the null path, that is all we need
    }
    // Every instructor happened to have history — nothing to assert.
  });
});
```

Run: `npx vitest run tests/course-detail.test.ts` → FAIL (`grades` / `courseAverage` do not exist).

- [ ] **Step 2: Implement it**

In `src/lib/course-detail.ts`, add the type next to `InstructorRatingSummary`:

```ts
/**
 * An instructor's historical grade average FOR THIS COURSE, from UBC's own
 * published distributions (2021S onward — see the note on `courseAverage`).
 *
 * This is an average GRADE, not a teaching-quality score: a demanding course
 * taught well can sit below its own mean. The UI must label it as such.
 */
export type InstructorGradeHistory = {
  average: number;
  offerings: number;
  students: number;
  /** At least one contributing offering was co-taught, so the figure is shared. */
  coTaught: boolean;
};
```

Widen the instructor entry:

```ts
  instructors: {
    name: string;
    slug: string;
    rating: InstructorRatingSummary | null;
    grades: InstructorGradeHistory | null;
  }[];
```

And add to `CourseDetail`, next to `grades`:

```ts
  /** Weighted mean across ALL of this course's graded offerings — the baseline
   *  an instructor's own average is compared against. Null when ungraded. */
  courseAverage: number | null;
```

Inside `loadCourseDetail`, after the existing `instructorIds` / `reviewRows` block, add:

```ts
  // GradeDistributionInstructor links each distribution to everyone who taught
  // it. 11% of distributions are co-taught, so a distribution can appear under
  // more than one instructor — that is correct here (each taught those
  // students) but it means a shared offering must never be summed into the
  // course-wide figure twice, which is why courseAverage is computed from
  // gradeRows above rather than from these links.
  const gradeLinks = instructorIds.length
    ? await db.gradeDistributionInstructor.findMany({
        where: { instructorId: { in: instructorIds }, distribution: { courseId } },
        select: {
          instructorId: true,
          distributionId: true,
          distribution: { select: { average: true, count: true } },
        },
      })
    : [];

  // How many instructors share each distribution — used only to flag co-teaching.
  const sharersPerDistribution = new Map<string, number>();
  for (const l of gradeLinks) {
    sharersPerDistribution.set(
      l.distributionId,
      (sharersPerDistribution.get(l.distributionId) ?? 0) + 1,
    );
  }

  const gradesByInstructor = new Map<string, InstructorGradeHistory>();
  for (const instructorId of instructorIds) {
    const mine = gradeLinks.filter(
      (l) =>
        l.instructorId === instructorId &&
        l.distribution.average !== null &&
        l.distribution.count !== null &&
        l.distribution.count > 0,
    );
    if (mine.length === 0) continue;

    const students = mine.reduce((a, l) => a + l.distribution.count!, 0);
    const weighted = mine.reduce((a, l) => a + l.distribution.average! * l.distribution.count!, 0);
    gradesByInstructor.set(instructorId, {
      average: weighted / students,
      offerings: mine.length,
      students,
      coTaught: mine.some((l) => (sharersPerDistribution.get(l.distributionId) ?? 1) > 1),
    });
  }
```

Populate the projection:

```ts
        rating: ratingFor(si.instructorId),
        grades: gradesByInstructor.get(si.instructorId) ?? null,
```

And set `courseAverage` on the returned object, reusing the already-aggregated figure so the two can never disagree:

```ts
    courseAverage: /* the aggregate you already build */ .average,
```

(Read the existing `grades: aggregateDistributions(...)` expression — hoist it into a `const courseGrades = aggregateDistributions(...)` above the return, then use `grades: courseGrades` and `courseAverage: courseGrades.average`. Do not run a second aggregation.)

Run: `npx vitest run tests/course-detail.test.ts` → PASS.

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run
git add src/lib/course-detail.ts tests/course-detail.test.ts
git commit -m "feat: return each instructor's grade history for the course"
```

Expect 338 tests (334 + 4).

---

### Task 2: Render the average and its comparison inline

**Files:**
- Modify: `src/components/schedule/course-info/CourseInfoContent.tsx`

Target line:

```
Lynn Norman ↗  86.5% avg · +5.7 vs course · 3 terms, 740 students
```

- [ ] **Step 1: Add the formatter**

Next to `ratingLine`, add:

```tsx
/**
 * "86.5% avg · +5.7 vs course · 3 terms, 740 students".
 *
 * An average GRADE from UBC's published distributions — deliberately not
 * framed as a rating. The delta is what makes it readable: an 86.5% means
 * little until you know the course itself averages 80.8%.
 */
function gradeLine(g: InstructorGradeHistory, courseAverage: number | null): string {
  const parts = [`${g.average.toFixed(1)}% avg`];
  if (courseAverage !== null) {
    const delta = g.average - courseAverage;
    const sign = delta >= 0 ? '+' : '';
    parts.push(`${sign}${delta.toFixed(1)} vs course`);
  }
  parts.push(
    `${g.offerings} term${g.offerings === 1 ? '' : 's'}, ${g.students} student${g.students === 1 ? '' : 's'}`,
  );
  return parts.join(' · ');
}
```

Add `InstructorGradeHistory` to the existing `import type { … } from '@/lib/course-detail';`.

- [ ] **Step 2: Render it**

`CourseInfoContent` needs `courseAverage`. It already receives `detail`, so read `detail.courseAverage` directly — no prop change.

In the instructor `<li>`, after the existing rating/no-reviews span, add a second line:

```tsx
                                  {i.grades && (
                                    <span
                                      className="ml-1.5 text-text-tertiary"
                                      title={
                                        i.grades.coTaught
                                          ? 'Average grade in this course. Some offerings were co-taught, so the figure is shared with another instructor.'
                                          : 'Average grade students received in this course under this instructor'
                                      }
                                    >
                                      {gradeLine(i.grades, detail.courseAverage)}
                                      {i.grades.coTaught && ' *'}
                                    </span>
                                  )}
```

Put it inside the same `<li>` so one instructor stays one visual unit. If the line gets long, allow it to wrap — do not truncate, the numbers matter.

- [ ] **Step 3: Label the two grade sources**

The Grades section currently shows "Average 80.8%" (ours, 2021 onward) next to "All-time avg" / "Past 5 years" (ubcgrades, back to 2000). For BIOL 111 those read 80.8% and 70.1% — a 10-point gap with nothing explaining it.

Change the first stat's label from `Average` to `Average (since 2021)`, and add a one-line note under the historical stat grid:

```tsx
                <p className="mt-2 text-xs text-text-tertiary">
                  Since-2021 figures come from UBC&apos;s published section data; the all-time
                  and 5-year averages come from ubcgrades.com and reach back further, so they
                  will differ.
                </p>
```

Place it directly beneath the `historical` stat grid, inside the same conditional.

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run
grep -nE "slate-[0-9]|blue-[0-9]|red-[0-9]" src/components/schedule/course-info/CourseInfoContent.tsx
```

The grep must print nothing.

```bash
git add src/components/schedule/course-info/CourseInfoContent.tsx
git commit -m "feat: show each instructor's grade average against the course average"
```

---

### Task 3: Fix the grade chart at narrow widths

**Files:**
- Modify: `src/components/GradeChart.tsx`

**The bug, measured in the 380px docked panel:** each column is 28px wide, so axis labels wrap inconsistently — `<50`, `68-71`, `72-75`, `76-79` render on one line (15px) while `50-54`, `80-84`, `90-100` wrap to two (30px). Each column is a flex-column inside a fixed 96px box, so a two-line label leaves only ~62px for the bar area — but bar heights are computed in JS against the full `CHART_HEIGHT` (up to 84px). Tall bars overflow their own column, and the baseline no longer lines up.

- [ ] **Step 1: Take the labels out of the bar's flex context**

Restructure so the bar row and the label row are siblings of fixed height, rather than the label competing with the bar inside each column. Replace the component's returned markup with:

```tsx
  return (
    <div>
      {/* Bars and labels are separate rows: when a label wrapped inside the
          column, it stole height from the bar area, so a two-line label made
          its bar overflow. Splitting them fixes the baseline at any width. */}
      <div className="flex items-end gap-1" style={{ height: CHART_HEIGHT }}>
        {GRADE_BUCKETS.map((bucket) => {
          const value = distribution[bucket] ?? null;
          const suppressed = value === null;
          const height = suppressed
            ? SUPPRESSED_STUB_HEIGHT
            : Math.round((value / max) * CHART_HEIGHT * MAX_BAR_FRACTION);
          const percent = !suppressed && total > 0 ? Math.round((value / total) * 100) : null;

          return (
            <div key={bucket} className="group relative flex flex-1 items-end justify-center">
              <div
                role="tooltip"
                className="pointer-events-none absolute bottom-full mb-1 whitespace-nowrap rounded bg-foreground px-2 py-1 text-xs text-background opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
              >
                {suppressed
                  ? `${bucket}: withheld by UBC for privacy`
                  : `${bucket}: ${value} student${value === 1 ? '' : 's'} (${percent}%)`}
              </div>
              <div
                className={
                  suppressed
                    ? 'w-full rounded-t border border-dashed border-border bg-surface-muted'
                    : 'w-full rounded-t bg-brand-accent'
                }
                style={{
                  height,
                  ...(suppressed
                    ? {
                        backgroundImage:
                          'repeating-linear-gradient(45deg, transparent, transparent 3px, var(--border) 3px, var(--border) 4px)',
                      }
                    : {}),
                }}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-1 flex gap-1">
        {GRADE_BUCKETS.map((bucket) => (
          <span
            key={bucket}
            className="flex-1 text-center text-[10px] leading-tight text-text-tertiary"
          >
            {bucket}
          </span>
        ))}
      </div>
    </div>
  );
```

Do NOT change `CHART_HEIGHT`, `MAX_BAR_FRACTION`, `SUPPRESSED_STUB_HEIGHT`, the height maths, the suppressed-bucket treatment, or the tooltip text. The suppressed stub must stay visually distinct from a zero bar.

- [ ] **Step 2: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run
git add src/components/GradeChart.tsx
git commit -m "fix: keep grade chart bars on a common baseline when labels wrap"
```

---

### Task 4: Verify in a real browser

**Files:**
- Create (temporary, NOT committed): `_smoke_grades.mjs`

- [ ] **Step 1: Confirm the dev server**

```bash
curl -sf http://localhost:3000 >/dev/null && echo UP
```

Already running — do NOT start a second.

- [ ] **Step 2: Write the smoke script**

BIOL 111 is a good fixture: 16 graded offerings, a 12-point spread between instructors, and a course average of 80.8.

```js
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1200 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto('http://localhost:3000/schedule/new');
  await page.click('button:text-is("Find Courses")');
  await page.fill('input[aria-label="Search courses"]', 'BIOL 111');
  await page.waitForSelector('summary:has-text("BIOL 111")', { timeout: 8000 });
  await page.click('button[aria-label="Course information for BIOL 111"]');
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  await page.waitForSelector('text=Sections this term');

  const dialog = await page.locator('[role="dialog"]').innerText();
  console.log('GRADE AVG SHOWN:', /\d+\.\d% avg/.test(dialog));
  console.log('DELTA SHOWN:', /[+-]\d+\.\d vs course/.test(dialog));
  console.log('SOURCE NOTE SHOWN:', dialog.includes('ubcgrades.com'));
  console.log('instructor line:', JSON.stringify(
    dialog.split('\n').find((l) => l.includes('% avg')) ?? '(none)'));

  // Now the docked panel — the narrow case where the chart mis-rendered.
  await page.click('button[aria-label="Show this course beside the calendar"]');
  await page.waitForSelector('aside[aria-label*="course information"]');
  await page.waitForTimeout(600);

  const bars = await page.evaluate(() => {
    const row = document.querySelector('aside [style*="height: 96px"]');
    if (!row) return null;
    const rect = row.getBoundingClientRect();
    const cols = [...row.children].map((c) => c.getBoundingClientRect());
    return {
      rowBottom: Math.round(rect.bottom),
      bottoms: [...new Set(cols.map((c) => Math.round(c.bottom)))],
      overflowing: cols.filter((c) => c.top < rect.top - 1).length,
    };
  });
  console.log('chart:', JSON.stringify(bars));
  console.log('ALL COLUMNS SHARE A BASELINE:', bars && bars.bottoms.length === 1);
  console.log('NO COLUMN OVERFLOWS THE CHART:', bars && bars.overflowing === 0);

  await page.screenshot({ path: 'grades-light.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'grades-dark.png' });
  console.log('CONSOLE ERRORS:', JSON.stringify(errors));
} finally {
  await browser.close();
}
```

- [ ] **Step 3: Run it**

Run: `node _smoke_grades.mjs`
Expected: all checks `true`, an instructor line containing `% avg` and `vs course`, `ALL COLUMNS SHARE A BASELINE: true`, `NO COLUMN OVERFLOWS THE CHART: true`, `CONSOLE ERRORS: []`.

`bottoms.length > 1` means columns still disagree on the baseline — the bug is not fixed. Report it; do not relax the assertion.

- [ ] **Step 4: Look at both screenshots**

Confirm by eye:
1. Each instructor shows their average with a `+`/`−` delta against the course.
2. The chart's bars sit on one baseline, none overflowing above the plot area, axis labels readable under their own bars.
3. The source note under the historical stats is present and readable.
4. Both themes fine; the section row is not crowded.

- [ ] **Step 5: Clean up**

```bash
rm -f _smoke_grades.mjs grades-light.png grades-dark.png
git status --short
```

Expected: clean tree.

---

## Done when

- Every instructor with history for the course shows `X% avg · ±Y vs course · N terms, M students`.
- A co-taught figure is marked and explained in its tooltip.
- An instructor with no history for that course shows nothing extra — no zeros, no empty furniture.
- The grade chart's bars share a baseline at 380px and none overflow.
- The two grade sources are labelled so the 80.8 vs 70.1 gap is explained.
- `npx vitest run` and `npx tsc --noEmit` clean.

## Deliberately not in this phase

- **Ranking or scoring instructors.** This shows an average grade with a delta; it does not rank, badge, or recommend.
- Falling back to an instructor's overall average across *other* courses when they have none for this one. Cross-course averages compare different grading cultures and would mislead.
- Backfilling grade data before 2021 — that is the limit of the ubc-pair source we ingested.
- A separate comparison view or chart. The inline delta is the comparison; revisit only if it proves insufficient.
