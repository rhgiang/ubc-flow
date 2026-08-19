# UBC Flow Phase 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a browsable, read-only UBC course catalogue — searchable course and professor pages backed by scheduled scrapes of live UBC data.

**Architecture:** A single Next.js (App Router) TypeScript application with Prisma over Postgres. Scrapers are standalone `tsx` scripts sharing the same Prisma client, run on a schedule, writing to our database — never live proxies on the request path. All HTML parsing lives in **pure functions** (`html string → structured data`) so the test suite needs no network and no database; only idempotency tests touch Postgres.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Prisma 6, Postgres (Neon), Tailwind + shadcn/ui, Vitest, Cheerio (static HTML), Playwright (JS-rendered pages), tsx.

**Spec:** [`docs/superpowers/specs/2026-08-19-ubc-flow-foundation-design.md`](../specs/2026-08-19-ubc-flow-foundation-design.md)

## Global Constraints

- **Node.js 20+**, npm as package manager. No bun, no pnpm.
- **Scrape only public, unauthenticated UBC pages.** Never CWL, never an authenticated session. This is a hard project constraint, not a preference.
- **Every scraper sets a descriptive User-Agent** identifying the project and a contact URL, and rate-limits to **max 1 request per second** against any UBC host.
- **All scraper writes are idempotent upserts.** Re-running a job must never duplicate or destroy rows.
- **Campus scope for v1: Vancouver only** (`campus=1`). Schema supports Okanagan; do not scrape it yet.
- **Term history depth:** current + next + two years back.
- **Parsers are pure functions.** No parser may perform I/O — no `fetch`, no Prisma. This is what keeps the suite fast and offline.
- **Rating fields are not built in this phase.** Schema defines them; no UI, no routes, no seed data.
- UBC's numeric IDs are unstable across terms — always store them, never hardcode them in application logic beyond the scrapers.

---

## File Structure

```
prisma/schema.prisma              — full schema, all six phases
src/app/page.tsx                  — home / search entry
src/app/explore/page.tsx          — browse by subject
src/app/course/[code]/page.tsx    — course detail
src/app/professor/[slug]/page.tsx — professor detail
src/lib/db.ts                     — Prisma singleton
src/lib/format.ts                 — shared display helpers
src/scrape/http.ts                — rate-limited fetch + User-Agent
src/scrape/parse-catalog.ts       — PURE: subject/term option parsing
src/scrape/parse-sections.ts      — PURE: course/section row parsing
src/scrape/parse-descriptions.ts  — PURE: academic calendar parsing
src/scrape/names.ts               — PURE: instructor name normalisation
src/scrape/jobs/catalog.ts        — subjects + terms job
src/scrape/jobs/sections.ts       — courses + sections job
src/scrape/jobs/descriptions.ts   — description enrichment job
tests/fixtures/*.html             — saved UBC HTML, committed
docs/superpowers/notes/           — spike findings
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`
- Create: `src/app/page.tsx`, `src/app/layout.tsx`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a working `npm test` and `npm run dev`; all later tasks assume Vitest resolves `src/` via the `@/` alias.

- [ ] **Step 1: Scaffold Next.js**

Run in the repo root. Answer prompts: TypeScript **yes**, ESLint **yes**, Tailwind **yes**, `src/` directory **yes**, App Router **yes**, Turbopack **yes**, import alias **`@/*`**.

```bash
npx create-next-app@latest . --ts --eslint --tailwind --src-dir --app --import-alias "@/*" --use-npm
```

If it refuses because the directory is non-empty, scaffold into a temp dir and move the files in, preserving `.git`, `README.md`, and `docs/`.

- [ ] **Step 2: Install test and scrape dependencies**

```bash
npm install -D vitest @vitejs/plugin-react vite-tsconfig-paths tsx
npm install @prisma/client cheerio
npm install -D prisma playwright
npx playwright install chromium
```

- [ ] **Step 3: Configure Vitest**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write the smoke test**

Create `tests/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';

describe('scaffold', () => {
  it('runs typescript tests', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the test suite**

Run: `npm test`
Expected: PASS, 1 test.

- [ ] **Step 6: Verify the dev server boots**

Run: `npm run dev`, open `http://localhost:3000`, confirm the default page renders, then stop the server.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with Vitest"
```

---

### Task 2: Database schema

**Files:**
- Create: `prisma/schema.prisma`, `src/lib/db.ts`, `.env`, `.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing
- Produces: `prisma` client exported from `@/lib/db` as `db`. Models `Subject`, `Course`, `Term`, `Section`, `MeetingTime`, `Instructor`, `SectionInstructor` are available to all later tasks with exactly the field names below.

**Note — deviation from spec §5.1:** `Subject.code` (e.g. `CPSC`) is **nullable**. The subject dropdown gives us `"Computer Science (Vancouver)"` and a numeric ID but *not* the code; codes appear only in course rows (`CPSC 221`) and are backfilled during Task 7. `ubcSubjectId` is added to iterate the search.

- [ ] **Step 1: Provision a Postgres database**

Create a free Neon project at `https://neon.tech`, copy the connection string.

Create `.env`:

```
DATABASE_URL="postgresql://user:pass@host/dbname?sslmode=require"
```

Create `.env.example`:

```
DATABASE_URL="postgresql://user:pass@host/dbname?sslmode=require"
```

Confirm `.gitignore` contains `.env`. Add it if absent. **Never commit `.env`.**

- [ ] **Step 2: Write the schema**

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ---------- Phase 1: catalogue ----------

model Subject {
  id           String   @id @default(cuid())
  code         String?
  name         String
  campus       String
  faculty      String?
  ubcSubjectId String
  courses      Course[]

  @@unique([ubcSubjectId, campus])
  @@index([code])
}

model Course {
  id          String   @id @default(cuid())
  subjectId   String
  subject     Subject  @relation(fields: [subjectId], references: [id])
  number      String
  title       String
  description String?
  credits     Float?
  campus      String
  prereqText  String?
  coreqText   String?
  updatedAt   DateTime @updatedAt
  sections    Section[]

  @@unique([subjectId, number])
}

model Term {
  id          String    @id @default(cuid())
  ubcPeriodId String    @unique
  name        String
  year        Int
  session     String
  termNumber  Int?
  campus      String
  sections    Section[]
}

model Section {
  id           String   @id @default(cuid())
  courseId     String
  course       Course   @relation(fields: [courseId], references: [id])
  termId       String
  term         Term     @relation(fields: [termId], references: [id])
  sectionCode  String
  activity     String?
  status       String?
  deliveryMode String?
  enrolTotal   Int?
  enrolCap     Int?
  meetingTimes MeetingTime[]
  instructors  SectionInstructor[]

  @@unique([courseId, termId, sectionCode])
}

model MeetingTime {
  id        String   @id @default(cuid())
  sectionId String
  section   Section  @relation(fields: [sectionId], references: [id], onDelete: Cascade)
  day       String
  startTime String?
  endTime   String?
  building  String?
  room      String?
  startDate DateTime?
  endDate   DateTime?
}

model Instructor {
  id       String   @id @default(cuid())
  name     String
  slug     String   @unique
  campus   String?
  sections SectionInstructor[]
}

model SectionInstructor {
  sectionId    String
  section      Section    @relation(fields: [sectionId], references: [id], onDelete: Cascade)
  instructorId String
  instructor   Instructor @relation(fields: [instructorId], references: [id])

  @@id([sectionId, instructorId])
}

// ---------- Later phases: created, unpopulated ----------

