# Schedule Builder - Phase 4: Workday Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a student drop their Workday `.xlsx` export into the schedule builder and have their real timetable appear, without writing anything to the database.

**Architecture:** A new parse-and-match-only server action reuses the existing Workday parser unchanged, resolves each parsed row to a catalogue `Section`, and hands the result back to the client. Deliberately separate from `/api/upload`, which binds student identity and writes enrolments - importing a timetable to try it out must not have identity as a side effect. The import overlay lives **inside** the builder, so matched sections drop straight into its buffer with no cross-page state handoff.

**Tech Stack:** Next.js 16 (App Router, server actions), Prisma 7 + PostgreSQL, ExcelJS, Tailwind v4 theme tokens, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-schedule-builder-redesign-design.md` (§8 is this phase)

**Builds on:** Phases 1-3, all complete on branch `feat/schedule-builder-phase-1`.

## Validated before planning

The riskiest assumption - that a real export's section codes match our catalogue - was checked against a real `View_My_Courses.xlsx`: **all 12 rows resolved** to a `Section` on `(subject.code, course.number, campus, sectionCode, term)`, including lab/tutorial codes like `L1U`, `T2M`, `L2X`. No format normalisation is needed.

## Global Constraints

- **This action writes NOTHING.** No `Enrollment`, no `studentIdHash`, no `verifiedAt`, no `SavedSchedule`. It parses, matches, and returns. If you find yourself calling a Prisma `create`/`update`/`upsert`, stop - that is the one thing this phase must not do.
- **Reuse `readWorkbookGrid` and `parseWorkdayExport` unchanged.** Do not edit `src/upload/read-grid.ts` or `src/upload/parse-workday.ts`.
- **Validate at the trust boundary.** Mirror `src/app/api/upload/route.ts`: reject > 2 MB before parsing (a zip bomb must never reach the parser) and reject anything not ending `.xlsx`.
- **Never drop a row silently.** Every parsed row that does not end up in the schedule must be reported to the student with its course name AND its actual reason. Spec §8.2 calls this out because `UploadCoursesForm` currently reports all three exclusion reasons as "transfer credits" - do not repeat that bug.
- **Theme tokens only.** `foreground`, `background`, `text-secondary`, `text-tertiary`, `surface`, `surface-muted`, `border`, `border-hairline`, `brand`, `brand-accent`, `brand-foreground`, `danger`/`danger-surface`/`danger-border`, and the `rounded-pill`/`rounded-card`/`rounded-input` radii. No raw `slate-*`/`blue-*`/`red-*`. **`brand` as a foreground is forbidden** - invisible in dark mode; use `brand-accent`.
- Existing convention: logic in `src/lib/` or a domain folder, thin `'use server'` wrapper. Tests call the core function.
- Commit after every task. `npx tsc --noEmit` and `npx vitest run` clean before each commit (baseline: **310 tests passing**).

---

### Task 1: Match parsed rows to catalogue sections

**Files:**
- Create: `src/upload/match-schedule.ts`
- Create: `src/app/actions/import.ts`
- Create: `tests/match-schedule.test.ts`

**Interfaces:**
- Consumes: `EnrollmentRow` + `ExcludedRow` from `@/upload/parse-workday`; `toSectionHit` + `SectionHit` from `@/lib/search`.
- Produces:
  - `matchWorkdayRows(rows: EnrollmentRow[]): Promise<ScheduleImport | null>` (testable core)
  - `parseWorkdayForSchedule(formData: FormData): Promise<ImportResult>` (`'use server'` wrapper)
  - types `ScheduleImport`, `ImportResult`, `SkippedRow`

- [ ] **Step 1: Write the failing test**

Create `tests/match-schedule.test.ts`. It builds `EnrollmentRow`s from real catalogue rows rather than shipping a fixture file - a real Workday export contains a student's name and number and must never be committed.

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '@/lib/db';
import { matchWorkdayRows } from '@/upload/match-schedule';
import type { EnrollmentRow } from '@/upload/parse-workday';

type Fixture = {
  subjectCode: string;
  courseNumber: string;
  sectionCode: string;
  campus: string;
  termYear: number;
  termSession: string;
  termNumber: number | null;
  termId: string;
};

let fixture: Fixture;

beforeAll(async () => {
  const section = await db.section.findFirstOrThrow({
    where: { course: { subject: { code: { not: null } } } },
    include: { term: true, course: { include: { subject: true } } },
  });
  fixture = {
    subjectCode: section.course.subject.code!,
    courseNumber: section.course.number,
    sectionCode: section.sectionCode,
    campus: section.course.campus,
    termYear: section.term.year,
    termSession: section.term.session,
    termNumber: section.term.termNumber,
    termId: section.term.id,
  };
});

function row(over: Partial<EnrollmentRow> = {}): EnrollmentRow {
  return {
    subjectCode: fixture.subjectCode,
    campus: fixture.campus,
    courseNumber: fixture.courseNumber,
    sectionCode: fixture.sectionCode,
    activity: 'Lecture',
    startDate: '2026-09-09',
    termYear: fixture.termYear,
    termSession: fixture.termSession,
    termNumber: fixture.termNumber,
    days: ['Mon'],
    meetingStartTime: '10:00',
    meetingEndTime: '11:00',
    ...over,
  };
}

describe('matchWorkdayRows', () => {
  it('resolves a real registration row to its catalogue section', async () => {
    const result = await matchWorkdayRows([row()]);
    expect(result).not.toBeNull();
    expect(result!.termId).toBe(fixture.termId);
    expect(result!.matched).toHaveLength(1);
    expect(result!.matched[0].sectionCode).toBe(fixture.sectionCode);
    expect(result!.matched[0].courseId).toBeTruthy();
    expect(result!.unmatched).toEqual([]);
  });

  it('reports a section code that does not exist, rather than dropping it', async () => {
    const result = await matchWorkdayRows([row({ sectionCode: 'ZZZ999' })]);
    expect(result).not.toBeNull();
    expect(result!.matched).toEqual([]);
    expect(result!.unmatched).toHaveLength(1);
    expect(result!.unmatched[0]).toContain(fixture.subjectCode);
    expect(result!.unmatched[0]).toContain('ZZZ999');
  });

  it('reports a course that is not in the catalogue at all', async () => {
    const result = await matchWorkdayRows([row({ subjectCode: 'ZZZZ', courseNumber: '999' })]);
    expect(result).not.toBeNull();
    expect(result!.unmatched).toHaveLength(1);
    expect(result!.unmatched[0]).toContain('ZZZZ 999');
  });

  it('de-duplicates a section that appears twice in the export', async () => {
    const result = await matchWorkdayRows([row(), row()]);
    expect(result!.matched).toHaveLength(1);
  });

  it('returns null when no row resolves to a known term', async () => {
    const result = await matchWorkdayRows([row({ termYear: 1899, termSession: 'W', termNumber: 1 })]);
    expect(result).toBeNull();
  });

  it('keeps the dominant term and reports rows belonging to another term', async () => {
    const otherTerm = await db.term.findFirst({
      where: { campus: fixture.campus, id: { not: fixture.termId } },
      select: { year: true, session: true, termNumber: true },
    });
    if (!otherTerm) return; // single-term dataset

    const result = await matchWorkdayRows([
      row(),
      row(),
      row({
        termYear: otherTerm.year,
        termSession: otherTerm.session,
        termNumber: otherTerm.termNumber,
      }),
    ]);
    expect(result!.termId).toBe(fixture.termId);
    // The other-term row is neither imported nor silently dropped.
    expect(result!.otherTerm.length + result!.unmatched.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run tests/match-schedule.test.ts`
