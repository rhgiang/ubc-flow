# UBC Flow - Syllabus Locker and Exam Schedule (Design)

**Date:** 2026-09-12
**Status:** Shipped on `feat/syllabus-and-exams`; sections 3, 5, 7, 9 and 13
describe what shipped, section 4 the scraper as designed and built
**Depends on:** [Phase 2: Accounts + Workday Import](2026-08-19-phase-2-accounts-workday-import-design.md) (merged) - supplies `Enrollment`, which every query here starts from

## 1. Why this exists

Two things a student cannot currently get from this app:

1. **When and where their exams are.** UBC publishes finals on a public page
   mid-term; midterms live only in each course's syllabus. Nobody has the whole
   picture in one place, and the pieces arrive at different times of year.
2. **Their syllabi.** They sit in email, Canvas, and a downloads folder. The
   grading breakdown - the thing a student actually re-reads - is buried on page
   three of a PDF nobody opens twice.

**Done when:** a signed-in student opens one page and sees every exam they have
this term - finals with room numbers pulled from UBC, midterms read out of the
syllabi they uploaded - and those exams appear in the calendar they already
subscribe to.

---

## 2. Scope decisions made before design

These were settled during brainstorming and are not open in the plan.

**Syllabi are private to the uploader.** No shared library, no crowdsourcing.
A syllabus is the instructor's copyright; a per-student locker is ordinary
personal use, while redistributing them to everyone in the course is not. This
removes moderation, dedupe, term-tagging, and takedown handling from the design
entirely.

**Finals come from UBC, not from syllabi.** `tools.students.ubc.ca/exam-schedule/`
is a public, login-free table of course → exam date/time → location. Scraping it
once per term serves every user automatically, with no upload and no LLM. Syllabi
are needed only for midterms.

**Extraction stops at assessments.** Title, kind, date, weight. Not textbooks,
office hours, or policies. Every field added is another field to verify and
correct; the assessment list is what the exam view and a grading-breakdown panel
both need, and nothing else earns its place yet.

**The two halves are complementary in time.** UBC does not publish finals until
mid-term, so in September the scraper returns nothing - exactly when a student
wants to know about midterms. Syllabi carry the feature early in term; the
scraper takes over late. Neither alone is the feature, which is why both are in
scope.

---

## 3. Data model

The schema already separates globally scraped data (`Section`, `MeetingTime`)
from per-user data (`Enrollment`, `EnrollmentMeeting`). This follows that split
exactly rather than inventing a new convention. What is below is what shipped,
after six migrations (`final_exam`, `syllabus`, `syllabus_assessment`,
`syllabus_upload_quota`, `syllabus_link_and_text`, `exam_add_remove`); the
source of truth is `prisma/schema.prisma`.

| Model | Scope | Written by |
|---|---|---|
| `FinalExam` | global - course + term + section + alpha split | `scrape:exams` only |
| `Syllabus` | one per user + course + term | `POST /api/syllabus` |
| `SyllabusAssessment` | one per user + course + term row, syllabus optional | the confirm-table save, or `POST /api/exams` |
| `HiddenFinalExam` | one per user + `FinalExam` | `DELETE /api/exams` |
| `User.extractionCount/WindowStart`, `uploadCount/WindowStart` | per user | the two quota routes |

`FinalExam` is exactly as first designed and is still the one thing here that
belongs to nobody. `courseId`/`termId` are raw FKs with no Prisma relation,
the same cross-domain convention the rest of the schema uses, so every join
to `Course` happens in JS.

```prisma
model FinalExam {
  id          String   @id @default(cuid())
  courseId    String
  termId      String
  sectionCode String      // "901", "B_941", "98A" - not numeric
  date        DateTime?   // null ONLY on a cancelled exam (section 4)
  startTime   String?     // "08:30"; the table gives a start only
  alphaSplit  String?     // "ADI-SUN"; part of the key, not a display detail
  building    String?     // null for "SEE PROF" and other sentinels
  room        String?
  notes       String?     // registrar annotations, verbatim, always shown
  cancelled   Boolean  @default(false)  // notes begins with "Cancelled"

  @@unique([courseId, termId, sectionCode, alphaSplit])
  @@index([termId])
}
```

`Syllabus` grew two ways a syllabus can be recorded besides a PDF, because
some UBC syllabi live on a Canvas page behind login and have no file to
upload. The three are not mutually exclusive on the row; a row always carries
at least one, enforced by the upload route (the only writer), since Prisma
cannot express that as a constraint.

