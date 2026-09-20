# UBC Flow: Canvas Deadlines and Reminders (Design)

**Date:** 2026-09-19
**Status:** Approved in conversation; awaiting spec review
**Depends on:** Accounts and Workday import (merged); the ICS writer in
`src/schedule/ics.ts`; Resend mail in `src/lib/mail.ts`; the GitHub Actions
job pattern in `.github/workflows/scrape.yml`.

## 1. Why this exists

A student's deadlines live in Canvas, one course at a time, behind a login,
and they move: a prof extends an assignment on Tuesday and the student who
looked on Monday does not know. UBC Flow already knows the student's courses,
their timetable and their exams. It does not know when anything is due.

**Done when:** a signed-in student connects Canvas once, and from then on
every assignment, quiz and discussion due date across all their courses is
known to UBC Flow, refreshes on its own when a prof adds or moves one, and
reaches the student by email at the lead times they chose, with a moved or
removed deadline announced as such.

## 2. Scope decisions made before design

These were settled during brainstorming and are not open in the plan.

**Canvas is read through its calendar feed, not scraped and not through a
browser extension.** Every Canvas user has a private, read-only iCalendar
feed (Canvas, Calendar, "Calendar Feed") that carries every assignment, quiz
and discussion due date across all their courses and reflects changes when a
prof moves one. Confirmed present on canvas.ubc.ca on 2026-09-19. It needs no
login on our side, no API token, no extension. The student copies one URL,
once. The Planner API (`/api/v1/planner/items`) is the richer alternative and
is out of scope: it needs a per-student access token that some institutions
gate behind faculty sponsorship, and the feed carries what this feature needs.

**It lives inside ubc-flow.** The only reason for a separate repository was
a browser extension, and there is no extension. Auth, users, enrollments, an
ICS module, Resend, a daily cron and the database all already exist here.

**Email first; phone push is phase 2.** Resend is wired in, so email is zero
new dependencies. Web push (service worker, VAPID keys, per-device
subscriptions, and on iPhone only for an installed PWA) is its own piece,
built after the data side is proven by real use.

**Per-deadline reminders at lead times the student chooses.** Not a daily
digest. Each deadline earns its own reminder at, by default, 3 days and
1 day before, and a moved or removed deadline gets its own notice. This needs
a sent-log so nothing fires twice and a job that runs several times a day;
both are designed below. It is also the shape push will want later.

**The first version's surface is the emails plus one page.** The page lists
every deadline we know for the student, with mute-per-course and disconnect.
Rendering deadlines onto the month calendar and the Exams tab is the obvious
next step and is deliberately out of v1, so that data and delivery are proven
before more UI is built on them.

**Zero new runtime dependencies.** Node's `crypto` and `fetch`, the Resend
client already present, one new GitHub Actions workflow, one new environment
variable. An ICS parsing library is the named fallback if a real feed proves
messier than the hand-rolled reader can take; see section 6.

## 3. Data model

Four tables, all per student. Nothing here is global: a deadline belongs to
the student whose feed it came from, and two students in the same course each
hold their own copy, which is correct because per-section overrides and the
student's own mutes differ.

