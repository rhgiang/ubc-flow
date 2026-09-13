# Meeting Location + Two Data-Loss Fixes - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse meeting location out of the Workday export, and close the two data-loss holes deferred during Phases 1-4.

**Architecture:** Three independent fixes. Location is extracted in the existing Workday parser and stored on `EnrollmentMeeting` (the catalogue API has no location at all, so the export is the only source we have). I-5 adds a shared unsaved-changes context so nav links can guard a dirty builder. I-4 gives the builder's Save an optimistic-concurrency check against the section set it loaded with.

**Tech Stack:** Next.js 16 (App Router), Prisma 7 + PostgreSQL, ExcelJS, Vitest.

**Context:** These were surfaced by phase reviews and deferred. I-5 was explicitly ruled "must be fixed before Phase 4 ships Workday import" - Phase 4 shipped without it, so this repays that.

## Global Constraints

- **Never write one student's data into shared catalogue tables.** Location parsed from a personal export belongs on `EnrollmentMeeting` (that student's own row), never on `MeetingTime` (the shared catalogue).
- Reuse the existing parser structure - `parseMeetingPattern` already splits the cell; extend it, do not rewrite it.
- Theme tokens only. No raw `slate-*`/`blue-*`/`red-*`. `brand` as a foreground is forbidden; use `brand-accent`.
- Commit after every task. `npx tsc --noEmit` and `npx vitest run` clean before each commit (baseline: **321 tests passing**).
- Prisma migrations: create with `npx prisma migrate dev --name <name>`, then `npx prisma generate`.

---

### Task 1: Parse meeting location from the Workday export

Verified against a real export. The "Meeting Patterns" cell is pipe-delimited with 7 segments:

```
[0] 2026-09-09 - 2026-12-04
[1] Wed Fri
[2] 10:00 a.m. - 11:30 a.m.
[3] UBCV
[4] Hennings Building (HENN)
[5] Floor: 1
[6] Room: 202
```

Segment 4's **last parenthetical** is the building code - both `Hennings Building (HENN)` → `HENN` and `CIRS (Centre for Interactive Research on Sustainability) (CIRS)` → `CIRS`. Segment 6 is `Room: <value>`. Floor is deliberately not stored: room numbers already encode it (`B1001`, `X260`).

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/upload/parse-workday.ts`
- Modify: `src/upload/import.ts`
- Modify: `tests/parse-workday.test.ts`

**Interfaces:**
- Produces: `parseMeetingPattern` returns two more fields, `building: string | null` and `room: string | null`; `EnrollmentRow` gains `building` and `room`; `EnrollmentMeeting` gains `building` and `room` columns.

- [ ] **Step 1: Write the failing tests**

Append to `tests/parse-workday.test.ts`, inside the existing `describe('parseMeetingPattern', …)` block if there is one, otherwise as a new describe:

```ts
  it('extracts the building code from the trailing parenthetical', () => {
    const cell =
      '2026-09-09 - 2026-12-04 | Wed Fri | 10:00 a.m. - 11:30 a.m. | UBCV | Hennings Building (HENN) | Floor: 1 | Room: 202';
    const m = parseMeetingPattern(cell);
    expect(m.building).toBe('HENN');
    expect(m.room).toBe('202');
  });

  it('takes the LAST parenthetical when the name repeats the code', () => {
    const cell =
      '2026-09-09 - 2026-12-04 | Wed | 10:00 a.m. - 11:30 a.m. | UBCV | CIRS (Centre for Interactive Research on Sustainability) (CIRS) | Floor: 1 | Room: 1250';
    expect(parseMeetingPattern(cell).building).toBe('CIRS');
  });

  it('handles a room with a letter prefix and a negative floor', () => {
    const cell =
      '2026-09-09 - 2026-12-04 | Mon | 2:00 p.m. - 3:30 p.m. | UBCV | Gordon B. Shrum Building (SHRM) | Floor: -1 | Room: B1001';
    const m = parseMeetingPattern(cell);
    expect(m.building).toBe('SHRM');
    expect(m.room).toBe('B1001');
  });

  it('returns nulls when the cell carries no location segments', () => {
    const m = parseMeetingPattern('2026-09-09 - 2026-12-04 | Wed | 10:00 a.m. - 11:30 a.m.');
    expect(m.building).toBeNull();
    expect(m.room).toBeNull();
    // The fields it already parsed must be unaffected.
    expect(m.days).toEqual(['Wed']);
    expect(m.startTime).toBe('10:00');
  });

  it('falls back to the raw building segment when it has no parenthetical', () => {
    const cell = '2026-09-09 - 2026-12-04 | Wed | 10:00 a.m. - 11:30 a.m. | UBCV | Some Hall | Floor: 2 | Room: 5';
    expect(parseMeetingPattern(cell).building).toBe('Some Hall');
  });
