# UBC Flow — Syllabus Locker and Exam Schedule (Design)

**Date:** 2026-09-12
**Status:** Approved for planning
**Depends on:** [Phase 2: Accounts + Workday Import](2026-08-19-phase-2-accounts-workday-import-design.md) (merged) — supplies `Enrollment`, which every query here starts from

## 1. Why this exists

Two things a student cannot currently get from this app:

1. **When and where their exams are.** UBC publishes finals on a public page
   mid-term; midterms live only in each course's syllabus. Nobody has the whole
   picture in one place, and the pieces arrive at different times of year.
2. **Their syllabi.** They sit in email, Canvas, and a downloads folder. The
   grading breakdown — the thing a student actually re-reads — is buried on page
   three of a PDF nobody opens twice.

**Done when:** a signed-in student opens one page and sees every exam they have
this term — finals with room numbers pulled from UBC, midterms read out of the
syllabi they uploaded — and those exams appear in the calendar they already
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
mid-term, so in September the scraper returns nothing — exactly when a student
wants to know about midterms. Syllabi carry the feature early in term; the
scraper takes over late. Neither alone is the feature, which is why both are in
scope.

---

## 3. Data model

The schema already separates globally scraped data (`Section`, `MeetingTime`)
from per-user data (`Enrollment`, `EnrollmentMeeting`). This follows that split
exactly rather than inventing a new convention.

| Model | Scope | Written by |
|---|---|---|
| `FinalExam` | global — course + term + section | `scrape:exams` |
| `Syllabus` | one per user + course + term | upload |
| `SyllabusAssessment` | belongs to one `Syllabus` | extraction, then the student |

```prisma
model FinalExam {
  id          String   @id @default(cuid())
  courseId    String
  termId      String
  /// "901" from "AMNE_V 101.901", "B_941" from "FNH_V 497.B_941". Not numeric.
  sectionCode String
  /// Null ONLY on a cancelled exam, which the table publishes with empty date,
  /// time and location cells — see §4. Never null on a live exam.
  date        DateTime?
  /// "08:30". The published table gives a start only — see §4 on duration.
  startTime   String?
  /// Surname range, e.g. "ADI-SUN". Empty for most exams; when UBC splits a
  /// course across rooms it is the ONLY thing distinguishing two rows, which
  /// is why it is part of the unique key rather than a display detail.
  alphaSplit  String?
  /// Null for "SEE PROF" and other non-room sentinels — see §4.
  building    String?
  room        String?
  /// Registrar annotations, verbatim: "Late Request", "Location Change (was
  /// DMP 201)", "Cancelled: August 17 2026, 3:30pm". Always displayed as-is.
  notes       String?
  /// Derived from `notes` beginning with "Cancelled" — see §4. A cancelled
  /// exam is kept, never deleted: a student who remembers seeing it needs to
  /// be told it is off, and a row that vanishes tells them nothing.
  cancelled   Boolean  @default(false)

  @@unique([courseId, termId, sectionCode, alphaSplit])
  @@index([termId])
}

model Syllabus {
  id         String   @id @default(cuid())
  userId     String
  courseId   String
  termId     String
  /// Vercel Blob URL. Private; served only to the owner.
  blobUrl    String
  filename   String
  bytes      Int
  uploadedAt DateTime @default(now())
  /// Null until extraction has succeeded at least once.
  extractedAt DateTime?
  assessments SyllabusAssessment[]

  @@unique([userId, courseId, termId])
  @@index([userId])
}

model SyllabusAssessment {
  id         String   @id @default(cuid())
  syllabusId String
  syllabus   Syllabus @relation(fields: [syllabusId], references: [id], onDelete: Cascade)
  title      String
  /// "midterm" | "final" | "assignment" | "quiz"
  kind       String
  date       DateTime?
  startTime  String?
  /// Percent of the final grade, when the syllabus states one.
  weight     Float?
  /// Verbatim syllabus text the model based this row on, shown to the student
  /// on the confirm screen. The row is never saved without a human seeing this.
  quote      String?
  page       Int?
  /// True once the student has edited the row, which makes it win over any
  /// later re-extraction or scraped value.
  editedByUser Boolean @default(false)

  @@index([syllabusId])
}
```

`Syllabus` is unique on `(userId, courseId, termId)` — re-uploading replaces,
matching how `EnrollmentMeeting` already treats a re-import.

---

## 4. Phase 1 — Final exam scraper

