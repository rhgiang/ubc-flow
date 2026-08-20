# UBC Flow — Phase 3: Ratings and Reviews (Design)

**Date:** 2026-08-19
**Status:** Approved for planning
**Phase:** 3 of 6
**Depends on:** [Phase 1: Foundation](2026-08-19-ubc-flow-foundation-design.md) (merged) · [Phase 2: Accounts + Workday Import](2026-08-19-phase-2-accounts-workday-import-design.md) (merged)

## 1. Why this phase exists

This is the feature the project was started for: let UBC students rate courses on
**usefulness**, **difficulty**, and **liked**, and rate the professors who taught
them.

Phases 1 and 2 were prerequisites, not detours. Phase 1 produced the catalogue a
review has to attach to; Phase 2 produced the verified enrollment record that
makes a review trustworthy. This phase spends that groundwork.

**Done when:** a verified student can open a course they actually took, submit
ratings for the course and its instructors in one form, edit or delete that
review later, and see aggregate ratings on both course and professor pages —
with no reviewer identity visible anywhere.

---

## 2. The gate

`canReview(userId, courseId)` from Phase 2 (`src/lib/gate.ts`) is the **only**
authority on whether a review may be written. It returns true only for a
`verified` enrollment belonging to that exact user and course.

**Every write path in this phase must call it server-side.** Hiding the review
form in the UI is a convenience, not a control — a user who forges a request to
the submit endpoint must be rejected by the same check.

This is what the whole of Phase 2 was built to provide. Bypassing it — even
"temporarily", even for a seed script — reopens the review-botting hole the
project has been designed around from the start.

---

## 3. Submission flow

One combined form, reached from the course page when the gate passes. UW Flow
does the same, for a good reason: the moment a student is thinking about a
course is exactly when they are able to say something useful about who taught
it, and a separate professor-review flow reached from elsewhere gets skipped.

```
1. Rate the course     liked (yes/no), useful (1-5), difficulty (1-5),
                       workload (hours/week), free text
2. Rate instructors    pick zero or more from a dropdown, each gets
                       liked (yes/no), clear (1-5), engaging (1-5), free text
3. Submit              one CourseReview + zero-or-more InstructorReview rows,
                       written in a single transaction
```

### 3.1 Where the instructor dropdown comes from

`Enrollment` records `(user, course, term)` — **not** which section or
instructor the student had. Workday's export does not map cleanly to one
instructor per course anyway: a single course routinely has different
instructors for its lecture, lab, and tutorial components.

So the dropdown is populated from Phase 1's scraped `SectionInstructor` data —
every instructor who taught that course in that term — and the student selects
who they actually had.

This is **self-reported**, and deliberately so. It is not verified against the
student's specific section. That is an acceptable trust level because the
expensive gate has already been passed: this person demonstrably took this
course. Choosing the wrong instructor from a short, correct list of that
course's actual instructors is a low-value attack and a low-stakes mistake.

Selecting zero instructors is valid — a course review alone is a complete
submission.

### 3.2 Transaction boundary

A submission writes one `CourseReview` and N `InstructorReview` rows atomically.
A partial write — course rated but instructor ratings lost, or vice versa —
would be invisible to the user and awkward to reconcile on the next edit, since
the form loads from both tables.

---

## 4. Edit and delete

Both supported. The schema anticipated this: `CourseReview` carries `updatedAt`,
and its `@@unique([userId, courseId])` makes "submit again" an upsert rather
than a duplicate.

- Opening the form for a course already reviewed loads it **pre-filled**.
- Submitting again overwrites.
- Delete removes the `CourseReview` and its associated `InstructorReview` rows.

`InstructorReview` follows the same rule via `@@unique([userId, instructorId, courseId])`.

**Deselecting an instructor on edit deletes that instructor review.** The form's
selection is the complete intended state, not an append.

---

## 5. Anonymity

Reviews are **fully anonymous to other users**. No username, no program, no
graduation year, no stable per-author identifier is rendered anywhere a visitor
can see.

The `userId` foreign key still exists — it is what makes edit, delete, and
one-review-per-course enforcement possible. It must never reach a page, an API
response, or a client-side prop.

**This is a hard requirement, not a display preference.** Course reviews can be
critical of named instructors; a student whose authorship is discoverable is
exposed to real professional risk. Verification proves *eligibility to review*,
never *identity of reviewer* — those were deliberately separated in Phase 2 and
must stay separated here.