```

Run: `npx vitest run tests/parse-workday.test.ts` → FAIL (`building`/`room` do not exist).

- [ ] **Step 2: Extend the parser**

In `src/upload/parse-workday.ts`:

Add a helper next to `to24Hour`:

```ts
/**
 * "Hennings Building (HENN)" -> "HENN". The building's short code is the LAST
 * parenthetical, because some names repeat the code up front:
 * "CIRS (Centre for Interactive Research on Sustainability) (CIRS)".
 * A segment with no parenthetical is used as-is rather than dropped.
 */
function buildingCode(segment: string): string | null {
  const trimmed = segment.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/\(([^()]*)\)\s*$/);
  return (m ? m[1].trim() : trimmed) || null;
}
```

Extend `parseMeetingPattern`'s return type with `building: string | null; room: string | null;`, and inside it - after the existing `segments` split - add:

```ts
  const building = segments[4] ? buildingCode(segments[4]) : null;
  const roomRaw = segments[6]?.replace(/^Room:\s*/i, '').trim();
  const room = roomRaw || null;
```

and include `building` and `room` in the returned object. Update the function's doc comment's example cell to show the location segments.

Then extend `EnrollmentRow` with `building: string | null;` and `room: string | null;`, populate them in the `rows.push({…})` call from `meeting.building` / `meeting.room`, and update the `meetingCol === undefined` fallback object to include `building: null, room: null` (it must match the widened return type or `tsc` will fail).

Run: `npx vitest run tests/parse-workday.test.ts` → PASS.

- [ ] **Step 3: Add the columns**

In `prisma/schema.prisma`, add to `model EnrollmentMeeting`, after `activity`:

```prisma
  building    String?
  room        String?
```

Then:

```bash
npx prisma migrate dev --name add_enrollment_meeting_location
npx prisma generate
```

**Do NOT touch `model MeetingTime`.** That is the shared catalogue table; a location parsed from one student's personal export must never be written there.

- [ ] **Step 4: Persist them**

In `src/upload/import.ts`, the `db.enrollmentMeeting.create({ data: { … } })` call already passes `sectionCode`, `activity`, `days`, `startTime`, `endTime`. Add:

```ts
          building: row.building,
          room: row.room,
```

- [ ] **Step 5: Show it on the schedule calendar**

`src/app/schedule/page.tsx` builds `CalendarEntry` objects from `EnrollmentMeeting` rows in a loop over `meetings` (loop variable `m`). `CalendarEntry` already supports an optional `location` - the builder populates it and `ScheduleCalendar` already renders it. Add to that object literal:

```tsx
        location: m.building ? `${m.building}${m.room ? ` ${m.room}` : ''}` : null,
```

This matches the format `ScheduleBuilder` already uses.

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run
git add prisma/ src/upload/parse-workday.ts src/upload/import.ts src/app/schedule/page.tsx tests/parse-workday.test.ts
git commit -m "feat: parse meeting location from the Workday export"
```

Expect 326 tests (321 + 5).

---

### Task 2: Guard client-side navigation away from a dirty builder (I-5)

`ScheduleBuilder` guards `beforeunload`, which covers tab close and reload but **not** App Router `<Link>` navigation. A student imports their whole Workday timetable, clicks "Explore" in the nav, and the buffer is gone with no prompt - precisely the case the guard exists for.

Next 16's `<Link>` supports `onNavigate(e)` with `e.preventDefault()` (see `node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md`). The nav lives in a different component from the builder, so they need a shared signal.

**Files:**
- Create: `src/components/UnsavedChangesContext.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/components/ScheduleBuilder.tsx`
- Modify: `src/components/NavLinks.tsx`

