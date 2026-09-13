# UBC Flow Phase 4: Schedule Planner + Webcal - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A student can build a hypothetical timetable from any scraped term, see it as a weekly grid with overlap warnings, and subscribe to it from a phone or Google Calendar via a URL that stays live - edits show up without any re-export.

**Architecture:** Continues the Next.js + Prisma monolith. Conflict detection and ICS generation are **pure functions**, matching every prior phase. The calendar endpoint reads current state on every request with no caching - that single decision is what makes the feed live.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Prisma 7 (driver adapter), Postgres, Tailwind, Vitest. **No new dependencies** - ICS is a simple line-based text format, hand-generated in ~40 lines rather than pulling in a library.

**Spec:** [`docs/superpowers/specs/2026-08-20-phase-4-schedule-planner-design.md`](../specs/2026-08-20-phase-4-schedule-planner-design.md)

## Global Constraints

- **Node.js 20+**, npm. No bun, no pnpm.
- **Ownership is enforced server-side** on every schedule mutation, against the session - never a client-supplied user id.
- **The calendar token is a capability credential.** Never log it, never render it outside the copyable subscribe URL.
- **The `.ics` endpoint must not cache across requests.** The feature's entire value is that it doesn't go stale.
- **Every `RRULE UNTIL` derives from the section's real `startDate`/`endDate`** - never approximated from the term's dates.
- **Conflict warnings are advisory.** No code path may block or silently drop a section because of a suspected overlap.
- Pure functions (`src/schedule/conflicts.ts`, `src/schedule/ics.ts`) do no I/O: no Prisma, no `fetch`, no `fs`.
- Tests live in `tests/**/*.test.ts`.

---

## Plan-level decisions

**1. No ICS library.** RFC 5545 for our needs is a handful of `BEGIN:`/`END:` lines
and one `RRULE`. Adding `ics`/`ical-generator` would mean a dependency, its
transitive tree, and its own API to learn - for less code than it saves. Hand-write
it, unit-test it against fixtures.

**2. The date fix ships in Task 1, before anything consumes it.** Tasks 4-6 all
depend on real meeting dates existing. Doing the scraper fix and backfill first
means the planner is built against correct data from the start rather than being
retrofitted.

**3. Server actions, not API routes, for mutations** - matching Phase 3. The one
exception is the `.ics` endpoint, which genuinely must be a GET route since
external calendar apps fetch it.

---

## File Structure

```
prisma/schema.prisma                  - CalendarToken: userId -> scheduleId
src/scrape/parse-nodes.ts             - MODIFY: capture section start/end dates
src/schedule/conflicts.ts             - PURE: overlapping meeting detection
src/schedule/ics.ts                   - PURE: schedule -> ICS text
src/app/actions/schedule.ts           - server actions (ownership-checked)
src/app/schedule/page.tsx             - list my schedules
src/app/schedule/[id]/page.tsx        - the planner
src/app/api/calendar/[token]/route.ts - the live ICS endpoint
src/components/Nav.tsx                - top navigation
src/components/Button.tsx             - shared button
src/components/WeekGrid.tsx           - weekly grid display
src/app/layout.tsx                    - MODIFY: mount Nav
src/app/course/[code]/page.tsx        - MODIFY: "add to schedule" affordance
```

---

### Task 1: Capture real meeting dates and backfill

**Files:**
- Modify: `src/scrape/parse-nodes.ts`
- Test: `tests/parse-nodes.test.ts` (extend)

**Interfaces:**
- Consumes: nothing new
- Produces: `RawMeeting` gains `startDate: string | null` and `endDate: string | null`

**Why first:** every later task depends on real dates existing. Building the planner
against null dates and retrofitting would mean rewriting the ICS generator's whole
recurrence bound.

**The gap:** `MeetingTime.startDate`/`endDate` have existed since Phase 2's migration
but **nothing has ever written to them** - verified: `select count(*) from
"MeetingTime" where "startDate" is not null` returns `0`. The source data exists;
`parseSectionNode` just never read it. Verified against UBC's live API:

```json
{"field_start_date": "2025-07-02", "field_end_date": "2025-08-08"}
```

These live on the **section** node, not per meeting day. The same range therefore
repeats across a section's Mon/Wed/Fri rows - correct, since they share one
enrolment period.

- [ ] **Step 1: Write the failing test**

Add to `tests/parse-nodes.test.ts`, inside the existing `parseSectionNode` describe block:

```ts
  it('captures the section date range onto every meeting row', () => {
    const node = {
      type: 'node--section',
      id: 'section-dates',
      attributes: {
        field_section_number: '101',
        field_days: ['m', 'w'],
        field_start_time: 50400,
        field_end_time: 54000,
        field_start_date: '2027-01-06',
        field_end_date: '2027-02-12',
        field_instructors: [],
      },
      relationships: {
        field_course: { data: { type: 'node--course', id: 'course-1' } },
      },
    };

    const r = parseSectionNode(node as never, included);
    expect(r.meetings).toHaveLength(2);
    // Same range on every day of the section - they share one enrolment period.
    for (const m of r.meetings) {
      expect(m.startDate).toBe('2027-01-06');
      expect(m.endDate).toBe('2027-02-12');
    }
  });

  it('leaves meeting dates null when the section has none', () => {
    const node = {
      type: 'node--section',
      id: 'section-nodates',
      attributes: {
        field_section_number: '102',
        field_days: ['f'],
        field_start_time: 50400,
        field_end_time: 54000,
        field_instructors: [],
      },
      relationships: {
        field_course: { data: { type: 'node--course', id: 'course-1' } },
      },
    };

    const r = parseSectionNode(node as never, included);
    expect(r.meetings[0].startDate).toBeNull();
    expect(r.meetings[0].endDate).toBeNull();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- parse-nodes`
Expected: FAIL - `startDate` is undefined on the returned meetings.

- [ ] **Step 3: Implement**

In `src/scrape/parse-nodes.ts`, extend the `RawMeeting` type:

```ts
export type RawMeeting = {
  day: string;
  startTime: string | null;
  endTime: string | null;
  building: string | null;
  room: string | null;
  startDate: string | null;
  endDate: string | null;
};
```

And in `parseSectionNode`, read the two fields and attach them to each meeting:

```ts
  const startTime = secondsToTime((a.field_start_time as number | null) ?? null);
  const endTime = secondsToTime((a.field_end_time as number | null) ?? null);

  // Section-level, not per-day: one enrolment period shared by every meeting.
  // Needed for a correct RRULE UNTIL - half-term sections are real and common.
  const startDate = (a.field_start_date as string | null) ?? null;
  const endDate = (a.field_end_date as string | null) ?? null;

  const meetings = parseDays((a.field_days as string[] | null) ?? null).map((day) => ({
    day,
    startTime,
    endTime,
    // The API exposes no location anywhere - confirmed during the Phase 1 spike.
    building: null,
    room: null,
    startDate,
    endDate,
  }));
```

The upsert path in `src/scrape/jobs/sections.ts` spreads meeting rows
(`row.meetings.map((m) => ({ ...m, sectionId: section.id }))`), so the new fields
flow to Prisma with **no change needed there** - Prisma will coerce the ISO date
strings into its `DateTime?` columns. Verify this rather than assuming it: if
`createMany` rejects the string, convert with `new Date(...)` in the parser and
change `RawMeeting`'s type to `Date | null`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- parse-nodes`
Expected: PASS, including the two new tests.

- [ ] **Step 5: Backfill the real data**

This re-runs the section scrape against UBC's live API. It takes roughly 10-15
minutes at the 1 req/sec rate limit - expected, do not raise the rate.

```bash
npm run scrape:sections
```

