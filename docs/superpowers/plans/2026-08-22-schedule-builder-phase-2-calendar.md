# Schedule Builder — Phase 2: Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain `WeekGrid` with a Notion-Calendar-styled `ScheduleCalendar` — hairline grid, soft per-course pastel blocks with a saturated accent bar, a current-time indicator, an untimed/async strip, and hover-to-remove.

**Architecture:** One new client component, `ScheduleCalendar`, is a drop-in replacement for `WeekGrid` keeping the same entry shape. Per-course colour is assigned by a pure deterministic hash into an 8-slot palette defined as CSS custom properties, so it survives reloads and matches in light and dark. Both existing `WeekGrid` consumers migrate and `WeekGrid` is deleted.

**Tech Stack:** Next.js 16 (App Router), React client components, Tailwind v4 with CSS-variable theme tokens, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-schedule-builder-redesign-design.md` (§6 is this phase)

**Builds on:** `docs/superpowers/plans/2026-08-22-schedule-builder-phase-1-unified-shell.md` (complete; branch `feat/schedule-builder-phase-1`)

## Global Constraints

- **Theme tokens only.** `foreground`, `text-secondary`, `text-tertiary`, `surface`, `surface-muted`, `background`, `border`, `border-hairline`, `brand`, `brand-hover`, `brand-foreground`, and the `rounded-pill` / `rounded-card` / `rounded-input` radii. This phase ADDS course-colour and danger tokens (Task 1). After this phase there must be **zero** raw `slate-*` / `blue-*` / `red-*` utility classes anywhere in the schedule builder or calendar.
- **Course colours are applied via inline `style` referencing CSS variables**, never via generated class names — the colour is computed at runtime and Tailwind cannot generate dynamic classes.
- **Conflicts stay advisory.** A conflicting block is still rendered and still flagged — never hidden, never blocked. `findConflicts` in `src/schedule/conflicts.ts` is unchanged.
- **Untimed meetings are never dropped.** A meeting with no day/time must remain visible somewhere on screen.
- **Click-to-open-details is NOT in this phase.** Spec §6 says a block click opens the course overlay, but that overlay is Phase 3. Do not add an `onClick`/`onSelect` prop for it — Phase 3 adds it. Hover-to-remove IS in this phase.
- `ScheduleCalendar` must work with `onRemove` omitted (the read-only "View Calendar" tab on `/schedule` has no remove affordance).
- Commit after every task. Run `npx tsc --noEmit` and `npx vitest run` before each commit; both must be clean (baseline: 294 tests passing).

---

### Task 1: Colour palette tokens and deterministic assignment

**Files:**
- Modify: `src/app/globals.css`
- Create: `src/schedule/colors.ts`
- Create: `tests/schedule-colors.test.ts`

**Interfaces:**
- Produces:
  - `COURSE_COLOR_COUNT: number` (= 8)
  - `courseColorIndex(code: string): number` — a stable 1-based index in `1..8`
- CSS variables `--course-1-bg` … `--course-8-bg`, `--course-1-accent` … `--course-8-accent`, plus `--danger`, `--danger-surface`, `--danger-border`, defined for both themes.

- [ ] **Step 1: Write the failing test**

Create `tests/schedule-colors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { courseColorIndex, COURSE_COLOR_COUNT } from '@/schedule/colors';