**Interfaces:**
- Produces:
  - `UnsavedChangesProvider` (client)
  - `useUnsavedChanges(): { setDirty: (dirty: boolean) => void; confirmLeave: () => boolean }`

- [ ] **Step 1: Create the context**

Create `src/components/UnsavedChangesContext.tsx`:

```tsx
'use client';

import { createContext, useCallback, useContext, useRef, type ReactNode } from 'react';

type UnsavedChangesState = {
  /** Called by whichever editor currently holds unsaved work. */
  setDirty: (dirty: boolean) => void;
  /** Returns true if it is safe to navigate away. Prompts when it is not. */
  confirmLeave: () => boolean;
};

const Ctx = createContext<UnsavedChangesState | null>(null);

/**
 * Lets a nav link ask an unrelated editor whether it is safe to leave.
 *
 * The builder buffers edits in memory (spec §3.1), and `beforeunload` only
 * covers tab close and reload - an App Router <Link> click is a client-side
 * navigation the browser never hears about. Without this, one click on
 * "Explore" silently discards a whole imported timetable.
 *
 * A ref, not state: nothing renders from this, and re-rendering the whole app
 * on every keystroke in the schedule-name field would be a real cost for no
 * benefit.
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirty = useRef(false);

  const setDirty = useCallback((next: boolean) => {
    dirty.current = next;
  }, []);

  const confirmLeave = useCallback(() => {
    if (!dirty.current) return true;
    return window.confirm('You have unsaved changes to this schedule. Leave without saving?');
  }, []);

  return <Ctx.Provider value={{ setDirty, confirmLeave }}>{children}</Ctx.Provider>;
}

export function useUnsavedChanges(): UnsavedChangesState {
  const ctx = useContext(Ctx);
  // A no-op default keeps this usable from components rendered outside the
  // provider (and in tests) without a crash.
  return ctx ?? { setDirty: () => {}, confirmLeave: () => true };
}
```

- [ ] **Step 2: Mount the provider**

In `src/app/layout.tsx`, import `UnsavedChangesProvider` and wrap the existing children - it must sit **outside** `Nav` so both the nav and the page can reach it. The body currently renders `<AuthOverlayProvider>` wrapping `Nav`, `children`, `ThemeToggle`, `AuthOverlay`. Put `UnsavedChangesProvider` immediately inside `AuthOverlayProvider`, wrapping that same set.

- [ ] **Step 3: Register the builder's dirty state**

In `src/components/ScheduleBuilder.tsx`, import `useUnsavedChanges`, call it, and add an effect that mirrors the existing `dirty` value into it and clears it on unmount:

```tsx
  const { setDirty } = useUnsavedChanges();
  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);
```

Place it next to the existing `beforeunload` effect. Leave that effect alone - it still covers reload and tab close, which `onNavigate` does not.

- [ ] **Step 4: Guard the nav links**

In `src/components/NavLinks.tsx`, import `useUnsavedChanges` and call it. On the `<Link>` element, add:

```tsx
            onNavigate={(e) => {
              if (!confirmLeave()) e.preventDefault();
            }}
```

