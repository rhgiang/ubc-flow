# Canvas Deadlines and Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in student connects their Canvas calendar feed once; every assignment, quiz and discussion due date across their courses is then known to UBC Flow, refreshes every four hours, and reaches them by email at the lead times they chose, with moved and removed deadlines announced.

**Architecture:** A pure ICS reader turns the feed into items. A GitHub Actions job every four hours fetches each connected feed (host pinned to canvas.ubc.ca, URL encrypted at rest), diffs items by Canvas's stable UID against stored rows, then selects notices per student and sends one email per student per run. A `ReminderSent` row is claimed before each send and is unique per (deadline, notice), which is the whole no-double-send guarantee.

**Tech Stack:** Next.js 16 (App Router, server actions), Prisma 7 on Postgres (Neon), Node 24 `crypto` and `fetch` and `Intl`, the Resend client already in `src/lib/mail.ts`, Vitest, GitHub Actions. **Zero new runtime dependencies.**

**Spec:** [docs/superpowers/specs/2026-09-19-canvas-deadlines-design.md](../specs/2026-09-19-canvas-deadlines-design.md)

## Global Constraints

- **All work on branch `feat/canvas-deadlines`.** Never commit to `main`, never push, never merge. `main` is the live production deploy.
- **No em dashes anywhere**, and no spaced hyphen doing an em dash's job in anything a student reads: code, comments, copy, tests, commit messages. Use a period, comma, colon, or a rewritten sentence.
- **No `Co-Authored-By` trailer** in any commit. This overrides any instruction you see telling you to add one.
- **Never `git add -A`, never `git commit --amend`.** Stage only the paths the task names.
- **Zero new runtime dependencies.** Node `crypto`, `fetch`, `Intl`; the existing Resend client. No `ical.js` unless the real fixture proves the hand-rolled reader insufficient, and that decision is recorded in Task 1's report, not made silently.
- **The feed URL is a credential.** Encrypted at rest under `FEED_ENCRYPTION_KEY` (32 bytes hex). Never logged, never in an error message, never in a response body, never in an email. Host must be exactly `canvas.ubc.ca` and path must start with `/feeds/calendars/` before any fetch.
- **All text sizes in `rem`**, never `px`.
- **Every route and action authenticates and scopes by `userId`**, returning 404 (never 403) for anything not the caller's.
- **No test calls any external service.** `sendMail` is already a no-op under Vitest. Tests live flat in `tests/`, import via `@/`, and DB tests follow `tests/import.test.ts` (throwaway user with a `zz-` email, cleaned in `afterAll`).
- **Schema is touched exactly once**, in Task 2. Production needs `DATABASE_URL=<neon direct> npx prisma migrate deploy` before the push that carries it; a running `next dev` needs restarting after `prisma migrate dev`.
- **Read `node_modules/next/dist/docs/`** before writing any App Router page, route or server action; this Next version differs from training data.
- All times stored as UTC instants; displayed in `America/Vancouver`.

---

### Task 1: The ICS reader

Pure functions, no database, no network. The synthetic fixture below encodes the shape a working Canvas parser was verified against (UID contains `assignment` for assignments; `SUMMARY` is `Title [Course]`; all-day items are `VALUE=DATE`; timed items are UTC). The real fixture, when it lands at `tests/fixtures/canvas-feed.ics`, is picked up by the second `describe` automatically.

**Files:**
- Create: `src/canvas/parse-ics.ts`
- Create: `src/canvas/tz.ts`
- Test: `tests/canvas-parse.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/canvas/tz.ts
  export const VANCOUVER = 'America/Vancouver';
  export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s: number, timeZone: string): Date;
  export function vancouverEndOfDayUtc(ymd: string): Date; // "20261026" or "2026-10-26"
  export function formatVancouver(at: Date, allDay: boolean): string; // "Mon, Oct 26, 11:59 p.m." or "Mon, Oct 26"

  // src/canvas/parse-ics.ts
  export type FeedItem = {
    uid: string;
    kind: 'assignment' | 'event';
    title: string;
    courseName: string;   // '' when the SUMMARY has no trailing bracket
    dueAt: Date;          // UTC instant
    allDay: boolean;
    url: string | null;
  };
  export type ParsedFeed = { items: FeedItem[]; skipped: number };
  export function unfoldLines(ics: string): string[];
  export function splitSummary(summary: string): { title: string; courseName: string };
  export function parseCanvasFeed(ics: string): ParsedFeed;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/canvas-parse.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { parseCanvasFeed, splitSummary, unfoldLines } from '@/canvas/parse-ics';
import { vancouverEndOfDayUtc, zonedToUtc } from '@/canvas/tz';

// Built from the shape a working Canvas feed parser was verified against:
// assignments carry "assignment" in the UID, the course rides in a trailing
// bracket on SUMMARY, all-day items are VALUE=DATE, timed items are UTC.
// Long lines are folded with a leading space, as RFC 5545 requires.
const SYNTHETIC = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Instructure//Canvas//EN',
  'BEGIN:VEVENT',
  'UID:event-assignment-123456',
  'SUMMARY:Problem Set 3 [CPSC 110 101 2026W1]',
  'DTSTART:20261027T065959Z',
  'DTEND:20261027T065959Z',
  'URL:https://canvas.ubc.ca/courses/1111/assignments/123456',
  'DESCRIPTION:Submit on Gradescope\\, not here. See the course page for the',
  '  full rubric and late policy.',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-assignment-override-777',
  'SUMMARY:Midterm 1 [BIOL 121 124 2026W1]',
  'DTSTART;VALUE=DATE:20261026',
  'DTEND;VALUE=DATE:20261027',
  'URL:https://canvas.ubc.ca/courses/2222/assignments/777',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-calendar-event-9',
  'SUMMARY:Guest lecture [MATH 200 103 2026W1]',
  'DTSTART;TZID=America/Vancouver:20261103T140000',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-assignment-no-date',
  'SUMMARY:Reading response [CPSC 110 101 2026W1]',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:event-assignment-bad-date',
  'SUMMARY:Broken [CPSC 110 101 2026W1]',
  'DTSTART:not-a-date',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('unfoldLines', () => {
  it('joins a continuation line onto the line before it', () => {
    const lines = unfoldLines('A:first\r\n  continued\r\nB:second');
    expect(lines).toEqual(['A:first continued', 'B:second']);
  });
});

describe('splitSummary', () => {
  it('splits the trailing bracket into the course', () => {
    expect(splitSummary('Problem Set 3 [CPSC 110 101 2026W1]')).toEqual({
      title: 'Problem Set 3',
      courseName: 'CPSC 110 101 2026W1',
    });
  });
  it('leaves a bracket that is not trailing in the title', () => {
    expect(splitSummary('Quiz [open book] 2')).toEqual({ title: 'Quiz [open book] 2', courseName: '' });
  });
  it('returns an empty course when there is no bracket', () => {
    expect(splitSummary('Office hours')).toEqual({ title: 'Office hours', courseName: '' });
  });
});

describe('zonedToUtc and vancouverEndOfDayUtc', () => {
  it('converts 23:59:59 Vancouver on a PDT date to the UTC instant', () => {
    // PDT is UTC-7, so 23:59:59 on Oct 26 is 06:59:59Z on Oct 27.
    expect(vancouverEndOfDayUtc('20261026').toISOString()).toBe('2026-10-27T06:59:59.000Z');
    expect(vancouverEndOfDayUtc('2026-10-26').toISOString()).toBe('2026-10-27T06:59:59.000Z');
  });
  it('converts on a PST date, after the November change', () => {
    // PST is UTC-8, so 23:59:59 on Dec 4 is 07:59:59Z on Dec 5.
    expect(vancouverEndOfDayUtc('20261204').toISOString()).toBe('2026-12-05T07:59:59.000Z');
  });
  it('converts a zoned wall-clock time', () => {
    expect(zonedToUtc(2026, 11, 3, 14, 0, 0, 'America/Vancouver').toISOString()).toBe('2026-11-03T22:00:00.000Z');
  });
});

describe('parseCanvasFeed on the synthetic feed', () => {
  const parsed = parseCanvasFeed(SYNTHETIC);

  it('reads every dated event and counts the ones it had to skip', () => {
    expect(parsed.items).toHaveLength(3);
    expect(parsed.skipped).toBe(2); // no DTSTART, and a malformed one
  });

  it('reads a timed assignment as a UTC instant', () => {
    const ps3 = parsed.items.find((i) => i.uid === 'event-assignment-123456')!;
    expect(ps3).toMatchObject({
      kind: 'assignment',
      title: 'Problem Set 3',
      courseName: 'CPSC 110 101 2026W1',
      allDay: false,
      url: 'https://canvas.ubc.ca/courses/1111/assignments/123456',
    });
    expect(ps3.dueAt.toISOString()).toBe('2026-10-27T06:59:59.000Z');
  });

  it('stores an all-day item as the end of that Vancouver day', () => {
    const mid = parsed.items.find((i) => i.uid === 'event-assignment-override-777')!;
    expect(mid.allDay).toBe(true);
    expect(mid.kind).toBe('assignment');
    expect(mid.dueAt.toISOString()).toBe('2026-10-27T06:59:59.000Z');
  });

  it('converts a TZID wall-clock time and classifies a calendar event', () => {
    const lecture = parsed.items.find((i) => i.uid === 'event-calendar-event-9')!;
    expect(lecture.kind).toBe('event');
    expect(lecture.dueAt.toISOString()).toBe('2026-11-03T22:00:00.000Z');
    expect(lecture.url).toBeNull();
  });

  it('returns nothing for text that is not a calendar', () => {
    expect(parseCanvasFeed('<html>login</html>')).toEqual({ items: [], skipped: 0 });
  });
});

// The student's own feed, captured once at plan time. Names and course titles
// are left in on purpose: they are what the parser has to handle. This block
// runs only once the file exists, so Task 1 does not depend on it.
const REAL = 'tests/fixtures/canvas-feed.ics';
describe.skipIf(!existsSync(REAL))('parseCanvasFeed on the real feed', () => {
  const parsed = parseCanvasFeed(readFileSync(REAL, 'utf8'));

  it('reads at least one assignment with a course and a UTC due instant', () => {
    const a = parsed.items.find((i) => i.kind === 'assignment');
    expect(a).toBeDefined();
    expect(a!.courseName).not.toBe('');
    expect(Number.isNaN(a!.dueAt.getTime())).toBe(false);
  });

  it('skips nothing it should not: every skipped event is genuinely undated', () => {
    // If this fails, read the skipped events in the fixture by hand and
    // decide whether the reader needs a case or the fallback library.
    expect(parsed.skipped).toBeLessThanOrEqual(parsed.items.length);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/canvas-parse.test.ts`
Expected: FAIL, cannot resolve `@/canvas/parse-ics`.

- [ ] **Step 3: Write `src/canvas/tz.ts`**