```prisma
model Syllabus {
  id          String   @id @default(cuid())
  userId      String   // relation to User, onDelete: Cascade
  courseId    String
  termId      String
  pathname    String?  // blob pathname, NEVER a URL: the store is private
  filename    String?  // the three file fields move together
  size        Int?
  url         String?  // a bookmark only, never fetched server-side
  sourceText  String?  // the syllabus pasted as text; what makes a Canvas syllabus readable
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  extractedAt DateTime? // set by the SAVE route, so "confirmed at least once"
  assessments SyllabusAssessment[]

  @@unique([userId, courseId, termId])
}
```

`SyllabusAssessment` carries its own `userId`, `courseId` and `termId`, and
`syllabusId` is optional. That is what lets a student add an exam straight
from the exam view for a course they never recorded a syllabus for: a
standalone row with a real owner, deleted outright when they remove it. Rows
that came off a syllabus still cascade with it. `location` exists only for
typed rows; the model never reports one.

```prisma
model SyllabusAssessment {
  id           String    @id @default(cuid())
  syllabusId   String?   // null on a row typed straight into the exam view
  userId       String    // relation to User, onDelete: Cascade
  courseId     String
  termId       String
  title        String
  kind         String    // "midterm" | "final" | "assignment" | "quiz"
  date         DateTime?
  startTime    String?
  weight       Float?
  location     String?   // typed rows only
  quote        String?   // verbatim evidence on an extracted row; null ONLY on a typed row
  page         Int?
  editedByUser Boolean   @default(false) // edited or typed; see section 9

  @@index([syllabusId])
  @@index([userId, termId])
}
```

`HiddenFinalExam` is "don't show me this one" for a row that is everyone's.
Removing a scraped final from a student's view cannot delete it, so it is a
per-user marker, reversible by deleting the marker, and the exam tab lists
what is hidden so a real final hidden by accident can always be found again.

```prisma
model HiddenFinalExam {
  userId      String   // relation to User, onDelete: Cascade
  finalExamId String   // raw FK, same convention as FinalExam's own
  createdAt   DateTime @default(now())

  @@id([userId, finalExamId])
}
```

The two quota pairs on `User` are fixed-window counters for the two things
that cost money: Anthropic calls (8 a day) and blob writes (10 a day). Two
separate pairs so the quotas cannot consume each other. Both routes charge
before the paid call and refund, best effort, when the call itself throws;
a successful call that returned nothing is a real paid call and stays
charged.

---

## 4. Phase 1 - Final exam scraper

`src/scrape/parse-exams.ts` (pure, testable) plus `jobs/exams.ts` and
`exams.run.ts`, wired to an `npm run scrape:exams` script. This mirrors the five
scrapers already in `src/scrape/jobs/`.

Fetching goes through the existing `fetchText` in `src/scrape/http.ts`, which
already rate-limits to one request per second across the process and sends an
identifying User-Agent.

**Probe resolved, 2026-09-12.** A raw `curl` with no User-Agent hit UBC's
bot-protection page; the same request carrying the `USER_AGENT` string from
`src/scrape/http.ts` returned the real document. `fetchText` works unmodified,
and no evasion is involved - identifying ourselves is what makes it work.

The page is WordPress + TablePress. The entire schedule is server-rendered into
a single `#tablepress-1` table (119 rows for the August 2026 period); the
department dropdown is built client-side from those rows. One fetch gets
everything, and `cheerio` is already a dependency.

**Columns:** `Department | Course name | Exam date and time | Exam location |
Alpha split | Notes`, e.g.
`BIOC | BIOC_V 302.951 | AUG 18 2026 12:00 PM | BIOL 1000 | | `.

Four parsing rules follow from the real data:

- **`Course name` splits as `SUBJECT NUMBER.SECTION` on the FIRST dot** -
  `BIOC_V 302.951` is subject `BIOC_V`, number `302`, section `951`. The section
  is not numeric: `FNH_V 497.B_941` has section `B_941`, and `AUDI_V 402.98A`
  has `98A`. Splitting on the last dot, or assuming digits, breaks both. Course
  lookup reuses the `subject: { code, campus }` pattern from
  `src/upload/import.ts:65`. (Ignore the `Department` column - it is truncated
  in the source, e.g. `FNH_` for `FNH_V`. The course cell is authoritative.)
- **The date/time cell gives a start only.** There is no end time anywhere in
  the source. `startTime` is stored; duration is §6's problem.