Expected: FAIL - cannot resolve `@/upload/match-schedule`.

- [ ] **Step 3: Implement the matcher**

Create `src/upload/match-schedule.ts`:

```ts
import { db } from '@/lib/db';
import { toSectionHit, type SectionHit } from '@/lib/search';
import type { EnrollmentRow } from '@/upload/parse-workday';

export type ScheduleImport = {
  termId: string;
  termName: string;
  matched: SectionHit[];
  /** "CPSC 110-L1U" for rows whose section is not in our catalogue. */
  unmatched: string[];
  /** Rows for a real term other than the one being imported. */
  otherTerm: string[];
};

function label(row: EnrollmentRow): string {
  return `${row.subjectCode} ${row.courseNumber}${row.sectionCode ? `-${row.sectionCode}` : ''}`;
}

/**
 * Resolves parsed Workday registration rows to catalogue sections. Writes
 * nothing - this exists so a student can preview their real timetable in the
 * builder without the identity binding that /api/upload performs.
 *
 * A schedule covers ONE term, but an export can span two (a student registered
 * in both Winter terms). The term with the most rows wins and the rest are
 * reported, never silently dropped.
 *
 * ponytail: dominant-term-wins rather than a term picker. If real exports turn
 * out to routinely straddle terms, this is where a picker goes.
 */
export async function matchWorkdayRows(rows: EnrollmentRow[]): Promise<ScheduleImport | null> {
  // Resolve each row's term once. Distinct terms per export are few, so this
  // is a handful of queries rather than one per row.
  const termCache = new Map<string, { id: string; name: string } | null>();
  const resolved: { row: EnrollmentRow; term: { id: string; name: string } | null }[] = [];

  for (const row of rows) {
    const key = `${row.termYear}|${row.termSession}|${row.termNumber}|${row.campus}`;
    if (!termCache.has(key)) {
      termCache.set(
        key,
        await db.term.findFirst({
          where: {
            year: row.termYear,
            session: row.termSession,
            termNumber: row.termNumber,
            campus: row.campus,
          },
          select: { id: true, name: true },
        }),
      );
    }
    resolved.push({ row, term: termCache.get(key)! });
  }

  const counts = new Map<string, number>();
  for (const { term } of resolved) {
    if (term) counts.set(term.id, (counts.get(term.id) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  const [dominantId] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const dominant = resolved.find((r) => r.term?.id === dominantId)!.term!;

  const matched: SectionHit[] = [];
  const unmatched: string[] = [];
  const otherTerm: string[] = [];
  const seen = new Set<string>();

  for (const { row, term } of resolved) {
    if (!term) {
      unmatched.push(label(row));
      continue;
    }
    if (term.id !== dominantId) {
      otherTerm.push(`${label(row)} (${term.name})`);
      continue;
    }

    const section = await db.section.findFirst({
      where: {
        termId: dominantId,
        ...(row.sectionCode ? { sectionCode: row.sectionCode } : {}),
        course: {
          number: row.courseNumber,
          campus: row.campus,
          subject: { code: row.subjectCode },
        },
      },
      include: { meetingTimes: true, course: { include: { subject: true } } },
    });

    if (!section) {
      unmatched.push(label(row));
      continue;
    }
    // An export lists a section once per meeting block, so the same section
    // can appear more than once.
    if (seen.has(section.id)) continue;
    seen.add(section.id);
    matched.push(toSectionHit(section));
  }

  return { termId: dominant.id, termName: dominant.name, matched, unmatched, otherTerm };
}
```