Only the `<Link>` branch needs it - the other branch is a `<button>` that opens the auth overlay without navigating.

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run
git add src/components/UnsavedChangesContext.tsx src/app/layout.tsx src/components/ScheduleBuilder.tsx src/components/NavLinks.tsx
git commit -m "fix: warn before navigating away from a schedule with unsaved changes"
```

---

### Task 3: Stop a buffered Save from silently reverting a concurrent add (I-4)

`src/app/course/[code]/page.tsx:151` adds a section to a saved schedule via a write-through server action. The builder buffers and Saves by **replacing** the whole section set. So: open the builder, add a section from a course page in another tab, Save the builder - the course-page add is deleted with no warning.

The fix is optimistic concurrency: the builder tells the server which section set it loaded with, and the server refuses if the stored set has moved on.

**Files:**
- Modify: `src/app/actions/schedule.ts`
- Modify: `src/components/ScheduleBuilder.tsx`
- Modify: `tests/schedule-actions.test.ts`

**Interfaces:**
- `replaceScheduleSectionsFor(userId, scheduleId, name, sectionIds, expectedSectionIds)` - one new trailing parameter.
- `replaceScheduleSections(scheduleId, name, sectionIds, expectedSectionIds)` - same.

- [ ] **Step 1: Write the failing tests**

Append to `tests/schedule-actions.test.ts`:

```ts
describe('replaceScheduleSectionsFor staleness', () => {
  it('saves when the stored set matches what the caller loaded with', async () => {
    const created = await createScheduleFor(ownerId, termId, 'Stale A');
    if (!created.ok) throw new Error(created.error);

    const result = await replaceScheduleSectionsFor(ownerId, created.scheduleId, 'Stale A', [sectionId], []);
    expect(result).toEqual({ ok: true });
  });

  it('refuses when the schedule changed elsewhere since it was loaded', async () => {
    const created = await createScheduleFor(ownerId, termId, 'Stale B');
    if (!created.ok) throw new Error(created.error);
    const id = created.scheduleId;

    // Someone else (e.g. the course page) adds a section after the builder loaded.
    await addSectionFor(ownerId, id, sectionId);

    // The builder still believes the schedule was empty.
    const result = await replaceScheduleSectionsFor(ownerId, id, 'Stale B', [], []);
    expect(result.ok).toBe(false);

    // And the concurrent add must survive.
    const row = await db.savedSchedule.findUniqueOrThrow({
      where: { id },
      include: { sections: true },
    });
    expect(row.sections.map((s) => s.sectionId)).toEqual([sectionId]);
  });

  it('ignores ordering when comparing the baseline', async () => {
    const second = await db.section.findFirstOrThrow({
      where: { termId, id: { not: sectionId } },
      select: { id: true },
    });
    const created = await createScheduleFor(ownerId, termId, 'Stale C');
    if (!created.ok) throw new Error(created.error);
    const id = created.scheduleId;

    await replaceScheduleSectionsFor(ownerId, id, 'Stale C', [sectionId, second.id], []);
    // Same set, reversed order - must be accepted.
    const result = await replaceScheduleSectionsFor(ownerId, id, 'Stale C', [sectionId], [second.id, sectionId]);
    expect(result).toEqual({ ok: true });
  });
});
```

Add `addSectionFor` to that file's import list if it is not already there.

Run: `npx vitest run tests/schedule-actions.test.ts` → FAIL (wrong arity).

- [ ] **Step 2: Add the check**

In `src/app/actions/schedule.ts`, `replaceScheduleSectionsFor` already loads `existing` (the stored section ids) before diffing. Add the new parameter and compare **as a set, order-independent**, immediately after that load and before the term validation:

```ts
  const storedIds = existing.map((s) => s.sectionId);
  const expected = new Set(expectedSectionIds);
  const stored = new Set(storedIds);
  const unchanged =
    expected.size === stored.size && [...stored].every((id) => expected.has(id));
  if (!unchanged) {
    return {
      ok: false,
      error: 'This schedule changed somewhere else. Reload the page before saving.',
    };
  }
```

Add `expectedSectionIds: string[]` as the last parameter of both `replaceScheduleSectionsFor` and the `replaceScheduleSections` wrapper, and pass it through.

Run: `npx vitest run tests/schedule-actions.test.ts` → PASS.

- [ ] **Step 3: Send the baseline from the builder**

In `src/components/ScheduleBuilder.tsx`, `trySave` calls `replaceScheduleSections(scheduleId, name, sectionIds)`. The builder already has `initialIds` - the exact set it loaded with - used by the `dirty` memo. Pass it:

```tsx
      const result = await replaceScheduleSections(scheduleId, name, sectionIds, initialIds);
```

Do not change the draft-mode branch (`saveGuestSchedule`) - a draft has no stored baseline to be stale against.

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run
git add src/app/actions/schedule.ts src/components/ScheduleBuilder.tsx tests/schedule-actions.test.ts
git commit -m "fix: refuse a stale schedule save instead of reverting a concurrent change"
```

Expect 329 tests (326 + 3).

---

### Task 4: Verify in a real browser

**Files:**
- Create (temporary, NOT committed): `_smoke_fixes.mjs`