- [ ] **Step 6: Verify the backfill actually landed**

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select count(*) total, count(\"startDate\") with_dates from \"MeetingTime\";"
```

`with_dates` must now be a large fraction of `total` (not all sections have dates -
unscheduled ones legitimately don't). Then confirm the half-term case that motivated
this fix is real:

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select distinct \"startDate\", \"endDate\" from \"MeetingTime\" where \"startDate\" is not null order by \"startDate\" limit 10;"
```

You should see multiple distinct ranges, including some that do not span a whole term.

- [ ] **Step 7: Full suite and commit**

Run `npm test` and `npx tsc --noEmit`; both clean.

```bash
git add src/scrape/parse-nodes.ts tests/parse-nodes.test.ts
git commit -m "fix: capture section date ranges onto meeting times"
```

---

### Task 2: Schema - per-schedule calendar tokens

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `CalendarToken` keyed to `SavedSchedule`, plus a `User` relation on `SavedSchedule`

**Migration environment note:** `npx prisma migrate dev` refuses to run in this
non-interactive shell (Prisma 7 blocks it outside a TTY). Phases 2 and 3 both
established the working sequence - reuse it:

```bash
npx prisma migrate diff --from-config-datasource prisma.config.ts \
  --to-schema prisma/schema.prisma --script
```

Inspect the SQL, hand-place it under `prisma/migrations/<timestamp>_<name>/migration.sql`,
run `npx prisma migrate deploy`, then `npx prisma generate`, then verify with
`npx prisma migrate status` (must report no drift).

- [ ] **Step 1: Edit the schema**

Replace `model CalendarToken` entirely:

```prisma
model CalendarToken {
  id         String        @id @default(cuid())
  scheduleId String        @unique
  schedule   SavedSchedule @relation(fields: [scheduleId], references: [id], onDelete: Cascade)
  token      String        @unique
  createdAt  DateTime      @default(now())
}
```

And add the back-relation plus a `User` relation to `SavedSchedule`:

```prisma
model SavedSchedule {
  id       String            @id @default(cuid())
  userId   String
  user     User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  termId   String
  name     String
  sections ScheduleSection[]
  token    CalendarToken?

  @@index([userId])
}
```

Add the matching back-relation on `model User`:

```prisma
  schedules SavedSchedule[]
```

- [ ] **Step 2: Confirm the tables are empty before migrating**

These are Phase 1 stubs nothing has written to. Prove it rather than assume:

```bash
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select (select count(*) from \"SavedSchedule\") schedules, (select count(*) from \"CalendarToken\") tokens, (select count(*) from \"ScheduleSection\") sections;"
```

All three must be `0`. If any is not, STOP and report - the plan's assumption that
these are untouched stubs is wrong, and dropping `CalendarToken.userId` would lose data.

- [ ] **Step 3: Generate, inspect, apply**

Follow the sequence above. The SQL should drop `CalendarToken.userId`, add
`scheduleId` with its unique index and foreign key, and add the `SavedSchedule` ->
`User` foreign key and index. If it contains a `DROP TABLE` or touches any other
model, STOP and report.

- [ ] **Step 4: Verify**

```bash
npx prisma migrate status
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c "\d \"CalendarToken\""
docker exec ubcflow-pg psql -U ubcflow -d ubcflow -c \
  "select (select count(*) from \"Course\") courses, (select count(*) from \"Section\") sections;"
```

No drift; `CalendarToken` has `scheduleId` unique and no `userId`; Course/Section
counts unchanged from before.

- [ ] **Step 5: Commit**

```bash
git add prisma
git commit -m "feat: key calendar tokens to schedules rather than users"
```

---

### Task 3: Pure conflict detection and ICS generation

**Files:**
- Create: `src/schedule/conflicts.ts`, `src/schedule/ics.ts`
- Test: `tests/conflicts.test.ts`, `tests/ics.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions over plain objects)
- Produces:
  - `findConflicts(entries: ScheduleEntry[]): ConflictPair[]`
  - `buildIcs(calendarName: string, events: IcsEvent[]): string`
  - types `ScheduleEntry`, `ConflictPair`, `IcsEvent`

- [ ] **Step 1: Write the failing conflict tests**

Create `tests/conflicts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { findConflicts, type ScheduleEntry } from '@/schedule/conflicts';

const entry = (
  sectionId: string,
  day: string,
  startTime: string,
  endTime: string,
): ScheduleEntry => ({ sectionId, label: sectionId, day, startTime, endTime });

describe('findConflicts', () => {
  it('finds none for a clear schedule', () => {
    expect(
      findConflicts([entry('a', 'Mon', '09:00', '10:00'), entry('b', 'Mon', '10:00', '11:00')]),
    ).toEqual([]);
  });

  it('ignores different days at the same time', () => {
    expect(
      findConflicts([entry('a', 'Mon', '09:00', '10:00'), entry('b', 'Tue', '09:00', '10:00')]),
    ).toEqual([]);
  });

  it('detects a partial overlap', () => {
    const c = findConflicts([
      entry('a', 'Mon', '09:00', '10:30'),
      entry('b', 'Mon', '10:00', '11:00'),
    ]);
    expect(c).toHaveLength(1);
    expect(new Set([c[0].a.sectionId, c[0].b.sectionId])).toEqual(new Set(['a', 'b']));
  });

  it('detects full containment', () => {
    expect(
      findConflicts([entry('a', 'Mon', '09:00', '12:00'), entry('b', 'Mon', '10:00', '11:00')]),
    ).toHaveLength(1);
  });

  it('treats back-to-back as non-overlapping', () => {
    // A class ending exactly when another starts is not a conflict.
    expect(
      findConflicts([entry('a', 'Mon', '09:00', '10:00'), entry('b', 'Mon', '10:00', '11:00')]),
    ).toEqual([]);
  });

  it('never reports a section against itself', () => {
    expect(findConflicts([entry('a', 'Mon', '09:00', '10:00')])).toEqual([]);
  });

  it('reports each conflicting pair once, not twice', () => {
    expect(
      findConflicts([entry('a', 'Mon', '09:00', '11:00'), entry('b', 'Mon', '10:00', '12:00')]),
    ).toHaveLength(1);
  });

  it('skips entries with missing times rather than guessing', () => {
    const c = findConflicts([
      { sectionId: 'a', label: 'a', day: 'Mon', startTime: null, endTime: null },
      entry('b', 'Mon', '09:00', '10:00'),
    ]);
    expect(c).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Run: `npm test -- conflicts` (FAIL - module missing).

Create `src/schedule/conflicts.ts`:

```ts
export type ScheduleEntry = {
  sectionId: string;
  label: string;
  day: string;
  startTime: string | null;
  endTime: string | null;
};

export type ConflictPair = { a: ScheduleEntry; b: ScheduleEntry };

/** "14:30" -> 870. Null for anything unparseable. */
function minutes(hhmm: string | null): number | null {
  const m = hhmm?.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Overlapping meetings on the same day. Advisory only - the caller warns, it
 * never blocks: UBC's meeting data can't always prove a conflict is real
 * (alternating-week patterns), so refusing an add would sometimes be wrong.
 */
export function findConflicts(entries: ScheduleEntry[]): ConflictPair[] {
  const pairs: ConflictPair[] = [];

  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i];
      const b = entries[j];
      if (a.day !== b.day) continue;
      if (a.sectionId === b.sectionId) continue;

      const aStart = minutes(a.startTime);
      const aEnd = minutes(a.endTime);
      const bStart = minutes(b.startTime);
      const bEnd = minutes(b.endTime);
      // An unscheduled meeting has nothing to conflict with - never guess.
      if (aStart === null || aEnd === null || bStart === null || bEnd === null) continue;

      // Strict inequality: back-to-back classes are not a conflict.
      if (aStart < bEnd && bStart < aEnd) pairs.push({ a, b });
    }
  }

  return pairs;
}
```

- [ ] **Step 3: Write the failing ICS tests**

Create `tests/ics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildIcs, type IcsEvent } from '@/schedule/ics';

const event: IcsEvent = {
  uid: 'section-1-Mon',
  title: 'CPSC 221 Lecture',
  day: 'Mon',
  startTime: '14:00',
  endTime: '15:00',
  startDate: new Date('2027-01-06T00:00:00Z'),
  endDate: new Date('2027-02-12T00:00:00Z'),
};

describe('buildIcs', () => {
  const ics = buildIcs('My Schedule', [event]);

  it('produces a well-formed calendar envelope', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('VERSION:2.0');
  });

  it('names the calendar', () => {
    expect(ics).toContain('X-WR-CALNAME:My Schedule');
  });

  it('emits one event with its title', () => {
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('SUMMARY:CPSC 221 Lecture');
  });

  it('recurs weekly on the right day, bounded by the real end date', () => {
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20270212T235959Z');
  });

  it('starts on the first matching weekday on or after the start date', () => {
    // 2027-01-06 is a Wednesday; the first Monday on/after it is 2027-01-11.
    expect(ics).toContain('DTSTART;TZID=America/Vancouver:20270111T140000');
    expect(ics).toContain('DTEND;TZID=America/Vancouver:20270111T150000');
  });

  it('uses CRLF line endings as the spec requires', () => {
    expect(ics).toContain('\r\n');
  });

  it('escapes characters that would corrupt a line', () => {
    const out = buildIcs('X', [{ ...event, title: 'A, B; C\\D' }]);
    expect(out).toContain('SUMMARY:A\\, B\\; C\\\\D');
  });

  it('omits events that have no usable time or date', () => {
    const out = buildIcs('X', [{ ...event, startTime: null }]);
    expect(out).not.toContain('BEGIN:VEVENT');
  });

  it('produces a valid empty calendar for no events', () => {
    const out = buildIcs('Empty', []);
    expect(out).toContain('BEGIN:VCALENDAR');
    expect(out).not.toContain('BEGIN:VEVENT');
  });
});
```

- [ ] **Step 4: Run to verify failure, then implement**

Run: `npm test -- ics` (FAIL - module missing).

Create `src/schedule/ics.ts`:

```ts
export type IcsEvent = {
  uid: string;
  title: string;
  day: string;
  startTime: string | null;
  endTime: string | null;
  startDate: Date | null;
  endDate: Date | null;
};

const TZID = 'America/Vancouver';

// ICS weekday tokens, indexed to match JS getUTCDay() (0 = Sunday).
const ICS_DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const DAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/** RFC 5545 escapes: backslash first, or it double-escapes the others. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function dateStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/**
 * The first occurrence on or after the section's start date. A section
 * starting Wednesday with Monday meetings first meets the following Monday -
 * anchoring DTSTART to the start date itself would place it on the wrong day.
 */
function firstOccurrence(startDate: Date, dayIndex: number): Date {
  const d = new Date(startDate.getTime());
  const delta = (dayIndex - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

export function buildIcs(calendarName: string, events: IcsEvent[]): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//UBC Flow//Schedule//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    `X-WR-TIMEZONE:${TZID}`,
  ];

  for (const e of events) {
    const dayIndex = DAY_INDEX[e.day];
    // Skip rather than guess: an unscheduled meeting has no correct rendering.
    if (dayIndex === undefined) continue;
    if (!e.startTime || !e.endTime || !e.startDate || !e.endDate) continue;

    const first = firstOccurrence(e.startDate, dayIndex);
    const stamp = dateStamp(first);
    const start = `${stamp}T${e.startTime.replace(':', '')}00`;
    const end = `${stamp}T${e.endTime.replace(':', '')}00`;

    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@ubcflow`,
      `DTSTAMP:${dateStamp(new Date())}T000000Z`,
      `DTSTART;TZID=${TZID}:${start}`,
      `DTEND;TZID=${TZID}:${end}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${ICS_DAY[dayIndex]};UNTIL=${dateStamp(e.endDate)}T235959Z`,
      `SUMMARY:${escapeText(e.title)}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  // RFC 5545 mandates CRLF.
  return `${lines.join('\r\n')}\r\n`;
}
```

- [ ] **Step 5: Verify and commit**

Run `npm test -- conflicts` and `npm test -- ics` (both PASS), then `npm test` and
`npx tsc --noEmit`. Confirm purity:

```bash
grep -nE "fetch|prisma|@/lib/db|readFile|require\(" src/schedule/conflicts.ts src/schedule/ics.ts
```

Expected: no output.

```bash
git add src/schedule tests/conflicts.test.ts tests/ics.test.ts
git commit -m "feat: add pure conflict detection and ICS generation"
```

---

### Task 4: Schedule server actions

**Files:**
- Create: `src/app/actions/schedule.ts`
- Test: `tests/schedule-actions.test.ts`

**Interfaces:**
- Consumes: `db`, `auth`
- Produces (inner, session-less, for testing):
  - `createScheduleFor(userId, termId, name)`
  - `renameScheduleFor(userId, scheduleId, name)`
  - `deleteScheduleFor(userId, scheduleId)`
  - `addSectionFor(userId, scheduleId, sectionId)`
  - `removeSectionFor(userId, scheduleId, sectionId)`
  - `getOrCreateTokenFor(userId, scheduleId)`
- Produces (exported server actions): `createSchedule`, `renameSchedule`, `deleteSchedule`, `addSection`, `removeSection`, `getSubscribeUrl`

**The split matters:** exported actions resolve the session then delegate to the
inner `*For(userId, …)` functions. That is what makes ownership testable without
faking a Next.js session - the same pattern Phase 3 used for `writeReviewForUser`.

**Ownership is the security property here.** The tests below assert the negative
cases; a happy-path suite would pass while any user could edit any schedule.

- [ ] **Step 1: Write the failing tests**

Create `tests/schedule-actions.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import {
  createScheduleFor,
  renameScheduleFor,
  deleteScheduleFor,
  addSectionFor,
  removeSectionFor,
  getOrCreateTokenFor,
} from '@/app/actions/schedule';

const OWNER = 'zz-sched-owner@example.com';
const STRANGER = 'zz-sched-stranger@example.com';

let ownerId: string;
let strangerId: string;
let termId: string;
let sectionId: string;
let scheduleId: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { email: { in: [OWNER, STRANGER] } } });
  ownerId = (await db.user.create({ data: { email: OWNER } })).id;
  strangerId = (await db.user.create({ data: { email: STRANGER } })).id;

  const section = await db.section.findFirstOrThrow({ select: { id: true, termId: true } });
  sectionId = section.id;
  termId = section.termId;

  const created = await createScheduleFor(ownerId, termId, 'Plan A');
  if (!created.ok) throw new Error('setup failed');
  scheduleId = created.scheduleId;
});

afterAll(async () => {
  await db.savedSchedule.deleteMany({ where: { userId: { in: [ownerId, strangerId] } } });
  await db.user.deleteMany({ where: { email: { in: [OWNER, STRANGER] } } });
  await db.$disconnect();
});

describe('ownership', () => {
  it('lets the owner add a section', async () => {
    const r = await addSectionFor(ownerId, scheduleId, sectionId);
    expect(r.ok).toBe(true);
    expect(await db.scheduleSection.count({ where: { scheduleId } })).toBe(1);
  });

  it('REJECTS a stranger adding a section', async () => {
    const r = await addSectionFor(strangerId, scheduleId, sectionId);
    expect(r.ok).toBe(false);
    expect(await db.scheduleSection.count({ where: { scheduleId } })).toBe(1);
  });

  it('REJECTS a stranger removing a section', async () => {
    const r = await removeSectionFor(strangerId, scheduleId, sectionId);
    expect(r.ok).toBe(false);
    expect(await db.scheduleSection.count({ where: { scheduleId } })).toBe(1);
  });

  it('REJECTS a stranger renaming the schedule', async () => {
    const r = await renameScheduleFor(strangerId, scheduleId, 'Hacked');
    expect(r.ok).toBe(false);
    const s = await db.savedSchedule.findUniqueOrThrow({ where: { id: scheduleId } });
    expect(s.name).toBe('Plan A');
  });

  it('REJECTS a stranger deleting the schedule', async () => {
    const r = await deleteScheduleFor(strangerId, scheduleId);
    expect(r.ok).toBe(false);
    expect(await db.savedSchedule.count({ where: { id: scheduleId } })).toBe(1);
  });

  it('REJECTS a stranger minting a subscribe token', async () => {
    const r = await getOrCreateTokenFor(strangerId, scheduleId);
    expect(r.ok).toBe(false);
  });
});

describe('behaviour', () => {
  it('adding the same section twice is idempotent', async () => {
    await addSectionFor(ownerId, scheduleId, sectionId);
    expect(await db.scheduleSection.count({ where: { scheduleId } })).toBe(1);
  });

  it('returns a stable token across calls', async () => {
    const a = await getOrCreateTokenFor(ownerId, scheduleId);
    const b = await getOrCreateTokenFor(ownerId, scheduleId);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.token).toBe(b.token);
  });

  it('lets the owner remove a section', async () => {
    const r = await removeSectionFor(ownerId, scheduleId, sectionId);
    expect(r.ok).toBe(true);
    expect(await db.scheduleSection.count({ where: { scheduleId } })).toBe(0);
  });

  it('allows several schedules for the same term', async () => {
    const b = await createScheduleFor(ownerId, termId, 'Plan B');
    expect(b.ok).toBe(true);
    expect(await db.savedSchedule.count({ where: { userId: ownerId, termId } })).toBe(2);
  });

  it('deleting a schedule cascades its sections and token', async () => {
    const created = await createScheduleFor(ownerId, termId, 'Plan C');
    if (!created.ok) throw new Error('setup failed');
    await addSectionFor(ownerId, created.scheduleId, sectionId);
    await getOrCreateTokenFor(ownerId, created.scheduleId);

    await deleteScheduleFor(ownerId, created.scheduleId);

    expect(await db.scheduleSection.count({ where: { scheduleId: created.scheduleId } })).toBe(0);
    expect(await db.calendarToken.count({ where: { scheduleId: created.scheduleId } })).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Run: `npm test -- schedule-actions` (FAIL - module missing).

Create `src/app/actions/schedule.ts`:

```ts
'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { auth } from '@/lib/auth';

type Result = { ok: true } | { ok: false; error: string };
type CreateResult = { ok: true; scheduleId: string } | { ok: false; error: string };
type TokenResult = { ok: true; token: string } | { ok: false; error: string };

const NOT_YOURS = 'That schedule does not belong to you.';

/** Ownership check - every mutation goes through this first. */
async function owns(userId: string, scheduleId: string): Promise<boolean> {
  const found = await db.savedSchedule.findFirst({
    where: { id: scheduleId, userId },
    select: { id: true },
  });
  return found !== null;
}

export async function createScheduleFor(
  userId: string,
  termId: string,
  name: string,
): Promise<CreateResult> {
  const clean = name.trim();
  if (!clean) return { ok: false, error: 'Give the schedule a name.' };
  if (clean.length > 80) return { ok: false, error: 'That name is too long.' };

  const schedule = await db.savedSchedule.create({
    data: { userId, termId, name: clean },
    select: { id: true },
  });
  return { ok: true, scheduleId: schedule.id };
}

export async function renameScheduleFor(
  userId: string,
  scheduleId: string,
  name: string,
): Promise<Result> {
  if (!(await owns(userId, scheduleId))) return { ok: false, error: NOT_YOURS };
  const clean = name.trim();
  if (!clean) return { ok: false, error: 'Give the schedule a name.' };

  await db.savedSchedule.update({ where: { id: scheduleId }, data: { name: clean } });
  return { ok: true };
}

export async function deleteScheduleFor(userId: string, scheduleId: string): Promise<Result> {
  if (!(await owns(userId, scheduleId))) return { ok: false, error: NOT_YOURS };
  // ScheduleSection and CalendarToken both cascade from SavedSchedule.
  await db.savedSchedule.delete({ where: { id: scheduleId } });
  return { ok: true };
}

export async function addSectionFor(
  userId: string,
  scheduleId: string,
  sectionId: string,
): Promise<Result> {
  if (!(await owns(userId, scheduleId))) return { ok: false, error: NOT_YOURS };

  // Idempotent: re-adding a section already present is a no-op, not an error.
  await db.scheduleSection.upsert({
    where: { scheduleId_sectionId: { scheduleId, sectionId } },
    create: { scheduleId, sectionId },
    update: {},
  });
  return { ok: true };
}

export async function removeSectionFor(
  userId: string,
  scheduleId: string,
  sectionId: string,
): Promise<Result> {
  if (!(await owns(userId, scheduleId))) return { ok: false, error: NOT_YOURS };
  await db.scheduleSection.deleteMany({ where: { scheduleId, sectionId } });
  return { ok: true };
}

export async function getOrCreateTokenFor(
  userId: string,
  scheduleId: string,
): Promise<TokenResult> {
  if (!(await owns(userId, scheduleId))) return { ok: false, error: NOT_YOURS };

  const existing = await db.calendarToken.findUnique({ where: { scheduleId } });
  if (existing) return { ok: true, token: existing.token };

  // 32 bytes: this token IS the capability for reading the schedule's calendar.
  const created = await db.calendarToken.create({
    data: { scheduleId, token: randomBytes(32).toString('hex') },
  });
  return { ok: true, token: created.token };
}

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function createSchedule(termId: string, name: string): Promise<CreateResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to build a schedule.' };
  const result = await createScheduleFor(userId, termId, name);
  if (result.ok) revalidatePath('/schedule');
  return result;
}

export async function renameSchedule(scheduleId: string, name: string): Promise<Result> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to manage schedules.' };
  const result = await renameScheduleFor(userId, scheduleId, name);
  if (result.ok) revalidatePath(`/schedule/${scheduleId}`);
  return result;
}

export async function deleteSchedule(scheduleId: string): Promise<Result> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to manage schedules.' };
  const result = await deleteScheduleFor(userId, scheduleId);
  if (result.ok) revalidatePath('/schedule');
  return result;
}

export async function addSection(scheduleId: string, sectionId: string): Promise<Result> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to build a schedule.' };
  const result = await addSectionFor(userId, scheduleId, sectionId);
  if (result.ok) revalidatePath(`/schedule/${scheduleId}`);
  return result;
}

export async function removeSection(scheduleId: string, sectionId: string): Promise<Result> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to build a schedule.' };
  const result = await removeSectionFor(userId, scheduleId, sectionId);
  if (result.ok) revalidatePath(`/schedule/${scheduleId}`);
  return result;
}