- [ ] **Step 4: Run the tests to make sure they pass**

Run: `npx vitest run tests/match-schedule.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Create the server action**

Create `src/app/actions/import.ts`:

```ts
'use server';

import { readWorkbookGrid } from '@/upload/read-grid';
import { parseWorkdayExport } from '@/upload/parse-workday';
import { matchWorkdayRows, type ScheduleImport } from '@/upload/match-schedule';

const MAX_BYTES = 2 * 1024 * 1024;

/** A parsed row that will not appear in the schedule, with the REAL reason. */
export type SkippedRow = { raw: string; reason: string };

export type ImportResult =
  | ({ ok: true } & ScheduleImport & { skipped: SkippedRow[] })
  | { ok: false; error: string };

const REASON_TEXT: Record<string, string> = {
  transfer_credit: 'Transfer credit - earned at another institution',
  unparseable_course: "Course code couldn't be read",
  no_term: 'No meeting dates, so the term is unknown',
};

/**
 * Parses a Workday export and resolves it to catalogue sections for the
 * schedule builder. Writes NOTHING.
 *
 * Deliberately separate from /api/upload: that endpoint binds studentIdHash
 * and writes Enrollment rows, which is right for account verification and
 * wrong here - previewing a timetable must not bind a student's identity as a
 * side effect, and the builder is usable signed out.
 */
export async function parseWorkdayForSchedule(formData: FormData): Promise<ImportResult> {
  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'No file uploaded.' };
  // Size is checked BEFORE parsing - a zip bomb must never reach the parser.
  if (file.size > MAX_BYTES) return { ok: false, error: 'File is too large (max 2 MB).' };
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return { ok: false, error: 'Upload the .xlsx export from Workday.' };
  }

  try {
    // Held in memory only - never written to disk, never logged.
    const grid = await readWorkbookGrid(await file.arrayBuffer());
    const parsed = parseWorkdayExport(grid);

    const result = await matchWorkdayRows(parsed.rows);
    if (!result) {
      return {
        ok: false,
        error: "We couldn't find a term in that file. Export from Workday → Academics → View My Courses.",
      };
    }

    return {
      ok: true,
      ...result,
      // Each excluded row keeps its own reason. Reporting all three as
      // "transfer credits" is the bug spec §8.2 calls out on the Account page.
      skipped: parsed.excluded.map((e) => ({
        raw: e.raw,
        reason: REASON_TEXT[e.reason] ?? e.reason,
      })),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not read that file.' };
  }
}
```

- [ ] **Step 6: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run
git add src/upload/match-schedule.ts src/app/actions/import.ts tests/match-schedule.test.ts
git commit -m "feat: match Workday export rows to catalogue sections without writing"
```