`src/scrape/parse-exams.ts` (pure, testable) plus `jobs/exams.ts` and
`exams.run.ts`, wired to an `npm run scrape:exams` script. This mirrors the five
scrapers already in `src/scrape/jobs/`.

Fetching goes through the existing `fetchText` in `src/scrape/http.ts`, which
already rate-limits to one request per second across the process and sends an
identifying User-Agent.

**Probe resolved, 2026-09-12.** A raw `curl` with no User-Agent hit UBC's
bot-protection page; the same request carrying the `USER_AGENT` string from
`src/scrape/http.ts` returned the real document. `fetchText` works unmodified,
and no evasion is involved — identifying ourselves is what makes it work.

The page is WordPress + TablePress. The entire schedule is server-rendered into
a single `#tablepress-1` table (119 rows for the August 2026 period); the
department dropdown is built client-side from those rows. One fetch gets
everything, and `cheerio` is already a dependency.

**Columns:** `Department | Course name | Exam date and time | Exam location |
Alpha split | Notes`, e.g.
`BIOC | BIOC_V 302.951 | AUG 18 2026 12:00 PM | BIOL 1000 | | `.

Four parsing rules follow from the real data:

- **`Course name` splits as `SUBJECT NUMBER.SECTION` on the FIRST dot** —
  `BIOC_V 302.951` is subject `BIOC_V`, number `302`, section `951`. The section
  is not numeric: `FNH_V 497.B_941` has section `B_941`, and `AUDI_V 402.98A`
  has `98A`. Splitting on the last dot, or assuming digits, breaks both. Course
  lookup reuses the `subject: { code, campus }` pattern from
  `src/upload/import.ts:65`. (Ignore the `Department` column — it is truncated
  in the source, e.g. `FNH_` for `FNH_V`. The course cell is authoritative.)
- **The date/time cell gives a start only.** There is no end time anywhere in
  the source. `startTime` is stored; duration is §6's problem.
- **`Exam location` carries sentinels.** `SEE PROF` is not a room. Anything that
  does not match `BUILDING ROOM` is stored as null building and null room rather
  than split into nonsense — a student shown "SEE" / "PROF" would go looking for
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
  twice for the same time — `ADI-SUN` in IRC 2, `TAZ-ZHU` in IRC 6. Alpha
  splits are common, not exotic, and a unique key without `alphaSplit` would
  make the two rows collide and silently drop half the students' room.
- **`Notes` can cancel an exam.** The observed set includes
  `Cancelled: August 17 2026, 3:30pm` alongside `Late Request` and
  `Location Change (was DMP 201)`. A note beginning with `Cancelled`
  (case-insensitive) sets the `cancelled` flag; everything else is display
  text. This is one prefix test, not a note parser — the reason to keep it
  that narrow is that any richer parse would start guessing at free text the
  registrar can reword at will, and `notes` is always shown verbatim anyway.

  A cancelled row is published with **empty date, time and location cells** —
  the only record of when it would have been is inside the note text
  (`Cancelled: August 17 2026, 3:30pm`), which is why the note is stored
  verbatim and shown rather than summarised away.

  The exam view must render a cancelled exam **struck through with its note
  visible**, never as a normal exam and never by omitting it. Showing a student
  an exam that is not happening, or silently dropping one they were counting
  on, are both worse failures than the feature not existing. A cancelled exam
  is also excluded from the calendar feed (§6) — a dateless event cannot be
  rendered, and a phone alarm for an exam that was called off is the exact
  harm this rule exists to prevent.

**Failure handling.** A failed fetch must leave existing rows alone. Exam data
that is a week stale is useful; a table emptied by a transient 503 the night
before finals is actively harmful. The job upserts and never deletes as a side
effect of failure.

---

## 5. Phase 2 — Exam view

New page at `/exams`. Its own route rather than a tab inside `ScheduleTabs`,
which keeps that component untouched.

Query: the signed-in user's `Enrollment` rows for the current term, joined to
`FinalExam` on course + term.

**The empty state is a real state, not an error.** For the first half of term
there are no published finals. The page says so plainly — that UBC has not
released the schedule yet, and roughly when it does — rather than rendering a
blank panel that reads as broken.

---

## 6. Phase 3 — Exams in the calendar feed

`src/schedule/ics.ts` already powers live calendar subscriptions, so exams
should reach students' phones through the path that exists.

Two obstacles, both in `buildIcs`.

**It emits `RRULE:FREQ=WEEKLY` on every event** (`src/schedule/ics.ts:113`). An
exam happens once. The fix is a conditional in that one function — an event with
a concrete date and no weekday recurrence emits a single `VEVENT` with no
`RRULE`. Both calendar routes call `buildIcs`, so fixing it there covers every
caller rather than special-casing one.

