# UBC Flow Phase 5: Grade Distributions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student can open a course and see its real historical grade distribution, and open a professor and see their historical average — with UBC's privacy-suppressed data honestly labelled rather than hidden or invented.

**Architecture:** Continues the Next.js + Prisma monolith. CSV parsing and aggregation are **pure functions**, matching every prior phase. Ingest is a scheduled `*.run.ts` job using Phase 1's rate-limited `fetchText`, writing idempotent upserts.

**Tech Stack:** Next.js 16, TypeScript, Prisma 7, Postgres, Tailwind, Vitest. **No new dependencies** — CSV parsing is ~30 lines and the chart is 11 CSS bars.

**Spec:** [`docs/superpowers/specs/2026-08-20-phase-5-grade-distributions-design.md`](../specs/2026-08-20-phase-5-grade-distributions-design.md)

## Global Constraints

- **Node.js 20+**, npm. No bun, no pnpm.
- **Suppressed buckets stay `null`.** Never inferred, interpolated, or rendered as `0`. UBC suppresses buckets under 6 students for privacy; a reconstructed value would look exactly as confident as a real one.
- **`<50` is a student COUNT, not a percentage.** Real data shows `54` against `221` reported.
- **Instructor matching is exact-on-normalized-slug only.** Never fuzzy — attributing one professor's grades to a similarly-named person is worse than showing nothing.
- **Co-taught sections get ONE distribution row and N join rows.** Never duplicate the distribution per instructor; that inflates course averages.
- **Attribution is required** on any page showing this data (§2.2 of the spec).
- **Ingest is idempotent** — re-running must not duplicate rows.
- **Empty state is explicit** — no data shows a message, never `0.0`.
- Pure functions (`src/grades/parse-csv.ts`, `src/grades/aggregate.ts`) do no I/O.
- Tests live in `tests/**/*.test.ts`.

---

## Verified data facts

All confirmed by fetching real CSVs during planning — build against these, not assumptions.

**Source URL shape:**
```
https://raw.githubusercontent.com/DonneyF/ubc-pair-grade-data/master/tableau-dashboard-v2/UBCV/<SESSION>/UBCV-<SESSION>-<SUBJECT>.csv
```
Sessions: `2021S 2021W 2022S 2022W 2023S 2023W 2024S 2024W 2025S 2025W`

**Header (exact):**
```
Campus,Year,Session,Subject,Course,Detail,Section,Title,Professor,Reported,Avg,Median,Percentile (25),Percentile (75),High,Low,<50,50-54,55-59,60-63,64-67,68-71,72-75,76-79,80-84,85-89,90-100
```

**Real edge cases observed in `UBCV-2025W-CPSC.csv` (127 data rows):**

| Fact | Evidence |
|---|---|
| Multiple professors per row, `; `-separated | `"Norman Hutchinson; Maryam Raiyat Aliabadi; Ibtissem Bouacheria"` — 7 rows |
| Same pair appears in BOTH orders | `"Thomas Pasquier; Norman Hutchinson"` and `"Prajeet Bajpai; Mathias Lecuyer"` / `"Mathias Lecuyer; Prajeet Bajpai"` — so ordering is meaningless |
| Blank professor | 5 rows |
| Populated `Detail` | 10 rows, values like `A`, `C`, `N`, `Q` |
| Non-numeric section codes | `V01`, `CH1` alongside `101`, `201` |
| `<50` is a count | one row: `Reported=221`, `<50=54` |

**Not observed but must still be handled:** suppressed (blank) grade buckets. Zero
rows in the CPSC and MUSC 2025W samples had them, so the parser's null-handling
**cannot be verified against those files** — the fixture in Task 1 must include a
hand-constructed suppressed row.

---

## File Structure

```
prisma/schema.prisma              — GradeDistribution reshape + join table
src/grades/parse-csv.ts           — PURE: CSV text -> RawGradeRow[]
src/grades/aggregate.ts           — PURE: rows -> course/instructor summaries
src/grades/jobs/ingest.ts         — fetch + match + idempotent upsert
src/grades/jobs/ingest.run.ts     — CLI entrypoint
src/components/GradeChart.tsx     — CSS bar chart
src/app/course/[code]/page.tsx    — MODIFY: distribution section
src/app/professor/[slug]/page.tsx — MODIFY: average section
tests/fixtures/grades-sample.csv  — committed fixture
```

---

### Task 1: Pure CSV parsing

