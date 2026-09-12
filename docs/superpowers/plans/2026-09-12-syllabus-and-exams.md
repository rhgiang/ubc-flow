# Syllabus Locker and Exam Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a signed-in student one page showing every exam they have this term — finals scraped from UBC, midterms read out of syllabi they upload — and put those exams in the calendar they already subscribe to.

**Architecture:** Two independent data sources feed one view. A scraper reads UBC's public exam table into a global `FinalExam` table keyed on course+term+section+alpha-split. Separately, students upload syllabus PDFs to Vercel Blob; Claude extracts an assessment list from each PDF, which the student confirms before anything is saved. The `/exams` page unions both.

**Tech Stack:** Next.js 16 (App Router), Prisma 7 + Postgres (Neon), cheerio, Vitest, `@vercel/blob`, `@anthropic-ai/sdk`.

**Spec:** [docs/superpowers/specs/2026-09-12-syllabus-and-exams-design.md](../specs/2026-09-12-syllabus-and-exams-design.md)

## Global Constraints

- **No `Co-Authored-By` trailers in commits.** Project-wide rule.
- **Never `git add -A` or `git commit --amend`.** Another session often has this tree open; stage the exact paths each task names.
- **All text sizes in `rem`, never `px`** — system font settings must scale the UI.
- **`main` is the deploy.** Every task must leave the tree building and tests green.
- Read `node_modules/next/dist/docs/` before writing Next.js code — this Next version differs from training data (see `AGENTS.md`).
- Reuse `fetchText` from `src/scrape/http.ts` for all UBC requests; it rate-limits to 1 req/s and sends the identifying User-Agent that makes the exam page work at all.
- New runtime dependencies are limited to exactly two: `@vercel/blob` (Task 5) and `@anthropic-ai/sdk` (Task 6).
- Tests live flat in `tests/<name>.test.ts`, import source via the `@/` alias, and never call a live external API.

---

### Task 1: Exam table parser

Pure functions, no database. The fixture is already committed.

**Files:**
- Create: `src/scrape/parse-exams.ts`
- Test: `tests/parse-exams.test.ts`
- Read-only reference: `tests/fixtures/exam-schedule.html`, `src/upload/parse-workday.ts:204` (`inferTerm`)

**Interfaces:**
- Consumes: `inferTerm(isoDate: string)` from `@/upload/parse-workday`, returning `{ year: number; session: string; termNumber: number | null } | null`.
- Produces:
  ```ts
  export type ExamRow = {
    subjectCode: string;      // "BIOC_V"
    courseNumber: string;     // "302"
    sectionCode: string;      // "951", "B_941", "98A"
    date: string | null;      // "2026-08-18"; null only when cancelled
    startTime: string | null; // "12:00" 24h; null only when cancelled
    alphaSplit: string | null;// "ADI-SUN"
    building: string | null;  // "BIOL"
    room: string | null;      // "1000"
    notes: string | null;     // verbatim
    cancelled: boolean;
  };
  export type ParsedExams = {
    rows: ExamRow[];
    term: { year: number; session: string; termNumber: number | null } | null;
  };
  export function parseExamSchedule(html: string): ParsedExams;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// tests/parse-exams.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseExamSchedule, type ExamRow } from '@/scrape/parse-exams';

const html = readFileSync('tests/fixtures/exam-schedule.html', 'utf8');
const parsed = parseExamSchedule(html);
const find = (course: string, split?: string): ExamRow =>
  parsed.rows.find(
    (r) => `${r.subjectCode} ${r.courseNumber}.${r.sectionCode}` === course &&
      (split === undefined || r.alphaSplit === split),
  )!;

describe('parseExamSchedule', () => {
  it('reads every row in the table', () => {
    expect(parsed.rows).toHaveLength(7);
  });

  it('splits a plain course listing and location', () => {
    const r = find('BIOC_V 302.951');
    expect(r).toMatchObject({
      subjectCode: 'BIOC_V',
      courseNumber: '302',
      sectionCode: '951',
      date: '2026-08-18',
      startTime: '12:00',
      building: 'BIOL',
      room: '1000',
      cancelled: false,
    });
  });

  // "SEE PROF" matches a naive BUILDING ROOM regex. The room must contain a
  // digit, or a student is sent looking for a building called SEE.
  it('treats SEE PROF as no location rather than splitting it', () => {
    const r = find('AMNE_V 101.901');
    expect(r.building).toBeNull();
    expect(r.room).toBeNull();
    expect(r.date).toBe('2026-08-20');
  });

  it('keeps both halves of an alpha-split course', () => {
    expect(find('CHEM_V 123.921', 'ADI-SUN').room).toBe('2');
    expect(find('CHEM_V 123.921', 'ADI-SUN').building).toBe('IRC');
    expect(find('CHEM_V 123.921', 'TAZ-ZHU').room).toBe('6');
  });

  it('parses non-numeric section codes', () => {
    expect(find('FNH_V 497.B_941').sectionCode).toBe('B_941');
    expect(find('AUDI_V 402.98A').sectionCode).toBe('98A');
  });

  it('converts 12-hour times, including noon and midnight-adjacent hours', () => {
    expect(find('BIOC_V 302.951').startTime).toBe('12:00'); // 12:00 PM
    expect(find('CHEM_V 123.921', 'ADI-SUN').startTime).toBe('08:30'); // AM
    expect(find('AUDI_V 402.98A').startTime).toBe('15:30'); // 03:30 PM
  });

  it('flags a cancelled exam and keeps its note, despite empty date cells', () => {
    const r = find('ENGL_V 230.001');
    expect(r.cancelled).toBe(true);
    expect(r.date).toBeNull();
    expect(r.startTime).toBeNull();
    expect(r.notes).toBe('Cancelled: August 17 2026, 3:30pm');
  });

  it('keeps non-cancelling notes without flagging them', () => {
    expect(find('FNH_V 497.B_941').notes).toBe('Location Change (was DMP 201)');
    expect(find('FNH_V 497.B_941').cancelled).toBe(false);
    expect(find('AUDI_V 402.98A').notes).toBe('Late Request');
  });

  // A cancelled row has no date, so per-row inference would drop it into no
  // term at all. One published table is one exam period.
  it('derives one term for the whole run from the dated rows', () => {
    expect(parsed.term).toEqual({ year: 2026, session: 'S', termNumber: null });
  });

  it('returns no rows and no term for markup with no exam table', () => {
    const empty = parseExamSchedule('<html><body><p>Maintenance</p></body></html>');
    expect(empty.rows).toEqual([]);
    expect(empty.term).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/parse-exams.test.ts`