```prisma
model CanvasFeed {
  id            String    @id @default(cuid())
  userId        String    @unique
  user          User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// AES-256-GCM ciphertext of the feed URL, base64: iv || tag || data. The
  /// URL is a bearer credential for the student's whole calendar; it is never
  /// stored in the clear, never logged, and never sent back to the browser.
  encryptedUrl  String
  connectedAt   DateTime  @default(now())
  lastFetchedAt DateTime?
  /// HTTP status of the last fetch, or null before the first.
  lastStatus    Int?
  /// Set when the feed stopped working (401, 404, or repeated failures) and
  /// polling was suspended. Cleared on reconnect. The student is told once.
  brokenAt      DateTime?
  /// Set when the first sync has run, so that sync's welcome email is sent
  /// exactly once and per-item reminders start only after it.
  firstSyncedAt DateTime?
  deadlines     CanvasDeadline[]
}

model CanvasDeadline {
  id           String    @id @default(cuid())
  userId       String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  /// Canvas's own VEVENT UID, stable across polls; the diff key.
  uid          String
  /// "assignment" when the UID contains that word (assignments, quizzes and
  /// graded discussions all do); "event" for anything else in the feed.
  kind         String
  /// The SUMMARY with its trailing "[Course]" removed.
  title        String
  /// The bracketed course name from the SUMMARY, verbatim. Matched to a
  /// Course row only for display; a match is not required to store or remind.
  courseName   String
  courseId     String?
  /// The instant it is due. Canvas emits timed deadlines as UTC datetimes.
  /// An all-day item (VALUE=DATE) is stored as 23:59:59 America/Vancouver on
  /// that date, converted to UTC, so "due Friday" reminds before Friday ends.
  dueAt        DateTime
  allDay       Boolean   @default(false)
  url          String?
  firstSeenAt  DateTime  @default(now())
  /// Set when a poll found a different dueAt for this uid. Drives the
  /// "moved" notice and the page's "moved" note. Kept, not cleared: the
  /// sent-log's notice key is what stops the notice repeating, and the page
  /// shows the move for 14 days (section 8).
  movedFrom    DateTime?
  movedAt      DateTime?
  /// Set when a poll no longer returned this uid. The row is kept and marked,
  /// never deleted: a prof deleting an assignment is a fact worth showing.
  removedAt    DateTime?
  reminders    ReminderSent[]

  @@unique([userId, uid])
  @@index([userId, dueAt])
}

model ReminderPreference {
  userId       String   @id
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  enabled      Boolean  @default(true)
  /// Hours before dueAt at which to remind, e.g. [72, 24]. Ordered longest
  /// first for display; the job treats it as a set.
  leadHours    Int[]    @default([72, 24])
  /// Course names (as they appear in the feed's brackets) the student muted.
  mutedCourses String[] @default([])
}

model ReminderSent {
  id         String         @id @default(cuid())
  userId     String
  deadlineId String
  deadline   CanvasDeadline @relation(fields: [deadlineId], references: [id], onDelete: Cascade)
  /// "lead:72:<dueAt ISO>", "lead:24:<dueAt ISO>", "moved:<new dueAt ISO>",
  /// "removed". One row per distinct notice, so a deadline that moves twice
  /// notices twice and a lead that fired for a given date never fires again.
  /// The due date is in the lead key as well as the moved one: without it a
  /// lead claimed for the old date silently blocks the reminder for the new
  /// date after a prof moves the deadline.
  notice     String
  /// Written BEFORE the email is sent; the unique below is the guarantee that
  /// two overlapping runs cannot both send. Null deliveredAt means the send
  /// failed after the claim and will be retried next run.
  claimedAt  DateTime       @default(now())
  deliveredAt DateTime?

  @@unique([deadlineId, notice])
  @@index([userId, deliveredAt])
}
```

`User` gains the three back-relations Prisma requires (`canvasFeed`,
`canvasDeadlines`, `reminderPreference`); nothing else on it changes.

`ReminderSent` is the no-double-send guarantee. The row is inserted first
and the email sent second; a concurrent run loses the insert on the unique
key and skips the send. This is the same atomic shape the syllabus extraction
cap uses (`updateMany` with the condition in the `where`), chosen for the same
reason: a read-then-decide check is the one shape that fails under exactly the
overlap it exists to prevent.

## 4. Connecting a feed

On the Account page, a "Connect Canvas" block with one input and two
sentences of instruction (Canvas, Calendar, Calendar Feed, copy the link).

On submit, the server:

1. Accepts `webcal://` and rewrites it to `https://`; Canvas offers the feed
   with either scheme.
2. Parses the URL with `new URL()` and rejects anything whose host is not
   exactly `canvas.ubc.ca` or whose path does not start with
   `/feeds/calendars/`. This is the entire defence against server-side
   request forgery, and it is why fetching a student-supplied URL is
   acceptable here when it was refused for syllabus links: the host is
   pinned, so the request can only ever reach Canvas.
