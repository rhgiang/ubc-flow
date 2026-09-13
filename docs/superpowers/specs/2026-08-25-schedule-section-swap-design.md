# UBC Flow - Schedule section swap (Design)

Date: 2026-08-25
Status: approved, not yet implemented

Adds a first-class "swap this section for another" action to the schedule
builder, and moves overlap warning from a purely passive banner to a
confirmation at the moment the schedule is committed.

## 1. Context

### 1.1 What the builder does today

Adding and removing sections is client-only. `ScheduleBuilder` holds the
working set in `chosen` and commits nothing until Save (`trySave`), which
matches Workday's own Save/Cancel model. `addSection` and `removeSection` are
plain `setChosen` calls.

Changing from one section of a course to another therefore takes two
deliberate steps - find the held section, remove it, search the course again,
add the replacement - with no affordance suggesting the two are related.

### 1.2 Overlaps are already permitted (investigation finding)

The original request described the builder as hard-denying a conflicting add.
It does not. Tracing the add path:

- `findConflicts` (`src/schedule/conflicts.ts`) is a pure function returning
  overlapping pairs. Its own comment records that conflicts are advisory
  because UBC's meeting data cannot always prove an overlap is real -
  alternating-week patterns look identical to a true clash.
- `addSection` is synchronous, returns nothing, and has no validation or
  rejection path. It cannot fail.
- The only `disabled` in the add path is `addedIds.has(...)` - dedupe, not
  conflict.
- Every `setError` call site sits on the **import** or **save** path. None on
  add.

Conflicts today are presented three ways, all passive: a `--danger` ring on the
calendar block, a tooltip, and a `--danger` banner reading "N scheduling
conflicts detected".

**The reported bug was that banner.** A conflicting section was added
successfully, and the danger styling read as a rejection - so the correct
"Added" label then looked like a second bug on top. No logic was wrong; the
interface misreported a success as a failure.

This reframes the work: there is no permission to loosen. What is missing is a
swap affordance, and a real decision point at the moment the overlap becomes
committed.

## 2. Scope

In scope:

- A Swap action on a held section, from the calendar and from course rows.
- A swap overlay that opens showing the course's other sections and can also
  search for anything else.
- Atomic replacement in the working set.
- A confirmation when saving a schedule that contains overlaps.

Out of scope:

- Any change to conflict detection itself. `findConflicts` is untouched.
- Any restyling of the banner or the calendar ring. Both keep `--danger` by
  explicit decision (§9.4). The banner does become dismissible (§7.1), which is
  a behaviour change, not a styling one.
- Swapping more than one section at a time.
- Server-side conflict validation. Overlaps remain legal to persist.

## 3. Entry points

### 3.1 Calendar block, on hover

A `⇄` button beside the existing `×` in `ScheduleCalendar`, reusing that
button's pattern exactly: `opacity-0` lifting to `group-hover:opacity-100`,
with the same `pointer-events` handling that keeps it unclickable until
revealed, and `stopPropagation` on click so it does not also fire the block's
"open this course" handler.

Gated on a new optional `onSwap` prop, mirroring how `onRemove` already gates
the `×`.

### 3.2 Course row, beside the dock button

A third button in `CourseHeaderActions`, alongside `i` and the dock icon -
same 20px circle, same course-accent colour, same `preventDefault` treatment
(these live inside a `<summary>`, where an unguarded click toggles the
`<details>` as a side effect).

`CourseHeaderActions` renders in **both** the Saved and Find panels, and swap
is meaningless for a course the student does not hold. `onSwap` is therefore
optional and passed only when that course has a held section: always in
`SavedCoursesPanel`, conditionally in `FindCoursesPanel`.

## 4. The swap overlay

New component `src/components/schedule/SwapOverlay.tsx`, following
`CourseInfoOverlay`'s established shape - a nullable identifying prop to open
and close, Escape to dismiss, backdrop, focus held in the dialog.

Contents:

- **Header** - "Swap MATH 101 2A2", with the current section's days and times
  beneath it, so the thing being replaced stays visible while choosing.
- **Body** - `FindCoursesPanel`, seeded with the course code.
- **Cancel** - closes with no change to the working set.

## 5. `FindCoursesPanel` changes

Approach: generalise the existing panel with optional props rather than
extracting a shared list component or introducing a `mode` flag (§9.1).

Three new optional props. Search, debounce, grouping and colour handling are
untouched.

| prop | default | purpose |
| --- | --- | --- |
| `initialQuery` | `''` | seeds the query state |
| `actionLabel` | `'Add'` | label for the action button |
| `currentSectionId` | - | the section being replaced |

`initialQuery` is the load-bearing one. The panel already searches by code or
title, so seeding the query with `"MATH 101"` runs the existing search effect
and lists that course's sections immediately. The "defaults to a preview of the
other sections" behaviour therefore needs **no new fetch path and no new
endpoint** - it is the search that already exists, pre-filled.

Button state resolves in this order:

1. `sectionId === currentSectionId` → **Current**, disabled
2. `addedIds.has(sectionId)` → **Added**, disabled
3. otherwise → `actionLabel`, enabled