Expected: FAIL — cannot resolve `@/scrape/parse-exams`.

- [ ] **Step 3: Write the implementation**

```ts
// src/scrape/parse-exams.ts
import * as cheerio from 'cheerio';
import { inferTerm } from '@/upload/parse-workday';

export type ExamRow = {
  subjectCode: string;
  courseNumber: string;
  sectionCode: string;
  /** ISO date. Null only on a cancelled exam, which UBC publishes dateless. */
  date: string | null;
  /** 24-hour "HH:MM". The table gives a start only — there is no end time. */
  startTime: string | null;
  alphaSplit: string | null;
  building: string | null;
  room: string | null;
  notes: string | null;
  cancelled: boolean;
};

export type ParsedExams = {
  rows: ExamRow[];
  term: { year: number; session: string; termNumber: number | null } | null;
};

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

/**
 * "BIOC_V 302.951" -> subject BIOC_V, number 302, section 951.
 * Splits on the FIRST dot: sections are not numeric ("FNH_V 497.B_941",
 * "AUDI_V 402.98A"), so a last-dot split or a \d+ section breaks real rows.
 */
function parseCourseCell(cell: string) {
  const m = cell.trim().match(/^(\S+)\s+([^.\s]+)\.(.+)$/);
  if (!m) return null;
  return { subjectCode: m[1], courseNumber: m[2], sectionCode: m[3].trim() };
}

/** "AUG 18 2026 12:00 PM" -> { date: "2026-08-18", startTime: "12:00" }. */
function parseDateCell(cell: string) {
  const m = cell
    .trim()
    .match(/^([A-Z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP])M$/i);
  if (!m) return { date: null, startTime: null };
  const month = MONTHS[m[1].toUpperCase()];
  if (!month) return { date: null, startTime: null };

  let hour = Number(m[4]) % 12;
  if (m[6].toUpperCase() === 'P') hour += 12;

  return {
    date: `${m[3]}-${month}-${m[2].padStart(2, '0')}`,
    startTime: `${String(hour).padStart(2, '0')}:${m[5]}`,
  };
}

/**
 * "BIOL 1000" -> BIOL / 1000. "SEE PROF" -> null / null.
 *
 * ponytail: the room must contain a digit rather than matching a denylist of
 * sentinels. "SEE PROF" satisfies any plain `WORD WORD` pattern, and a
 * denylist needs editing every time the registrar invents a new placeholder.
 * If a genuine all-letter room ever appears, this is the line to relax.
 */
function parseLocationCell(cell: string) {
  const m = cell.trim().match(/^([A-Z_]{2,6})\s+(\S+)$/i);
  if (!m || !/\d/.test(m[2])) return { building: null, room: null };
  return { building: m[1], room: m[2] };
}

function cellText(text: string): string | null {
  const value = text.trim();
  return value === '' ? null : value;
}

export function parseExamSchedule(html: string): ParsedExams {
  const $ = cheerio.load(html);
  const rows: ExamRow[] = [];

  $('#tablepress-1 tbody tr').each((_, tr) => {
    const cells = $(tr)
      .find('td')
      .map((_i, td) => $(td).text().trim())
      .get();
    if (cells.length < 6) return;

    // The Department column is truncated in the source ("FNH_" for "FNH_V"),
    // so the course cell is the only authority on the subject code.
    const course = parseCourseCell(cells[1]);
    if (!course) return;

    const notes = cellText(cells[5]);
    const { date, startTime } = parseDateCell(cells[2]);
    const { building, room } = parseLocationCell(cells[3]);

    rows.push({
      ...course,
      date,
      startTime,
      alphaSplit: cellText(cells[4]),
      building,
      room,
      notes,
      // One prefix test, not a note parser: anything richer starts guessing at
      // free text the registrar rewords at will.
      cancelled: /^cancelled/i.test(notes ?? ''),
    });
  });

  return { rows, term: majorityTerm(rows) };
}

/**
 * One published table covers one exam period, so the term is derived once for
 * the whole run. Per-row inference would leave every cancelled row — which has
 * no date cell at all — stranded with no term.
 */
function majorityTerm(rows: ExamRow[]): ParsedExams['term'] {
  const counts = new Map<string, { term: NonNullable<ParsedExams['term']>; n: number }>();
  for (const row of rows) {
    if (!row.date) continue;
    const term = inferTerm(row.date);
    if (!term) continue;
    const key = `${term.year}-${term.session}-${term.termNumber}`;
    const seen = counts.get(key);
    if (seen) seen.n += 1;
    else counts.set(key, { term, n: 1 });
  }
  let best: { term: NonNullable<ParsedExams['term']>; n: number } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.n > best.n) best = entry;
  }
  return best?.term ?? null;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/parse-exams.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/scrape/parse-exams.ts tests/parse-exams.test.ts
git commit -m "feat: parse UBC's published final exam table"
```