---

### Task 2: The import overlay

**Files:**
- Create: `src/components/schedule/WorkdayImportOverlay.tsx`

**Interfaces:**
- Consumes: `parseWorkdayForSchedule`, `ImportResult` (Task 1); `SectionHit`.
- Produces: default export `WorkdayImportOverlay`, props:

```ts
{
  open: boolean;
  onClose: () => void;
  onImport: (termId: string, sections: SectionHit[]) => void;
}
```

- [ ] **Step 1: Create the overlay**

Backdrop and click-outside mirror `src/components/schedule/CourseInfoOverlay.tsx`.

Create `src/components/schedule/WorkdayImportOverlay.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { parseWorkdayForSchedule, type ImportResult } from '@/app/actions/import';
import type { SectionHit } from '@/lib/search';

type Loaded = Extract<ImportResult, { ok: true }>;

function SkipList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-medium text-foreground">{title}</p>
      <ul className="mt-1 space-y-0.5">
        {items.map((i) => (
          <li key={i} className="text-xs text-text-secondary">
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Loads a student's real timetable from their Workday export.
 *
 * Nothing is written by this flow - the sections land in the builder's buffer
 * and are only persisted if the student then saves the schedule.
 */
export default function WorkdayImportOverlay({
  open,
  onClose,
  onImport,
}: {
  open: boolean;
  onClose: () => void;
  onImport: (termId: string, sections: SectionHit[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // A fresh open starts clean rather than showing the last import's summary.
  useEffect(() => {
    if (open) {
      setResult(null);
      setError(null);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await parseWorkdayForSchedule(new FormData(e.currentTarget));
      if (!res.ok) setError(res.error);
      else setResult(res);
    } catch {
      setError('Could not read that file. Try exporting it from Workday again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import from Workday"
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 px-6 py-10 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-card border border-border-hairline bg-surface p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-xl font-semibold text-foreground">Import from Workday</h2>
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

        {!result && (
          <>
            <ol className="mt-4 space-y-1.5 text-sm text-text-secondary">
              <li>1. In Workday, go to <span className="font-medium text-foreground">Academics → View My Courses</span>.</li>
              <li>2. Click the <span className="font-medium text-foreground">Export to Excel</span> icon above the table.</li>
              <li>3. Upload the <code>.xlsx</code> file here.</li>
            </ol>

            <form onSubmit={onSubmit} className="mt-5 flex flex-wrap items-center gap-3">
              <input
                type="file"
                name="file"
                accept=".xlsx"
                required
                aria-label="Workday export file"
                className="flex-1 rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-pill bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100 disabled:opacity-50 disabled:hover:scale-100"
              >
                {busy ? 'Reading…' : 'Import'}
              </button>
            </form>

            <p className="mt-4 text-xs text-text-tertiary">
              Nothing is saved by importing. Your file is read in memory and never stored, and
              the sections only become a schedule if you save it.
            </p>
          </>
        )}

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}

        {result && (
          <>
            <p className="mt-4 text-sm text-foreground">
              Found <span className="font-medium">{result.matched.length}</span> section
              {result.matched.length === 1 ? '' : 's'} for{' '}
              <span className="font-medium">{result.termName}</span>.
            </p>

            <SkipList title="Not in our catalogue" items={result.unmatched} />
            <SkipList title="A different term - a schedule covers one term" items={result.otherTerm} />

            {result.skipped.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-medium text-foreground">Skipped</p>
                <ul className="mt-1 space-y-0.5">
                  {result.skipped.map((s) => (
                    <li key={s.raw} className="text-xs text-text-secondary">
                      {s.raw} - {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-pill border border-border px-5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={result.matched.length === 0}
                onClick={() => {
                  onImport(result.termId, result.matched);
                  onClose();
                }}
                className="rounded-pill bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-hover disabled:opacity-50"
              >
                Add to schedule
              </button>
            </div>
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
git add src/components/schedule/WorkdayImportOverlay.tsx
git commit -m "feat: add the Workday import overlay"
```

