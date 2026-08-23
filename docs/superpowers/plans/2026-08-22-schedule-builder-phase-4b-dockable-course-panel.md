# Schedule Builder — Phase 4b: Dockable Course Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a student pop the course-information overlay out of the modal and dock it beside the calendar, so they can keep reading a course while they build.

**Architecture:** The overlay's body is extracted into a shared `CourseInfoContent`, and its fetch/cache into a `useCourseDetail` hook whose cache lives at module scope — so moving between the modal and the docked panel never refetches. Two thin shells wrap that content: the existing modal, and a new docked `<aside>` that becomes a third column in the builder. The calendar shrinks to make room rather than being covered.

**Tech Stack:** Next.js 16 (App Router), React client components, Tailwind v4 theme tokens, Vitest.

**Spec:** Extends `docs/superpowers/specs/2026-08-22-schedule-builder-redesign-design.md` §7. §7 specified the overlay; this adds a docked presentation of the same content at the user's request. No data or behaviour changes.

**Builds on:** Phases 1-4, all complete on branch `feat/schedule-builder-phase-1`.

**Sequenced before Phase 5** deliberately: Phase 5 adds RateMyProfessors ratings into this same course content. Restructuring first means that work lands in one shared component instead of two.

## Global Constraints

- **No data or behaviour changes.** Same `getCourseDetail` call, same fields, same add/remove semantics. This is a presentation refactor plus one new shell.
- **Moving between modal and docked must not refetch.** That is the point of hoisting the cache to module scope.
- **Theme tokens only.** `foreground`, `background`, `text-secondary`, `text-tertiary`, `surface`, `surface-muted`, `border`, `border-hairline`, `brand`, `brand-accent`, `brand-foreground`, `danger`, and the `rounded-pill`/`rounded-card`/`rounded-input` radii. No raw `slate-*`/`blue-*`/`red-*`. **`brand` as a foreground is forbidden** — invisible in dark mode; use `brand-accent`.
- The docked panel is a **builder-only** affordance. The read-only "View Calendar" tab on `/schedule` must be untouched.
- Every interactive control needs an accessible name.
- Commit after every task. `npx tsc --noEmit` and `npx vitest run` clean before each commit (baseline: **321 tests passing**).

---

### Task 1: Extract the shared content and hoist the cache

Pure refactor — no visible change. `CourseInfoOverlay` must look and behave exactly as it does now when this task is done.

**Files:**
- Create: `src/components/schedule/course-info/useCourseDetail.ts`
- Create: `src/components/schedule/course-info/CourseInfoContent.tsx`
- Modify: `src/components/schedule/CourseInfoOverlay.tsx`

**Interfaces:**
- Produces:
  - `useCourseDetail(courseId: string | null, termId: string): { detail: CourseDetail | null; loading: boolean }`
  - `CourseInfoContent`, props `{ detail: CourseDetail; addedSectionIds: Set<string>; onAddSection?: (hit: SectionHit) => void; onRemoveSection?: (sectionId: string) => void }`

- [ ] **Step 1: Create the hook**

Move the fetch effect, the `cancelled` race guard, and the cache out of the overlay. **The cache moves to module scope** so it survives a shell swap — that is what makes docking free.

Create `src/components/schedule/course-info/useCourseDetail.ts`:

```ts
'use client';

import { useEffect, useState } from 'react';
import { getCourseDetail } from '@/app/actions/course';
import type { CourseDetail } from '@/lib/course-detail';

/**
 * Module scope, not a ref: the modal and the docked panel are two different
 * components, so a per-component cache would refetch every time a student
 * pops the panel out or back in. Keyed on course AND term because the section
 * list is term-scoped.
 */
const cache = new Map<string, CourseDetail>();

export function useCourseDetail(
  courseId: string | null,
  termId: string,
): { detail: CourseDetail | null; loading: boolean } {
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!courseId) return;
    const key = `${courseId}:${termId}`;
    const cached = cache.get(key);
    if (cached) {
      setDetail(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setDetail(null);
    (async () => {
      const result = await getCourseDetail(courseId, termId);
      // A slower earlier request must never overwrite a newer one.
      if (cancelled) return;
      if (result) cache.set(key, result);
      setDetail(result);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, termId]);

  return { detail, loading };
}
```

- [ ] **Step 2: Extract the content**

Create `src/components/schedule/course-info/CourseInfoContent.tsx`. Move the body of the overlay's `{detail && (…)}` block into it **verbatim, minus the header row** (the `<h2>`/title/credits block and the close button) — each shell renders its own header, because their action buttons differ.