---

### Task 2: FinalExam model and the scrape job

**Files:**
- Modify: `prisma/schema.prisma` (append `FinalExam`)
- Create: `prisma/migrations/<timestamp>_final_exam/migration.sql` (generated)
- Create: `src/scrape/jobs/exams.ts`, `src/scrape/jobs/exams.run.ts`
- Modify: `package.json` (add `scrape:exams` script)
- Test: `tests/exams-job.test.ts`

**Interfaces:**
- Consumes: `parseExamSchedule` (Task 1); `fetchText` from `@/scrape/http`.
- Produces: `export async function ingestExams(html: string): Promise<{ written: number; skipped: string[] }>` — `skipped` holds `"SUBJ NUM"` labels for rows whose course or term is not in the catalogue.

- [ ] **Step 1: Add the model to `prisma/schema.prisma`**

Append exactly the `FinalExam` block from spec §3, including its doc comments. The unique key is `@@unique([courseId, termId, sectionCode, alphaSplit])` — without `alphaSplit`, `CHEM_V 123.921`'s two rooms collide and one is silently lost.

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name final_exam`
Expected: migration created, `prisma generate` runs, `FinalExam` available on the client.

- [ ] **Step 3: Write the failing test**

```ts
// tests/exams-job.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { db } from '@/lib/db';
import { ingestExams } from '@/scrape/jobs/exams';

const html = readFileSync('tests/fixtures/exam-schedule.html', 'utf8');

