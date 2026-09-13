# UBC Flow - Schedule Builder Redesign (Design)

**Date:** 2026-08-22
**Status:** Approved for planning

## 1. Why this phase exists

The schedule planner shipped in Phase 4 as a functional two-column form: a search box, a plain weekly grid, and a list of sections. It works, but it uses a fraction of the page, it looks nothing like the tools students actually plan in, and it exposes none of the course intelligence this app already has - grades, prerequisites, professor quality - at the exact moment a student is deciding what to register for.

This phase rebuilds the planner into a full-page scheduling tool modelled on **Workday's Edit Saved Schedule** screen (the interaction model UBC students already know) with the **visual language of Notion Calendar** (clean hairline grid, soft blocks, generous whitespace), and wires the app's existing course data into it through a single course-information overlay.

**Done when:** a student can open the builder full-screen, import their real Workday schedule from an `.xlsx` in one step, search courses with results appearing as they type, see their week rendered as a calendar that looks like a modern calendar app, click any block or ⓘ button to get a course overlay showing description, sections, grade distribution, historical averages and each instructor's RateMyProfessors score, and save - without ever leaving the page.

---

## 2. Current state this replaces

Two separate implementations exist today, and the requested feature set (Save beside Delete, calendar-subscribe bar, one builder) only makes sense against one of them:

| Surface | File | Persistence | Has |
|---|---|---|---|
| Guest builder | `src/components/ScheduleBuilder.tsx` (215 ln) | client state, `saveGuestSchedule` at the end | search, WeekGrid, section list |
| Saved editor | `src/app/schedule/[id]/page.tsx` (268 ln) | server actions per mutation | rename, **delete**, add/remove, **"Add to your calendar"** bar |

They diverged because the guest flow was added later (build-before-signup). Keeping both means every feature below gets built twice, so **this phase unifies them** and deletes the duplicate editor.

Reusable as-is (no changes needed): `src/upload/read-grid.ts`, `src/upload/parse-workday.ts`, `src/schedule/conflicts.ts`, `src/components/GradeChart.tsx`, `src/components/HistoricalGradesTimeline.tsx`, `src/lib/search.ts:searchSectionsForTerm`.

---

## 3. Unified builder architecture

One client component, `ScheduleBuilder`, serves both routes:

- `/schedule/new` - draft mode (guest or signed-in, nothing persisted yet)
- `/schedule/[id]` - saved mode (loads existing sections)

```ts
type BuilderMode =
  | { kind: 'draft' }
  | { kind: 'saved'; scheduleId: string };
```

### 3.1 Buffered edits, explicit Save

**Both modes hold the working section set in client state and commit only on Save.** This is deliberate and differs from today's saved editor, which writes through on every add/remove.

Three reasons:
1. It matches Workday, which the UI is modelled on - its builder has an explicit **Save** / **Cancel** pair.
2. It gives one rendering path and one mutation path for both modes, which is the entire point of unifying.
3. Workday import (§7) drops 5-12 sections in at once; write-through would fire a burst of mutations for edits the student hasn't agreed to yet.

Commit behaviour:
- **draft** → `saveGuestSchedule(termId, name, sectionIds)` (exists), then redirect to `/schedule/[id]`
- **saved** → new `replaceScheduleSections(scheduleId, name, sectionIds)` server action, diffing against what's stored

**Save is enabled only when the schedule has at least one section** and a non-empty name - as requested.

The cost of buffering is that navigating away loses edits, so a `beforeunload` guard is registered whenever the buffer is dirty. This is a real requirement, not polish: without it the import flow can silently discard a student's whole imported schedule.

### 3.2 Deletions

`/schedule/[id]`'s server-rendered page shrinks to a thin loader that fetches the schedule + sections and renders `<ScheduleBuilder mode={{kind:'saved',...}} />`. Its inline rename form, add/remove forms and calendar section are deleted - all of it now lives in the builder.

---

## 4. Layout