---

### Task 3: Wire the button and the builder

The "Import from Workday" button sits beside "Build Schedule" on `/schedule` (spec §8), but the overlay lives **inside** the builder. So the button navigates to the builder with a query flag, and the builder opens the overlay on arrival. That avoids serialising a parsed timetable through `sessionStorage` or a URL - the sections never leave the component that owns them.

**Files:**
- Modify: `src/app/schedule/page.tsx`
- Modify: `src/components/CreateScheduleModal.tsx`
- Modify: `src/app/schedule/new/page.tsx`
- Modify: `src/components/ScheduleBuilder.tsx`

- [ ] **Step 1: Add the button beside "Build Schedule"**

`CreateScheduleModal` renders the "Build Schedule" trigger on `/schedule`. Add a sibling button next to it, inside the same component so the two stay visually paired. In `src/components/CreateScheduleModal.tsx`, wrap the existing trigger button and a new one in a flex row:

```tsx
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-pill bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100"
        >
          Build Schedule
        </button>
        <Link
          href="/schedule/new?import=1"
          className="rounded-pill border border-border px-5 py-2.5 text-sm font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-surface-muted active:scale-100"
        >
          Import from Workday
        </Link>
      </div>
```

Add `import Link from 'next/link';` at the top. Leave the modal body itself unchanged.

- [ ] **Step 2: Pass the flag into the builder**

In `src/app/schedule/new/page.tsx`, read the new search param and forward it. Change the `searchParams` type to include `import?: string`, destructure it, and pass a prop:

```tsx
  const { name = '', termId = '', import: importFlag } = await searchParams;
```

and on `<ScheduleBuilder …>` add:

```tsx
      openImport={importFlag === '1'}
```

- [ ] **Step 3: Accept and use the flag in the builder**

In `src/components/ScheduleBuilder.tsx`:

1. Import the overlay: `import WorkdayImportOverlay from '@/components/schedule/WorkdayImportOverlay';`
2. Add `openImport = false` to the destructured props and `openImport?: boolean;` to the props type.
3. Add state: `const [importOpen, setImportOpen] = useState(openImport);`
4. Add an `applyImport` handler next to `addSection`. **Step 4 below gives its final body - write that version, not a draft one.**

5. Render the overlay as a sibling of `CourseInfoOverlay`, last inside `<main>`:

```tsx
      <WorkdayImportOverlay
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={applyImport}
      />
```

- [ ] **Step 4: Refuse an import for a term the builder cannot offer**

`applyImport` calls `setTermId` with the imported term. If that term is not in the `terms` prop (the builder is given only plannable terms), the `<select>` would show a value with no matching `<option>`.

**Importing the sections anyway would be worse than failing.** They would land in a schedule whose term is something else entirely - sections are term-scoped rows, so a saved schedule would then hold sections from a term it does not belong to. That is exactly the cross-term contamination the course overlay's cache key was fixed to prevent, and nothing on the save path validates section-to-term membership.

So the guard aborts the whole import rather than partially applying it. Replace the body of `applyImport` with:

```tsx
  function applyImport(importedTermId: string, sections: SectionHit[]) {
    if (!terms.some((t) => t.id === importedTermId)) {
      setError(
        "That export is for a term you can't plan yet, so nothing was imported.",
      );
      return;
    }
    setError(null);
    setTermId(importedTermId);
    // Merge rather than replace: a student may have added sections before
    // importing. addSection's dedupe rule is applied here too.
    setChosen((prev) => {
      const have = new Set(prev.map((s) => s.sectionId));
      return [...prev, ...sections.filter((s) => !have.has(s.sectionId))];
    });
  }
```

This replaces the version written in Step 3 - write it this way and skip the earlier one. `setError` already exists in this component.

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run
git add src/components/CreateScheduleModal.tsx src/app/schedule/new/page.tsx src/components/ScheduleBuilder.tsx
git commit -m "feat: open the Workday import from the schedule page"
```

---

### Task 4: Verify in a real browser with a real export

**Files:**
- Create (temporary, NOT committed): `_smoke_import.mjs`

A real export lives at `rgschedule/View_My_Courses.xlsx`. **It contains a real student's name and number - never commit it, never copy it into `tests/`, and do not print its contents in your report.** Reference it by path only.

- [ ] **Step 1: Confirm the dev server**

```bash
curl -sf http://localhost:3000 >/dev/null && echo UP
```

A dev server is normally already running. Do NOT start a second - Next.js refuses and exits.

- [ ] **Step 2: Write the smoke script**

Create `_smoke_import.mjs`:

```js
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

