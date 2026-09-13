# UBC Flow Phase 2: Accounts + Workday Import - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student can create an account, upload their Workday exports, and end up verified with an accurate record of every course they have taken or are taking - no grades stored, one student unable to verify two accounts.

**Architecture:** Continues Phase 1's Next.js + Prisma monolith. Auth.js v5 with a Credentials provider handles sessions. Workday `.xlsx` parsing follows Phase 1's proven shape: one thin I/O boundary that turns an uploaded buffer into a `string[][]` grid, then **pure functions** over that grid, so the whole parser is testable offline against committed fixtures.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Prisma 7 (driver adapter), Postgres, Auth.js v5 (`next-auth@beta`), `bcryptjs`, `exceljs`, Vitest.

**Spec:** [`docs/superpowers/specs/2026-08-19-phase-2-accounts-workday-import-design.md`](../specs/2026-08-19-phase-2-accounts-workday-import-design.md)

## Global Constraints

- **Node.js 20+**, npm. No bun, no pnpm.
- **Never store**: grades, GPA, academic standing, raw student number, or the uploaded file itself. Parse in memory; never write an upload to disk; never log its contents.
- **Never request, transmit, store, or proxy CWL credentials.** No exceptions, any phase.
- **Email is not domain-restricted.** Any provider is valid. Email is an account identifier, not proof of studenthood.
- **Hard review gate**: no parsed enrollment → no reviewing. A user may only review courses in their own enrollment record.
- **Transfer credit never grants review rights.** Rows with grade `TR` or a non-empty Originating Coursework column are parsed and reported but never written as enrollment.
- **In-progress `Registered` courses do grant review rights.**
- **Student identity is HMAC-SHA256 keyed with `SERVER_SECRET`**, never a bare hash, never the raw number.
- **Parsers are pure**: no I/O, no network, no Prisma, no `fs`. The single I/O boundary is `readWorkbookGrid`.
- Secrets (`SERVER_SECRET`, `AUTH_SECRET`, `DATABASE_URL`) live in env only. Never committed.
- Course codes arrive as `CPSC_V 110`. **Reuse Phase 1's `parseUbcCourseCode`** from `@/scrape/parse-nodes`; do not write a second course-code parser.

---

## Plan-level decisions

Two deviations from the spec's §6/§7, both forced by how Auth.js v5 actually works. Recorded here rather than silently applied.

**1. JWT sessions, and therefore no Auth.js adapter tables.** Auth.js v5's
Credentials provider only supports the `jwt` session strategy - database
sessions are unsupported with credentials. So `Account` and `Session` tables are
**not** created. The spec's §7 line listing them is superseded by this. We add a
small `VerificationToken` model of our own for email verification.

**2. Email delivery is pluggable and defaults to console.** Sending real mail
needs a provider (Resend/SES/etc.) that is a deployment decision, not an
implementation one. Task 5 defines a one-function `sendMail` interface whose dev
implementation logs the link to stdout. Nothing else in the phase depends on
which provider is eventually chosen.

**3. `Enrollment.source` is `'workday'`, not the spec's split
`'workday_current'` / `'workday_record'`.** Both exports run through one parser
and produce identical enrollment rows, so the distinction would record which
file a row happened to arrive in - not a property of the enrollment. Phase 4
needs *current-term* registration, which is derivable from the term dates it
already has. Superseding the spec's §7 note. Revisit only if a consumer
genuinely needs the provenance.

---

## File Structure

```
prisma/schema.prisma                  - + studentIdHash, verifiedAt, VerificationToken
src/lib/auth.ts                       - Auth.js config, handlers, `auth()` helper
src/lib/hash.ts                       - PURE: HMAC of student number, password hash/verify
src/lib/mail.ts                       - sendMail interface + console dev impl
src/lib/gate.ts                       - canReview(userId, courseId) - the review gate
src/upload/read-grid.ts               - I/O BOUNDARY: xlsx buffer -> string[][]
src/upload/parse-workday.ts           - PURE: grid -> ParsedExport
src/upload/import.ts                  - matching + Enrollment upserts
src/app/(auth)/signup/page.tsx        - signup form
src/app/(auth)/login/page.tsx         - login form
src/app/(auth)/verify/page.tsx        - email verification landing
src/app/onboarding/page.tsx           - guided upload + preview
src/app/api/auth/[...nextauth]/route.ts
src/app/api/upload/route.ts           - upload handler
tests/fixtures/workday-*.xlsx         - REDACTED fixtures (fabricated identifiers)
tests/*.test.ts
```

---

### Task 1: Schema, secrets, and hashing primitives

**Files:**
- Modify: `prisma/schema.prisma`, `.env`, `.env.example`
- Create: `src/lib/hash.ts`
- Test: `tests/hash.test.ts`

**Interfaces:**
- Consumes: `db` from `@/lib/db` (Phase 1)
- Produces:
  - `hashStudentNumber(raw: string): string` - HMAC-SHA256 hex, keyed by `SERVER_SECRET`
  - `hashPassword(plain: string): Promise<string>`
  - `verifyPassword(plain: string, hash: string): Promise<boolean>`
  - `User.studentIdHash`, `User.verifiedAt`, `model VerificationToken`

- [ ] **Step 1: Install dependencies**

```bash
npm install bcryptjs
npm install -D @types/bcryptjs
```

- [ ] **Step 2: Add secrets to env**

Append to `.env` (git-ignored - verify with `git check-ignore .env`):

```
SERVER_SECRET="<paste output of: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\">"
AUTH_SECRET="<paste a second, different 32-byte hex value from the same command>"
```

Append the same two keys to `.env.example` with placeholder values:

```
SERVER_SECRET="generate-with-openssl-rand-hex-32"
AUTH_SECRET="generate-with-openssl-rand-hex-32"
```

- [ ] **Step 3: Extend the schema**

In `prisma/schema.prisma`, add two fields to `model User` (keep all existing fields):

```prisma
  studentIdHash String?   @unique
  verifiedAt    DateTime?
```

And add a new model at the end of the file:

```prisma
model VerificationToken {
  id        String   @id @default(cuid())
  token     String   @unique
  userId    String
  expiresAt DateTime
  createdAt DateTime @default(now())

  @@index([userId])
}
```

- [ ] **Step 4: Run the migration**

```bash
npx prisma migrate dev --name add_auth_fields
```

Expected: applies cleanly, purely additive. Verify:

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c "\d \"User\"" 
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c "\d \"VerificationToken\""
```

Confirm `studentIdHash` and `verifiedAt` exist on `User`, and that existing row counts are unchanged:

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c "select (select count(*) from \"Course\") courses, (select count(*) from \"Section\") sections;"
```

- [ ] **Step 5: Write the failing hashing tests**