Step 1 is why `currentSectionId` exists at all: the held section is already in
`addedIds`, so without it the section being swapped would read "Added", which
is true but useless in this context.

## 6. Swap behaviour

A single new function in `ScheduleBuilder`:

```ts
function swapSection(oldSectionId: string, hit: SectionHit): void
```

It replaces in one pass over `chosen`. It is deliberately **not**
`removeSection()` followed by `addSection()`:

- Two sequential updates render an intermediate state where the course is
  absent from the calendar - a visible flicker on a purely local operation.
- An atomic replace keeps the section at its existing position in the list,
  where remove-then-add moves it to the end and reshuffles the panel.

If the chosen replacement is already held elsewhere in the schedule, the
replace must not produce a duplicate - the old section is dropped and the
existing entry left alone.

No confirmation dialog. Swap matches Add and Remove: instant, buffered,
reversible, committed only at Save (§9.3). The calendar updates live, and the
overlay closes on apply.

## 7. Save-time overlap confirmation

`trySave` gains a gate before it commits. If `findConflicts` returns any pairs,
a dialog appears naming each overlap in the same phrasing the banner uses
("PSYC 101 007 overlaps MATH 101 2A2 on Tue"), offering:

- **Save anyway** - proceeds with the existing save path unchanged
- **Cancel** - aborts, working set untouched, nothing persisted

Modelled on `UnsavedWorkDialog`, which already guards navigation away from
unsaved work, so this is a second instance of an established pattern rather
than a new one.

Constraints:

- The gate fires only on Save. Planning stays silent - overlapping freely while
  working things out is useful and is the reason overlaps are permitted at all.
- Dismissing the banner (§7.1) must **not** suppress this dialog. They are
  independent: one is a passive notice, the other is the decision point.
- It fires whenever conflicts exist, every save. No "don't ask again" - a
  suppression preference is speculative until someone asks for it.
- It must not fire when there are no conflicts, so the common path is unchanged.

### 7.1 The banner is dismissible

The conflict banner currently renders for as long as an overlap exists, with no
way to put it away. A warning that cannot be dismissed becomes furniture - it
stops being read, which is the opposite of what it is for, and it costs vertical
space above the calendar for the whole session.

It gains a close control. Dismissal is scoped to the **current set of
overlaps**, not to the session:

- Dismissing hides the banner for exactly the overlaps present at that moment.
- If the set changes - a new overlap appears, or an existing one is resolved and
  a different one takes its place - the banner returns.
- Resolving every overlap and creating a new one later shows it again.

This is deliberately not a "don't show again" preference. Silencing a warning
permanently would mean a student who dismissed it in September never learns
about a clash they introduce in November.

Implementation note: derive dismissal by comparing a key built from the current
conflict pairs against the key that was dismissed. Do not reset the flag from an
effect - this file is already subject to the `set-state-in-effect` lint rule,
and a derived comparison needs no effect at all.

## 8. Testing

- `swapSection` - replaces in place; preserves list position; swapping onto a
  section already held does not duplicate it.
- The save gate - a schedule with conflicts does not persist until confirmed;
  a schedule without conflicts saves with no dialog.
- Banner dismissal - hiding it does not stop the save gate from firing, and a
  newly introduced overlap brings the banner back.
- `findConflicts` is pure and already covered; this work does not change it.

Vitest, matching the existing suite.

## 9. Decisions

### 9.1 Generalise the panel, not extract or branch

Rejected: extracting a shared `CourseSectionList` - a refactor of working code
for a single new consumer, with regression risk in the find panel and no
user-visible gain. Worth revisiting if a third consumer appears.

Rejected: a `mode: 'add' | 'swap'` prop - branching inside the component gives
it two personalities and invites accretion.

### 9.2 Swap targets the same course, with search as an escape hatch

The overlay opens on the held course's sections because that is the common
case. Searching for an unrelated course still works, and picking one still
removes the original - the action is "replace this", not "add another".

### 9.3 No confirmation on swap

Nothing is committed until Save, the calendar shows the result immediately, and
the action is trivially reversible. A dialog on every swap would be friction on
an undoable local edit while the real decision point sits at Save.

### 9.4 The conflict banner stays red, but becomes dismissible

Proposed and declined: softening the banner from `--danger` to a warning tone,
on the grounds that its styling is what caused a success to be read as a
failure (§1.2). Kept red by explicit decision.

Added instead: the banner can be dismissed (§7.1). This addresses the same
underlying problem from a different angle - a permanent red bar trains the
student to ignore it, so making it dismissible keeps it meaningful when it does
appear. Dismissal is scoped to the current set of overlaps rather than the
session, so it can never hide an overlap the student has not already seen.

## 10. Open questions

None blocking. Two noted for implementation:

- Whether the swap overlay should reuse the builder's existing overlay z-index
  and backdrop, or stack above `CourseInfoOverlay` when opened from a course
  row. Resolve against the actual overlay stack when building.
- Whether the `⇄` glyph or a small icon reads better at the calendar block's
  size, where the `×` is already tight. Decide visually.