**Files:**
- Create: `src/grades/parse-csv.ts`, `tests/fixtures/grades-sample.csv`
- Test: `tests/parse-grades.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `parseGradeCsv(text: string): RawGradeRow[]`
  - `type RawGradeRow`

- [ ] **Step 1: Build the fixture**

Create `tests/fixtures/grades-sample.csv`. Use the exact real header, then these
rows — the first four are copied verbatim from real data, the last two are
hand-constructed to cover cases the real samples don't contain:

```csv
Campus,Year,Session,Subject,Course,Detail,Section,Title,Professor,Reported,Avg,Median,Percentile (25),Percentile (75),High,Low,<50,50-54,55-59,60-63,64-67,68-71,72-75,76-79,80-84,85-89,90-100
UBCV,2025,W,CPSC,100,,101,Computational Thinking,Firas Moosvi,116,86.4,90.0,84.0,92.0,97,42,3,0,0,1,2,3,0,3,21,22,61
UBCV,2025,W,CPSC,103,,102,Introduction to Systematic Program Design,Meghan Allen,221,69.5,78.0,52.0,86.0,99,0,54,2,4,4,9,12,17,20,31,34,34
UBCV,2025,W,CPSC,310,,201,Introduction to Software Engineering,Thomas Pasquier; Norman Hutchinson,150,75.0,77.0,70.0,82.0,95,40,5,3,4,6,10,14,18,22,28,20,20
UBCV,2025,W,CPSC,448,,101,Directed Studies,,8,88.0,89.0,85.0,92.0,95,80,0,0,0,0,0,0,0,1,2,2,3
UBCV,2025,W,CPSC,449,A,V01,Honours Thesis,Jane Doe,7,,,,,,,,,,,,,,,,
UBCV,2025,W,CPSC,555,,CH1,Small Seminar,Alan Turing; Ada Lovelace,9,91.0,92.0,88.0,94.0,98,85,0,,,,,,,,2,3,4
```

Row 5 is an **entirely suppressed** row (statistics blank). Row 6 has **partially
suppressed** buckets. Neither shape appears in the real CPSC/MUSC samples, so
without these the parser's null handling would be untested.

- [ ] **Step 2: Write the failing tests**

Create `tests/parse-grades.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseGradeCsv } from '@/grades/parse-csv';

const csv = readFileSync('tests/fixtures/grades-sample.csv', 'utf8');
const rows = parseGradeCsv(csv);