try {
  // The button lives on /schedule and routes into the builder with ?import=1.
  await page.goto(`${BASE}/schedule/new?import=1`);
  await page.waitForSelector('[role="dialog"][aria-label="Import from Workday"]', { timeout: 8000 });
  console.log('OVERLAY AUTO-OPENED OK');

  await page.setInputFiles('input[type="file"]', 'rgschedule/View_My_Courses.xlsx');
  await page.click('button:text-is("Import")');

  await page.waitForSelector('button:text-is("Add to schedule")', { timeout: 20000 });
  const summary = await page.locator('[role="dialog"]').innerText();
  // Report only the counts line, never the file's contents.
  console.log('SUMMARY LINE:', summary.split('\n').find((l) => l.includes('Found')) ?? '(none)');

  await page.click('button:text-is("Add to schedule")');
  await page.waitForSelector('[role="dialog"]', { state: 'detached' });

  await page.click('button:text-is("Saved Courses")');
  await page.waitForSelector('text=Total Courses:');
  const total = await page.locator('text=Total Courses:').first().innerText();
  console.log('AFTER IMPORT:', total);

  const blocks = await page.locator('[style*="--course-"]').count();
  console.log('CALENDAR BLOCKS:', blocks);
  if (blocks === 0) throw new Error('import produced no calendar blocks');

  await page.screenshot({ path: 'import-light.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'import-dark.png' });

  console.log('CONSOLE ERRORS:', JSON.stringify(errors));
} finally {
  await browser.close();
}
```

- [ ] **Step 3: Run it**

Run: `node _smoke_import.mjs`
Expected: `OVERLAY AUTO-OPENED OK`, a summary line naming a term and a section count, `AFTER IMPORT: Total Courses: <n>` with n > 0, a non-zero calendar-block count, and `CONSOLE ERRORS: []`.

Against this export the matcher was verified to resolve **12 of 12** rows, so expect a full import with nothing unmatched.

- [ ] **Step 4: Verify nothing was written**

The whole point of this phase is that importing persists nothing. Confirm it:

```bash
node --env-file=.env -e "
const { PrismaClient } = require('@prisma/client'); const { PrismaPg } = require('@prisma/adapter-pg');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
(async () => {
  console.log('savedSchedules:', await db.savedSchedule.count());
  console.log('enrollments:', await db.enrollment.count());
  console.log('boundUsers:', await db.user.count({ where: { studentIdHash: { not: null } } }));
  await db.\$disconnect();
})();"
```

Run this BEFORE step 3 as well, and compare. All three counts must be **identical** before and after the import. If any increased, the action is writing and that is a Critical failure - report it, do not work around it.

- [ ] **Step 5: Look at both screenshots**

Confirm by eye in `import-light.png` and `import-dark.png`:
1. The imported sections appear as coloured blocks on the calendar, at their real times.
2. "Saved Courses" lists the imported courses.
3. Text is readable in BOTH themes; no navy-on-charcoal.
4. Nothing looks clipped or overlapping.

- [ ] **Step 6: Clean up**

```bash
rm -f _smoke_import.mjs import-light.png import-dark.png
git status --short
```

Expected: a clean tree - in particular `rgschedule/` must NOT appear as a new or modified path. Nothing to commit for this task.

---

## Phase 4 done when

- "Import from Workday" sits beside "Build Schedule" on `/schedule` and opens the import overlay in the builder.
- A real export loads its sections onto the calendar and into Saved Courses.
- The term selector switches to the export's term, or explains why it could not.
- Every parsed row that does not make it in is reported with its course name AND its real reason - transfer credit, unreadable code, and unknown term are distinguished, not lumped together.
- Importing writes NOTHING: `savedSchedule`, `enrollment`, and bound-user counts are unchanged.
- `npx vitest run` and `npx tsc --noEmit` clean.

## Deliberately not in this phase

- **RateMyProfessors** - Phase 5, behind a spike.
- **Fixing `UploadCoursesForm`'s exclusion reporting on the Account page** - the same bug, but a separate surface; spec §12 lists it out of scope.
- **A term picker** when an export spans two terms - dominant term wins and the rest is reported. Revisit if real exports routinely straddle.
- **Importing the academic-record export** (past courses). That file is transfer/history data, not a timetable; §8 is about the current schedule.
