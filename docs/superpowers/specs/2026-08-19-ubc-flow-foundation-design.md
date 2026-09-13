# UBC Flow - Phase 1: Foundation (Design)

**Date:** 2026-08-19
**Status:** Approved for planning
**Phase:** 1 of 6

## 1. Project context

UBC Flow is a course and professor review platform for the University of British
Columbia, modelled on [UW Flow](https://uwflow.com). Students rate courses on
**usefulness**, **difficulty**, and **liked**, rate professors, and write reviews.

UW Flow's source ([backend](https://github.com/UWFlow/uwflow),
[frontend](https://github.com/UWFlow/uwflow_frontend)) is the reference for product
decisions - schema shape, rating model, page layouts. It is **not** a code donor:
their backend is Go + Hasura and their importer targets Waterloo's official course
API. We are building a TypeScript monolith against UBC data sources. Expect to
borrow the design and write the code.

### Differentiators from UW Flow

These are why this is not merely a clone. They are designed into the schema now
even though most ship in later phases:

1. **Grade distributions** - UBC publishes historical grade data (PAIR/FOI
   releases). Waterloo does not, so UW Flow structurally cannot offer this.
2. **Workday schedule import + live calendar sync** - UBC's Workday Student is
   widely disliked for viewing schedules and exporting to calendars. Every
   existing community tool (`workdaycal.vercel.app`, `jackkoskie/ubc-workday2cal`,
   the UBC Workday Calendar Generator extension) produces a **one-shot `.ics`
   that goes stale**. We serve a **subscribable webcal URL** that stays live.
   No existing UBC tool does this.
3. **Design quality** - a deliberately higher visual bar than UW Flow. Continuous
   across all phases, not a phase of its own.

### Phase order

Accounts/import precedes ratings because the Workday upload both verifies
enrollment (gating reviews) and feeds the schedule planner.

| # | Phase | Ships |
|---|-------|-------|
| **1** | **Foundation** | schema, scrapers, course + professor pages, search |
| 2 | Accounts + Workday import | auth, `.xlsx` parsing, verified enrollments |
| 3 | Ratings & reviews | usefulness/difficulty/liked, prof ratings, profiles |
| 4 | Schedule planner + webcal | timetable builder, live subscription URL |
| 5 | Grade distributions | PAIR ingest, per-course and per-prof averages |
| 6 | Prerequisite trees | parse prereq prose, visualise |

---

## 2. Phase 1 scope

**In scope:** database schema (full, all phases), UBC course data ingestion,
read-only course pages, read-only professor pages, browse and search.

**Out of scope:** all user accounts, all ratings and reviews, schedule planner,
grade data ingestion, prerequisite parsing. Phase 1 ships a browsable but
read-only catalogue. Nobody can log in or rate anything yet.

**Done when:** a visitor can search UBC courses, open a course page showing its
description, credits, sections, meeting times, and instructors, and open a
professor page listing the courses they teach - with data refreshed on a schedule
from live UBC sources.

---

## 3. Data source research (findings)

Investigated 2026-08-19. **These findings materially shape the phase - read before
planning the scraper.**

### 3.1 Every existing UBC scraper on GitHub is stale

UBC migrated Course Schedule to **Drupal 11** since those projects were written.
The old URL scheme is dead:

```
https://courses.students.ubc.ca/cs/courseschedule?pname=subjarea&... → 302 → /
```

`StuffByLiang/realtime-ubc-courses-api`, `qstevens/UBC-Web-Scraper`, and friends
all target that dead scheme. `sjsikora/UBC-Class-Api` was voluntarily withdrawn
"in accord with UBC's CWL terms of service". **We are writing this from scratch,
and we do not copy the withdrawn project's approach.**

### 3.2 Course data is behind Drupal Views AJAX, not plain HTML

The current search UI is at `https://courses.students.ubc.ca/course-search`. Its
exposed filter is a standard Drupal Views form:

- `campus` - radio, `1` = Vancouver, `2` = Okanagan (required)
- `academic_period` - numeric term ID (`1449` = 2025-26 Winter Term 1 UBC-V,
  `1450` = W2 UBC-V, `1452` = 2026 Summer UBC-V; Okanagan has its own IDs)
- `subject` - numeric subject ID (`1810` = Computer Science Vancouver)
- `subject_code` - free-text alternative (`CPSC`), preferable to the numeric ID
- `course_number`, `title`, `credits`, `delivery_mode`

`drupalSettings` exposes the view: `ajax_path: /views/ajax`, `view_name:
new_course_search`, `view_display_id: block_1`, `view_path: /node/71615`.

**Verified negative results - plain HTTP does not return course rows:**

| Attempt | Result |
|---|---|
| `GET /course-search?campus=1&academic_period=1449&subject_code=CPSC` | 200, 75KB, **zero course rows** |
| `POST /views/ajax` with full param set + `view_dom_id` | 200, 87KB, but the `insert` payload is **only the re-rendered filter form** |

The academic calendar (`vancouver.calendar.ubc.ca`) behaves the same way - its
subject index yields 3 nav links and no course list to a plain GET.

**Conclusion: both sources render content client-side.** A `fetch` + `cheerio`
scraper will not work as-is.

### 3.3 Consequence - the scraper is this phase's main risk

Phase 1 therefore **opens with a timeboxed spike** (see §6.1) before scraper
implementation. Two candidate approaches, in preference order:

1. **Headless browser (Playwright).** Drive the real search UI, let their JS run,
   read the rendered DOM. Slower and heavier, but robust to the token/session
   mechanics we failed to reproduce by hand, and resilient to markup churn.
   **Default assumption unless the spike finds something better.**
2. **Reverse-engineered AJAX.** Capture the real request in browser DevTools
   (headers, session cookie, form build token, live `view_dom_id`) and replay it.
   Much faster if it works - the spike's job is to find out.

Whichever wins, the scraper is a **scheduled batch job writing to our own
database**. It is never a live proxy on the request path. Rate-limited,
`User-Agent`-identified, results cached. We scrape only public, unauthenticated
pages - never anything behind CWL.

---

## 4. Architecture

Simplified TypeScript monolith. UW Flow's five-service split (Postgres, Hasura,
Go API, importer, email) is sound for a funded team and overhead for a solo
build.

```
Next.js (App Router, TS)          - pages + route handlers, one deployable
  └── Prisma ──► Postgres         - single source of truth
Tailwind + shadcn/ui              - UI
scripts/scrape/*.ts               - standalone scheduled jobs, same Prisma client
```

**Deliberately not doing:** no Hasura (hand-written queries; ratings CRUD is not
complex enough to justify a GraphQL engine), no separate API service, no email
service until Phase 2 needs verification mail, no Docker Compose for local dev
(a hosted Postgres branch is enough).

**Hosting:** Vercel + Neon. Scrapers run as scheduled jobs; if a full scrape
exceeds Vercel's function limits, it moves to a GitHub Actions cron. Decide when
we measure, not now.

---

## 5. Schema

Defined in full across all six phases so later phases never migrate live review
data. **Phase 1 implements and populates only §5.1.** The rest are created empty.

### 5.1 Catalogue (Phase 1)

```
Subject      id, code, name, campus, faculty
             unique(code, campus)

Course       id, subjectId, number, title, description, credits,
             campus, prereqText, coreqText, updatedAt
             unique(subjectId, number)
             -- prereqText/coreqText are raw prose; parsed in Phase 6

Term         id, ubcPeriodId, name, year, session, termNumber, campus,
             startDate, endDate
             unique(ubcPeriodId)
             -- ubcPeriodId is UBC's numeric academic_period (e.g. 1449)

Section      id, courseId, termId, sectionCode, activity, status,
             deliveryMode, enrolTotal, enrolCap
             unique(courseId, termId, sectionCode)
             -- activity: Lecture | Laboratory | Tutorial | Seminar | ...
             -- status:   Available | Full | Blocked | STT | Restricted

MeetingTime  id, sectionId, day, startTime, endTime, building, room,
             startDate, endDate
             -- separate row per meeting; handles split/alternating schedules

Instructor   id, name, slug, campus
             unique(slug)

SectionInstructor  sectionId, instructorId
             primary key(sectionId, instructorId)
```

`Instructor` is deliberately its own entity rather than a string on `Section`,
because Phase 3 hangs professor ratings off it and Phase 5 hangs grade
distributions off it.

Instructor identity is a known hazard: UBC renders names inconsistently
("Smith, John", "John Smith", "SMITH, J"). Normalise to a `slug` on ingest and
treat collisions as a data-quality issue to review, not to silently merge.

### 5.2 Later phases (created, unpopulated)

```
User               id, email, emailVerified, passwordHash, name, program,
                   gradYear, createdAt                              [P2]
Enrollment         id, userId, courseId, termId, source, verified   [P2]
                   -- source: workday_xlsx | self_reported
CourseReview       id, userId, courseId, termId, instructorId,
                   liked, useful, difficulty, workloadHours, text,
                   createdAt, updatedAt                             [P3]
                   unique(userId, courseId)
InstructorReview   id, userId, instructorId, courseId, liked, clear,
                   engaging, text                                   [P3]
                   unique(userId, instructorId, courseId)
SavedSchedule      id, userId, termId, name                         [P4]
ScheduleSection    scheduleId, sectionId                            [P4]
CalendarToken      id, userId, token, createdAt                     [P4]
                   -- opaque token behind the webcal subscription URL
GradeDistribution  id, courseId, instructorId, termId, average,
                   median, high, low, count, distribution           [P5]
```

**Rating model** (mirrors UW Flow, ships Phase 3): `liked` is a boolean,
`useful` and `difficulty` are `0..4` integers. Aggregates display as
percentages. Note `difficulty` is stored as difficulty, not UW Flow's "easy" -
invert at the presentation layer, never in storage.

---

## 6. Work breakdown

### 6.1 Scraper spike (blocking, timeboxed 1 day)

Output is an answer, not shipped code. Determine which extraction method works
against `courses.students.ubc.ca`:

1. Open the search in a real browser, capture the successful results request in
   DevTools, and attempt to replay it with `curl` including cookies/tokens.
2. If replay fails or is fragile, confirm Playwright can drive the UI and read
   rendered rows.

Deliverable: a one-page note naming the chosen method with a working proof for a
single subject (CPSC, Vancouver, one term), plus a saved HTML fixture for tests.

### 6.2 Scraper implementation

Three jobs, run in dependency order:

- **Subjects + terms** - populate `Subject` and `Term` from the search form's own
  `<option>` lists. These *are* available to a plain GET and are the one piece
  already proven. Rarely changes; run weekly.
- **Courses + sections** - per (campus, term, subject), populate `Course`,
  `Section`, `MeetingTime`, `Instructor`, `SectionInstructor`. Run nightly during
  registration season, weekly otherwise.
- **Descriptions** - enrich `Course.description`, `credits`, `prereqText` from
  the academic calendar. Run weekly.

All jobs are **idempotent upserts** - safe to re-run, never destructive. A run
that scrapes fewer than 80% of the previous run's rows aborts and alerts rather
than writing, so an upstream markup change degrades to stale data instead of
wiping the catalogue.

### 6.3 Pages

- `/` - search entry and browse by subject
- `/course/[code]` - e.g. `/course/cpsc-221`: description, credits, prereq prose,
  sections table with times/locations/instructors, links to instructors. Leaves
  visible space for the Phase 3 ratings panel.
- `/professor/[slug]` - courses taught, sections by term. Space reserved for
  Phase 3 ratings.
- `/explore` - browse/filter by subject, faculty, campus, level

Search in Phase 1 is Postgres `ILIKE`/trigram over course code and title.
Postgres full-text or a dedicated search service only when that measurably
falls short.

---

## 7. Testing

Proportionate, not ceremonial:

- **Scraper parsers** - the real tests. Parse saved HTML fixtures from §6.1 into
  expected structured output. These catch UBC markup changes, which is the
  failure mode that actually matters. No network in tests.
- **Instructor name normalisation** - unit tests over the known-messy name
  variants.
- **Upsert idempotency** - one integration test: run the same fixture twice,
  assert no duplicate rows.
- **Pages** - smoke-level only. No component-level test suite for read-only
  pages in Phase 1.

---

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Scraper method unresolved (§3.2) | Blocks the phase | Spike first (§6.1); Playwright fallback |
| UBC changes markup again | Silent data loss | Fixture tests + 80% row-count abort guard |
| Instructor name collisions | Wrong ratings in P3 | Slug normalisation + manual review queue |
| Scraping ToS posture | Project risk | Public unauthenticated pages only; never CWL; rate-limited; identified UA |
| Vercel function limits on full scrape | Scrape fails | Move to GitHub Actions cron when measured |

**Cold start (out of scope but real):** UW Flow's value is ~100k reviews, not its
code. A ratings site with no ratings is worthless. Phase 1 producing a complete,
accurate catalogue is what makes the site useful enough to attract the first
reviewers - treat catalogue completeness as a growth feature, not just plumbing.

---

## 9. Open questions

1. **Campus scope.** Vancouver only for v1, or Vancouver + Okanagan? Schema
   supports both; scraping both roughly doubles scrape time and data volume.
   *Recommendation: Vancouver only for v1, Okanagan once the pipeline is proven.*
2. **Term history depth.** How many past terms to ingest? Ratings reference
   terms, and grade distributions (Phase 5) are inherently historical.
   *Recommendation: current + next + two years back.*