So `CourseInfoContent` starts at the description and covers: description, "Sections this term", "Grades" (stats, `GradeChart`, historical stats, `HistoricalGradesTimeline`), "Requirements", and the "View full course page →" link. Move the `Stat`, `pct` and `toHit` helpers into this file too — they are only used by the content.

Its props:

```tsx
export default function CourseInfoContent({
  detail,
  addedSectionIds,
  onAddSection,
  onRemoveSection,
}: {
  detail: CourseDetail;
  addedSectionIds: Set<string>;
  onAddSection?: (hit: SectionHit) => void;
  onRemoveSection?: (sectionId: string) => void;
}) {
```

Do not change any markup inside. Do not change class names. This is a move, not a redesign.

- [ ] **Step 3: Rewrite the overlay to use both**

`CourseInfoOverlay` keeps its exact current props and its modal shell, but now: calls `useCourseDetail` instead of owning the fetch, renders its own header row (code, title, credits + close button), and renders `<CourseInfoContent …/>` for the rest. Delete the code it no longer owns — the cache ref, the fetch effect, `Stat`, `pct`, `toHit`.

Keep the Escape handler, the backdrop click-outside, `role="dialog"`, `aria-modal`, and the `aria-label`.

- [ ] **Step 4: Prove nothing changed**

```bash
npx tsc --noEmit
npx vitest run
grep -nE "slate-[0-9]|blue-[0-9]|red-[0-9]" src/components/schedule/course-info/*.tsx src/components/schedule/CourseInfoOverlay.tsx
```

The grep must print nothing. Then confirm the overlay still works in the browser — a dev server is already running on http://localhost:3000, do NOT start another:

```bash
node -e "
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({viewport:{width:1280,height:1000}});
  const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto('http://localhost:3000/schedule/new');
  await p.click('button:text-is(\"Find Courses\")');
  await p.fill('input[aria-label=\"Search courses\"]','CPSC 110');
  await p.waitForSelector('summary:has-text(\"CPSC 110\")',{timeout:8000});
  await p.click('button[aria-label=\"Course information for CPSC 110\"]');
  await p.waitForSelector('[role=\"dialog\"]',{timeout:8000});
  await p.waitForSelector('text=Sections this term');
  await p.waitForSelector('text=View full course page');
  console.log('OVERLAY STILL WORKS');
  console.log('ERRORS:', JSON.stringify(errs));
  await b.close();
})();"
```

Expected: `OVERLAY STILL WORKS` and `ERRORS: []`.

- [ ] **Step 5: Commit**

```bash
git add src/components/schedule/course-info/ src/components/schedule/CourseInfoOverlay.tsx
git commit -m "refactor: extract shared course-info content and hoist its cache"
```

---

### Task 2: The pop-out button and the docked panel

**Files:**
- Modify: `src/components/schedule/CourseInfoOverlay.tsx`
- Create: `src/components/schedule/course-info/CourseInfoPanel.tsx`

**Interfaces:**
- `CourseInfoOverlay` gains `onDock: () => void`.
- Produces `CourseInfoPanel`, props:

```ts
{
  courseId: string;          // never null — the builder unmounts the panel instead
  termId: string;
  addedSectionIds: Set<string>;
  onAddSection?: (hit: SectionHit) => void;
  onRemoveSection?: (sectionId: string) => void;
  onExpand: () => void;      // back to the modal
  onClose: () => void;
}
```

- [ ] **Step 1: Add the pop-out button to the modal header**

In `CourseInfoOverlay.tsx`, add `onDock: () => void;` to the props type and destructure it. In the header's button group, add a button **before** the existing close button so it sits to its left:

```tsx
              <button
                type="button"
                onClick={onDock}
                aria-label="Show this course beside the calendar"
                title="Show beside the calendar"
                className="shrink-0 rounded-full p-1 text-text-secondary hover:bg-surface-muted hover:text-foreground"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-5 w-5">
                  <rect x="3" y="4" width="18" height="16" rx="2" />
                  <path d="M15 4v16" />
                </svg>
              </button>
```

Wrap the two buttons in `<div className="flex shrink-0 items-center gap-1">` so they sit side by side.

- [ ] **Step 2: Create the docked panel**

Create `src/components/schedule/course-info/CourseInfoPanel.tsx`:

```tsx
'use client';

import CourseInfoContent from '@/components/schedule/course-info/CourseInfoContent';
import { useCourseDetail } from '@/components/schedule/course-info/useCourseDetail';
import type { SectionHit } from '@/lib/search';

/**
 * The course overlay, docked beside the calendar instead of covering it, so a
 * student can keep a course open while they build.
 *
 * Shares CourseInfoContent and the module-scope cache with the modal, so
 * popping out and back in never refetches.
 */
export default function CourseInfoPanel({
  courseId,
  termId,
  addedSectionIds,
  onAddSection,
  onRemoveSection,
  onExpand,
  onClose,
}: {
  courseId: string;
  termId: string;
  addedSectionIds: Set<string>;
  onAddSection?: (hit: SectionHit) => void;
  onRemoveSection?: (sectionId: string) => void;
  onExpand: () => void;
  onClose: () => void;
}) {
  const { detail, loading } = useCourseDetail(courseId, termId);

  return (
    <aside
      aria-label={detail ? `${detail.code} course information` : 'Course information'}
      className="flex w-full shrink-0 flex-col overflow-y-auto border-t border-border lg:w-[380px] lg:border-l lg:border-t-0"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          {detail ? (
            <>
              <p className="truncate text-sm font-semibold text-foreground">{detail.code}</p>
              <p className="truncate text-xs text-text-secondary">{detail.title}</p>
            </>
          ) : (
            <p className="text-sm text-text-secondary">
              {loading ? 'Loading course…' : 'Could not load this course.'}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onExpand}
            aria-label="Expand this course to a full window"
            title="Expand"
            className="rounded-full p-1 text-text-secondary hover:bg-surface-muted hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4">
              <path d="M4 14v6h6M20 10V4h-6M20 4l-7 7M4 20l7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close course information"
            className="rounded-full p-1 text-text-secondary hover:bg-surface-muted hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} className="h-4 w-4">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {detail && (
        <div className="px-4 py-3">
          <CourseInfoContent
            detail={detail}
            addedSectionIds={addedSectionIds}
            onAddSection={onAddSection}
            onRemoveSection={onRemoveSection}
          />
        </div>
      )}
    </aside>
  );
}
```

Note it is an `<aside>`, not a `role="dialog"` — it is not modal, does not trap anything, and must not be dismissed by Escape. That is deliberate: the whole point is that the builder stays usable behind it.

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run
git add src/components/schedule/CourseInfoOverlay.tsx src/components/schedule/course-info/CourseInfoPanel.tsx
git commit -m "feat: add a dockable course info panel"
```

---

### Task 3: Wire docking into the builder

**Files:**
- Modify: `src/components/ScheduleBuilder.tsx`

- [ ] **Step 1: Add the docked state**

Add beside the existing `infoCourseId` state:

```tsx
  const [infoDocked, setInfoDocked] = useState(false);
```

- [ ] **Step 2: Render the panel as a third column**

Inside the `<div className="flex min-h-0 flex-1 flex-col lg:flex-row">` row, AFTER the calendar `<div>`, add:

```tsx
        {infoDocked && infoCourseId && (
          <CourseInfoPanel
            courseId={infoCourseId}
            termId={termId}
            addedSectionIds={new Set(chosen.map((c) => c.sectionId))}
            onAddSection={addSection}
            onRemoveSection={removeSection}
            onExpand={() => setInfoDocked(false)}
            onClose={() => {
              setInfoDocked(false);
              setInfoCourseId(null);
            }}
          />
        )}
```

Import it: `import CourseInfoPanel from '@/components/schedule/course-info/CourseInfoPanel';`

The calendar column is already `min-w-0 flex-1`, so it shrinks to make room automatically — do not add a width to it.

- [ ] **Step 3: Make the modal and the panel mutually exclusive**

The modal must not render while docked, or both would show the same course. Change the modal's `courseId` prop so it is null when docked:

```tsx
      <CourseInfoOverlay
        courseId={infoDocked ? null : infoCourseId}
        …
        onDock={() => setInfoDocked(true)}
        onClose={() => setInfoCourseId(null)}
      />