describe('courseColorIndex', () => {
  it('always returns a 1-based index inside the palette', () => {
    for (const code of ['CPSC 110', 'MATH 200', 'BIOL 121', 'x', '', 'ZZZZ 999']) {
      const i = courseColorIndex(code);
      expect(i).toBeGreaterThanOrEqual(1);
      expect(i).toBeLessThanOrEqual(COURSE_COLOR_COUNT);
      expect(Number.isInteger(i)).toBe(true);
    }
  });

  it('is deterministic — the same code always gets the same slot', () => {
    expect(courseColorIndex('CPSC 110')).toBe(courseColorIndex('CPSC 110'));
    expect(courseColorIndex('MATH 200')).toBe(courseColorIndex('MATH 200'));
  });

  it('spreads a realistic course load across several slots', () => {
    const load = ['CPSC 110', 'MATH 200', 'BIOL 121', 'DSCI 100', 'STAT 201'];
    const slots = new Set(load.map(courseColorIndex));
    // Not a uniqueness guarantee (collisions are legal in 8 slots) — just proof
    // it is not degenerate and mapping everything to one colour.
    expect(slots.size).toBeGreaterThan(1);
  });

  it('does not collide for two courses in the same subject', () => {
    expect(courseColorIndex('CPSC 110')).not.toBe(courseColorIndex('CPSC 121'));
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/schedule-colors.test.ts`
Expected: FAIL — cannot resolve `@/schedule/colors`.

- [ ] **Step 3: Implement the assignment**

Create `src/schedule/colors.ts`:

```ts
/** Number of course-colour slots defined in globals.css (--course-N-bg/accent). */
export const COURSE_COLOR_COUNT = 8;

/**
 * Stable colour slot for a course code, 1-based to match the CSS variable
 * names (`--course-3-bg`).
 *
 * Deterministic so a course keeps its colour across reloads and matches
 * between the calendar and the left panel. Same hash the placeholder avatars
 * in ReviewCard use, rather than a second scheme.
 */
export function courseColorIndex(code: string): number {
  let hash = 0;
  for (let i = 0; i < code.length; i++) hash = (hash * 31 + code.charCodeAt(i)) | 0;
  return (Math.abs(hash) % COURSE_COLOR_COUNT) + 1;
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run tests/schedule-colors.test.ts`
Expected: PASS (4 tests).

If the "does not collide for two courses in the same subject" case fails, do NOT weaken the test and do NOT special-case those two strings — change the multiplier (31 → 33 or 37) until real inputs separate, then re-run.

- [ ] **Step 5: Add the CSS variables**

In `src/app/globals.css`, add to the **light** `:root` block (after the existing `--brand-foreground` line, before the radius block):

```css
  /* Course-block palette for the schedule calendar — muted pastels with a
     saturated accent bar, assigned per course by src/schedule/colors.ts.
     Applied via inline style (var(--course-N-bg)), never generated classes:
     the slot is computed at runtime and Tailwind cannot emit dynamic classes. */
  --course-1-bg: #e8f0fe;
  --course-1-accent: #3b6fd4;
  --course-2-bg: #e9f2ec;
  --course-2-accent: #4a8265;
  --course-3-bg: #fbeee7;
  --course-3-accent: #b56a42;
  --course-4-bg: #f0ecfa;
  --course-4-accent: #7256b8;
  --course-5-bg: #fdf3e0;
  --course-5-accent: #b3812a;
  --course-6-bg: #e5f3f4;
  --course-6-accent: #3a8a90;
  --course-7-bg: #fceef1;
  --course-7-accent: #c05572;
  --course-8-bg: #eef0f3;
  --course-8-accent: #5b6b7f;

  /* Advisory-conflict colours. Previously raw red-* utilities, which had no
     dark-mode value and rendered as a near-white block on charcoal. */
  --danger: #b91c1c;
  --danger-surface: #fef2f2;
  --danger-border: #dc2626;
```

And add to the **dark** `:root[data-theme="dark"]` block (after `--border-hairline`):

```css
  /* Low-chroma tints so a block reads as coloured against charcoal without
     glowing. Accents stay bright enough to carry the identity at 3px wide. */
  --course-1-bg: #1e2a3d;
  --course-1-accent: #6f9ae8;
  --course-2-bg: #1e2b25;
  --course-2-accent: #79b393;
  --course-3-bg: #33241c;
  --course-3-accent: #d9976a;
  --course-4-bg: #272040;
  --course-4-accent: #a48fe0;
  --course-5-bg: #332a19;
  --course-5-accent: #e0b158;
  --course-6-bg: #172b2d;
  --course-6-accent: #6fb9bf;
  --course-7-bg: #331f26;
  --course-7-accent: #e08aa1;
  --course-8-bg: #22272e;
  --course-8-accent: #93a4b8;

  --danger: #f87171;
  --danger-surface: #3b1f1f;
  --danger-border: #7f3535;
```

Finally, inside the existing `@theme inline { … }` block add ONLY the danger entries (the course vars are used via inline style and need no Tailwind mapping):

```css
  --color-danger: var(--danger);
  --color-danger-surface: var(--danger-surface);
  --color-danger-border: var(--danger-border);
```

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run
git add src/schedule/colors.ts tests/schedule-colors.test.ts src/app/globals.css
git commit -m "feat: add course-colour and danger theme tokens"
```

---

### Task 2: The ScheduleCalendar component

**Files:**
- Create: `src/components/schedule/ScheduleCalendar.tsx`

**Interfaces:**
- Consumes: `findConflicts`, `ScheduleEntry` from `@/schedule/conflicts`; `courseColorIndex` from Task 1.
- Produces:
  - `export type CalendarEntry = ScheduleEntry & { id: string; location?: string | null; courseCode?: string | null }`
  - default export `ScheduleCalendar`, props `{ entries: CalendarEntry[]; onRemove?: (sectionId: string) => void }`

`CalendarEntry` is `WeekGridEntry` plus an optional `courseCode`. Colour is keyed on `courseCode` when present, else on `label` — so the read-only `/schedule` tab, which has no separate course code, still colours consistently.

- [ ] **Step 1: Create the component**

Create `src/components/schedule/ScheduleCalendar.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { findConflicts, type ScheduleEntry } from '@/schedule/conflicts';
import { courseColorIndex } from '@/schedule/colors';

export type CalendarEntry = ScheduleEntry & {
  id: string;
  location?: string | null;
  /** Colour is keyed on this when present, else on `label`. */
  courseCode?: string | null;
};

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
const HOUR_PX = 56;
// Always visible so the grid is a stable reference frame while adding
// sections, not just whatever the current selection happens to span.
const BASE_START_HOUR = 7;
const BASE_END_HOUR = 18;

/** "14:30" -> 870. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function formatHour(h: number): string {
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${period}`;
}

/** Minutes since midnight, or null when today is not a weekday we render. */
function nowMinutesOnWeekday(): number | null {
  const now = new Date();
  const day = now.getDay(); // 0 = Sun
  if (day < 1 || day > 5) return null;
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Weekly Mon-Fri calendar, styled after Notion Calendar: hairline grid, soft
 * per-course pastel blocks with a saturated left accent bar, and a
 * current-time indicator.
 *
 * Rows always span at least 7 AM-6 PM, expanding beyond that only when a real
 * meeting falls outside it — never clipping data to fit. A conflicting block
 * is still rendered, flagged with a danger ring, never hidden: conflicts are
 * advisory (UBC's meeting data can't always prove one is real).
 */
export default function ScheduleCalendar({
  entries,
  onRemove,
}: {
  entries: CalendarEntry[];
  onRemove?: (sectionId: string) => void;
}) {
  // Both the indicator position AND which column counts as "today" are
  // resolved only after mount. The server's clock and timezone need not match
  // the viewer's, so deriving either during render would hydrate-mismatch —
  // including the day-header highlight, which is easy to overlook.
  const [now, setNow] = useState<{ minutes: number | null; dayIndex: number } | null>(null);
  useEffect(() => {
    const read = () => setNow({ minutes: nowMinutesOnWeekday(), dayIndex: new Date().getDay() - 1 });
    read();
    const timer = setInterval(read, 60_000);
    return () => clearInterval(timer);
  }, []);
  const nowMin = now?.minutes ?? null;
  // -1 until mounted, so no column is highlighted during SSR.
  const todayIndex = now?.dayIndex ?? -1;

  const timed = entries.filter(
    (e): e is CalendarEntry & { startTime: string; endTime: string } =>
      (DAYS as readonly string[]).includes(e.day) && e.startTime !== null && e.endTime !== null,
  );
  const timedSet = new Set<CalendarEntry>(timed);
  const untimed = entries.filter((e) => !timedSet.has(e));

  // findConflicts returns pairs referencing the same objects passed in, so
  // object identity tells us which blocks to flag.
  const conflictsByEntry = new Map<ScheduleEntry, string[]>();
  for (const { a, b } of findConflicts(timed)) {
    conflictsByEntry.set(a, [...(conflictsByEntry.get(a) ?? []), b.label]);
    conflictsByEntry.set(b, [...(conflictsByEntry.get(b) ?? []), a.label]);
  }

  const starts = timed.map((e) => toMinutes(e.startTime));
  const ends = timed.map((e) => toMinutes(e.endTime));
  const minHour = Math.min(
    BASE_START_HOUR,
    ...(starts.length ? [Math.floor(Math.min(...starts) / 60)] : []),
  );
  const maxHour = Math.max(
    BASE_END_HOUR,
    ...(ends.length ? [Math.ceil(Math.max(...ends) / 60)] : []),
  );
  const hours = Array.from({ length: maxHour - minHour }, (_, i) => minHour + i);
  const gridStartMin = minHour * 60;
  const totalHeight = hours.length * HOUR_PX;

  const nowTop =
    nowMin !== null && nowMin >= gridStartMin && nowMin <= maxHour * 60
      ? ((nowMin - gridStartMin) / 60) * HOUR_PX
      : null;

  return (
    <div className="overflow-x-auto">
      {untimed.length > 0 && (
        <div className="mb-3 rounded-card border border-border bg-surface-muted px-3 py-2">
          <p className="text-xs font-medium text-foreground">No fixed meeting time</p>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {untimed.map((e) => (
              <li key={e.id} className="flex items-center gap-1.5 text-xs text-text-secondary">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    background: `var(--course-${courseColorIndex(e.courseCode ?? e.label)}-accent)`,
                  }}
                />
                {e.label}
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(e.sectionId)}
                    aria-label={`Remove ${e.label}`}
                    className="text-text-tertiary hover:text-foreground"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="min-w-[680px] overflow-hidden rounded-card border border-border">
        <div className="flex">
          <div className="w-16 shrink-0">
            <div className="h-9 border-b border-border" />
            {hours.map((h) => (
              <div
                key={h}
                className="relative border-b border-border-hairline pr-2 text-right"
                style={{ height: HOUR_PX }}
              >
                <span className="absolute -top-2 right-2 text-[11px] text-text-tertiary">
                  {formatHour(h)}
                </span>
              </div>
            ))}
          </div>

          {DAYS.map((day, dayIndex) => (
            <div key={day} className="min-w-0 flex-1 border-l border-border-hairline">
              <div
                className={`flex h-9 items-center justify-center border-b border-border text-xs font-medium ${
                  dayIndex === todayIndex ? 'text-brand' : 'text-text-secondary'
                }`}
              >
                {day}
              </div>

              <div className="relative" style={{ height: totalHeight }}>
                {hours.map((h) => (
                  <div
                    key={h}
                    className="border-b border-border-hairline"
                    style={{ height: HOUR_PX }}
                  />
                ))}

                {nowTop !== null && dayIndex === todayIndex && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 z-10 border-t border-brand"
                    style={{ top: nowTop }}
                  >
                    <span className="absolute -left-1 -top-1 block h-2 w-2 rounded-full bg-brand" />
                  </div>
                )}

                {timed
                  .filter((e) => e.day === day)
                  .map((e) => {
                    const top = ((toMinutes(e.startTime) - gridStartMin) / 60) * HOUR_PX;
                    const height =
                      ((toMinutes(e.endTime) - toMinutes(e.startTime)) / 60) * HOUR_PX;
                    const conflictLabels = conflictsByEntry.get(e);
                    const slot = courseColorIndex(e.courseCode ?? e.label);

                    return (
                      <div
                        key={e.id}
                        title={
                          conflictLabels
                            ? `Conflicts with ${conflictLabels.join(', ')}`
                            : `${e.label} · ${e.startTime}–${e.endTime}`
                        }
                        className={`group absolute inset-x-1 overflow-hidden rounded-md pl-2 pr-1 py-1 text-[11px] leading-tight ${
                          conflictLabels ? 'ring-2 ring-danger-border' : ''
                        }`}
                        style={{
                          top,
                          height,
                          background: `var(--course-${slot}-bg)`,
                          boxShadow: `inset 3px 0 0 0 var(--course-${slot}-accent)`,
                        }}
                      >
                        {onRemove && (
                          <button
                            type="button"
                            onClick={() => onRemove(e.sectionId)}
                            aria-label={`Remove ${e.label}`}
                            className="absolute right-0.5 top-0.5 hidden rounded px-1 text-text-secondary hover:text-foreground group-hover:block"
                          >
                            ×
                          </button>
                        )}
                        <p className="truncate font-medium text-foreground">{e.label}</p>
                        <p className="truncate text-text-secondary">
                          {e.startTime}–{e.endTime}
                        </p>
                        {e.location && (
                          <p className="truncate text-text-tertiary">{e.location}</p>
                        )}
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run
git add src/components/schedule/ScheduleCalendar.tsx
git commit -m "feat: add Notion-styled ScheduleCalendar"
```

---

### Task 3: Wire the calendar into the builder

**Files:**
- Modify: `src/components/ScheduleBuilder.tsx`

**Interfaces:**
- Consumes: `ScheduleCalendar`, `CalendarEntry` (Task 2).

- [ ] **Step 1: Swap the import**

In `src/components/ScheduleBuilder.tsx`, replace:

```tsx
import WeekGrid, { type WeekGridEntry } from '@/components/WeekGrid';
```

with:

```tsx
import ScheduleCalendar, { type CalendarEntry } from '@/components/schedule/ScheduleCalendar';
```

- [ ] **Step 2: Populate courseCode on the entries**

Change the `entries` builder (currently `const entries: WeekGridEntry[] = chosen.flatMap(...)`) so its type is `CalendarEntry[]` and each entry carries the course code, which is what colours the block:

```tsx
  const entries: CalendarEntry[] = chosen.flatMap((s) =>
    s.meetingTimes.map((m, i) => ({
      id: `${s.sectionId}-${i}`,
      sectionId: s.sectionId,
      label: `${s.code} ${s.sectionCode}`,
      courseCode: s.code,
      day: m.day,
      startTime: m.startTime,
      endTime: m.endTime,
      location: m.building ? `${m.building}${m.room ? ` ${m.room}` : ''}` : null,
    })),
  );
```

- [ ] **Step 3: Render the calendar with remove wired up**

Replace `<WeekGrid entries={entries} />` with:

```tsx
          <ScheduleCalendar entries={entries} onRemove={removeSection} />
```

`removeSection` already exists in this component and takes a `sectionId`.

- [ ] **Step 4: Restyle the conflict banner onto the danger tokens**

The banner still uses raw `red-*` utilities, which have no dark-mode value and render as a near-white block on charcoal. Replace the banner's wrapper classes:

```tsx
            <div className="mb-4 rounded-card border border-danger-border bg-danger-surface p-3 text-sm text-danger">
```

- [ ] **Step 5: Restyle the error banner onto the danger token**

Same problem, same fix. Replace:

```tsx
        <p className="border-b border-border px-6 py-2 text-sm text-danger">{error}</p>
```

- [ ] **Step 6: Confirm no raw colour utilities remain in this file**

Run: `grep -nE "(slate|blue|red)-[0-9]" src/components/ScheduleBuilder.tsx`
Expected: no output. If anything prints, convert it to a theme token.

- [ ] **Step 7: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run
git add src/components/ScheduleBuilder.tsx
git commit -m "feat: render the schedule builder on the new calendar"
```

---

### Task 4: Migrate the second consumer and delete WeekGrid

`WeekGrid` has a second consumer beyond the builder: the read-only "View Calendar" tab on `/schedule`. It must migrate too, or `WeekGrid` cannot be deleted and the app ships two different calendars.

**Files:**
- Modify: `src/components/ScheduleTabs.tsx`
- Modify: `src/app/schedule/page.tsx`
- Delete: `src/components/WeekGrid.tsx`

**Interfaces:**
- Consumes: `ScheduleCalendar`, `CalendarEntry` (Task 2).
- Produces: `CalendarTermGroup` in `ScheduleTabs.tsx` now holds `CalendarEntry[]` instead of `WeekGridEntry[]`.

- [ ] **Step 1: Migrate ScheduleTabs**

In `src/components/ScheduleTabs.tsx`:

Replace the import:

```tsx
import ScheduleCalendar, { type CalendarEntry } from '@/components/schedule/ScheduleCalendar';
```

Update the exported type (it currently reads `entries: WeekGridEntry[]`):

```tsx
export type CalendarTermGroup = { termId: string; termName: string; entries: CalendarEntry[] };
```

And replace the render call `<WeekGrid entries={group.entries} />` with:

```tsx
          <ScheduleCalendar entries={group.entries} />
```

No `onRemove` — this view is read-only, and the prop is optional precisely for this case.

- [ ] **Step 2: Migrate the page's type import**

In `src/app/schedule/page.tsx`, replace:

```tsx
import type { WeekGridEntry } from '@/components/WeekGrid';
```

with:

```tsx
import type { CalendarEntry } from '@/components/schedule/ScheduleCalendar';
```

and change the `satisfies WeekGridEntry` assertion to `satisfies CalendarEntry`.

This page builds its entries from `EnrollmentMeeting` rows and already computes a `label` like `CPSC_V 110-103`. Add a `courseCode` so blocks colour by course rather than by the section-specific label:

```tsx
        courseCode: `${course.subject.code}_${course.campus} ${course.number}`,
```

Place it alongside the existing `label` property in the same object literal.

- [ ] **Step 3: Delete WeekGrid**

```bash
rm src/components/WeekGrid.tsx
```

- [ ] **Step 4: Prove nothing still references it**

Run: `grep -rn "WeekGrid" src/ tests/`
Expected: no output. If anything prints, migrate that reference before continuing — do not restore the file.

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run
git add -A
git commit -m "refactor: migrate the schedule list calendar and delete WeekGrid"
```

---

### Task 5: Verify in a real browser

Typecheck and unit tests cannot show that the calendar looks right, that colours are stable, or that hover-to-remove works.

**Files:**
- Create (temporary, NOT committed): `_smoke_calendar.mjs`

- [ ] **Step 1: Confirm the dev server**

A dev server is normally already running. Check:

```bash
curl -sf http://localhost:3000 >/dev/null && echo UP
```

If it is not up, start it with `npm run dev` and wait for it. Do NOT start a second one if it is already running — Next.js refuses and exits.

- [ ] **Step 2: Write the smoke script**

Create `_smoke_calendar.mjs` in the repo root:

```js
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const BASE = 'http://localhost:3000';
const email = `smoke-cal-${Date.now()}@example.com`;
const password = 'smoke-test-password-123';

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

try {
  // Find a term with at least two different courses that have meeting times,
  // so the screenshot actually shows more than one colour.
  const sections = await prisma.section.findMany({
    where: { meetingTimes: { some: { startTime: { not: null } } } },
    include: { course: { include: { subject: true } }, meetingTimes: true },
    take: 200,
  });
  const byTerm = new Map();
  for (const s of sections) {
    const list = byTerm.get(s.termId) ?? [];
    list.push(s);
    byTerm.set(s.termId, list);
  }
  let termId = null;
  let codes = [];
  for (const [tid, list] of byTerm) {
    const distinct = [...new Set(list.map((s) => `${s.course.subject.code} ${s.course.number}`))];
    if (distinct.length >= 2) { termId = tid; codes = distinct.slice(0, 2); break; }
  }
  if (!termId) throw new Error('no term with two timetabled courses found');

  await page.goto(`${BASE}/signup`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button:has-text("Sign Up")');
  await page.waitForURL('**/onboarding');

  await page.goto(`${BASE}/schedule/new?name=Colour%20Check&termId=${encodeURIComponent(termId)}`);
  await page.click('button:text-is("Find Courses")');

  for (const code of codes) {
    await page.fill('input[aria-label="Search courses"]', code);
    await page.waitForSelector(`summary:has-text("${code}")`, { timeout: 5000 });
    await page.click(`summary:has-text("${code}")`);
    await page.locator('button:text-is("Add")').first().click();
    await page.waitForTimeout(300);
  }

  // Blocks must have rendered with a real per-course background.
  const blockBg = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[style*="--course-"]')];
    return els.slice(0, 4).map((el) => getComputedStyle(el).backgroundColor);
  });
  console.log('BLOCK BACKGROUNDS:', JSON.stringify(blockBg));
  if (blockBg.length === 0) throw new Error('no coloured course blocks rendered');

  await page.screenshot({ path: 'calendar-light.png', fullPage: true });
  console.log('LIGHT OK');

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'calendar-dark.png', fullPage: true });
  console.log('DARK OK');

  console.log('CONSOLE ERRORS:', JSON.stringify(errors));
} finally {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) await prisma.savedSchedule.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { email } }).catch(() => {});
  await browser.close();
  await prisma.$disconnect();
}
```

- [ ] **Step 3: Run it**

Run: `node --env-file=.env _smoke_calendar.mjs`
Expected: a non-empty `BLOCK BACKGROUNDS` array, `LIGHT OK`, `DARK OK`, and `CONSOLE ERRORS: []`.

- [ ] **Step 4: Look at both screenshots**

Open `calendar-light.png` and `calendar-dark.png` and confirm by eye:
1. Two different courses have visibly **different** block colours.
2. Blocks show a saturated left accent bar against a soft fill.
3. Text inside a block is readable in BOTH themes — this is the single most likely defect, since the pastels are fixed values and the foreground token flips.
4. Grid lines read as hairlines, not heavy borders.
5. The dark screenshot has no near-white/glowing blocks and no white conflict banner.

A blank, clipped, or half-height screenshot is a failure even if the script printed OK.

- [ ] **Step 5: Clean up**

```bash
rm -f _smoke_calendar.mjs calendar-light.png calendar-dark.png
git status --short
```

Expected: clean tree (these were never committed). Nothing to commit for this task.

---

## Phase 2 done when

- The builder and the `/schedule` "View Calendar" tab both render `ScheduleCalendar`; `WeekGrid` no longer exists.
- A course keeps the same colour across reloads, and two courses in one schedule are visually distinct.
- Blocks are legible in light AND dark.
- Hovering a block in the builder reveals a working remove control; the read-only tab has none.
- Untimed meetings are still visible, in the strip above the grid.
- Conflicts still render, flagged with the danger ring.
- `grep -rn "WeekGrid" src/ tests/` is empty, and no raw `slate-*`/`blue-*`/`red-*` remains in the builder or calendar.
- `npx vitest run` and `npx tsc --noEmit` clean.

## Deliberately not in this phase

- **Clicking a block to open course details** — that overlay is Phase 3, which adds the click handler then.
- Drag-to-move / drag-to-resize (spec §12: out of scope entirely — sections have fixed registrar-set times).
- Multi-term side-by-side view (spec §12).
- The ⓘ buttons in the left panel (Phase 3).