3. Fetches it once, with the same timeout and size cap the job uses (section
   5), to prove it is a working feed. A non-200, or a body that does not
   parse as a calendar, is rejected with a message that says which.
4. Encrypts the URL with AES-256-GCM under `FEED_ENCRYPTION_KEY` (32 bytes,
   hex, a new environment variable) using a fresh random 12-byte IV per
   write, and stores iv, tag and ciphertext together. A separate key rather
   than `SERVER_SECRET`, which keys the student-number hashes and must never
   rotate; this key should be rotatable on its own.
5. Upserts `CanvasFeed` (one per student; reconnecting replaces) and creates
   `ReminderPreference` with defaults if absent.

After connecting, the page shows "Connected on date", the last successful
fetch, and a Disconnect button. **The URL is never displayed again**, not
masked, not partially. Disconnect deletes the `CanvasFeed` row and every
`CanvasDeadline` and `ReminderSent` under it.

The URL is never written to a log line, an error message, or a response body,
including on failure. Failures name the status code and nothing else.

## 5. The job

A new GitHub Actions workflow, `.github/workflows/reminders.yml`, on
`cron: '0 */4 * * *'`, with `concurrency: reminders` so two runs never
overlap, running `npm run canvas:sync` against Neon's direct URL with the
same secrets the scrape workflow already holds plus `FEED_ENCRYPTION_KEY`,
`RESEND_API_KEY` and `MAIL_FROM`. The entry point is
`src/canvas/jobs/sync.run.ts`, in the shape of every existing `*.run.ts`.

GitHub Actions rather than Vercel Cron because Vercel's Hobby plan runs a
cron at most once a day, and lead-time reminders need more than that. GitHub
cron is best-effort and can start late by some minutes; the design tolerates
it (see the window rule below).

**Every 4 hours, for each `CanvasFeed` with `brokenAt` null:**

1. **Fetch.** Decrypt the URL, `fetch` with a 20 second timeout and a 2 MB
   response cap (a feed is tens of kilobytes; a megabyte is already wrong).
   Record `lastFetchedAt` and `lastStatus`.
2. **Parse** (section 6) into a list of `{ uid, kind, title, courseName,
   dueAt, allDay, url }`. Events with no `DTSTART` are skipped; Canvas emits
   undated to-do items and they cannot be reminded about.
3. **Diff by uid** against the student's stored deadlines:
   - uid not stored: insert, `firstSeenAt` now.
   - uid stored, `dueAt` unchanged: nothing.
   - uid stored, `dueAt` changed: update `dueAt`, set `movedFrom` to the old
     value and `movedAt` now. If the row was previously `removedAt`, clear it
     (the prof restored it).
   - uid stored, not in this fetch, not already removed: set `removedAt`.
4. **Notices**, for each student with `ReminderPreference.enabled`:
   - **First sync.** If `firstSyncedAt` is null: send one welcome email
     listing every deadline due in the next 14 days, set `firstSyncedAt`,
     and send NO per-item reminders this run. Without this, a student who connects with
     eight things due this week gets eight emails in one minute, several of
     them for lead windows that opened days ago.
   - **Lead reminders.** For each non-removed deadline with `dueAt` in the
     future, for each `L` in `leadHours`, the window is open when
     `now >= dueAt - L hours`. Fire only if the window opened within the last
     24 hours (`now < dueAt - L hours + 24h`): a window that opened longer
     ago than that was either handled by an earlier run or predates the
     connection, and a stale "3 days before" is noise. A 24-hour grace also
     covers a missed or late cron run. Notice key `lead:<L>`.
   - **Moved.** A deadline with `movedAt` set and `dueAt` within the largest
     lead window (old or new) gets a "moved" notice, key
     `moved:<new dueAt ISO>`. A second move is a second key, so it notices
     again. Outside the window, the move is recorded and shown on the page
     but not emailed; a prof shuffling something six weeks out is not urgent.
   - **Removed.** Same window rule, key `removed`.
   - **Muted courses** produce no notices of any kind, but are still stored
     and shown on the page, greyed.