Create `tests/hash.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { hashStudentNumber, hashPassword, verifyPassword } from '@/lib/hash';

beforeAll(() => {
  process.env.SERVER_SECRET ??= 'test-secret-do-not-use-in-production';
});

describe('hashStudentNumber', () => {
  it('is deterministic for the same input', () => {
    expect(hashStudentNumber('12345678')).toBe(hashStudentNumber('12345678'));
  });

  it('differs for different students', () => {
    expect(hashStudentNumber('12345678')).not.toBe(hashStudentNumber('87654321'));
  });

  it('never returns the raw number', () => {
    expect(hashStudentNumber('12345678')).not.toContain('12345678');
  });

  it('produces a 64-char hex digest', () => {
    expect(hashStudentNumber('12345678')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is keyed - a different secret yields a different digest', () => {
    const a = hashStudentNumber('12345678');
    const prev = process.env.SERVER_SECRET;
    process.env.SERVER_SECRET = 'a-different-secret';
    const b = hashStudentNumber('12345678');
    process.env.SERVER_SECRET = prev;
    expect(a).not.toBe(b);
  });

  it('throws when SERVER_SECRET is absent rather than hashing unkeyed', () => {
    const prev = process.env.SERVER_SECRET;
    delete process.env.SERVER_SECRET;
    expect(() => hashStudentNumber('12345678')).toThrow(/SERVER_SECRET/);
    process.env.SERVER_SECRET = prev;
  });
});

describe('passwords', () => {
  it('verifies a correct password', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', h)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('wrong password', h)).toBe(false);
  });

  it('never stores the plaintext in the hash', async () => {
    const h = await hashPassword('hunter2');
    expect(h).not.toContain('hunter2');
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test -- hash`
Expected: FAIL - cannot resolve `@/lib/hash`.

- [ ] **Step 7: Implement hashing**

Create `src/lib/hash.ts`:

```ts
import { createHmac } from 'node:crypto';
import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;

/**
 * HMAC, not a bare hash: UBC student numbers occupy a ~8-digit space, so a
 * plain SHA-256 column could be brute-forced back to every student number in
 * seconds. Keying with a server-side secret makes the digests useless alone.
 */
export function hashStudentNumber(raw: string): string {
  const secret = process.env.SERVER_SECRET;
  if (!secret) {
    throw new Error('SERVER_SECRET is not set - refusing to hash unkeyed.');
  }
  return createHmac('sha256', secret).update(raw.trim()).digest('hex');
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- hash`
Expected: PASS, 9 tests.

- [ ] **Step 9: Commit**

```bash
git add prisma src/lib/hash.ts tests/hash.test.ts package.json package-lock.json .env.example
git commit -m "feat: add auth schema fields and keyed hashing primitives"
```

Confirm `git status` shows `.env` untracked/ignored, never staged.

---

### Task 2: Redacted fixtures and the grid reader

**Files:**
- Create: `src/upload/read-grid.ts`, `scripts/make-fixture.ts`
- Create: `tests/fixtures/workday-current.xlsx`, `tests/fixtures/workday-record.xlsx`
- Test: `tests/read-grid.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `readWorkbookGrid(buffer: Buffer | ArrayBuffer): Promise<string[][]>` - the phase's ONLY I/O boundary
  - Two committed redacted fixtures

**Why fixtures come before the parser:** the parser is pure and test-driven
against these files. Real exports are git-ignored and contain a real student
number and grades - they can never be committed, so redacted equivalents with
identical structure must exist first.

- [ ] **Step 1: Install exceljs**

```bash
npm install exceljs
```

- [ ] **Step 2: Write the fixture generator**

Real exports live at `rgschedule/` (git-ignored). Create `scripts/make-fixture.ts`
to read a real export and write a redacted copy with fabricated identifiers:

```ts
/**
 * Reads a REAL Workday export and writes a redacted fixture with the same
 * structure but fabricated identity. Run manually; never commit its input.
 *   npx tsx scripts/make-fixture.ts rgschedule/View_My_Courses.xlsx tests/fixtures/workday-current.xlsx
 */
import ExcelJS from 'exceljs';

const FAKE_STUDENT = 'Test Student (99999999) - Faculty of Science';

async function main() {
  const [, , input, output] = process.argv;
  if (!input || !output) throw new Error('usage: make-fixture <input> <output>');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(input);

  wb.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      const a = row.getCell(1);
      // Column A carries "Name (studentnumber) - Faculty". Replace wholesale.
      if (typeof a.value === 'string' && /\(\d{6,10}\)/.test(a.value)) {
        a.value = FAKE_STUDENT;
      }
    });
  });

  await wb.xlsx.writeFile(output);
  console.log(`wrote ${output}`);
}

main();
```

- [ ] **Step 3: Generate both fixtures**

```bash
mkdir -p tests/fixtures
npx tsx scripts/make-fixture.ts rgschedule/View_My_Courses.xlsx tests/fixtures/workday-current.xlsx
npx tsx scripts/make-fixture.ts rgschedule/View_My_Academic_Record.xlsx tests/fixtures/workday-record.xlsx
```

- [ ] **Step 4: Verify the fixtures are actually redacted**

This is a security gate, not a formality. Run:

```bash
npx tsx -e "
import ExcelJS from 'exceljs';
for (const f of ['tests/fixtures/workday-current.xlsx','tests/fixtures/workday-record.xlsx']) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f);
  let found = [];
  wb.eachSheet(s => s.eachRow(r => r.eachCell(c => {
    const v = String(c.value ?? '');
    const m = v.match(/\b\d{6,10}\b/g); if (m) found.push(...m);
  })));
  console.log(f, 'numbers found:', [...new Set(found)]);
}
"
```

Every number printed must be `99999999`. **If any other 6-10 digit number
appears, stop - the fixture still contains real data and must not be committed.**
Also confirm no real name remains.

- [ ] **Step 5: Confirm fixtures are committable**

`.gitignore` has a blanket `*.xlsx` with an exception for `tests/fixtures/**`.
Verify the exception works:

```bash
git check-ignore -v tests/fixtures/workday-current.xlsx || echo "NOT ignored - committable, correct"
git check-ignore -v rgschedule/View_My_Courses.xlsx && echo "real export still ignored, correct"
```

- [ ] **Step 6: Write the failing grid-reader test**

Create `tests/read-grid.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readWorkbookGrid } from '@/upload/read-grid';

describe('readWorkbookGrid', () => {
  it('reads the current-courses fixture into a grid', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-current.xlsx'));
    expect(grid.length).toBeGreaterThan(3);
    // Headers sit on row 3 (index 2); rows 1-2 are title banners.
    expect(grid[2].join('|')).toContain('Course Listing');
  });

  it('reads the academic-record fixture into a grid', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-record.xlsx'));
    expect(grid.length).toBeGreaterThan(2);
    expect(grid.flat().join('|')).toContain('Transfer Credit');
  });

  it('pads short rows so column indexes stay stable', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-current.xlsx'));
    const widths = new Set(grid.map((r) => r.length));
    expect(widths.size).toBe(1);
  });

  it('rejects a non-xlsx buffer rather than throwing something opaque', async () => {
    await expect(readWorkbookGrid(Buffer.from('this is not a spreadsheet'))).rejects.toThrow();
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npm test -- read-grid`
Expected: FAIL - cannot resolve `@/upload/read-grid`.

- [ ] **Step 8: Implement the grid reader**

Create `src/upload/read-grid.ts`:

```ts
import ExcelJS from 'exceljs';

/**
 * The single I/O boundary of the upload pipeline. Everything downstream is a
 * pure function over the returned grid, which is what keeps the parser
 * testable offline.
 *
 * Rows are padded to a uniform width so column indexes are stable - Workday
 * omits trailing empty cells, which would otherwise shift lookups per row.
 */
