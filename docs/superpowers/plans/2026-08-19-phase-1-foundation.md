# UBC Flow Phase 1: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a browsable, read-only UBC course catalogue — searchable course and professor pages backed by scheduled scrapes of live UBC data.

**Architecture:** A single Next.js (App Router) TypeScript application with Prisma over Postgres. Scrapers are standalone `tsx` scripts sharing the same Prisma client, run on a schedule, writing to our database — never live proxies on the request path. All HTML parsing lives in **pure functions** (`html string → structured data`) so the test suite needs no network and no database; only idempotency tests touch Postgres.

**Tech Stack:** Next.js (App Router), TypeScript, Prisma, Postgres, Tailwind + shadcn/ui, Vitest, Cheerio (form dropdowns + course body HTML), tsx.

> **Revised after the Task 3 spike.** The spike found an open, unauthenticated
> Drupal **JSON:API** at `courses.students.ubc.ca/jsonapi` — verified with bare
> `curl`, no cookies. Tasks 6-8 therefore parse structured JSON rather than
> scraping theme markup, and **Playwright is not used in the production path**
> (it remains installed, and was the tool that discovered the API). The academic
> calendar at `vancouver.calendar.ubc.ca` is no longer scraped at all: course
> descriptions, credits, and prerequisite prose all arrive from the same API.

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
src/scrape/fetch-json.ts          — JSON:API pagination walker
src/scrape/parse-catalog.ts       — PURE: subject/term dropdown parsing (HTML)
src/scrape/parse-nodes.ts         — PURE: JSON:API course/section node parsing
src/scrape/parse-body.ts          — PURE: description/prereq extraction
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

### Task 6: JSON:API parsers and instructor-name normalisation

> **REVISED after the Task 3 spike.** The original version of this task wrote a
> Cheerio parser against scraped Drupal HTML. The spike found an open,
> unauthenticated Drupal JSON:API on the same host, verified with bare `curl`.
> We parse structured JSON instead of theme markup: stable across template
> changes, and it exposes instructor names the rendered HTML never shows.

**Files:**
- Create: `src/scrape/parse-nodes.ts`, `src/scrape/names.ts`
- Test: `tests/parse-nodes.test.ts`, `tests/names.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions over JSON already in hand)
- Produces:
  - `normalizeInstructorName(raw: string): { name: string; slug: string }`
  - `parseUbcCourseCode(raw: string): { subjectCode: string; campus: string; number: string } | null`
  - `secondsToTime(s: number | null): string | null`
  - `parseDays(days: string[] | null): string[]`
  - `parseSectionNode(node: SectionNode, included: IncludedMap): RawSection`
  - `buildIncludedMap(included: JsonApiResource[]): IncludedMap`
  - types `RawSection`, `RawCourse`, `SectionNode`, `JsonApiResource`, `IncludedMap`

**Naming note:** this task's course-code parser is `parseUbcCourseCode` (parses
UBC's `"CPSC_V 221"` wire format). Task 9 separately defines `parseCourseCode`
in `src/lib/format.ts` for URL slugs (`"cpsc-221"`). Two different formats, two
different functions — do not merge them or reuse one name for both.

**Verified wire formats (from the live API during the Task 3 spike):**

```
field_course_code   "CPSC_V 221"   subject CPSC, campus V, number 221
                    "EXCH_O 580"   campus O = Okanagan
field_section_number "101"
field_days          ["m","w","f"]  also "t", "th", "s", "su"; [] when unscheduled
field_start_time    50400          seconds since midnight -> "14:00"
field_end_time      54000          null when unscheduled
field_instructors   ["Parsa Rajabi"]   [] when unassigned
field_credits       "4.00"
```

Relationships resolve through the response's `included` array by `id`:
`field_status` -> `taxonomy_term--status` `.name` (`"Open"` / `"Closed"` / `"Waitlist"`),
`field_instructional_method` -> `.name` (`"Lecture"` / `"Laboratory"` / `"Experiential"`) — this is our `activity`,
`field_delivery_mode` -> `.name` (`"In person"`), and
`field_course` -> `node--course` carrying `field_course_code`, `title`, `field_credits`, `body`.

**Building and room are genuinely unavailable** anywhere in this API — the spike
confirmed it. `MeetingTime.building` and `.room` stay null. Do not invent them.

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
    expect(normalizeInstructorName('Parsa Rajabi')).toEqual({
      name: 'Parsa Rajabi',
      slug: 'parsa-rajabi',
    });
  });

  it('title-cases shouting input', () => {
    expect(normalizeInstructorName('SMITH, JOHN').name).toBe('John Smith');
  });

  it('collapses whitespace', () => {
    expect(normalizeInstructorName('  Smith,   John  ').name).toBe('John Smith');
  });

  it('handles hyphenated names', () => {
    expect(normalizeInstructorName('Garcia-Lopez, Ana').name).toBe('Ana Garcia-Lopez');
  });

  it('strips accents for the slug but keeps them in the name', () => {
    const r = normalizeInstructorName('Muller, Jorg');
    expect(r.slug).toBe('jorg-muller');
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
    .replace(/(^|[\s\-'])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

export function normalizeInstructorName(raw: string): { name: string; slug: string } {
  const cleaned = raw.replace(/\s+/g, ' ').trim();

  const [last, first] = cleaned.includes(',')
    ? cleaned.split(',').map((p) => p.trim())
    : [null, null];

  const name = titleCase(last && first ? `${first} ${last}` : cleaned);

  const slug = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return { name, slug };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- names`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing node-parser tests**