export async function getSubscribeUrl(scheduleId: string): Promise<TokenResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, error: 'Sign in to subscribe.' };
  return getOrCreateTokenFor(userId, scheduleId);
}
```

- [ ] **Step 3: Verify and commit**

Run `npm test -- schedule-actions` (PASS, 11 tests), then `npm test` and
`npx tsc --noEmit`.

```bash
git add src/app/actions/schedule.ts tests/schedule-actions.test.ts
git commit -m "feat: add ownership-checked schedule actions"
```

---

### Task 5: The live calendar endpoint

**Files:**
- Create: `src/app/api/calendar/[token]/route.ts`

**Interfaces:**
- Consumes: `buildIcs` (Task 3), `db`
- Produces: `GET /api/calendar/<token>` serving `text/calendar`

**No auth.** The token is the capability - this is how every webcal subscription
works, and it is what lets a calendar app fetch the URL unattended.

**Must not cache.** The entire point of the feature is that the feed reflects
current state without a re-export.

- [ ] **Step 1: Implement**

Create `src/app/api/calendar/[token]/route.ts`:

```ts
import { db } from '@/lib/db';
import { buildIcs, type IcsEvent } from '@/schedule/ics';

// The whole value of this feature is that a subscribed calendar sees current
// state. Any caching here silently reintroduces the staleness every existing
// UBC calendar tool suffers from.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const record = await db.calendarToken.findUnique({
    where: { token },
    select: {
      schedule: {
        select: {
          name: true,
          sections: {
            select: {
              section: {
                select: {
                  id: true,
                  sectionCode: true,
                  activity: true,
                  meetingTimes: true,
                  course: { select: { number: true, subject: { select: { code: true } } } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!record?.schedule) {
    return new Response('Not found', { status: 404 });
  }

  const events: IcsEvent[] = [];
  for (const { section } of record.schedule.sections) {
    const label = `${section.course.subject.code ?? ''} ${section.course.number}`.trim();
    const title = `${label} ${section.activity ?? ''}`.trim();

    for (const m of section.meetingTimes) {
      events.push({
        uid: `${section.id}-${m.id}`,
        title: `${title} (${section.sectionCode})`,
        day: m.day,
        startTime: m.startTime,
        endTime: m.endTime,
        startDate: m.startDate,
        endDate: m.endDate,
      });
    }
  }

  return new Response(buildIcs(record.schedule.name, events), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
```

- [ ] **Step 2: Verify live end to end**

Start the dev server. Create a schedule and add a section (via the actions from
Task 4, driven from a script), mint a token, then fetch the URL:

```bash
curl -sS -i "http://localhost:3000/api/calendar/<token>" | head -20
```

Confirm: `200`, `Content-Type: text/calendar`, body begins `BEGIN:VCALENDAR`, and
contains a `BEGIN:VEVENT` with a real `RRULE` whose `UNTIL` matches the section's
actual end date (not a term-wide guess).

Then prove it is genuinely live - the feature's whole claim:

1. Fetch the URL, note the event count.
2. Add another section to the same schedule.
3. Fetch the **same URL again** without regenerating anything.
4. Confirm the new event is present.

Also confirm an unknown token returns `404`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/calendar
git commit -m "feat: serve a live ICS feed per schedule"
```

---

### Task 6: UI - nav, buttons, grid, and the planner pages

**Files:**
- Create: `src/components/Nav.tsx`, `src/components/Button.tsx`, `src/components/WeekGrid.tsx`
- Create: `src/app/schedule/page.tsx`, `src/app/schedule/[id]/page.tsx`
- Modify: `src/app/layout.tsx`, `src/app/course/[code]/page.tsx`

**Interfaces:**
- Consumes: `findConflicts` (Task 3), the schedule actions (Task 4), `auth`, `db`

**Scope discipline:** the user deferred general design-system work to their own
later pass. Build exactly these three components - no modals, no dropdowns, no
chart library.

- [ ] **Step 1: Shared components**

`src/components/Button.tsx` - a small primitive replacing the repeated
`bg-blue-700 px-5 py-2 text-white` classes. Support `variant` (`primary` |
`secondary` | `danger`) and pass through native button props.

`src/components/Nav.tsx` - a server component reading `auth()`. Left: "UBC Flow"
home link. Middle: Explore, My Schedules. Right: when signed in, a link to
`/onboarding` plus a sign-out control; when signed out, Log in / Sign up. Keep it
one row, `border-b`, matching the existing `mx-auto max-w-*` page width.

`src/components/WeekGrid.tsx` - the weekly timetable. Columns Mon-Fri, rows by
hour across the range the schedule actually spans (do not hardcode 8am-10pm if
nothing is scheduled then). Each entry is an absolutely-positioned block whose
top/height derive from its start/end minutes. Blocks flagged by `findConflicts`
render with a red border and a `title` explaining the overlap. **A conflicting
block is still rendered** - warning, never hiding.

- [ ] **Step 2: Mount the nav**

In `src/app/layout.tsx`, render `<Nav />` above `{children}` inside `<body>`.
This is the first navigation the app has had - flagged missing in Phase 1's final
review.

- [ ] **Step 3: The schedule list page**

`src/app/schedule/page.tsx` - requires sign-in (redirect to `/login` otherwise).
Lists the user's schedules grouped by term with section counts, plus a form to
create one (term picker sourced from `db.term.findMany` for Vancouver, newest
first). Each row links to `/schedule/[id]`.

- [ ] **Step 4: The planner page**

`src/app/schedule/[id]/page.tsx` - server component. Loads the schedule with its
sections, meeting times, and courses; **404s if it is not the signed-in user's**
(ownership, same rule as the actions). Renders:

- the schedule name with rename/delete controls
- `<WeekGrid>` of the current selection
- a list of added sections, each with a remove button
- a conflict summary when `findConflicts` returns pairs
- a "Subscribe in your calendar" control that calls `getSubscribeUrl` and shows
  the resulting URL in a read-only, selectable input for copying

**The token appears only inside that copyable URL** - never logged, never in a
heading or link text.

- [ ] **Step 5: "Add to schedule" on the course page**

Modify `src/app/course/[code]/page.tsx`. For a signed-in user with at least one
schedule, each row of the sections table gains an add control targeting the
schedule(s) matching that section's term. If the user has no schedule for that
term, link to `/schedule` instead of silently rendering nothing.

- [ ] **Step 6: Verify live end to end**

Start the dev server. As a signed-in user:

1. Nav appears on every page and its links resolve.
2. Create a schedule from `/schedule`.
3. From a course page, add a section to it.
4. The planner grid shows the section in the right day/time slot.
5. Add a deliberately overlapping section - confirm **both** render and a conflict
   warning appears.
6. Remove a section; the grid updates.
7. Subscribe: copy the URL, `curl` it, confirm the events match the grid.
8. Confirm another signed-in user gets a 404 on that schedule's planner URL.

Clean up test data and stop the dev server.

- [ ] **Step 7: Full verification and commit**

Run `npm test`, `npx tsc --noEmit`, `npx eslint .`, and `npm run build` - all clean.

```bash
git add src/components src/app/schedule src/app/layout.tsx "src/app/course/[code]/page.tsx"
git commit -m "feat: add navigation and the schedule planner UI"
```

---

## Phase 4 completion criteria

- [ ] `npm test`, `npx tsc --noEmit`, `npx eslint .`, `npm run build` all clean
- [ ] `MeetingTime.startDate`/`endDate` are populated from real UBC data
- [ ] A student can create multiple named schedules per term
- [ ] Sections add and remove; adding twice is idempotent
- [ ] Overlaps warn visibly and **never** block or drop a section
- [ ] A schedule's `.ics` URL serves `text/calendar` and reflects edits **without** re-export
- [ ] Every `RRULE UNTIL` comes from the section's real end date
- [ ] Ownership is enforced server-side: strangers cannot read, edit, or delete another user's schedule
- [ ] Navigation exists on every page
