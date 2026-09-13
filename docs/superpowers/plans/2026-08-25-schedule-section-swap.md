# Schedule Section Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a student replace one section of a course with another in a single action, and ask for confirmation when saving a schedule that contains overlapping meetings.

**Architecture:** The swap is a pure transform over the builder's working set (`buffer.ts`), surfaced by a new overlay that reuses the existing `FindCoursesPanel` with three optional props. Nothing new is fetched - seeding the panel's query with the course code reuses the search that already exists. The overlap gate is a confirmation in front of the existing `trySave`, not a change to conflict detection.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4, Vitest for unit tests, Playwright for browser verification.

**Spec:** `docs/superpowers/specs/2026-08-25-schedule-section-swap-design.md`

## Global Constraints

- Conflict detection is untouched. `src/schedule/conflicts.ts` is not modified by any task.
- The conflict banner and calendar ring keep their `--danger` styling. Explicit decision, spec §9.4. The banner gains a close control (Task 8) - a behaviour change, not a restyling.
- Overlaps remain legal to add and legal to persist. No task may block an add.
- Adding, removing and swapping stay client-only. Nothing commits until Save.
- The schedule builder is the only surface affected. Routes under `/schedule/new` and `/schedule/[id]`.
- No new dependencies.
- This repo has no component-test tooling (`@testing-library` is not installed). Pure modules get Vitest tests; UI is verified by `npx tsc --noEmit`, `npm run lint`, and a Playwright check against `localhost:3000`. Do not add a component-testing framework.
- Existing test style: `tests/*.test.ts`, `import { describe, it, expect } from 'vitest'`, imports via the `@/` alias.

---

### Task 1: Pure swap transform

The only piece with real branching. It lives in `buffer.ts` beside `diffSections` so it is testable without React.

**Files:**
- Modify: `src/schedule/buffer.ts`
- Test: `tests/buffer-swap.test.ts`

**Interfaces:**
- Consumes: `SectionHit` from `@/lib/search` (fields used: `sectionId`).
- Produces: `swapSection(chosen: SectionHit[], oldSectionId: string, next: SectionHit): SectionHit[]` - returns a new array; returns the input array unchanged when there is nothing to do.

- [ ] **Step 1: Write the failing test**

Create `tests/buffer-swap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { swapSection } from '@/schedule/buffer';
import type { SectionHit } from '@/lib/search';

const hit = (sectionId: string): SectionHit => ({
  sectionId,
  courseId: 'course-1',
  code: 'MATH 101',
  title: 'Integral Calculus',
  sectionCode: sectionId,
  activity: 'Lecture',
  meetings: 'Tue 10:00-12:00',
  meetingTimes: [],
  instructors: [],
});

describe('swapSection', () => {
  it('replaces the section in place, keeping its position', () => {
    const chosen = [hit('a'), hit('b'), hit('c')];
    const out = swapSection(chosen, 'b', hit('z'));
    expect(out.map((s) => s.sectionId)).toEqual(['a', 'z', 'c']);
  });

  it('does not mutate the input', () => {
    const chosen = [hit('a'), hit('b')];
    swapSection(chosen, 'b', hit('z'));
    expect(chosen.map((s) => s.sectionId)).toEqual(['a', 'b']);
  });

  it('drops the old section without duplicating one already held', () => {
    const chosen = [hit('a'), hit('b'), hit('c')];
    const out = swapSection(chosen, 'a', hit('c'));
    expect(out.map((s) => s.sectionId)).toEqual(['b', 'c']);
  });

  it('is a no-op when swapping a section for itself', () => {
    const chosen = [hit('a'), hit('b')];
    const out = swapSection(chosen, 'a', hit('a'));
    expect(out.map((s) => s.sectionId)).toEqual(['a', 'b']);
  });

  it('leaves the list alone when the old section is not held', () => {
    const chosen = [hit('a'), hit('b')];
    const out = swapSection(chosen, 'missing', hit('z'));
    expect(out.map((s) => s.sectionId)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/buffer-swap.test.ts`
Expected: FAIL - `swapSection` is not exported from `@/schedule/buffer`.

- [ ] **Step 3: Write the implementation**

Append to `src/schedule/buffer.ts`:

```ts
import type { SectionHit } from '@/lib/search';

/**
 * Replaces one held section with another, in a single pass.
 *
 * Deliberately not remove-then-add: two sequential updates render an
 * intermediate state with the course missing from the calendar, and appending
 * would move the section to the end of the panel instead of leaving it where
 * the student is already looking.
 */
export function swapSection(
  chosen: SectionHit[],
  oldSectionId: string,
  next: SectionHit,
): SectionHit[] {
  if (next.sectionId === oldSectionId) return chosen;

  const index = chosen.findIndex((s) => s.sectionId === oldSectionId);
  if (index === -1) return chosen;

  // Already held elsewhere - a schedule holds a set, so take the old one out
  // rather than creating a second row for the same section.
  if (chosen.some((s) => s.sectionId === next.sectionId)) {
    return chosen.filter((s) => s.sectionId !== oldSectionId);
  }

  const out = [...chosen];
  out[index] = next;
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/buffer-swap.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/schedule/buffer.ts tests/buffer-swap.test.ts
git commit -m "feat: add a pure swapSection transform for the working set"
```

---

### Task 2: Optional props on FindCoursesPanel

Generalises the panel so a caller decides what the action button does. No change to search, debounce, grouping or colour handling.

**Files:**
- Modify: `src/components/schedule/FindCoursesPanel.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: three optional props on `FindCoursesPanel` - `initialQuery?: string` (default `''`), `actionLabel?: string` (default `'Add'`), `currentSectionId?: string`. Existing callers keep working untouched.

- [ ] **Step 1: Add the props to the signature**

In `src/components/schedule/FindCoursesPanel.tsx`, extend the destructured props and the type. The existing five props stay exactly as they are:

```tsx
export default function FindCoursesPanel({
  termId,
  addedIds,
  onAdd,
  onInfo,
  onDock,
  initialQuery = '',
  actionLabel = 'Add',
  currentSectionId,
}: {
  termId: string;
  addedIds: Set<string>;
  onAdd: (hit: SectionHit) => void;
  onInfo: (courseId: string) => void;
  onDock: (courseId: string) => void;
  /** Seeds the search box. The panel already searches by code or title, so
   *  passing a course code lists that course's sections with no extra fetch. */
  initialQuery?: string;
  actionLabel?: string;
  /** The section being replaced, when the panel is used to swap. Rendered as
   *  "Current" rather than "Added", which is true but useless in that context. */
  currentSectionId?: string;
}) {
```

- [ ] **Step 2: Seed the query state**

Change the query state initialiser only. Leave every other hook alone:

```tsx
const [query, setQuery] = useState(initialQuery);
```

- [ ] **Step 3: Resolve the button label and disabled state**

Replace the `const added = ...` line and the button element inside the section `<li>`:

```tsx
const isCurrent = section.sectionId === currentSectionId;
const added = addedIds.has(section.sectionId);
const label = isCurrent ? 'Current' : added ? 'Added' : actionLabel;
```

and the button:

```tsx
<button
  type="button"
  disabled={isCurrent || added}
  onClick={() => onAdd(section)}
  aria-label={`${actionLabel} ${group.code} ${section.sectionCode}`}
  className="shrink-0 rounded-pill border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
>
  {label}
</button>
```

- [ ] **Step 4: Verify nothing regressed**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new type errors. Lint reports only the six pre-existing `set-state-in-effect` errors in `ScheduleBuilder.tsx`, `FindCoursesPanel.tsx`, `WorkdayImportOverlay.tsx` and `useCourseDetail.ts` - these predate this work and must not be "fixed" here.

- [ ] **Step 5: Verify the Find panel still behaves**

With `npm run dev` running, open `http://localhost:3000/schedule/new`, click **Find Courses**, search `MATH 101`, and confirm sections list with an enabled **Add**, and that an added section flips to a disabled **Added**.

- [ ] **Step 6: Commit**

```bash
git add src/components/schedule/FindCoursesPanel.tsx
git commit -m "feat: let a caller drive the find panel's query and action label"
```

---

### Task 3: SwapOverlay

**Files:**
- Create: `src/components/schedule/SwapOverlay.tsx`

**Interfaces:**
- Consumes: `FindCoursesPanel` props from Task 2 (`initialQuery`, `actionLabel`, `currentSectionId`).
- Produces: `SwapOverlay` with props `{ section: SectionHit | null; termId: string; addedIds: Set<string>; onSwap: (next: SectionHit) => void; onClose: () => void }`. A null `section` renders nothing, matching how `CourseInfoOverlay` uses a null `courseId` to close.

- [ ] **Step 1: Create the component**

Create `src/components/schedule/SwapOverlay.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import FindCoursesPanel from '@/components/schedule/FindCoursesPanel';
import type { SectionHit } from '@/lib/search';

/**
 * Replace one held section with another.
 *
 * Opens on the held course's other sections because that is the common case,
 * but the search stays live: picking an unrelated course still removes the
 * original, because the action is "replace this", not "add another".
 */
export default function SwapOverlay({
  section,
  termId,
  addedIds,
  onSwap,
  onClose,
}: {
  section: SectionHit | null;
  termId: string;
  addedIds: Set<string>;
  onSwap: (next: SectionHit) => void;
  onClose: () => void;
}) {
  // Escape closes, matching CourseInfoOverlay and the auth overlay.
  useEffect(() => {
    if (!section) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [section, onClose]);

  if (!section) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 sm:p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Swap ${section.code} ${section.sectionCode}`}
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-card border border-border bg-background"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              Swap {section.code} {section.sectionCode}
            </p>
            {/* The section being replaced stays visible while choosing. */}
            <p className="mt-0.5 text-xs text-text-secondary">{section.meetings}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cancel swap"
            className="shrink-0 rounded-pill border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted"
          >
            Cancel
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <FindCoursesPanel
            termId={termId}
            addedIds={addedIds}
            onAdd={onSwap}
            onInfo={() => {}}
            onDock={() => {}}
            initialQuery={section.code}
            actionLabel="Swap"
            currentSectionId={section.sectionId}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. The component is not rendered anywhere yet - that is Task 6.