Create `tests/parse-nodes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseUbcCourseCode,
  secondsToTime,
  parseDays,
  buildIncludedMap,
  parseSectionNode,
} from '@/scrape/parse-nodes';

describe('parseUbcCourseCode', () => {
  it('splits a Vancouver code', () => {
    expect(parseUbcCourseCode('CPSC_V 221')).toEqual({
      subjectCode: 'CPSC',
      campus: 'V',
      number: '221',
    });
  });

  it('splits an Okanagan code', () => {
    expect(parseUbcCourseCode('EXCH_O 580')).toEqual({
      subjectCode: 'EXCH',
      campus: 'O',
      number: '580',
    });
  });

  it('keeps a lettered course number', () => {
    expect(parseUbcCourseCode('MATH_V 100A')?.number).toBe('100A');
  });

  it('returns null on an unparseable code', () => {
    expect(parseUbcCourseCode('nonsense')).toBeNull();
  });
});

describe('secondsToTime', () => {
  it('converts a whole hour', () => {
    expect(secondsToTime(50400)).toBe('14:00');
  });

  it('converts a half hour', () => {
    expect(secondsToTime(34200)).toBe('09:30');
  });

  it('handles midnight', () => {
    expect(secondsToTime(0)).toBe('00:00');
  });

  it('passes null through', () => {
    expect(secondsToTime(null)).toBeNull();
  });
});

describe('parseDays', () => {
  it('maps UBC day codes to three-letter days', () => {
    expect(parseDays(['m', 'w', 'f'])).toEqual(['Mon', 'Wed', 'Fri']);
  });

  it('distinguishes t from th', () => {
    expect(parseDays(['t', 'th'])).toEqual(['Tue', 'Thu']);
  });

  it('returns empty for an unscheduled section', () => {
    expect(parseDays([])).toEqual([]);
    expect(parseDays(null)).toEqual([]);
  });

  it('ignores unknown codes rather than emitting junk', () => {
    expect(parseDays(['m', 'zz'])).toEqual(['Mon']);
  });
});

describe('parseSectionNode', () => {
  const included = buildIncludedMap([
    {
      type: 'taxonomy_term--status',
      id: 'status-1',
      attributes: { name: 'Open' },
    },
    {
      type: 'taxonomy_term--instructional_method',
      id: 'method-1',
      attributes: { name: 'Lecture' },
    },
    {
      type: 'taxonomy_term--delivery_mode',
      id: 'delivery-1',
      attributes: { name: 'In person' },
    },
    {
      type: 'node--course',
      id: 'course-1',
      attributes: {
        title: 'Basic Algorithms and Data Structures',
        field_course_code: 'CPSC_V 221',
        field_course_number: '221',
        field_credits: '4.00',
        body: { value: '<p>Design and analysis. Prerequisite: One of CPSC_V 210.</p>' },
      },
    },
  ]);

  const node = {
    type: 'node--section',
    id: 'section-1',
    attributes: {
      title: 'Basic Algorithms and Data Structures :: 2026 :: Sec 101',
      field_section_number: '101',
      field_days: ['m', 'w', 'f'],
      field_start_time: 50400,
      field_end_time: 54000,
      field_instructors: ['Parsa Rajabi'],
      field_is_visible: true,
    },
    relationships: {
      field_course: { data: { type: 'node--course', id: 'course-1' } },
      field_status: { data: { type: 'taxonomy_term--status', id: 'status-1' } },
      field_instructional_method: {
        data: { type: 'taxonomy_term--instructional_method', id: 'method-1' },
      },
      field_delivery_mode: {
        data: { type: 'taxonomy_term--delivery_mode', id: 'delivery-1' },
      },
    },
  };

  it('resolves the course through the included map', () => {
    const r = parseSectionNode(node, included);
    expect(r.course.subjectCode).toBe('CPSC');
    expect(r.course.number).toBe('221');
    expect(r.course.campus).toBe('V');
    expect(r.course.title).toBe('Basic Algorithms and Data Structures');
    expect(r.course.credits).toBe(4);
  });

  it('resolves taxonomy relationships to names', () => {
    const r = parseSectionNode(node, included);
    expect(r.status).toBe('Open');
    expect(r.activity).toBe('Lecture');
    expect(r.deliveryMode).toBe('In person');
  });

  it('expands one meeting row per scheduled day', () => {
    const r = parseSectionNode(node, included);
    expect(r.meetings).toEqual([
      { day: 'Mon', startTime: '14:00', endTime: '15:00', building: null, room: null },
      { day: 'Wed', startTime: '14:00', endTime: '15:00', building: null, room: null },
      { day: 'Fri', startTime: '14:00', endTime: '15:00', building: null, room: null },
    ]);
  });

  it('normalises instructor names', () => {
    expect(parseSectionNode(node, included).instructorNames).toEqual(['Parsa Rajabi']);
  });

  it('returns null course for a section whose course is missing from included', () => {
    const orphan = {
      ...node,
      relationships: { ...node.relationships, field_course: { data: null } },
    };
    expect(parseSectionNode(orphan as never, included).course).toBeNull();
  });

  it('handles an unscheduled section with no days or times', () => {
    const unscheduled = {
      ...node,
      attributes: {
        ...node.attributes,
        field_days: [],
        field_start_time: null,
        field_end_time: null,
        field_instructors: [],
      },
    };
    const r = parseSectionNode(unscheduled as never, included);
    expect(r.meetings).toEqual([]);
    expect(r.instructorNames).toEqual([]);
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `npm test -- parse-nodes`
Expected: FAIL — cannot resolve `@/scrape/parse-nodes`.

- [ ] **Step 7: Implement the node parsers**

Create `src/scrape/parse-nodes.ts`:

```ts
import { normalizeInstructorName } from '@/scrape/names';