5. **Batch per student per run.** Every notice a run produces for one student
   goes in ONE email ("3 things due soon, 1 moved"), never one email per
   item. The sent-log stays per item: all of that email's `ReminderSent` rows
   are claimed before the send, and all get `deliveredAt` on success. A send
   failure leaves them claimed and undelivered, and the next run retries the
   ones still inside their window.
6. **Broken feeds.** A 401 or 404, or a non-200 on three consecutive runs,
   sets `brokenAt`, sends one "reconnect your Canvas" email, and stops
   polling that feed. Reconnecting clears it. Transient failures (a timeout,
   a 5xx) are recorded and retried next run without notice.

Timing consequence to state plainly to students: with a 4-hour cadence, a
"1 day before" reminder arrives between 24 and roughly 20 hours before. If
that proves too loose, the cron moves to hourly; nothing else changes.

## 6. Parsing the feed

A hand-rolled reader, `src/canvas/parse-ics.ts`, pure, about 80 lines:

- **Line unfolding** per RFC 5545: a line starting with a space or tab
  continues the previous one. Canvas folds long SUMMARY and DESCRIPTION lines.
- Split into `VEVENT` blocks; read `UID`, `SUMMARY`, `DTSTART` (with its
  parameters), `URL`, `LAST-MODIFIED` if present. `DESCRIPTION` is read but
  not stored in v1.
- **`DTSTART;VALUE=DATE:20261026`** is an all-day item: stored as 23:59:59
  in America/Vancouver on that date, converted to UTC, `allDay: true`.
  **`DTSTART:20261027T065959Z`** is a timed item, already UTC, stored as-is.
  A `DTSTART` with a `TZID` parameter is converted using that zone; a
  malformed one skips the event and is counted, never guessed.
- **`SUMMARY`** is `Title [Course Name]`; the trailing bracket is the course
  and is stripped from the title. No bracket means an empty course name and
  the whole summary as the title.
- **`kind`** is `assignment` when the UID contains `assignment` (Canvas
  uses `event-assignment-<id>` and `event-assignment-override-<id>`), else
  `event`.
- Properties are matched case-insensitively and the parser ignores any it
  does not know, so a Canvas change that adds a property changes nothing.