model User {
  id            String   @id @default(cuid())
  email         String   @unique
  emailVerified DateTime?
  passwordHash  String?
  name          String?
  program       String?
  gradYear      Int?
  createdAt     DateTime @default(now())
  enrollments   Enrollment[]
  courseReviews CourseReview[]
  instructorReviews InstructorReview[]
}

model Enrollment {
  id       String  @id @default(cuid())
  userId   String
  user     User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  courseId String
  termId   String
  source   String
  verified Boolean @default(false)

  @@unique([userId, courseId, termId])
}

model CourseReview {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  courseId      String
  termId        String?
  instructorId  String?
  liked         Boolean?
  useful        Int?
  difficulty    Int?
  workloadHours Int?
  text          String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([userId, courseId])
}

model InstructorReview {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  instructorId String
  courseId     String?
  liked        Boolean?
  clear        Int?
  engaging     Int?
  text         String?
  createdAt    DateTime @default(now())

  @@unique([userId, instructorId, courseId])
}

model SavedSchedule {
  id       String @id @default(cuid())
  userId   String
  termId   String
  name     String
  sections ScheduleSection[]
}

model ScheduleSection {
  scheduleId String
  schedule   SavedSchedule @relation(fields: [scheduleId], references: [id], onDelete: Cascade)
  sectionId  String

  @@id([scheduleId, sectionId])
}

model CalendarToken {
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique
  createdAt DateTime @default(now())
}

model GradeDistribution {
  id           String  @id @default(cuid())
  courseId     String
  instructorId String?
  termId       String?
  average      Float?
  median       Float?
  high         Float?
  low          Float?
  count        Int?
  distribution Json?

  @@index([courseId])
}
```

- [ ] **Step 3: Run the migration**

```bash
npx prisma migrate dev --name init
```

Expected: migration applied, client generated, no errors.

- [ ] **Step 4: Create the Prisma singleton**

Create `src/lib/db.ts`:

```ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
```

- [ ] **Step 5: Verify the schema applied**

```bash
npx prisma studio
```

Confirm all tables are listed and empty, then close.

- [ ] **Step 6: Commit**

```bash
git add prisma src/lib/db.ts .env.example .gitignore
git commit -m "feat: add Prisma schema for all phases"
```

Confirm `git status` shows `.env` as ignored, not staged.

---

### Task 3: Scraper spike — resolve course-row extraction

**This is an investigation task, not a TDD task.** Its output is a decision and a committed fixture, not production code. Timebox: 1 day.

**Files:**
- Create: `docs/superpowers/notes/2026-08-19-scraper-spike.md`
- Create: `tests/fixtures/course-search-cpsc.html`
- Create: `tests/fixtures/course-search-form.html`

**Interfaces:**
- Consumes: nothing
- Produces: the fixture files Task 4 and Task 6 parse against, and the decision that determines Task 7's fetch mechanism.

**Background — what was already proven and disproven (spec §3):**

Working, verified:
```bash
curl -sSL "https://courses.students.ubc.ca/course-search"   # form + all dropdowns
```

Verified NOT to return course rows:
- `GET /course-search?campus=1&academic_period=1449&subject_code=CPSC` → 200, zero rows
- `POST /views/ajax` with `view_name=new_course_search`, `view_display_id=block_1`, `view_path=/node/71615`, `view_dom_id=…`, `pager_element=0`, `campus=1`, `academic_period=1449`, `subject_code=CPSC` → 200, payload contains only the re-rendered filter form

Known form parameters: `campus` (radio, `1`=Vancouver, `2`=Okanagan), `academic_period` (numeric term ID, `1449`=2025-26 Winter Term 1 UBC-V), `subject` (numeric, `1810`=Computer Science Vancouver), `subject_code` (free text, `CPSC`), `course_number`, `title`, `credits`, `delivery_mode`.

- [ ] **Step 1: Save the form fixture**

```bash
mkdir -p tests/fixtures docs/superpowers/notes
curl -sSL -A "UBCFlow/0.1 (+https://github.com/ryangiang/ubc-flow)" \
  -o tests/fixtures/course-search-form.html \
  "https://courses.students.ubc.ca/course-search"
```

Confirm it contains `edit-academic-period` and `edit-subject`.

- [ ] **Step 2: Capture the real request in a browser**

Open `https://courses.students.ubc.ca/course-search` in Chrome with DevTools → Network → Fetch/XHR. Search Vancouver / 2025-26 Winter Term 1 / subject code `CPSC`. Find the request that returns course rows. Record: URL, method, request headers (especially `Cookie`, `X-Requested-With`), and the full form body.

Right-click it → Copy as cURL. Save that command verbatim into the notes file.

- [ ] **Step 3: Try to replay it**

Run the copied cURL. Does it return course rows outside the browser?

- **Yes** → approach is **AJAX replay**. Record exactly which headers/cookies are required. Determine whether the session cookie can be obtained by a plain GET to `/course-search` first.
- **No** → approach is **Playwright**. Proceed to Step 4.

- [ ] **Step 4: Confirm Playwright can read the rendered rows**

Create a throwaway script `spike.ts` (do **not** commit it):

```ts
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('https://courses.students.ubc.ca/course-search');
await page.getByLabel('Vancouver').check();
await page.selectOption('#edit-academic-period', '1449');
await page.fill('#edit-subject-code', 'CPSC');
await page.click('#edit-submit-new-course-search');
await page.waitForLoadState('networkidle');
const html = await page.content();
console.log(html.length, html.includes('CPSC 2'));
await browser.close();
```

Run: `npx tsx spike.ts`
Expected: prints a length and `true`.

If the selectors above do not match, inspect the live page and correct them — record the working selectors in the notes.

- [ ] **Step 5: Save the results fixture**

Extend the spike script to write `await page.content()` to `tests/fixtures/course-search-cpsc.html`. Run it. Confirm the file contains `CPSC 221` and multiple section codes.

- [ ] **Step 6: Write the findings note**

Create `docs/superpowers/notes/2026-08-19-scraper-spike.md` recording: chosen method and why, working selectors or the exact replayable request, the DOM structure of one course row and one section row (paste the HTML), and any pagination behaviour observed for a large subject.

- [ ] **Step 7: Commit**

```bash
rm -f spike.ts
git add tests/fixtures docs/superpowers/notes
git commit -m "docs: record scraper spike findings and save HTML fixtures"
```

---

### Task 4: Catalogue parsers (subjects and terms)

**Files:**
- Create: `src/scrape/parse-catalog.ts`
- Test: `tests/parse-catalog.test.ts`

**Interfaces:**
- Consumes: `tests/fixtures/course-search-form.html` from Task 3.
- Produces:
  - `parseTermOption(value: string, label: string): RawTerm`
  - `parseSubjectOption(value: string, label: string): RawSubject`
  - `parseCatalogForm(html: string): { terms: RawTerm[]; subjects: RawSubject[] }`
  - `type RawTerm = { ubcPeriodId: string; name: string; year: number; session: string; termNumber: number | null; campus: string }`
  - `type RawSubject = { ubcSubjectId: string; name: string; campus: string }`

Label formats observed in the fixture: `"2025-26 Winter Term 1 (UBC-V)"`, `"2026 Summer Session (UBC-V)"`, `"Computer Science (Vancouver)"`, `"Agricultural Sciences (Okanagan)"`.

- [ ] **Step 1: Write the failing tests**

