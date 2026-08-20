# UBC Flow — Phase 5: Grade Distributions (Design)

**Date:** 2026-08-20
**Status:** Approved for planning
**Phase:** 5 of 6
**Depends on:** [Phase 1: Foundation](2026-08-19-ubc-flow-foundation-design.md) · [Phase 2: Accounts + Workday Import](2026-08-19-phase-2-accounts-workday-import-design.md) · [Phase 3: Ratings and Reviews](2026-08-19-phase-3-ratings-design.md) · [Phase 4: Schedule Planner](2026-08-20-phase-4-schedule-planner-design.md) — all merged

## 1. Why this phase exists

This is the differentiator identified in the project's very first design pass:
**UBC publishes historical grade distributions and Waterloo does not**, so UW Flow
structurally cannot offer this feature no matter how mature it gets.

It is also the phase that makes Phase 3's professor pages meaningfully better. The
source data carries a `Professor` name on every section, so grades attach to
instructors, not just courses — which sits directly alongside the subjective
ratings already on those pages.

**Done when:** a student can open a course and see its real historical grade
distribution, and open a professor and see their historical average — with
suppressed data honestly labelled rather than hidden or guessed at.

---

## 2. Data source

CSVs from [`DonneyF/ubc-pair-grade-data`](https://github.com/DonneyF/ubc-pair-grade-data),
fetched from `raw.githubusercontent.com`.

**Verified live during design (2026-08-20)**, not assumed:

- Repo last updated **June 2026** — actively maintained, not abandoned.
- Path shape: `tableau-dashboard-v2/UBCV/<YEARSESSION>/UBCV-<YEARSESSION>-<SUBJECT>.csv`
- Sessions available in the current format: `2021S` through `2025W` (10 directories).
- A real fetch of `UBCV-2025W-CPSC.csv` returned 128 rows with this header:

```
Campus,Year,Session,Subject,Course,Detail,Section,Title,Professor,
Reported,Avg,Median,Percentile (25),Percentile (75),High,Low,
<50,50-54,55-59,60-63,64-67,68-71,72-75,76-79,80-84,85-89,90-100
```

### 2.1 Scope: current format only

Only `tableau-dashboard-v2` (2021S–2025W) is ingested. Two older formats exist in
the same repo and are **deliberately excluded**:

- They use different columns and an `OVERALL` row convention that would each need
  their own parser.
- The repo's own README documents that **grade data from 2017W was modified
  between June and December 2019** — a known-corrupt window we would be knowingly
  importing.

One format means one parser and one set of quirks, for the five most recent years,
which is the span students actually care about.

### 2.2 This is a community mirror, and must be credited as one

This repo is one volunteer's scrape of UBC's internal Tableau dashboard. It carries
**no license file**. That has two consequences the implementation must honour:

1. **Attribution is required, not optional.** Any page displaying grade data credits
   the source and links the repository. Presenting scraped-and-mirrored data as
   though it were our own would be both dishonest and inconsiderate to whoever
   maintains it.
2. **Politeness.** The ingest job reuses the existing rate-limited `fetchText` and
   its identifying User-Agent, exactly as the Phase 1 scraper does.

**Accepted risk:** if the upstream repo disappears or stops updating, our data
freezes at whatever was last ingested. That is a stale-data problem, not a broken-
site problem — already-ingested distributions keep working. Judged acceptable
versus reverse-engineering UBC's Tableau dashboard directly, which is hostile to
scraping and would need its own Phase-1-scale spike.

---

## 3. Schema

The Phase 1 `GradeDistribution` stub is used nearly as-is, with **one necessary
change**.

### 3.1 Add `sectionCode` and a uniqueness constraint

As stubbed, nothing identifies a row uniquely, so **re-running the ingest would
duplicate every row**. Every other ingest in this codebase is an idempotent upsert
(Phase 1's sections, Phase 2's enrollments); this one must be too.

```prisma
model GradeDistribution {
  id           String  @id @default(cuid())
  courseId     String
  instructorId String?
  termId       String?
  sectionCode  String            // NEW
  detail       String?           // NEW — see 4.2
  average      Float?
  median       Float?
  high         Float?
  low          Float?
  count        Int?
  distribution Json?

  @@unique([courseId, termId, sectionCode, detail])
  @@index([courseId])
  @@index([instructorId])
}
```

**`instructorId` is deliberately not part of the unique key.** It is nullable
(§5 — a professor may not match), and including a nullable column in a compound
unique key caused a real, caught problem in Phase 3 with `InstructorReview.courseId`.
The section identity is `(course, term, section, detail)`; the instructor is an
attribute of that section, not part of what makes it unique.

`@@index([instructorId])` is added because the professor page queries by it.

### 3.2 `distribution` keeps nulls

The 11 grade buckets are stored as-is in the `Json?` column, **including nulls**.
A suppressed bucket (§6) and a genuine zero are different facts and must stay
distinguishable — collapsing nulls to zero would silently invent data.

---

## 4. Parsing

A pure function `parseGradeCsv(text: string): RawGradeRow[]`, following the pattern
every prior phase used (Phase 1's node parsers, Phase 3's aggregation, Phase 4's
ICS generation): no I/O, no database, unit-tested against a committed fixture.

### 4.1 The `<50` column is a count, not a percentage

The first grade bucket is literally named `<50` and holds **the number of students
who scored below 50** — not a percentage and not a pass rate. In the real CPSC 2025W
data one section shows `54` in this column against `221` reported students. Reading
it as a percentage would produce confidently wrong failure rates.

### 4.2 `Detail` is part of section identity

`Detail` is empty on most rows but distinguishes cross-listed or split variants of
the same section. Two rows can share `(Course, Section)` and differ only by
`Detail`, so it belongs in the uniqueness key (§3.1) rather than being discarded.

### 4.3 Numbers may be blank

Suppressed and unavailable values arrive as empty strings. These parse to `null`,
never to `0`.

---

## 5. Matching professors to our Instructor table

The CSV's `Professor` column is a name string from a *different source* than the
`Instructor` table, which Phase 1 built from UBC's course API. Names will not always
agree — `"Firas Moosvi"` versus `"Moosvi, Firas"`, or a middle initial present in
one source only.

**Rule: normalize, match exactly, report misses.**

Phase 1's existing `normalizeInstructorName` already handles `Last, First` ordering
and diacritics and produces a slug. Reuse it — do not write a second name parser —
and match that slug against `Instructor.slug`.

A row whose professor does not match is **still ingested**, with `instructorId`
left null: the course-level distribution is correct regardless of whether we can
attribute it to a specific instructor. Unmatched names are counted and reported by
the job, never silently dropped — the same posture as the Workday importer's
unmatched courses in Phase 2.

**Fuzzy matching is explicitly rejected.** Attaching one professor's grades to a
different person with a similar name is materially worse than showing no attribution
at all, and this data is about individuals' teaching records.

---

## 6. Suppressed data

UBC nulls any grade bucket with fewer than 6 students, for privacy. Some sections
therefore have incomplete distributions.

**Rule: show what exists, label the gap.** Where buckets are suppressed, display the
average and median — which UBC still publishes — and state plainly that the detailed
breakdown is partially suppressed.

Explicitly forbidden: inferring, interpolating, or curve-fitting suppressed buckets.
The privacy suppression exists for a reason, and a reconstructed bucket would be a
fabricated number presented with the same confidence as a real one.

---

## 7. Display

Two surfaces, both chosen deliberately:

- **Course page** (`/course/[code]`) — the overall average across recent sections and
  a bar chart of the aggregate distribution.
- **Professor page** (`/professor/[slug]`) — that instructor's historical average
  across the courses they taught, next to the subjective ratings Phase 3 added.

Both credit the data source (§2.2).

**The chart is hand-rolled with CSS.** Eleven bars need no charting library, matching
the reasoning that kept ICS generation dependency-free in Phase 4. No `recharts`, no
`chart.js`.

**Empty state:** a course or professor with no grade data shows an explicit "no grade
data available" message — never a zero average, which would read as everyone failing.
This is the same rule Phase 3 applied to courses with no reviews.

---

## 8. Architecture

Continues the established monolith. No new services, no new dependencies.

```
prisma/schema.prisma            — GradeDistribution gains sectionCode/detail + keys
src/grades/parse-csv.ts         — PURE: CSV text -> RawGradeRow[]
src/grades/aggregate.ts         — PURE: rows -> course/instructor summaries
src/grades/jobs/ingest.ts       — fetch + match + idempotent upsert
src/grades/jobs/ingest.run.ts   — CLI entrypoint (matches Phase 1's *.run.ts pattern)
src/components/GradeChart.tsx   — CSS bar chart
src/app/course/[code]/page.tsx  — MODIFY: distribution section
src/app/professor/[slug]/page.tsx — MODIFY: average section
```

---

## 9. Correctness requirements

| Area | Requirement |
|---|---|
| Idempotency | Re-running ingest must not duplicate rows. Upsert on `(courseId, termId, sectionCode, detail)`. |
| Suppressed data | Nulls stay null. Never inferred, interpolated, or rendered as zero. |
| Attribution | Any page showing grade data credits the source repo. |
| Instructor matching | Exact match on normalized slug only. Never fuzzy. Unmatched rows still ingest with a null `instructorId` and are reported. |
| `<50` semantics | Treated as a student count, never a percentage. |
| Politeness | Fetches go through the existing rate-limited `fetchText`. |
| Empty state | No data shows an explicit message, never `0.0`. |

---

## 10. Out of scope

- **Per-instructor breakdown on the course page** and **grades in the planner
  sidebar** — both were considered and declined for this phase. Easy to add later;
  the data model supports both.
- Older data formats (§2.1), including the known-corrupt 2017W window.
- UBC Okanagan (`UBCO` exists in the source; the whole app is Vancouver-only for v1).
- Any statistical inference over suppressed buckets (§6).
- Prerequisite trees — Phase 6.