**The test fixture is the student's own real feed**, captured once at plan
time into `tests/fixtures/canvas-feed.ics` with names and course titles left
in, because those are what the parser has to handle. The Workday parser was
built from one real fixture and that fixture is why it works; the same rule
applies here, and the same limitation (one faculty's shape) is accepted and
noted.

**Fallback.** If the real feed shows RFC features the reader mishandles
(nested VTIMEZONE definitions, recurrence rules on events), the plan switches
to `ical.js` rather than growing the hand-rolled reader past its point. That
decision is made once, at plan time, against the captured fixture.

## 7. The emails

Three templates, plain text with a link, through the existing
`sendMail(to, subject, body)`:

- **Welcome** (first sync): "Canvas connected. Here is what is due in the
  next 14 days:" followed by the list, then how reminders work and the lead
  times set.
- **Reminder**: subject names the count and the soonest item ("2 due in the
  next day: CPSC 110 Problem Set 3"). Body lists each with course, title,
  due date and time in America/Vancouver, and the Canvas link. Moved and
  removed items are their own labelled lines in the same email.
- **Reconnect**: the feed stopped working, one link to the Account page.

Every reminder and welcome email ends with a one-click **mute** link that
turns `ReminderPreference.enabled` off, built on the existing single-use
token mechanism in `src/lib/mail.ts` with a new purpose. The landing page
confirms and offers to turn them back on. Canada's anti-spam law requires an
unsubscribe path in electronic messages, and it is also just decent; there
is no version of this where a student cannot stop the emails in one click.

No email ever contains the feed URL.

## 8. The deadlines page

One page, reachable from the Account page and from the mute link's landing:
every non-removed deadline for the student, soonest first, grouped by day,
each with course, title, due time and the Canvas link. Removed and moved
items are shown with a note for 14 days after the change. Per-course mute
toggles, the lead-time picker (choose from 1 day, 2 days, 3 days, 1 week; any
subset), the enabled switch, and Disconnect.

The picker deliberately offers nothing shorter than a day. The job runs every
4 hours, so a 1-hour or 6-hour lead would fire only if a run happened to land
inside that window, which is a promise the system cannot keep. Shorter leads
arrive with the hourly cron or with push (section 12), and the picker grows
then.

Sizes in `rem`, no em dashes in copy, matching the rest of the site.

## 9. Security

- The feed URL is a credential. Encrypted at rest (section 4), decrypted
  only inside the job and the connect-time verification fetch, never logged,
  never returned to the browser, never in an email.
- Host and path allowlist before any fetch, at connect time and in the job.
  A stored URL is re-validated when decrypted, so a key or data problem
  cannot turn into a request to an arbitrary host.
- One feed per student; connecting replaces. A student can only read, mute,
  reconnect or disconnect their own feed; every route authenticates and
  scopes by `userId`, returning 404 rather than 403 for anything not theirs,
  as every route on this site does.
- Fetch timeout and response size cap on every request.
- The mute token is single-use and expires, like verify and reset tokens.
- The job's secrets live in GitHub Actions secrets, where the scrape job's
  already do. `FEED_ENCRYPTION_KEY` is generated once (`openssl rand -hex
  32`), set in Vercel and in GitHub, and never committed.

## 10. Failure handling

| Failure | Behaviour |
|---|---|
| Feed 401 or 404 | Mark broken, one reconnect email, stop polling until reconnected |
| Feed timeout or 5xx | Record status, retry next run; broken after three consecutive |
| Body is not a calendar | Same as non-200 |
| One event malformed | Skip that event, count it, import the rest |
| Email send fails | `ReminderSent` rows stay claimed and undelivered; retried next run while in window |
| Job run missed or late | 24-hour grace on lead windows absorbs it |
| Student regenerates the feed in Canvas | Old URL 404s; broken path above |
| Key missing at runtime | Job refuses to start, loudly, the way `hash.ts` refuses without `SERVER_SECRET` |

## 11. Testing

Vitest, flat in `tests/`, no external calls:

- `parse-ics` against the captured real fixture: counts, a known assignment's
  uid, title, course, dueAt; an all-day item's dueAt; the bracket-stripping;
  line unfolding; a malformed DTSTART skipped and counted.
- Diff logic, pure: new, unchanged, moved (movedFrom set), removed
  (removedAt set), restored (removedAt cleared).
- Reminder selection, pure, with an injected clock: fires exactly inside the
  window, not before it, not after the 24-hour grace; first sync sends
  nothing per-item; muted course produces nothing; moved outside the largest
  window is stored, not noticed.
- The sent-log under a simulated double run: two claims for the same
  `(deadlineId, notice)`, exactly one send.
- Encryption round trip; a tampered ciphertext fails to decrypt.
- The URL validator: `webcal://` rewritten; a wrong host, wrong path,
  `javascript:` and a bare IP all rejected.
- Route ownership: a student cannot read or disconnect another's feed.
- Email is already a no-op under Vitest.

## 12. Out of scope for v1, named so nobody wonders

- Phone push notifications (phase 2, its own spec).
- Deadlines on the month calendar and the Exams tab (v2 of this feature).
- The Planner API; grades; submission status; anything needing a token.
- Rotating `FEED_ENCRYPTION_KEY` (would need re-encrypting every row; note
  the procedure in the plan, do not build it).
- Recurring events in the feed (Canvas calendar events can recur; v1 stores
  the first occurrence and the plan decides on `RRULE` once the fixture
  shows whether any exist).

## 13. Commit sequence

1. Parser plus fixture plus tests (pure, no schema)
2. Models and migration; encryption helper and URL validator with tests
3. Connect and disconnect routes and the Account page block
4. The sync job: fetch, diff, and its tests
5. Notices: selection, sent-log, the three emails, mute link
6. The deadlines page with preferences
7. The GitHub Actions workflow and the `canvas:sync` script

Each leaves `main` deployable. Steps 2 and later touch the schema exactly
once (step 2), so production needs one `prisma migrate deploy` before that
push, and the GitHub secrets exist before step 7's workflow first runs.
