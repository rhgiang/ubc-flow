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
  /// Null when UBC lists one exam for the whole course rather than per section.
  sectionCode String?
  date        DateTime
  startTime   String?
  endTime     String?
  building    String?
  room        String?

  @@unique([courseId, termId, sectionCode])
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

**Known risk, probed first.** A raw `curl` of the exam page during design hit
UBC's bot-protection interception page rather than the table. A fetch through a
different client got the real content, so this is likely a header or TLS
fingerprint difference rather than a hard block. The existing scrapers reach
other UBC hosts successfully. **The first commit is a throwaway probe** that
confirms `fetchText` can read the table — no schema changes, no migration, until
it does. If it cannot, Phase 1 stops and gets redesigned rather than worked
around; evading bot protection on a university's site is not in scope.

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

One obstacle: `buildIcs` emits `RRULE:FREQ=WEEKLY` on every event
(`src/schedule/ics.ts:113`). An exam happens once. The fix is a conditional in
that one function — an event with a concrete date and no weekday recurrence
emits a single `VEVENT` with no `RRULE`. Both calendar routes call `buildIcs`,
so fixing it there covers every caller rather than special-casing one.

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

- `parse-exams.ts` against a saved HTML fixture of the real table, including a
  course with no room assigned and one with a split section.
- `buildIcs` one-off events: an exam emits no `RRULE`; a weekly meeting still
  does.
- The extraction tool schema validates, and the merge precedence in §9 is
  exercised directly.

**No test calls the Anthropic API.** Extraction is tested against recorded tool
output, so the suite stays free and deterministic.

---

## 11. Commit sequence

Each commit leaves `main` deployable.

1. Scraper probe — confirm `fetchText` can read the exam table (throwaway)
2. `FinalExam` model + migration + `scrape:exams`
3. `/exams` page reading scraped finals
4. One-off events in `buildIcs`; exams join the calendar feed
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
