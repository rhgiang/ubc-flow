# UBC Flow — Course & Professor Page Redesign + Historical Grades (Design)

**Date:** 2026-08-22
**Status:** Approved for planning

## 1. Why this phase exists

The course and professor pages are still the plain, functional layouts from Phases 3-6 — real data, but none of the visual/informational density of a mature course-review site. This phase rebuilds both pages to match UW Flow's actual course/professor page feature set closely (within our own theme, not their colors), and adds a second, independent grade data source (historical multi-year averages) alongside the existing Phase 5 distribution chart.

**Done when:** a student opens a course page and sees, in one place: the real description, a liked/useful/easy ratings box with a click-to-reveal 1-5 distribution, the existing grade distribution chart with historical averages beneath it, a collapsible schedule for the current academic year, a full prerequisite/corequisite/antirequisite/leads-to box, and both course and professor reviews — and the professor page shows the same ratings box with reviews grouped by course taught.

---

## 2. Research this spec is grounded in

Both reference pages were loaded live and interacted with (not guessed from memory):

- `https://uwflow.com/course/cs115` — full page, including clicking the distribution-popover icon.
- `https://uwflow.com/professor/john-paul_pretti` — reached via a real in-page link, not a guessed slug.
- `https://ubcgrades.com` — real API responses pulled directly:
  - `GET /api/v2/course-statistics/UBCV/CPSC/110` → `{"average":74.33,"average_past_5_yrs":74.93,"campus":"UBCV","course":"110","course_title":"Computation, Programs, and Programming","detail":"","faculty_title":"Faculty of Science","max_course_avg":91,"min_course_avg":64.07,"stdev":19.16,"subject":"CPSC","subject_title":"Computer Science"}`
  - `GET /api/v2/course-statistics/distributions/UBCV/CPSC/110` → an array of per-year/session bucket objects back to **2009** (deeper history than our own Phase 5 data, which starts at 2021).

**Same author as our existing Phase 5 source.** UBCGrades.com's footer credits Donney Fan — the same person behind `DonneyF/ubc-pair-grade-data`, our existing grade-distribution source. This is a genuinely public, unauthenticated, versioned JSON API (not HTML scraping), which is why this phase can add it without a scraping spike.

---

## 3. Two grade sections, deliberately not merged

UBCGrades' distribution buckets are ten uniform ranges (`0-9%`, `10-19%`, … `90-100%`) plus a redundant `<50%` sum. Our existing Phase 5 chart uses UBC's own real, narrower buckets (`<50`, `50-54`, `55-59`, …). These are two different discretizations of the same underlying idea — overlaying them on one chart would misrepresent both.

- **Grade Distribution** (existing, unchanged data source) stays exactly as Phase 5 built it — the per-bucket bar chart, suppressed buckets visually distinct from zero.
- **Historical Averages** (new) is a separate subsection directly beneath it, showing the summary numbers only: overall average, 5-year average, min/max section average, standard deviation. No bucket chart for this source — headline numbers only, which sidesteps the format mismatch entirely.

Both sections move to sit **directly above Course Schedule** (currently "Grades" sits between Ratings and Sections — this keeps that relative position, just formalizes "Sections" as the redesigned "Course Schedule" block immediately below it).

### 3.1 New data

```prisma
model CourseHistoricalGrades {
  courseId          String   @id
  course             Course   @relation(fields: [courseId], references: [id], onDelete: Cascade)
  average            Float?
  averagePast5Years  Float?
  minSectionAverage  Float?
  maxSectionAverage  Float?
  stddev             Float?
  updatedAt          DateTime @updatedAt
}
```

One row per course, upserted by a new ingest job hitting `GET /api/v2/course-statistics/{campus}/{subject}/{course}` — one request per course (~7337 courses; the existing rate-limited `fetchText` gets reused, so this is politely paced exactly like every other scrape job). A course with no grade history returns an empty/error response from the API, which the job treats as "no row for this course" — not an error, not a zero.

---

## 4. Antirequisites and "leads to" — the sidebar's missing halves

Both come from data Phase 6 already touches but doesn't expose.

### 4.1 Antirequisites

Phase 6's parser currently **discards** `Equivalency:` clauses entirely (they're not prerequisites, so asserting them as one would be wrong). This phase keeps that reasoning intact but stops throwing the data away — it's genuinely useful information, just not prerequisite information.