export type JsonApiResource = {
  type: string;
  id: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, { data?: { type: string; id: string } | null }>;
};

export type SectionNode = JsonApiResource;
export type IncludedMap = Map<string, JsonApiResource>;

export type RawMeeting = {
  day: string;
  startTime: string | null;
  endTime: string | null;
  building: string | null;
  room: string | null;
};

export type RawCourse = {
  subjectCode: string;
  campus: string;
  number: string;
  title: string;
  credits: number | null;
  bodyHtml: string | null;
};

export type RawSection = {
  sectionCode: string;
  activity: string | null;
  status: string | null;
  deliveryMode: string | null;
  instructorNames: string[];
  meetings: RawMeeting[];
  course: RawCourse | null;
};

const DAY_MAP: Record<string, string> = {
  m: 'Mon',
  t: 'Tue',
  w: 'Wed',
  th: 'Thu',
  f: 'Fri',
  s: 'Sat',
  su: 'Sun',
};

/** "CPSC_V 221" -> subject CPSC, campus V, number 221 */
export function parseUbcCourseCode(
  raw: string,
): { subjectCode: string; campus: string; number: string } | null {
  const m = String(raw).trim().match(/^([A-Z]{2,6})_([VO])\s+(\d{3}[A-Z]?)$/);
  if (!m) return null;
  return { subjectCode: m[1], campus: m[2], number: m[3] };
}