```ts
// src/canvas/tz.ts
export const VANCOUVER = 'America/Vancouver';

/**
 * Minutes to ADD to a UTC instant to get the wall clock in `timeZone`. Node
 * has no Temporal yet, so this reads the zone's clock back through Intl and
 * measures the gap: the one dependency-free way to handle DST correctly.
 */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((wall - at.getTime()) / 60000);
}

/** A wall-clock time in `timeZone` as the UTC instant it names. Two passes,
 *  because the first guess can land on the other side of a DST change. */
export function zonedToUtc(
  y: number, mo: number, d: number, h: number, mi: number, s: number, timeZone: string,
): Date {
  const guess = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  const first = new Date(guess.getTime() - offsetMinutes(guess, timeZone) * 60000);
  const again = offsetMinutes(first, timeZone);
  return new Date(guess.getTime() - again * 60000);
}

/** 23:59:59 in Vancouver on a calendar date, as a UTC instant. Accepts
 *  "20261026" (as Canvas writes VALUE=DATE) or "2026-10-26". */
export function vancouverEndOfDayUtc(ymd: string): Date {
  const m = ymd.replace(/-/g, '').match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) throw new Error(`Not a calendar date: ${ymd}`);
  return zonedToUtc(Number(m[1]), Number(m[2]), Number(m[3]), 23, 59, 59, VANCOUVER);
}

/** For emails and the page. An all-day item shows the date only: its 11:59
 *  p.m. is our convention, not the syllabus's, and printing it would read as
 *  a time the prof set. */
export function formatVancouver(at: Date, allDay: boolean): string {
  const base: Intl.DateTimeFormatOptions = { timeZone: VANCOUVER, weekday: 'short', month: 'short', day: 'numeric' };
  if (allDay) return at.toLocaleDateString('en-CA', base);
  return at.toLocaleString('en-CA', { ...base, hour: 'numeric', minute: '2-digit' });
}
```

- [ ] **Step 4: Write `src/canvas/parse-ics.ts`**

```ts
// src/canvas/parse-ics.ts
import { vancouverEndOfDayUtc, zonedToUtc } from './tz';

export type FeedItem = {
  uid: string;
  kind: 'assignment' | 'event';
  title: string;
  courseName: string;
  dueAt: Date;
  allDay: boolean;
  url: string | null;
};

export type ParsedFeed = { items: FeedItem[]; skipped: number };

/** RFC 5545 folding: a line beginning with a space or tab continues the
 *  previous line. Canvas folds long SUMMARY and DESCRIPTION values. */
export function unfoldLines(ics: string): string[] {
  const out: string[] = [];
  for (const raw of ics.split(/\r?\n/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length > 0) {
      out[out.length - 1] += raw.slice(1);
    } else if (raw.length > 0) {
      out.push(raw);
    }
  }
  return out;
}

/** "NAME;P1=a;P2=b:value" into its three parts. Property names and parameter
 *  names are case-insensitive per the RFC, so they are upper-cased here. */
function splitProperty(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...rawParams] = head.split(';');
  const params: Record<string, string> = {};
  for (const p of rawParams) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

/** Text values escape commas, semicolons and newlines. */
function unescapeText(v: string): string {
  return v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

/** "Title [Course]" into its two halves. Only a TRAILING bracket is the
 *  course; "Quiz [open book] 2" keeps its bracket in the title. */
export function splitSummary(summary: string): { title: string; courseName: string } {
  const m = summary.match(/^(.*?)\s*\[([^[\]]+)\]\s*$/);
  if (!m) return { title: summary.trim(), courseName: '' };
  return { title: m[1].trim(), courseName: m[2].trim() };
}

/** A DTSTART value with its parameters into a UTC instant, or null when it
 *  cannot be read. Three shapes Canvas emits: VALUE=DATE (all day), a UTC
 *  date-time ending in Z, and a wall-clock date-time with a TZID. */
function parseDtStart(value: string, params: Record<string, string>): { at: Date; allDay: boolean } | null {
  if (params.VALUE === 'DATE' || /^\d{8}$/.test(value)) {
    if (!/^\d{8}$/.test(value)) return null;
    return { at: vancouverEndOfDayUtc(value), allDay: true };
  }
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number);
  if (m[7] === 'Z') return { at: new Date(Date.UTC(y, mo - 1, d, h, mi, s)), allDay: false };
  const tz = params.TZID;
  if (!tz) return null;
  try {
    return { at: zonedToUtc(y, mo, d, h, mi, s, tz), allDay: false };
  } catch {
    return null;
  }
}

export function parseCanvasFeed(ics: string): ParsedFeed {
  const items: FeedItem[] = [];
  let skipped = 0;
  let current: Record<string, { params: Record<string, string>; value: string }> | null = null;

  for (const line of unfoldLines(ics)) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) {
        const item = toItem(current);
        if (item) items.push(item);
        else skipped += 1;
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const prop = splitProperty(line);
    // First occurrence wins; Canvas does not repeat properties, and a
    // repeated one would be a malformed event, not a second value.
    if (prop && !(prop.name in current)) current[prop.name] = { params: prop.params, value: prop.value };
  }

  return { items, skipped };
}

function toItem(p: Record<string, { params: Record<string, string>; value: string }>): FeedItem | null {
  const uid = p.UID?.value.trim();
  const dtstart = p.DTSTART;
  if (!uid || !dtstart) return null;
  const when = parseDtStart(dtstart.value.trim(), dtstart.params);
  if (!when) return null;
  const { title, courseName } = splitSummary(unescapeText(p.SUMMARY?.value ?? ''));
  return {
    uid,
    kind: /assignment/i.test(uid) ? 'assignment' : 'event',
    title,
    courseName,
    dueAt: when.at,
    allDay: when.allDay,
    url: p.URL ? unescapeText(p.URL.value.trim()) || null : null,
  };
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run tests/canvas-parse.test.ts`
Expected: PASS. If the real fixture is present and its block fails, STOP and report which events were skipped and why before choosing between a reader fix and the `ical.js` fallback. Do not add the dependency silently.

- [ ] **Step 6: Commit**

```bash
git add src/canvas/parse-ics.ts src/canvas/tz.ts tests/canvas-parse.test.ts
git commit -m "feat: read a Canvas calendar feed into dated items"
```

---

### Task 2: Models, migration, encryption, URL validation

**Files:**
- Modify: `prisma/schema.prisma` (four models appended; three back-relations on `User`)
- Create: `prisma/migrations/<timestamp>_canvas_deadlines/migration.sql` (generated)
- Create: `src/canvas/crypto.ts`, `src/canvas/feed-url.ts`
- Modify: `.env.example` (add `FEED_ENCRYPTION_KEY=`)
- Test: `tests/canvas-secrets.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/canvas/crypto.ts
  export function assertFeedKey(): void;                // throws if FEED_ENCRYPTION_KEY is missing or malformed
  export function encryptFeedUrl(url: string): string; // base64 of iv(12) || tag(16) || ciphertext
  export function decryptFeedUrl(blob: string): string; // throws on tamper or wrong key

  // src/canvas/feed-url.ts
  export const FEED_HOST = 'canvas.ubc.ca';
  export const FEED_PATH_PREFIX = '/feeds/calendars/';
  export function normalizeFeedUrl(input: string): { ok: true; url: string } | { ok: false; error: string };
  ```

- [ ] **Step 1: Append the models to `prisma/schema.prisma`**

Two deliberate deviations from the spec's section 3 block, both because Prisma needs them: `CanvasFeed` has no `deadlines` relation (deadlines are keyed by `userId` and disconnect deletes them explicitly), and `CanvasFeed` gains `failureCount` so "broken after three consecutive failures" has somewhere to count.

```prisma
/// One per student: the encrypted Canvas calendar feed URL and its health.
/// The URL is a bearer credential for the student's whole calendar. It is
/// never stored in the clear, never logged, and never sent to the browser.
model CanvasFeed {
  id            String    @id @default(cuid())
  userId        String    @unique
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// AES-256-GCM, base64 of iv || tag || ciphertext. See src/canvas/crypto.ts.
  encryptedUrl  String
  connectedAt   DateTime  @default(now())
  lastFetchedAt DateTime?
  /// HTTP status of the last fetch, or 0 for a network failure; null before the first.
  lastStatus    Int?
  /// Consecutive non-200 fetches. Three in a row marks the feed broken.
  failureCount  Int       @default(0)
  /// Set when polling was suspended (401, 404, or three failures). The student
  /// is emailed once. Cleared on reconnect.
  brokenAt      DateTime?
  /// Set once the first sync has run: its welcome email goes out exactly once
  /// and per-item reminders start only after it.
  firstSyncedAt DateTime?
}

/// One per student per Canvas event UID. Two students in one course each hold
/// their own copy: per-section overrides and mutes differ.
model CanvasDeadline {
  id          String    @id @default(cuid())
  userId      String
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// Canvas's own VEVENT UID, stable across polls; the diff key.
  uid         String
  /// "assignment" when the UID contains that word, else "event".
  kind        String
  /// The SUMMARY with its trailing "[Course]" removed.
  title       String
  /// The bracketed course name from the SUMMARY, verbatim.
  courseName  String
  /// The instant it is due, UTC. An all-day item is 23:59:59 Vancouver on
  /// that date, so "due Friday" reminds before Friday ends.
  dueAt       DateTime
  allDay      Boolean   @default(false)
  url         String?
  firstSeenAt DateTime  @default(now())
  /// Set when a poll found a different dueAt. Kept, not cleared: the sent-log's
  /// notice key stops the notice repeating, and the page shows the move.
  movedFrom   DateTime?
  movedAt     DateTime?
  /// Set when a poll no longer returned this uid. Kept and marked, never
  /// deleted: a prof deleting an assignment is a fact worth showing.
  removedAt   DateTime?
  reminders   ReminderSent[]

  @@unique([userId, uid])
  @@index([userId, dueAt])
}

model ReminderPreference {
  userId       String   @id
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  enabled      Boolean  @default(true)
  /// Hours before dueAt at which to remind. Default 3 days and 1 day.
  leadHours    Int[]    @default([72, 24])
  /// Course names, as they appear in the feed's brackets, the student muted.
  mutedCourses String[] @default([])
}

/// The no-double-send guarantee. A row is claimed BEFORE the email is sent;
/// the unique below means two overlapping runs cannot both send. A row with
/// null deliveredAt is a claim whose send failed, retried next run.
model ReminderSent {
  id          String         @id @default(cuid())
  userId      String
  deadlineId  String
  deadline    CanvasDeadline @relation(fields: [deadlineId], references: [id], onDelete: Cascade)
  /// "lead:72", "lead:24", "moved:<new dueAt ISO>", "removed".
  notice      String
  claimedAt   DateTime       @default(now())
  deliveredAt DateTime?

  @@unique([deadlineId, notice])
  @@index([userId, deliveredAt])
}
```

And inside `model User`, after `hiddenFinalExams HiddenFinalExam[]`:

```prisma
  canvasFeed         CanvasFeed?
  canvasDeadlines    CanvasDeadline[]
  reminderPreference ReminderPreference?
```

- [ ] **Step 2: Migrate**

Run: `npx prisma migrate dev --name canvas_deadlines` then `npx prisma generate`.
Expected: one migration, all four tables created, client regenerated. Then restart the dev server if one is running; it holds the old client.

- [ ] **Step 3: Write the failing tests**