describe('ingestExams', () => {
  it('skips rows whose course is not in the catalogue rather than throwing', async () => {
    const result = await ingestExams(html);
    expect(Array.isArray(result.skipped)).toBe(true);
    expect(result.written).toBeGreaterThanOrEqual(0);
  });

  it('is idempotent: a second run writes the same rows, not duplicates', async () => {
    const first = await ingestExams(html);
    const before = await db.finalExam.count();
    const second = await ingestExams(html);
    const after = await db.finalExam.count();
    expect(after).toBe(before);
    expect(second.written).toBe(first.written);
  });

  it('stores both alpha-split rooms when the catalogue has the course', async () => {
    await ingestExams(html);
    const split = await db.finalExam.findMany({ where: { alphaSplit: { not: null } } });
    const rooms = split.map((e) => e.room).sort();
    // Either the course is absent from this database (nothing stored) or both
    // halves are present — never exactly one, which is the collision bug.
    expect([0, 2]).toContain(rooms.length);
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `npx vitest run tests/exams-job.test.ts`
Expected: FAIL — cannot resolve `@/scrape/jobs/exams`.

- [ ] **Step 5: Write the job**

```ts
// src/scrape/jobs/exams.ts
import { db } from '@/lib/db';
import { fetchText } from '@/scrape/http';
import { parseExamSchedule } from '@/scrape/parse-exams';

export const EXAM_SCHEDULE_URL = 'https://tools.students.ubc.ca/exam-schedule/';

/** Campus the published schedule covers. The table is UBCV only. */
const CAMPUS = 'UBCV';

export async function fetchExamSchedule(): Promise<string> {
  return fetchText(EXAM_SCHEDULE_URL);
}

export async function ingestExams(html: string) {
  const { rows, term: inferred } = parseExamSchedule(html);
  const skipped: string[] = [];
  if (!inferred) return { written: 0, skipped };

  const term = await db.term.findFirst({
    where: {
      year: inferred.year,
      session: inferred.session,
      termNumber: inferred.termNumber,
      campus: CAMPUS,
    },
  });
  if (!term) return { written: 0, skipped: rows.map((r) => `${r.subjectCode} ${r.courseNumber}`) };

  let written = 0;
  for (const row of rows) {
    const course = await db.course.findFirst({
      where: {
        number: row.courseNumber,
        subject: { code: row.subjectCode, campus: CAMPUS },
      },
    });
    if (!course) {
      skipped.push(`${row.subjectCode} ${row.courseNumber}`);
      continue;
    }

    // Upsert, never delete. A transient failure mid-run must leave last
    // week's schedule intact: stale exam data is useful, an emptied table the
    // night before finals is not.
    await db.finalExam.upsert({
      where: {
        courseId_termId_sectionCode_alphaSplit: {
          courseId: course.id,
          termId: term.id,
          sectionCode: row.sectionCode,
          alphaSplit: row.alphaSplit,
        },
      },
      create: {
        courseId: course.id,
        termId: term.id,
        sectionCode: row.sectionCode,
        alphaSplit: row.alphaSplit,
        date: row.date ? new Date(`${row.date}T00:00:00Z`) : null,
        startTime: row.startTime,
        building: row.building,
        room: row.room,
        notes: row.notes,
        cancelled: row.cancelled,
      },
      update: {
        date: row.date ? new Date(`${row.date}T00:00:00Z`) : null,
        startTime: row.startTime,
        building: row.building,
        room: row.room,
        notes: row.notes,
        cancelled: row.cancelled,
      },
    });
    written += 1;
  }

  return { written, skipped };
}
```

```ts
// src/scrape/jobs/exams.run.ts
import 'dotenv/config';
import { fetchExamSchedule, ingestExams } from './exams';

async function main() {
  const html = await fetchExamSchedule();
  const { written, skipped } = await ingestExams(html);
  console.log(`exams: wrote ${written} rows`);
  if (skipped.length > 0) {
    console.log(`exams: skipped ${skipped.length} not in catalogue:`, skipped.slice(0, 20));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

Check `src/scrape/jobs/catalog.run.ts` first and match whatever it does for dotenv and db teardown rather than assuming the two lines above.

- [ ] **Step 6: Add the npm script**

In `package.json`, after `"scrape:faculties"`:
```json
"scrape:exams": "tsx src/scrape/jobs/exams.run.ts",
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `npx vitest run tests/exams-job.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/scrape/jobs/exams.ts src/scrape/jobs/exams.run.ts package.json tests/exams-job.test.ts
git commit -m "feat: store UBC's final exam schedule"
```

---

### Task 3: The /exams page

**Files:**
- Create: `src/app/exams/page.tsx`, `src/components/ExamList.tsx`
- Modify: `src/components/NavLinks.tsx` (add the link)
- Test: `tests/exam-view.test.ts`

**Interfaces:**
- Consumes: `FinalExam` rows; `auth()` from `@/lib/auth`.
- Produces: `export function examRowsForUser(userId: string, termId: string)` in `src/schedule/exams.ts`, returning `Promise<ExamListItem[]>` where
  ```ts
  export type ExamListItem = {
    id: string;
    courseLabel: string;      // "BIOC 302"
    sectionCode: string;
    date: Date | null;
    startTime: string | null;
    location: string | null;  // "BIOL 1000", null when unknown
    alphaSplit: string | null;
    notes: string | null;
    cancelled: boolean;
    /** Declared as a union from the start so Task 7 widens no types. */
    source: 'ubc' | 'syllabus';
    /** Set only on syllabus rows a student edited; drives Task 7 precedence. */
    editedByUser?: boolean;
  };
  ```

- [ ] **Step 1: Write the failing test for the query**

```ts
// tests/exam-view.test.ts
import { describe, it, expect } from 'vitest';
import { toExamListItem } from '@/schedule/exams';

describe('toExamListItem', () => {
  it('joins building and room into one location string', () => {
    const item = toExamListItem({
      id: 'e1', sectionCode: '951', date: new Date('2026-08-18T00:00:00Z'),
      startTime: '12:00', building: 'BIOL', room: '1000', alphaSplit: null,
      notes: null, cancelled: false,
      course: { number: '302', subject: { code: 'BIOC_V' } },
    });
    expect(item.location).toBe('BIOL 1000');
    expect(item.courseLabel).toBe('BIOC 302');
  });

  // "BIOC_V" is the Workday/scrape spelling; students read "BIOC".
  it('strips the campus suffix from the subject code', () => {
    const item = toExamListItem({
      id: 'e2', sectionCode: '001', date: null, startTime: null,
      building: null, room: null, alphaSplit: null,
      notes: 'Cancelled: August 17 2026, 3:30pm', cancelled: true,
      course: { number: '230', subject: { code: 'ENGL_V' } },
    });
    expect(item.courseLabel).toBe('ENGL 230');
    expect(item.location).toBeNull();
    expect(item.cancelled).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/exam-view.test.ts`
Expected: FAIL — cannot resolve `@/schedule/exams`.

- [ ] **Step 3: Implement the query module**

Create `src/schedule/exams.ts` with `toExamListItem` (pure, as tested) and `examRowsForUser`, which selects the user's `Enrollment` rows for the term and joins `FinalExam` on `courseId` + `termId`, including `course.subject`. Sort: dated exams ascending by `date` then `startTime`, with cancelled and dateless rows last.

`courseLabel` drops the `_V`/`_O` campus suffix: `code.replace(/_[A-Z]$/, '')`.

- [ ] **Step 4: Build the page and list component**

`src/app/exams/page.tsx` is a server component: `auth()`, redirect to login when signed out, resolve the current term, call `examRowsForUser`, render `<ExamList items={...} />`.

`src/components/ExamList.tsx` renders each item. Required behaviours:
- A cancelled exam renders **struck through with its note visible** — never as a normal exam, never omitted (spec §4).
- `location: null` renders "Location TBA — check with your instructor", not an empty cell.
- `alphaSplit` renders as "Surnames ADI–SUN" next to the room, since that is which room the student actually goes to.
- Empty state: no exams found reads as "UBC hasn't published the final exam schedule for this term yet — it usually appears partway through term", not a blank panel.
- All sizes in `rem`.

Match the visual language of `src/components/EnrolledCourseCard.tsx`.

- [ ] **Step 5: Add the nav link**

Add `/exams` labelled "Exams" to `src/components/NavLinks.tsx`, following the existing entries.

- [ ] **Step 6: Verify in the browser**

Run: `npm run dev`, open `http://localhost:3000/exams` signed in.
Expected: the list renders, or the empty-state copy shows. Confirm before committing — `main` is the deploy.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/exams/page.tsx src/components/ExamList.tsx src/components/NavLinks.tsx src/schedule/exams.ts tests/exam-view.test.ts
git commit -m "feat: show every final exam on one page"
```

---

### Task 4: One-off calendar events, so exams reach phones

`buildIcs` currently drops any event without an `endTime` and stamps `RRULE:FREQ=WEEKLY` on everything. Both are wrong for exams, and both are fixed in that one function so every caller benefits.

**Files:**
- Modify: `src/schedule/ics.ts`
- Modify: `src/app/api/calendar/enrolled/route.ts` and `src/app/api/calendar/[token]/route.ts` (feed exams in)
- Test: `tests/ics.test.ts` (extend)

**Interfaces:**
- Consumes: `ExamListItem` (Task 3).
- Produces: `export const EXAM_DEFAULT_MINUTES = 150;` and `export function examEvent(item: ExamListItem): IcsEvent | null` in `src/schedule/ics.ts`. `IcsEvent` gains two fields: `day: string | null` (`null` means a single occurrence) and `description?: string | null`, which spec §6 requires so the assumed end time is disclosed in the event itself.

- [ ] **Step 1: Write the failing tests**

```ts
// append to tests/ics.test.ts
import { buildIcs, examEvent, EXAM_DEFAULT_MINUTES, type IcsEvent } from '@/schedule/ics';

describe('one-off events', () => {
  const exam: IcsEvent = {
    uid: 'exam-1', title: 'BIOC 302 Final', day: null,
    startTime: '12:00', endTime: '14:30',
    startDate: new Date('2026-08-18T00:00:00Z'),
    endDate: new Date('2026-08-18T00:00:00Z'),
    location: 'BIOL 1000',
  };

  it('emits no RRULE for an event with no weekday', () => {
    const ics = buildIcs('Exams', [exam]);
    expect(ics).toContain('DTSTART;TZID=America/Vancouver:20260818T120000');
    expect(ics).not.toContain('RRULE');
  });

  it('still repeats a weekly meeting', () => {
    const weekly: IcsEvent = { ...exam, uid: 'w', day: 'Mon',
      endDate: new Date('2026-12-04T00:00:00Z') };
    expect(buildIcs('Term', [weekly])).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO');
  });
});

describe('examEvent', () => {
  const base = {
    id: 'e1', courseLabel: 'BIOC 302', sectionCode: '951',
    date: new Date('2026-08-18T00:00:00Z'), startTime: '12:00',
    location: 'BIOL 1000', alphaSplit: null, notes: null,
    cancelled: false, source: 'ubc' as const,
  };

  // UBC publishes no end time. The event still needs one, so it is ours.
  it('ends an exam a default duration after it starts', () => {
    expect(EXAM_DEFAULT_MINUTES).toBe(150);
    expect(examEvent(base)!.endTime).toBe('14:30');
  });

  it('rolls the default duration over an hour boundary correctly', () => {
    expect(examEvent({ ...base, startTime: '15:30' })!.endTime).toBe('18:00');
  });

  // Spec §6: the end time is our assumption, so the event has to say so.
  it('discloses the assumed end time in the event description', () => {
    const ics = buildIcs('Exams', [examEvent(base)!]);
    expect(ics).toMatch(/DESCRIPTION:.*UBC publishes a start time only/);
  });

  it('drops a cancelled exam from the feed', () => {
    expect(examEvent({ ...base, cancelled: true })).toBeNull();
  });

  it('drops a dateless exam rather than guessing', () => {
    expect(examEvent({ ...base, date: null, startTime: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `npx vitest run tests/ics.test.ts`
Expected: FAIL — `examEvent` is not exported; the RRULE assertion fails.

- [ ] **Step 3: Change `IcsEvent.day` to `string | null` and branch in `buildIcs`**

In the event loop, replace the unconditional day lookup and the `RRULE` line:

```ts
for (const e of events) {
  if (!e.startTime || !e.endTime || !e.startDate) continue;

  // A null day is a single occurrence — an exam, not a weekly meeting.
  if (e.day === null) {
    const stamp = dateStamp(e.startDate);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@ubcflow`,
      `DTSTAMP:${dateStamp(new Date())}T000000Z`,
      `DTSTART;TZID=${TZID}:${stamp}T${e.startTime.replace(':', '')}00`,
      `DTEND;TZID=${TZID}:${stamp}T${e.endTime.replace(':', '')}00`,
      `SUMMARY:${escapeText(e.title)}`,
      ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
      ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
      'END:VEVENT',
    );
    continue;
  }

  const dayIndex = DAY_INDEX[e.day];
  if (dayIndex === undefined) continue;
  if (!e.endDate) continue;
  // ... existing weekly path unchanged
}
```

- [ ] **Step 4: Add the duration constant and `examEvent`**

```ts
/**
 * How long an exam is assumed to run. UBC's published table gives a start
 * time and no end, so this is our assumption, not their data.
 *
 * ponytail: one constant rather than per-faculty rules. If the table ever
 * gains a duration column, or 2.5h proves wrong somewhere, this is the single
 * line to change.
 */
export const EXAM_DEFAULT_MINUTES = 150;

function addMinutes(time: string, minutes: number): string | null {
  const m = time.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const total = Number(m[1]) * 60 + Number(m[2]) + minutes;
  if (total >= 24 * 60) return null;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function examEvent(item: ExamListItem): IcsEvent | null {
  // A cancelled exam must never ring an alarm, and a dateless one cannot be
  // placed. Both are shown on the page instead (see ExamList).
  if (item.cancelled || !item.date || !item.startTime) return null;
  const endTime = addMinutes(item.startTime, EXAM_DEFAULT_MINUTES);
  if (!endTime) return null;

  return {
    uid: `exam-${item.id}`,
    title: `${item.courseLabel} Final Exam`,
    day: null,
    startTime: item.startTime,
    endTime,
    startDate: item.date,
    endDate: item.date,
    location: item.location,
    description:
      `Ends at ${endTime} is an estimate — UBC publishes a start time only. ` +
      `Confirm with your instructor.`,
  };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run tests/ics.test.ts`
Expected: PASS — the new tests plus every pre-existing one. If an existing test broke, the weekly path regressed; fix that rather than editing the old test.

- [ ] **Step 6: Feed exams into both calendar routes**

In each calendar route, append `examRowsForUser(...).map(examEvent).filter(Boolean)` to the events already built from meetings.

- [ ] **Step 7: Verify a real calendar file**

Run: `npm run dev`, then fetch the enrolled-calendar route with `?download=1` and open the `.ics`.
Expected: exams appear as single events, weekly classes still repeat.

- [ ] **Step 8: Commit**

```bash
git add src/schedule/ics.ts src/app/api/calendar tests/ics.test.ts
git commit -m "feat: put final exams in the calendar feed"
```

---

### Task 5: Syllabus upload and viewer

**Files:**
- Modify: `prisma/schema.prisma` (append `Syllabus`), plus generated migration
- Create: `src/app/api/syllabus/route.ts` (POST upload, DELETE remove)
- Create: `src/app/syllabus/page.tsx`, `src/components/SyllabusUpload.tsx`, `src/components/SyllabusList.tsx`
- Modify: `package.json` (`@vercel/blob`), `.env.example` (`BLOB_READ_WRITE_TOKEN`)
- Test: `tests/syllabus-upload.test.ts`

**Interfaces:**
- Produces: `export function validateSyllabusFile(file: { type: string; size: number; name: string }): string | null` in `src/syllabus/validate.ts` — returns an error message, or `null` when acceptable.

- [ ] **Step 1: Install the dependency**

Run: `npm install @vercel/blob`

- [ ] **Step 2: Add the `Syllabus` model and migrate**

Append the `Syllabus` block from spec §3. Run: `npx prisma migrate dev --name syllabus`

- [ ] **Step 3: Write the failing validation test**

```ts
// tests/syllabus-upload.test.ts
import { describe, it, expect } from 'vitest';
import { validateSyllabusFile, MAX_SYLLABUS_BYTES } from '@/syllabus/validate';

describe('validateSyllabusFile', () => {
  it('accepts a normal PDF', () => {
    expect(validateSyllabusFile({ type: 'application/pdf', size: 900_000, name: 'cpsc221.pdf' }))
      .toBeNull();
  });

  it('rejects a non-PDF regardless of extension', () => {
    expect(validateSyllabusFile({ type: 'application/zip', size: 1000, name: 'syllabus.pdf' }))
      .toMatch(/PDF/);
  });

  it('rejects an oversized file before anything is uploaded', () => {
    expect(validateSyllabusFile({
      type: 'application/pdf', size: MAX_SYLLABUS_BYTES + 1, name: 'big.pdf',
    })).toMatch(/too large/i);
  });

  it('rejects an empty file', () => {
    expect(validateSyllabusFile({ type: 'application/pdf', size: 0, name: 'e.pdf' }))
      .toMatch(/empty/i);
  });
});
```

- [ ] **Step 4: Run it and confirm it fails**

Run: `npx vitest run tests/syllabus-upload.test.ts`
Expected: FAIL — cannot resolve `@/syllabus/validate`.

- [ ] **Step 5: Implement validation and the upload route**

`src/syllabus/validate.ts` exports `MAX_SYLLABUS_BYTES = 10 * 1024 * 1024` and `validateSyllabusFile`.

`src/app/api/syllabus/route.ts` follows the shape of `src/app/api/upload/route.ts`:
1. `auth()`; 401 when signed out.
2. `validateSyllabusFile` **before** any blob write — the size check must never be reachable only after upload.
3. `put(...)` from `@vercel/blob` with `access: 'private'`, then upsert the `Syllabus` row on `(userId, courseId, termId)`.
4. `DELETE` deletes the blob via `del(...)` **and** the row. A student who deletes a syllabus has asked for the file to be gone.

Add `BLOB_READ_WRITE_TOKEN=` to `.env.example`.

- [ ] **Step 6: Build the page**

`src/app/syllabus/page.tsx` lists the user's enrolled courses for the current term, each with either its uploaded syllabus or an upload control. Viewing is `<embed src={signedUrl} type="application/pdf">` — the browser's own viewer, no `pdf.js`. Sizes in `rem`.

- [ ] **Step 7: Verify in the browser**

Run: `npm run dev`. Upload a real syllabus PDF, view it, delete it.
Expected: the PDF renders inline; after delete both the row and the blob are gone.

- [ ] **Step 8: Run the full suite and commit**

```bash
npm test
git add prisma/schema.prisma prisma/migrations src/syllabus/validate.ts src/app/api/syllabus/route.ts src/app/syllabus/page.tsx src/components/SyllabusUpload.tsx src/components/SyllabusList.tsx package.json package-lock.json .env.example tests/syllabus-upload.test.ts
git commit -m "feat: keep your syllabi in one place"
```

---

### Task 6: Extraction and the confirm screen

**Files:**
- Modify: `prisma/schema.prisma` (append `SyllabusAssessment`), plus generated migration
- Create: `src/syllabus/extract.ts`, `src/syllabus/schema.ts`
- Create: `src/app/api/syllabus/extract/route.ts`
- Create: `src/components/AssessmentConfirm.tsx`
- Modify: `package.json` (`@anthropic-ai/sdk`), `.env.example` (`ANTHROPIC_API_KEY`)
- Test: `tests/syllabus-extract.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ExtractedAssessment = {
    title: string;
    kind: 'midterm' | 'final' | 'assignment' | 'quiz';
    date: string | null;      // ISO
    startTime: string | null; // "14:00"
    weight: number | null;    // percent
    quote: string;
    page: number;
  };
  export const ASSESSMENT_TOOL: Anthropic.Tool;
  export function normalizeAssessments(input: unknown): ExtractedAssessment[];
  export async function extractAssessments(pdf: Buffer): Promise<ExtractedAssessment[]>;
  ```

- [ ] **Step 1: Install the SDK and add the model**

Run: `npm install @anthropic-ai/sdk`, then append `SyllabusAssessment` from spec §3 and run `npx prisma migrate dev --name syllabus_assessment`.

- [ ] **Step 2: Write the failing test**

No test calls the API. `normalizeAssessments` is tested against recorded tool input.

```ts
// tests/syllabus-extract.test.ts
import { describe, it, expect } from 'vitest';
import { normalizeAssessments, ASSESSMENT_TOOL } from '@/syllabus/schema';

const recorded = {
  assessments: [
    { title: 'Midterm 1', kind: 'midterm', date: '2026-10-14', startTime: '18:00',
      weight: 20, quote: 'Midterm 1: Tuesday October 14, 6:00pm (20%)', page: 3 },
    { title: 'Final Exam', kind: 'final', date: null, startTime: null,
      weight: 45, quote: 'Final exam (45%), scheduled by the registrar', page: 3 },
  ],
};

describe('ASSESSMENT_TOOL', () => {
  // strict:true requires both, or the API rejects the tool definition.
  it('is strict and closed', () => {
    expect(ASSESSMENT_TOOL.strict).toBe(true);
    const schema = ASSESSMENT_TOOL.input_schema as Record<string, unknown>;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toContain('assessments');
  });
});

describe('normalizeAssessments', () => {
  it('parses recorded tool input', () => {
    const out = normalizeAssessments(recorded);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ title: 'Midterm 1', kind: 'midterm', weight: 20, page: 3 });
  });

  it('keeps an undated final rather than dropping it', () => {
    expect(normalizeAssessments(recorded)[1].date).toBeNull();
  });

  it('drops a row with an unknown kind instead of guessing', () => {
    const out = normalizeAssessments({
      assessments: [{ ...recorded.assessments[0], kind: 'participation' }],
    });
    expect(out).toEqual([]);
  });

  // Every saved row is shown to a student beside its quote; a row without one
  // cannot be checked, so it is not offered.
  it('drops a row with no quote', () => {
    const out = normalizeAssessments({
      assessments: [{ ...recorded.assessments[0], quote: '' }],
    });
    expect(out).toEqual([]);
  });

  it('returns empty for malformed input rather than throwing', () => {
    expect(normalizeAssessments(null)).toEqual([]);
    expect(normalizeAssessments({ assessments: 'nope' })).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `npx vitest run tests/syllabus-extract.test.ts`
Expected: FAIL — cannot resolve `@/syllabus/schema`.

- [ ] **Step 4: Write `src/syllabus/schema.ts`**

Strict mode requires `additionalProperties: false` **and** every property listed in `required` — nullable fields are expressed as a `["string", "null"]` type, not by omission from `required`. Getting this wrong is rejected at request time, not silently.

```ts
import type Anthropic from '@anthropic-ai/sdk';

export const ASSESSMENT_KINDS = ['midterm', 'final', 'assignment', 'quiz'] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];

export type ExtractedAssessment = {
  title: string;
  kind: AssessmentKind;
  date: string | null;
  startTime: string | null;
  weight: number | null;
  quote: string;
  page: number;
};

const assessment = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'kind', 'date', 'startTime', 'weight', 'quote', 'page'],
  properties: {
    title: { type: 'string', description: 'As the syllabus names it, e.g. "Midterm 1".' },
    kind: { type: 'string', enum: [...ASSESSMENT_KINDS] },
    date: {
      type: ['string', 'null'],
      description: 'ISO date (YYYY-MM-DD), or null if the syllabus gives none. Never infer one.',
    },
    startTime: { type: ['string', 'null'], description: '24-hour HH:MM, or null.' },
    weight: { type: ['number', 'null'], description: 'Percent of the final grade, or null.' },
    quote: { type: 'string', description: 'Verbatim sentence from the syllabus supporting this row.' },
    page: { type: 'integer', description: '1-indexed page the quote appears on.' },
  },
} as const;

export const ASSESSMENT_TOOL: Anthropic.Tool = {
  name: 'report_assessments',
  description: 'Report every graded assessment stated in the syllabus.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['assessments'],
    properties: { assessments: { type: 'array', items: assessment } },
  },
};

/**
 * Defensive on purpose: a row that cannot be checked is not offered. Every
 * saved assessment is shown to a student beside its quote, so a row with no
 * quote has nothing to verify against and is dropped rather than displayed.
 */
export function normalizeAssessments(input: unknown): ExtractedAssessment[] {
  const list = (input as { assessments?: unknown })?.assessments;
  if (!Array.isArray(list)) return [];

  const out: ExtractedAssessment[] = [];
  for (const raw of list) {
    const r = raw as Record<string, unknown>;
    if (typeof r?.title !== 'string' || r.title.trim() === '') continue;
    if (!ASSESSMENT_KINDS.includes(r.kind as AssessmentKind)) continue;
    if (typeof r.quote !== 'string' || r.quote.trim() === '') continue;
    if (!Number.isInteger(r.page)) continue;

    out.push({
      title: r.title.trim(),
      kind: r.kind as AssessmentKind,
      date: typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null,
      startTime: typeof r.startTime === 'string' && /^\d{2}:\d{2}$/.test(r.startTime)
        ? r.startTime : null,
      weight: typeof r.weight === 'number' && Number.isFinite(r.weight) ? r.weight : null,
      quote: r.quote.trim(),
      page: r.page as number,
    });
  }
  return out;
}
```

- [ ] **Step 5: Write `src/syllabus/extract.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk';
import { ASSESSMENT_TOOL, normalizeAssessments, type ExtractedAssessment } from './schema';

const client = new Anthropic();

const SYSTEM = `You read UBC course syllabi and list every graded assessment.
Report only what the syllabus actually states. If a date is not given, leave it
null — do not infer one from the term calendar. Every assessment must include a
verbatim quote from the syllabus and the page it appears on.`;

export async function extractAssessments(pdf: Buffer): Promise<ExtractedAssessment[]> {
  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 16000,
    system: SYSTEM,
    tools: [ASSESSMENT_TOOL],
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') },
        },
        { type: 'text', text: 'List every graded assessment in this syllabus.' },
      ],
    }],
  });

  const call = response.content.find((b) => b.type === 'tool_use');
  return call ? normalizeAssessments(call.input) : [];
}
```

- [ ] **Step 6: Write the extract route with its rate limit**

`src/app/api/syllabus/extract/route.ts`: `auth()`, load the user's `Syllabus`, enforce a **per-user daily extraction cap** (count `Syllabus` rows with `extractedAt` inside the last 24h; reject over the cap with a clear message), fetch the blob, call `extractAssessments`.

Return the assessments to the client **without saving them**. A failure returns an error but leaves the `Syllabus` row intact and readable — losing a student's upload because a model call timed out is the one outcome this must never produce.

- [ ] **Step 7: Build the confirm screen**

`src/components/AssessmentConfirm.tsx` shows a table of proposed rows: title, kind, date, weight, all editable, each with its `quote` and page number visible beside it. A Save button writes `SyllabusAssessment` rows and sets `extractedAt`; edited rows get `editedByUser: true`. Nothing is written before Save.

- [ ] **Step 8: Verify end to end**

Run: `npm run dev`. Upload a real syllabus, run extraction, check the quotes line up with the PDF, edit one row, save.
Expected: saved rows match the confirm screen, including the edit.

- [ ] **Step 9: Run the full suite and commit**

```bash
npm test
git add prisma/schema.prisma prisma/migrations src/syllabus/schema.ts src/syllabus/extract.ts src/app/api/syllabus/extract/route.ts src/components/AssessmentConfirm.tsx package.json package-lock.json .env.example tests/syllabus-extract.test.ts
git commit -m "feat: read the assessment list out of a syllabus"
```

---

### Task 7: Merge syllabus midterms into /exams

**Files:**
- Modify: `src/schedule/exams.ts` (union + precedence), `src/components/ExamList.tsx` (source label)
- Test: `tests/exam-merge.test.ts`

**Interfaces:**
- Consumes: `ExamListItem` (Task 3), `SyllabusAssessment` (Task 6).
- Produces: `export function mergeExams(scraped: ExamListItem[], fromSyllabus: ExamListItem[]): ExamListItem[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/exam-merge.test.ts
import { describe, it, expect } from 'vitest';
import { mergeExams, type ExamListItem } from '@/schedule/exams';

const scrapedFinal: ExamListItem = {
  id: 'ubc-1', courseLabel: 'BIOC 302', sectionCode: '951',
  date: new Date('2026-12-15T00:00:00Z'), startTime: '12:00',
  location: 'BIOL 1000', alphaSplit: null, notes: null,
  cancelled: false, source: 'ubc',
};
const syllabusFinal: ExamListItem = {
  ...scrapedFinal, id: 'syl-1', date: null, startTime: null,
  location: null, source: 'syllabus',
};
const midterm: ExamListItem = {
  ...syllabusFinal, id: 'syl-2', courseLabel: 'BIOC 302',
  date: new Date('2026-10-14T00:00:00Z'), startTime: '18:00',
};

describe('mergeExams', () => {
  it('prefers UBC over a syllabus final for the same course', () => {
    const out = mergeExams([scrapedFinal], [syllabusFinal]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('ubc');
    expect(out[0].location).toBe('BIOL 1000');
  });

  it('keeps midterms, which never collide with scraped finals', () => {
    const out = mergeExams([scrapedFinal], [midterm]);
    expect(out).toHaveLength(2);
  });

  it('lets a student-edited row win over the scraped one', () => {
    const edited = { ...syllabusFinal, editedByUser: true,
      date: new Date('2026-12-16T00:00:00Z') };
    const out = mergeExams([scrapedFinal], [edited]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('syllabus');
  });

  it('sorts by date with dateless entries last', () => {
    const out = mergeExams([scrapedFinal], [midterm, syllabusFinal]);
    expect(out[0].id).toBe('syl-2');
    expect(out[out.length - 1].date).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run tests/exam-merge.test.ts`
Expected: FAIL — `mergeExams` is not exported.

- [ ] **Step 3: Implement `mergeExams`**

Precedence from spec §9, applied per `courseLabel` + `kind`:
1. A row with `editedByUser` wins over everything.
2. Otherwise a scraped `FinalExam` beats a syllabus-derived final.
3. Midterms come only from syllabi and never collide.

Then sort ascending by date, dateless last.

- [ ] **Step 4: Show the source in the UI**

`ExamList` labels each row's origin — "UBC exam schedule" or "From your syllabus" — so a student knows which dates are official and which came from a PDF. A syllabus row is the one they should double-check.

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run tests/exam-merge.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Verify in the browser**

Run: `npm run dev`, open `/exams` with both a scraped final and an extracted midterm present.
Expected: both appear, correctly labelled and ordered.

- [ ] **Step 7: Run the full suite and commit**

```bash
npm test
git add src/schedule/exams.ts src/components/ExamList.tsx tests/exam-merge.test.ts
git commit -m "feat: show midterms and finals on one schedule"
```

---

## Notes for the executor

**Stop and ask rather than working around:**
- If the exam scrape returns zero rows, check whether UBC has published a schedule at all before assuming the parser broke — between exam periods the table is legitimately empty.
- If `@vercel/blob` needs a paid plan on this account, stop. Do not substitute Postgres `bytea`; that decision belongs to the spec author.

**The two rules with real consequences for students**, both in §4 of the spec, both easy to lose in a refactor:
- A cancelled exam is shown struck through, never as a normal exam and never silently dropped.
- A cancelled or dateless exam never reaches the calendar feed.