```

Add `onDock` to that element. Leave its other props as they are.

- [ ] **Step 4: Opening a different course while docked keeps it docked**

`setInfoCourseId` is already what the ⓘ buttons and calendar blocks call. Because the panel reads `infoCourseId` directly, clicking a different course while docked simply swaps the panel's content — which is the desired behaviour and needs no extra code. Confirm you have not broken it: the ⓘ handlers must still be plain `setInfoCourseId`, not something that also resets `infoDocked`.

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run
grep -nE "slate-[0-9]|blue-[0-9]|red-[0-9]" src/components/ScheduleBuilder.tsx
git add src/components/ScheduleBuilder.tsx
git commit -m "feat: dock the course panel beside the calendar"
```

The grep must print nothing.

---

### Task 4: Verify in a real browser

**Files:**
- Create (temporary, NOT committed): `_smoke_dock.mjs`

- [ ] **Step 1: Confirm the dev server**

```bash
curl -sf http://localhost:3000 >/dev/null && echo UP
```

Already running — do NOT start a second.

- [ ] **Step 2: Write the smoke script**

Create `_smoke_dock.mjs`:

```js
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

try {
  const s = await prisma.section.findFirstOrThrow({
    where: { meetingTimes: { some: { startTime: { not: null } } } },
    include: { course: { include: { subject: true } } },
  });
  const code = `${s.course.subject.code} ${s.course.number}`;

  await page.goto(`http://localhost:3000/schedule/new?termId=${encodeURIComponent(s.termId)}`);
  await page.click('button:text-is("Find Courses")');
  await page.fill('input[aria-label="Search courses"]', code);
  await page.waitForSelector(`summary:has-text("${code}")`, { timeout: 8000 });
  await page.click(`button[aria-label="Course information for ${code}"]`);
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });

  const calBefore = await page.locator('.overflow-auto').first().boundingBox();

  // Pop out.
  await page.click('button[aria-label="Show this course beside the calendar"]');
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });
  await page.waitForSelector('aside[aria-label*="course information"]', { timeout: 8000 });
  console.log('DOCKED OK');

  // The builder must still be usable behind it.
  const searchUsable = await page.locator('input[aria-label="Search courses"]').isEditable();
  console.log('BUILDER STILL USABLE WHILE DOCKED:', searchUsable);

  const panel = await page.locator('aside[aria-label*="course information"]').boundingBox();
  const calAfter = await page.locator('.overflow-auto').first().boundingBox();
  console.log('PANEL ON RIGHT:', panel.x > 800, '| CALENDAR SHRANK:', calAfter.width < calBefore.width);

  await page.screenshot({ path: 'dock-light.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'dock-dark.png' });

  // Expand back to the modal, then close.
  await page.click('button[aria-label="Expand this course to a full window"]');
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  console.log('EXPAND BACK OK');

  console.log('CONSOLE ERRORS:', JSON.stringify(errors));
} finally {
  await browser.close();
  await prisma.$disconnect();
}
```

- [ ] **Step 3: Run it**

Run: `node --env-file=.env _smoke_dock.mjs`
Expected: `DOCKED OK`, `BUILDER STILL USABLE WHILE DOCKED: true`, `PANEL ON RIGHT: true | CALENDAR SHRANK: true`, `EXPAND BACK OK`, and `CONSOLE ERRORS: []`.

If `CALENDAR SHRANK` is false the panel is covering the calendar rather than sitting beside it — that is a real failure of the requirement, report it rather than adjusting the assertion.

- [ ] **Step 4: Look at both screenshots**

Confirm by eye in `dock-light.png` and `dock-dark.png`:
1. Three columns: the Saved/Find panel on the left, the calendar in the middle, the course info on the right.
2. The calendar is fully visible — not clipped or covered by the panel.
3. The panel shows the course code, title, sections and grades, and scrolls independently.
4. Everything is readable in BOTH themes.

- [ ] **Step 5: Clean up**

```bash
rm -f _smoke_dock.mjs dock-light.png dock-dark.png
git status --short
```

Expected: clean tree. Nothing to commit.

---

## Phase 4b done when

- The course modal has a pop-out button beside its ×.
- Popping out docks the same information beside the calendar; the calendar shrinks rather than being covered.
- The builder stays fully usable while the panel is open.
- The panel has its own close and an expand-back-to-modal control.
- Popping out and back in does not refetch.
- Clicking a different course while docked swaps the panel's content.
- The read-only "View Calendar" tab on `/schedule` is untouched.
- `npx vitest run` and `npx tsc --noEmit` clean.

## Deliberately not in this phase

- Remembering the docked state across reloads.
- Docking more than one course at a time.
- A resizable / draggable panel.
- RateMyProfessors ratings — Phase 5, which adds them to the now-shared `CourseInfoContent`.