Create `tests/parse-catalog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseTermOption, parseSubjectOption, parseCatalogForm } from '@/scrape/parse-catalog';

describe('parseTermOption', () => {
  it('parses a winter term', () => {
    expect(parseTermOption('1449', '2025-26 Winter Term 1 (UBC-V)')).toEqual({
      ubcPeriodId: '1449',
      name: '2025-26 Winter Term 1 (UBC-V)',
      year: 2025,
      session: 'W',
      termNumber: 1,
      campus: 'V',
    });
  });

  it('parses a summer session with no term number', () => {
    expect(parseTermOption('1452', '2026 Summer Session (UBC-V)')).toEqual({
      ubcPeriodId: '1452',
      name: '2026 Summer Session (UBC-V)',
      year: 2026,
      session: 'S',
      termNumber: null,
      campus: 'V',
    });
  });

  it('parses an Okanagan term', () => {
    expect(parseTermOption('1457', '2025-26 Winter Term 1 (UBC-O)').campus).toBe('O');
  });
});

describe('parseSubjectOption', () => {
  it('parses a Vancouver subject', () => {
    expect(parseSubjectOption('1810', 'Computer Science (Vancouver)')).toEqual({
      ubcSubjectId: '1810',
      name: 'Computer Science',
      campus: 'V',
    });
  });

  it('parses an Okanagan subject', () => {
    expect(parseSubjectOption('1704', 'Agricultural Sciences (Okanagan)')).toEqual({
      ubcSubjectId: '1704',
      name: 'Agricultural Sciences',
      campus: 'O',
    });
  });
});

describe('parseCatalogForm', () => {
  const html = readFileSync('tests/fixtures/course-search-form.html', 'utf8');

  it('extracts many subjects and terms', () => {
    const { terms, subjects } = parseCatalogForm(html);
    expect(terms.length).toBeGreaterThan(5);
    expect(subjects.length).toBeGreaterThan(50);
  });

  it('skips the "- Any -" placeholder option', () => {
    const { subjects } = parseCatalogForm(html);
    expect(subjects.some((s) => s.name.includes('Any'))).toBe(false);
  });

  it('finds Computer Science Vancouver', () => {
    const { subjects } = parseCatalogForm(html);
    expect(subjects).toContainEqual(
      expect.objectContaining({ name: 'Computer Science', campus: 'V' }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- parse-catalog`
Expected: FAIL — cannot resolve `@/scrape/parse-catalog`.

- [ ] **Step 3: Implement the parsers**

Create `src/scrape/parse-catalog.ts`:

```ts
import * as cheerio from 'cheerio';

export type RawTerm = {
  ubcPeriodId: string;
  name: string;
  year: number;
  session: string;
  termNumber: number | null;
  campus: string;
};

export type RawSubject = {
  ubcSubjectId: string;
  name: string;
  campus: string;
};

/** "2025-26 Winter Term 1 (UBC-V)" | "2026 Summer Session (UBC-V)" */
export function parseTermOption(value: string, label: string): RawTerm {
  const text = label.trim();
  const year = Number(text.match(/^(\d{4})/)?.[1]);
  const session = /winter/i.test(text) ? 'W' : /summer/i.test(text) ? 'S' : 'U';
  const termNumber = text.match(/Term\s+(\d)/i) ? Number(text.match(/Term\s+(\d)/i)![1]) : null;
  const campus = /UBC-O/i.test(text) ? 'O' : 'V';
  return { ubcPeriodId: value, name: text, year, session, termNumber, campus };
}

/** "Computer Science (Vancouver)" */
export function parseSubjectOption(value: string, label: string): RawSubject {
  const text = label.trim();
  const campus = /okanagan/i.test(text) ? 'O' : 'V';
  const name = text.replace(/\s*\((Vancouver|Okanagan)\)\s*$/i, '').trim();
  return { ubcSubjectId: value, name, campus };
}

function options($: cheerio.CheerioAPI, selector: string) {
  return $(selector)
    .find('option')
    .toArray()
    .map((el) => ({ value: $(el).attr('value') ?? '', label: $(el).text() }))
    // "- Any -" and friends carry a non-numeric value ("All"); real rows are numeric.
    .filter((o) => /^\d+$/.test(o.value));
}

export function parseCatalogForm(html: string): { terms: RawTerm[]; subjects: RawSubject[] } {
  const $ = cheerio.load(html);
  return {
    terms: options($, '#edit-academic-period').map((o) => parseTermOption(o.value, o.label)),
    subjects: options($, '#edit-subject').map((o) => parseSubjectOption(o.value, o.label)),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- parse-catalog`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/scrape/parse-catalog.ts tests/parse-catalog.test.ts
git commit -m "feat: parse UBC subject and term dropdowns"
```

---

### Task 5: Catalogue scrape job

**Files:**
- Create: `src/scrape/http.ts`, `src/scrape/jobs/catalog.ts`
- Test: `tests/http.test.ts`
- Modify: `package.json` (scripts)

**Interfaces:**
- Consumes: `parseCatalogForm` from Task 4; `db` from Task 2.
- Produces:
  - `fetchText(url: string): Promise<string>` — rate-limited, UA-identified
  - `USER_AGENT: string`
  - `npm run scrape:catalog` populating `Subject` and `Term`

- [ ] **Step 1: Write the failing test for rate limiting**

Create `tests/http.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchText, USER_AGENT } from '@/scrape/http';

describe('fetchText', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('identifies itself with a descriptive User-Agent', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200 }),
    );
    await fetchText('https://example.com');
    const init = spy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/UBCFlow/);
  });

  it('throws on a non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(fetchText('https://example.com')).rejects.toThrow(/500/);
  });

  it('spaces consecutive requests by at least 1s', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
    const start = Date.now();
    await fetchText('https://example.com/a');
    await fetchText('https://example.com/b');
    expect(Date.now() - start).toBeGreaterThanOrEqual(950);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- http`
Expected: FAIL — cannot resolve `@/scrape/http`.

- [ ] **Step 3: Implement the HTTP helper**

Create `src/scrape/http.ts`:

```ts
export const USER_AGENT =
  'UBCFlow/0.1 (course review site; +https://github.com/ryangiang/ubc-flow)';

const MIN_INTERVAL_MS = 1000;
let lastRequestAt = 0;

/** Rate-limited to one request per second across the whole process. */
export async function fetchText(url: string): Promise<string> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.text();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- http`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the catalogue job**

Create `src/scrape/jobs/catalog.ts`:

```ts
import { db } from '@/lib/db';
import { fetchText } from '@/scrape/http';
import { parseCatalogForm } from '@/scrape/parse-catalog';

const SEARCH_URL = 'https://courses.students.ubc.ca/course-search';

export async function scrapeCatalog() {
  const html = await fetchText(SEARCH_URL);
  const { terms, subjects } = parseCatalogForm(html);

  if (terms.length === 0 || subjects.length === 0) {
    throw new Error(
      `Refusing to write: parsed ${terms.length} terms, ${subjects.length} subjects. ` +
        'UBC markup likely changed.',
    );
  }

  for (const t of terms) {
    await db.term.upsert({
      where: { ubcPeriodId: t.ubcPeriodId },
      create: t,
      update: t,
    });
  }

  for (const s of subjects) {
    await db.subject.upsert({
      where: { ubcSubjectId_campus: { ubcSubjectId: s.ubcSubjectId, campus: s.campus } },
      create: s,
      update: { name: s.name },
    });
  }

  console.log(`Upserted ${terms.length} terms, ${subjects.length} subjects.`);
}

scrapeCatalog()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
```

- [ ] **Step 6: Add the npm script**

Add to `package.json` scripts:

```json
"scrape:catalog": "tsx src/scrape/jobs/catalog.ts"
```

- [ ] **Step 7: Run the job for real**

Run: `npm run scrape:catalog`
Expected: prints a count with >5 terms and >50 subjects, exits 0.

- [ ] **Step 8: Verify idempotency**

Run: `npm run scrape:catalog` a second time. Then:

```bash
npx prisma studio
```

Confirm `Term` and `Subject` row counts are unchanged after the second run — no duplicates.

- [ ] **Step 9: Commit**

```bash
git add src/scrape tests/http.test.ts package.json
git commit -m "feat: scrape UBC subjects and terms"
```

---

### Task 6: Section and instructor-name parsers

**Files:**
- Create: `src/scrape/parse-sections.ts`, `src/scrape/names.ts`
- Test: `tests/parse-sections.test.ts`, `tests/names.test.ts`

**Interfaces:**
- Consumes: `tests/fixtures/course-search-cpsc.html` and the row structure recorded in Task 3's notes.
- Produces:
  - `normalizeInstructorName(raw: string): { name: string; slug: string }`
  - `parseSections(html: string): RawCourseSection[]`
  - `type RawCourseSection = { subjectCode: string; courseNumber: string; courseTitle: string; sectionCode: string; activity: string | null; status: string | null; deliveryMode: string | null; instructorNames: string[]; meetings: RawMeeting[] }`
  - `type RawMeeting = { day: string; startTime: string | null; endTime: string | null; building: string | null; room: string | null }`

**Instructor name hazard (spec §5.1):** UBC renders names as `"Smith, John"`, `"John Smith"`, `"SMITH, J"`. Normalise before storing; collisions are a data-quality issue to surface, never to silently merge.

- [ ] **Step 1: Write the failing name tests**

Create `tests/names.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeInstructorName } from '@/scrape/names';