A user can see **their own** reviews (on the course page, and to edit them).
That is the only case where a review is attributable, and only to its author.

---

## 6. Rating model and display

### 6.1 Storage

The Phase 1 stubs already hold the right shape, unchanged:

| Field | Model | Type | Meaning |
|---|---|---|---|
| `liked` | both | `Boolean?` | did you like it |
| `useful` | CourseReview | `Int?` 0-4 | usefulness |
| `difficulty` | CourseReview | `Int?` 0-4 | **higher = harder** |
| `workloadHours` | CourseReview | `Int?` | self-reported hours/week |
| `clear` | InstructorReview | `Int?` 0-4 | clarity of explanation |
| `engaging` | InstructorReview | `Int?` 0-4 | engagement |
| `text` | both | `String?` | free-text review |

**`difficulty` increases with difficulty.** This is stated explicitly because UW
Flow stores the inverse (their field is named `easy`), and a mismatch between a
field's name and its direction is a bug that surfaces months later as
inverted-looking data. Nothing in this codebase may store or display it
inverted.

Scores are stored `0-4` and presented to users as **1-5**. The offset is a
presentation concern, converted at the boundary — never stored as 1-5.

### 6.2 Display

- **Scalar dimensions** (`useful`, `difficulty`, `clear`, `engaging`) show a
  plain numeric mean out of 5, e.g. `Useful 3.4 / 5`.
- **`liked`** is boolean, so it shows as a percentage: `78% liked this course`.
- Individual reviews list below the aggregates, anonymous, newest first.

A plain mean is used rather than a "percent positive" because this site starts
with almost no reviews. A percentage over 1-2 reviews swings to 0% or 100% and
reads as noise; `4.0 / 5 (2 reviews)` is honest about both the score and the
sample. Review counts are always shown next to aggregates for the same reason.

Courses and professors with no reviews show an explicit empty state, never a
`0/5` that would read as a terrible score.

---

## 7. Schema change

One removal:

```prisma
model CourseReview {
  instructorId String?   // <- DROP
}
```

`CourseReview.instructorId` is a single nullable instructor per course review.
`InstructorReview` already models the course-instructor relationship with the
correct multiplicity — a course review can relate to several instructors, which
this column cannot express. It is redundant and actively misleading to anyone
reading the schema later.

Nothing has ever written to it (Phases 1 and 2 never touched review tables), so
the drop risks no data. It is the only schema change this phase makes.

---

## 8. Architecture

Continues the established monolith. No new services, no new dependencies.

```
src/lib/gate.ts             — EXISTING (Phase 2), the authority. Unchanged.
src/reviews/aggregate.ts    — PURE: review rows -> aggregate stats
src/app/actions/reviews.ts  — server actions: submit, delete (gate-checked)
src/app/course/[code]/…     — review form + aggregates + review list
src/app/professor/[slug]/…  — aggregates + review list
```

Aggregation stays a **pure function** over already-fetched rows, following the
pattern that made Phases 1 and 2 testable offline: no I/O, so mean/percentage
math is unit-tested against fixtures with no database.

---

## 9. Security requirements

| Area | Requirement |
|---|---|
| Authorization | Every review write calls `canReview` server-side. UI visibility is never the control. |
| Ownership | Edit and delete verify the review belongs to the requesting user — never trust a client-supplied review id alone. |
| Anonymity | `userId` never reaches a page, API response, or client prop for another user's review. |
| Input | Scores validated to the 0-4 range server-side; text length-capped; `workloadHours` bounded to a sane range. |
| Text | Review text is rendered as text, never as HTML — no `dangerouslySetInnerHTML` on user content. |

The gate and the ownership check are the two places where a mistake is
expensive and quiet. Both need tests that assert the *negative* case — a
non-enrolled user rejected, another user's review not editable — not just the
happy path.

---

## 10. Out of scope

- Moderation, reporting, flagging — deferred until live abuse shows its shape.
  The verified-enrollment gate is meaningful friction in the meantime.
- Grade distributions — Phase 5, from public PAIR data, unrelated to reviews.
- Schedule planner and webcal — Phase 4.
- Review voting, helpfulness scores, sorting by rating.
- Any weighting of reviews by recency, author, or enrollment recency.
