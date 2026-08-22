# Schedule Builder — Phase 1: Unified Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the guest builder and the saved-schedule editor into one full-bleed, Workday-shaped builder with a tabbed left panel and search that queries as you type.

**Architecture:** `ScheduleBuilder` becomes the single client component behind both `/schedule/new` (draft mode) and `/schedule/[id]` (saved mode). Both modes hold the working section set in client state and commit only on an explicit Save — draft creates a schedule, saved diffs and replaces. The duplicate server-action editor in `src/app/schedule/[id]/page.tsx` is deleted; that route shrinks to a data loader.

**Tech Stack:** Next.js 16 (App Router, Turbopack), React client components, Prisma 7 + PostgreSQL, Tailwind v4 with CSS-variable theme tokens, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-schedule-builder-redesign-design.md`

## Global Constraints

- **Theme tokens only.** Use `foreground`, `text-secondary`, `text-tertiary`, `surface`, `surface-muted`, `background`, `border`, `border-hairline`, `brand`, `brand-hover`, `brand-foreground`, and the `rounded-pill` / `rounded-card` / `rounded-input` radii. Never hardcode `slate-*`, `blue-*`, or hex colours — the app is light/dark themed via `data-theme`.
- **Save is enabled only when the schedule has ≥1 section and a non-empty name** (spec §3.1).
- **Delete Schedule and Add-to-calendar are hidden in draft mode** — both need a persisted `scheduleId` (spec §4.1).
- **Grading Basis is never displayed.** We have no such field; Workday shows it, we omit it rather than fake it (spec §5.1).
- Left panel is `340px` fixed on `lg` and up; it stacks above the calendar below that (spec §4).
- Search is debounced at **200 ms** with request cancellation, matching `src/components/SearchBar.tsx` (spec §5.2).
- Conflicts stay **advisory** — rendered and flagged, never blocked or hidden.
- `ScheduleSection.sectionId` is a **raw FK with no Prisma relation** to `Section`. Fetching section detail is always a second query keyed on collected ids, never a nested `include`.
- Existing action convention: `xxxFor(userId, …)` holds the logic and is what tests call; `xxx(…)` is the thin session wrapper that resolves `currentUserId()` and calls `revalidatePath`.
- Commit after every task. Run `npx tsc --noEmit` before each commit.

---

### Task 1: Buffered commit path

**Files:**
- Create: `src/schedule/buffer.ts`
- Create: `tests/schedule-buffer.test.ts`
- Modify: `src/app/actions/schedule.ts` (add two exports at end of file)
- Modify: `tests/schedule-actions.test.ts` (append a describe block)

**Interfaces:**
- Consumes: `owns(userId, scheduleId)`, `currentUserId()`, `Result` — all already private/local to `src/app/actions/schedule.ts`.
- Produces:
  - `diffSections(current: string[], next: string[]): { added: string[]; removed: string[] }`
  - `replaceScheduleSectionsFor(userId: string, scheduleId: string, name: string, sectionIds: string[]): Promise<Result>`
  - `replaceScheduleSections(scheduleId: string, name: string, sectionIds: string[]): Promise<Result>`

- [ ] **Step 1: Write the failing test for the diff**

Create `tests/schedule-buffer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { diffSections } from '@/schedule/buffer';

