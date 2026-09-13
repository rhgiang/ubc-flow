# UBC Flow - Phase 4: Schedule Planner + Webcal (Design)

**Date:** 2026-08-20
**Status:** Approved for planning
**Phase:** 4 of 6
**Depends on:** [Phase 1: Foundation](2026-08-19-ubc-flow-foundation-design.md) (merged) · [Phase 2: Accounts + Workday Import](2026-08-19-phase-2-accounts-workday-import-design.md) (merged) · [Phase 3: Ratings and Reviews](2026-08-19-phase-3-ratings-design.md) (merged)

## 1. Why this phase exists

This is the project's clearest differentiator over both UW Flow and every existing
UBC scheduling tool. UW Flow doesn't need this feature - Waterloo's own systems
handle it. UBC's Workday is widely disliked for viewing a schedule at all, and
every community tool built against it (`workdaycal.vercel.app`,
`jackkoskie/ubc-workday2cal`, the UBC Workday Calendar Generator extension)
produces a **one-shot `.ics` export that goes stale the moment your schedule
changes** - this was the specific gap identified back in the very first design
pass of this project.

**Done when:** a student can build a hypothetical timetable from any term Phase 1
has scraped, see it as a weekly grid with overlap warnings, and subscribe to it
from their phone or Google Calendar via a URL that **stays live** - editing the
schedule later updates the subscribed calendar without any re-export.

---

## 2. What "live" actually means here

The whole point is durability against the failure mode every existing tool has.
The design achieves it with one decision, not a sync mechanism: **the calendar
endpoint queries the schedule's current state on every request, with no caching
and no pre-generated file.**

This single choice satisfies two things that might otherwise look like separate
features:

1. **Editing the schedule** (adding/dropping a section) is reflected the next
   time the subscribed calendar app polls the URL - which is the headline
   feature.
2. **A future re-scrape correcting a section's time** is also reflected, for
   free, since the endpoint was always going to read current section data
   regardless of why it changed. This is a narrow win in practice (Phase 1
   already found UBC's API exposes no room/building data at all, so the only
   correctable fields are day/time), but it costs nothing extra to get.

No webhook, no push notification, no stored/cached ICS file to invalidate. The
calendar app's own polling interval (typically 24h, sometimes configurable) is
the only latency in the system, and that is standard behaviour for every webcal
subscription, not a limitation specific to this build.

---

## 3. Building a schedule

### 3.1 Source: browse, not auto-generated

A student picks any term Phase 1 has scraped data for - past, current, or
future - and adds sections from the existing course pages. This is deliberately
**independent of Phase 2's verified enrollment**: the planner is a *what-if*
tool for deciding a schedule before registering, not a readout of what's already
confirmed. Auto-seeding from verified enrollment was considered and dropped -
it only helps with a term already locked in, which is the one case a planner is
least needed for.

### 3.2 Entry point: extend the course page, don't build a picker

The course page's sections table (built in Phase 1) already lists every section
of a course for a term. Adding an "Add to schedule" action to each row - visible
only when a schedule for that term is open - reuses that surface rather than
building a second course/section browser from scratch.

### 3.3 Multiple schedules, any term

A student may hold several named schedules per term (`Plan A`, `Plan B while
waitlisted`, ...). This matches how registration planning actually happens -
comparing options before committing - and was chosen deliberately over a
single-schedule-per-term model that would force overwriting one option to try
another.

### 3.4 Conflict handling: warn, never block

Two sections whose meeting times overlap are visibly flagged (e.g. highlighted
on the grid) but both remain in the schedule. UBC's own meeting-pattern data is
not always granular enough to prove a conflict is real - alternating-week
patterns are a known case - so refusing the add would sometimes be wrong.
Warning keeps the student informed without asserting something the data can't
back up.

---

## 4. Data model

Two changes to the schema Phase 1 already stubbed. Everything else
(`SavedSchedule`, `ScheduleSection`) is used as designed - no changes needed
there.

### 4.1 `CalendarToken` moves from per-user to per-schedule

Each `SavedSchedule` needs its own subscription URL - a student comparing two
plans needs two independent calendar feeds, not one feed for their whole
account. The existing stub ties the token to `User`; this phase re-points it to
`SavedSchedule`.

```prisma
model CalendarToken {
  id         String        @id @default(cuid())
  scheduleId String        @unique   // was: userId
  schedule   SavedSchedule @relation(fields: [scheduleId], references: [id], onDelete: Cascade)
  token      String        @unique
  createdAt  DateTime      @default(now())
}
```

`@unique` on `scheduleId`: one token per schedule, generated lazily the first
time a student asks to subscribe, not eagerly for every schedule created.

### 4.2 `MeetingTime.startDate`/`endDate` get populated - a Phase 1 gap, closed here

These columns exist since Phase 2's migration but **nothing has ever written to
them.** Verified directly against the live database: `0` of the current
non-empty `MeetingTime` rows have a `startDate`. Verified directly against
UBC's live API that the source data genuinely exists:

```json
{"title": "Student Exchange Program, Graduate :: 2025 :: Sec 201",
 "field_start_date": "2025-07-02", "field_end_date": "2025-08-08"}
```

`field_start_date`/`field_end_date` live on the **section** node, not per
meeting day - Phase 1's `parseSectionNode` (in `src/scrape/parse-nodes.ts`)
simply never read them into `RawMeeting`. This phase fixes that function to
capture both dates onto every `RawMeeting` row it emits for that section (the
same date range repeats across a section's Mon/Wed/Fri rows, which is correct -
they're the same enrolment period), then re-runs the section scrape to backfill
all existing rows.

**Why this matters enough to fix now, not later:** without a real per-section
date range, a recurring calendar event has no correct `UNTIL` bound. A section
that only runs the second half of term (a real, common shape already observed
in the data - e.g. a CPSC section spanning `2027-01-06` to `2027-02-12`, not the
full term) would otherwise generate events for weeks after it actually ended.

---

## 5. Calendar generation

### 5.1 Endpoint

`GET /api/calendar/<token>.ics` - no auth required (the token itself is the
capability; this is how every webcal subscription works, matching the model
Google Calendar and Apple Calendar expect when a URL is pasted in). Looks up
the `CalendarToken`, loads its `SavedSchedule`'s current sections fresh, and
generates ICS text in the response. Nothing is stored between requests.

### 5.2 Event shape

One `VEVENT` per section per meeting day, recurring weekly via `RRULE`, bounded
by that meeting's real `startDate`/`endDate` (§4.2). Building and room are
omitted from the event body - never available from UBC's API, confirmed back in
Phase 1's original spike and unchanged since.

### 5.3 Content negotiation

Served with `Content-Type: text/calendar`, so pasting the URL into a calendar
app's "subscribe by URL" field works without a separate download step.

---

## 6. Shared UI - scoped to what this phase needs, nothing broader

The user separately decided (2026-08-19) to defer any general design-system
adoption to a later pass done in their own style. What ships here is strictly
what the planner itself requires:

- **Navigation** - a real top bar (Search · Explore · My Schedules · account).
  Flagged as missing in Phase 1's final review and never fixed; this phase is
  the first one that needs a "My Schedules" link to exist somewhere, so it gets
  built now rather than deferred again.
- **A shared `Button` component** - replacing the ad-hoc `bg-blue-700` classes
  repeated across every page, since this phase adds enough new buttons (add
  section, remove section, subscribe, create schedule) that the duplication
  would otherwise multiply.
- **A weekly calendar grid** - the one genuinely new display component. This is
  the phase's centerpiece UI and has no existing equivalent to reuse.

Nothing else. No modals, no dropdown menus, no chart library - those wait for
whichever future phase actually needs them.

---

## 7. Architecture

Continues the existing monolith. No new services.

```
src/scrape/parse-nodes.ts        - MODIFY: capture field_start_date/end_date
src/schedule/conflicts.ts        - PURE: detect overlapping meeting times
src/schedule/ics.ts              - PURE: SavedSchedule + sections -> ICS text
src/app/actions/schedule.ts      - server actions: create/rename/delete schedule,
                                    add/remove section, get-or-create token
src/app/schedule/page.tsx        - list the student's schedules
src/app/schedule/[id]/page.tsx   - the planner: grid, add/remove, subscribe link
src/app/api/calendar/[token]/route.ts - the live ICS endpoint
src/components/Nav.tsx           - top navigation bar
src/components/Button.tsx        - shared button primitive
src/components/WeekGrid.tsx      - the weekly calendar grid display
```

**ICS generation and conflict detection stay pure functions**, continuing the
pattern from every prior phase: `(sections, meetings) -> ICS string` and
`(meetings) -> overlapping pairs` need no I/O and are fully unit-testable
against fixtures, exactly like Phase 1's parsers and Phase 3's aggregation.

---

## 8. Security and correctness requirements

| Area | Requirement |
|---|---|
| Ownership | Only the schedule's owner may add/remove sections or rename/delete it - verified server-side against the session, never a client-supplied user id. |
| Token capability | The calendar token is the only credential the `.ics` endpoint checks. Treat it like a password: never logged, never included in any page's visible markup (only inside the copyable subscribe URL). |
| Freshness | The endpoint must not cache a response across requests - the whole feature's value is that it doesn't need re-export. |
| Date correctness | Every generated event's `RRULE UNTIL` must derive from the section's real `startDate`/`endDate` (§4.2) - never approximate with the term's own start/end. |
| Conflict UI | Overlap warnings are advisory. No code path may silently drop or block a section on the strength of a suspected conflict. |

---

## 9. Out of scope

- Grade distributions - Phase 5.
- Prerequisite trees - Phase 6.
- Auto-seeding a schedule from verified enrollment (§3.1) - deferred, revisit
  only if real usage shows the browse-based flow is friction rather than
  flexibility.
- Any general design-system or visual redesign work - explicitly deferred by
  the user to a later, separately-driven pass.
- Push notifications or any mechanism other than the calendar app's own polling
  for delivering schedule changes.