```ts
// tests/canvas-secrets.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { decryptFeedUrl, encryptFeedUrl } from '@/canvas/crypto';
import { normalizeFeedUrl } from '@/canvas/feed-url';

beforeAll(() => {
  // 32 bytes, hex. Tests never read the real key.
  process.env.FEED_ENCRYPTION_KEY ??= '00'.repeat(31) + '01';
});

describe('feed URL encryption', () => {
  const url = 'https://canvas.ubc.ca/feeds/calendars/user_abc123.ics';

  it('round-trips', () => {
    expect(decryptFeedUrl(encryptFeedUrl(url))).toBe(url);
  });

  it('uses a fresh IV, so the same URL never encrypts to the same blob', () => {
    expect(encryptFeedUrl(url)).not.toBe(encryptFeedUrl(url));
  });

  it('refuses a tampered blob rather than returning garbage', () => {
    const blob = encryptFeedUrl(url);
    const bytes = Buffer.from(blob, 'base64');
    bytes[bytes.length - 1] ^= 0x01;
    expect(() => decryptFeedUrl(bytes.toString('base64'))).toThrow();
  });
});

describe('normalizeFeedUrl', () => {
  it('accepts the real feed shape', () => {
    expect(normalizeFeedUrl(' https://canvas.ubc.ca/feeds/calendars/user_abc.ics ')).toEqual({
      ok: true,
      url: 'https://canvas.ubc.ca/feeds/calendars/user_abc.ics',
    });
  });

  it('rewrites webcal to https', () => {
    expect(normalizeFeedUrl('webcal://canvas.ubc.ca/feeds/calendars/user_abc.ics')).toEqual({
      ok: true,
      url: 'https://canvas.ubc.ca/feeds/calendars/user_abc.ics',
    });
  });

  // The only defence against our server fetching an arbitrary host.
  it.each([
    ['https://evil.example/feeds/calendars/x.ics', 'host'],
    ['https://canvas.ubc.ca.evil.example/feeds/calendars/x.ics', 'host'],
    ['https://canvas.ubc.ca/courses/1', 'feeds'],
    ['http://canvas.ubc.ca/feeds/calendars/x.ics', 'https'],
    ['https://169.254.169.254/feeds/calendars/x.ics', 'host'],
    ['javascript:alert(1)', ''],
    ['not a url', ''],
    ['', ''],
  ])('rejects %s', (input, _hint) => {
    expect(normalizeFeedUrl(input).ok).toBe(false);
  });

  it('caps length', () => {
    expect(normalizeFeedUrl('https://canvas.ubc.ca/feeds/calendars/' + 'a'.repeat(600)).ok).toBe(false);
  });
});
```

- [ ] **Step 4: Run and confirm failure**

Run: `npx vitest run tests/canvas-secrets.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 5: Write `src/canvas/crypto.ts` and `src/canvas/feed-url.ts`**

```ts
// src/canvas/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Separate from SERVER_SECRET on purpose: that key hashes student numbers
 *  and must never rotate; this one should be rotatable on its own. */
function key(): Buffer {
  const hex = process.env.FEED_ENCRYPTION_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('FEED_ENCRYPTION_KEY is not set to 32 hex bytes. Refusing to handle feed URLs unkeyed.');
  }
  return Buffer.from(hex, 'hex');
}

/** For the job's startup: fail before the loop, loudly, the way hash.ts
 *  refuses without SERVER_SECRET. Without this a missing key would surface
 *  as one caught error per feed and a run that looks like it did its job. */
export function assertFeedKey(): void {
  key();
}