- **`Exam location` carries sentinels.** `SEE PROF` is not a room. Anything that
  does not match `BUILDING ROOM` is stored as null building and null room rather
  than split into nonsense - a student shown "SEE" / "PROF" would go looking for
  a building named SEE.
- **The table has no term column**, and only ever shows one exam period. The
  term is derived **once per scrape run**, not per row: take the dated rows,
  run the exported `inferTerm()` from `src/upload/parse-workday.ts:204` over
  them, and use the majority result for every row in the run. Per-row inference
  would have nothing to work from on a cancelled row, whose date cell is empty.
  One published table is one exam period, so one term is also the truer model.
  `inferTerm` already encodes UBC's month-to-session mapping and is not
  reimplemented here.
- **One course+section can occupy two rows.** `CHEM_V 123.921` is published
  twice for the same time - `ADI-SUN` in IRC 2, `TAZ-ZHU` in IRC 6. Alpha
  splits are common, not exotic, and a unique key without `alphaSplit` would
  make the two rows collide and silently drop half the students' room.
- **`Notes` can cancel an exam.** The observed set includes
  `Cancelled: August 17 2026, 3:30pm` alongside `Late Request` and
  `Location Change (was DMP 201)`. A note beginning with `Cancelled`
  (case-insensitive) sets the `cancelled` flag; everything else is display
  text. This is one prefix test, not a note parser - the reason to keep it
  that narrow is that any richer parse would start guessing at free text the
  registrar can reword at will, and `notes` is always shown verbatim anyway.

  A cancelled row is published with **empty date, time and location cells** -
  the only record of when it would have been is inside the note text
  (`Cancelled: August 17 2026, 3:30pm`), which is why the note is stored
  verbatim and shown rather than summarised away.

  The exam view must render a cancelled exam **struck through with its note
  visible**, never as a normal exam and never by omitting it. Showing a student
  an exam that is not happening, or silently dropping one they were counting
  on, are both worse failures than the feature not existing. A cancelled exam
  is also excluded from the calendar feed (§6) - a dateless event cannot be
  rendered, and a phone alarm for an exam that was called off is the exact
  harm this rule exists to prevent.

**Failure handling.** A failed fetch must leave existing rows alone. Exam data
that is a week stale is useful; a table emptied by a transient 503 the night
before finals is actively harmful. The job upserts and never deletes as a side
effect of failure.

---

## 5. Phase 2 - Exam view

Shipped as the **Exams tab of `/schedule`**, not as its own route. `/exams`
and `/syllabus` were their own pages briefly; both are now permanent
redirects to `/schedule?tab=exams` (in `next.config.ts`), so an old bookmark
still lands on the content. The tab answers the same question the Calendar
tab does ("when do I have to be somewhere for this course") and shares its
term, its share link and its calendar subscription.

Data comes from `src/schedule/exam-queries.ts`, which every surface (the tab, the
shared page, the ICS feed) reads through, so there is one place hiding and
section filtering happen:

- `examRowsForUser(userId, termId)`: the student's `Enrollment` rows for the
  term joined to `FinalExam` on course + term, then `filterToOwnSection` with
  the student's hidden ids. Every scraped row for the course comes back
  (`Enrollment` carries no section) and the filter narrows to the student's
  own lecture section from their Workday import when it can; when it cannot,
  every section is shown flagged `ambiguousSection`. Hidden rows are removed
  from view but still count toward what UBC published, so hiding your own
  section never surfaces another section's exam as yours.
- `syllabusExamRowsForUser`: the student's `midterm`/`final` assessment rows,
  syllabus-derived and typed alike.
- `mergeExams` (section 9) and `groupExams`: one exam UBC split across rooms
  by surname is ONE entry everywhere, including the feed.

The tab has a **List** view and a **month Calendar** view over the same
data, a detail overlay either one opens, an **Add exam** form, a hover-x (and
overlay button) that removes an exam, and a collapsed **hidden list** that
restores a hidden scraped final. A cancelled exam is struck through with its
note; a dateless one says "Date TBA" and is never dropped. Every date is
rendered in UTC because every date is stored as UTC midnight.

