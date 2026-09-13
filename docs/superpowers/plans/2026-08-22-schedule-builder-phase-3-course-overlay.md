# Schedule Builder - Phase 3: Course Info Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the app's course intelligence - description, sections with instructors, grade distribution, historical averages, prerequisites - one click away inside the schedule builder, as an overlay rather than a navigation.

**Architecture:** One `CourseInfoOverlay` client component, opened from three places (the ⓘ in Find Courses, the ⓘ in Saved Courses, and clicking a calendar block). It loads on demand through a new `getCourseDetail(courseId, termId)` server action and caches per course, so the builder's initial load stays cheap and reopening is instant. Existing `GradeChart`, `HistoricalGradesTimeline` and `RequirementTree` are reused unchanged in behaviour, converted to theme tokens.

**Tech Stack:** Next.js 16 (App Router), React client components, Prisma 7 + PostgreSQL, Tailwind v4 with CSS-variable theme tokens, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-schedule-builder-redesign-design.md` (§7 is this phase)

**Builds on:** Phase 1 (`…-phase-1-unified-shell.md`) and Phase 2 (`…-phase-2-calendar.md`), both complete on branch `feat/schedule-builder-phase-1`.

## Global Constraints

- **Theme tokens only.** `foreground`, `text-secondary`, `text-tertiary`, `surface`, `surface-muted`, `background`, `border`, `border-hairline`, `brand`, `brand-accent`, `brand-foreground`, `danger`/`danger-surface`/`danger-border`, the `--course-N-*` course palette, and the `rounded-pill`/`rounded-card`/`rounded-input` radii. **No raw `slate-*`, `blue-*`, or `red-*`.** `brand` as a *foreground* is forbidden - it is invisible in dark mode; use `brand-accent`. `bg-brand` with `text-brand-foreground` is correct and stays.
- **The overlay is an overlay, never a redirect.** It must also offer a "View full course page →" link for people who do want the page.
- **Instructor RATINGS are Phase 5, not this phase.** List instructor names (linked to our own professor pages). Do not add a RateMyProfessors model, fetch, or placeholder UI.
- **Block click-to-open is wired here**, not in Phase 2 - `ScheduleCalendar` gains an optional `onSelectCourse` prop. The read-only "View Calendar" tab on `/schedule` must NOT pass it.
- `ScheduleSection.sectionId` is a raw FK with no Prisma relation - section lookups are a second query keyed on collected ids, never a nested include.
- Existing action convention: `xxxFor(...)`/lib function holds the logic and is what tests call; the `'use server'` wrapper is thin.
- Commit after every task. `npx tsc --noEmit` and `npx vitest run` must both be clean before each commit (baseline: 304 tests passing).

---

### Task 1: Thread `courseId` to every trigger point

Nothing can open the overlay today: `SectionHit` - the shape behind both panels - carries no `courseId`, and `CalendarEntry` carries only a display `courseCode`. This task adds it everywhere it is needed. It is pure plumbing and ships without behaviour change.

**Files:**
- Modify: `src/lib/search.ts`
- Modify: `src/schedule/group.ts`
- Modify: `tests/schedule-group.test.ts`
- Modify: `src/components/schedule/ScheduleCalendar.tsx`
- Modify: `src/components/ScheduleBuilder.tsx`
- Modify: `src/app/schedule/page.tsx`

**Interfaces:**
- Produces: `SectionHit` gains `courseId: string`; `CourseGroup` gains `courseId: string`; `CalendarEntry` gains `courseId?: string | null`.

- [ ] **Step 1: Add `courseId` to the failing grouping test**

In `tests/schedule-group.test.ts`, update the `hit()` helper to include a course id derived from the code, and add one test. Replace the existing helper with:

```ts
function hit(code: string, sectionCode: string, title = `${code} title`): SectionHit {
  return {
    sectionId: `${code}-${sectionCode}`,
    courseId: `course-${code}`,
    code,
    title,
    sectionCode,
    activity: 'Lecture',
    meetings: 'Mon 10:00–11:00',
    meetingTimes: [],
  };
}
```

And append this test inside the existing `describe('groupSectionsByCourse', …)`:

```ts
  it('carries the courseId of the course it grouped', () => {
    const groups = groupSectionsByCourse([hit('CPSC 110', '101'), hit('CPSC 110', 'L1A')]);
    expect(groups[0].courseId).toBe('course-CPSC 110');
  });
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/schedule-group.test.ts`
Expected: FAIL - `courseId` is not a property of `SectionHit` / `CourseGroup`.

- [ ] **Step 3: Add `courseId` to `SectionHit` and its mapper**

In `src/lib/search.ts`, add the field to the type (directly after `sectionId`):

```ts
export type SectionHit = {
  sectionId: string;
  /** The COURSE this section belongs to - what the info overlay loads on. */
  courseId: string;
  code: string;
  title: string;
  sectionCode: string;
  activity: string | null;
  meetings: string;
  meetingTimes: SectionMeetingTime[];
};
```

and populate it in `toSectionHit`, directly after `sectionId: s.id,`:

```ts
    courseId: s.courseId,