**PRIVACY:** `rgschedule/View_My_Courses.xlsx` is a real student's export (gitignored). Reference it by path only - never open, print, or copy its contents. Report aggregate counts and building codes only (building codes are public campus buildings, fine to report).

- [ ] **Step 1: Confirm the dev server**

```bash
curl -sf http://localhost:3000 >/dev/null && echo UP
```

Already running - do NOT start a second.

- [ ] **Step 2: Verify location parses end to end**

```bash
node --env-file=.env -e "
const { readFileSync } = require('fs');
require('tsx/cjs');
const { readWorkbookGrid } = require('./src/upload/read-grid.ts');
const { parseWorkdayExport } = require('./src/upload/parse-workday.ts');
(async () => {
  const grid = await readWorkbookGrid(readFileSync('rgschedule/View_My_Courses.xlsx'));
  const parsed = parseWorkdayExport(grid);
  const withLoc = parsed.rows.filter(r => r.building);
  console.log('rows:', parsed.rows.length, '| with building:', withLoc.length);
  console.log('distinct buildings:', JSON.stringify([...new Set(withLoc.map(r => r.building))]));
  console.log('sample room values:', JSON.stringify(withLoc.slice(0,3).map(r => r.room)));
})();"
```

If `tsx/cjs` does not load, use `npx tsx -e '<same code with ES imports>'` instead. Expected: every row has a building, and the codes look like `HENN`, `SHRM`, `ICCS`.

- [ ] **Step 3: Smoke the two guards**

Create `_smoke_fixes.mjs`:

```js
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto('http://localhost:3000/schedule/new?name=Guard');

  // Nothing added yet -> navigating away must NOT prompt.
  let prompted = false;
  page.on('dialog', async (d) => { prompted = true; await d.dismiss(); });
  await page.click('a:has-text("Explore")');
  await page.waitForURL('**/explore', { timeout: 8000 });
  console.log('CLEAN BUILDER NAVIGATES FREELY:', prompted === false);

  // Now make it dirty and try again.
  await page.goto('http://localhost:3000/schedule/new?name=Guard');
  await page.click('button:text-is("Find Courses")');
  await page.fill('input[aria-label="Search courses"]', 'CPSC');
  await page.waitForSelector('summary', { timeout: 8000 });
  await page.click('summary >> nth=0');
  await page.locator('button:text-is("Add")').first().click();
  await page.waitForSelector('button:text-is("Added")');

  prompted = false;
  page.once('dialog', async (d) => {
    prompted = true;
    console.log('  prompt text:', d.message());
    await d.dismiss(); // Cancel -> stay put.
  });
  await page.click('a:has-text("Explore")');
  await page.waitForTimeout(1200);
  console.log('DIRTY BUILDER PROMPTS:', prompted);
  console.log('STAYED ON BUILDER AFTER CANCEL:', page.url().includes('/schedule/new'));

  console.log('CONSOLE ERRORS:', JSON.stringify(errors));
} finally {
  await browser.close();
}
```

Run: `node _smoke_fixes.mjs`
Expected: `CLEAN BUILDER NAVIGATES FREELY: true`, `DIRTY BUILDER PROMPTS: true`, `STAYED ON BUILDER AFTER CANCEL: true`, `CONSOLE ERRORS: []`.

A dirty builder that does NOT prompt is a real failure - report it, do not relax the assertion.

- [ ] **Step 4: Clean up**

```bash
rm -f _smoke_fixes.mjs
git status --short
```

Expected: clean tree.

---

## Done when

- Every row of a real Workday export yields a building code and room.
- Location appears on `/schedule`'s "View Calendar" tab for imported enrolments.
- `MeetingTime` (the shared catalogue) is untouched.
- Navigating away from a dirty builder prompts; a clean builder does not.
- Saving a schedule that changed elsewhere is refused, and the concurrent change survives.
- `npx vitest run` and `npx tsc --noEmit` clean.

## Deliberately not in this phase

- Showing location on the **builder's** calendar or the course overlay. Those read catalogue `MeetingTime`, and `src/scrape/parse-nodes.ts:146` records that UBC's API exposes no location at all - there is no source to populate them from. Only a student's own imported enrolments can carry location.
- Storing the floor. Room numbers already encode it (`B1001`, `X260`).
- Guarding navigation from anywhere other than the nav links.