**It requires an `endTime`, and exams have none** (§4). `buildIcs` currently
skips any event missing one, so an exam would silently vanish from the feed —
the worst possible failure for this feature.

UBC finals are scheduled in standard blocks, so an exam with an unknown end gets
a **default duration constant, `EXAM_DEFAULT_MINUTES = 150`**, declared at the
top of `src/schedule/ics.ts` with a comment saying it is an assumption, not
source data. This is a calibration knob: the published table may gain a duration
column, or 2.5 hours may prove wrong for some faculties, and when that happens
one constant changes. The calendar event carries the assumption in its
description so a student reading it knows the end time is ours, not UBC's.

---

## 7. Phase 4 — Syllabus locker

**Storage:** `@vercel/blob`. The app already deploys to Vercel; this is the
platform's own object store, gives private signed URLs, and needs no server. It
is the only new runtime dependency in this design.

**Upload route**, modelled on `src/app/api/upload/route.ts`: validate before
writing. `application/pdf` only, 10 MB cap, signed-in users only, and the size
check happens before any parse or blob write.

**Viewing** is `<embed>` pointed at a signed URL — the browser's own PDF viewer.
No `pdf.js`, no custom renderer.

**Deleting** removes the blob, not just the row. A student who deletes a
syllabus has asked for the file to be gone.

---

## 8. Phase 5 — Extraction

`src/syllabus/extract.ts`, using the Anthropic SDK (`@anthropic-ai/sdk`).

- Model `claude-opus-5`.
- The PDF goes up as a base64 `document` block — no text-extraction library.
  Handles tables and scanned pages that a text parser would mangle.
- One tool with `strict: true`, whose input schema is the assessment list.
  Strict mode guarantees the arguments validate against the schema.
- Cost is roughly **5¢ per syllabus** (a 10-page PDF is ~10–15k input tokens at
  $5/MTok), so about 25¢ for a student's full term.

**Synchronous, on upload.** ~15 seconds for one file. A student uploads one
syllabus at a time and can watch it work. This avoids building a job queue,
which the app currently has no infrastructure for.

**The confirm screen is the verifier.** Extraction output is never saved
directly. The student sees a table of proposed rows, each editable, each showing
the verbatim `quote` and page number the model drew it from. Nothing is written
until they accept.

An earlier idea — string-matching the quote against the PDF to catch
hallucinations automatically — was dropped: it would require the PDF-text
dependency the `document` block exists to avoid, and it would duplicate a check
the human in the loop is already performing.

**Abuse and cost guard.** A per-user daily extraction cap. Without one, a
compromised account or a scripted loop can spend real money against the API key.

**Failure handling.** If the API call fails, the syllabus is still stored and
still readable — it is flagged as not yet read, with a retry. Losing a student's
upload because a model call timed out is the one outcome this must never
produce.

---

## 9. Phase 6 — Merging the two sources

The exam view unions `FinalExam` rows with `SyllabusAssessment` rows whose
`kind` is `midterm` or `final`.

Precedence when the same exam appears twice:

1. A row the student edited (`editedByUser`) wins over everything.
2. Otherwise a scraped `FinalExam` wins over a syllabus-derived final — UBC's
   own schedule is authoritative over "TBD, scheduled by the registrar".
3. Midterms only ever come from syllabi, so they never conflict.

---

## 10. Testing

Vitest is already configured.

- `parse-exams.ts` against `tests/fixtures/exam-schedule.html` — verbatim markup
  trimmed from the live table on 2026-09-12, carrying one row of every shape the
  parser must survive: a plain `BIOL 1000` location, the `SEE PROF` sentinel,
  `CHEM_V 123.921` split across IRC 2 / IRC 6 by surname range, the non-numeric
  sections `B_941` and `98A`, and all three observed notes including the
  dateless cancelled row.
- `buildIcs` one-off events: an exam emits no `RRULE`; a weekly meeting still
  does.
- The extraction tool schema validates, and the merge precedence in §9 is
  exercised directly.

**No test calls the Anthropic API.** Extraction is tested against recorded tool
output, so the suite stays free and deterministic.

---

## 11. Commit sequence

Each commit leaves `main` deployable.

1. ~~Scraper probe~~ — done 2026-09-12, findings folded into §4. No code kept.
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
- Assignment due dates as a deadline feed — the data will exist after Phase 5,
  but the view is its own feature
- Okanagan campus exams; the scraper targets UBCV first