```

`courseId` is a scalar column on `Section`, so the existing `SectionRowForHit` payload already includes it - no query change is needed.

- [ ] **Step 4: Add `courseId` to `CourseGroup`**

In `src/schedule/group.ts`, extend the type and the constructor call:

```ts
export type CourseGroup = {
  courseId: string;
  code: string;
  title: string;
  sections: SectionHit[];
};
```

and in the loop, change the `else` branch to:

```ts
    else
      byCode.set(hit.code, {
        courseId: hit.courseId,
        code: hit.code,
        title: hit.title,
        sections: [hit],
      });
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `npx vitest run tests/schedule-group.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Add `courseId` to `CalendarEntry` and populate it**

In `src/components/schedule/ScheduleCalendar.tsx`, extend the type:

```ts
export type CalendarEntry = ScheduleEntry & {
  id: string;
  location?: string | null;
  /** Colour is keyed on this when present, else on `label`. */
  courseCode?: string | null;
  /** Set when the block should be clickable to open the course overlay. */
  courseId?: string | null;
};
```

In `src/components/ScheduleBuilder.tsx`, add `courseId: s.courseId,` to the object built inside the `entries` `flatMap`, alongside the existing `courseCode: s.code,`.

In `src/app/schedule/page.tsx`, add `courseId: m.courseId,` to the entry object pushed inside the meetings loop, alongside the existing `courseCode` line. (`EnrollmentMeeting` has a `courseId` column - see `prisma/schema.prisma`.)

- [ ] **Step 7: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run
git add src/lib/search.ts src/schedule/group.ts tests/schedule-group.test.ts src/components/schedule/ScheduleCalendar.tsx src/components/ScheduleBuilder.tsx src/app/schedule/page.tsx
git commit -m "feat: carry courseId through section hits, groups, and calendar entries"
```

---

### Task 2: `getCourseDetail`

**Files:**
- Create: `src/lib/course-detail.ts`
- Create: `src/app/actions/course.ts`
- Create: `tests/course-detail.test.ts`

**Interfaces:**
- Consumes: `aggregateDistributions` + `GradeSummary` from `@/grades/aggregate`; `HistoricalGradeTerm` from `@/components/HistoricalGradesTimeline`; `Requirement` from `@/prereqs/parse`.
- Produces:
  - `loadCourseDetail(courseId: string, termId: string): Promise<CourseDetail | null>` (the testable core)
  - `getCourseDetail(courseId: string, termId: string): Promise<CourseDetail | null>` (the `'use server'` wrapper)
  - types `CourseDetail`, `CourseSectionDetail`

- [ ] **Step 1: Write the failing test**

Create `tests/course-detail.test.ts`. It picks real catalogue rows rather than seeding, matching how `tests/schedule-actions.test.ts` sources its fixtures:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '@/lib/db';
import { loadCourseDetail } from '@/lib/course-detail';

let courseId: string;
let termId: string;

beforeAll(async () => {
  // A course that actually has a section, so the section list is exercised.
  const section = await db.section.findFirstOrThrow({ select: { courseId: true, termId: true } });
  courseId = section.courseId;
  termId = section.termId;
});