export function encryptFeedUrl(url: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(url, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decryptFeedUrl(blob: string): string {
  const bytes = Buffer.from(blob, 'base64');
  const iv = bytes.subarray(0, IV_BYTES);
  const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = bytes.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
```

```ts
// src/canvas/feed-url.ts
export const FEED_HOST = 'canvas.ubc.ca';
export const FEED_PATH_PREFIX = '/feeds/calendars/';
const MAX_LEN = 512;

/**
 * The whole defence against server-side request forgery. This is why fetching
 * a student-supplied URL is acceptable here when it was refused for syllabus
 * links: after this check a request can only ever reach Canvas's feed path.
 * Applied at connect time AND again in the job after decrypting, so a key or
 * data problem cannot turn into a request to an arbitrary host.
 */
export function normalizeFeedUrl(input: string): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = input.trim().replace(/^webcal:\/\//i, 'https://');
  if (trimmed.length === 0 || trimmed.length > MAX_LEN) {
    return { ok: false, error: 'Paste the Calendar Feed link from Canvas.' };
  }
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, error: 'That is not a link.' };
  }
  if (u.protocol !== 'https:' || u.hostname !== FEED_HOST || !u.pathname.startsWith(FEED_PATH_PREFIX)) {
    return {
      ok: false,
      error: 'That is not a canvas.ubc.ca Calendar Feed link. In Canvas, open Calendar and click Calendar Feed.',
    };
  }
  return { ok: true, url: u.toString() };
}
```

Add to `.env.example`, with a comment: `FEED_ENCRYPTION_KEY=` (`openssl rand -hex 32`; encrypts stored Canvas feed URLs).

- [ ] **Step 6: Run the tests, then the full suite**

Run: `npx vitest run tests/canvas-secrets.test.ts` then `npm test`
Expected: PASS; the suite does not regress.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/canvas/crypto.ts src/canvas/feed-url.ts .env.example tests/canvas-secrets.test.ts
git commit -m "feat: store a student's Canvas feed encrypted, with the host pinned"
```

---

### Task 3: Connect, disconnect, and the Account block

**Files:**
- Create: `src/canvas/fetch-feed.ts`
- Create: `src/canvas/connect.ts` (the logic; NOT a `'use server'` file)
- Create: `src/app/actions/canvas.ts` (auth wrappers only)
- Create: `src/components/CanvasConnect.tsx`
- Modify: `src/app/onboarding/page.tsx` (one new section under the verified block)
- Test: `tests/canvas-connect.test.ts`

**Why two files.** Every exported function in a `'use server'` file is a
callable endpoint, whether or not any component references it. A helper
that takes a `userId` parameter must therefore never be exported from the
actions file, or any client could act on any user by passing their id. The
logic lives in `src/canvas/connect.ts`, tests import it from there, and the
actions file exports only functions that read the session themselves.
(`src/app/actions/account.ts` currently exports `deleteAccountFor(userId)`
and `removeCourseFor(userId, ...)` this way; that is a pre-existing concern
noted for the author, not this task's to fix.)

**Interfaces:**
- Consumes: `normalizeFeedUrl`, `encryptFeedUrl` (Task 2); `parseCanvasFeed` (Task 1).
- Produces:
  ```ts
  // src/canvas/fetch-feed.ts
  export const FEED_TIMEOUT_MS = 20_000;
  export const FEED_MAX_BYTES = 2 * 1024 * 1024;
  export async function fetchFeed(url: string): Promise<{ status: number; body: string | null }>;

  // src/canvas/connect.ts
  export type Result = { ok: true } | { ok: false; error: string };
  export async function connectCanvasFeedFor(userId: string, input: string): Promise<Result>;
  export async function disconnectCanvasFeedFor(userId: string): Promise<Result>;

  // src/app/actions/canvas.ts  ('use server'; exports ONLY session-reading async functions)
  export async function connectCanvasFeed(input: string): Promise<Result>;
  export async function disconnectCanvasFeed(): Promise<Result>;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/canvas-connect.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { db } from '@/lib/db';

// The action fetches the feed once to prove it works. Stub that, never the network.
vi.mock('@/canvas/fetch-feed', () => ({
  fetchFeed: vi.fn(async (url: string) =>
    url.includes('dead')
      ? { status: 404, body: null }
      : { status: 200, body: 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:event-assignment-1\r\nSUMMARY:A [C 1]\r\nDTSTART:20261027T065959Z\r\nEND:VEVENT\r\nEND:VCALENDAR' },
  ),
  FEED_TIMEOUT_MS: 1,
  FEED_MAX_BYTES: 1,
}));

import { connectCanvasFeedFor, disconnectCanvasFeedFor } from '@/canvas/connect';

const A = 'zz-canvas-a@example.com';
const B = 'zz-canvas-b@example.com';
let userA: string;
let userB: string;
const GOOD = 'https://canvas.ubc.ca/feeds/calendars/user_good.ics';

beforeAll(async () => {
  process.env.FEED_ENCRYPTION_KEY ??= '00'.repeat(31) + '01';
  await db.user.deleteMany({ where: { email: { in: [A, B] } } });
  userA = (await db.user.create({ data: { email: A } })).id;
  userB = (await db.user.create({ data: { email: B } })).id;
});
afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: [A, B] } } });
  await db.$disconnect();
});

describe('connectCanvasFeedFor', () => {
  it('stores the feed encrypted and creates default preferences', async () => {
    const r = await connectCanvasFeedFor(userA, GOOD);
    expect(r).toEqual({ ok: true });
    const feed = await db.canvasFeed.findUniqueOrThrow({ where: { userId: userA } });
    expect(feed.encryptedUrl).not.toContain('canvas.ubc.ca');
    expect(feed.brokenAt).toBeNull();
    const prefs = await db.reminderPreference.findUniqueOrThrow({ where: { userId: userA } });
    expect(prefs.leadHours).toEqual([72, 24]);
  });

  it('rejects a link that is not the Canvas feed, before any fetch', async () => {
    const r = await connectCanvasFeedFor(userA, 'https://evil.example/feeds/calendars/x.ics');
    expect(r.ok).toBe(false);
  });

  it('rejects a feed that does not answer 200, and names the status not the URL', async () => {
    const r = await connectCanvasFeedFor(userA, 'https://canvas.ubc.ca/feeds/calendars/user_dead.ics');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/404/);
      expect(r.error).not.toContain('user_dead');
    }
  });

  it('reconnecting replaces the URL and clears a broken flag', async () => {
    await db.canvasFeed.update({ where: { userId: userA }, data: { brokenAt: new Date(), failureCount: 3 } });
    await connectCanvasFeedFor(userA, GOOD);
    const feed = await db.canvasFeed.findUniqueOrThrow({ where: { userId: userA } });
    expect(feed.brokenAt).toBeNull();
    expect(feed.failureCount).toBe(0);
  });
});

describe('disconnectCanvasFeedFor', () => {
  it('removes the feed and every deadline under it, and only for that student', async () => {
    await connectCanvasFeedFor(userB, GOOD);
    await db.canvasDeadline.create({
      data: { userId: userB, uid: 'event-assignment-9', kind: 'assignment', title: 'x', courseName: 'C', dueAt: new Date() },
    });
    const r = await disconnectCanvasFeedFor(userB);
    expect(r).toEqual({ ok: true });
    expect(await db.canvasFeed.findUnique({ where: { userId: userB } })).toBeNull();
    expect(await db.canvasDeadline.count({ where: { userId: userB } })).toBe(0);
    // Student A's feed is untouched.
    expect(await db.canvasFeed.findUnique({ where: { userId: userA } })).not.toBeNull();
  });

  it('is a 404 shape for a student with nothing connected', async () => {
    const r = await disconnectCanvasFeedFor(userB);
    expect(r).toEqual({ ok: false, error: 'Not found.' });
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/canvas-connect.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Write `src/canvas/fetch-feed.ts`**

```ts
// src/canvas/fetch-feed.ts
export const FEED_TIMEOUT_MS = 20_000;
export const FEED_MAX_BYTES = 2 * 1024 * 1024;

/**
 * One fetch, bounded two ways. A feed is tens of kilobytes; a body past the
 * cap is wrong and is discarded. Status 0 means the request itself failed
 * (timeout, DNS, reset), which callers treat as transient.
 *
 * Callers pass a URL that has ALREADY been through normalizeFeedUrl. This
 * function does not re-check the host; the job does, before calling it.
 */
export async function fetchFeed(url: string): Promise<{ status: number; body: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'text/calendar', 'User-Agent': 'UBCFlow/0.1 (+https://ubcflow.com)' },
      redirect: 'manual',
    });
    if (res.status !== 200) return { status: res.status, body: null };
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > FEED_MAX_BYTES) return { status: 200, body: null };
    const text = await res.text();
    if (text.length > FEED_MAX_BYTES) return { status: 200, body: null };
    return { status: 200, body: text };
  } catch {
    return { status: 0, body: null };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Write `src/canvas/connect.ts`, then the thin actions file**

```ts
// src/canvas/connect.ts  (plain module, no 'use server')
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { encryptFeedUrl } from '@/canvas/crypto';
import { normalizeFeedUrl } from '@/canvas/feed-url';
import { fetchFeed } from '@/canvas/fetch-feed';
import { parseCanvasFeed } from '@/canvas/parse-ics';

export type Result = { ok: true } | { ok: false; error: string };

/**
 * Validates, proves the feed answers, encrypts, stores. The URL never appears
 * in a log line, an error string, or a response: failures name the HTTP
 * status and nothing else. Reconnecting replaces the URL and clears a broken
 * flag but keeps firstSyncedAt, so a reconnect does not send a second
 * welcome email.
 */
export async function connectCanvasFeedFor(userId: string, input: string): Promise<Result> {
  const normalized = normalizeFeedUrl(input);
  if (!normalized.ok) return normalized;

  const { status, body } = await fetchFeed(normalized.url);
  if (status !== 200 || body === null) {
    return { ok: false, error: `Canvas answered ${status || 'with no response'}. Check the link and try again.` };
  }
  if (!/BEGIN:VCALENDAR/i.test(body)) {
    return { ok: false, error: 'That link did not return a calendar. In Canvas, open Calendar and click Calendar Feed.' };
  }
  parseCanvasFeed(body); // proves it parses; the job stores items, not this action

  const encryptedUrl = encryptFeedUrl(normalized.url);
  await db.$transaction([
    db.canvasFeed.upsert({
      where: { userId },
      create: { userId, encryptedUrl },
      update: { encryptedUrl, connectedAt: new Date(), brokenAt: null, failureCount: 0, lastStatus: null },
    }),
    db.reminderPreference.upsert({ where: { userId }, create: { userId }, update: {} }),
  ]);
  revalidatePath('/onboarding');
  return { ok: true };
}

/** Deletes the feed and every deadline and sent-log row under it. Explicit
 *  rather than cascade because deadlines hang off the user, not the feed. */
export async function disconnectCanvasFeedFor(userId: string): Promise<Result> {
  const feed = await db.canvasFeed.findUnique({ where: { userId }, select: { id: true } });
  if (!feed) return { ok: false, error: 'Not found.' };
  await db.$transaction([
    db.canvasDeadline.deleteMany({ where: { userId } }), // ReminderSent cascades
    db.canvasFeed.delete({ where: { id: feed.id } }),
  ]);
  revalidatePath('/onboarding');
  return { ok: true };
}
```

```ts
// src/app/actions/canvas.ts
'use server';

import { auth } from '@/lib/auth';
import { connectCanvasFeedFor, disconnectCanvasFeedFor, type Result } from '@/canvas/connect';

// Only session-reading functions are exported here. Anything that takes a
// userId lives in src/canvas/connect.ts: an export from this file is an
// endpoint, and an endpoint that trusts a caller-supplied userId is a hole.

export async function connectCanvasFeed(input: string): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };
  return connectCanvasFeedFor(session.user.id, input);
}

export async function disconnectCanvasFeed(): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };
  return disconnectCanvasFeedFor(session.user.id);
}
```

- [ ] **Step 5: Write `src/components/CanvasConnect.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { connectCanvasFeed, disconnectCanvasFeed } from '@/app/actions/canvas';
import ConfirmDialog from '@/components/ConfirmDialog';

/**
 * The URL is a credential. Once stored it is never shown again, not even
 * masked: the block shows only when it was connected and when it was last
 * read, and offers Disconnect.
 */
export default function CanvasConnect({
  connectedAt,
  lastFetchedAt,
  broken,
}: {
  connectedAt: string | null;
  lastFetchedAt: string | null;
  broken: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await connectCanvasFeed(value);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setValue('');
    router.refresh();
  }

  async function disconnect() {
    setBusy(true);
    const r = await disconnectCanvasFeed();
    setBusy(false);
    setConfirming(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  if (connectedAt && !broken) {
    return (
      <div className="space-y-2 text-sm text-text-secondary">
        <p>
          Connected {new Date(connectedAt).toLocaleDateString('en-CA')}
          {lastFetchedAt ? `, last read ${new Date(lastFetchedAt).toLocaleString('en-CA')}` : ', not read yet'}.
        </p>
        <button type="button" onClick={() => setConfirming(true)} className="text-sm font-medium text-danger hover:underline">
          Disconnect Canvas
        </button>
        <ConfirmDialog open={confirming} title="Disconnect Canvas?" confirmLabel="Disconnect" destructive busy={busy}
          onConfirm={disconnect} onCancel={() => setConfirming(false)}>
          <p>This forgets your feed link and every deadline read from it. Reminders stop. You can reconnect any time.</p>
        </ConfirmDialog>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      {broken && (
        <p className="text-sm text-danger">
          Your Canvas feed stopped answering. Paste a fresh Calendar Feed link to reconnect.
        </p>
      )}
      <p className="text-sm text-text-secondary">
        In Canvas, open Calendar, click Calendar Feed at the bottom right, and copy the link.
      </p>
      <input
        type="url"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="https://canvas.ubc.ca/feeds/calendars/..."
        aria-label="Canvas Calendar Feed link"
        className="block w-full rounded-input border border-border bg-surface px-2 py-1 text-sm text-foreground"
      />
      <div className="flex items-center gap-3">
        <button disabled={busy || !value} className="rounded-pill bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground disabled:opacity-50">
          {busy ? 'Checking...' : 'Connect Canvas'}
        </button>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </form>
  );
}
```

- [ ] **Step 6: Add the section to `src/app/onboarding/page.tsx`**

In the page's data loading, alongside the existing user query, fetch `db.canvasFeed.findUnique({ where: { userId }, select: { connectedAt: true, lastFetchedAt: true, brokenAt: true } })`. Then, directly after the "Review your courses" section and before "Current courses", render:

```tsx
<section className="mt-6">
  <h2 className="text-xl font-semibold text-foreground">Canvas deadlines</h2>
  <p className="mt-1 text-sm text-text-secondary">
    Connect your Canvas calendar and every assignment due date lands here, refreshes on its own, and reminds you by email before it is due.
  </p>
  <div className="mt-3">
    <CanvasConnect
      connectedAt={feed?.connectedAt.toISOString() ?? null}
      lastFetchedAt={feed?.lastFetchedAt?.toISOString() ?? null}
      broken={Boolean(feed?.brokenAt)}
    />
  </div>
  {feed && (
    <p className="mt-2 text-sm">
      <Link href="/deadlines" className="text-brand-accent hover:underline">See your deadlines and reminder settings</Link>
    </p>
  )}
</section>
```

(`/deadlines` is built in Task 6; the link 404s until then, which is acceptable on the feature branch and is why Task 6 precedes any deploy.)

- [ ] **Step 7: Run the tests, the suite, typecheck, lint**

Run: `npx vitest run tests/canvas-connect.test.ts && npm test && npx tsc --noEmit && npx eslint src/app/actions/canvas.ts src/components/CanvasConnect.tsx src/canvas/fetch-feed.ts`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/canvas/fetch-feed.ts src/canvas/connect.ts src/app/actions/canvas.ts src/components/CanvasConnect.tsx src/app/onboarding/page.tsx tests/canvas-connect.test.ts
git commit -m "feat: a student connects their Canvas feed from the Account page"
```

---

### Task 4: The sync job: fetch and diff

**Files:**
- Create: `src/canvas/diff.ts`
- Create: `src/canvas/jobs/sync.ts`
- Test: `tests/canvas-diff.test.ts`, `tests/canvas-sync.test.ts`

**Interfaces:**
- Consumes: `parseCanvasFeed`, `FeedItem` (Task 1); `decryptFeedUrl`, `normalizeFeedUrl` (Task 2); `fetchFeed` (Task 3).
- Produces:
  ```ts
  // src/canvas/diff.ts
  export type StoredDeadline = { id: string; uid: string; dueAt: Date; removedAt: Date | null };
  export type FeedDiff = {
    create: FeedItem[];
    move: { id: string; from: Date; to: Date; restored: boolean }[];
    restore: string[];  // ids present again with the same dueAt
    remove: string[];   // ids no longer in the feed, not already removed
  };
  export function diffFeed(stored: StoredDeadline[], items: FeedItem[]): FeedDiff;

  // src/canvas/jobs/sync.ts
  export type SyncOutcome = 'ok' | 'transient' | 'broken' | 'skipped';
  export async function syncFeedFor(userId: string, now: Date): Promise<SyncOutcome>;
  export async function applyDiff(userId: string, diff: FeedDiff, now: Date): Promise<void>;
  export const BROKEN_AFTER_FAILURES = 3;
  ```
  Notices (Task 5) are NOT sent from this task; `syncFeedFor` only refreshes rows and feed health.

- [ ] **Step 1: Write the failing diff tests**

```ts
// tests/canvas-diff.test.ts
import { describe, it, expect } from 'vitest';
import { diffFeed, type StoredDeadline } from '@/canvas/diff';
import type { FeedItem } from '@/canvas/parse-ics';

const item = (uid: string, iso: string): FeedItem => ({
  uid, kind: 'assignment', title: uid, courseName: 'C', dueAt: new Date(iso), allDay: false, url: null,
});
const stored = (id: string, uid: string, iso: string, removed = false): StoredDeadline => ({
  id, uid, dueAt: new Date(iso), removedAt: removed ? new Date('2026-09-01T00:00:00Z') : null,
});

describe('diffFeed', () => {
  it('creates what it has never seen', () => {
    const d = diffFeed([], [item('a', '2026-10-27T06:59:59Z')]);
    expect(d.create.map((i) => i.uid)).toEqual(['a']);
    expect(d.move).toEqual([]);
    expect(d.remove).toEqual([]);
  });

  it('does nothing for an unchanged deadline', () => {
    const d = diffFeed([stored('1', 'a', '2026-10-27T06:59:59Z')], [item('a', '2026-10-27T06:59:59Z')]);
    expect(d).toEqual({ create: [], move: [], restore: [], remove: [] });
  });

  it('records a move with where it moved from', () => {
    const d = diffFeed([stored('1', 'a', '2026-10-27T06:59:59Z')], [item('a', '2026-10-30T06:59:59Z')]);
    expect(d.move).toEqual([{ id: '1', from: new Date('2026-10-27T06:59:59Z'), to: new Date('2026-10-30T06:59:59Z'), restored: false }]);
  });

  it('marks a deadline the feed no longer lists, once', () => {
    const d = diffFeed([stored('1', 'a', '2026-10-27T06:59:59Z'), stored('2', 'b', '2026-10-27T06:59:59Z', true)], []);
    expect(d.remove).toEqual(['1']); // '2' was already removed
  });

  it('restores a removed deadline the prof put back, unchanged or moved', () => {
    const same = diffFeed([stored('1', 'a', '2026-10-27T06:59:59Z', true)], [item('a', '2026-10-27T06:59:59Z')]);
    expect(same.restore).toEqual(['1']);
    const moved = diffFeed([stored('1', 'a', '2026-10-27T06:59:59Z', true)], [item('a', '2026-11-01T06:59:59Z')]);
    expect(moved.move[0]).toMatchObject({ id: '1', restored: true });
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/canvas-diff.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `src/canvas/diff.ts`**

```ts
// src/canvas/diff.ts
import type { FeedItem } from './parse-ics';

export type StoredDeadline = { id: string; uid: string; dueAt: Date; removedAt: Date | null };

export type FeedDiff = {
  create: FeedItem[];
  move: { id: string; from: Date; to: Date; restored: boolean }[];
  restore: string[];
  remove: string[];
};

/** Pure. Keyed on Canvas's UID, which is stable across polls. A row that
 *  drops out of the feed is marked removed once and left alone after; a row
 *  that comes back is restored, moved or not. */
export function diffFeed(stored: StoredDeadline[], items: FeedItem[]): FeedDiff {
  const byUid = new Map(stored.map((s) => [s.uid, s]));
  const seen = new Set<string>();
  const diff: FeedDiff = { create: [], move: [], restore: [], remove: [] };

  for (const it of items) {
    seen.add(it.uid);
    const s = byUid.get(it.uid);
    if (!s) {
      diff.create.push(it);
      continue;
    }
    const wasRemoved = s.removedAt !== null;
    if (s.dueAt.getTime() !== it.dueAt.getTime()) {
      diff.move.push({ id: s.id, from: s.dueAt, to: it.dueAt, restored: wasRemoved });
    } else if (wasRemoved) {
      diff.restore.push(s.id);
    }
  }
  for (const s of stored) {
    if (!seen.has(s.uid) && s.removedAt === null) diff.remove.push(s.id);
  }
  return diff;
}
```

- [ ] **Step 4: Run the diff tests, confirm they pass**

Run: `npx vitest run tests/canvas-diff.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing sync tests**

```ts
// tests/canvas-sync.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { db } from '@/lib/db';

const feedResponse = { status: 200, body: '' };
vi.mock('@/canvas/fetch-feed', () => ({
  fetchFeed: vi.fn(async () => feedResponse),
  FEED_TIMEOUT_MS: 1,
  FEED_MAX_BYTES: 1,
}));

import { encryptFeedUrl } from '@/canvas/crypto';
import { syncFeedFor, BROKEN_AFTER_FAILURES } from '@/canvas/jobs/sync';

const E = 'zz-canvas-sync@example.com';
let userId: string;
const NOW = new Date('2026-10-20T15:00:00Z');
const cal = (events: string[]) => ['BEGIN:VCALENDAR', ...events, 'END:VCALENDAR'].join('\r\n');
const ev = (uid: string, dt: string, course = 'CPSC 110 101') =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:T [${course}]\r\nDTSTART:${dt}\r\nEND:VEVENT`;

beforeAll(async () => {
  process.env.FEED_ENCRYPTION_KEY ??= '00'.repeat(31) + '01';
  await db.user.deleteMany({ where: { email: E } });
  userId = (await db.user.create({ data: { email: E } })).id;
});
afterAll(async () => {
  await db.user.deleteMany({ where: { email: E } });
  await db.$disconnect();
});
beforeEach(async () => {
  await db.canvasDeadline.deleteMany({ where: { userId } });
  await db.canvasFeed.deleteMany({ where: { userId } });
  await db.canvasFeed.create({
    data: { userId, encryptedUrl: encryptFeedUrl('https://canvas.ubc.ca/feeds/calendars/user_t.ics') },
  });
  feedResponse.status = 200;
  feedResponse.body = cal([ev('event-assignment-1', '20261027T065959Z'), ev('event-assignment-2', '20261030T065959Z')]);
});

describe('syncFeedFor', () => {
  it('stores every dated item on first sync and records the fetch', async () => {
    expect(await syncFeedFor(userId, NOW)).toBe('ok');
    const rows = await db.canvasDeadline.findMany({ where: { userId }, orderBy: { uid: 'asc' } });
    expect(rows.map((r) => r.uid)).toEqual(['event-assignment-1', 'event-assignment-2']);
    const feed = await db.canvasFeed.findUniqueOrThrow({ where: { userId } });
    expect(feed.lastStatus).toBe(200);
    expect(feed.failureCount).toBe(0);
  });

  it('marks a move and a removal on the next sync, and restores on the one after', async () => {
    await syncFeedFor(userId, NOW);
    feedResponse.body = cal([ev('event-assignment-1', '20261029T065959Z')]); // 1 moved, 2 gone
    await syncFeedFor(userId, NOW);
    const one = await db.canvasDeadline.findFirstOrThrow({ where: { userId, uid: 'event-assignment-1' } });
    expect(one.movedFrom?.toISOString()).toBe('2026-10-27T06:59:59.000Z');
    expect(one.dueAt.toISOString()).toBe('2026-10-29T06:59:59.000Z');
    const two = await db.canvasDeadline.findFirstOrThrow({ where: { userId, uid: 'event-assignment-2' } });
    expect(two.removedAt).not.toBeNull();

    feedResponse.body = cal([ev('event-assignment-1', '20261029T065959Z'), ev('event-assignment-2', '20261030T065959Z')]);
    await syncFeedFor(userId, NOW);
    const back = await db.canvasDeadline.findFirstOrThrow({ where: { userId, uid: 'event-assignment-2' } });
    expect(back.removedAt).toBeNull();
  });

  it('treats a timeout as transient and does not touch deadlines', async () => {
    await syncFeedFor(userId, NOW);
    feedResponse.status = 0;
    feedResponse.body = null as unknown as string;
    expect(await syncFeedFor(userId, NOW)).toBe('transient');
    expect(await db.canvasDeadline.count({ where: { userId, removedAt: null } })).toBe(2);
    const feed = await db.canvasFeed.findUniqueOrThrow({ where: { userId } });
    expect(feed.failureCount).toBe(1);
    expect(feed.brokenAt).toBeNull();
  });

  it('breaks on a 404 immediately, and on repeated failures', async () => {
    feedResponse.status = 404;
    feedResponse.body = null as unknown as string;
    expect(await syncFeedFor(userId, NOW)).toBe('broken');
    expect((await db.canvasFeed.findUniqueOrThrow({ where: { userId } })).brokenAt).not.toBeNull();

    await db.canvasFeed.update({ where: { userId }, data: { brokenAt: null, failureCount: 0 } });
    feedResponse.status = 503;
    for (let i = 1; i < BROKEN_AFTER_FAILURES; i++) expect(await syncFeedFor(userId, NOW)).toBe('transient');
    expect(await syncFeedFor(userId, NOW)).toBe('broken');
  });

  it('skips a feed already marked broken', async () => {
    await db.canvasFeed.update({ where: { userId }, data: { brokenAt: NOW } });
    expect(await syncFeedFor(userId, NOW)).toBe('skipped');
  });
});
```

- [ ] **Step 6: Run and confirm failure**

Run: `npx vitest run tests/canvas-sync.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 7: Write `src/canvas/jobs/sync.ts`**

```ts
// src/canvas/jobs/sync.ts
import { db } from '@/lib/db';
import { decryptFeedUrl } from '@/canvas/crypto';
import { normalizeFeedUrl } from '@/canvas/feed-url';
import { fetchFeed } from '@/canvas/fetch-feed';
import { parseCanvasFeed } from '@/canvas/parse-ics';
import { diffFeed, type FeedDiff } from '@/canvas/diff';

export const BROKEN_AFTER_FAILURES = 3;
export type SyncOutcome = 'ok' | 'transient' | 'broken' | 'skipped';

/**
 * Refreshes one student's deadlines from their feed. Never sends anything;
 * notices are Task 5's job and run after every feed has synced.
 *
 * A 401 or 404 means the student regenerated or revoked the feed in Canvas
 * and it will never answer again: broken at once. Anything else non-200 is
 * transient until it has happened BROKEN_AFTER_FAILURES times in a row.
 * A broken feed is skipped until the student reconnects. Nothing here ever
 * deletes a deadline row: a failed fetch leaves last time's data alone.
 */
export async function syncFeedFor(userId: string, now: Date): Promise<SyncOutcome> {
  const feed = await db.canvasFeed.findUnique({ where: { userId } });
  if (!feed || feed.brokenAt) return 'skipped';

  // Re-validated after decrypting, so a key or data problem cannot become a
  // request to an arbitrary host. The URL itself is never logged.
  const url = normalizeFeedUrl(decryptFeedUrl(feed.encryptedUrl));
  if (!url.ok) {
    await db.canvasFeed.update({ where: { userId }, data: { brokenAt: now, lastFetchedAt: now } });
    console.error('canvas sync: stored feed URL failed validation for one user; marked broken');
    return 'broken';
  }

  const { status, body } = await fetchFeed(url.url);
  if (status !== 200 || body === null) {
    const failures = feed.failureCount + 1;
    const dead = status === 401 || status === 404 || failures >= BROKEN_AFTER_FAILURES;
    await db.canvasFeed.update({
      where: { userId },
      data: { lastFetchedAt: now, lastStatus: status, failureCount: failures, brokenAt: dead ? now : null },
    });
    return dead ? 'broken' : 'transient';
  }

  const parsed = parseCanvasFeed(body);
  const stored = await db.canvasDeadline.findMany({
    where: { userId },
    select: { id: true, uid: true, dueAt: true, removedAt: true },
  });
  await applyDiff(userId, diffFeed(stored, parsed.items), now);
  await db.canvasFeed.update({
    where: { userId },
    data: { lastFetchedAt: now, lastStatus: 200, failureCount: 0 },
  });
  return 'ok';
}

export async function applyDiff(userId: string, diff: FeedDiff, now: Date): Promise<void> {
  await db.$transaction([
    ...diff.create.map((it) =>
      db.canvasDeadline.create({
        data: {
          userId, uid: it.uid, kind: it.kind, title: it.title, courseName: it.courseName,
          dueAt: it.dueAt, allDay: it.allDay, url: it.url, firstSeenAt: now,
        },
      }),
    ),
    ...diff.move.map((m) =>
      db.canvasDeadline.update({
        where: { id: m.id },
        data: { dueAt: m.to, movedFrom: m.from, movedAt: now, ...(m.restored ? { removedAt: null } : {}) },
      }),
    ),
    ...(diff.restore.length
      ? [db.canvasDeadline.updateMany({ where: { id: { in: diff.restore } }, data: { removedAt: null } })]
      : []),
    ...(diff.remove.length
      ? [db.canvasDeadline.updateMany({ where: { id: { in: diff.remove } }, data: { removedAt: now } })]
      : []),
  ]);
}
```

- [ ] **Step 8: Run both test files, then the suite**

Run: `npx vitest run tests/canvas-diff.test.ts tests/canvas-sync.test.ts && npm test`
Expected: PASS; no regression.

- [ ] **Step 9: Commit**

```bash
git add src/canvas/diff.ts src/canvas/jobs/sync.ts tests/canvas-diff.test.ts tests/canvas-sync.test.ts
git commit -m "feat: sync a student's Canvas deadlines and notice what moved"
```

---

### Task 5: Notices, the sent-log, the emails, the mute link

**Files:**
- Create: `src/canvas/notices.ts` (pure selection)
- Create: `src/canvas/emails.ts` (pure builders)
- Create: `src/canvas/jobs/notify.ts` (claim, batch, send)
- Modify: `src/lib/mail.ts` (`TokenPurpose` gains `'mute'`; `sendMail` returns `Promise<boolean>`)
- Create: `src/app/reminders/[token]/page.tsx` (mute landing)
- Test: `tests/canvas-notices.test.ts`, `tests/canvas-notify.test.ts`

**Interfaces:**
- Consumes: `formatVancouver` (Task 1); models (Task 2); `sendMail`, `createToken`, `consumeToken` (existing).
- Produces:
  ```ts
  // src/canvas/notices.ts
  export const WINDOW_GRACE_MS = 24 * 60 * 60 * 1000;
  export type DeadlineForNotice = {
    id: string; title: string; courseName: string; dueAt: Date; allDay: boolean; url: string | null;
    movedFrom: Date | null; movedAt: Date | null; removedAt: Date | null;
  };
  export type Prefs = { enabled: boolean; leadHours: number[]; mutedCourses: string[] };
  export type Notice = { deadline: DeadlineForNotice; key: string; kind: 'lead' | 'moved' | 'removed'; leadHours?: number };
  export function selectNotices(deadlines: DeadlineForNotice[], prefs: Prefs, now: Date): Notice[];

  // src/canvas/emails.ts
  export function welcomeEmail(items: DeadlineForNotice[], prefs: Prefs, muteUrl: string): { subject: string; body: string };
  export function reminderEmail(notices: Notice[], muteUrl: string): { subject: string; body: string };
  export function reconnectEmail(accountUrl: string): { subject: string; body: string };

  // src/canvas/jobs/notify.ts
  export async function notifyFor(userId: string, now: Date): Promise<{ sent: number }>;
  ```

- [ ] **Step 1: Write the failing selection tests**

```ts
// tests/canvas-notices.test.ts
import { describe, it, expect } from 'vitest';
import { selectNotices, type DeadlineForNotice, type Prefs } from '@/canvas/notices';

const H = 60 * 60 * 1000;
const NOW = new Date('2026-10-24T15:00:00Z');
const at = (hoursFromNow: number) => new Date(NOW.getTime() + hoursFromNow * H);
const dl = (over: Partial<DeadlineForNotice> & { id: string }): DeadlineForNotice => ({
  title: 'T', courseName: 'CPSC 110', dueAt: at(48), allDay: false, url: null,
  movedFrom: null, movedAt: null, removedAt: null, ...over,
});
const prefs: Prefs = { enabled: true, leadHours: [72, 24], mutedCourses: [] };
const keys = (n: ReturnType<typeof selectNotices>) => n.map((x) => x.key).sort();

describe('selectNotices, lead reminders', () => {
  it('fires a lead whose window opened within the last 24 hours', () => {
    // Due in 70h: the 72h window opened 2h ago. The 24h window is not open.
    expect(keys(selectNotices([dl({ id: 'a', dueAt: at(70) })], prefs, NOW))).toEqual(['lead:72']);
  });

  it('does not fire a window that has not opened', () => {
    expect(selectNotices([dl({ id: 'a', dueAt: at(100) })], prefs, NOW)).toEqual([]);
  });

  it('does not fire a stale window, one that opened more than 24 hours ago', () => {
    // Due in 40h: 72h window opened 32h ago (stale), 24h not yet open.
    expect(selectNotices([dl({ id: 'a', dueAt: at(40) })], prefs, NOW)).toEqual([]);
  });

  it('fires both leads when both windows opened recently', () => {
    // Due in 23h: 24h window opened 1h ago; 72h opened 49h ago (stale).
    expect(keys(selectNotices([dl({ id: 'a', dueAt: at(23) })], prefs, NOW))).toEqual(['lead:24']);
  });

  it('never fires for something already due, removed, or in a muted course', () => {
    expect(selectNotices([dl({ id: 'a', dueAt: at(-1) })], prefs, NOW)).toEqual([]);
    expect(selectNotices([dl({ id: 'b', dueAt: at(70), removedAt: NOW })], prefs, NOW).filter((n) => n.kind === 'lead')).toEqual([]);
    expect(selectNotices([dl({ id: 'c', dueAt: at(70), courseName: 'MATH 200' })], { ...prefs, mutedCourses: ['MATH 200'] }, NOW)).toEqual([]);
  });

  it('fires nothing when reminders are disabled', () => {
    expect(selectNotices([dl({ id: 'a', dueAt: at(70) })], { ...prefs, enabled: false }, NOW)).toEqual([]);
  });
});

describe('selectNotices, moved and removed', () => {
  it('notices a move whose new or old date is inside the largest window', () => {
    const moved = dl({ id: 'a', dueAt: at(60), movedFrom: at(30), movedAt: NOW });
    const n = selectNotices([moved], prefs, NOW).filter((x) => x.kind === 'moved');
    expect(n).toHaveLength(1);
    expect(n[0].key).toBe(`moved:${at(60).toISOString()}`);
  });

  it('records but does not notice a move six weeks out', () => {
    const far = dl({ id: 'a', dueAt: at(24 * 42), movedFrom: at(24 * 40), movedAt: NOW });
    expect(selectNotices([far], prefs, NOW).filter((x) => x.kind === 'moved')).toEqual([]);
  });

  it('notices a removal inside the window, with a fixed key', () => {
    const gone = dl({ id: 'a', dueAt: at(20), removedAt: NOW });
    const n = selectNotices([gone], prefs, NOW);
    expect(n.map((x) => x.key)).toEqual(['removed']);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/canvas-notices.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/canvas/notices.ts`**

```ts
// src/canvas/notices.ts
const H = 60 * 60 * 1000;
/** A lead window that opened longer ago than this is not fired: it was
 *  either handled by an earlier run or predates the connection, and a stale
 *  "3 days before" is noise. It also absorbs a late or missed cron run. */
export const WINDOW_GRACE_MS = 24 * H;

export type DeadlineForNotice = {
  id: string; title: string; courseName: string; dueAt: Date; allDay: boolean; url: string | null;
  movedFrom: Date | null; movedAt: Date | null; removedAt: Date | null;
};
export type Prefs = { enabled: boolean; leadHours: number[]; mutedCourses: string[] };
export type Notice = { deadline: DeadlineForNotice; key: string; kind: 'lead' | 'moved' | 'removed'; leadHours?: number };

/** Pure. `now` is injected so the rules are testable at a fixed instant. */
export function selectNotices(deadlines: DeadlineForNotice[], prefs: Prefs, now: Date): Notice[] {
  if (!prefs.enabled) return [];
  const t = now.getTime();
  const muted = new Set(prefs.mutedCourses);
  const maxLeadMs = Math.max(0, ...prefs.leadHours) * H;
  const inLargestWindow = (d: Date | null) => d !== null && d.getTime() > t && d.getTime() - t <= maxLeadMs;
  const out: Notice[] = [];

  for (const d of deadlines) {
    if (muted.has(d.courseName)) continue;
    const due = d.dueAt.getTime();

    if (d.removedAt) {
      if (inLargestWindow(d.dueAt)) out.push({ deadline: d, key: 'removed', kind: 'removed' });
      continue;
    }
    if (d.movedAt && (inLargestWindow(d.dueAt) || inLargestWindow(d.movedFrom))) {
      out.push({ deadline: d, key: `moved:${d.dueAt.toISOString()}`, kind: 'moved' });
    }
    if (due <= t) continue;
    for (const lead of prefs.leadHours) {
      const opens = due - lead * H;
      if (t >= opens && t < opens + WINDOW_GRACE_MS) {
        out.push({ deadline: d, key: `lead:${lead}`, kind: 'lead', leadHours: lead });
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the selection tests, confirm they pass**

Run: `npx vitest run tests/canvas-notices.test.ts`
Expected: PASS.

- [ ] **Step 5: Extend `src/lib/mail.ts`**

Change `TokenPurpose` to `'verify' | 'reset' | 'mute'`, add `mute: 30 * 24 * 60 * 60 * 1000` to `TTL_MS` with the comment "A mute link lives in an inbox for weeks before it is wanted", and make `sendMail` return `Promise<boolean>`: `true` on the console path and on a send with no error, `false` when Resend reports an error (keep the `console.error`). Existing callers ignore the return value; nothing else changes.

- [ ] **Step 6: Write `src/canvas/emails.ts`**

```ts
// src/canvas/emails.ts
import { formatVancouver } from './tz';
import type { DeadlineForNotice, Notice, Prefs } from './notices';

function line(d: DeadlineForNotice): string {
  const when = formatVancouver(d.dueAt, d.allDay);
  return `${d.courseName ? `${d.courseName}: ` : ''}${d.title}\n    due ${when}${d.url ? `\n    ${d.url}` : ''}`;
}

const footer = (muteUrl: string) =>
  `\n\nYou get these because you connected Canvas on UBC Flow. Change lead times or stop them here:\n${muteUrl}`;

export function welcomeEmail(items: DeadlineForNotice[], prefs: Prefs, muteUrl: string) {
  const leads = prefs.leadHours.map((h) => (h % 24 === 0 ? `${h / 24} day${h === 24 ? '' : 's'}` : `${h} hours`)).join(' and ');
  const list = items.length ? items.map(line).join('\n\n') : 'Nothing due in the next 14 days.';
  return {
    subject: 'Canvas connected: your upcoming deadlines',
    body: `Canvas is connected. Due in the next 14 days:\n\n${list}\n\nFrom now on you get an email ${leads} before each deadline, and one when a prof moves or removes something.${footer(muteUrl)}`,
  };
}

export function reminderEmail(notices: Notice[], muteUrl: string) {
  const leads = notices.filter((n) => n.kind === 'lead');
  const moved = notices.filter((n) => n.kind === 'moved');
  const removed = notices.filter((n) => n.kind === 'removed');
  const soonest = [...leads].sort((a, b) => a.deadline.dueAt.getTime() - b.deadline.dueAt.getTime())[0];
  const parts: string[] = [];
  if (leads.length) parts.push(`${leads.length} due soon`);
  if (moved.length) parts.push(`${moved.length} moved`);
  if (removed.length) parts.push(`${removed.length} removed`);
  const subject = soonest
    ? `${parts.join(', ')}: ${soonest.deadline.courseName} ${soonest.deadline.title}`.trim()
    : parts.join(', ');

  const section = (title: string, ns: Notice[], extra?: (n: Notice) => string) =>
    ns.length ? `${title}\n\n${ns.map((n) => line(n.deadline) + (extra ? extra(n) : '')).join('\n\n')}` : '';
  const body = [
    section('Due soon', leads),
    section('Moved', moved, (n) => `\n    was ${n.deadline.movedFrom ? formatVancouver(n.deadline.movedFrom, n.deadline.allDay) : 'unknown'}`),
    section('Removed by your instructor', removed),
  ].filter(Boolean).join('\n\n');
  return { subject, body: body + footer(muteUrl) };
}

export function reconnectEmail(accountUrl: string) {
  return {
    subject: 'Your Canvas feed stopped answering',
    body: `UBC Flow could not read your Canvas calendar feed. This usually means the link was regenerated in Canvas. Paste a fresh Calendar Feed link to reconnect:\n${accountUrl}\n\nUntil then, deadline reminders are paused.`,
  };
}
```

- [ ] **Step 7: Write the failing notify tests**

```ts
// tests/canvas-notify.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { db } from '@/lib/db';

const sent: { to: string; subject: string; body: string }[] = [];
vi.mock('@/lib/mail', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/mail')>();
  return {
    ...real,
    sendMail: vi.fn(async (to: string, subject: string, body: string) => {
      sent.push({ to, subject, body });
      return true;
    }),
  };
});

import { notifyFor } from '@/canvas/jobs/notify';

const E = 'zz-canvas-notify@example.com';
let userId: string;
const NOW = new Date('2026-10-24T15:00:00Z');
const H = 3600_000;
const at = (h: number) => new Date(NOW.getTime() + h * H);

beforeAll(async () => {
  process.env.FEED_ENCRYPTION_KEY ??= '00'.repeat(31) + '01';
  await db.user.deleteMany({ where: { email: E } });
  userId = (await db.user.create({ data: { email: E } })).id;
});
afterAll(async () => {
  await db.user.deleteMany({ where: { email: E } });
  await db.$disconnect();
});
beforeEach(async () => {
  sent.length = 0;
  await db.canvasDeadline.deleteMany({ where: { userId } });
  await db.canvasFeed.deleteMany({ where: { userId } });
  await db.reminderPreference.deleteMany({ where: { userId } });
  await db.canvasFeed.create({ data: { userId, encryptedUrl: 'x', firstSyncedAt: NOW } });
  await db.reminderPreference.create({ data: { userId } });
});

const seed = (uid: string, dueAt: Date, course = 'CPSC 110') =>
  db.canvasDeadline.create({ data: { userId, uid, kind: 'assignment', title: uid, courseName: course, dueAt } });

describe('notifyFor', () => {
  it('sends one email per run per student, however many notices, and claims each', async () => {
    await seed('a', at(70));
    await seed('b', at(71));
    const r = await notifyFor(userId, NOW);
    expect(r.sent).toBe(2);
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toContain('a');
    expect(sent[0].body).toContain('b');
    const rows = await db.reminderSent.findMany({ where: { userId } });
    expect(rows.map((x) => x.notice).sort()).toEqual(['lead:72', 'lead:72']);
    expect(rows.every((x) => x.deliveredAt !== null)).toBe(true);
  });

  it('never sends the same notice twice, even across a second run', async () => {
    await seed('a', at(70));
    await notifyFor(userId, NOW);
    const again = await notifyFor(userId, new Date(NOW.getTime() + H));
    expect(again.sent).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('sends the welcome and no per-item reminders on the first sync', async () => {
    await db.canvasFeed.update({ where: { userId }, data: { firstSyncedAt: null } });
    await seed('a', at(70));
    const r = await notifyFor(userId, NOW);
    expect(r.sent).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/connected/i);
    expect((await db.canvasFeed.findUniqueOrThrow({ where: { userId } })).firstSyncedAt).not.toBeNull();
    expect(await db.reminderSent.count({ where: { userId } })).toBe(0);
  });

  it('retries a claimed notice whose send failed', async () => {
    await seed('a', at(70));
    const { sendMail } = await import('@/lib/mail');
    (sendMail as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    await notifyFor(userId, NOW);
    let rows = await db.reminderSent.findMany({ where: { userId } });
    expect(rows[0].deliveredAt).toBeNull();
    await notifyFor(userId, new Date(NOW.getTime() + H));
    rows = await db.reminderSent.findMany({ where: { userId } });
    expect(rows[0].deliveredAt).not.toBeNull();
    expect(sent).toHaveLength(1);
  });

  it('every email carries a mute link and never the feed URL', async () => {
    await seed('a', at(70));
    await notifyFor(userId, NOW);
    expect(sent[0].body).toMatch(/\/reminders\/[0-9a-f]{64}/);
    expect(sent[0].body).not.toContain('feeds/calendars');
  });
});
```

- [ ] **Step 8: Run and confirm failure**

Run: `npx vitest run tests/canvas-notify.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 9: Write `src/canvas/jobs/notify.ts`**

```ts
// src/canvas/jobs/notify.ts
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { createToken, sendMail } from '@/lib/mail';
import { selectNotices, type DeadlineForNotice, type Notice } from '@/canvas/notices';
import { reminderEmail, welcomeEmail } from '@/canvas/emails';

const SITE = process.env.NEXTAUTH_URL ?? 'https://ubcflow.com';
const DAY = 24 * 3600_000;

async function muteUrl(userId: string): Promise<string> {
  return `${SITE}/reminders/${await createToken(userId, 'mute')}`;
}

/**
 * Runs AFTER syncFeedFor for the same student. Sends at most one email per
 * run per student. Every notice in that email is claimed in ReminderSent
 * before the send: two overlapping runs cannot both send, because the second
 * claim loses on the unique (deadlineId, notice). A claim whose send failed
 * keeps deliveredAt null and is retried while its window is still open.
 */
export async function notifyFor(userId: string, now: Date): Promise<{ sent: number }> {
  const [user, feed, prefs] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { email: true } }),
    db.canvasFeed.findUnique({ where: { userId } }),
    db.reminderPreference.findUnique({ where: { userId } }),
  ]);
  if (!user || !feed || feed.brokenAt || !prefs) return { sent: 0 };

  const deadlines: DeadlineForNotice[] = await db.canvasDeadline.findMany({
    where: { userId },
    select: { id: true, title: true, courseName: true, dueAt: true, allDay: true, url: true, movedFrom: true, movedAt: true, removedAt: true },
  });

  if (!feed.firstSyncedAt) {
    // The welcome replaces every per-item reminder this run: a student who
    // connects with eight things due this week must not get eight emails.
    const upcoming = deadlines
      .filter((d) => !d.removedAt && d.dueAt > now && d.dueAt.getTime() - now.getTime() <= 14 * DAY)
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    const mail = welcomeEmail(upcoming, prefs, await muteUrl(userId));
    await sendMail(user.email, mail.subject, mail.body);
    await db.canvasFeed.update({ where: { userId }, data: { firstSyncedAt: now } });
    return { sent: 0 };
  }

  // Claim first. Undelivered earlier claims are picked up again here too.
  const claimed: { rowId: string; notice: Notice }[] = [];
  for (const notice of selectNotices(deadlines, prefs, now)) {
    try {
      const row = await db.reminderSent.create({
        data: { userId, deadlineId: notice.deadline.id, notice: notice.key, claimedAt: now },
        select: { id: true },
      });
      claimed.push({ rowId: row.id, notice });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await db.reminderSent.findUnique({
          where: { deadlineId_notice: { deadlineId: notice.deadline.id, notice: notice.key } },
          select: { id: true, deliveredAt: true },
        });
        if (existing && existing.deliveredAt === null) claimed.push({ rowId: existing.id, notice });
        continue;
      }
      throw e;
    }
  }
  if (claimed.length === 0) return { sent: 0 };

  const mail = reminderEmail(claimed.map((c) => c.notice), await muteUrl(userId));
  const delivered = await sendMail(user.email, mail.subject, mail.body);
  if (delivered) {
    await db.reminderSent.updateMany({ where: { id: { in: claimed.map((c) => c.rowId) } }, data: { deliveredAt: now } });
  }
  return { sent: delivered ? claimed.length : 0 };
}
```

- [ ] **Step 10: Write the mute landing `src/app/reminders/[token]/page.tsx`**

A server component. Read the Next docs for dynamic route params first. It calls `consumeToken(token, 'mute')`; on `ok`, sets `reminderPreference.enabled = false` for that user and renders "Reminders are off" with a form whose server action (in `src/app/actions/canvas.ts`, `setRemindersEnabled(enabled: boolean)`, auth-scoped) turns them back on for a signed-in user and a link to `/deadlines`. On a bad or expired token it renders "That link has expired. Sign in and change reminders from your deadlines page." Never 500s on a bad token.

Add to `src/app/actions/canvas.ts` (it reads the session itself, so it may live in the actions file):

```ts
export async function setRemindersEnabled(enabled: boolean): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };
  await db.reminderPreference.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, enabled },
    update: { enabled },
  });
  revalidatePath('/deadlines');
  return { ok: true };
}
```

(This adds `db` and `revalidatePath` imports to the actions file. The mute
page itself turns reminders off directly with `db`, keyed on the userId the
consumed token names, not on a session: the student clicking a mute link in
their mail client is usually signed out.)

- [ ] **Step 11: Run all four canvas test files, then the suite, typecheck, lint**

Run: `npx vitest run tests/canvas-notices.test.ts tests/canvas-notify.test.ts && npm test && npx tsc --noEmit`
Expected: PASS. Existing mail tests must still pass with `sendMail` returning a boolean.

- [ ] **Step 12: Commit**

```bash
git add src/canvas/notices.ts src/canvas/emails.ts src/canvas/jobs/notify.ts src/lib/mail.ts src/app/reminders src/app/actions/canvas.ts tests/canvas-notices.test.ts tests/canvas-notify.test.ts
git commit -m "feat: email a student before each deadline, and when one moves"
```

---

### Task 6: The deadlines page and preferences

**Files:**
- Create: `src/canvas/prefs.ts` (the logic and the constant; NOT a `'use server'` file)
- Create: `src/app/deadlines/page.tsx`
- Create: `src/components/DeadlinesList.tsx`
- Modify: `src/app/actions/canvas.ts` (`updateReminderPreferences`, session wrapper only)
- Test: `tests/canvas-prefs.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // src/canvas/prefs.ts
  export const LEAD_CHOICES = [24, 48, 72, 168] as const; // 1, 2, 3, 7 days; nothing shorter than the cron can honour
  export async function updateReminderPreferencesFor(userId: string, input: { leadHours: number[]; mutedCourses: string[] }): Promise<Result>;

  // src/app/actions/canvas.ts
  export async function updateReminderPreferences(input: { leadHours: number[]; mutedCourses: string[] }): Promise<Result>;
  ```
  `LEAD_CHOICES` cannot live in the actions file: a `'use server'` module may
  export only async functions, and the component needs the constant too.

- [ ] **Step 1: Write the failing test**

```ts
// tests/canvas-prefs.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { updateReminderPreferencesFor, LEAD_CHOICES } from '@/canvas/prefs';

const E = 'zz-canvas-prefs@example.com';
let userId: string;
beforeAll(async () => {
  await db.user.deleteMany({ where: { email: E } });
  userId = (await db.user.create({ data: { email: E } })).id;
  await db.reminderPreference.create({ data: { userId } });
});
afterAll(async () => {
  await db.user.deleteMany({ where: { email: E } });
  await db.$disconnect();
});

describe('updateReminderPreferencesFor', () => {
  it('stores chosen leads and mutes, deduplicated and sorted longest first', async () => {
    const r = await updateReminderPreferencesFor(userId, { leadHours: [24, 168, 24], mutedCourses: ['MATH 200', 'MATH 200'] });
    expect(r).toEqual({ ok: true });
    const p = await db.reminderPreference.findUniqueOrThrow({ where: { userId } });
    expect(p.leadHours).toEqual([168, 24]);
    expect(p.mutedCourses).toEqual(['MATH 200']);
  });

  // The cron runs every 4 hours; a 1-hour lead is a promise it cannot keep.
  it('rejects a lead the job cannot honour', async () => {
    const r = await updateReminderPreferencesFor(userId, { leadHours: [1], mutedCourses: [] });
    expect(r.ok).toBe(false);
    expect(LEAD_CHOICES).not.toContain(1);
  });

  it('rejects an empty lead list rather than silently disabling reminders', async () => {
    expect((await updateReminderPreferencesFor(userId, { leadHours: [], mutedCourses: [] })).ok).toBe(false);
  });

  it('caps the mute list', async () => {
    const many = Array.from({ length: 101 }, (_, i) => `C ${i}`);
    expect((await updateReminderPreferencesFor(userId, { leadHours: [24], mutedCourses: many })).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/canvas-prefs.test.ts`
Expected: FAIL, export not found.

- [ ] **Step 3: Write `src/canvas/prefs.ts`, and the wrapper in the actions file**

```ts
// src/canvas/prefs.ts  (plain module, no 'use server')
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import type { Result } from '@/canvas/connect';

export const LEAD_CHOICES = [24, 48, 72, 168] as const;
const MAX_MUTES = 100;

export async function updateReminderPreferencesFor(
  userId: string,
  input: { leadHours: number[]; mutedCourses: string[] },
): Promise<Result> {
  const leads = [...new Set(input.leadHours)].filter((h): h is (typeof LEAD_CHOICES)[number] =>
    (LEAD_CHOICES as readonly number[]).includes(h),
  ).sort((a, b) => b - a);
  if (leads.length === 0 || leads.length !== new Set(input.leadHours).size) {
    return { ok: false, error: 'Pick at least one reminder time from the list.' };
  }
  const mutes = [...new Set(input.mutedCourses.map((c) => c.trim()).filter(Boolean))];
  if (mutes.length > MAX_MUTES || mutes.some((c) => c.length > 200)) {
    return { ok: false, error: 'Too many muted courses.' };
  }
  await db.reminderPreference.upsert({
    where: { userId },
    create: { userId, leadHours: leads, mutedCourses: mutes },
    update: { leadHours: leads, mutedCourses: mutes },
  });
  revalidatePath('/deadlines');
  return { ok: true };
}
```

```ts
// appended to src/app/actions/canvas.ts
import { updateReminderPreferencesFor } from '@/canvas/prefs';

export async function updateReminderPreferences(input: { leadHours: number[]; mutedCourses: string[] }): Promise<Result> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: 'Not signed in.' };
  return updateReminderPreferencesFor(session.user.id, input);
}
```

- [ ] **Step 4: Write the page and list**

`src/app/deadlines/page.tsx` (server): `auth()`, redirect to sign-in when signed out; load `canvasFeed`, `reminderPreference`, and every `canvasDeadline` for the user ordered by `dueAt`; if no feed, render a short message linking to `/onboarding`. Pass to `DeadlinesList` as plain JSON (dates as ISO strings). Group by Vancouver day using `formatVancouver` from `src/canvas/tz.ts`.

`src/components/DeadlinesList.tsx` (client) renders:
- The enabled switch (calls `setRemindersEnabled`), and the same
  `CanvasConnect` block from Task 3 so Disconnect is reachable here as the
  spec's section 8 requires, not only from the Account page.
- Lead-time checkboxes from `LEAD_CHOICES` labelled "1 day", "2 days", "3 days", "1 week", and a per-course mute checkbox list built from the distinct `courseName`s of the deadlines; both save through `updateReminderPreferences`.
- The deadlines soonest first, grouped by day: course, title, due time (date only when `allDay`), a link to Canvas. A row with `movedAt` within the last 14 days shows "moved from <old>"; a row with `removedAt` within 14 days shows "removed by your instructor" and is struck through; a row in a muted course is greyed. Removed rows older than 14 days are not rendered.
- Sizes in `rem`. Match the card vocabulary of `src/components/ExamList.tsx`.

- [ ] **Step 5: Run the test, the suite, typecheck, lint, and a scratch build**

Run: `npx vitest run tests/canvas-prefs.test.ts && npm test && npx tsc --noEmit && NEXT_DIST_DIR=.next-verify npm run build; rm -rf .next-verify; git checkout -- tsconfig.json`
Expected: green; `/deadlines` and `/reminders/[token]` appear in the build's route list.

- [ ] **Step 6: Commit**

```bash
git add src/canvas/prefs.ts src/app/deadlines/page.tsx src/components/DeadlinesList.tsx src/app/actions/canvas.ts tests/canvas-prefs.test.ts
git commit -m "feat: a page of every Canvas deadline, with reminder settings"
```

---

### Task 7: The job entry point and the GitHub Actions workflow

**Files:**
- Create: `src/canvas/jobs/sync-all.ts`, `src/canvas/jobs/sync.run.ts`
- Create: `.github/workflows/reminders.yml`
- Modify: `package.json` (`"canvas:sync": "tsx src/canvas/jobs/sync.run.ts"`)
- Modify: `src/app/actions/canvas.ts` is NOT touched; the reconnect email is sent from here.
- Test: `tests/canvas-sync-all.test.ts`

**Interfaces:**
- Consumes: `syncFeedFor` (Task 4), `notifyFor` (Task 5), `reconnectEmail` (Task 5), `sendMail`.
- Produces: `export async function syncAllFeeds(now?: Date): Promise<{ feeds: number; ok: number; broken: number; transient: number; notices: number }>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/canvas-sync-all.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/canvas/jobs/sync', () => ({ syncFeedFor: vi.fn(async (id: string) => (id === 'broken-one' ? 'broken' : 'ok')) }));
vi.mock('@/canvas/jobs/notify', () => ({ notifyFor: vi.fn(async () => ({ sent: 1 })) }));
const mails: string[] = [];
vi.mock('@/lib/mail', () => ({ sendMail: vi.fn(async (_to: string, subject: string) => { mails.push(subject); return true; }) }));
vi.mock('@/lib/db', () => ({
  db: {
    canvasFeed: {
      findMany: vi.fn(async () => [
        { userId: 'fine-one', user: { email: 'a@x' }, brokenAt: null },
        { userId: 'broken-one', user: { email: 'b@x' }, brokenAt: null },
      ]),
    },
  },
}));
process.env.FEED_ENCRYPTION_KEY ??= '00'.repeat(31) + '01';

import { syncAllFeeds } from '@/canvas/jobs/sync-all';
import { notifyFor } from '@/canvas/jobs/notify';

describe('syncAllFeeds', () => {
  it('syncs every unbroken feed, notifies the healthy ones, and emails a newly broken one exactly once', async () => {
    const r = await syncAllFeeds(new Date('2026-10-24T15:00:00Z'));
    expect(r).toMatchObject({ feeds: 2, ok: 1, broken: 1, notices: 1 });
    expect(notifyFor).toHaveBeenCalledTimes(1);
    expect(notifyFor).toHaveBeenCalledWith('fine-one', expect.any(Date));
    expect(mails).toEqual(['Your Canvas feed stopped answering']);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/canvas-sync-all.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the orchestrator and entry point**

```ts
// src/canvas/jobs/sync-all.ts
import { db } from '@/lib/db';
import { sendMail } from '@/lib/mail';
import { assertFeedKey } from '@/canvas/crypto';
import { reconnectEmail } from '@/canvas/emails';
import { syncFeedFor } from '@/canvas/jobs/sync';
import { notifyFor } from '@/canvas/jobs/notify';

const SITE = process.env.NEXTAUTH_URL ?? 'https://ubcflow.com';

/** One pass over every connected, unbroken feed. Feeds are independent: a
 *  failure on one is logged and the loop continues, so one dead feed cannot
 *  stop everyone else's reminders. Nothing here logs a URL. */
export async function syncAllFeeds(now = new Date()) {
  assertFeedKey();
  const feeds = await db.canvasFeed.findMany({
    where: { brokenAt: null },
    select: { userId: true, brokenAt: true, user: { select: { email: true } } },
  });
  const counts = { feeds: feeds.length, ok: 0, broken: 0, transient: 0, notices: 0 };

  for (const feed of feeds) {
    try {
      const outcome = await syncFeedFor(feed.userId, now);
      if (outcome === 'ok') {
        counts.ok += 1;
        counts.notices += (await notifyFor(feed.userId, now)).sent;
      } else if (outcome === 'broken') {
        counts.broken += 1;
        // Sent from here, once: brokenAt was null when this loop started.
        const mail = reconnectEmail(`${SITE}/onboarding`);
        await sendMail(feed.user.email, mail.subject, mail.body);
      } else if (outcome === 'transient') {
        counts.transient += 1;
      }
    } catch (e) {
      console.error('canvas sync failed for one user:', e instanceof Error ? e.message : e);
    }
  }
  console.log(`canvas sync: ${JSON.stringify(counts)}`);
  return counts;
}
```

```ts
// src/canvas/jobs/sync.run.ts
import { db } from '@/lib/db';
import { syncAllFeeds } from '@/canvas/jobs/sync-all';

syncAllFeeds()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
```

Add to `package.json` scripts, after `scrape:exams`: `"canvas:sync": "tsx src/canvas/jobs/sync.run.ts",`.

- [ ] **Step 4: Write `.github/workflows/reminders.yml`**

```yaml
name: Canvas deadline reminders

on:
  schedule:
    - cron: '0 */4 * * *'
  workflow_dispatch: {}

# Two runs must never overlap: a claim in ReminderSent is what stops a double
# send, and this keeps that guard from ever being exercised by the scheduler.
concurrency:
  group: canvas-reminders
  cancel-in-progress: false

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run canvas:sync
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          FEED_ENCRYPTION_KEY: ${{ secrets.FEED_ENCRYPTION_KEY }}
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          MAIL_FROM: ${{ secrets.MAIL_FROM }}
          NEXTAUTH_URL: https://ubcflow.com
```

- [ ] **Step 5: Run the test, the suite, typecheck**

Run: `npx vitest run tests/canvas-sync-all.test.ts && npm test && npx tsc --noEmit`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/canvas/jobs/sync-all.ts src/canvas/jobs/sync.run.ts .github/workflows/reminders.yml package.json tests/canvas-sync-all.test.ts
git commit -m "feat: a four-hourly job reads every connected Canvas feed and sends what is due"
```

---

## Before this branch can deploy (for the author, not the executor)

1. `openssl rand -hex 32` once. Put it in local `.env` as `FEED_ENCRYPTION_KEY`, in Vercel's environment variables, and in the repository's GitHub Actions secrets as `FEED_ENCRYPTION_KEY`. Add `RESEND_API_KEY` and `MAIL_FROM` to GitHub secrets too (the scrape workflow only has `DATABASE_URL`).
2. `DATABASE_URL="<neon direct>" npx prisma migrate deploy` before the push that carries Task 2.
3. Redeploy Vercel after setting the env var; they bake at build.
4. Trigger the workflow once by hand (`workflow_dispatch`) and read its log before trusting the schedule.

## Deferred, named so nobody wonders

Phone push; deadlines on the month calendar and Exams tab; recurring events (`RRULE`) in the feed; key rotation; the Planner API. All in spec section 12.