export async function readWorkbookGrid(
  buffer: Buffer | ArrayBuffer,
): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);

  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error('Workbook contains no worksheets.');

  const rows: string[][] = [];
  let width = 0;

  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      const v = cell.value;
      let text = '';
      if (v === null || v === undefined) text = '';
      else if (typeof v === 'object' && 'richText' in v) {
        text = (v.richText as { text: string }[]).map((t) => t.text).join('');
      } else if (v instanceof Date) text = v.toISOString().slice(0, 10);
      else text = String(v);
      cells.push(text.trim());
    });
    width = Math.max(width, cells.length);
    rows.push(cells);
  });

  return rows.map((r) => {
    const padded = r.slice();
    while (padded.length < width) padded.push('');
    return padded;
  });
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm test -- read-grid`
Expected: PASS, 4 tests.

- [ ] **Step 10: Commit**

```bash
git add src/upload/read-grid.ts scripts/make-fixture.ts tests/fixtures tests/read-grid.test.ts package.json package-lock.json
git commit -m "feat: read Workday xlsx into a grid, with redacted fixtures"
```

Confirm `git status` does NOT show anything under `rgschedule/`.

---

### Task 3: The Workday parser (pure)

**Files:**
- Create: `src/upload/parse-workday.ts`
- Test: `tests/parse-workday.test.ts`

**Interfaces:**
- Consumes: `parseUbcCourseCode` from `@/scrape/parse-nodes` (Phase 1)
- Produces:
  - `parseStudentNumber(cell: string): string | null`
  - `parseSectionCode(cell: string): string | null`
  - `parseMeetingPattern(cell: string): { startDate: string | null; endDate: string | null }`
  - `inferTerm(isoDate: string): { year: number; session: string; termNumber: number | null } | null`
  - `parseWorkdayExport(grid: string[][]): ParsedExport`
  - types `ParsedExport`, `EnrollmentRow`, `ExcludedRow`

**Confirmed real formats (spec §7A) - these are observed, not guessed:**

```
column A   "Ryan Giang (12345678) - Faculty of Science"
column B   "CPSC_V 110 - Computation, Programs, and Programming"
column G   "CPSC_V 110-L1U - Computation, Programs, and Programming"
column H   "Registered"
column K   "2026-09-09 - 2026-12-04 | Wed Fri | 10:00 a.m. - 11:00 a.m. | ..."
record D   "TR"                    <- transfer grade
record E   "University of Alberta (Edmonton, AB, Canada)"
```

**Term inference (spec §7A.3)** - no export has a term column:

| Start month | Term |
|---|---|
| 9-12 | Winter Term 1, academic year = that calendar year |
| 1-4 | Winter Term 2, academic year = previous calendar year |
| 5-8 | Summer Session, that calendar year |

- [ ] **Step 1: Write the failing unit tests**

Create `tests/parse-workday.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readWorkbookGrid } from '@/upload/read-grid';
import {
  parseStudentNumber,
  parseSectionCode,
  parseMeetingPattern,
  inferTerm,
  parseWorkdayExport,
} from '@/upload/parse-workday';

describe('parseStudentNumber', () => {
  it('extracts the number from the identity cell', () => {
    expect(parseStudentNumber('Test Student (99999999) - Faculty of Science')).toBe('99999999');
  });

  it('returns null when no number is present', () => {
    expect(parseStudentNumber('Course Listing')).toBeNull();
    expect(parseStudentNumber('')).toBeNull();
  });

  it('does not match a bare number outside parentheses', () => {
    expect(parseStudentNumber('CPSC_V 110 - 12345678 things')).toBeNull();
  });
});

describe('parseSectionCode', () => {
  it('pulls the section off a section cell', () => {
    expect(parseSectionCode('CPSC_V 110-L1U - Computation, Programs')).toBe('L1U');
    expect(parseSectionCode('MATH_V 200-103 - Calculus III')).toBe('103');
  });

  it('returns null on an unparseable cell', () => {
    expect(parseSectionCode('')).toBeNull();
    expect(parseSectionCode('nonsense')).toBeNull();
  });
});

describe('parseMeetingPattern', () => {
  it('extracts the date range from a pipe-delimited pattern', () => {
    const r = parseMeetingPattern('2026-09-09 - 2026-12-04 | Wed Fri | 10:00 a.m. - 11:00 a.m.');
    expect(r.startDate).toBe('2026-09-09');
    expect(r.endDate).toBe('2026-12-04');
  });

  it('returns nulls when no dates are present', () => {
    expect(parseMeetingPattern('')).toEqual({ startDate: null, endDate: null });
  });
});

describe('inferTerm', () => {
  it('maps September to Winter Term 1 of that academic year', () => {
    expect(inferTerm('2026-09-09')).toEqual({ year: 2026, session: 'W', termNumber: 1 });
  });

  it('maps January to Winter Term 2 of the PREVIOUS academic year', () => {
    expect(inferTerm('2027-01-06')).toEqual({ year: 2026, session: 'W', termNumber: 2 });
  });

  it('maps June to Summer Session', () => {
    expect(inferTerm('2026-06-01')).toEqual({ year: 2026, session: 'S', termNumber: null });
  });

  it('returns null on garbage', () => {
    expect(inferTerm('not-a-date')).toBeNull();
  });
});

describe('parseWorkdayExport - current courses fixture', () => {
  it('parses the fixture end to end', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-current.xlsx'));
    const r = parseWorkdayExport(grid);

    expect(r.studentNumber).toBe('99999999');
    expect(r.rows.length).toBeGreaterThan(5);

    for (const row of r.rows) {
      expect(row.subjectCode).toMatch(/^[A-Z]{2,6}$/);
      expect(row.courseNumber).toMatch(/^\d{3}[A-Z]?$/);
      expect(row.campus).toBe('V');
    }
  });

  it('finds a known course from the fixture', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-current.xlsx'));
    const r = parseWorkdayExport(grid);
    expect(r.rows.some((x) => x.subjectCode === 'CPSC' && x.courseNumber === '110')).toBe(true);
  });

  it('spans more than one term - the export is not single-term', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-current.xlsx'));
    const r = parseWorkdayExport(grid);
    const terms = new Set(r.rows.map((x) => `${x.termYear}-${x.termSession}${x.termNumber}`));
    expect(terms.size).toBeGreaterThan(1);
  });

  it('excludes nothing as transfer in a current-courses export', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-current.xlsx'));
    expect(parseWorkdayExport(grid).excluded).toHaveLength(0);
  });
});

describe('parseWorkdayExport - academic record fixture', () => {
  it('excludes every transfer-credit row from enrollment', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-record.xlsx'));
    const r = parseWorkdayExport(grid);

    // The sample record is entirely transfer credit from another institution.
    expect(r.excluded.length).toBeGreaterThan(5);
    expect(r.rows).toHaveLength(0);
  });

  it('reports why each row was excluded', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-record.xlsx'));
    const r = parseWorkdayExport(grid);
    for (const e of r.excluded) expect(e.reason).toBe('transfer_credit');
  });

  it('still reads the student number from a record export', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-record.xlsx'));
    expect(parseWorkdayExport(grid).studentNumber).toBe('99999999');
  });
});