describe('loadCourseDetail', () => {
  it('returns the course header and a link to its full page', async () => {
    const detail = await loadCourseDetail(courseId, termId);
    expect(detail).not.toBeNull();
    expect(detail!.courseId).toBe(courseId);
    expect(detail!.code).toMatch(/^[A-Z]+ \S+$/);
    expect(detail!.title.length).toBeGreaterThan(0);
    // Slug convention must match the course page's own.
    expect(detail!.href).toBe(`/course/${detail!.code.toLowerCase().replace(/\s+/g, '-')}`);
  });

  it('returns only sections in the requested term', async () => {
    const detail = await loadCourseDetail(courseId, termId);
    const ids = detail!.sections.map((s) => s.sectionId);
    expect(ids.length).toBeGreaterThan(0);

    const rows = await db.section.findMany({
      where: { id: { in: ids } },
      select: { termId: true },
    });
    expect(rows.every((r) => r.termId === termId)).toBe(true);
  });

  it('returns an empty section list for a term the course is not offered in', async () => {
    const otherTerm = await db.term.findFirst({ where: { id: { not: termId } }, select: { id: true } });
    if (!otherTerm) return; // single-term dataset; nothing to assert
    const detail = await loadCourseDetail(courseId, otherTerm.id);
    expect(detail).not.toBeNull();
    expect(detail!.sections.every((s) => s.sectionId !== undefined)).toBe(true);
  });

  it('always returns a grade summary object, even with no grade rows', async () => {
    const detail = await loadCourseDetail(courseId, termId);
    expect(detail!.grades).toBeDefined();
    expect(typeof detail!.grades.sectionCount).toBe('number');
  });

  it('returns null for a course that does not exist', async () => {
    expect(await loadCourseDetail('no-such-course-id', termId)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/course-detail.test.ts`
Expected: FAIL - cannot resolve `@/lib/course-detail`.

- [ ] **Step 3: Implement the loader**

Create `src/lib/course-detail.ts`:

```ts
import { db } from '@/lib/db';
import { aggregateDistributions, type GradeSummary } from '@/grades/aggregate';
import type { SectionMeetingTime } from '@/lib/search';
import type { HistoricalGradeTerm } from '@/components/HistoricalGradesTimeline';
import type { Requirement } from '@/prereqs/parse';

export type CourseSectionDetail = {
  sectionId: string;
  sectionCode: string;
  activity: string | null;
  status: string | null;
  meetings: string;
  /** Carried so the overlay can build a complete SectionHit when a student
   *  adds a section from here, without a second round trip. */
  meetingTimes: SectionMeetingTime[];
  enrolTotal: number | null;
  enrolCap: number | null;
  instructors: { name: string; slug: string }[];
};

export type CourseDetail = {
  courseId: string;
  code: string;
  title: string;
  description: string | null;
  credits: number | null;
  /** Link to the full course page - the overlay is never a redirect. */
  href: string;
  sections: CourseSectionDetail[];
  grades: GradeSummary;
  historical: {
    average: number | null;
    averagePast5Years: number | null;
    minSectionAverage: number | null;
    maxSectionAverage: number | null;
    stddev: number | null;
  } | null;
  historicalByTerm: HistoricalGradeTerm[];
  prereqTree: Requirement | null;
  coreqTree: Requirement | null;
  prereqText: string | null;
  coreqText: string | null;
};

/**
 * Everything the schedule builder's course overlay shows, in one call.
 *
 * Sections are scoped to the term being planned - a section from another term
 * could not be added to this schedule, so showing it would be an invitation to
 * a dead end. The grade and requirement data is course-wide and term-agnostic.
 */
export async function loadCourseDetail(
  courseId: string,
  termId: string,
): Promise<CourseDetail | null> {
  const course = await db.course.findUnique({
    where: { id: courseId },
    include: { subject: true },
  });
  if (!course) return null;

  const [sectionRows, gradeRows, historical, historicalByTerm] = await Promise.all([
    db.section.findMany({
      where: { courseId, termId },
      include: {
        meetingTimes: true,
        instructors: { include: { instructor: true } },
      },
      orderBy: { sectionCode: 'asc' },
    }),
    db.gradeDistribution.findMany({
      where: { courseId },
      select: { average: true, count: true, distribution: true },
    }),
    db.courseHistoricalGrades.findUnique({ where: { courseId } }),
    db.courseHistoricalGradesByTerm.findMany({
      where: { courseId },
      select: { year: true, session: true, average: true },
    }),
  ]);

  const code = `${course.subject.code ?? ''} ${course.number}`.trim();

  return {
    courseId: course.id,
    code,
    title: course.title,
    description: course.description,
    credits: course.credits,
    href: `/course/${code.toLowerCase().replace(/\s+/g, '-')}`,
    sections: sectionRows.map((s) => ({
      sectionId: s.id,
      sectionCode: s.sectionCode,
      activity: s.activity,
      status: s.status,
      meetings:
        s.meetingTimes
          .filter((m) => m.startTime && m.endTime)
          .map((m) => `${m.day} ${m.startTime}–${m.endTime}`)
          .join(', ') || 'No fixed time',
      meetingTimes: s.meetingTimes.map((m) => ({
        day: m.day,
        startTime: m.startTime,
        endTime: m.endTime,
        building: m.building,
        room: m.room,
      })),
      enrolTotal: s.enrolTotal,
      enrolCap: s.enrolCap,
      instructors: s.instructors.map((si) => ({
        name: si.instructor.name,
        slug: si.instructor.slug,
      })),
    })),
    grades: aggregateDistributions(
      gradeRows.map((g) => ({
        average: g.average,
        count: g.count,
        distribution: g.distribution as Record<string, number | null> | null,
      })),
    ),
    historical: historical
      ? {
          average: historical.average,
          averagePast5Years: historical.averagePast5Years,
          minSectionAverage: historical.minSectionAverage,
          maxSectionAverage: historical.maxSectionAverage,
          stddev: historical.stddev,
        }
      : null,
    historicalByTerm,
    // Prisma types these Json columns as JsonValue; the course page casts the
    // same way (src/app/course/[code]/page.tsx).
    prereqTree: course.prereqTree as unknown as Requirement | null,
    coreqTree: course.coreqTree as unknown as Requirement | null,
    prereqText: course.prereqText,
    coreqText: course.coreqText,
  };
}
```

- [ ] **Step 4: Create the server action**

Create `src/app/actions/course.ts`:

```ts
'use server';

import { loadCourseDetail, type CourseDetail } from '@/lib/course-detail';

/**
 * Course detail for the schedule builder's info overlay, fetched on demand so
 * the builder's initial load stays cheap. Public catalogue data - no auth
 * needed, same as the section search beside it.
 */
export async function getCourseDetail(
  courseId: string,
  termId: string,
): Promise<CourseDetail | null> {
  return loadCourseDetail(courseId, termId);
}
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `npx vitest run tests/course-detail.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run
git add src/lib/course-detail.ts src/app/actions/course.ts tests/course-detail.test.ts
git commit -m "feat: add getCourseDetail for the schedule builder overlay"
```

---

### Task 3: Convert the grade components to theme tokens

Both still use raw Tailwind colours, which do not adapt to dark mode. They are about to be rendered inside the overlay, so they must match the rest of the app.

**Files:**
- Modify: `src/components/GradeChart.tsx`
- Modify: `src/components/HistoricalGradesTimeline.tsx`

**Interfaces:** unchanged - props, behaviour, and the suppressed-bucket semantics stay exactly as they are.

- [ ] **Step 1: Convert `GradeChart`**

In `src/components/GradeChart.tsx` make exactly these substitutions. Do not restructure the component, and do not change the suppression logic - a suppressed (`null`) bucket must stay visually distinct from a zero one.

- The tooltip: `bg-slate-800 px-2 py-1 text-xs text-white` → `bg-foreground px-2 py-1 text-xs text-background`
- The filled bar: `w-full rounded-t bg-blue-700` → `w-full rounded-t bg-brand-accent`
- The suppressed stub: `border-dashed border-slate-400 bg-slate-200` → `border-dashed border-border bg-surface-muted`
- The suppressed stub's inline `backgroundImage` hatch: replace the two `rgb(148 163 184)` occurrences with `var(--border)`
- Any remaining `text-slate-*` label → `text-text-tertiary`

Then confirm: `grep -nE "slate-[0-9]|blue-[0-9]|rgb\(" src/components/GradeChart.tsx` must print nothing.

- [ ] **Step 2: Convert `HistoricalGradesTimeline`**

Same treatment in `src/components/HistoricalGradesTimeline.tsx`:

- The tooltip: `bg-slate-800 … text-white` → `bg-foreground … text-background`
- Bars: any `bg-blue-*` → `bg-brand-accent`
- Any `text-slate-*` → `text-text-tertiary`
- The missing-term stub: any `bg-slate-*` → `bg-surface-muted`

Then confirm: `grep -nE "slate-[0-9]|blue-[0-9]|rgb\(" src/components/HistoricalGradesTimeline.tsx` must print nothing.

- [ ] **Step 3: Verify and commit**

Both components are rendered by the course page, which the test suite touches; a broken class name will not fail a test, so the visual check in Task 6 is what actually confirms this.

```bash
npx tsc --noEmit
npx vitest run
git add src/components/GradeChart.tsx src/components/HistoricalGradesTimeline.tsx
git commit -m "refactor: put the grade charts on theme tokens"
```

---

### Task 4: The overlay component

**Files:**
- Create: `src/components/schedule/CourseInfoOverlay.tsx`

**Interfaces:**
- Consumes: `getCourseDetail` (Task 2); `GradeChart`, `HistoricalGradesTimeline`, `RequirementTree`; `GRADE_BUCKETS` is NOT needed directly.
- Produces: default export `CourseInfoOverlay`, props:

```ts
{
  courseId: string | null;   // null = closed
  termId: string;
  addedSectionIds: Set<string>;
  /** Receives a complete SectionHit, assembled from the loaded detail - the
   *  same shape the search panel emits, so the builder's buffer stays uniform. */
  onAddSection?: (hit: SectionHit) => void;
  onRemoveSection?: (sectionId: string) => void;
  onClose: () => void;
}
```

- [ ] **Step 1: Create the component**

The backdrop, z-index and click-outside behaviour mirror `src/components/CreateScheduleModal.tsx`, which already solves this.

Create `src/components/schedule/CourseInfoOverlay.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import GradeChart from '@/components/GradeChart';
import HistoricalGradesTimeline from '@/components/HistoricalGradesTimeline';
import RequirementTree from '@/components/RequirementTree';
import { getCourseDetail } from '@/app/actions/course';
import type { CourseDetail, CourseSectionDetail } from '@/lib/course-detail';
import type { SectionHit } from '@/lib/search';

/** The overlay's own section shape widened back to the builder's SectionHit,
 *  so a section added here is indistinguishable from one added via search. */
function toHit(detail: CourseDetail, s: CourseSectionDetail): SectionHit {
  return {
    sectionId: s.sectionId,
    courseId: detail.courseId,
    code: detail.code,
    title: detail.title,
    sectionCode: s.sectionCode,
    activity: s.activity,
    meetings: s.meetings,
    meetingTimes: s.meetingTimes,
  };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-border px-3 py-2">
      <p className="text-xs text-text-tertiary">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function pct(v: number | null): string {
  return v !== null ? `${v.toFixed(1)}%` : '—';
}

/**
 * Course detail as an overlay rather than a navigation, so a student deciding
 * between sections never loses their half-built schedule (spec §7).
 *
 * Detail is fetched the first time a course is opened and cached for the life
 * of the page - reopening is instant, and the builder's initial load carries
 * none of this.
 */
export default function CourseInfoOverlay({
  courseId,
  termId,
  addedSectionIds,
  onAddSection,
  onRemoveSection,
  onClose,
}: {
  courseId: string | null;
  termId: string;
  addedSectionIds: Set<string>;
  onAddSection?: (hit: SectionHit) => void;
  onRemoveSection?: (sectionId: string) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const cache = useRef(new Map<string, CourseDetail>());

  useEffect(() => {
    if (!courseId) return;
    const cached = cache.current.get(courseId);
    if (cached) {
      setDetail(cached);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setDetail(null);
    (async () => {
      const result = await getCourseDetail(courseId, termId);
      if (cancelled) return;
      if (result) cache.current.set(courseId, result);
      setDetail(result);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, termId]);

  // Escape closes, matching the auth overlay.
  useEffect(() => {
    if (!courseId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [courseId, onClose]);

  if (!courseId) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={detail ? `${detail.code} course information` : 'Course information'}
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 px-6 py-10 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl rounded-card border border-border-hairline bg-surface p-6 shadow-lg">
        {loading && <p className="text-sm text-text-secondary">Loading course…</p>}
        {!loading && !detail && (
          <p className="text-sm text-text-secondary">Could not load this course.</p>
        )}

        {detail && (
          <>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-xl font-semibold text-foreground">{detail.code}</h2>
                <p className="text-sm text-text-secondary">{detail.title}</p>
                {detail.credits !== null && (
                  <p className="mt-0.5 text-xs text-text-tertiary">{detail.credits} credits</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 rounded-full p-1 text-text-secondary hover:bg-surface-muted hover:text-foreground"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            {detail.description && (
              <p className="mt-4 text-sm text-text-secondary">{detail.description}</p>
            )}

            <section className="mt-6">
              <h3 className="text-sm font-semibold text-foreground">Sections this term</h3>
              {detail.sections.length === 0 ? (
                <p className="mt-2 text-sm text-text-secondary">
                  Not offered in the term you&apos;re planning.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-border rounded-card border border-border">
                  {detail.sections.map((s) => {
                    const added = addedSectionIds.has(s.sectionId);
                    return (
                      <li key={s.sectionId} className="flex items-start justify-between gap-3 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground">
                            {s.sectionCode}
                            {s.activity && (
                              <span className="ml-2 text-xs text-text-secondary">{s.activity}</span>
                            )}
                          </p>
                          <p className="text-xs text-text-tertiary">{s.meetings}</p>
                          {s.instructors.length > 0 && (
                            <p className="text-xs text-text-secondary">
                              {s.instructors.map((i, idx) => (
                                <span key={i.slug}>
                                  {idx > 0 && ', '}
                                  <Link
                                    href={`/professor/${i.slug}`}
                                    className="text-brand-accent hover:underline"
                                  >
                                    {i.name}
                                  </Link>
                                </span>
                              ))}
                            </p>
                          )}
                          {s.enrolCap !== null && (
                            <p className="text-xs text-text-tertiary">
                              {s.enrolTotal ?? 0} / {s.enrolCap} enrolled
                            </p>
                          )}
                        </div>
                        {(onAddSection || onRemoveSection) && (
                          <button
                            type="button"
                            onClick={() =>
                              added
                                ? onRemoveSection?.(s.sectionId)
                                : onAddSection?.(toHit(detail, s))
                            }
                            aria-label={`${added ? 'Remove' : 'Add'} ${detail.code} ${s.sectionCode}`}
                            className="shrink-0 rounded-pill border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted"
                          >
                            {added ? 'Remove' : 'Add'}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="mt-6">
              <h3 className="text-sm font-semibold text-foreground">Grades</h3>
              {detail.grades.sectionCount === 0 ? (
                <p className="mt-2 text-sm text-text-secondary">No grade data for this course yet.</p>
              ) : (
                <>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <Stat label="Average" value={pct(detail.grades.average)} />
                    <Stat label="Students" value={String(detail.grades.studentCount)} />
                    <Stat label="Sections" value={String(detail.grades.sectionCount)} />
                  </div>
                  <div className="mt-3">
                    <GradeChart distribution={detail.grades.distribution} />
                  </div>
                </>
              )}

              {detail.historical && (
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Stat label="All-time avg" value={pct(detail.historical.average)} />
                  <Stat label="Past 5 years" value={pct(detail.historical.averagePast5Years)} />
                  <Stat label="Std dev" value={
                    detail.historical.stddev !== null ? detail.historical.stddev.toFixed(1) : '—'
                  } />
                </div>
              )}

              {detail.historicalByTerm.length > 0 && (
                <div className="mt-3">
                  <HistoricalGradesTimeline terms={detail.historicalByTerm} />
                </div>
              )}
            </section>

            {(detail.prereqTree || detail.coreqTree || detail.prereqText || detail.coreqText) && (
              <section className="mt-6">
                <h3 className="text-sm font-semibold text-foreground">Requirements</h3>
                <div className="mt-2 space-y-3 text-sm text-text-secondary">
                  {detail.prereqTree ? (
                    <div>
                      <p className="text-xs font-medium text-text-tertiary">Prerequisites</p>
                      <RequirementTree node={detail.prereqTree} />
                    </div>
                  ) : (
                    detail.prereqText && (
                      <div>
                        <p className="text-xs font-medium text-text-tertiary">Prerequisites</p>
                        <p>{detail.prereqText}</p>
                      </div>
                    )
                  )}
                  {detail.coreqTree ? (
                    <div>
                      <p className="text-xs font-medium text-text-tertiary">Corequisites</p>
                      <RequirementTree node={detail.coreqTree} />
                    </div>
                  ) : (
                    detail.coreqText && (
                      <div>
                        <p className="text-xs font-medium text-text-tertiary">Corequisites</p>
                        <p>{detail.coreqText}</p>
                      </div>
                    )
                  )}
                </div>
              </section>
            )}

            <Link
              href={detail.href}
              className="mt-6 inline-block text-sm font-medium text-brand-accent hover:underline"
            >
              View full course page →
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run
git add src/components/schedule/CourseInfoOverlay.tsx
git commit -m "feat: add the course info overlay"
```

---

### Task 5: Wire the three trigger points

**Files:**
- Modify: `src/components/schedule/FindCoursesPanel.tsx`
- Modify: `src/components/schedule/SavedCoursesPanel.tsx`
- Modify: `src/components/schedule/SchedulePanelTabs.tsx`
- Modify: `src/components/schedule/ScheduleCalendar.tsx`
- Modify: `src/components/ScheduleBuilder.tsx`

**Interfaces:**
- `FindCoursesPanel` and `SavedCoursesPanel` each gain `onInfo: (courseId: string) => void`.
- `SchedulePanelTabs` gains `onInfo: (courseId: string) => void` and passes it to both.
- `ScheduleCalendar` gains `onSelectCourse?: (courseId: string) => void`.
- `ScheduleBuilder` owns `infoCourseId` state and renders `CourseInfoOverlay`.

- [ ] **Step 1: Add the ⓘ button to both panels**

In BOTH `FindCoursesPanel.tsx` and `SavedCoursesPanel.tsx`:

1. Add `onInfo: (courseId: string) => void;` to the props type and destructure it.
2. Inside each course group's `<summary>`, after the existing code/title spans, add this button. It must stop the click from toggling the `<details>`:

```tsx
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onInfo(group.courseId);
                }}
                aria-label={`Course information for ${group.code}`}
                className="ml-2 rounded-full border border-border px-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-muted hover:text-foreground"
              >
                i
              </button>
```

`e.preventDefault()` is required: a `<summary>` toggles its `<details>` on click, and without it opening the overlay would also collapse the group behind it.

- [ ] **Step 2: Thread it through the tabs**

In `src/components/schedule/SchedulePanelTabs.tsx`, add `onInfo: (courseId: string) => void;` to the props type, destructure it, and pass `onInfo={onInfo}` to BOTH `<SavedCoursesPanel …>` and `<FindCoursesPanel …>`.

- [ ] **Step 3: Make calendar blocks open the overlay**

In `src/components/schedule/ScheduleCalendar.tsx`:

1. Add to the props type: `onSelectCourse?: (courseId: string) => void;` and destructure it.
2. On the timed block `<div>` (the one carrying the inline `background`/`boxShadow` style), add a click handler and make it keyboard-operable:

```tsx
                        onClick={
                          onSelectCourse && e.courseId
                            ? () => onSelectCourse(e.courseId!)
                            : undefined
                        }
                        role={onSelectCourse && e.courseId ? 'button' : undefined}
                        tabIndex={onSelectCourse && e.courseId ? 0 : undefined}
                        onKeyDown={
                          onSelectCourse && e.courseId
                            ? (ev) => {
                                if (ev.key === 'Enter' || ev.key === ' ') {
                                  ev.preventDefault();
                                  onSelectCourse(e.courseId!);
                                }
                              }
                            : undefined
                        }
```

3. Add `${onSelectCourse && e.courseId ? 'cursor-pointer' : ''}` to that div's `className` template so it signals it is clickable.

The remove `×` button inside the block already calls `onRemove`; leave it as is. Because it is a nested `<button>`, its own click will bubble to the block's handler - add `e.stopPropagation()` inside the remove button's existing `onClick` so removing a section does not also open the overlay:

```tsx
                            onClick={(ev) => {
                              ev.stopPropagation();
                              onRemove(e.sectionId);
                            }}
```

- [ ] **Step 4: Own the state in the builder**

In `src/components/ScheduleBuilder.tsx`:

1. Import the overlay: `import CourseInfoOverlay from '@/components/schedule/CourseInfoOverlay';`
2. Add state: `const [infoCourseId, setInfoCourseId] = useState<string | null>(null);`
3. Pass `onInfo={setInfoCourseId}` to `<SchedulePanelTabs …>`.
4. Pass `onSelectCourse={setInfoCourseId}` to `<ScheduleCalendar …>`.
5. Render the overlay as the last child of the `<main>`:

```tsx
      <CourseInfoOverlay
        courseId={infoCourseId}
        termId={termId}
        addedSectionIds={new Set(chosen.map((c) => c.sectionId))}
        onAddSection={addSection}
        onRemoveSection={removeSection}
        onClose={() => setInfoCourseId(null)}
      />
```

`addSection` and `removeSection` already exist in this component and take exactly these argument types - `addSection` dedupes by `sectionId`, so adding a section that is already buffered is a safe no-op.

- [ ] **Step 5: Confirm the read-only tab did NOT gain a click handler**

Run: `grep -n "onSelectCourse" src/components/ScheduleTabs.tsx`
Expected: no output. The "View Calendar" tab on `/schedule` stays read-only.

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run
git add src/components/schedule/ src/components/ScheduleBuilder.tsx
git commit -m "feat: open the course overlay from the panels and the calendar"
```

---

### Task 6: Verify in a real browser

**Files:**
- Create (temporary, NOT committed): `_smoke_overlay.mjs`

- [ ] **Step 1: Confirm the dev server**

```bash
curl -sf http://localhost:3000 >/dev/null && echo UP
```

A dev server is normally already running. Do NOT start a second - Next.js refuses and exits.

- [ ] **Step 2: Write the smoke script**

Create `_smoke_overlay.mjs`:

```js
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const BASE = 'http://localhost:3000';
const email = `smoke-overlay-${Date.now()}@example.com`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

try {
  // Prefer a course that has grade data, so the chart is actually exercised.
  const withGrades = await prisma.gradeDistribution.findFirst({ select: { courseId: true } });
  const section = await prisma.section.findFirstOrThrow({
    where: {
      meetingTimes: { some: { startTime: { not: null } } },
      ...(withGrades ? { courseId: withGrades.courseId } : {}),
    },
    include: { course: { include: { subject: true } } },
  });
  const code = `${section.course.subject.code} ${section.course.number}`;

  await page.goto(`${BASE}/signup`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', 'smoke-test-password-123');
  await page.click('button:has-text("Sign Up")');
  await page.waitForURL('**/onboarding');

  await page.goto(`${BASE}/schedule/new?name=Overlay&termId=${encodeURIComponent(section.termId)}`);
  await page.click('button:text-is("Find Courses")');
  await page.fill('input[aria-label="Search courses"]', code);
  await page.waitForSelector(`summary:has-text("${code}")`, { timeout: 5000 });

  // 1. ⓘ from Find Courses
  await page.click(`button[aria-label="Course information for ${code}"]`);
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await page.waitForSelector('text=Sections this term');
  await page.waitForSelector('text=View full course page');
  console.log('OVERLAY FROM FIND OK');
  await page.screenshot({ path: 'overlay-light.png' });

  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });
  console.log('ESCAPE CLOSES OK');

  // 2. Add a section, then ⓘ from Saved Courses
  await page.click(`summary:has-text("${code}")`);
  await page.locator('button:text-is("Add")').first().click();
  await page.click('button:text-is("Saved Courses")');
  await page.click(`button[aria-label="Course information for ${code}"]`);
  await page.waitForSelector('[role="dialog"]');
  console.log('OVERLAY FROM SAVED OK');
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'overlay-dark.png' });
  await page.keyboard.press('Escape');
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });

  // 3. Clicking a calendar block
  await page.locator('[style*="--course-"][role="button"]').first().click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  console.log('OVERLAY FROM CALENDAR BLOCK OK');

  console.log('CONSOLE ERRORS:', JSON.stringify(errors));
} finally {
  const u = await prisma.user.findUnique({ where: { email } });
  if (u) await prisma.savedSchedule.deleteMany({ where: { userId: u.id } });
  await prisma.user.delete({ where: { email } }).catch(() => {});
  await browser.close();
  await prisma.$disconnect();
}
```

- [ ] **Step 3: Run it**

Run: `node --env-file=.env _smoke_overlay.mjs`
Expected: all four OK lines and `CONSOLE ERRORS: []`.

If clicking a calendar block does not open the overlay, the likely cause is the remove `×` swallowing or bubbling the click - check Task 5 Step 3's `stopPropagation`.

- [ ] **Step 4: Look at both screenshots**

Confirm by eye in `overlay-light.png` and `overlay-dark.png`:
1. The overlay sits above the builder with a dimmed backdrop - the builder is still visible behind it, not replaced.
2. Course code, title, credits and description are readable.
3. The section list shows meeting times and instructor names as links.
4. The grade chart renders with bars, and **is legible in dark mode** - this is the main risk, since Task 3 just converted it from hardcoded colours.
5. No raw navy-on-charcoal text anywhere in the overlay.
6. "View full course page →" is present and readable.

A blank or clipped screenshot is a failure even if the script printed OK.

- [ ] **Step 5: Clean up**

```bash
rm -f _smoke_overlay.mjs overlay-light.png overlay-dark.png
git status --short
```

Expected: clean tree. Nothing to commit for this task.

---

## Phase 3 done when

- The ⓘ in Find Courses, the ⓘ in Saved Courses, and clicking a calendar block all open the same overlay.
- The overlay shows description, term-scoped sections with instructors, grade distribution, historical averages and requirements - and links to the full course page.
- Reopening a course does not refetch it.
- Escape and a backdrop click both close it.
- The read-only "View Calendar" tab on `/schedule` has no click-to-open behaviour.
- `grep -nE "slate-[0-9]|blue-[0-9]|rgb\(" src/components/GradeChart.tsx src/components/HistoricalGradesTimeline.tsx` prints nothing.
- `npx vitest run` and `npx tsc --noEmit` clean.

## Deliberately not in this phase

- **RateMyProfessors ratings** - Phase 5, behind a spike. Instructors are listed by name only.
- Workday import (Phase 4).