The page goes full-bleed (today's `mx-auto max-w-6xl` is the main reason it "doesn't use the page").

```
┌────────────────────────────────────────────────────────────────┐
│ [Schedule name        ]  [Term ▾]      [Save]  [Delete Schedule]│
│  Academic Period: 2026-27 Winter Term 1      [Add to calendar ▾]│
├──────────────────┬─────────────────────────────────────────────┤
│ Saved Courses ▏ Find Courses                                    │
│ ─────────────────│   ┌───────────────────────────────────────┐ │
│ Total Courses: 5 │   │  untimed / async strip                │ │
│                  │   ├───────────────────────────────────────┤ │
│ ┌──────────────┐ │   │      Mon   Tue   Wed   Thu   Fri      │ │
│ │ BIOL 121   ▾ │ │   │ 9AM                                   │ │
│ │ 3 credits    │ │   │10AM  ▐MATH 200                        │ │
│ └──────────────┘ │   │11AM                                   │ │
│ ┌──────────────┐ │   │12PM        ▐CPSC 110                  │ │
│ │ CPSC 110   ▾ │ │   │ 1PM                                   │ │
│ └──────────────┘ │   └───────────────────────────────────────┘ │
└──────────────────┴─────────────────────────────────────────────┘
```

- Left panel: fixed `340px`, own scroll region.
- Calendar: flexes to fill remaining width, own scroll region.
- Below `lg`, the panel stacks above the calendar.
- Header actions sit top-right; **"Add to calendar"** becomes a compact dropdown button directly beneath Save/Delete, replacing today's full-width `<h2>Add to your calendar</h2>` block. The dropdown contains Apple/Outlook (`webcal://`), Google, and copy-URL - the same three destinations, same `getSubscribeUrl` action, just condensed.

### 4.1 Draft mode hides what cannot exist yet

**Delete Schedule** and **Add to calendar** both require a persisted schedule - `getSubscribeUrl` mints a token against a `scheduleId`, and there is nothing to delete before the first save. In draft mode both controls are hidden (not disabled-and-mysterious), leaving Save alone in the header, and they appear once the schedule has been saved and the route becomes `/schedule/[id]`.

---

## 5. Left panel

Two tabs, mirroring Workday.

### 5.1 Saved Courses

Sections currently in the buffer, **grouped by course** and collapsible (matching the screenshot's card-per-course with a chevron). Each card shows course code + title and credits; expanding reveals its sections with activity, time, location, instructor, a remove control and an ⓘ button.

Workday's cards also show a "Grading Basis" line. **We do not have that field** - `Section` carries `activity`, `status`, `deliveryMode`, `enrolTotal` and `enrolCap`, and nothing in the catalogue scrape supplies grading basis. It is omitted rather than faked.

A "Total Courses: N" count sits above the list, as in Workday.

### 5.2 Find Courses

**Search queries as you type** - the current implementation requires submitting a form, which is the specific complaint. Debounced at 200 ms with request cancellation, reusing the exact idiom already proven in `src/components/SearchBar.tsx` (`DEBOUNCE_MS`, `cancelled` flag in the effect cleanup). Backed by the existing `searchSections` action.

Results group by course rather than listing raw sections (today's flat list repeats "CPSC 110" once per section). Expanding a course shows its sections; each has add + ⓘ. Sections already in the buffer render as "Added" and are not re-addable.

Term-scoped, as today - searching is always within the selected term.

---

## 6. Calendar

New `ScheduleCalendar` client component replaces `WeekGrid` (which is server-rendered, hardcodes `slate`/`blue` outside the theme, and has no interaction).

**Notion Calendar visual treatment:** hairline 1px grid in `--border`, hour labels right-aligned in a narrow gutter, soft `rounded` event blocks with a saturated left accent bar and a tinted body, generous internal padding, and a current-time indicator line (only when viewing the term that contains today).

**Per-course colour** is assigned deterministically by hashing the course code into a fixed palette, so a course keeps its colour across reloads and between the calendar and the left panel. This reuses the deterministic-hash approach already established by `ReviewCard`'s placeholder avatars rather than inventing a second scheme. The palette is defined as theme tokens so it works in light and dark.

**Interaction:**
- Click a block → opens the course info overlay (§7) for that section's course
- Hover a block → reveals a remove (×) control
- Conflicting blocks keep the existing advisory treatment (rendered, never hidden - `findConflicts` is unchanged) restyled to the new palette
- Untimed / async sections render in a strip above the grid, matching the yellow full-width bar in Workday, instead of today's plain sentence beneath it

---

## 7. Course information overlay

One component, `CourseInfoOverlay`, opened from three places: the ⓘ in Find Courses, the ⓘ in Saved Courses, and clicking a calendar block. **Always an overlay, never a redirect** - with a "View full course page →" link for students who do want the full page.

Data is fetched on demand by a new `getCourseDetail(courseId)` server action and cached per course in client state, so reopening is instant and the builder page's initial load stays cheap.

Contents:

| Block | Source | Notes |
|---|---|---|
| Header | `Course` | code, title, credits, description |
| Sections | `Section` + `MeetingTime` + `SectionInstructor` | times, location, seats, instructors, add/remove inline |
| Instructor ratings | `InstructorReview` (ours) + an RMP link-out | our own verified-enrolment ratings; RMP data is **not** ingested - see the §9 supersession note |
| Grade distribution | `GradeDistribution` | reuses `GradeChart` unchanged |
| Historical averages | `CourseHistoricalGrades` + `…ByTerm` | reuses `HistoricalGradesTimeline` + summary stats |
| Requirements | `prereqTree` / `coreqTree` | reuses `RequirementTree` |

`GradeChart` and `HistoricalGradesTimeline` are pure server-safe components with no `'use client'`, so they can be rendered inside the overlay unchanged. Both currently use raw `blue-700`/`slate-*` classes; they get converted to theme tokens as part of this phase so the overlay isn't visually inconsistent with the rest of the redesigned page.

---

## 8. Import from Workday

`/schedule`'s primary button is renamed **"Create Saved Schedule" → "Build Schedule"**, with a second button **"Import from Workday"** beside it.

"Import from Workday" opens an overlay with the export instructions (Workday → Academics → **View My Courses** → Export to Excel - the same copy already written in `UploadCoursesForm`), an `.xlsx` file input, and a result summary.

### 8.1 A separate path from `/api/upload`, deliberately

The existing upload endpoint parses the file **and** writes `Enrollment` rows, binds `studentIdHash`, and sets `verifiedAt`. That is correct for account verification and wrong for schedule import: a student trying out the builder - possibly not even signed in - should not have their identity bound as a side effect of previewing a timetable.

So this phase adds a **parse-and-match-only** server action:

```ts
parseWorkdayForSchedule(formData): Promise<{
  termId: string | null;
  matched: SectionHit[];
  unmatched: string[];      // "CPSC 110-103" rows with no Section row
}>
```

It writes nothing. It reuses `readWorkbookGrid` and `parseWorkdayExport` **unchanged**, then matches each parsed row to a `Section` on `(subject.code, course.number, sectionCode, termId)`.

All three inputs are already produced by the existing parser and verified against a real export:

```
"MATH_V 200 - Calculus III" + section "MATH_V 200-103 - Calculus III"
  → subjectCode MATH, number 200, sectionCode "103"
  → term inferred from meeting start date 2026-09-09 → 2026W Term 1
```

Matched sections load into the builder's buffer; the term selector switches to the file's term. Unmatched rows are listed by name in the overlay - never dropped silently, consistent with the rule the enrollment importer already follows.

### 8.2 Known gap this exposes

While validating the parser against a real export, the result panel was found to report all three exclusion reasons (`transfer_credit`, `unparseable_course`, `no_term`) as "Skipped N transfer credits", and never names the affected courses. That is a pre-existing reporting bug in `UploadCoursesForm`, not caused by this phase. The import overlay must not repeat it: it reports each excluded row **with its course name and its actual reason**.

---

## 9. RateMyProfessors ratings

> **SUPERSEDED - 2026-08-23. The ingest described below was NOT built and must not be.**
>
> The §9.1 spike ran; findings in `docs/superpowers/notes/2026-08-23-ratemyprofessors-spike.md`.
> Every technical question came back positive - unauthenticated GraphQL, 5,372 UBC professors,
> all needed fields, and an 85.7% name match with **zero** ambiguity over a 300-professor
> sample. The blocker is policy, not capability: `ratemyprofessors.com/robots.txt` is
> `User-agent: *` / `Disallow: /` with carve-outs only for named search crawlers, and it
> separately blocks AI bots by name. `/graphql` is unmentioned, so the wildcard covers it. An
> unauthenticated endpoint is their own app's backend, not permission.
>
> **What was built instead** (see `docs/superpowers/plans/2026-08-23-phase-5-instructor-ratings.md`):
> §9.4's link-out - an RMP *search* URL built from the instructor's name, with the app making
> zero requests - alongside our own `InstructorReview` data surfaced in the course overlay via
> the existing `aggregateInstructorReviews`. No `InstructorRating` model, no ingest job.
>
> §§9.2, 9.3 and 9.5 below are retained as a record of the design that was evaluated and
> rejected. Do not implement them. Revisit only via a licensed feed from RMP.

New subsystem. RMP publishes no public API, so this is the highest-risk item in the phase and is sequenced last.

### 9.1 Spike gate

**Phase 5 of the plan opens with a spike, not with implementation.** The spike answers, against the live service: is the GraphQL endpoint reachable server-side, what authorization does it require, can UBC (school 1413) teachers be enumerated, and what fields come back. Its output is a findings note under `docs/superpowers/notes/`, and it is allowed to conclude "not viable" - in which case the UI falls back to the link-out treatment described in §9.4 and the model below is not built.

The design below is what gets implemented **if** the spike succeeds.

### 9.2 Data

```prisma
model InstructorRating {
  instructorId   String   @id
  instructor     Instructor @relation(fields: [instructorId], references: [id], onDelete: Cascade)
  rmpLegacyId    String?  @unique
  avgRating      Float?
  avgDifficulty  Float?
  wouldTakeAgain Float?
  numRatings     Int      @default(0)
  rmpUrl         String?
  /** 'exact' | 'normalized' - how the RMP name was matched to ours. */
  matchQuality   String
  updatedAt      DateTime @updatedAt
}
```

### 9.3 Name matching, and refusing to guess

UBC's instructor names and RMP's are entered by different people and do not reliably agree. The ingest normalizes both sides (lowercase, strip accents, punctuation and middle initials) and matches on first + last name.

**A name that matches more than one `Instructor`, or none, is skipped and counted - never assigned to a best guess.** Attaching a stranger's teaching rating to a named real person is the worst failure mode available here, and it is worse than showing nothing. Only `exact` and `normalized` matches are stored, and `matchQuality` is retained so the UI can suppress weaker matches later without a re-ingest.

### 9.4 Display, and degradation

In the overlay, each instructor shows rating, difficulty, would-take-again and rating count, with a link to their RMP page. Any instructor without a row - no match, spike failed, or job never run - renders a neutral "No rating available" with a search link to RMP. **The overlay must be fully usable with the entire `InstructorRating` table empty**, which is also how Phases 1-4 are able to ship before this one.

### 9.5 Operational notes

Run as `npm run ingest:rmp`, rate-limited through the existing `src/scrape/http.ts` helper like every other job, re-runnable, and upserting. It is an unofficial endpoint and may break without notice; the job must fail loudly and leave existing rows intact rather than blanking them.

---

## 10. Phasing

Each phase is independently shippable and leaves the app working.

1. **Unified builder shell** - merge the two surfaces, full-bleed layout, tabbed left panel, live-as-you-type search, buffered Save/Delete, condensed calendar-subscribe dropdown. Deletes the duplicate editor.
2. **Calendar** - `ScheduleCalendar` with Notion styling, per-course colour, click and remove, untimed strip.
3. **Course info overlay** - `getCourseDetail`, overlay shell, grades + requirements wired in, grade components converted to theme tokens.
4. **Workday import** - `parseWorkdayForSchedule`, import overlay, term switching, honest exclusion reporting.
5. **RMP** - spike → (if viable) model, ingest job, ratings in the overlay.

---

## 11. Testing

Following the repo's existing split - pure logic gets unit tests, DB-touching code gets integration tests, UI gets a real browser check.

- **Section matching** (`parseWorkdayForSchedule`): unit tests over the real export fixture shape, covering a matched row, an unknown section code, and a term with no `Section` rows.
- **Buffer diffing** (`replaceScheduleSections`): added-only, removed-only, and no-op diffs.
- **Colour assignment**: same course code always yields the same palette entry.
- **Name normalization** (Phase 5): accents, middle initials, and the ambiguous-match rejection path.
- **Browser**: each phase ends by driving the real page - import an `.xlsx`, confirm blocks land on the grid, open the overlay from a calendar block, save, and reload to confirm persistence.

---

## 12. Out of scope

Deliberately excluded so this phase stays finishable:

- Automatic conflict *resolution* or section suggestions - conflicts stay advisory, as today.
- Drag-to-move or drag-to-resize calendar blocks. Sections have fixed meeting times; dragging implies an edit the registrar does not permit.
- Multi-term side-by-side view. One schedule is one term.
- Registration or waitlist actions. This app plans; Workday registers.
- Fixing `UploadCoursesForm`'s exclusion-reporting bug (§8.2) on the Account page - noted, tracked, but a separate change.