```prisma
  // on Course, alongside prereqTree/coreqTree
  antireqCodes  Json?   // string[] of resolved-or-not course refs, same shape as a flat Requirement course list
```

Parsed with the same code-extraction regex Phase 6 already has, resolved with the same campus-aware resolver — no new parsing logic invented, just applied to a field that used to be dropped.

### 4.2 "Leads to" (reverse lookup)

Scanning every course's `prereqTree` JSON on every page view to answer "who requires me?" doesn't scale. Instead, the *same* tree-walk `enrich:prereqs` already performs (Phase 6's `buildRequirementTrees`) also writes a flat edge for every resolved course reference it encounters:

```prisma
model CoursePrereqEdge {
  courseId          String  // the course whose tree was walked
  course            Course  @relation("PrereqEdgeFrom", fields: [courseId], references: [id], onDelete: Cascade)
  requiredCourseId  String  // a course referenced somewhere in courseId's tree
  requiredCourse    Course  @relation("PrereqEdgeTo", fields: [requiredCourseId], references: [id], onDelete: Cascade)

  @@id([courseId, requiredCourseId])
  @@index([requiredCourseId])
}
```

"Leads to" for course X is then `SELECT courseId FROM CoursePrereqEdge WHERE requiredCourseId = X` — an indexed point lookup, computed once per `enrich:prereqs` run rather than per page view.

---

## 5. Course page, section by section

1. **Header** — subject name, course code, title, credits. Our existing dark/light theme banner styling, not UW Flow's literal navy/orange — same information density and layout, our palette.
2. **Description** — the now-correctly-parsed plain text (§7 below covers the bug this fixes).
3. **Ratings box** — recreated closely:
   - A circular "liked %" progress ring (reuses `aggregateCourseReviews`'s existing `likedPercent`).
   - Useful / Easy as horizontal bars, each with a small chart-icon button. **Percentage convention for this box only:** `(mean − 1) / 4 × 100`, matching UW Flow's own math (verified: their displayed "12%" for a 1.48/5 mean checks out exactly against that formula) — a deliberate exception to this app's existing `X.X/5` convention used elsewhere (Explore table, current stat cards), which stays as-is. Two different components, two different appropriate conventions; not proposing to change Explore.
   - Clicking the chart-icon reveals a popover: a 1-5 histogram of that specific metric's raw ratings, bar length + count per star value. This requires storing/reading the raw per-star counts, which `aggregateCourseReviews` doesn't currently expose (it only returns the mean) — the aggregate function gains a `histogram: Record<1|2|3|4|5, number>` per metric.
   - Review count and rating count are **the same number** in our schema (a review row is always a rating — we have no quick-rate-without-writing action, unlike UW Flow's separate "146 comments" vs "2301 ratings"). Building that split interaction is out of scope (§9).
   - "Add your review" — links to the existing `/course/[code]/review` route (already built in Phase 3); this box just adds the inviting entry-point card UW Flow has, not a new form.
4. **Grades** — Grade Distribution (existing) then Historical Averages (new), per §3.
5. **Course Schedule** — collapsible (starts expanded, toggle to collapse), tabbed by term. Tabs are limited to **the current academic year's terms** (Summer/Winter T1/Winter T2 of the current year) — reusing `isPlannableTerm`, the same rule the schedule planner already uses, rather than inventing a second "which terms count as current" definition. Per-section rows: section code, activity, enrolled/cap (already on `Section`), meeting times, and the existing "Add to schedule" action (reused from the course page's current Sections table, not rebuilt).
6. **Prerequisites / Corequisites / Antirequisites / Leads to** — a sidebar box using the existing `RequirementTree` renderer for prereq/coreq, plus two new flat linked lists for antireq/leads-to. "No prerequisites" / "No corequisites" / etc. shown explicitly when empty, matching this app's established empty-state convention.
7. **Course reviews / Professor reviews tabs** — "Course reviews (N)" queries `CourseReview` as today; "Professor reviews (N)" queries `InstructorReview WHERE courseId = this course` (the schema already supports this — `InstructorReview.courseId` exists precisely for this). Sort by most recent (existing `createdAt`). "Filter by professor" on the course-reviews tab is **not** included — `CourseReview` has no instructor association to filter by (out of scope, §9). Review cards get a generic colored anonymous icon (§6) instead of UW Flow's placeholder cat photos.

---

## 6. Review card avatars

A small set of fixed background colors, deterministically chosen per review (hashed from the review's `id`, so the same review always renders the same color across visits — not random per render) — a plain silhouette/initial glyph on top, not a real image. Explicitly a placeholder: designed to be swapped for a real avatar system later without changing the review card's layout.

---

## 7. Bug already fixed: raw HTML in descriptions

Confirmed and fixed during this spec's research, not deferred: every course's `description` field was still raw HTML (`<p>...</p>`) because `scrape:descriptions` — the job that strips it via Cheerio — had not been re-run since the last full catalogue re-scrape reset the field back to raw. The parser itself was already correct (verified: `parseBody()` on the real stored CPSC 110 string produces clean text). Ran `scrape:descriptions` then `enrich:prereqs` (to keep `prereqTree` in sync, since it derives from the same-job-computed `prereqText`) — zero raw-HTML descriptions remain across the whole catalogue (verified directly against the database).

---

## 8. Professor page

Mirrors the course page's ratings box exactly (Clear/Engaging instead of Useful/Easy — already our schema's real field names), with review/rating counts. Below that: reviews **grouped by course taught**, sortable ("most reviews" per course, matching UW Flow), each group showing that course's own liked% and its reviews — using `InstructorReview` grouped by `courseId`, joined to `Course` for the header. No schedule, no prerequisite box — professors aren't tied to a single course's requirements.

---

## 9. Explicit scope decisions

| Feature seen on UW Flow | Decision | Why |
|---|---|---|
| Antirequisites | **In** | Data we already touch and currently discard (§4.1). |
| "Leads to" | **In** | New reverse-index table, built in the existing tree-walk (§4.2). |
| Search Reddit button | **In** | Pure external link (`reddit.com/r/UBC/search?q=<CODE>`), no backend work. |
| Favorite/star icon | **Out** | Needs a new saved-courses feature nothing else reads yet; schedules already cover "courses I care about." |
| Review-card avatars | **In, as placeholders** | Deterministic colored icon now; explicitly designed to be swapped for real images later. |
| Separate "ratings" vs "reviews" counts | **Out** | Requires a new quick-rate-without-writing interaction our schema doesn't have. Both counts show the same number. |
| Per-review helpfulness voting (👍 counters) | **Out** | New schema (a vote table) for a feature not in the original request list. |
| "Filter course reviews by professor" | **Out** | `CourseReview` has no instructor association to filter by. |
| Grade Distribution + Historical Averages merged into one chart | **Out** | Incompatible bucket granularities (§3) — shown as two separate, honestly-labeled sections instead. |

---

## 10. Architecture

```
prisma/schema.prisma                        — CourseHistoricalGrades, CoursePrereqEdge, Course.antireqCodes
src/grades/jobs/ingest-historical.ts        — fetch + upsert CourseHistoricalGrades (UBCGrades API)
src/grades/jobs/ingest-historical.run.ts    — CLI entrypoint
src/prereqs/parse.ts                        — MODIFY: capture Equivalency codes instead of discarding
src/prereqs/jobs/build.ts                   — MODIFY: also write CoursePrereqEdge rows during the tree walk
src/reviews/aggregate.ts                    — MODIFY: add per-metric 1-5 histograms
src/components/RatingsBox.tsx               — NEW: donut + bars + click-to-reveal histogram popover
src/components/CourseScheduleBox.tsx        — NEW: collapsible, term-tabbed schedule
src/components/RequirementSidebar.tsx       — NEW: prereq/coreq/antireq/leads-to box
src/components/ReviewCard.tsx               — NEW: shared review card with placeholder avatar
src/components/HistoricalGrades.tsx         — NEW: summary-stats display beneath GradeChart
src/app/course/[code]/page.tsx              — MODIFY: reassembled per §5
src/app/professor/[slug]/page.tsx           — MODIFY: reassembled per §8
package.json                                — ingest:historical-grades script
```

No new dependencies — same hand-rolled-UI, no-charting-library discipline as every prior phase.

---

## 11. Out of scope

- Everything in §9's "Out" column.
- UBCGrades' distributions endpoint (per-year bucket history back to 2009) — only the summary-statistics endpoint is used. The deeper distribution history is a real future enhancement, not part of this phase.
- Reworking the Explore table's existing `X.X/5` convention — untouched, per §5.3.