describe('parseGradeCsv', () => {
  it('parses every data row, skipping the header', () => {
    expect(rows).toHaveLength(6);
  });

  it('extracts course identity', () => {
    expect(rows[0].subject).toBe('CPSC');
    expect(rows[0].courseNumber).toBe('100');
    expect(rows[0].sectionCode).toBe('101');
    expect(rows[0].year).toBe(2025);
    expect(rows[0].session).toBe('W');
  });

  it('parses statistics as numbers', () => {
    expect(rows[0].average).toBeCloseTo(86.4);
    expect(rows[0].median).toBeCloseTo(90);
    expect(rows[0].high).toBe(97);
    expect(rows[0].low).toBe(42);
    expect(rows[0].reported).toBe(116);
  });

  it('treats <50 as a student count, never a percentage', () => {
    // Real data: 54 students below 50 out of 221 reported.
    const row = rows.find((r) => r.courseNumber === '103')!;
    expect(row.reported).toBe(221);
    expect(row.distribution['<50']).toBe(54);
  });

  it('splits co-taught professors on semicolons', () => {
    const row = rows.find((r) => r.courseNumber === '310')!;
    expect(row.professors).toEqual(['Thomas Pasquier', 'Norman Hutchinson']);
  });

  it('returns an empty professor list for a blank professor field', () => {
    const row = rows.find((r) => r.courseNumber === '448')!;
    expect(row.professors).toEqual([]);
  });

  it('captures Detail as part of section identity', () => {
    const row = rows.find((r) => r.courseNumber === '449')!;
    expect(row.detail).toBe('A');
    expect(row.sectionCode).toBe('V01');
  });

  it('keeps non-numeric section codes intact', () => {
    expect(rows.find((r) => r.courseNumber === '555')!.sectionCode).toBe('CH1');
  });

  it('parses a fully suppressed row as nulls, never zeros', () => {
    const row = rows.find((r) => r.courseNumber === '449')!;
    expect(row.average).toBeNull();
    expect(row.median).toBeNull();
    // A suppressed bucket is unknown, NOT zero — collapsing it would invent data.
    expect(row.distribution['<50']).toBeNull();
  });

  it('parses partially suppressed buckets as null while keeping present ones', () => {
    const row = rows.find((r) => r.courseNumber === '555')!;
    expect(row.average).toBeCloseTo(91);
    expect(row.distribution['<50']).toBe(0);
    expect(row.distribution['50-54']).toBeNull();
    expect(row.distribution['90-100']).toBe(4);
  });

  it('returns an empty array for header-only input', () => {
    const header = csv.split('\n')[0];
    expect(parseGradeCsv(header)).toEqual([]);
  });

  it('tolerates a trailing newline', () => {
    expect(parseGradeCsv(`${csv}\n`)).toHaveLength(6);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- parse-grades`
Expected: FAIL — cannot resolve `@/grades/parse-csv`.

- [ ] **Step 4: Implement**

Create `src/grades/parse-csv.ts`:

```ts
export const GRADE_BUCKETS = [
  '<50', '50-54', '55-59', '60-63', '64-67', '68-71',
  '72-75', '76-79', '80-84', '85-89', '90-100',
] as const;

export type GradeBucket = (typeof GRADE_BUCKETS)[number];

export type RawGradeRow = {
  campus: string;
  year: number;
  session: string;
  subject: string;
  courseNumber: string;
  detail: string | null;
  sectionCode: string;
  title: string;
  professors: string[];
  reported: number | null;
  average: number | null;
  median: number | null;
  high: number | null;
  low: number | null;
  /** Suppressed buckets stay null — never coerced to 0 (spec 6). */
  distribution: Record<GradeBucket, number | null>;
};

/** Blank means suppressed or unavailable — null, never 0. */
function num(value: string | undefined): number | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(value: string | undefined): string {
  return (value ?? '').trim();
}

/**
 * Minimal CSV split. This source has no quoted fields or embedded commas —
 * verified against real files — so a full CSV parser would be a dependency
 * bought for nothing.
 */
function splitLine(line: string): string[] {
  return line.split(',');
}

export function parseGradeCsv(text: string): RawGradeRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = splitLine(lines[0]).map((h) => h.trim());
  const index = (name: string) => header.indexOf(name);

  const iYear = index('Year');
  const iSession = index('Session');
  const iSubject = index('Subject');
  const iCourse = index('Course');
  const iDetail = index('Detail');
  const iSection = index('Section');
  const iTitle = index('Title');
  const iProf = index('Professor');
  const iReported = index('Reported');
  const iAvg = index('Avg');
  const iMedian = index('Median');
  const iHigh = index('High');
  const iLow = index('Low');
  const bucketIndex = GRADE_BUCKETS.map((b) => index(b));

  const rows: RawGradeRow[] = [];

  for (const line of lines.slice(1)) {
    const c = splitLine(line);
    const courseNumber = str(c[iCourse]);
    if (!courseNumber) continue;

    const distribution = {} as Record<GradeBucket, number | null>;
    GRADE_BUCKETS.forEach((bucket, i) => {
      distribution[bucket] = num(c[bucketIndex[i]]);
    });

    rows.push({
      campus: str(c[index('Campus')]),
      year: Number(str(c[iYear])),
      session: str(c[iSession]),
      subject: str(c[iSubject]),
      courseNumber,
      detail: str(c[iDetail]) || null,
      sectionCode: str(c[iSection]),
      title: str(c[iTitle]),
      // Co-taught sections list several names; blank means none (spec 5).
      professors: str(c[iProf])
        .split(';')
        .map((p) => p.trim())
        .filter(Boolean),
      reported: num(c[iReported]),
      average: num(c[iAvg]),
      median: num(c[iMedian]),
      high: num(c[iHigh]),
      low: num(c[iLow]),
      distribution,
    });
  }

  return rows;
}
```

- [ ] **Step 5: Verify and commit**

Run `npm test -- parse-grades` (PASS, 12 tests), then `npm test` and `npx tsc --noEmit`.

Confirm purity:
```bash
grep -nE "fetch|prisma|@/lib/db|readFile|require\(" src/grades/parse-csv.ts
```
Expected: no output.

```bash
git add src/grades/parse-csv.ts tests/parse-grades.test.ts tests/fixtures/grades-sample.csv
git commit -m "feat: parse UBC PAIR grade distribution CSVs"
```

---

### Task 2: Schema

**Files:**
- Modify: `prisma/schema.prisma`

**Migration environment note:** `npx prisma migrate dev` refuses to run in this
non-interactive shell (Prisma 7 blocks it outside a TTY). Phases 2-4 all used this
working sequence — reuse it exactly:

```bash
npx prisma migrate diff --from-config-datasource prisma.config.ts \
  --to-schema prisma/schema.prisma --script
```

Inspect the SQL, hand-place it under `prisma/migrations/<timestamp>_<name>/migration.sql`,
run `npx prisma migrate deploy`, then `npx prisma generate`, then verify with
`npx prisma migrate status` (must report no drift).

- [ ] **Step 1: Confirm the table is empty before reshaping**

`GradeDistribution` is a Phase 1 stub nothing has ever written to. Prove it:

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select count(*) from \"GradeDistribution\";"
```

Must be `0`. If not, STOP and report — dropping `instructorId` would then lose data.

- [ ] **Step 2: Reshape the model**

In `prisma/schema.prisma`, replace `model GradeDistribution` with:

**`termId` and `detail` are NOT NULL here, deliberately.** Prisma refuses a nullable
field inside a compound-key `where` clause — the exact problem Phase 3 hit with
`InstructorReview.courseId` and solved the same way. Since both participate in the
unique key, a nullable version would make Task 4's `upsert` fail to compile.

`detail` uses `""` for "no detail" and `termId` uses `""` for "no matching term in
our catalogue". A sentinel empty string is used rather than null precisely so the
compound key stays usable.

```prisma
model GradeDistribution {
  id           String  @id @default(cuid())
  courseId     String
  course       Course  @relation(fields: [courseId], references: [id], onDelete: Cascade)
  /** "" when no term in our catalogue matches — see note above. */
  termId       String  @default("")
  sectionCode  String
  /** "" when the source's Detail column is blank — see note above. */
  detail       String  @default("")
  average      Float?
  median       Float?
  high         Float?
  low          Float?
  count        Int?
  distribution Json?

  instructors GradeDistributionInstructor[]

  @@unique([courseId, termId, sectionCode, detail])
  @@index([courseId])
}

// A section has ONE distribution but may be CO-TAUGHT — verified in real data
// (7 of 127 CPSC 2025W rows list several professors). Duplicating the
// distribution per instructor would inflate every course average.
model GradeDistributionInstructor {
  distributionId String
  distribution   GradeDistribution @relation(fields: [distributionId], references: [id], onDelete: Cascade)
  instructorId   String
  instructor     Instructor        @relation(fields: [instructorId], references: [id], onDelete: Cascade)

  @@id([distributionId, instructorId])
  @@index([instructorId])
}
```

Add the back-relations. On `model Course`:

```prisma
  gradeDistributions GradeDistribution[]
```

On `model Instructor`:

```prisma
  gradeDistributions GradeDistributionInstructor[]
```

- [ ] **Step 3: Generate, inspect, apply**

Follow the sequence above. Expect: drop `instructorId` from `GradeDistribution`, add
`sectionCode`/`detail`, add the unique index and the FK to `Course`, create
`GradeDistributionInstructor`. If the SQL contains a `DROP TABLE` on anything other
than nothing, or touches an unrelated model, STOP and report.

- [ ] **Step 4: Verify**

```bash
npx prisma migrate status
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c "\d \"GradeDistribution\""
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c "\d \"GradeDistributionInstructor\""
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select (select count(*) from \"Course\") courses, (select count(*) from \"Section\") sections, (select count(*) from \"Instructor\") instructors;"
```

No drift; both tables correct; Course/Section/Instructor counts unchanged.

Then `npx tsc --noEmit` and `npm test` — both clean.

- [ ] **Step 5: Commit**

```bash
git add prisma
git commit -m "feat: reshape grade distributions for co-taught sections"
```

---

### Task 3: Pure aggregation

**Files:**
- Create: `src/grades/aggregate.ts`
- Test: `tests/grades-aggregate.test.ts`

**Interfaces:**
- Consumes: `GRADE_BUCKETS`, `GradeBucket` from `@/grades/parse-csv`
- Produces:
  - `aggregateDistributions(rows): GradeSummary`
  - `type GradeSummary`, `type DistributionRow`

**Weighting matters.** A 300-student lecture and a 9-student seminar must not
count equally toward a course average — weight by `count` (students reported).

- [ ] **Step 1: Write the failing tests**

Create `tests/grades-aggregate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { aggregateDistributions, type DistributionRow } from '@/grades/aggregate';

const row = (
  average: number | null,
  count: number | null,
  distribution: Record<string, number | null> = {},
): DistributionRow => ({ average, count, distribution });

describe('aggregateDistributions', () => {
  it('returns an empty summary for no rows', () => {
    const s = aggregateDistributions([]);
    expect(s.sectionCount).toBe(0);
    expect(s.studentCount).toBe(0);
    // Never 0.0 — that would read as everyone failing (spec 7).
    expect(s.average).toBeNull();
  });

  it('weights the average by student count, not by section', () => {
    // 300 students at 80 and 10 students at 50 -> much closer to 80 than 65.
    const s = aggregateDistributions([row(80, 300), row(50, 10)]);
    expect(s.average).toBeCloseTo((80 * 300 + 50 * 10) / 310, 4);
    expect(s.sectionCount).toBe(2);
    expect(s.studentCount).toBe(310);
  });

  it('ignores rows with a suppressed average', () => {
    const s = aggregateDistributions([row(80, 100), row(null, 20)]);
    expect(s.average).toBeCloseTo(80);
  });

  it('ignores rows with no student count rather than assuming one', () => {
    const s = aggregateDistributions([row(80, 100), row(60, null)]);
    expect(s.average).toBeCloseTo(80);
  });

  it('sums buckets across sections, skipping suppressed values', () => {
    const s = aggregateDistributions([
      row(80, 10, { '<50': 1, '90-100': 5 }),
      row(80, 10, { '<50': null, '90-100': 3 }),
    ]);
    expect(s.distribution['<50']).toBe(1);
    expect(s.distribution['90-100']).toBe(8);
  });

  it('reports a bucket as null only when every section suppressed it', () => {
    const s = aggregateDistributions([
      row(80, 10, { '50-54': null }),
      row(80, 10, { '50-54': null }),
    ]);
    expect(s.distribution['50-54']).toBeNull();
  });

  it('flags when any section had suppressed buckets', () => {
    expect(aggregateDistributions([row(80, 10, { '<50': 1 })]).suppressed).toBe(false);
    expect(aggregateDistributions([row(80, 10, { '<50': null })]).suppressed).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Run: `npm test -- grades-aggregate` (FAIL — module missing).

Create `src/grades/aggregate.ts`:

```ts
import { GRADE_BUCKETS, type GradeBucket } from '@/grades/parse-csv';

export type DistributionRow = {
  average: number | null;
  count: number | null;
  distribution: Record<string, number | null> | null;
};

export type GradeSummary = {
  sectionCount: number;
  studentCount: number;
  average: number | null;
  distribution: Record<GradeBucket, number | null>;
  /** True when at least one section had a suppressed bucket (spec 6). */
  suppressed: boolean;
};

export function aggregateDistributions(rows: DistributionRow[]): GradeSummary {
  let weighted = 0;
  let weight = 0;
  let studentCount = 0;
  let suppressed = false;

  const distribution = {} as Record<GradeBucket, number | null>;
  for (const bucket of GRADE_BUCKETS) distribution[bucket] = null;

  for (const r of rows) {
    if (r.count !== null && r.count !== undefined) studentCount += r.count;

    // A suppressed average carries no information — skip rather than treat as 0.
    if (r.average !== null && r.count !== null && r.count !== undefined) {
      weighted += r.average * r.count;
      weight += r.count;
    }

    for (const bucket of GRADE_BUCKETS) {
      const value = r.distribution?.[bucket] ?? null;
      if (value === null) {
        suppressed = true;
        continue;
      }
      distribution[bucket] = (distribution[bucket] ?? 0) + value;
    }
  }

  return {
    sectionCount: rows.length,
    studentCount,
    // Weighted by students: a 300-person lecture must outweigh a 9-person seminar.
    average: weight > 0 ? weighted / weight : null,
    distribution,
    suppressed,
  };
}
```

- [ ] **Step 3: Verify and commit**

Run `npm test -- grades-aggregate` (PASS, 7 tests), then `npm test` and
`npx tsc --noEmit`. Confirm purity:

```bash
grep -nE "fetch|prisma|@/lib/db|readFile|require\(" src/grades/aggregate.ts
```

```bash
git add src/grades/aggregate.ts tests/grades-aggregate.test.ts
git commit -m "feat: aggregate grade distributions weighted by enrolment"
```

---

### Task 4: Ingest job

**Files:**
- Create: `src/grades/jobs/ingest.ts`, `src/grades/jobs/ingest.run.ts`
- Test: `tests/grades-ingest.test.ts`
- Modify: `package.json` (script)

**Interfaces:**
- Consumes: `parseGradeCsv`, `fetchText` (`@/scrape/http`), `normalizeInstructorName` (`@/scrape/names`), `db`
- Produces:
  - `gradeCsvUrl(session: string, subject: string): string`
  - `ingestRows(rows: RawGradeRow[]): Promise<IngestResult>`
  - `type IngestResult = { written: number; skippedNoCourse: number; unmatchedProfessors: string[] }`
  - `npm run ingest:grades`

**Matching rules (spec §5):** split professors on `;`, normalize each via Phase 1's
`normalizeInstructorName`, match exactly on `Instructor.slug`. Unmatched or blank
professors still ingest the distribution — with no join rows — and are reported.

- [ ] **Step 1: Write the failing tests**

Create `tests/grades-ingest.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { gradeCsvUrl, ingestRows } from '@/grades/jobs/ingest';
import type { RawGradeRow } from '@/grades/parse-csv';

let courseId: string;
let subjectCode: string;
let courseNumber: string;
let instructorSlug: string;
let instructorName: string;

beforeAll(async () => {
  const course = await db.course.findFirstOrThrow({
    where: { subject: { code: { not: null } } },
    include: { subject: true },
  });
  courseId = course.id;
  subjectCode = course.subject.code!;
  courseNumber = course.number;

  const instructor = await db.instructor.findFirstOrThrow();
  instructorSlug = instructor.slug;
  instructorName = instructor.name;

  await db.gradeDistribution.deleteMany({ where: { courseId } });
});

afterAll(async () => {
  await db.gradeDistribution.deleteMany({ where: { courseId } });
  await db.$disconnect();
});

function makeRow(over: Partial<RawGradeRow> = {}): RawGradeRow {
  return {
    campus: 'UBCV',
    year: 2025,
    session: 'W',
    subject: subjectCode,
    courseNumber,
    detail: null,
    sectionCode: '101',
    title: 'Test',
    professors: [],
    reported: 100,
    average: 75,
    median: 76,
    high: 99,
    low: 40,
    distribution: { '<50': 5 } as RawGradeRow['distribution'],
    ...over,
  };
}

describe('gradeCsvUrl', () => {
  it('builds the verified upstream path', () => {
    expect(gradeCsvUrl('2025W', 'CPSC')).toBe(
      'https://raw.githubusercontent.com/DonneyF/ubc-pair-grade-data/master/tableau-dashboard-v2/UBCV/2025W/UBCV-2025W-CPSC.csv',
    );
  });
});

describe('ingestRows', () => {
  it('writes a distribution for a known course', async () => {
    const r = await ingestRows([makeRow()]);
    expect(r.written).toBe(1);
    expect(await db.gradeDistribution.count({ where: { courseId } })).toBe(1);
  });

  it('is idempotent — re-ingesting updates rather than duplicating', async () => {
    await ingestRows([makeRow({ average: 80 })]);
    const found = await db.gradeDistribution.findMany({ where: { courseId } });
    expect(found).toHaveLength(1);
    expect(found[0].average).toBeCloseTo(80);
  });

  it('treats Detail as part of section identity', async () => {
    await ingestRows([makeRow({ detail: 'A' })]);
    // Same section code, different detail -> a distinct row, not an overwrite.
    expect(await db.gradeDistribution.count({ where: { courseId } })).toBe(2);
  });

  it('skips rows whose course is not in our catalogue, and counts them', async () => {
    const r = await ingestRows([makeRow({ subject: 'ZZNOPE', courseNumber: '999' })]);
    expect(r.written).toBe(0);
    expect(r.skippedNoCourse).toBe(1);
  });

  it('links a matching professor', async () => {
    await ingestRows([makeRow({ sectionCode: '900', professors: [instructorName] })]);
    const row = await db.gradeDistribution.findFirstOrThrow({
      where: { courseId, sectionCode: '900' },
      include: { instructors: true },
    });
    expect(row.instructors).toHaveLength(1);
  });

  it('links EVERY professor of a co-taught section', async () => {
    const r = await ingestRows([
      makeRow({ sectionCode: '901', professors: [instructorName, 'Nobody McNobody'] }),
    ]);
    const row = await db.gradeDistribution.findFirstOrThrow({
      where: { courseId, sectionCode: '901' },
      include: { instructors: true },
    });
    // One matched, one didn't — the distribution is still written once.
    expect(row.instructors).toHaveLength(1);
    expect(r.unmatchedProfessors).toContain('Nobody McNobody');
  });

  it('still writes the distribution when no professor matches', async () => {
    const r = await ingestRows([
      makeRow({ sectionCode: '902', professors: ['Totally Unknown Person'] }),
    ]);
    expect(r.written).toBe(1);
    const row = await db.gradeDistribution.findFirstOrThrow({
      where: { courseId, sectionCode: '902' },
      include: { instructors: true },
    });
    expect(row.instructors).toHaveLength(0);
  });

  it('stores suppressed buckets as null, not zero', async () => {
    await ingestRows([
      makeRow({
        sectionCode: '903',
        distribution: { '<50': null, '90-100': 4 } as RawGradeRow['distribution'],
      }),
    ]);
    const row = await db.gradeDistribution.findFirstOrThrow({
      where: { courseId, sectionCode: '903' },
    });
    const dist = row.distribution as Record<string, number | null>;
    expect(dist['<50']).toBeNull();
    expect(dist['90-100']).toBe(4);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Run: `npm test -- grades-ingest` (FAIL — module missing).

Create `src/grades/jobs/ingest.ts`:

```ts
import { db } from '@/lib/db';
import { fetchText } from '@/scrape/http';
import { normalizeInstructorName } from '@/scrape/names';
import { parseGradeCsv, type RawGradeRow } from '@/grades/parse-csv';

const BASE =
  'https://raw.githubusercontent.com/DonneyF/ubc-pair-grade-data/master/tableau-dashboard-v2/UBCV';

/** Sessions available in the current format — verified 2026-08-20. */
export const SESSIONS = [
  '2021S', '2021W', '2022S', '2022W', '2023S',
  '2023W', '2024S', '2024W', '2025S', '2025W',
] as const;

export function gradeCsvUrl(session: string, subject: string): string {
  return `${BASE}/${session}/UBCV-${session}-${subject}.csv`;
}

export type IngestResult = {
  written: number;
  skippedNoCourse: number;
  unmatchedProfessors: string[];
};

export async function ingestRows(rows: RawGradeRow[]): Promise<IngestResult> {
  let written = 0;
  let skippedNoCourse = 0;
  const unmatched = new Set<string>();

  for (const row of rows) {
    const course = await db.course.findFirst({
      where: {
        number: row.courseNumber,
        subject: { code: row.subject, campus: 'V' },
      },
      select: { id: true },
    });

    // Reported, never silently dropped — a gap here means our catalogue is
    // missing something, which is worth knowing.
    if (!course) {
      skippedNoCourse += 1;
      continue;
    }

    const term = await db.term.findFirst({
      where: { year: row.year, session: row.session, campus: 'V' },
      select: { id: true },
    });

    const distribution = await db.gradeDistribution.upsert({
      where: {
        // "" sentinels, not null: Prisma rejects nullable fields in a
        // compound-key where clause (same constraint Phase 3 hit).
        courseId_termId_sectionCode_detail: {
          courseId: course.id,
          termId: term?.id ?? '',
          sectionCode: row.sectionCode,
          detail: row.detail ?? '',
        },
      },
      create: {
        courseId: course.id,
        termId: term?.id ?? '',
        sectionCode: row.sectionCode,
        detail: row.detail ?? '',
        average: row.average,
        median: row.median,
        high: row.high,
        low: row.low,
        count: row.reported,
        distribution: row.distribution,
      },
      update: {
        average: row.average,
        median: row.median,
        high: row.high,
        low: row.low,
        count: row.reported,
        distribution: row.distribution,
      },
      select: { id: true },
    });
    written += 1;

    // Replace links wholesale so a corrected upstream professor list doesn't
    // leave a stale attribution behind.
    await db.gradeDistributionInstructor.deleteMany({
      where: { distributionId: distribution.id },
    });

    for (const raw of row.professors) {
      const { slug } = normalizeInstructorName(raw);
      if (!slug) continue;

      const instructor = await db.instructor.findUnique({
        where: { slug },
        select: { id: true },
      });

      // Exact match only. Attaching one professor's grades to a similarly
      // named person is worse than showing no attribution (spec 5).
      if (!instructor) {
        unmatched.add(raw);
        continue;
      }

      await db.gradeDistributionInstructor.create({
        data: { distributionId: distribution.id, instructorId: instructor.id },
      });
    }
  }

  return { written, skippedNoCourse, unmatchedProfessors: [...unmatched] };
}

export async function ingestGrades() {
  const subjects = await db.subject.findMany({
    where: { campus: 'V', code: { not: null } },
    select: { code: true },
  });

  let written = 0;
  let skipped = 0;
  const unmatched = new Set<string>();

  for (const session of SESSIONS) {
    for (const { code } of subjects) {
      let csv: string;
      try {
        csv = await fetchText(gradeCsvUrl(session, code!));
      } catch {
        // Not every subject exists in every session — a 404 is normal here.
        continue;
      }

      const result = await ingestRows(parseGradeCsv(csv));
      written += result.written;
      skipped += result.skippedNoCourse;
      result.unmatchedProfessors.forEach((p) => unmatched.add(p));
    }
    console.log(`${session}: ${written} rows so far`);
  }

  console.log(
    `Done. ${written} distributions, ${skipped} rows skipped (course not in catalogue), ` +
      `${unmatched.size} professor names unmatched.`,
  );
}
```

Create `src/grades/jobs/ingest.run.ts` following the existing `*.run.ts` pattern
(read `src/scrape/jobs/sections.run.ts` and match it):

```ts
import { db } from '@/lib/db';
import { ingestGrades } from '@/grades/jobs/ingest';

ingestGrades()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
```

Add to `package.json` scripts:

```json
"ingest:grades": "tsx src/grades/jobs/ingest.run.ts"
```

- [ ] **Step 3: Verify against tests**

Run `npm test -- grades-ingest` (PASS, 9 tests), `npm test`, `npx tsc --noEmit`.

- [ ] **Step 4: Run a REAL limited ingest**

Do not run the full job yet — it fetches ~2,300 URLs at 1 req/sec. First prove one
subject works end to end:

```bash
npx tsx -e "
import { db } from './src/lib/db';
import { fetchText } from './src/scrape/http';
import { parseGradeCsv } from './src/grades/parse-csv';
import { gradeCsvUrl, ingestRows } from './src/grades/jobs/ingest';
(async () => {
  const csv = await fetchText(gradeCsvUrl('2025W', 'CPSC'));
  const rows = parseGradeCsv(csv);
  console.log('parsed rows:', rows.length);
  console.log(await ingestRows(rows));
  await db.\$disconnect();
})();
"
```

Expect ~127 parsed rows and a non-zero `written`. Then spot-check real data:

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c "
select c.number, g.\"sectionCode\", g.average, g.count
from \"GradeDistribution\" g
join \"Course\" c on c.id = g.\"courseId\"
join \"Subject\" s on s.id = c.\"subjectId\"
where s.code = 'CPSC' order by c.number limit 10;"
```

Confirm the averages look like real grades (60-90 range), not zeros or nulls.

- [ ] **Step 5: Commit**

```bash
git add src/grades/jobs tests/grades-ingest.test.ts package.json
git commit -m "feat: ingest grade distributions with co-taught attribution"
```

---

### Task 5: Display

**Files:**
- Create: `src/components/GradeChart.tsx`
- Modify: `src/app/course/[code]/page.tsx`, `src/app/professor/[slug]/page.tsx`

**Interfaces:**
- Consumes: `aggregateDistributions` (Task 3), `GRADE_BUCKETS` (Task 1), `db`

**Requirements:**
- **Course page**: weighted average across all its distributions, the bar chart, the
  student/section counts, and the source credit.
- **Professor page**: their weighted average across everything they taught, joined
  through `GradeDistributionInstructor`, plus the source credit.
- **Empty state**: no data shows an explicit message, never `0.0`.
- **Suppression notice**: when `summary.suppressed` is true, state that some buckets
  were withheld by UBC for privacy — do not silently show a partial chart as if complete.
- **Attribution** (spec §2.2): both pages credit and link
  `https://github.com/DonneyF/ubc-pair-grade-data`.
- Hand-rolled CSS bars. No chart library.

- [ ] **Step 1: Build the chart component**

Create `src/components/GradeChart.tsx`. A server component taking
`distribution: Record<string, number | null>`; render one bar per bucket in
`GRADE_BUCKETS` order, height proportional to the max non-null value. A suppressed
bucket renders visibly distinct from a zero bucket (e.g. a hatched/greyed stub with
a `title` explaining it was withheld) — **the two must not look identical**, since
that is the whole point of keeping nulls.

Match existing style: `border`, `slate` text, `bg-blue-700` for bars.

- [ ] **Step 2: Add to the course page**

In `src/app/course/[code]/page.tsx`, fetch and aggregate:

```ts
  const gradeRows = await db.gradeDistribution.findMany({
    where: { courseId: course.id },
    select: { average: true, count: true, distribution: true },
  });
  const grades = aggregateDistributions(
    gradeRows.map((g) => ({
      average: g.average,
      count: g.count,
      distribution: g.distribution as Record<string, number | null> | null,
    })),
  );
```

Render a "Grades" section after Ratings: the average to one decimal, the counts, the
chart, the suppression notice when applicable, and the credit line.

- [ ] **Step 3: Add to the professor page**

In `src/app/professor/[slug]/page.tsx`, query through the join table:

```ts
  const gradeRows = await db.gradeDistribution.findMany({
    where: { instructors: { some: { instructorId: instructor.id } } },
    select: { average: true, count: true, distribution: true },
  });
```

Aggregate identically and render their average, counts, chart, and credit.

- [ ] **Step 4: Verify live**

Start the dev server. Using the CPSC data ingested in Task 4:

1. Open a CPSC course page with data — confirm a real average (not `0.0`), a chart,
   and the credit line.
2. Open a CPSC course with **no** grade data — confirm the explicit empty state.
3. Open a professor who taught a CPSC course — confirm their average appears.
4. Confirm a co-taught section's grades appear on **both** professors' pages.
5. If any ingested section had suppressed buckets, confirm the notice appears and the
   suppressed bar is visually distinct from a zero bar.

Stop the dev server.

- [ ] **Step 5: Full verification and commit**

Run `npm test`, `npx tsc --noEmit`, `npx eslint .`, `npm run build` — all clean.

```bash
git add src/components/GradeChart.tsx "src/app/course/[code]/page.tsx" "src/app/professor/[slug]/page.tsx"
git commit -m "feat: show grade distributions on course and professor pages"
```

---

### Task 6: Full ingest

**Files:** none — this task runs the job and verifies the result.

The full ingest fetches up to 10 sessions × ~230 subjects at 1 request/second. Many
combinations 404 (not every subject runs every session), but expect **roughly 40-60
minutes**. This is expected, not a hang.

- [ ] **Step 1: Record the before state**

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select (select count(*) from \"GradeDistribution\") dists, (select count(*) from \"GradeDistributionInstructor\") links, (select count(*) from \"Course\") courses;"
```

- [ ] **Step 2: Run it**

```bash
npm run ingest:grades
```

Let it finish. Do not raise the rate limit — this is someone else's GitHub repo.

- [ ] **Step 3: Verify the result**

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select (select count(*) from \"GradeDistribution\") dists, (select count(*) from \"GradeDistributionInstructor\") links, (select count(*) from \"Course\") courses;"
```

Confirm: distributions in the tens of thousands, a substantial number of instructor
links, and **`Course` count unchanged** (ingest must never create catalogue rows).

Sanity-check the values are real grades:

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select min(average), max(average), avg(average), count(*) from \"GradeDistribution\" where average is not null;"
```

Min should be plausible (not 0), max ≤ 100, mean somewhere in the 70s-80s.

- [ ] **Step 4: Prove idempotency on real data**

Re-run one subject and confirm no new rows appear:

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -tAc "select count(*) from \"GradeDistribution\";"
npx tsx -e "
import { db } from './src/lib/db';
import { fetchText } from './src/scrape/http';
import { parseGradeCsv } from './src/grades/parse-csv';
import { gradeCsvUrl, ingestRows } from './src/grades/jobs/ingest';
(async () => {
  const csv = await fetchText(gradeCsvUrl('2025W', 'CPSC'));
  console.log(await ingestRows(parseGradeCsv(csv)));
  await db.\$disconnect();
})();
"
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -tAc "select count(*) from \"GradeDistribution\";"
```

The two counts must be identical.

- [ ] **Step 5: Confirm the pages work with full data**

Start the dev server, open several course and professor pages across different
subjects, confirm charts and averages render correctly. Stop the server.

---

## Phase 5 completion criteria

- [ ] `npm test`, `npx tsc --noEmit`, `npx eslint .`, `npm run build` all clean
- [ ] Suppressed buckets are stored and rendered as **null/withheld**, never `0`
- [ ] `<50` is treated as a student count everywhere
- [ ] Co-taught sections produce one distribution and links to every matched professor
- [ ] Unmatched professors are reported, and their distribution still ingests
- [ ] Re-running ingest does not duplicate rows
- [ ] Course averages are weighted by enrolment, not by section
- [ ] Course and professor pages both show data and both credit the source
- [ ] Courses/professors with no data show an explicit message, never `0.0`