/** Seconds since midnight -> "HH:MM". */
export function secondsToTime(s: number | null): string | null {
  if (s === null || s === undefined || !Number.isFinite(s)) return null;
  const h = Math.floor(s / 3600);
  const min = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** ["m","w","f"] -> ["Mon","Wed","Fri"]; unknown codes are dropped. */
export function parseDays(days: string[] | null): string[] {
  if (!days) return [];
  return days.map((d) => DAY_MAP[String(d).toLowerCase()]).filter(Boolean);
}

export function buildIncludedMap(included: JsonApiResource[]): IncludedMap {
  return new Map(included.map((r) => [`${r.type}:${r.id}`, r]));
}

function related(
  node: JsonApiResource,
  field: string,
  included: IncludedMap,
): JsonApiResource | null {
  const ref = node.relationships?.[field]?.data;
  if (!ref) return null;
  return included.get(`${ref.type}:${ref.id}`) ?? null;
}

function termName(node: JsonApiResource, field: string, included: IncludedMap): string | null {
  const r = related(node, field, included);
  const name = r?.attributes?.name;
  return typeof name === 'string' ? name : null;
}

function parseCourseNode(node: JsonApiResource | null): RawCourse | null {
  if (!node) return null;
  const code = parseUbcCourseCode(String(node.attributes.field_course_code ?? ''));
  if (!code) return null;

  const rawCredits = node.attributes.field_credits;
  const credits = rawCredits === null || rawCredits === undefined ? null : Number(rawCredits);

  const body = node.attributes.body as { value?: string } | null | undefined;

  return {
    ...code,
    title: String(node.attributes.title ?? ''),
    credits: Number.isFinite(credits as number) ? (credits as number) : null,
    bodyHtml: body?.value ?? null,
  };
}

export function parseSectionNode(node: SectionNode, included: IncludedMap): RawSection {
  const a = node.attributes;

  const startTime = secondsToTime((a.field_start_time as number | null) ?? null);
  const endTime = secondsToTime((a.field_end_time as number | null) ?? null);

  const meetings = parseDays((a.field_days as string[] | null) ?? null).map((day) => ({
    day,
    startTime,
    endTime,
    // The API exposes no location anywhere — confirmed during the Task 3 spike.
    building: null,
    room: null,
  }));

  const instructorNames = ((a.field_instructors as string[] | null) ?? [])
    .map((n) => normalizeInstructorName(n).name)
    .filter(Boolean);

  return {
    sectionCode: String(a.field_section_number ?? ''),
    activity: termName(node, 'field_instructional_method', included),
    status: termName(node, 'field_status', included),
    deliveryMode: termName(node, 'field_delivery_mode', included),
    instructorNames,
    meetings,
    course: parseCourseNode(related(node, 'field_course', included)),
  };
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- parse-nodes`
Expected: PASS, 18 tests across both files.

- [ ] **Step 9: Commit**

```bash
git add src/scrape/parse-nodes.ts src/scrape/names.ts tests/parse-nodes.test.ts tests/names.test.ts
git commit -m "feat: parse UBC JSON:API course and section nodes"
```

---

### Task 7: Section scrape job with safety guard

> **REVISED after the Task 3 spike.** No Playwright, no HTML scraping. One
> paginated JSON:API walk per term yields sections *and* their courses together.

**Files:**
- Create: `src/scrape/fetch-json.ts`, `src/scrape/jobs/sections.ts`, `src/scrape/jobs/sections.run.ts`
- Test: `tests/upsert-sections.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `parseSectionNode`, `buildIncludedMap`, `RawSection` (Task 6); `normalizeInstructorName` (Task 6); `fetchText`/`USER_AGENT` (Task 5); `db` (Task 2).
- Produces:
  - `fetchSectionsForTerm(ubcPeriodId: string): Promise<RawSection[]>`
  - `upsertSections(rows: RawSection[], termId: string): Promise<void>`
  - `npm run scrape:sections`

**Verified endpoint (bare `curl`, no cookies, no session):**

```
GET https://courses.students.ubc.ca/jsonapi/node/section
  ?filter[field_academic_term.meta.drupal_internal__target_id]=<UBC_PERIOD_ID>
  &filter[field_is_visible]=1
  &include=field_course.field_subject,field_status,field_instructional_method,field_delivery_mode
  &page[limit]=50
```

**Linking a section to its Subject row — do NOT match on name or code.** The nested
include `field_course.field_subject` resolves each course to a
`taxonomy_term--subject` whose `meta.drupal_internal__target_id` is *the same
numeric id Task 5 stored as `Subject.ubcSubjectId`* (verified live: CPSC_V 221 ->
1810, and the dropdown's "Computer Science (Vancouver)" is also 1810). Look the
subject up by `ubcSubjectId_campus` and nothing else. Matching the course code
`"CPSC"` against the dropdown name `"Computer Science (Vancouver)"` never compares
equal, and would silently skip every section.

**This task must extend Task 6's `RawCourse`** with a `ubcSubjectId: string | null`
field, populated in `parseCourseNode` from
`node.relationships.field_subject.data.meta.drupal_internal__target_id`. Add a
covering test for it in `tests/parse-nodes.test.ts`.

The response carries `links.next.href` for pagination — follow it until absent.
`meta.count` reports the total matching sections (44089 across all terms at spike
time). The `field_academic_term` relationship's `drupal_internal__target_id`
matches the `academic_period` ids Task 5 already stored on `Term.ubcPeriodId`, so
no extra lookup is needed.

**Deduplication (important):** filtering `node--course` by `field_course_code`
returned **8 nodes** for `"CPSC_V 221"` — course nodes are per-instance
(`field_course_instance_id`), not one per course. Upserting on
`(subjectId, number)` collapses them correctly; never assume one node per course.

**Campus scope:** v1 is Vancouver only. Skip any row whose parsed
`course.campus !== 'V'`.

- [ ] **Step 1: Implement the JSON fetcher**

Create `src/scrape/fetch-json.ts`:

```ts
import { fetchText } from '@/scrape/http';
import type { JsonApiResource } from '@/scrape/parse-nodes';

const BASE = 'https://courses.students.ubc.ca/jsonapi/node/section';

type JsonApiPage = {
  data: JsonApiResource[];
  included?: JsonApiResource[];
  links?: { next?: { href: string } };
  meta?: { count?: number };
};

export function sectionsUrl(ubcPeriodId: string, limit = 50): string {
  const p = new URLSearchParams({
    'filter[field_academic_term.meta.drupal_internal__target_id]': ubcPeriodId,
    'filter[field_is_visible]': '1',
    include:
      'field_course.field_subject,field_status,field_instructional_method,field_delivery_mode',
    'page[limit]': String(limit),
  });
  return `${BASE}?${p.toString()}`;
}

/** Walks every page of one term, yielding each page's data + included together. */
export async function* sectionPages(
  ubcPeriodId: string,
): AsyncGenerator<{ data: JsonApiResource[]; included: JsonApiResource[] }> {
  let url: string | undefined = sectionsUrl(ubcPeriodId);
  while (url) {
    const page = JSON.parse(await fetchText(url)) as JsonApiPage;
    yield { data: page.data ?? [], included: page.included ?? [] };
    url = page.links?.next?.href;
  }
}
```

- [ ] **Step 2: Write the failing idempotency test**

Create `tests/upsert-sections.test.ts`. This test touches Postgres.

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { upsertSections } from '@/scrape/jobs/sections';
import type { RawSection } from '@/scrape/parse-nodes';

const rows: RawSection[] = [
  {
    sectionCode: '101',
    activity: 'Lecture',
    status: 'Open',
    deliveryMode: 'In person',
    instructorNames: ['John Smith'],
    meetings: [
      { day: 'Mon', startTime: '14:00', endTime: '15:00', building: null, room: null },
      { day: 'Wed', startTime: '14:00', endTime: '15:00', building: null, room: null },
    ],
    course: {
      subjectCode: 'ZZTEST',
      campus: 'V',
      number: '101',
      title: 'Test Course',
      credits: 3,
      bodyHtml: '<p>A test course.</p>',
    },
  },
];

describe('upsertSections', () => {
  let termId: string;

  beforeAll(async () => {
    await db.subject.upsert({
      where: { ubcSubjectId_campus: { ubcSubjectId: 'ZZTEST-SUBJ', campus: 'V' } },
      create: { ubcSubjectId: 'ZZTEST-SUBJ', name: 'Test Subject', campus: 'V', code: 'ZZTEST' },
      update: { code: 'ZZTEST' },
    });
    const term = await db.term.upsert({
      where: { ubcPeriodId: 'ZZTEST-PERIOD' },
      create: {
        ubcPeriodId: 'ZZTEST-PERIOD',
        name: 'Test Term',
        year: 2026,
        session: 'W',
        termNumber: 1,
        campus: 'V',
      },
      update: {},
    });
    termId = term.id;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('is idempotent across repeated runs', async () => {
    await upsertSections(rows, termId);
    await upsertSections(rows, termId);

    const subject = await db.subject.findUniqueOrThrow({
      where: { ubcSubjectId_campus: { ubcSubjectId: 'ZZTEST-SUBJ', campus: 'V' } },
    });
    expect(await db.course.count({ where: { subjectId: subject.id } })).toBe(1);
    expect(await db.section.count({ where: { termId } })).toBe(1);

    const section = await db.section.findFirstOrThrow({ where: { termId } });
    expect(await db.meetingTime.count({ where: { sectionId: section.id } })).toBe(2);
    expect(await db.sectionInstructor.count({ where: { sectionId: section.id } })).toBe(1);
    expect(await db.instructor.count({ where: { slug: 'john-smith' } })).toBe(1);
  });

  it('updates a changed section in place rather than duplicating it', async () => {
    await upsertSections(
      [{ ...rows[0], status: 'Waitlist', meetings: [rows[0].meetings[0]] }],
      termId,
    );

    expect(await db.section.count({ where: { termId } })).toBe(1);
    const section = await db.section.findFirstOrThrow({ where: { termId } });
    expect(section.status).toBe('Waitlist');
    // Meetings are replaced wholesale, so the dropped day must be gone.
    expect(await db.meetingTime.count({ where: { sectionId: section.id } })).toBe(1);
  });

  it('skips a section whose course failed to parse', async () => {
    const before = await db.section.count({ where: { termId } });
    await upsertSections([{ ...rows[0], sectionCode: '999', course: null }], termId);
    expect(await db.section.count({ where: { termId } })).toBe(before);
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
import { sectionPages } from '@/scrape/fetch-json';
import {
  buildIncludedMap,
  parseSectionNode,
  type RawSection,
} from '@/scrape/parse-nodes';
import { normalizeInstructorName } from '@/scrape/names';

const CAMPUS = 'V';
const MIN_RETAINED_FRACTION = 0.8;

export async function fetchSectionsForTerm(ubcPeriodId: string): Promise<RawSection[]> {
  const out: RawSection[] = [];
  for await (const { data, included } of sectionPages(ubcPeriodId)) {
    const map = buildIncludedMap(included);
    for (const node of data) out.push(parseSectionNode(node, map));
  }
  return out;
}

export async function upsertSections(rows: RawSection[], termId: string) {
  for (const row of rows) {
    // A section whose course is missing or unparseable has nothing to hang off.
    if (!row.course || row.course.campus !== CAMPUS) continue;
    if (!row.sectionCode) continue;

    // Exact match on UBC's own subject id — the same value Task 5 stored from the
    // dropdown. Never match on name or code: the dropdown says "Computer Science
    // (Vancouver)", course rows say "CPSC", and those never compare equal.
    if (!row.course.ubcSubjectId) continue;
    const subject = await db.subject.findUnique({
      where: {
        ubcSubjectId_campus: { ubcSubjectId: row.course.ubcSubjectId, campus: CAMPUS },
      },
    });
    if (!subject) continue;

    // Subject codes appear only on course rows, never the dropdown — fill in on sight.
    if (!subject.code) {
      await db.subject.update({
        where: { id: subject.id },
        data: { code: row.course.subjectCode },
      });
    }

    const course = await db.course.upsert({
      where: { subjectId_number: { subjectId: subject.id, number: row.course.number } },
      create: {
        subjectId: subject.id,
        number: row.course.number,
        title: row.course.title,
        credits: row.course.credits,
        campus: CAMPUS,
      },
      update: { title: row.course.title, credits: row.course.credits },
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
      if (!slug) continue;
      const instructor = await db.instructor.upsert({
        where: { slug },
        create: { name, slug, campus: CAMPUS },
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

export async function scrapeSections() {
  const now = new Date().getFullYear();
  const terms = await db.term.findMany({
    where: { campus: CAMPUS, year: { gte: now - 2, lte: now + 1 } },
    orderBy: { year: 'asc' },
  });

  for (const term of terms) {
    let rows: RawSection[];
    try {
      rows = await fetchSectionsForTerm(term.ubcPeriodId);
    } catch (e) {
      console.error(`Fetch failed for ${term.name}:`, e);
      continue;
    }

    const usable = rows.filter((r) => r.course && r.course.campus === CAMPUS);
    if (usable.length === 0) {
      console.log(`${term.name}: no Vancouver sections, skipping`);
      continue;
    }

    const previous = await db.section.count({ where: { termId: term.id } });
    if (previous > 0 && usable.length < previous * MIN_RETAINED_FRACTION) {
      console.error(
        `ABORT ${term.name}: parsed ${usable.length} sections vs ${previous} previously. ` +
          'UBC API likely changed — refusing to write.',
      );
      continue;
    }

    await upsertSections(usable, term.id);
    console.log(`${term.name}: ${usable.length} sections`);
  }
}
```

Create `src/scrape/jobs/sections.run.ts`:

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
Expected: PASS, 3 tests.

- [ ] **Step 6: Add the npm script**

Add to `package.json` scripts:

```json
"scrape:sections": "tsx src/scrape/jobs/sections.run.ts"
```

- [ ] **Step 7: Run a limited real scrape**

Temporarily narrow `scrapeSections`'s `terms` query to a single current term
(e.g. `where: { ubcPeriodId: '1453' }`) and run:

```bash
npm run scrape:sections
```

Expected: prints a section count in the thousands. Verify with:

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select (select count(*) from \"Course\") courses, (select count(*) from \"Section\") sections, (select count(*) from \"Instructor\") instructors, (select count(*) from \"MeetingTime\") meetings;"
```

All four counts must be greater than zero. Then remove the narrowing.

- [ ] **Step 8: Verify idempotency against real data**

Re-run `npm run scrape:sections` with the same narrowing and confirm the four
counts above are unchanged.

- [ ] **Step 9: Commit**

```bash
git add src/scrape package.json tests/upsert-sections.test.ts
git commit -m "feat: scrape UBC sections from JSON:API with change guard"
```

---

### Task 8: Course description and prerequisite extraction

> **REVISED after the Task 3 spike.** The academic calendar
> (`vancouver.calendar.ubc.ca`) is no longer scraped at all. The course `body`
> field already arrives with the Task 7 JSON:API walk and contains the full
> description *including* the prerequisite sentence.

**Files:**
- Create: `src/scrape/parse-body.ts`, `src/scrape/jobs/descriptions.ts`, `src/scrape/jobs/descriptions.run.ts`
- Test: `tests/parse-body.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `db` (Task 2); `fetchSectionsForTerm` (Task 7) is NOT used — this job reads `bodyHtml` already stored, see Step 5.
- Produces:
  - `parseBody(html: string | null): { description: string | null; prereqText: string | null; coreqText: string | null }`
  - `npm run scrape:descriptions`

**Real body value observed for `CPSC_V 221`:**

```html
<p>Design and analysis of basic algorithms and data structures; algorithm analysis
methods, searching and sorting algorithms, basic data structures, graphs and
concurrency. [3-2-0] Prerequisite: One of CPSC_V 210, CPEN_V 221 and either (a) one
of CPSC_V 121, MATH_V 220, MATH_O 220 or (b) a score of 68% or higher in MATH_V 226.</p>
```

Note the `[3-2-0]` lecture-lab-tutorial hours marker and that the prerequisite
sentence runs to the end of the paragraph — it contains internal periods
("(a) one of..."), so a naive split on `.` will truncate it. `prereqText` stays
raw prose; Phase 6 parses it into a tree.

- [ ] **Step 1: Write the failing tests**

Create `tests/parse-body.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseBody } from '@/scrape/parse-body';

const CPSC221 =
  '<p>Design and analysis of basic algorithms and data structures; algorithm ' +
  'analysis methods, searching and sorting algorithms, basic data structures, ' +
  'graphs and concurrency. [3-2-0] Prerequisite: One of CPSC_V 210, CPEN_V 221 ' +
  'and either (a) one of CPSC_V 121, MATH_V 220, MATH_O 220 or (b) a score of ' +
  '68% or higher in MATH_V 226.</p>';

describe('parseBody', () => {
  it('extracts the description without the prerequisite sentence', () => {
    const r = parseBody(CPSC221);
    expect(r.description).toContain('Design and analysis of basic algorithms');
    expect(r.description).not.toContain('Prerequisite');
  });

  it('captures the whole prerequisite clause including internal periods', () => {
    const r = parseBody(CPSC221);
    expect(r.prereqText).toContain('One of CPSC_V 210');
    expect(r.prereqText).toContain('MATH_V 226');
  });

  it('strips the hours marker from the description', () => {
    expect(parseBody(CPSC221).description).not.toContain('[3-2-0]');
  });

  it('returns nulls for a missing body', () => {
    expect(parseBody(null)).toEqual({
      description: null,
      prereqText: null,
      coreqText: null,
    });
  });

  it('handles a body with no prerequisite', () => {
    const r = parseBody('<p>An introductory survey course.</p>');
    expect(r.description).toBe('An introductory survey course.');
    expect(r.prereqText).toBeNull();
  });

  it('captures a corequisite separately from a prerequisite', () => {
    const r = parseBody(
      '<p>Some description. Prerequisite: MATH_V 100. Corequisite: PHYS_V 101.</p>',
    );
    expect(r.prereqText).toContain('MATH_V 100');
    expect(r.coreqText).toContain('PHYS_V 101');
    expect(r.prereqText).not.toContain('PHYS_V 101');
  });

  it('strips html tags from the description', () => {
    expect(parseBody('<p>Plain <em>text</em> here.</p>').description).toBe(
      'Plain text here.',
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- parse-body`
Expected: FAIL — cannot resolve `@/scrape/parse-body`.

- [ ] **Step 3: Implement the body parser**

Create `src/scrape/parse-body.ts`:

```ts
import * as cheerio from 'cheerio';

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();
const orNull = (s: string) => (s.length ? s : null);

/**
 * Splits a course body into description / prerequisite / corequisite.
 * Prereq and coreq clauses run to the end of the text or to the start of the
 * next labelled clause — never to the first period, which appears inside them.
 */
export function parseBody(html: string | null): {
  description: string | null;
  prereqText: string | null;
  coreqText: string | null;
} {
  if (!html) return { description: null, prereqText: null, coreqText: null };

  const text = clean(cheerio.load(html).root().text());

  const label = /\b(Prerequisite|Corequisite|Pre-req|Co-req)s?\s*:/gi;
  const marks: { name: string; start: number; bodyStart: number }[] = [];
  for (const m of text.matchAll(label)) {
    marks.push({
      name: m[1].toLowerCase().startsWith('pre') ? 'prereq' : 'coreq',
      start: m.index!,
      bodyStart: m.index! + m[0].length,
    });
  }

  const sliceTo = (i: number) => (i + 1 < marks.length ? marks[i + 1].start : text.length);

  let prereqText: string | null = null;
  let coreqText: string | null = null;
  marks.forEach((mark, i) => {
    const value = orNull(clean(text.slice(mark.bodyStart, sliceTo(i))));
    if (mark.name === 'prereq') prereqText ??= value;
    else coreqText ??= value;
  });

  const descriptionEnd = marks.length ? marks[0].start : text.length;
  const description = orNull(
    clean(text.slice(0, descriptionEnd).replace(/\[\d+-\d+-\d+\]/g, '')),
  );

  return { description, prereqText, coreqText };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- parse-body`
Expected: PASS, 7 tests.

- [ ] **Step 5: Store the raw body during the section scrape**

`parseBody` needs the raw HTML. Modify Task 7's `upsertSections` in
`src/scrape/jobs/sections.ts` so the course upsert also writes the raw body into
`Course.description` as a staging value:

In BOTH the `create` and `update` objects of the `db.course.upsert` call, add:

```ts
        description: row.course.bodyHtml,
```

This stores raw HTML temporarily; Step 6's job replaces it with cleaned text.

- [ ] **Step 6: Write the enrichment job**

Create `src/scrape/jobs/descriptions.ts`:

```ts
import { db } from '@/lib/db';
import { parseBody } from '@/scrape/parse-body';

/** Converts the raw body HTML staged by the section scrape into clean fields. */
export async function scrapeDescriptions() {
  const courses = await db.course.findMany({
    where: { campus: 'V', description: { startsWith: '<' } },
    select: { id: true, description: true },
  });

  let updated = 0;
  for (const course of courses) {
    const { description, prereqText, coreqText } = parseBody(course.description);
    await db.course.update({
      where: { id: course.id },
      data: { description, prereqText, coreqText },
    });
    updated += 1;
  }

  console.log(`Enriched ${updated} courses.`);
}
```

Create `src/scrape/jobs/descriptions.run.ts`:

```ts
import { db } from '@/lib/db';
import { scrapeDescriptions } from '@/scrape/jobs/descriptions';

scrapeDescriptions()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
```

Add to `package.json` scripts:

```json
"scrape:descriptions": "tsx src/scrape/jobs/descriptions.run.ts"
```

- [ ] **Step 7: Run it for real**

```bash
npm run scrape:descriptions
```

Expected: prints an enriched count greater than zero. Verify:

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select number, left(description,60) as descr, left(\"prereqText\",50) as prereq from \"Course\" where \"prereqText\" is not null limit 5;"
```

Confirm descriptions carry no HTML tags and prerequisites read as prose.

- [ ] **Step 8: Confirm the job is idempotent**

Re-run `npm run scrape:descriptions`. The second run must report `Enriched 0
courses.` — cleaned descriptions no longer start with `<`, so they are not
re-selected.

- [ ] **Step 9: Commit**

```bash
git add src/scrape tests/parse-body.test.ts package.json
git commit -m "feat: extract course descriptions and prerequisites from body"
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