describe('parseWorkdayExport - safety', () => {
  it('rejects a file containing two different student numbers', () => {
    const grid = [
      ['', 'Course Listing', '', '', '', '', 'Section', 'Registration Status'],
      ['Student A (11111111) - Faculty', 'CPSC_V 110 - Thing', '', '', '', '', 'CPSC_V 110-101 - Thing', 'Registered'],
      ['Student B (22222222) - Faculty', 'CPSC_V 121 - Thing', '', '', '', '', 'CPSC_V 121-101 - Thing', 'Registered'],
    ];
    expect(() => parseWorkdayExport(grid)).toThrow(/one student/i);
  });

  it('returns an empty result rather than throwing on an unrecognised grid', () => {
    const r = parseWorkdayExport([['nothing', 'useful', 'here']]);
    expect(r.rows).toHaveLength(0);
    expect(r.studentNumber).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- parse-workday`
Expected: FAIL - cannot resolve `@/upload/parse-workday`.

- [ ] **Step 3: Implement the parser**

Create `src/upload/parse-workday.ts`:

```ts
import { parseUbcCourseCode } from '@/scrape/parse-nodes';

export type EnrollmentRow = {
  subjectCode: string;
  campus: string;
  courseNumber: string;
  sectionCode: string | null;
  activity: string | null;
  startDate: string | null;
  termYear: number;
  termSession: string;
  termNumber: number | null;
};

export type ExcludedRow = {
  raw: string;
  reason: 'transfer_credit' | 'unparseable_course' | 'no_term';
};

export type ParsedExport = {
  studentNumber: string | null;
  rows: EnrollmentRow[];
  excluded: ExcludedRow[];
};

const IDENTITY = /\((\d{6,10})\)/;

export function parseStudentNumber(cell: string): string | null {
  return cell.match(IDENTITY)?.[1] ?? null;
}

/** "CPSC_V 110-L1U - Computation, Programs" -> "L1U" */
export function parseSectionCode(cell: string): string | null {
  const m = cell.match(/^[A-Z]{2,6}_[VO]\s+\d{3}[A-Z]?-(\S+?)\s+-\s+/);
  return m?.[1] ?? null;
}

/** "2026-09-09 - 2026-12-04 | Wed Fri | 10:00 a.m." -> the date range */
export function parseMeetingPattern(cell: string): {
  startDate: string | null;
  endDate: string | null;
} {
  const m = cell.match(/(\d{4}-\d{2}-\d{2})\s*-\s*(\d{4}-\d{2}-\d{2})/);
  return { startDate: m?.[1] ?? null, endDate: m?.[2] ?? null };
}

/** No export carries a term column - derive it from the start date. */
export function inferTerm(
  isoDate: string,
): { year: number; session: string; termNumber: number | null } | null {
  const m = isoDate.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);

  if (month >= 9) return { year, session: 'W', termNumber: 1 };
  if (month <= 4) return { year: year - 1, session: 'W', termNumber: 2 };
  return { year, session: 'S', termNumber: null };
}

function headerIndex(grid: string[][]): number {
  return grid.findIndex((r) => r.some((c) => /Course Listing|Transfer Credit/i.test(c)));
}

function columnMap(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  header.forEach((h, i) => {
    const key = h.toLowerCase().trim();
    if (key) map[key] = i;
  });
  return map;
}

export function parseWorkdayExport(grid: string[][]): ParsedExport {
  const rows: EnrollmentRow[] = [];
  const excluded: ExcludedRow[] = [];
  const seenStudents = new Set<string>();

  const hIdx = headerIndex(grid);
  if (hIdx === -1) return { studentNumber: null, rows, excluded };

  const cols = columnMap(grid[hIdx]);
  const courseCol = cols['course listing'] ?? cols['transfer credit'];
  const sectionCol = cols['section'];
  const statusCol = cols['registration status'];
  const activityCol = cols['instructional format'];
  const meetingCol = cols['meeting patterns'];
  const gradeCol = cols['grade'];
  const originCol = cols['originating coursework'];

  for (const row of grid.slice(hIdx + 1)) {
    const identity = row[0] ?? '';
    const student = parseStudentNumber(identity);
    if (student) seenStudents.add(student);

    const listing = courseCol === undefined ? '' : (row[courseCol] ?? '');
    if (!listing) continue;

    // Transfer credit was earned at another institution - it must never grant
    // review rights for UBC's version of the course (spec 7B).
    const grade = gradeCol === undefined ? '' : (row[gradeCol] ?? '');
    const origin = originCol === undefined ? '' : (row[originCol] ?? '');
    if (grade.trim().toUpperCase() === 'TR' || origin.trim()) {
      excluded.push({ raw: listing, reason: 'transfer_credit' });
      continue;
    }

    const code = parseUbcCourseCode(listing.split(' - ')[0]?.trim() ?? '');
    if (!code) {
      excluded.push({ raw: listing, reason: 'unparseable_course' });
      continue;
    }

    const meeting = meetingCol === undefined
      ? { startDate: null, endDate: null }
      : parseMeetingPattern(row[meetingCol] ?? '');

    const term = meeting.startDate ? inferTerm(meeting.startDate) : null;
    if (!term) {
      excluded.push({ raw: listing, reason: 'no_term' });
      continue;
    }

    rows.push({
      subjectCode: code.subjectCode,
      campus: code.campus,
      courseNumber: code.number,
      sectionCode: sectionCol === undefined ? null : parseSectionCode(row[sectionCol] ?? ''),
      activity: activityCol === undefined ? null : (row[activityCol] || null),
      startDate: meeting.startDate,
      termYear: term.year,
      termSession: term.session,
      termNumber: term.termNumber,
    });
  }

  if (seenStudents.size > 1) {
    throw new Error(
      'Export contains more than one student - a legitimate export covers one student.',
    );
  }

  // statusCol is read to keep the contract explicit even when unused today:
  // every fixture row is "Registered", and in-progress rows DO grant rights.
  void statusCol;

  return { studentNumber: [...seenStudents][0] ?? null, rows, excluded };
}
```

- [ ] **Step 4: Iterate until tests pass**

Run: `npm test -- parse-workday`

The fixture is real UBC data, so expect to adjust column-name lookups against
what `readWorkbookGrid` actually returns. Print the header row if a lookup
misses:

```bash
npx tsx -e "
import {readWorkbookGrid} from './src/upload/read-grid';
import {readFileSync} from 'node:fs';
readWorkbookGrid(readFileSync('tests/fixtures/workday-current.xlsx')).then(g=>console.log(g.slice(0,4)));
"
```

Expected when done: PASS, all tests in the file.

- [ ] **Step 5: Detect tables we did not parse**

**Why:** spec §8. The sample academic record held only a *Transfer Credit*
table because that student has no completed UBC terms. A senior student's export
will contain at least one more table - almost certainly the completed
coursework, the rows that matter most. `headerIndex` finds only the FIRST header
row, so today those extra tables would be **silently ignored**, quietly costing
that user most of their reviewable courses with nothing on screen to show it.

We cannot parse a table we have never seen. We can refuse to hide it.

Add to `ParsedExport`:

```ts
  /** Header rows found after the table we parsed - structures we don't handle yet. */
  unparsedTables: string[];
```

In `parseWorkdayExport`, after the main loop, scan the remaining rows for
further header-like rows and collect them:

```ts
  const HEADER_HINT = /Course Listing|Transfer Credit|Completed Coursework|Grade/i;
  const unparsedTables = grid
    .slice(hIdx + 1)
    .filter((r, i, all) => {
      // A header row for a later table: matches a hint, and the row above it is
      // blank or a banner (i.e. it is not just another data row).
      if (!r.some((c) => HEADER_HINT.test(c))) return false;
      const prev = all[i - 1];
      return !prev || prev.every((c) => !c) || !prev[0];
    })
    .map((r) => r.filter(Boolean).join(' | '));
```

Return it alongside the rest. Add this test to `tests/parse-workday.test.ts`:

```ts
describe('parseWorkdayExport - unknown tables', () => {
  it('reports a second table rather than silently ignoring it', () => {
    const grid = [
      ['', 'Course Listing', 'Section', 'Registration Status', 'Meeting Patterns'],
      ['Test Student (99999999) - Faculty', 'CPSC_V 110 - Thing', 'CPSC_V 110-101 - Thing', 'Registered', '2026-09-09 - 2026-12-04'],
      ['', '', '', '', ''],
      ['', 'Completed Coursework', 'Grade', '', ''],
      ['Test Student (99999999) - Faculty', 'MATH_V 100 - Thing', 'A', '', ''],
    ];
    const r = parseWorkdayExport(grid);
    expect(r.rows).toHaveLength(1);
    expect(r.unparsedTables.length).toBeGreaterThan(0);
    expect(r.unparsedTables.join(' ')).toMatch(/Completed Coursework/);
  });

  it('reports no unknown tables for the single-table fixtures', async () => {
    const grid = await readWorkbookGrid(readFileSync('tests/fixtures/workday-current.xlsx'));
    expect(parseWorkdayExport(grid).unparsedTables).toHaveLength(0);
  });
});
```

Surface the count in `ImportResult` (Task 6) and on the onboarding screen
(Task 7) so it is visible to the user, not just present in a return value.

- [ ] **Step 6: Confirm purity**

```bash
grep -nE "fetch|prisma|@/lib/db|readFile|require\(|exceljs" src/upload/parse-workday.ts
```

Expected: no output. The parser must import only `@/scrape/parse-nodes`.

- [ ] **Step 7: Commit**

```bash
git add src/upload/parse-workday.ts tests/parse-workday.test.ts
git commit -m "feat: parse Workday exports, excluding transfer credit"
```

---

### Task 4: Auth.js setup, signup and login

**Files:**
- Create: `src/lib/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/types/next-auth.d.ts`
- Create: `src/app/(auth)/signup/page.tsx`, `src/app/(auth)/login/page.tsx`
- Create: `src/app/actions/auth.ts`
- Test: `tests/signup.test.ts`

**Interfaces:**
- Consumes: `db`, `hashPassword`, `verifyPassword`
- Produces:
  - `auth()`, `signIn()`, `signOut()`, `handlers` from `@/lib/auth`
  - `registerUser(email: string, password: string): Promise<{ ok: true; userId: string } | { ok: false; error: string }>`

**Session strategy is `jwt`** - Auth.js v5's Credentials provider does not
support database sessions. No `Account`/`Session` tables exist.

- [ ] **Step 1: Install Auth.js**

```bash
npm install next-auth@beta
```

- [ ] **Step 2: Write the failing registration tests**

Create `tests/signup.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { registerUser } from '@/app/actions/auth';
import { verifyPassword } from '@/lib/hash';

const EMAIL = 'zz-signup-test@example.com';

beforeAll(async () => {
  process.env.SERVER_SECRET ??= 'test-secret';
  await db.user.deleteMany({ where: { email: EMAIL } });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email: EMAIL } });
  await db.$disconnect();
});