describe('normalizeInstructorName', () => {
  it('flips "Last, First" to "First Last"', () => {
    expect(normalizeInstructorName('Smith, John')).toEqual({
      name: 'John Smith',
      slug: 'john-smith',
    });
  });

  it('leaves "First Last" alone', () => {
    expect(normalizeInstructorName('John Smith')).toEqual({
      name: 'John Smith',
      slug: 'john-smith',
    });
  });

  it('title-cases shouting input', () => {
    expect(normalizeInstructorName('SMITH, JOHN').name).toBe('John Smith');
  });

  it('collapses whitespace', () => {
    expect(normalizeInstructorName('  Smith,   John  ').name).toBe('John Smith');
  });

  it('handles hyphenated and accented names', () => {
    expect(normalizeInstructorName('Garcia-Lopez, Ana').name).toBe('Ana Garcia-Lopez');
    expect(normalizeInstructorName('Muller, Jorg').slug).toBe('jorg-muller');
  });

  it('handles a single-token name', () => {
    expect(normalizeInstructorName('Plato')).toEqual({ name: 'Plato', slug: 'plato' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- names`
Expected: FAIL — cannot resolve `@/scrape/names`.

- [ ] **Step 3: Implement name normalisation**

Create `src/scrape/names.ts`:

```ts
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s\-'])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

export function normalizeInstructorName(raw: string): { name: string; slug: string } {
  const cleaned = raw.replace(/\s+/g, ' ').trim();

  const [last, first] = cleaned.includes(',')
    ? cleaned.split(',').map((p) => p.trim())
    : [null, null];

  const ordered = last && first ? `${first} ${last}` : cleaned;
  const name = titleCase(ordered);

  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return { name, slug };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- names`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing section-parser tests**

Create `tests/parse-sections.test.ts`. **Adjust the expected values to match the real fixture** — read `docs/superpowers/notes/2026-08-19-scraper-spike.md` for the actual row structure first, and assert against courses genuinely present in the fixture.

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseSections } from '@/scrape/parse-sections';

const html = readFileSync('tests/fixtures/course-search-cpsc.html', 'utf8');

describe('parseSections', () => {
  const rows = parseSections(html);

  it('finds many sections', () => {
    expect(rows.length).toBeGreaterThan(10);
  });

  it('parses subject code and course number off every row', () => {
    for (const r of rows) {
      expect(r.subjectCode).toBe('CPSC');
      expect(r.courseNumber).toMatch(/^\d{3}[A-Z]?$/);
    }
  });

  it('captures a known course', () => {
    expect(rows.some((r) => r.courseNumber === '221')).toBe(true);
  });

  it('never emits an empty section code', () => {
    expect(rows.every((r) => r.sectionCode.length > 0)).toBe(true);
  });

  it('emits meeting times with a day', () => {
    const withMeetings = rows.filter((r) => r.meetings.length > 0);
    expect(withMeetings.length).toBeGreaterThan(0);
    for (const m of withMeetings[0].meetings) {
      expect(m.day.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test -- parse-sections`
Expected: FAIL — cannot resolve `@/scrape/parse-sections`.

- [ ] **Step 7: Implement the section parser**

Create `src/scrape/parse-sections.ts`. **The selectors below are a starting template — replace them with the real ones recorded in Task 3's spike notes.** The exported types and function signature must not change.

```ts
import * as cheerio from 'cheerio';

export type RawMeeting = {
  day: string;
  startTime: string | null;
  endTime: string | null;
  building: string | null;
  room: string | null;
};

export type RawCourseSection = {
  subjectCode: string;
  courseNumber: string;
  courseTitle: string;
  sectionCode: string;
  activity: string | null;
  status: string | null;
  deliveryMode: string | null;
  instructorNames: string[];
  meetings: RawMeeting[];
};

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const orNull = (s: string) => (clean(s).length ? clean(s) : null);

/** "CPSC 221 101" -> { subjectCode, courseNumber, sectionCode } */
export function parseSectionName(raw: string) {
  const m = clean(raw).match(/^([A-Z]{2,5})\s+(\d{3}[A-Z]?)\s+(\S+)$/);
  if (!m) return null;
  return { subjectCode: m[1], courseNumber: m[2], sectionCode: m[3] };
}

/** "Mon Wed Fri 09:00 - 10:00 SWNG 222" */
export function parseMeeting(raw: string): RawMeeting[] {
  const text = clean(raw);
  const days = text.match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/g) ?? [];
  const time = text.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  const place = text.match(/\b([A-Z]{3,5})\s+(\w+)\s*$/);

  return days.map((day) => ({
    day,
    startTime: time?.[1] ?? null,
    endTime: time?.[2] ?? null,
    building: place?.[1] ?? null,
    room: place?.[2] ?? null,
  }));
}

export function parseSections(html: string): RawCourseSection[] {
  const $ = cheerio.load(html);
  const out: RawCourseSection[] = [];

  $('table tbody tr').each((_, tr) => {
    const cells = $(tr).find('td').toArray().map((td) => clean($(td).text()));
    if (cells.length < 4) return;

    const name = parseSectionName(cells[0]);
    if (!name) return;

    out.push({
      ...name,
      courseTitle: cells[1] ?? '',
      activity: orNull(cells[2] ?? ''),
      status: orNull(cells[3] ?? ''),
      deliveryMode: orNull(cells[4] ?? ''),
      instructorNames: (cells[6] ?? '')
        .split(';')
        .map(clean)
        .filter(Boolean),
      meetings: parseMeeting(cells[5] ?? ''),
    });
  });

  return out;
}
```

- [ ] **Step 8: Iterate until tests pass**

Run: `npm test -- parse-sections`

Inspect the fixture's real markup and adjust selectors and cell indices until all assertions pass. Expected: PASS, 5 tests.

- [ ] **Step 9: Commit**

```bash
git add src/scrape/parse-sections.ts src/scrape/names.ts tests/parse-sections.test.ts tests/names.test.ts
git commit -m "feat: parse UBC course sections and normalise instructor names"
```

---

### Task 7: Section scrape job with safety guard

**Files:**
- Create: `src/scrape/fetch-sections.ts`, `src/scrape/jobs/sections.ts`
- Test: `tests/upsert-sections.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `parseSections`, `normalizeInstructorName`, `db`.
- Produces:
  - `fetchSectionsHtml(campus: string, ubcPeriodId: string, ubcSubjectId: string): Promise<string>`
  - `upsertSections(rows: RawCourseSection[], termId: string, campus: string): Promise<void>`
  - `npm run scrape:sections`

**Why the numeric subject ID, not the code:** `Subject.code` (`CPSC`) is null until a
course row backfills it (Task 2 note), so a code-driven scrape cannot bootstrap — on
the first run there is no code to search with, and no way to obtain one. The numeric
`ubcSubjectId` comes from the dropdown in Task 5 and is always present, so the scrape
drives off `#edit-subject` and the code falls out of the returned rows.

**Safety guard (spec §6.2):** a run yielding fewer than 80% of the previous run's section count for a subject must abort without writing, so an upstream markup change degrades to stale data rather than wiping the catalogue.

- [ ] **Step 1: Implement the fetcher**

Create `src/scrape/fetch-sections.ts`. Use the method chosen in Task 3. Playwright version:

```ts
import { chromium } from 'playwright';
import { USER_AGENT } from '@/scrape/http';

const SEARCH_URL = 'https://courses.students.ubc.ca/course-search';

export async function fetchSectionsHtml(
  campus: string,
  ubcPeriodId: string,
  ubcSubjectId: string,
): Promise<string> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded' });
    await page.check(campus === 'V' ? '#edit-campus-1' : '#edit-campus-2');
    await page.selectOption('#edit-academic-period', ubcPeriodId);
    // Numeric subject ID, not the code — the code is unknown on a cold database.
    await page.selectOption('#edit-subject', ubcSubjectId);
    await page.click('#edit-submit-new-course-search');
    await page.waitForLoadState('networkidle');
    return await page.content();
  } finally {
    await browser.close();
  }
}
```

If Task 3 chose AJAX replay, replace this function's body with that request. **Keep the signature identical** — Task 7's job code depends on it.

- [ ] **Step 2: Write the failing idempotency test**

Create `tests/upsert-sections.test.ts`. This test touches Postgres.

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '@/lib/db';
import { upsertSections } from '@/scrape/jobs/sections';
import type { RawCourseSection } from '@/scrape/parse-sections';

const rows: RawCourseSection[] = [
  {
    subjectCode: 'TEST',
    courseNumber: '101',
    courseTitle: 'Test Course',
    sectionCode: '101',
    activity: 'Lecture',
    status: 'Available',
    deliveryMode: 'In-Person',
    instructorNames: ['Smith, John'],
    meetings: [
      { day: 'Mon', startTime: '09:00', endTime: '10:00', building: 'SWNG', room: '222' },
    ],
  },
];

describe('upsertSections', () => {
  let termId: string;
  let subjectId: string;

  beforeAll(async () => {
    const term = await db.term.upsert({
      where: { ubcPeriodId: 'TEST-PERIOD' },
      create: {
        ubcPeriodId: 'TEST-PERIOD',
        name: 'Test Term',
        year: 2026,
        session: 'W',
        termNumber: 1,
        campus: 'V',
      },
      update: {},
    });
    termId = term.id;
    const subject = await db.subject.upsert({
      where: { ubcSubjectId_campus: { ubcSubjectId: 'TEST-SUBJ', campus: 'V' } },
      create: { ubcSubjectId: 'TEST-SUBJ', name: 'Testing', campus: 'V', code: 'TEST' },
      update: {},
    });
    subjectId = subject.id;
  });

  it('is idempotent across repeated runs', async () => {
    await upsertSections(rows, termId, 'V');
    await upsertSections(rows, termId, 'V');

    const courses = await db.course.count({ where: { subjectId } });
    const sections = await db.section.count({ where: { termId } });
    const meetings = await db.meetingTime.count();
    const instructors = await db.instructor.count({ where: { slug: 'john-smith' } });

    expect(courses).toBe(1);
    expect(sections).toBe(1);
    expect(meetings).toBe(1);
    expect(instructors).toBe(1);
  });

  it('backfills the subject code from the course rows', async () => {
    const subject = await db.subject.findUnique({ where: { id: subjectId } });
    expect(subject?.code).toBe('TEST');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- upsert-sections`
Expected: FAIL — `upsertSections` is not exported.

- [ ] **Step 4: Implement the job**

Create `src/scrape/jobs/sections.ts`:

```ts
import { db } from '@/lib/db';
import { fetchSectionsHtml } from '@/scrape/fetch-sections';
import { parseSections, type RawCourseSection } from '@/scrape/parse-sections';
import { normalizeInstructorName } from '@/scrape/names';

const CAMPUS = 'V';
const MIN_RETAINED_FRACTION = 0.8;

export async function upsertSections(
  rows: RawCourseSection[],
  termId: string,
  campus: string,
) {
  for (const row of rows) {
    const subject = await db.subject.findFirst({
      where: { code: row.subjectCode, campus },
    });
    if (!subject) {
      console.warn(`No subject for ${row.subjectCode} (${campus}), skipping`);
      continue;
    }

    const course = await db.course.upsert({
      where: { subjectId_number: { subjectId: subject.id, number: row.courseNumber } },
      create: {
        subjectId: subject.id,
        number: row.courseNumber,
        title: row.courseTitle,
        campus,
      },
      update: { title: row.courseTitle },
    });

    const section = await db.section.upsert({
      where: {
        courseId_termId_sectionCode: {
          courseId: course.id,
          termId,
          sectionCode: row.sectionCode,
        },
      },
      create: {
        courseId: course.id,
        termId,
        sectionCode: row.sectionCode,
        activity: row.activity,
        status: row.status,
        deliveryMode: row.deliveryMode,
      },
      update: {
        activity: row.activity,
        status: row.status,
        deliveryMode: row.deliveryMode,
      },
    });

    // Meetings have no natural key; replace wholesale so re-runs stay idempotent.
    await db.meetingTime.deleteMany({ where: { sectionId: section.id } });
    if (row.meetings.length) {
      await db.meetingTime.createMany({
        data: row.meetings.map((m) => ({ ...m, sectionId: section.id })),
      });
    }

    for (const raw of row.instructorNames) {
      const { name, slug } = normalizeInstructorName(raw);
      const instructor = await db.instructor.upsert({
        where: { slug },
        create: { name, slug, campus },
        update: {},
      });
      await db.sectionInstructor.upsert({
        where: {
          sectionId_instructorId: { sectionId: section.id, instructorId: instructor.id },
        },
        create: { sectionId: section.id, instructorId: instructor.id },
        update: {},
      });
    }
  }
}

/** Subject codes only appear in course rows, never the dropdown — backfill here. */
async function backfillSubjectCode(ubcSubjectId: string, campus: string, code: string) {
  await db.subject.update({
    where: { ubcSubjectId_campus: { ubcSubjectId, campus } },
    data: { code },
  });
}

export async function scrapeSections() {
  const now = new Date().getFullYear();
  const terms = await db.term.findMany({
    where: { campus: CAMPUS, year: { gte: now - 2, lte: now + 1 } },
  });
  const subjects = await db.subject.findMany({ where: { campus: CAMPUS } });

  for (const term of terms) {
    for (const subject of subjects) {
      const label = subject.code ?? subject.name;
      let rows: RawCourseSection[];
      try {
        rows = parseSections(
          await fetchSectionsHtml(CAMPUS, term.ubcPeriodId, subject.ubcSubjectId),
        );
      } catch (e) {
        console.error(`Fetch failed for ${label} ${term.name}:`, e);
        continue;
      }

      if (rows.length === 0) continue;

      // Codes only exist in course rows; backfill before upserting, which looks up by code.
      if (!subject.code) {
        await backfillSubjectCode(subject.ubcSubjectId, CAMPUS, rows[0].subjectCode);
      }

      const previous = await db.section.count({
        where: { termId: term.id, course: { subjectId: subject.id } },
      });
      if (previous > 0 && rows.length < previous * MIN_RETAINED_FRACTION) {
        console.error(
          `ABORT ${label} ${term.name}: parsed ${rows.length} sections vs ${previous} previously. ` +
            'UBC markup likely changed — refusing to write.',
        );
        continue;
      }

      await upsertSections(rows, term.id, CAMPUS);
      console.log(`${term.name} ${label}: ${rows.length} sections`);
    }
  }
}
```

Append a CLI entrypoint in a separate file so importing the module in tests does not trigger a scrape. Create `src/scrape/jobs/sections.run.ts`:

```ts
import { db } from '@/lib/db';
import { scrapeSections } from '@/scrape/jobs/sections';

scrapeSections()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- upsert-sections`
Expected: PASS, 2 tests.

- [ ] **Step 6: Add the npm script**

```json
"scrape:sections": "tsx src/scrape/jobs/sections.run.ts"
```

- [ ] **Step 7: Run a limited real scrape**

Temporarily narrow `scrapeSections` to one subject and one term — filter `subjects` to
`s.ubcSubjectId === '1810'` (Computer Science, Vancouver) and `terms` to the newest — then run:

```bash
npm run scrape:sections
```

Expected: prints a section count > 10. Verify in `npx prisma studio` that `Course`, `Section`, `MeetingTime`, and `Instructor` are populated. Then remove the narrowing.

- [ ] **Step 8: Commit**

```bash
git add src/scrape package.json tests/upsert-sections.test.ts
git commit -m "feat: scrape UBC course sections with markup-change guard"
```

---

### Task 8: Course description enrichment

**Files:**
- Create: `src/scrape/parse-descriptions.ts`, `src/scrape/jobs/descriptions.ts`
- Test: `tests/parse-descriptions.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `db`, `fetchSectionsHtml` pattern from Task 7 (the calendar is JS-rendered too — see spec §3.2).
- Produces:
  - `parseCourseDescriptions(html: string): RawDescription[]`
  - `type RawDescription = { subjectCode: string; courseNumber: string; title: string; description: string | null; credits: number | null; prereqText: string | null; coreqText: string | null }`
  - `npm run scrape:descriptions`

**Source:** `https://vancouver.calendar.ubc.ca/course-descriptions/subject/<code>` — note the subject index returned only 3 nav links to a plain GET, so this page is JS-rendered. Capture a fixture with Playwright exactly as in Task 3 before writing the parser.

- [ ] **Step 1: Capture a fixture**

Write a throwaway script using `chromium` to save `https://vancouver.calendar.ubc.ca/course-descriptions/subject/cpsc` (confirm the real URL pattern — the lowercase `/subject/cpsc` form 404'd during research; find the working one from the index page in a browser) to `tests/fixtures/calendar-cpsc.html`. Confirm it contains `CPSC 221` and prose containing `Prerequisite`.

- [ ] **Step 2: Write the failing tests**

Create `tests/parse-descriptions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCourseDescriptions } from '@/scrape/parse-descriptions';

const html = readFileSync('tests/fixtures/calendar-cpsc.html', 'utf8');

describe('parseCourseDescriptions', () => {
  const rows = parseCourseDescriptions(html);

  it('finds many courses', () => {
    expect(rows.length).toBeGreaterThan(10);
  });

  it('extracts credits as a number', () => {
    const withCredits = rows.filter((r) => r.credits !== null);
    expect(withCredits.length).toBeGreaterThan(0);
    expect(withCredits[0].credits).toBeGreaterThan(0);
  });

  it('captures prerequisite prose verbatim when present', () => {
    const withPrereq = rows.filter((r) => r.prereqText);
    expect(withPrereq.length).toBeGreaterThan(0);
    expect(withPrereq[0].prereqText).not.toMatch(/^Prerequisite:\s*$/);
  });

  it('never returns an empty course number', () => {
    expect(rows.every((r) => r.courseNumber.length > 0)).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- parse-descriptions`
Expected: FAIL — cannot resolve `@/scrape/parse-descriptions`.

- [ ] **Step 4: Implement the parser**

Create `src/scrape/parse-descriptions.ts`. Adjust selectors to the real fixture; keep the signature.

```ts
import * as cheerio from 'cheerio';

export type RawDescription = {
  subjectCode: string;
  courseNumber: string;
  title: string;
  description: string | null;
  credits: number | null;
  prereqText: string | null;
  coreqText: string | null;
};

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** "CPSC 221 (4) Basic Algorithms and Data Structures" */
export function parseCourseHeading(raw: string) {
  const m = clean(raw).match(/^([A-Z]{2,5})\s+(\d{3}[A-Z]?)\s*(?:\((\d+(?:\.\d+)?)\))?\s*(.*)$/);
  if (!m) return null;
  return {
    subjectCode: m[1],
    courseNumber: m[2],
    credits: m[3] ? Number(m[3]) : null,
    title: m[4] ?? '',
  };
}

export function parseCourseDescriptions(html: string): RawDescription[] {
  const $ = cheerio.load(html);
  const out: RawDescription[] = [];

  $('.course-description, article, .node--type-course').each((_, el) => {
    const heading = parseCourseHeading($(el).find('h3, h2, .course-title').first().text());
    if (!heading) return;

    const body = clean($(el).text());
    const prereq = body.match(/Prerequisite:\s*([^.]*\.)/i)?.[1] ?? null;
    const coreq = body.match(/Corequisite:\s*([^.]*\.)/i)?.[1] ?? null;
    const description =
      clean($(el).find('p').first().text()) || null;

    out.push({ ...heading, description, prereqText: prereq, coreqText: coreq });
  });

  return out;
}
```

- [ ] **Step 5: Iterate until tests pass**

Run: `npm test -- parse-descriptions`
Expected: PASS, 4 tests. Adjust selectors against the fixture as needed.

- [ ] **Step 6: Write the enrichment job**

Create `src/scrape/jobs/descriptions.ts`:

```ts
import { db } from '@/lib/db';
import { parseCourseDescriptions } from '@/scrape/parse-descriptions';
import { fetchCalendarHtml } from '@/scrape/fetch-sections';

export async function scrapeDescriptions() {
  const subjects = await db.subject.findMany({
    where: { campus: 'V', code: { not: null } },
  });

  for (const subject of subjects) {
    let rows;
    try {
      rows = parseCourseDescriptions(await fetchCalendarHtml(subject.code!));
    } catch (e) {
      console.error(`Calendar fetch failed for ${subject.code}:`, e);
      continue;
    }

    for (const row of rows) {
      const course = await db.course.findFirst({
        where: { subjectId: subject.id, number: row.courseNumber },
      });
      if (!course) continue;

      await db.course.update({
        where: { id: course.id },
        data: {
          description: row.description,
          credits: row.credits,
          prereqText: row.prereqText,
          coreqText: row.coreqText,
        },
      });
    }
    console.log(`${subject.code}: enriched ${rows.length} courses`);
  }
}
```

Add `fetchCalendarHtml(subjectCode: string): Promise<string>` to `src/scrape/fetch-sections.ts`, mirroring `fetchSectionsHtml` but navigating to the calendar URL confirmed in Step 1 and returning `page.content()`.

Create `src/scrape/jobs/descriptions.run.ts` following the Task 7 entrypoint pattern, and add:

```json
"scrape:descriptions": "tsx src/scrape/jobs/descriptions.run.ts"
```

- [ ] **Step 7: Run it for real**

Run: `npm run scrape:descriptions`
Expected: prints per-subject counts. Confirm in Prisma Studio that `Course.description` and `Course.credits` are populated.

- [ ] **Step 8: Commit**

```bash
git add src/scrape tests/parse-descriptions.test.ts tests/fixtures package.json
git commit -m "feat: enrich courses with calendar descriptions and prerequisites"
```

---

### Task 9: Course detail page

**Files:**
- Create: `src/app/course/[code]/page.tsx`, `src/lib/format.ts`
- Test: `tests/format.test.ts`

**Interfaces:**
- Consumes: `db`.
- Produces:
  - `parseCourseCode(code: string): { subjectCode: string; number: string } | null`
  - `formatMeeting(m: { day: string; startTime: string | null; endTime: string | null; building: string | null; room: string | null }): string`
  - route `/course/cpsc-221`

- [ ] **Step 1: Write the failing formatter tests**

Create `tests/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseCourseCode, formatMeeting } from '@/lib/format';

describe('parseCourseCode', () => {
  it('splits a url slug into subject and number', () => {
    expect(parseCourseCode('cpsc-221')).toEqual({ subjectCode: 'CPSC', number: '221' });
  });

  it('handles a lettered course number', () => {
    expect(parseCourseCode('math-100a')).toEqual({ subjectCode: 'MATH', number: '100A' });
  });

  it('returns null on garbage', () => {
    expect(parseCourseCode('nonsense')).toBeNull();
  });
});

describe('formatMeeting', () => {
  it('renders day, time and place', () => {
    expect(
      formatMeeting({
        day: 'Mon',
        startTime: '09:00',
        endTime: '10:00',
        building: 'SWNG',
        room: '222',
      }),
    ).toBe('Mon 09:00-10:00 · SWNG 222');
  });

  it('omits the place when unknown', () => {
    expect(
      formatMeeting({ day: 'Tue', startTime: '13:00', endTime: '14:00', building: null, room: null }),
    ).toBe('Tue 13:00-14:00');
  });

  it('handles a day with no time', () => {
    expect(
      formatMeeting({ day: 'Wed', startTime: null, endTime: null, building: null, room: null }),
    ).toBe('Wed');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- format`
Expected: FAIL — cannot resolve `@/lib/format`.

- [ ] **Step 3: Implement the formatters**

Create `src/lib/format.ts`:

```ts
export function parseCourseCode(code: string): { subjectCode: string; number: string } | null {
  const m = code.match(/^([a-z]{2,5})-(\d{3}[a-z]?)$/i);
  if (!m) return null;
  return { subjectCode: m[1].toUpperCase(), number: m[2].toUpperCase() };
}

export function formatMeeting(m: {
  day: string;
  startTime: string | null;
  endTime: string | null;
  building: string | null;
  room: string | null;
}): string {
  const time = m.startTime && m.endTime ? ` ${m.startTime}-${m.endTime}` : '';
  const place = m.building ? ` · ${m.building}${m.room ? ` ${m.room}` : ''}` : '';
  return `${m.day}${time}${place}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- format`
Expected: PASS, 6 tests.

- [ ] **Step 5: Build the course page**

Create `src/app/course/[code]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { parseCourseCode, formatMeeting } from '@/lib/format';

export default async function CoursePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const parsed = parseCourseCode(code);
  if (!parsed) notFound();

  const course = await db.course.findFirst({
    where: {
      number: parsed.number,
      subject: { code: parsed.subjectCode, campus: 'V' },
    },
    include: {
      subject: true,
      sections: {
        include: {
          term: true,
          meetingTimes: true,
          instructors: { include: { instructor: true } },
        },
        orderBy: { sectionCode: 'asc' },
      },
    },
  });
  if (!course) notFound();

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <p className="text-sm text-slate-500">{course.subject.name}</p>
      <h1 className="text-3xl font-semibold">
        {course.subject.code} {course.number}
      </h1>
      <p className="mt-1 text-lg text-slate-700">{course.title}</p>

      {course.credits !== null && (
        <p className="mt-2 text-sm text-slate-500">{course.credits} credits</p>
      )}
      {course.description && <p className="mt-6 leading-relaxed">{course.description}</p>}

      {course.prereqText && (
        <p className="mt-4 text-sm text-slate-600">
          <span className="font-medium">Prerequisites: </span>
          {course.prereqText}
        </p>
      )}

      <h2 className="mt-10 text-xl font-semibold">Sections</h2>
      {course.sections.length === 0 ? (
        <p className="mt-2 text-slate-500">No scheduled sections.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-slate-500">
              <tr>
                <th className="py-2 pr-4">Section</th>
                <th className="py-2 pr-4">Term</th>
                <th className="py-2 pr-4">Activity</th>
                <th className="py-2 pr-4">Times</th>
                <th className="py-2">Instructor</th>
              </tr>
            </thead>
            <tbody>
              {course.sections.map((s) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="py-2 pr-4 font-medium">{s.sectionCode}</td>
                  <td className="py-2 pr-4">{s.term.name}</td>
                  <td className="py-2 pr-4">{s.activity ?? '—'}</td>
                  <td className="py-2 pr-4">
                    {s.meetingTimes.length
                      ? s.meetingTimes.map((m) => formatMeeting(m)).join(', ')
                      : '—'}
                  </td>
                  <td className="py-2">
                    {s.instructors.length
                      ? s.instructors.map((si) => (
                          <Link
                            key={si.instructorId}
                            href={`/professor/${si.instructor.slug}`}
                            className="text-blue-700 hover:underline"
                          >
                            {si.instructor.name}
                          </Link>
                        ))
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 6: Verify in the browser**

Run `npm run dev`, open `http://localhost:3000/course/cpsc-221`. Confirm title, description, and a populated sections table with instructor links. Confirm `/course/nonsense` returns 404.

- [ ] **Step 7: Commit**

```bash
git add src/app/course src/lib/format.ts tests/format.test.ts
git commit -m "feat: add course detail page"
```

---

### Task 10: Professor detail page

**Files:**
- Create: `src/app/professor/[slug]/page.tsx`

**Interfaces:**
- Consumes: `db` from Task 2.
- Produces: route `/professor/<slug>`.

- [ ] **Step 1: Build the page**

Create `src/app/professor/[slug]/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';

export default async function ProfessorPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const instructor = await db.instructor.findUnique({
    where: { slug },
    include: {
      sections: {
        include: {
          section: {
            include: { term: true, course: { include: { subject: true } } },
          },
        },
      },
    },
  });
  if (!instructor) notFound();

  // One row per course, newest term first.
  const byCourse = new Map<
    string,
    { code: string; title: string; terms: Set<string> }
  >();
  for (const { section } of instructor.sections) {
    const code = `${section.course.subject.code} ${section.course.number}`;
    const entry = byCourse.get(code) ?? {
      code,
      title: section.course.title,
      terms: new Set<string>(),
    };
    entry.terms.add(section.term.name);
    byCourse.set(code, entry);
  }
  const courses = [...byCourse.values()].sort((a, b) => a.code.localeCompare(b.code));

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-3xl font-semibold">{instructor.name}</h1>
      <p className="mt-1 text-sm text-slate-500">
        {courses.length} course{courses.length === 1 ? '' : 's'} taught
      </p>

      <h2 className="mt-10 text-xl font-semibold">Courses</h2>
      {courses.length === 0 ? (
        <p className="mt-2 text-slate-500">No courses on record.</p>
      ) : (
        <ul className="mt-4 divide-y">
          {courses.map((c) => (
            <li key={c.code} className="py-3">
              <Link
                href={`/course/${c.code.toLowerCase().replace(' ', '-')}`}
                className="font-medium text-blue-700 hover:underline"
              >
                {c.code}
              </Link>
              <span className="ml-2 text-slate-700">{c.title}</span>
              <p className="mt-1 text-sm text-slate-500">{[...c.terms].join(' · ')}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify in the browser**

Run `npm run dev`. From a course page, click an instructor link. Confirm the professor page lists their courses and each course link navigates back correctly. Confirm `/professor/nobody` returns 404.

- [ ] **Step 3: Commit**

```bash
git add src/app/professor
git commit -m "feat: add professor detail page"
```

---

### Task 11: Search and browse

**Files:**
- Create: `src/lib/search.ts`, `src/app/explore/page.tsx`
- Modify: `src/app/page.tsx`
- Test: `tests/search.test.ts`

**Interfaces:**
- Consumes: `db`.
- Produces:
  - `searchCourses(query: string, limit?: number): Promise<CourseHit[]>` exported from `src/lib/search.ts`
  - `type CourseHit = { code: string; title: string; subjectName: string }`
  - routes `/` (search) and `/explore` (browse by subject)

Search is Postgres `ILIKE` over course code and title (spec §6.3). Full-text or a search service only if this measurably falls short.

- [ ] **Step 1: Write the failing search test**

Create `tests/search.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildSearchWhere } from '@/lib/search';

describe('buildSearchWhere', () => {
  it('matches a subject code and number typed together', () => {
    const where = buildSearchWhere('cpsc 221');
    expect(where.AND).toBeDefined();
    expect(JSON.stringify(where)).toContain('CPSC');
    expect(JSON.stringify(where)).toContain('221');
  });

  it('matches a bare subject code', () => {
    expect(JSON.stringify(buildSearchWhere('cpsc'))).toContain('CPSC');
  });

  it('falls back to a title search for prose', () => {
    expect(JSON.stringify(buildSearchWhere('data structures'))).toContain('data structures');
  });

  it('handles empty input without throwing', () => {
    expect(() => buildSearchWhere('')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- search`
Expected: FAIL — cannot resolve `@/lib/search`.

- [ ] **Step 3: Implement search**

Create `src/lib/search.ts`:

```ts
import { db } from '@/lib/db';
import type { Prisma } from '@prisma/client';

export type CourseHit = { code: string; title: string; subjectName: string };

/** "cpsc 221" -> code+number match; "cpsc" -> code; anything else -> title. */
export function buildSearchWhere(query: string): Prisma.CourseWhereInput {
  const q = query.trim();
  if (!q) return {};

  const codeAndNumber = q.match(/^([a-z]{2,5})\s*(\d{1,3}[a-z]?)$/i);
  if (codeAndNumber) {
    return {
      AND: [
        { subject: { code: codeAndNumber[1].toUpperCase() } },
        { number: { startsWith: codeAndNumber[2].toUpperCase() } },
      ],
    };
  }

  if (/^[a-z]{2,5}$/i.test(q)) {
    return { subject: { code: q.toUpperCase() } };
  }

  return { title: { contains: q, mode: 'insensitive' } };
}

export async function searchCourses(query: string, limit = 25): Promise<CourseHit[]> {
  const courses = await db.course.findMany({
    where: { ...buildSearchWhere(query), campus: 'V' },
    include: { subject: true },
    take: limit,
    orderBy: [{ subject: { code: 'asc' } }, { number: 'asc' }],
  });

  return courses.map((c) => ({
    code: `${c.subject.code} ${c.number}`,
    title: c.title,
    subjectName: c.subject.name,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- search`
Expected: PASS, 4 tests.

- [ ] **Step 5: Build the home page with search**

Replace `src/app/page.tsx`:

```tsx
import Link from 'next/link';
import { searchCourses } from '@/lib/search';

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = '' } = await searchParams;
  const results = q ? await searchCourses(q) : [];

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-4xl font-semibold">UBC Flow</h1>
      <p className="mt-2 text-slate-600">Find courses and professors at UBC.</p>

      <form className="mt-8 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Try CPSC 221, or “data structures”"
          className="flex-1 rounded-lg border px-4 py-2"
        />
        <button className="rounded-lg bg-blue-700 px-5 py-2 text-white">Search</button>
      </form>

      {q && (
        <section className="mt-10">
          <p className="text-sm text-slate-500">
            {results.length} result{results.length === 1 ? '' : 's'} for “{q}”
          </p>
          <ul className="mt-4 divide-y">
            {results.map((r) => (
              <li key={r.code} className="py-3">
                <Link
                  href={`/course/${r.code.toLowerCase().replace(' ', '-')}`}
                  className="font-medium text-blue-700 hover:underline"
                >
                  {r.code}
                </Link>
                <span className="ml-2 text-slate-700">{r.title}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-12">
        <Link href="/explore" className="text-blue-700 hover:underline">
          Browse all subjects →
        </Link>
      </p>
    </main>
  );
}
```

- [ ] **Step 6: Build the browse page**

Create `src/app/explore/page.tsx`:

```tsx
import Link from 'next/link';
import { db } from '@/lib/db';

export default async function Explore() {
  const subjects = await db.subject.findMany({
    where: { campus: 'V', code: { not: null } },
    include: { _count: { select: { courses: true } } },
    orderBy: { code: 'asc' },
  });

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-3xl font-semibold">Browse subjects</h1>
      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {subjects.map((s) => (
          <li key={s.id} className="rounded-lg border p-4">
            <Link href={`/?q=${s.code}`} className="font-medium text-blue-700 hover:underline">
              {s.code}
            </Link>
            <p className="text-sm text-slate-700">{s.name}</p>
            <p className="mt-1 text-xs text-slate-500">{s._count.courses} courses</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 7: Verify the full flow**

Run `npm run dev`. Confirm end to end: search `CPSC 221` → click result → course page → click instructor → professor page → click course → back to a course page. Then `/explore` → click a subject → filtered results.

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: PASS, all tests across all files.

- [ ] **Step 9: Commit**

```bash
git add src/app src/lib/search.ts tests/search.test.ts
git commit -m "feat: add course search and subject browse"
```

---

## Phase 1 completion criteria

- [ ] `npm test` passes with no skipped tests
- [ ] `npm run scrape:catalog`, `scrape:sections`, `scrape:descriptions` each run clean and are idempotent on re-run
- [ ] A visitor can search a course, view its sections and instructors, and navigate to a professor page
- [ ] No authentication, ratings, or review UI exists — that is Phases 2 and 3