**The empty state is a real state, not an error.** Until UBC publishes the
term's finals the page says so plainly. Once ONE `FinalExam` row exists for
the term (any course, not just the student's) the schedule is out, and an
enrolled course still missing from it is named as having no
registrar-scheduled final (`examCoverage`). Hidden exams and syllabus finals
count as covered.

---

## 6. Phase 3 - Exams in the calendar feed

`src/schedule/ics.ts` already powers live calendar subscriptions, so exams
should reach students' phones through the path that exists.

Two obstacles, both in `buildIcs`.

**It emits `RRULE:FREQ=WEEKLY` on every event** (`src/schedule/ics.ts:113`). An
exam happens once. The fix is a conditional in that one function - an event with
a concrete date and no weekday recurrence emits a single `VEVENT` with no
`RRULE`. Both calendar routes call `buildIcs`, so fixing it there covers every
caller rather than special-casing one.

**It requires an `endTime`, and exams have none** (§4). `buildIcs` currently
skips any event missing one, so an exam would silently vanish from the feed -
the worst possible failure for this feature.

UBC finals are scheduled in standard blocks, so an exam with an unknown end gets
a **default duration constant, `EXAM_DEFAULT_MINUTES = 150`**, declared at the
top of `src/schedule/ics.ts` with a comment saying it is an assumption, not
source data. This is a calibration knob: the published table may gain a duration
column, or 2.5 hours may prove wrong for some faculties, and when that happens
one constant changes. The calendar event carries the assumption in its
description so a student reading it knows the end time is ours, not UBC's.

---

## 7. Phase 4 - Syllabus locker

**Storage:** `@vercel/blob`, private. There is no fetchable URL for a
syllabus: `Syllabus.pathname` is the blob pathname, and the only reader is
`GET /api/syllabus/[id]/file`, which re-checks ownership on every request
and streams the bytes through. The viewer is an `<embed>` pointed at that
route. No `pdf.js`.

**Three ways to record a syllabus**, all through `POST /api/syllabus`, one
per request: a PDF, a link, or the syllabus pasted as text. The link is a
bookmark only, never fetched (a Canvas link returns a login page); the paste
is what makes a Canvas syllabus readable. Adding a link does not wipe a
paste and vice versa.

**Validation before any write** (`src/syllabus/validate.ts`):
`application/pdf` only and **4 MB**, not the 10 MB first planned, because a
Vercel Function request body over about 4.5 MB never reaches the route at
all; `http`/`https` links only, 2048 characters; pasted text 100,000
characters, since it goes straight into a paid model as input tokens.

**Guards:** enrolled in that course this term, or 403; 10 uploads a day per
account (blob writes are billed operations), charged before `put()` and
refunded if `put()` throws. Links and pastes write one row and no blob, so
they are not charged.

**Deleting** removes the blob, then the row; if the blob delete fails the row
stays so the UI never claims a file is gone while it is not.

---

## 8. Phase 5 - Extraction

`src/syllabus/extract.ts`, using the Anthropic SDK (`@anthropic-ai/sdk`).

- Model `claude-opus-5`.
- The PDF goes up as a base64 `document` block - no text-extraction library.
  Handles tables and scanned pages that a text parser would mangle.
- One tool with `strict: true`, whose input schema is the assessment list.
  Strict mode guarantees the arguments validate against the schema.
- `output_config: { effort: 'low' }` - pulling a list out of a structured
  document isn't reasoning-hard, and Opus 5's default (high) thinking effort
  would otherwise run adaptive thinking on every call, with output tokens at
  $25/MTok dominating the bill for no accuracy gain here.
- Cost estimate, **not yet measured against the real API**: input is roughly
  10–15k tokens for a 10-page PDF at $5/MTok (~5–8¢), plus whatever the tool
  call itself and any output/thinking tokens add on top even at low effort -
  call it **10–15¢ per syllabus** as a rough upper bound pending a real
  invoice, i.e. under a dollar for a student's full term.

**Synchronous, on upload.** ~15 seconds for one file. A student uploads one
syllabus at a time and can watch it work. This avoids building a job queue,
which the app currently has no infrastructure for.

**The confirm screen is the verifier.** Extraction output is never saved
directly. The student sees a table of proposed rows, each editable, each showing
the verbatim `quote` and page number the model drew it from. Nothing is written
until they accept.

An earlier idea - string-matching the quote against the PDF to catch
hallucinations automatically - was dropped: it would require the PDF-text
dependency the `document` block exists to avoid, and it would duplicate a check
the human in the loop is already performing.

**Abuse and cost guard.** A per-user daily extraction cap. Without one, a
compromised account or a scripted loop can spend real money against the API key.

**Failure handling.** If the API call fails, the syllabus is still stored and
still readable - it is flagged as not yet read, with a retry. Losing a student's
upload because a model call timed out is the one outcome this must never
produce.

---

## 9. Phase 6 - Merging the two sources

The exam view unions `FinalExam` rows with `SyllabusAssessment` rows whose
`kind` is `midterm` or `final` (`mergeExams` in `src/schedule/exams.ts`).

**Nothing ever displaces a scraped `FinalExam` row.** This replaces the
original precedence list, which said an edited row "wins over everything".
Two rules that guessed which of two finals was the real one each produced a
hidden real exam on this branch: keying scraped rows per course lost half of
an alpha split and let a cancelled section overwrite a live one; letting an
edited or hand-typed final replace the scraped one meant a student who typed
"final, date TBA" in September never saw the row UBC published in November,
and never saw a cancellation notice either. So:

1. Every scraped row passes through untouched, alpha splits, every published
   section, cancelled rows included. Section filtering and hiding happen
   upstream, in `examRowsForUser`, and are the student's own choices.
2. A syllabus final the student did NOT edit is dropped when UBC publishes a
   final for that course. That row is the model reading "final exam,
   scheduled by the registrar" off a PDF with no date; UBC's schedule is
   authoritative over it.
3. An edited or hand-typed final (`editedByUser`) is kept BESIDE the scraped
   one, each card labelled with its source. If the student truly disagrees
   with UBC they hide UBC's row, and the hidden list gives it back.
4. Midterms only ever come from syllabi, so they never conflict and all pass
   through.

The merged list is sorted once: dated live exams ascending, cancelled and
dateless rows last.

---

## 10. Testing

Vitest is already configured.

- `parse-exams.ts` against `tests/fixtures/exam-schedule.html` - verbatim markup
  trimmed from the live table on 2026-09-12, carrying one row of every shape the
  parser must survive: a plain `BIOL 1000` location, the `SEE PROF` sentinel,
  `CHEM_V 123.921` split across IRC 2 / IRC 6 by surname range, the non-numeric
  sections `B_941` and `98A`, and all three observed notes including the
  dateless cancelled row.
- `buildIcs` one-off events: an exam emits no `RRULE`; a weekly meeting still
  does.
- The extraction tool schema validates, and the merge rule in §9 is
  exercised directly: a hand-typed dateless final beside a later scraped
  final leaves both, with the scraped one intact.

**No test calls the Anthropic API.** Extraction is tested against recorded tool
output, so the suite stays free and deterministic.

---

## 11. Commit sequence

Each commit leaves `main` deployable.

1. ~~Scraper probe~~ - done 2026-09-12, findings folded into §4. No code kept.
2. `FinalExam` model + migration + `scrape:exams`
3. `/exams` page reading scraped finals
4. One-off events and default exam duration in `buildIcs`; exams join the feed
5. `Syllabus` model + blob upload + viewer
6. `SyllabusAssessment` + extraction + confirm screen
7. Merge syllabus midterms into `/exams`

---

## 12. Out of scope

Named here so they are decisions rather than omissions:

- Sharing syllabi between students (§2)
- Extracting textbooks, office hours, or policies (§2)
- Asking questions of a syllabus in natural language
- Assignment due dates as a deadline feed - the data will exist after Phase 5,
  but the view is its own feature
- Okanagan campus exams; the scraper targets UBCV first

---

## 13. Added after the original plan

Each of these shipped on the same branch and is described in the sections
above as it exists, not as it was planned.

- **Restructure into Schedules.** `/exams` and `/syllabus` folded into the
  Exams tab of `/schedule`; both old paths are permanent redirects.
- **Month calendar view.** A List/Calendar switch inside the tab; a month
  grid per month with exams, cancelled and dateless exams listed under it.
- **Section filtering.** `filterToOwnSection` narrows a multi-section
  course to the student's lecture section from Workday, or shows every
  section flagged when it cannot tell.
- **Link and paste.** A syllabus can be a URL (bookmark only) or pasted
  text, for Canvas syllabi with no file; pasted text is extractable.
- **Manual edit, add and remove.** The confirm table doubles as the editor
  for saved rows (no extraction call); an Add exam form writes a standalone
  `SyllabusAssessment` with no syllabus; a hover x and the overlay remove an
  exam, asking first when the removal is a delete.
- **Hide.** Removing a scraped final writes a `HiddenFinalExam` marker, never
  a delete; the hidden list restores it, and it stays out of the list,
  calendar, feed and shared page until then.
- **Share page and feed carry finals.** `/shared/enrolled/[token]` shows UBC's
  published finals for the term; the subscribed ICS feed carries the merged
  list, grouped, with syllabus rows marked as such in the description.
- **Quota refunds.** Both the upload and extraction caps hand the unit back
  when the paid call itself throws.