describe('diffSections', () => {
  it('reports only additions when nothing was removed', () => {
    expect(diffSections(['a'], ['a', 'b'])).toEqual({ added: ['b'], removed: [] });
  });

  it('reports only removals when nothing was added', () => {
    expect(diffSections(['a', 'b'], ['a'])).toEqual({ added: [], removed: ['b'] });
  });

  it('reports nothing for an unchanged set regardless of order', () => {
    expect(diffSections(['a', 'b'], ['b', 'a'])).toEqual({ added: [], removed: [] });
  });

  it('treats a repeated id as one section', () => {
    expect(diffSections([], ['a', 'a'])).toEqual({ added: ['a'], removed: [] });
  });

  it('removes everything when the next set is empty', () => {
    expect(diffSections(['a', 'b'], [])).toEqual({ added: [], removed: ['a', 'b'] });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/schedule-buffer.test.ts`
Expected: FAIL — cannot resolve `@/schedule/buffer`.

- [ ] **Step 3: Implement the diff**

Create `src/schedule/buffer.ts`:

```ts
export type SectionDiff = { added: string[]; removed: string[] };

/**
 * What must change to turn `current` into `next`.
 *
 * Both sides are de-duplicated first: a schedule holds a SET of sections
 * (ScheduleSection is keyed on (scheduleId, sectionId)), so a repeated id can
 * never mean two rows, and emitting it twice would make createMany fail on the
 * unique constraint.
 */
export function diffSections(current: string[], next: string[]): SectionDiff {
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  return {
    added: [...nextSet].filter((id) => !currentSet.has(id)),
    removed: [...currentSet].filter((id) => !nextSet.has(id)),
  };
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run tests/schedule-buffer.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing integration test for the action**

Append to `tests/schedule-actions.test.ts`. It reuses the file's existing `ownerId` / `strangerId` / `termId` / `sectionId` fixtures created in its `beforeAll`:

```ts
describe('replaceScheduleSectionsFor', () => {
  it('applies a buffered add, a rename, and a removal in one call', async () => {
    const created = await createScheduleFor(ownerId, termId, 'Buffer A');
    if (!created.ok) throw new Error(created.error);
    const id = created.scheduleId;

    const added = await replaceScheduleSectionsFor(ownerId, id, 'Buffer B', [sectionId]);
    expect(added).toEqual({ ok: true });

    const afterAdd = await db.savedSchedule.findUniqueOrThrow({
      where: { id },
      include: { sections: true },
    });
    expect(afterAdd.name).toBe('Buffer B');
    expect(afterAdd.sections.map((s) => s.sectionId)).toEqual([sectionId]);

    const cleared = await replaceScheduleSectionsFor(ownerId, id, 'Buffer B', []);
    expect(cleared).toEqual({ ok: true });

    const afterClear = await db.savedSchedule.findUniqueOrThrow({
      where: { id },
      include: { sections: true },
    });
    expect(afterClear.sections).toEqual([]);
  });

  it('is a no-op when the buffer matches what is stored', async () => {
    const created = await createScheduleFor(ownerId, termId, 'Buffer C');
    if (!created.ok) throw new Error(created.error);
    const id = created.scheduleId;

    await replaceScheduleSectionsFor(ownerId, id, 'Buffer C', [sectionId]);
    const again = await replaceScheduleSectionsFor(ownerId, id, 'Buffer C', [sectionId]);
    expect(again).toEqual({ ok: true });

    const row = await db.savedSchedule.findUniqueOrThrow({
      where: { id },
      include: { sections: true },
    });
    expect(row.sections.map((s) => s.sectionId)).toEqual([sectionId]);
  });

  it("refuses a schedule that isn't yours and changes nothing", async () => {
    const created = await createScheduleFor(ownerId, termId, 'Buffer D');
    if (!created.ok) throw new Error(created.error);
    const id = created.scheduleId;

    const result = await replaceScheduleSectionsFor(strangerId, id, 'Hijacked', [sectionId]);
    expect(result.ok).toBe(false);

    const row = await db.savedSchedule.findUniqueOrThrow({
      where: { id },
      include: { sections: true },
    });
    expect(row.name).toBe('Buffer D');
    expect(row.sections).toEqual([]);
  });

  it('rejects a blank name', async () => {
    const created = await createScheduleFor(ownerId, termId, 'Buffer E');
    if (!created.ok) throw new Error(created.error);

    const result = await replaceScheduleSectionsFor(ownerId, created.scheduleId, '   ', []);
    expect(result.ok).toBe(false);
  });
});
```

Add `replaceScheduleSectionsFor` to the existing `import { … } from '@/app/actions/schedule';` block at the top of that file.

- [ ] **Step 6: Run it to make sure it fails**

Run: `npx vitest run tests/schedule-actions.test.ts`
Expected: FAIL — `replaceScheduleSectionsFor` is not exported.

- [ ] **Step 7: Implement the action**

Add to the imports at the top of `src/app/actions/schedule.ts`:

```ts
import { diffSections } from '@/schedule/buffer';
```

Append to the end of `src/app/actions/schedule.ts`:

```ts
/**
 * Commits a whole buffered edit: the name plus the exact set of sections the
 * builder is holding. The builder buffers rather than writing through on every
 * add/remove (spec §3.1), so this is the one write its Save button makes.
 */
export async function replaceScheduleSectionsFor(
  userId: string,
  scheduleId: string,
  name: string,
  sectionIds: string[],
): Promise<Result> {
  if (!(await owns(userId, scheduleId))) return { ok: false, error: NOT_YOURS };
  const clean = name.trim();
  if (!clean) return { ok: false, error: 'Give the schedule a name.' };
  if (clean.length > 80) return { ok: false, error: 'That name is too long.' };

  const existing = await db.scheduleSection.findMany({
    where: { scheduleId },
    select: { sectionId: true },
  });
  const { added, removed } = diffSections(
    existing.map((s) => s.sectionId),
    sectionIds,
  );

  // One transaction: a half-applied Save would leave the student looking at a
  // schedule that is neither what they had nor what they asked for.
  await db.$transaction([
    db.savedSchedule.update({ where: { id: scheduleId }, data: { name: clean } }),
    ...(removed.length
      ? [db.scheduleSection.deleteMany({ where: { scheduleId, sectionId: { in: removed } } })]
      : []),
    ...(added.length
      ? [
          db.scheduleSection.createMany({
            data: added.map((sectionId) => ({ scheduleId, sectionId })),
          }),
        ]
      : []),
  ]);
  return { ok: true };
}

/** Save button for an already-saved schedule. */
export async function replaceScheduleSections(
  scheduleId: string,
  name: string,
  sectionIds: string[],
): Promise<Result> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to save your schedule.' };
  const result = await replaceScheduleSectionsFor(userId, scheduleId, name, sectionIds);
  if (result.ok) {
    revalidatePath('/schedule');
    revalidatePath(`/schedule/${scheduleId}`);
  }
  return result;
}
```

- [ ] **Step 8: Run the tests and make sure they pass**

Run: `npx vitest run tests/schedule-buffer.test.ts tests/schedule-actions.test.ts`
Expected: PASS.

- [ ] **Step 9: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/schedule/buffer.ts tests/schedule-buffer.test.ts src/app/actions/schedule.ts tests/schedule-actions.test.ts
git commit -m "feat: add buffered section-diff commit path for the schedule builder"
```

---

### Task 2: Group sections by course

**Files:**
- Create: `src/schedule/group.ts`
- Create: `tests/schedule-group.test.ts`

**Interfaces:**
- Consumes: `SectionHit` from `@/lib/search` — `{ sectionId, code, title, sectionCode, activity, meetings, meetingTimes }`.
- Produces: `groupSectionsByCourse(hits: SectionHit[]): CourseGroup[]` where `CourseGroup = { code: string; title: string; sections: SectionHit[] }`.

- [ ] **Step 1: Write the failing test**

Create `tests/schedule-group.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { groupSectionsByCourse } from '@/schedule/group';
import type { SectionHit } from '@/lib/search';

function hit(code: string, sectionCode: string, title = `${code} title`): SectionHit {
  return {
    sectionId: `${code}-${sectionCode}`,
    code,
    title,
    sectionCode,
    activity: 'Lecture',
    meetings: 'Mon 10:00–11:00',
    meetingTimes: [],
  };
}

describe('groupSectionsByCourse', () => {
  it('collapses every section of one course into a single group', () => {
    const groups = groupSectionsByCourse([hit('CPSC 110', '101'), hit('CPSC 110', 'L1A')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].code).toBe('CPSC 110');
    expect(groups[0].sections.map((s) => s.sectionCode)).toEqual(['101', 'L1A']);
  });

  it('keeps courses in the order they first appear', () => {
    const groups = groupSectionsByCourse([
      hit('MATH 200', '103'),
      hit('CPSC 110', '101'),
      hit('MATH 200', '104'),
    ]);
    expect(groups.map((g) => g.code)).toEqual(['MATH 200', 'CPSC 110']);
    expect(groups[0].sections).toHaveLength(2);
  });

  it('returns nothing for no hits', () => {
    expect(groupSectionsByCourse([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/schedule-group.test.ts`
Expected: FAIL — cannot resolve `@/schedule/group`.

- [ ] **Step 3: Implement the grouping**

Create `src/schedule/group.ts`:

```ts
import type { SectionHit } from '@/lib/search';

export type CourseGroup = { code: string; title: string; sections: SectionHit[] };

/**
 * Sections collapsed to one entry per course, preserving the order courses
 * first appear in.
 *
 * searchSectionsForTerm returns one row per SECTION, so an ungrouped list
 * repeats "CPSC 110" once per lecture, lab and tutorial — which is exactly
 * what the old flat sidebar did.
 */
export function groupSectionsByCourse(hits: SectionHit[]): CourseGroup[] {
  const byCode = new Map<string, CourseGroup>();
  for (const hit of hits) {
    const group = byCode.get(hit.code);
    if (group) group.sections.push(hit);
    else byCode.set(hit.code, { code: hit.code, title: hit.title, sections: [hit] });
  }
  return [...byCode.values()];
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run tests/schedule-group.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/schedule/group.ts tests/schedule-group.test.ts
git commit -m "feat: group section search results by course"
```

---

### Task 3: Find Courses panel with search-as-you-type

**Files:**
- Create: `src/components/schedule/FindCoursesPanel.tsx`

**Interfaces:**
- Consumes: `searchSections(query, termId): Promise<SectionHit[]>` from `@/app/actions/schedule`; `groupSectionsByCourse` from Task 2.
- Produces: default export `FindCoursesPanel`, props
  `{ termId: string; addedIds: Set<string>; onAdd: (hit: SectionHit) => void }`.

- [ ] **Step 1: Create the panel**

Create `src/components/schedule/FindCoursesPanel.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { searchSections } from '@/app/actions/schedule';
import { groupSectionsByCourse } from '@/schedule/group';
import type { SectionHit } from '@/lib/search';

// Matches SearchBar's debounce so the whole app feels consistent while typing.
const DEBOUNCE_MS = 200;

export default function FindCoursesPanel({
  termId,
  addedIds,
  onAdd,
}: {
  termId: string;
  addedIds: Set<string>;
  onAdd: (hit: SectionHit) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SectionHit[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || !termId) {
      setResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      const hits = await searchSections(trimmed, termId);
      // A slower earlier request must never overwrite a newer one's results.
      if (cancelled) return;
      setResults(hits);
      setSearching(false);
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, termId]);

  const groups = groupSectionsByCourse(results);

  return (
    <div className="p-4">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by code or title — ex: CPSC 110"
        aria-label="Search courses"
        className="w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-text-tertiary focus:border-foreground focus:outline-none"
      />

      {searching && <p className="mt-3 text-xs text-text-tertiary">Searching…</p>}

      {!searching && query.trim() && groups.length === 0 && (
        <p className="mt-3 text-sm text-text-secondary">No courses match that search.</p>
      )}

      <div className="mt-3 space-y-2">
        {groups.map((group) => (
          <details key={group.code} className="rounded-card border border-border">
            <summary className="cursor-pointer px-3 py-2">
              <span className="text-sm font-medium text-foreground">{group.code}</span>
              <span className="ml-2 text-xs text-text-secondary">{group.title}</span>
              <span className="ml-2 text-xs text-text-tertiary">
                ({group.sections.length})
              </span>
            </summary>

            <ul className="border-t border-border">
              {group.sections.map((section) => {
                const added = addedIds.has(section.sectionId);
                return (
                  <li
                    key={section.sectionId}
                    className="flex items-start justify-between gap-2 border-b border-border px-3 py-2 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-foreground">{section.sectionCode}</p>
                      <p className="text-xs text-text-secondary">{section.activity ?? '—'}</p>
                      <p className="text-xs text-text-tertiary">{section.meetings}</p>
                    </div>
                    <button
                      type="button"
                      disabled={added}
                      onClick={() => onAdd(section)}
                      className="shrink-0 rounded-pill border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent"
                    >
                      {added ? 'Added' : 'Add'}
                    </button>
                  </li>
                );
              })}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/schedule/FindCoursesPanel.tsx
git commit -m "feat: add Find Courses panel that searches as you type"
```

---

### Task 4: Saved Courses panel and panel tabs

**Files:**
- Create: `src/components/schedule/SavedCoursesPanel.tsx`
- Create: `src/components/schedule/SchedulePanelTabs.tsx`

**Interfaces:**
- Consumes: `groupSectionsByCourse` (Task 2), `FindCoursesPanel` (Task 3).
- Produces:
  - `SavedCoursesPanel`, props `{ chosen: SectionHit[]; onRemove: (sectionId: string) => void }`
  - `SchedulePanelTabs`, props `{ termId: string; chosen: SectionHit[]; onAdd: (hit: SectionHit) => void; onRemove: (sectionId: string) => void }`

- [ ] **Step 1: Create the Saved Courses panel**

Create `src/components/schedule/SavedCoursesPanel.tsx`:

```tsx
'use client';

import { groupSectionsByCourse } from '@/schedule/group';
import type { SectionHit } from '@/lib/search';

export default function SavedCoursesPanel({
  chosen,
  onRemove,
}: {
  chosen: SectionHit[];
  onRemove: (sectionId: string) => void;
}) {
  const groups = groupSectionsByCourse(chosen);

  if (groups.length === 0) {
    return (
      <div className="p-4">
        <p className="text-sm text-text-secondary">
          No courses yet. Use <span className="font-medium text-foreground">Find Courses</span> to
          add sections.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <p className="text-sm font-medium text-foreground">Total Courses: {groups.length}</p>

      <div className="mt-3 space-y-2">
        {groups.map((group) => (
          <details key={group.code} open className="rounded-card border border-border">
            <summary className="cursor-pointer px-3 py-2">
              <span className="text-sm font-medium text-foreground">{group.code}</span>
              <span className="ml-2 text-xs text-text-secondary">{group.title}</span>
            </summary>

            <ul className="border-t border-border">
              {group.sections.map((section) => (
                <li
                  key={section.sectionId}
                  className="flex items-start justify-between gap-2 border-b border-border px-3 py-2 last:border-b-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{section.sectionCode}</p>
                    <p className="text-xs text-text-secondary">{section.activity ?? '—'}</p>
                    <p className="text-xs text-text-tertiary">{section.meetings}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(section.sectionId)}
                    aria-label={`Remove ${group.code} ${section.sectionCode}`}
                    className="shrink-0 rounded-pill border border-border px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the tab switcher**

Create `src/components/schedule/SchedulePanelTabs.tsx`:

```tsx
'use client';

import { useState } from 'react';
import SavedCoursesPanel from '@/components/schedule/SavedCoursesPanel';
import FindCoursesPanel from '@/components/schedule/FindCoursesPanel';
import type { SectionHit } from '@/lib/search';

type Tab = 'saved' | 'find';

export default function SchedulePanelTabs({
  termId,
  chosen,
  onAdd,
  onRemove,
}: {
  termId: string;
  chosen: SectionHit[];
  onAdd: (hit: SectionHit) => void;
  onRemove: (sectionId: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('saved');
  const addedIds = new Set(chosen.map((c) => c.sectionId));

  return (
    <div>
      <div className="flex gap-6 border-b border-border px-4">
        {(
          [
            ['saved', 'Saved Courses'],
            ['find', 'Find Courses'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`border-b-2 py-3 text-sm font-medium transition-colors ${
              tab === key
                ? 'border-brand text-brand'
                : 'border-transparent text-text-secondary hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'saved' ? (
        <SavedCoursesPanel chosen={chosen} onRemove={onRemove} />
      ) : (
        <FindCoursesPanel termId={termId} addedIds={addedIds} onAdd={onAdd} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/components/schedule/SavedCoursesPanel.tsx src/components/schedule/SchedulePanelTabs.tsx
git commit -m "feat: add Saved Courses panel and builder panel tabs"
```

---

### Task 5: Compact calendar-subscribe menu

Replaces the full-width "Add to your calendar" section currently at `src/app/schedule/[id]/page.tsx:229`.

**Files:**
- Create: `src/components/schedule/CalendarSubscribeMenu.tsx`

**Interfaces:**
- Consumes: `getSubscribeUrl(scheduleId): Promise<{ ok: true; token: string } | { ok: false; error: string }>` from `@/app/actions/schedule`.
- Produces: default export `CalendarSubscribeMenu`, props `{ scheduleId: string }`.

- [ ] **Step 1: Create the menu**

The lazy-fetch-on-open and click-outside handling mirror `src/components/ScheduleRowActions.tsx`, which already solves both for the same action.

Create `src/components/schedule/CalendarSubscribeMenu.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { getSubscribeUrl } from '@/app/actions/schedule';

export default function CalendarSubscribeMenu({ scheduleId }: { scheduleId: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    // Minting the token is a DB write the first time, so it waits until a
    // student actually opens the menu.
    if (next && url === null) {
      const result = await getSubscribeUrl(scheduleId);
      if (result.ok) setUrl(`${window.location.origin}/api/calendar/${result.token}`);
    }
  }

  // webcal:// makes iOS/macOS/Outlook offer a real subscription rather than a
  // one-off download, so the feed keeps updating — the whole point of it.
  const webcalUrl = url?.replace(/^https?:\/\//, 'webcal://') ?? null;
  // Google Calendar ignores webcal:// and needs its own deep link.
  const googleUrl = webcalUrl
    ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`
    : null;

  const itemClass = 'block w-full px-3 py-2 text-left text-xs hover:bg-surface-muted';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        className="rounded-pill border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted"
      >
        Add to calendar ▾
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-card border border-border bg-surface shadow-lg">
          <a
            href={webcalUrl ?? undefined}
            aria-disabled={!webcalUrl}
            className={`${itemClass} ${webcalUrl ? 'text-foreground' : 'pointer-events-none text-text-tertiary'}`}
          >
            Apple / Outlook
          </a>
          <a
            href={googleUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!googleUrl}
            className={`${itemClass} ${googleUrl ? 'text-foreground' : 'pointer-events-none text-text-tertiary'}`}
          >
            Google Calendar
          </a>
          <button
            type="button"
            disabled={!url}
            onClick={async () => {
              if (!url) return;
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className={`${itemClass} border-t border-border ${url ? 'text-foreground' : 'text-text-tertiary'}`}
          >
            {copied ? 'Copied' : 'Copy subscription URL'}
          </button>
          <p className="border-t border-border px-3 py-2 text-[11px] text-text-tertiary">
            These subscribe to a live feed — your calendar keeps updating as you edit.
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/schedule/CalendarSubscribeMenu.tsx
git commit -m "feat: add compact calendar-subscribe menu"
```

---

### Task 6: Builder header

**Files:**
- Create: `src/components/schedule/ScheduleHeader.tsx`

**Interfaces:**
- Consumes: `CalendarSubscribeMenu` (Task 5).
- Produces: default export `ScheduleHeader`, props:

```ts
{
  name: string;
  onNameChange: (name: string) => void;
  termId: string;
  onTermChange: (termId: string) => void;
  terms: { id: string; name: string }[];
  scheduleId: string | null;   // null in draft mode
  canSave: boolean;
  saving: boolean;
  dirty: boolean;
  onSave: () => void;
  onDelete: () => void;
}
```

- [ ] **Step 1: Create the header**

Create `src/components/schedule/ScheduleHeader.tsx`:

```tsx
'use client';

import CalendarSubscribeMenu from '@/components/schedule/CalendarSubscribeMenu';

export default function ScheduleHeader({
  name,
  onNameChange,
  termId,
  onTermChange,
  terms,
  scheduleId,
  canSave,
  saving,
  dirty,
  onSave,
  onDelete,
}: {
  name: string;
  onNameChange: (name: string) => void;
  termId: string;
  onTermChange: (termId: string) => void;
  terms: { id: string; name: string }[];
  scheduleId: string | null;
  canSave: boolean;
  saving: boolean;
  dirty: boolean;
  onSave: () => void;
  onDelete: () => void;
}) {
  const activeTerm = terms.find((t) => t.id === termId);

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border px-6 py-4">
      <div className="min-w-0">
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          required
          maxLength={80}
          placeholder="Schedule name"
          aria-label="Schedule name"
          className="w-full max-w-sm rounded-input border border-border bg-background px-3 py-2 text-lg font-semibold text-foreground placeholder:text-text-tertiary focus:border-foreground focus:outline-none"
        />
        <div className="mt-2 flex items-center gap-2">
          <label htmlFor="builderTerm" className="text-xs text-text-tertiary">
            Academic Period
          </label>
          <select
            id="builderTerm"
            value={termId}
            onChange={(e) => onTermChange(e.target.value)}
            className="rounded-input border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-foreground focus:outline-none"
          >
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {activeTerm === undefined && (
            <span className="text-xs text-text-tertiary">Select a term</span>
          )}
        </div>
      </div>

      <div className="flex flex-col items-end gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave || saving}
            className="rounded-pill bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100 disabled:opacity-50 disabled:hover:scale-100"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>

          {/* Delete needs a persisted schedule — hidden, not disabled, in draft. */}
          {scheduleId && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded-pill border border-border px-5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
            >
              Delete Schedule
            </button>
          )}
        </div>

        {scheduleId && <CalendarSubscribeMenu scheduleId={scheduleId} />}

        {dirty && <p className="text-xs text-text-tertiary">Unsaved changes</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/components/schedule/ScheduleHeader.tsx
git commit -m "feat: add schedule builder header with buffered save"
```

---

### Task 7: Unified ScheduleBuilder shell

**Files:**
- Modify: `src/components/ScheduleBuilder.tsx` (full rewrite)

**Interfaces:**
- Consumes: `ScheduleHeader` (Task 6), `SchedulePanelTabs` (Task 4), `diffSections` (Task 1), `replaceScheduleSections` (Task 1), existing `saveGuestSchedule`, `deleteSchedule`, `WeekGrid`, `findConflicts`, `useAuthOverlay`.
- Produces: default export `ScheduleBuilder`, props:

```ts
{
  mode: { kind: 'draft' } | { kind: 'saved'; scheduleId: string };
  initialName: string;
  initialTermId: string;
  initialSections: SectionHit[];
  terms: { id: string; name: string }[];
}
```

- [ ] **Step 1: Rewrite the builder**

Replace the entire contents of `src/components/ScheduleBuilder.tsx`:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import ScheduleHeader from '@/components/schedule/ScheduleHeader';
import SchedulePanelTabs from '@/components/schedule/SchedulePanelTabs';
import WeekGrid, { type WeekGridEntry } from '@/components/WeekGrid';
import { findConflicts } from '@/schedule/conflicts';
import { diffSections } from '@/schedule/buffer';
import {
  saveGuestSchedule,
  replaceScheduleSections,
  deleteSchedule,
} from '@/app/actions/schedule';
import type { SectionHit } from '@/lib/search';
import { useAuthOverlay } from '@/components/AuthOverlayContext';

export type BuilderMode = { kind: 'draft' } | { kind: 'saved'; scheduleId: string };

/**
 * The single schedule builder, behind both /schedule/new (draft) and
 * /schedule/[id] (saved).
 *
 * Both modes hold the working section set in client state and commit only on
 * Save (spec §3.1): it matches Workday's own Save/Cancel model, it gives one
 * rendering path for both modes, and it stops a bulk Workday import from
 * firing a burst of writes for edits the student hasn't agreed to yet.
 */
export default function ScheduleBuilder({
  mode,
  initialName,
  initialTermId,
  initialSections,
  terms,
}: {
  mode: BuilderMode;
  initialName: string;
  initialTermId: string;
  initialSections: SectionHit[];
  terms: { id: string; name: string }[];
}) {
  const [name, setName] = useState(initialName);
  const [termId, setTermId] = useState(initialTermId || (terms[0]?.id ?? ''));
  const [chosen, setChosen] = useState<SectionHit[]>(initialSections);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { open } = useAuthOverlay();

  const scheduleId = mode.kind === 'saved' ? mode.scheduleId : null;
  const initialIds = useMemo(
    () => initialSections.map((s) => s.sectionId),
    [initialSections],
  );

  const dirty = useMemo(() => {
    const { added, removed } = diffSections(
      initialIds,
      chosen.map((c) => c.sectionId),
    );
    return (
      added.length > 0 ||
      removed.length > 0 ||
      name.trim() !== initialName.trim() ||
      termId !== initialTermId
    );
  }, [initialIds, chosen, name, initialName, termId, initialTermId]);

  // Buffered edits live only in memory, so leaving the page drops them. Without
  // this guard an imported schedule can vanish on a stray back-navigation.
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  function addSection(hit: SectionHit) {
    setChosen((prev) =>
      prev.some((s) => s.sectionId === hit.sectionId) ? prev : [...prev, hit],
    );
  }

  function removeSection(sectionId: string) {
    setChosen((prev) => prev.filter((s) => s.sectionId !== sectionId));
  }

  async function trySave() {
    setSaving(true);
    setError(null);
    const sectionIds = chosen.map((c) => c.sectionId);

    if (scheduleId) {
      const result = await replaceScheduleSections(scheduleId, name, sectionIds);
      setSaving(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
      return;
    }

    const result = await saveGuestSchedule(termId, name, sectionIds);
    if (result.ok) {
      router.push(`/schedule/${result.scheduleId}`);
      return;
    }
    setSaving(false);
    if (result.needsAuth) {
      open('login', trySave);
      return;
    }
    setError(result.error);
  }

  async function onDelete() {
    if (!scheduleId) return;
    const result = await deleteSchedule(scheduleId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push('/schedule');
  }

  const entries: WeekGridEntry[] = chosen.flatMap((s) =>
    s.meetingTimes.map((m, i) => ({
      id: `${s.sectionId}-${i}`,
      sectionId: s.sectionId,
      label: `${s.code} ${s.sectionCode}`,
      day: m.day,
      startTime: m.startTime,
      endTime: m.endTime,
      location: m.building ? `${m.building}${m.room ? ` ${m.room}` : ''}` : null,
    })),
  );
  const conflicts = findConflicts(entries);

  return (
    <main className="flex min-h-0 w-full flex-1 flex-col">
      <ScheduleHeader
        name={name}
        onNameChange={setName}
        termId={termId}
        onTermChange={setTermId}
        terms={terms}
        scheduleId={scheduleId}
        canSave={chosen.length > 0 && name.trim().length > 0 && termId !== ''}
        saving={saving}
        dirty={dirty}
        onSave={trySave}
        onDelete={onDelete}
      />

      {error && (
        <p className="border-b border-border px-6 py-2 text-sm text-red-600">{error}</p>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="w-full shrink-0 overflow-y-auto border-b border-border lg:w-[340px] lg:border-b-0 lg:border-r">
          <SchedulePanelTabs
            termId={termId}
            chosen={chosen}
            onAdd={addSection}
            onRemove={removeSection}
          />
        </aside>

        <div className="min-w-0 flex-1 overflow-auto p-4">
          {conflicts.length > 0 && (
            <div className="mb-4 rounded-card border border-red-600 bg-red-50 p-3 text-sm text-red-800">
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

          <WeekGrid entries={entries} />
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/app/schedule/new/page.tsx` and `src/app/schedule/[id]/page.tsx`, which Task 8 rewrites — they still pass the old props. Any error in another file means something above is wrong.

- [ ] **Step 3: Commit**

```bash
git add src/components/ScheduleBuilder.tsx
git commit -m "feat: unify the schedule builder into one buffered full-page shell"
```

---

### Task 8: Rewire routes and delete the duplicate editor

**Files:**
- Modify: `src/app/schedule/new/page.tsx` (full rewrite)
- Modify: `src/app/schedule/[id]/page.tsx` (full rewrite — 268 lines down to a loader)
- Modify: `src/components/CreateScheduleModal.tsx:21` (button label)

**Interfaces:**
- Consumes: `ScheduleBuilder` (Task 7).
- Produces: nothing new — both routes render the builder.

- [ ] **Step 1: Rewrite the new-schedule route**

Replace the entire contents of `src/app/schedule/new/page.tsx`:

```tsx
import { db } from '@/lib/db';
import ScheduleBuilder from '@/components/ScheduleBuilder';
import { isPlannableTerm } from '@/schedule/terms';

export default async function NewSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string; termId?: string }>;
}) {
  const { name = '', termId = '' } = await searchParams;

  const terms = await db.term.findMany({
    where: { campus: 'V' },
    orderBy: [{ year: 'desc' }, { termNumber: 'desc' }],
  });

  return (
    <ScheduleBuilder
      mode={{ kind: 'draft' }}
      initialName={name}
      initialTermId={termId}
      initialSections={[]}
      terms={terms.filter(isPlannableTerm)}
    />
  );
}
```

- [ ] **Step 2: Rewrite the saved-schedule route as a loader**

Replace the entire contents of `src/app/schedule/[id]/page.tsx`. Everything the old page did inline — rename form, add/remove forms, conflict banner, weekly grid, calendar-subscribe section — now lives in the builder.

```tsx
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import ScheduleBuilder from '@/components/ScheduleBuilder';
import { isPlannableTerm } from '@/schedule/terms';
import type { SectionHit } from '@/lib/search';

export default async function SchedulePlannerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  // Filtering by userId here IS the ownership check: a schedule that exists but
  // belongs to someone else simply doesn't match, so this 404s exactly like a
  // missing schedule.
  const schedule = await db.savedSchedule.findFirst({
    where: { id, userId: session.user.id },
    include: { sections: true },
  });
  if (!schedule) notFound();

  const sectionIds = schedule.sections.map((s) => s.sectionId);
  // ScheduleSection.sectionId is a raw FK with no Prisma relation to Section,
  // so this is a second query rather than a nested include.
  const sections = sectionIds.length
    ? await db.section.findMany({
        where: { id: { in: sectionIds } },
        include: { meetingTimes: true, course: { include: { subject: true } } },
      })
    : [];

  // Same shape searchSectionsForTerm produces, so the builder holds one type.
  const initialSections: SectionHit[] = sections.map((s) => ({
    sectionId: s.id,
    code: `${s.course.subject.code ?? ''} ${s.course.number}`.trim(),
    title: s.course.title,
    sectionCode: s.sectionCode,
    activity: s.activity,
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
  }));

  const terms = await db.term.findMany({
    where: { campus: 'V' },
    orderBy: [{ year: 'desc' }, { termNumber: 'desc' }],
  });
  // An existing schedule keeps its own term in the list even if it has since
  // passed — otherwise the select would silently switch it to another term.
  const plannable = terms.filter(isPlannableTerm);
  const termOptions = plannable.some((t) => t.id === schedule.termId)
    ? plannable
    : [...terms.filter((t) => t.id === schedule.termId), ...plannable];

  return (
    <ScheduleBuilder
      mode={{ kind: 'saved', scheduleId: schedule.id }}
      initialName={schedule.name}
      initialTermId={schedule.termId}
      initialSections={initialSections}
      terms={termOptions}
    />
  );
}
```

- [ ] **Step 3: Rename the primary button**

In `src/components/CreateScheduleModal.tsx`, change the trigger button's label on line 21 from `Create Saved Schedule` to `Build Schedule`. Leave the modal's own `<h2>` heading and its Create button unchanged — only the page-level trigger is renamed in this phase.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: PASS. Note `tests/smoke.test.ts` may reference the old editor markup — if it fails, update the assertion to match the new builder rather than reverting the route.

- [ ] **Step 6: Commit**

```bash
git add src/app/schedule/new/page.tsx "src/app/schedule/[id]/page.tsx" src/components/CreateScheduleModal.tsx
git commit -m "refactor: serve both schedule routes from the unified builder"
```

---

### Task 9: Verify in a real browser

Typechecking and unit tests cannot show that the layout fills the page or that search fires while typing. This task drives the running app.

**Files:**
- Create (temporary, deleted in step 5): `_smoke_builder.mjs`

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

Wait for it: `timeout 30 bash -c 'until curl -sf http://localhost:3000 >/dev/null; do sleep 1; done'`

If port 3000 reports "Another next dev server is already running", use the existing one — do not start a second.

- [ ] **Step 2: Write the smoke script**

Create `_smoke_builder.mjs` in the repo root:

```js
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const BASE = 'http://localhost:3000';
const email = `smoke-builder-${Date.now()}@example.com`;
const password = 'smoke-test-password-123';

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

try {
  // Pick a term that genuinely has sections, and a course code known to exist
  // in it — hardcoding "CPSC 110" would fail whenever the default term is a
  // summer session that doesn't offer it.
  const section = await prisma.section.findFirstOrThrow({
    include: { course: { include: { subject: true } } },
  });
  const termId = section.termId;
  const courseCode = `${section.course.subject.code} ${section.course.number}`;

  await page.goto(`${BASE}/signup`);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button:has-text("Sign Up")');
  await page.waitForURL('**/onboarding');

  await page.goto(
    `${BASE}/schedule/new?name=Smoke%20Plan&termId=${encodeURIComponent(termId)}`,
  );
  await page.waitForSelector('button:text-is("Find Courses")');

  // text-is, not has-text: "Saved Courses" CONTAINS "Save" and would match a
  // substring selector, silently testing the wrong element.
  const saveBtn = page.getByRole('button', { name: 'Save', exact: true });
  if (!(await saveBtn.isDisabled())) throw new Error('Save was enabled with zero sections');

  // Search-as-you-type: no submit, no Enter.
  await page.click('button:text-is("Find Courses")');
  await page.fill('input[aria-label="Search courses"]', courseCode);
  await page.waitForSelector(`summary:has-text("${courseCode}")`, { timeout: 5000 });
  console.log('SEARCH-AS-YOU-TYPE OK');

  await page.click(`summary:has-text("${courseCode}")`);
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await page.waitForSelector('button:text-is("Added")');

  if (await saveBtn.isDisabled()) throw new Error('Save still disabled after adding a section');
  await page.screenshot({ path: 'builder-draft.png', fullPage: true });

  await saveBtn.click();
  await page.waitForURL(/\/schedule\/[a-z0-9]+$/, { timeout: 15000 });
  await page.waitForSelector('button:text-is("Delete Schedule")');
  await page.waitForSelector('button:has-text("Add to calendar")');
  await page.screenshot({ path: 'builder-saved.png', fullPage: true });
  console.log('SAVED MODE OK');

  await page.reload();
  await page.waitForSelector('text=Total Courses: 1');
  console.log('PERSISTED OK');

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

Run: `node --env-file=.env _smoke_builder.mjs`
Expected: `SEARCH-AS-YOU-TYPE OK`, `SAVED MODE OK`, `PERSISTED OK`, and `CONSOLE ERRORS: []`.

- [ ] **Step 4: Look at both screenshots**

Open `builder-draft.png` and `builder-saved.png` and confirm, by eye:
1. The builder fills the full page width — no centred narrow column.
2. The left panel is a fixed-width column with Saved Courses / Find Courses tabs.
3. `builder-draft.png` shows **no** Delete Schedule and **no** Add to calendar.
4. `builder-saved.png` shows both, with Add to calendar sitting *below* Save/Delete.

A blank or half-height screenshot is a failure even if the script printed OK.

- [ ] **Step 5: Clean up and commit**

```bash
rm -f _smoke_builder.mjs builder-draft.png builder-saved.png
npx vitest run
npx tsc --noEmit
git add -A
git commit -m "test: verify unified schedule builder in a real browser"
```

---

## Phase 1 done when

- `/schedule/new` and `/schedule/[id]` both render the same full-bleed builder.
- Search returns results without submitting a form.
- Save is disabled at zero sections and enabled after one is added.
- Draft mode hides Delete Schedule and Add to calendar; saved mode shows both.
- A saved schedule survives a reload.
- `npx vitest run` and `npx tsc --noEmit` are both clean.

## Deliberately not in this phase

Phases 2-5 of the spec: the Notion-style `ScheduleCalendar` (this phase still renders the existing `WeekGrid`), the course info overlay and its ⓘ buttons, Workday import and its "Import from Workday" button, and RateMyProfessors.