- [ ] **Step 3: Commit**

```bash
git add src/components/schedule/SwapOverlay.tsx
git commit -m "feat: add the swap overlay shell"
```

---

### Task 4: Swap button on course rows

`CourseHeaderActions` renders in both the Saved and Find panels, and swap is meaningless for a course the student does not hold - so `onSwap` is optional and only passed where a held section exists.

**Files:**
- Modify: `src/components/schedule/CourseHeaderActions.tsx`
- Modify: `src/components/schedule/SavedCoursesPanel.tsx`
- Modify: `src/components/schedule/SchedulePanelTabs.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `onSwap?: () => void` on `CourseHeaderActions`; `onSwap?: (section: SectionHit) => void` threaded through `SchedulePanelTabs` and `SavedCoursesPanel`.

- [ ] **Step 1: Add the optional button to CourseHeaderActions**

Add `onSwap` to the props and type:

```tsx
  onInfo,
  onDock,
  onSwap,
}: {
  code: string;
  slot: number;
  onInfo: () => void;
  onDock: () => void;
  /** Only supplied for a course the student actually holds. */
  onSwap?: () => void;
}) {
```

and render it after the dock button, inside the same fragment:

```tsx
      {onSwap && (
        <button
          type="button"
          onClick={handler(onSwap)}
          aria-label={`Swap a section of ${code}`}
          title="Swap section"
          style={style}
          className={`ml-1 inline-flex ${button}`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3">
            <path d="M4 8h13M14 5l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M20 16H7M10 19l-3-3 3-3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
```

The existing `handler()` wrapper is required - these sit inside a `<summary>`, where an unguarded click toggles the `<details>` as a side effect.

- [ ] **Step 2: Thread onSwap through SavedCoursesPanel**

Add to props and type:

```tsx
  onInfo,
  onDock,
  onSwap,
}: {
  chosen: SectionHit[];
  onRemove: (sectionId: string) => void;
  onInfo: (courseId: string) => void;
  onDock: (courseId: string) => void;
  onSwap: (section: SectionHit) => void;
}) {
```

Every course in this panel is held, so pass the group's first section:

```tsx
              <CourseHeaderActions
                code={group.code}
                slot={slot}
                onInfo={() => onInfo(group.courseId)}
                onDock={() => onDock(group.courseId)}
                onSwap={() => onSwap(group.sections[0])}
              />
```

- [ ] **Step 3: Thread onSwap through SchedulePanelTabs**

Add `onSwap: (section: SectionHit) => void` to the props and type, and pass it to `SavedCoursesPanel`. Do **not** pass it to `FindCoursesPanel` - a searched course is not necessarily held, and Task 6 covers the held case from the calendar and the saved panel.

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: type errors only where `ScheduleBuilder` has not yet supplied `onSwap` - that is Task 6. If `tsc` reports exactly that, the wiring is right.

- [ ] **Step 5: Commit**

```bash
git add src/components/schedule/CourseHeaderActions.tsx src/components/schedule/SavedCoursesPanel.tsx src/components/schedule/SchedulePanelTabs.tsx
git commit -m "feat: offer a swap action on held course rows"
```

---

### Task 5: Swap button on the calendar block

**Files:**
- Modify: `src/components/schedule/ScheduleCalendar.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `onSwap?: (sectionId: string) => void` on `ScheduleCalendar`, gated the same way `onRemove` gates the `×`.

- [ ] **Step 1: Add the prop**

```tsx
export default function ScheduleCalendar({
  entries,
  onRemove,
  onSwap,
  showNowIndicator = false,
  onSelectCourse,
}: {
  entries: CalendarEntry[];
  onRemove?: (sectionId: string) => void;
  onSwap?: (sectionId: string) => void;
```

- [ ] **Step 2: Render the button beside the ×**

Immediately before the existing `{onRemove && (` block, add:

```tsx
                        {onSwap && (
                          <button
                            type="button"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              onSwap(e.sectionId);
                            }}
                            aria-label={`Swap ${e.label}`}
                            title="Swap section"
                            className="pointer-events-none absolute right-4 top-0.5 rounded px-1 text-text-secondary opacity-0 transition-opacity hover:text-foreground group-hover:pointer-events-auto group-hover:opacity-100 focus:pointer-events-auto group-focus-within:opacity-100"
                          >
                            ⇄
                          </button>
                        )}
```

`stopPropagation` is required: without it the click also fires the block's "open this course" handler. The `pointer-events` pairing keeps the button unclickable until hover reveals it, matching the `×`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. `onSwap` is optional, so existing call sites still compile.

- [ ] **Step 4: Commit**

```bash
git add src/components/schedule/ScheduleCalendar.tsx
git commit -m "feat: offer a swap action on hover over a calendar block"
```

---

### Task 6: Wire the swap into the builder

**Files:**
- Modify: `src/components/ScheduleBuilder.tsx`

**Interfaces:**
- Consumes: `swapSection` (Task 1), `SwapOverlay` (Task 3), `onSwap` on `SchedulePanelTabs` (Task 4) and on `ScheduleCalendar` (Task 5).
- Produces: a working end-to-end swap. No new exports.

- [ ] **Step 1: Import the pieces**

```tsx
import SwapOverlay from '@/components/schedule/SwapOverlay';
import { diffSections, swapSection } from '@/schedule/buffer';
```

(`diffSections` is already imported - extend that import rather than adding a second.)

- [ ] **Step 2: Add the state and handler**

Beside the other `useState` calls:

```tsx
  const [swapping, setSwapping] = useState<SectionHit | null>(null);
```

and beside `addSection` / `removeSection`:

```tsx
  function applySwap(next: SectionHit) {
    if (!swapping) return;
    setChosen((prev) => swapSection(prev, swapping.sectionId, next));
    setSwapping(null);
  }

  /** The calendar knows a sectionId; the overlay needs the whole hit. */
  function startSwapById(sectionId: string) {
    setSwapping(chosen.find((s) => s.sectionId === sectionId) ?? null);
  }
```

- [ ] **Step 3: Wire the two entry points**

On `SchedulePanelTabs`, add:

```tsx
            onSwap={(section) => setSwapping(section)}
```

On `ScheduleCalendar`, add:

```tsx
            onSwap={startSwapById}
```

- [ ] **Step 4: Render the overlay**

Beside the existing `<CourseInfoOverlay .../>`:

```tsx
      <SwapOverlay
        section={swapping}
        termId={termId}
        addedIds={addedSectionIds}
        onSwap={applySwap}
        onClose={() => setSwapping(null)}
      />
```

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no type errors. Lint shows only the six pre-existing errors listed in the Global Constraints.

- [ ] **Step 6: Verify the whole flow in the browser**

With `npm run dev` running, at `http://localhost:3000/schedule/new`:

1. Add `MATH 101` section 2A2 via Find Courses. It appears on the calendar.
2. Hover the calendar block - both `⇄` and `×` appear.
3. Click `⇄`. The overlay opens titled "Swap MATH 101 2A2", already listing MATH 101's sections, with 2A2 showing a disabled **Current**.
4. Click **Swap** on 2A3. The overlay closes and the calendar block changes to 2A3 with no flicker of the course disappearing.
5. Open **Saved Courses**, click the swap icon on the MATH 101 row - the same overlay opens.
6. In the overlay, search `CPSC 110` and swap onto one of its sections. MATH 101 leaves the schedule and CPSC 110 takes its place.
7. Press Escape and click the backdrop - both close the overlay with no change.

- [ ] **Step 7: Commit**

```bash
git add src/components/ScheduleBuilder.tsx
git commit -m "feat: wire section swapping into the schedule builder"
```

---

### Task 7: Confirm before saving a schedule with overlaps

**Files:**
- Create: `src/components/schedule/ConflictSaveDialog.tsx`
- Modify: `src/components/ScheduleBuilder.tsx`

**Interfaces:**
- Consumes: `ConflictPair` from `@/schedule/conflicts`; the `conflicts` value already computed in `ScheduleBuilder`.
- Produces: `ConflictSaveDialog` with props `{ conflicts: ConflictPair[]; onConfirm: () => void; onCancel: () => void }`. Renders nothing when `conflicts` is empty.

- [ ] **Step 1: Create the dialog**

Modelled on `UnsavedWorkDialog` (93 lines, `onDiscard`/`onCancel`, Escape dismisses, backdrop click cancels). Create `src/components/schedule/ConflictSaveDialog.tsx`:

```tsx
'use client';

import { useEffect } from 'react';
import type { ConflictPair } from '@/schedule/conflicts';

/**
 * Overlaps are legal to plan with and legal to save - UBC's meeting data can't
 * always prove a clash is real. This is the one place the student is asked,
 * because Save is where the overlap stops being a sketch.
 */
export default function ConflictSaveDialog({
  conflicts,
  onConfirm,
  onCancel,
}: {
  conflicts: ConflictPair[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (conflicts.length === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [conflicts.length, onCancel]);

  if (conflicts.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Confirm saving with overlapping classes"
        className="w-full max-w-md rounded-card border border-border bg-background p-5"
      >
        <p className="text-sm font-medium text-foreground">
          This schedule has {conflicts.length} overlapping class
          {conflicts.length === 1 ? '' : 'es'}
        </p>
        <ul className="mt-2 space-y-0.5 text-xs text-text-secondary">
          {conflicts.map((c, i) => (
            <li key={i}>
              {c.a.label} overlaps {c.b.label} on {c.a.day}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-text-tertiary">
          You can still save - UBC&apos;s timetable data can&apos;t always tell a real clash from
          an alternating-week pattern.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-pill border border-border px-4 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-pill bg-brand px-4 py-1.5 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand-hover"
          >
            Save anyway
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Gate trySave**

In `ScheduleBuilder.tsx`, add state beside the others:

```tsx
  const [confirmingConflicts, setConfirmingConflicts] = useState(false);
```

Change `trySave`'s signature and add the gate as its first statement, before `setSaving(true)`:

```tsx
  async function trySave({
    redirectAfterCreate = true,
    conflictsConfirmed = false,
  } = {}): Promise<boolean> {
    // Save is where an overlap stops being a sketch, so it is the one place we
    // ask. Planning stays silent on purpose.
    if (!conflictsConfirmed && conflicts.length > 0) {
      setConfirmingConflicts(true);
      return false;
    }

    setSaving(true);
```

Leave the rest of the function exactly as it is.

- [ ] **Step 3: Render the dialog**

Beside `<SwapOverlay .../>`:

```tsx
      <ConflictSaveDialog
        conflicts={confirmingConflicts ? conflicts : []}
        onCancel={() => setConfirmingConflicts(false)}
        onConfirm={() => {
          setConfirmingConflicts(false);
          void trySave({ conflictsConfirmed: true });
        }}
      />
```

and import it:

```tsx
import ConflictSaveDialog from '@/components/schedule/ConflictSaveDialog';
```

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no type errors; only the six pre-existing lint errors.

- [ ] **Step 5: Verify both paths in the browser**

At `http://localhost:3000/schedule/new`:

1. Build a schedule with **no** overlaps, name it, hit **Save**. It saves with no dialog - the common path must be unchanged.
2. Add two overlapping sections (e.g. `PSYC 101 007` Tue 09:30–11:00 and `MATH 101 2A2` Tue 10:00–12:00). The red banner appears as before.
3. Hit **Save**. The dialog lists the overlap in the same wording as the banner.
4. **Cancel** - nothing saves, the working set is untouched, the schedule is still on screen.
5. **Save** again, then **Save anyway** - it persists.

- [ ] **Step 6: Note the login re-entry path**

`trySave` is re-invoked after login via `open('login', () => { void trySave(); })`. That call passes no arguments, so a guest saving a conflicting schedule is asked again after signing in. That is correct - the confirmation happened before authentication, on a save that did not complete. Do not thread `conflictsConfirmed` through the auth callback to suppress it.

- [ ] **Step 7: Run the full suite**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all tests pass, no type errors, only the six pre-existing lint errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/schedule/ConflictSaveDialog.tsx src/components/ScheduleBuilder.tsx
git commit -m "feat: confirm before saving a schedule with overlapping classes"
```

---

### Task 8: Make the conflict banner dismissible

A banner that cannot be put away becomes furniture and stops being read. Dismissal is scoped to the current set of overlaps, so it can never hide one the student has not already seen.

**Files:**
- Modify: `src/components/ScheduleBuilder.tsx`
- Test: `tests/conflict-key.test.ts`
- Modify: `src/schedule/conflicts.ts` - **exception to the Global Constraint**: this adds a new exported helper. `findConflicts` itself is not touched.

**Interfaces:**
- Consumes: `ConflictPair` from `@/schedule/conflicts`.
- Produces: `conflictKey(conflicts: ConflictPair[]): string` - a stable identifier for a set of overlaps, order-independent.

- [ ] **Step 1: Write the failing test**

Create `tests/conflict-key.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { conflictKey, type ConflictPair } from '@/schedule/conflicts';

const pair = (a: string, b: string): ConflictPair => ({
  a: { sectionId: a, label: a, day: 'Mon', startTime: '09:00', endTime: '10:00' },
  b: { sectionId: b, label: b, day: 'Mon', startTime: '09:30', endTime: '10:30' },
});

describe('conflictKey', () => {
  it('is empty for no conflicts', () => {
    expect(conflictKey([])).toBe('');
  });

  it('is stable regardless of the order within a pair', () => {
    expect(conflictKey([pair('a', 'b')])).toBe(conflictKey([pair('b', 'a')]));
  });

  it('is stable regardless of the order of pairs', () => {
    expect(conflictKey([pair('a', 'b'), pair('c', 'd')])).toBe(
      conflictKey([pair('c', 'd'), pair('a', 'b')]),
    );
  });

  it('changes when a new conflict appears', () => {
    expect(conflictKey([pair('a', 'b')])).not.toBe(
      conflictKey([pair('a', 'b'), pair('c', 'd')]),
    );
  });

  it('changes when one conflict is replaced by a different one', () => {
    expect(conflictKey([pair('a', 'b')])).not.toBe(conflictKey([pair('a', 'c')]));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/conflict-key.test.ts`
Expected: FAIL - `conflictKey` is not exported from `@/schedule/conflicts`.

- [ ] **Step 3: Write the implementation**

Append to `src/schedule/conflicts.ts` - do not modify `findConflicts`:

```ts
/**
 * A stable identifier for a set of overlaps, used to scope a dismissal to the
 * conflicts that were actually on screen. Both the pair and the list are sorted
 * so the key depends only on which sections clash, never on the order
 * findConflicts happened to emit them in.
 */
export function conflictKey(conflicts: ConflictPair[]): string {
  return conflicts
    .map(({ a, b }) => [a.sectionId, b.sectionId].sort().join('~'))
    .sort()
    .join('|');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/conflict-key.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the dismissal state**

In `ScheduleBuilder.tsx`, extend the existing conflicts import:

```tsx
import { findConflicts, conflictKey } from '@/schedule/conflicts';
```

Beside the other `useState` calls:

```tsx
  const [dismissedConflicts, setDismissedConflicts] = useState<string | null>(null);
```

Below the existing `const conflicts = findConflicts(entries);`:

```tsx
  // Derived, not an effect: this file is already subject to the
  // set-state-in-effect rule, and resetting on change needs no effect at all.
  // A new or different overlap produces a new key, so the banner returns.
  const currentConflictKey = conflictKey(conflicts);
  const showConflictBanner =
    conflicts.length > 0 && dismissedConflicts !== currentConflictKey;
```

- [ ] **Step 6: Gate the banner and add the close control**

Change the banner's condition from `conflicts.length > 0 &&` to `showConflictBanner &&`, and add a close button. The wrapper gains `relative` so the button can sit in its corner:

```tsx
          {showConflictBanner && (
            <div className="relative mb-4 rounded-card border border-danger-border bg-danger-surface p-3 pr-9 text-sm text-danger">
              <button
                type="button"
                onClick={() => setDismissedConflicts(currentConflictKey)}
                aria-label="Dismiss conflict warning"
                className="absolute right-2 top-2 rounded px-1 text-danger transition-opacity hover:opacity-70"
              >
                ×
              </button>
              <p className="font-medium">
                {conflicts.length} scheduling conflict
                {conflicts.length === 1 ? '' : 's'} detected
              </p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {conflicts.map((c, i) => (
                  <li key={i}>
                    {c.a.label} overlaps {c.b.label} on {c.a.day}
                  </li>
                ))}
              </ul>
            </div>
          )}
```

The save gate in Task 7 reads `conflicts`, **not** `showConflictBanner`. Dismissing the banner must never suppress the dialog - verified in Step 8.

- [ ] **Step 7: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no type errors; only the six pre-existing lint errors.

- [ ] **Step 8: Verify in the browser**

At `http://localhost:3000/schedule/new`:

1. Create an overlap. The red banner appears.
2. Click `×`. It disappears and the calendar moves up to fill the space.
3. Hit **Save**. The confirmation dialog **still appears** - dismissal must not silence it.
4. Cancel. Add a third section that overlaps something else. The banner **returns**, because the conflict set changed.
5. Dismiss again, then remove the overlapping section entirely. No banner.
6. Recreate the same overlap. The banner appears again.

- [ ] **Step 9: Run the full suite**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all tests pass, no type errors, only the six pre-existing lint errors.

- [ ] **Step 10: Commit**

```bash
git add src/schedule/conflicts.ts src/components/ScheduleBuilder.tsx tests/conflict-key.test.ts
git commit -m "feat: let the conflict banner be dismissed for the current overlaps"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
| --- | --- |
| §3.1 calendar hover entry | Task 5 |
| §3.2 course row entry, conditional | Task 4 |
| §4 overlay shell, Escape, cancel | Task 3 |
| §5 three optional props, button order | Task 2 |
| §6 atomic swap, no duplicate, no dialog | Tasks 1, 6 |
| §7 save gate, every save, cancel safe | Task 7 |
| §7.1 banner dismissible, scoped to current overlaps | Task 8 |
| §8 testing | Tasks 1 and 8 (unit), Tasks 6–8 (browser) |
| §9.4 banner stays red | No task - styling untouched by design |

**Type consistency**

`swapSection(chosen, oldSectionId, next)` is defined in Task 1 and called with that argument order in Task 6. `SwapOverlay`'s `section`/`onSwap`/`onClose` in Task 3 match the props passed in Task 6. `onSwap` is `(section: SectionHit) => void` on the panel path and `(sectionId: string) => void` on the calendar path - deliberately different, bridged by `startSwapById` in Task 6 Step 2. `conflictKey(conflicts)` is defined in Task 8 and used only there.

**Cross-task hazard**

Tasks 7 and 8 both touch the conflict banner region of `ScheduleBuilder.tsx` and both add state. Task 7 must land first: Task 8 Step 6 rewrites the banner's JSX wholesale, and its Step 8.3 verifies that dismissing the banner does not suppress Task 7's dialog. Running them out of order will produce a merge conflict in the same block.

**Known deferral**

Spec §10 leaves the `⇄` glyph choice to implementation. Task 5 uses the character and Task 4 uses an SVG, because the calendar block is tight on space while the course row already carries SVG icons. Revisit if the glyph reads poorly at the block's size.