describe('registerUser', () => {
  it('creates a user with a hashed password', async () => {
    const r = await registerUser(EMAIL, 'a-good-password-123');
    expect(r.ok).toBe(true);

    const user = await db.user.findUniqueOrThrow({ where: { email: EMAIL } });
    expect(user.passwordHash).toBeTruthy();
    expect(user.passwordHash).not.toBe('a-good-password-123');
    expect(await verifyPassword('a-good-password-123', user.passwordHash!)).toBe(true);
  });

  it('refuses a duplicate email', async () => {
    const r = await registerUser(EMAIL, 'another-password-456');
    expect(r.ok).toBe(false);
  });

  it('rejects a too-short password', async () => {
    const r = await registerUser('zz-short@example.com', 'abc');
    expect(r.ok).toBe(false);
  });

  it('rejects a malformed email', async () => {
    const r = await registerUser('not-an-email', 'a-good-password-123');
    expect(r.ok).toBe(false);
  });

  it('does not domain-restrict the email', async () => {
    const r = await registerUser('zz-gmail-test@gmail.com', 'a-good-password-123');
    expect(r.ok).toBe(true);
    await db.user.deleteMany({ where: { email: 'zz-gmail-test@gmail.com' } });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- signup`
Expected: FAIL - cannot resolve `@/app/actions/auth`.

- [ ] **Step 4: Implement the registration action**

Create `src/app/actions/auth.ts`:

```ts
'use server';

import { db } from '@/lib/db';
import { hashPassword } from '@/lib/hash';

const MIN_PASSWORD = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function registerUser(
  email: string,
  password: string,
): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const normalized = email.trim().toLowerCase();

  // Deliberately NOT domain-restricted: email is an account identifier, not
  // proof of studenthood. The Workday upload is what proves that.
  if (!EMAIL_RE.test(normalized)) return { ok: false, error: 'Enter a valid email address.' };
  if (password.length < MIN_PASSWORD) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD} characters.` };
  }

  const existing = await db.user.findUnique({ where: { email: normalized } });
  if (existing) return { ok: false, error: 'An account with that email already exists.' };

  const user = await db.user.create({
    data: { email: normalized, passwordHash: await hashPassword(password) },
  });

  return { ok: true, userId: user.id };
}
```

- [ ] **Step 5: Configure Auth.js**

Create `src/lib/auth.ts`:

```ts
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/hash';

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Credentials provider only supports JWT sessions in Auth.js v5 -
  // database sessions are not an option here.
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds) {
        const email = String(creds?.email ?? '').trim().toLowerCase();
        const password = String(creds?.password ?? '');
        if (!email || !password) return null;

        const user = await db.user.findUnique({ where: { email } });
        if (!user?.passwordHash) return null;
        if (!(await verifyPassword(password, user.passwordHash))) return null;

        return { id: user.id, email: user.email };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid) session.user.id = String(token.uid);
      return session;
    },
  },
});
```

Create `src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from '@/lib/auth';

export const { GET, POST } = handlers;
```

The `session()` callback above assigns `session.user.id`, which the default
Auth.js types do not declare - left as-is, `npx tsc --noEmit` fails in this task
and in every later task that reads `session.user.id` (Task 6's upload route).
Create `src/types/next-auth.d.ts` to augment it:

```ts
import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
    } & DefaultSession['user'];
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- signup`
Expected: PASS, 5 tests.

- [ ] **Step 7: Build the signup and login pages**

Create `src/app/(auth)/signup/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { registerUser } from '@/app/actions/auth';
import { signIn } from 'next-auth/react';

export default function SignupPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const email = String(form.get('email'));
    const password = String(form.get('password'));

    const result = await registerUser(email, password);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    await signIn('credentials', { email, password, redirect: false });
    router.push('/onboarding');
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-3xl font-semibold">Create your account</h1>
      <p className="mt-2 text-slate-600">
        Any email works - you&apos;ll verify you&apos;re a UBC student in the next step.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <input
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          className="w-full rounded-lg border px-4 py-2"
        />
        <input
          name="password"
          type="password"
          required
          minLength={10}
          placeholder="Password (10+ characters)"
          className="w-full rounded-lg border px-4 py-2"
        />
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-blue-700 px-5 py-2 text-white disabled:opacity-50"
        >
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>

      <p className="mt-6 text-sm text-slate-600">
        Already have an account?{' '}
        <Link href="/login" className="text-blue-700 hover:underline">
          Log in
        </Link>
      </p>
    </main>
  );
}
```

Create `src/app/(auth)/login/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signIn } from 'next-auth/react';

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const result = await signIn('credentials', {
      email: String(form.get('email')),
      password: String(form.get('password')),
      redirect: false,
    });

    if (result?.error) {
      // Deliberately does not say WHICH was wrong - that would let an attacker
      // enumerate which emails have accounts.
      setError('Invalid email or password.');
      setBusy(false);
      return;
    }
    router.push('/');
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-3xl font-semibold">Log in</h1>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <input
          name="email"
          type="email"
          required
          placeholder="you@example.com"
          className="w-full rounded-lg border px-4 py-2"
        />
        <input
          name="password"
          type="password"
          required
          placeholder="Password"
          className="w-full rounded-lg border px-4 py-2"
        />
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-blue-700 px-5 py-2 text-white disabled:opacity-50"
        >
          {busy ? 'Signing in…' : 'Log in'}
        </button>
      </form>

      <p className="mt-6 text-sm text-slate-600">
        Need an account?{' '}
        <Link href="/signup" className="text-blue-700 hover:underline">
          Sign up
        </Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 8: Verify live**

Start the dev server. Then:
- `POST` the signup form in a browser at `/signup` with a test email; confirm you land on `/onboarding`.
- Log out (or clear cookies), go to `/login`, sign in with the same credentials; confirm success.
- Try the wrong password; confirm it fails with a message and does not sign you in.

Clean up the test account afterwards:

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c "delete from \"User\" where email like 'zz-%';"
```

Stop the dev server.

- [ ] **Step 9: Commit**

```bash
git add src/lib/auth.ts src/app package.json package-lock.json tests/signup.test.ts
git commit -m "feat: add signup and login with Auth.js credentials"
```

---

### Task 5: Email verification

**Files:**
- Create: `src/lib/mail.ts`, `src/app/(auth)/verify/page.tsx`
- Modify: `src/app/actions/auth.ts`
- Test: `tests/verify.test.ts`

**Interfaces:**
- Consumes: `db`
- Produces:
  - `sendMail(to: string, subject: string, body: string): Promise<void>`
  - `createVerificationToken(userId: string): Promise<string>`
  - `consumeVerificationToken(token: string): Promise<{ ok: boolean; userId?: string }>`

**Email delivery is deliberately pluggable.** The dev implementation logs the
link to stdout; choosing a provider is a deployment decision and nothing else in
this phase depends on it.

- [ ] **Step 1: Write the failing tests**

Create `tests/verify.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { createVerificationToken, consumeVerificationToken } from '@/lib/mail';

let userId: string;
const EMAIL = 'zz-verify-test@example.com';

beforeAll(async () => {
  await db.user.deleteMany({ where: { email: EMAIL } });
  const u = await db.user.create({ data: { email: EMAIL } });
  userId = u.id;
});

afterAll(async () => {
  await db.verificationToken.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { email: EMAIL } });
  await db.$disconnect();
});

describe('verification tokens', () => {
  it('issues a high-entropy token', async () => {
    const t = await createVerificationToken(userId);
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it('consumes a valid token exactly once', async () => {
    const t = await createVerificationToken(userId);
    expect((await consumeVerificationToken(t)).ok).toBe(true);
    // Replay must fail - a verification link is single-use.
    expect((await consumeVerificationToken(t)).ok).toBe(false);
  });

  it('rejects an unknown token', async () => {
    expect((await consumeVerificationToken('0'.repeat(64))).ok).toBe(false);
  });

  it('rejects an expired token', async () => {
    const t = await createVerificationToken(userId);
    await db.verificationToken.update({
      where: { token: t },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await consumeVerificationToken(t)).ok).toBe(false);
  });

  it('sets emailVerified on the user when consumed', async () => {
    const t = await createVerificationToken(userId);
    await consumeVerificationToken(t);
    const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(u.emailVerified).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- verify`
Expected: FAIL - cannot resolve `@/lib/mail`.

- [ ] **Step 3: Implement mail and tokens**

Create `src/lib/mail.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { db } from '@/lib/db';

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * ponytail: console transport only. Choosing a real provider is a deployment
 * decision - swap this one function's body when there is somewhere to send to.
 */
export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  console.log(`\n--- MAIL ---\nTo: ${to}\nSubject: ${subject}\n\n${body}\n------------\n`);
}

export async function createVerificationToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await db.verificationToken.create({
    data: { token, userId, expiresAt: new Date(Date.now() + TOKEN_TTL_MS) },
  });
  return token;
}

export async function consumeVerificationToken(
  token: string,
): Promise<{ ok: boolean; userId?: string }> {
  const row = await db.verificationToken.findUnique({ where: { token } });
  if (!row) return { ok: false };

  // Single-use: delete before acting, so a replay finds nothing.
  await db.verificationToken.delete({ where: { token } });
  if (row.expiresAt < new Date()) return { ok: false };

  await db.user.update({
    where: { id: row.userId },
    data: { emailVerified: new Date() },
  });
  return { ok: true, userId: row.userId };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- verify`
Expected: PASS, 5 tests.

- [ ] **Step 5: Send the mail on signup**

In `src/app/actions/auth.ts`, after `db.user.create(...)` succeeds, add:

```ts
  const token = await createVerificationToken(user.id);
  const link = `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/verify?token=${token}`;
  await sendMail(
    normalized,
    'Verify your UBC Flow account',
    `Confirm your email by visiting:\n\n${link}\n\nThis link expires in 24 hours.`,
  );
```

Add the matching imports from `@/lib/mail`.

- [ ] **Step 6: Build the verify page**

Create `src/app/(auth)/verify/page.tsx`:

```tsx
import Link from 'next/link';
import { consumeVerificationToken } from '@/lib/mail';

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const result = token ? await consumeVerificationToken(token) : { ok: false };

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-3xl font-semibold">
        {result.ok ? 'Email verified' : 'Link not valid'}
      </h1>
      <p className="mt-2 text-slate-600">
        {result.ok
          ? 'Next, upload your Workday exports to finish setting up your account.'
          : 'That verification link is invalid or has expired. Request a new one from your account page.'}
      </p>
      <Link href="/onboarding" className="mt-6 inline-block text-blue-700 hover:underline">
        Continue to setup →
      </Link>
    </main>
  );
}
```

- [ ] **Step 7: Verify live**

Start the dev server, sign up with a fresh email, and copy the verification link
from the server's stdout. Visit it; confirm the page reports success and that
`emailVerified` is set:

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c "select email, \"emailVerified\" from \"User\" where email like 'zz-%';"
```

Visit the same link a second time; confirm it now reports "Link not valid".
Clean up test users and stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add src/lib/mail.ts src/app tests/verify.test.ts
git commit -m "feat: add single-use email verification with pluggable delivery"
```

---

### Task 6: Import - matching, binding, and enrollment

**Files:**
- Create: `src/upload/import.ts`, `src/app/api/upload/route.ts`
- Test: `tests/import.test.ts`

**Interfaces:**
- Consumes: `parseWorkdayExport`, `readWorkbookGrid`, `hashStudentNumber`, `db`, `auth`
- Produces:
  - `importExport(userId: string, parsed: ParsedExport): Promise<ImportResult>`
  - `type ImportResult = { matched: number; unmatched: string[]; excluded: number; boundStudent: boolean }`

**Two rules this task enforces (both are security requirements, not niceties):**

1. **One student, one account.** The HMAC digest is unique on `User`. An upload
   whose digest already belongs to a *different* user is rejected outright.
2. **Unmatched rows are reported, never silently dropped** - a silent drop hides
   catalogue gaps and leaves a user wrongly unable to review with no visible cause.

- [ ] **Step 1: Write the failing tests**

Create `tests/import.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { importExport } from '@/upload/import';
import type { ParsedExport } from '@/upload/parse-workday';

const A = 'zz-import-a@example.com';
const B = 'zz-import-b@example.com';
let userA: string;
let userB: string;

const parsed: ParsedExport = {
  studentNumber: '99999999',
  rows: [
    {
      subjectCode: 'CPSC',
      campus: 'V',
      courseNumber: '110',
      sectionCode: '103',
      activity: 'Lecture',
      startDate: '2026-09-08',
      termYear: 2026,
      termSession: 'W',
      termNumber: 1,
    },
    {
      subjectCode: 'ZZNOPE',
      campus: 'V',
      courseNumber: '999',
      sectionCode: null,
      activity: null,
      startDate: '2026-09-08',
      termYear: 2026,
      termSession: 'W',
      termNumber: 1,
    },
  ],
  excluded: [{ raw: 'MATH_V 101 - Integral Calculus', reason: 'transfer_credit' }],
};

beforeAll(async () => {
  process.env.SERVER_SECRET ??= 'test-secret';
  await db.user.deleteMany({ where: { email: { in: [A, B] } } });
  userA = (await db.user.create({ data: { email: A } })).id;
  userB = (await db.user.create({ data: { email: B } })).id;
});

afterAll(async () => {
  await db.enrollment.deleteMany({ where: { userId: { in: [userA, userB] } } });
  await db.user.deleteMany({ where: { email: { in: [A, B] } } });
  await db.$disconnect();
});

describe('importExport', () => {
  it('matches a real course and reports the unmatched one', async () => {
    const r = await importExport(userA, parsed);
    expect(r.matched).toBe(1);
    expect(r.unmatched).toContain('ZZNOPE 999');
    expect(r.excluded).toBe(1);
  });

  it('writes a verified enrollment for the matched course', async () => {
    const rows = await db.enrollment.findMany({ where: { userId: userA } });
    expect(rows).toHaveLength(1);
    expect(rows[0].verified).toBe(true);
    expect(rows[0].source).toBe('workday');
  });

  it('binds the student number to the account and marks it verified', async () => {
    const u = await db.user.findUniqueOrThrow({ where: { id: userA } });
    expect(u.studentIdHash).toMatch(/^[0-9a-f]{64}$/);
    expect(u.verifiedAt).toBeTruthy();
  });

  it('never stores the raw student number', async () => {
    const u = await db.user.findUniqueOrThrow({ where: { id: userA } });
    expect(u.studentIdHash).not.toContain('99999999');
  });

  it('is idempotent - re-importing does not duplicate enrollments', async () => {
    await importExport(userA, parsed);
    expect(await db.enrollment.count({ where: { userId: userA } })).toBe(1);
  });

  it('refuses to bind the same student number to a second account', async () => {
    await expect(importExport(userB, parsed)).rejects.toThrow(/already/i);
    expect(await db.enrollment.count({ where: { userId: userB } })).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- import`
Expected: FAIL - cannot resolve `@/upload/import`.

- [ ] **Step 3: Implement the importer**

Create `src/upload/import.ts`:

```ts
import { db } from '@/lib/db';
import { hashStudentNumber } from '@/lib/hash';
import type { ParsedExport } from '@/upload/parse-workday';

export type ImportResult = {
  matched: number;
  unmatched: string[];
  excluded: number;
  boundStudent: boolean;
};

export async function importExport(
  userId: string,
  parsed: ParsedExport,
): Promise<ImportResult> {
  let boundStudent = false;

  if (parsed.studentNumber) {
    const digest = hashStudentNumber(parsed.studentNumber);
    const owner = await db.user.findUnique({ where: { studentIdHash: digest } });

    // One student, one account. Without this a single genuine export could
    // verify unlimited accounts and manufacture a bot army (spec 5).
    if (owner && owner.id !== userId) {
      throw new Error('That student number is already linked to another account.');
    }

    await db.user.update({
      where: { id: userId },
      data: { studentIdHash: digest, verifiedAt: new Date() },
    });
    boundStudent = true;
  }

  const unmatched: string[] = [];
  let matched = 0;

  for (const row of parsed.rows) {
    const course = await db.course.findFirst({
      where: {
        number: row.courseNumber,
        subject: { code: row.subjectCode, campus: row.campus },
      },
      select: { id: true },
    });

    const term = await db.term.findFirst({
      where: {
        year: row.termYear,
        session: row.termSession,
        termNumber: row.termNumber,
        campus: row.campus,
      },
      select: { id: true },
    });

    // Reported, never silently dropped - a silent drop hides a catalogue gap
    // and leaves the user unable to review with no visible cause (spec 4.2).
    if (!course || !term) {
      unmatched.push(`${row.subjectCode} ${row.courseNumber}`);
      continue;
    }

    await db.enrollment.upsert({
      where: {
        userId_courseId_termId: { userId, courseId: course.id, termId: term.id },
      },
      create: {
        userId,
        courseId: course.id,
        termId: term.id,
        source: 'workday',
        verified: true,
      },
      update: { verified: true },
    });
    matched += 1;
  }

  return { matched, unmatched, excluded: parsed.excluded.length, boundStudent };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- import`
Expected: PASS, 6 tests.

- [ ] **Step 5: Build the upload route**

Create `src/app/api/upload/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { readWorkbookGrid } from '@/upload/read-grid';
import { parseWorkdayExport } from '@/upload/parse-workday';
import { importExport } from '@/upload/import';

const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
  }

  // Size is checked BEFORE parsing - a zip bomb must never reach the parser.
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File is too large (max 2 MB).' }, { status: 413 });
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return NextResponse.json({ error: 'Upload the .xlsx export from Workday.' }, { status: 400 });
  }

  try {
    // Held in memory only - never written to disk, never logged.
    const grid = await readWorkbookGrid(await file.arrayBuffer());
    const parsed = parseWorkdayExport(grid);

    if (!parsed.studentNumber) {
      return NextResponse.json(
        { error: "That file doesn't look like a Workday export - no student found." },
        { status: 400 },
      );
    }

    const result = await importExport(session.user.id, parsed);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not read that file.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
```

- [ ] **Step 6: Verify against the REAL export end to end**

This is the acceptance test for the phase. Start the dev server, sign up, then:

```bash
# Replace SESSION_COOKIE with the authjs.session-token value from your browser.
curl -s -X POST http://localhost:3000/api/upload \
  -H "Cookie: authjs.session-token=SESSION_COOKIE" \
  -F "file=@rgschedule/View_My_Courses.xlsx"
```

Expected: JSON with a non-zero `matched`, and `boundStudent: true`. Then confirm:

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c "
select u.email, count(e.id) enrollments, (u.\"studentIdHash\" is not null) bound
from \"User\" u left join \"Enrollment\" e on e.\"userId\"=u.id
where u.email like 'zz-%' group by 1,3;"
```

Also upload `View_My_Academic_Record.xlsx` and confirm its transfer rows are
counted in `excluded` and produce **zero** new enrollments.

Clean up test users and stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/upload/import.ts src/app/api/upload tests/import.test.ts
git commit -m "feat: import Workday enrollments and bind student identity"
```

---

### Task 7: Onboarding UI and the review gate

**Files:**
- Create: `src/app/onboarding/page.tsx`, `src/lib/gate.ts`
- Test: `tests/gate.test.ts`

**Interfaces:**
- Consumes: `db`
- Produces:
  - `canReview(userId: string, courseId: string): Promise<boolean>`
  - `reviewableCourses(userId: string): Promise<string[]>`
  - route `/onboarding`

`canReview` is the gate Phase 3 will call before accepting any review. It ships
here, tested, so Phase 3 inherits a verified boundary rather than inventing one.

- [ ] **Step 1: Write the failing gate tests**

Create `tests/gate.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { canReview, reviewableCourses } from '@/lib/gate';

const EMAIL = 'zz-gate-test@example.com';
let userId: string;
let enrolledCourseId: string;
let otherCourseId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { email: EMAIL } });
  userId = (await db.user.create({ data: { email: EMAIL } })).id;

  const courses = await db.course.findMany({ take: 2, select: { id: true } });
  enrolledCourseId = courses[0].id;
  otherCourseId = courses[1].id;

  const term = await db.term.findFirstOrThrow({ select: { id: true } });
  await db.enrollment.create({
    data: { userId, courseId: enrolledCourseId, termId: term.id, source: 'workday', verified: true },
  });
});

afterAll(async () => {
  await db.enrollment.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { email: EMAIL } });
  await db.$disconnect();
});

describe('canReview', () => {
  it('allows a course the user is enrolled in', async () => {
    expect(await canReview(userId, enrolledCourseId)).toBe(true);
  });

  it('denies a course the user never took', async () => {
    expect(await canReview(userId, otherCourseId)).toBe(false);
  });

  it('denies everything for a user with no enrollments', async () => {
    const stranger = await db.user.create({ data: { email: 'zz-stranger@example.com' } });
    expect(await canReview(stranger.id, enrolledCourseId)).toBe(false);
    await db.user.delete({ where: { id: stranger.id } });
  });

  it('denies an unverified enrollment', async () => {
    await db.enrollment.updateMany({ where: { userId }, data: { verified: false } });
    expect(await canReview(userId, enrolledCourseId)).toBe(false);
    await db.enrollment.updateMany({ where: { userId }, data: { verified: true } });
  });
});

describe('reviewableCourses', () => {
  it('lists exactly the enrolled courses', async () => {
    expect(await reviewableCourses(userId)).toEqual([enrolledCourseId]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- gate`
Expected: FAIL - cannot resolve `@/lib/gate`.

- [ ] **Step 3: Implement the gate**

Create `src/lib/gate.ts`:

```ts
import { db } from '@/lib/db';

/**
 * The review gate: a user may only review a course they have a VERIFIED
 * enrollment in. Phase 3 must call this before accepting any review.
 */
export async function canReview(userId: string, courseId: string): Promise<boolean> {
  const found = await db.enrollment.findFirst({
    where: { userId, courseId, verified: true },
    select: { id: true },
  });
  return found !== null;
}

export async function reviewableCourses(userId: string): Promise<string[]> {
  const rows = await db.enrollment.findMany({
    where: { userId, verified: true },
    select: { courseId: true },
    distinct: ['courseId'],
  });
  return rows.map((r) => r.courseId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- gate`
Expected: PASS, 5 tests.

- [ ] **Step 5: Build the onboarding page**

Create `src/app/onboarding/page.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';

type ImportResult = {
  matched: number;
  unmatched: string[];
  excluded: number;
  boundStudent: boolean;
};

export default function OnboardingPage() {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: new FormData(e.currentTarget),
    });
    const data = await res.json();

    if (!res.ok) setError(data.error ?? 'Upload failed.');
    else setResult(data);
    setBusy(false);
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-semibold">Verify you&apos;re a UBC student</h1>
      <p className="mt-2 text-slate-600">
        Upload your Workday export so we know which courses you&apos;ve taken. You can
        only review courses you were actually enrolled in.
      </p>

      <div className="mt-8 rounded-lg border bg-slate-50 p-5 text-sm">
        <p className="font-medium">Where to find these in Workday</p>
        <ul className="mt-3 space-y-2 text-slate-700">
          <li>
            <span className="font-medium">Current courses:</span> Workday → Academics →
            <span className="font-medium"> View My Courses</span> → the
            <span className="font-medium"> Export to Excel</span> icon above the table
          </li>
          <li>
            <span className="font-medium">Past courses:</span> Workday → Academics →
            <span className="font-medium"> View My Academic Record</span> →
            <span className="font-medium"> Export to Excel</span>
          </li>
        </ul>
        <p className="mt-3 text-slate-500">
          Upload them one at a time. Both are <code>.xlsx</code> files.
        </p>
      </div>

      <form onSubmit={onSubmit} className="mt-6 flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="file"
          accept=".xlsx"
          required
          className="flex-1 rounded-lg border px-4 py-2"
        />
        <button
          disabled={busy}
          className="rounded-lg bg-blue-700 px-5 py-2 text-white disabled:opacity-50"
        >
          {busy ? 'Reading…' : 'Upload'}
        </button>
      </form>

      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}

      {result && (
        <section className="mt-8 rounded-lg border p-5">
          <p className="text-lg font-medium">
            Matched {result.matched} course{result.matched === 1 ? '' : 's'}
          </p>
          {result.excluded > 0 && (
            <p className="mt-1 text-sm text-slate-600">
              Skipped {result.excluded} transfer credit
              {result.excluded === 1 ? '' : 's'} - those were earned at another
              institution, so they don&apos;t unlock UBC reviews.
            </p>
          )}

          {/* Required by spec 4.2: never drop unmatched rows silently. */}
          {result.unmatched.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-medium">
                We couldn&apos;t match {result.unmatched.length}:
              </p>
              <ul className="mt-1 text-sm text-slate-600">
                {result.unmatched.map((code) => (
                  <li key={code}>{code}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-slate-500">
                These may be courses we haven&apos;t indexed yet.
              </p>
            </div>
          )}

          {result.matched > 0 && (
            <Link
              href="/"
              className="mt-5 inline-block rounded-lg bg-blue-700 px-5 py-2 text-white"
            >
              Done - start browsing →
            </Link>
          )}
        </section>
      )}

      <p className="mt-8 text-xs text-slate-500">
        We only read which courses you took. Your grades and student number are never
        stored, and the file itself is never saved.
      </p>
    </main>
  );
}
```

- [ ] **Step 6: Verify live**

Start the dev server, sign up as a new user, land on `/onboarding`, and upload
the real `rgschedule/View_My_Courses.xlsx` through the browser UI. Confirm:
- the matched count is non-zero
- unmatched codes, if any, are listed on screen
- uploading `View_My_Academic_Record.xlsx` reports its transfer credits as
  skipped and adds no enrollments

Clean up test users, stop the dev server.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS - Phase 1's 68 tests plus this phase's additions.

Also run `npx tsc --noEmit` and `npm run build`; both must be clean.

- [ ] **Step 8: Commit**

```bash
git add src/app/onboarding src/lib/gate.ts tests/gate.test.ts
git commit -m "feat: add onboarding upload flow and the review gate"
```

---

## Phase 2 completion criteria

- [ ] `npm test` passes; `npx tsc --noEmit` and `npm run build` clean
- [ ] A new user can sign up, verify email, upload a real Workday export, and end up with `verifiedAt` set and enrollments written
- [ ] The same export uploaded to a second account is **rejected**
- [ ] Transfer credits are reported and produce **zero** enrollments
- [ ] No grade, GPA, raw student number, or uploaded file exists anywhere in the database or on disk
- [ ] `canReview` returns true only for verified enrollments - ready for Phase 3
