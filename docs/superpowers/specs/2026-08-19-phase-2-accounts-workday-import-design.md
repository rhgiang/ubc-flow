# UBC Flow - Phase 2: Accounts + Workday Import (Design)

**Date:** 2026-08-19
**Status:** Approved for planning
**Phase:** 2 of 6
**Depends on:** [Phase 1: Foundation](2026-08-19-ubc-flow-foundation-design.md) - merged, catalogue populated

## 1. Why this phase comes before ratings

Phase 3 is the ratings feature the project exists for. It ships second because
**verification gates it**: a review is only trustworthy if we know the reviewer
took the course. The same upload that establishes that also produces the
enrollment records Phase 4's schedule planner needs, so building it once here
serves both.

**Done when:** a student can create an account, upload their Workday exports,
and end up with a verified account carrying an accurate list of every course
they have taken or are taking - with no grades stored anywhere, and with one
student unable to verify more than one account.

---

## 2. Trust model

Two independent factors doing different jobs. Neither substitutes for the other.

| Factor | Proves | Used for |
|---|---|---|
| Email + password | Control of an inbox | Account identity, password reset |
| Workday `.xlsx` upload | UBC studenthood **and** specific course enrollment | Studenthood + per-course review rights |

### 2.1 Email is not the trust anchor

Earlier drafts gated signup to `@ubc.ca` / `@student.ubc.ca`. **That is dropped.**
UBC students do not use their student email heavily - CWL is the primary campus
identity - so an email-domain gate filters real students while proving little.

Email is therefore **not domain-restricted**. Any provider works. This is
deliberate: alumni and students who have lost UBC mail access must still be able
to review courses they genuinely took.

Email verification still happens, but only to catch typos and to make password
reset trustworthy. It is not evidence of studenthood.

### 2.2 CWL is out of scope, permanently

CWL SSO requires being a UBC-IT-approved SAML/Shibboleth service provider -
institutional approval an independent project will not obtain. Independently, a
comparable project (`sjsikora/UBC-Class-Api`) was withdrawn by its author over
CWL terms of service.

**Hard constraint: UBC Flow never asks for, transmits, stores, or proxies CWL
credentials.** No feature in any phase may require them. The Workday export
exists precisely so we never need to.

### 2.3 The gate

**No parsed enrollment record → no reviewing at all.** Additionally, a user may
only review a course that appears in *their own* enrollment record.

This is the strict option, chosen knowingly. It is viable because §3's academic-
record import makes a single upload unlock the user's entire course history
rather than one term.

---

## 3. The two Workday exports

Workday exposes two separate exports, and this phase consumes both.

| Export | Workday location | Yields | Also feeds |
|---|---|---|---|
| **Current Classes** | Academics → View My Courses | This term's registration | Phase 4 schedule planner |
| **Academic Record** | Academics → Academic Record | Every completed course | - |

**The academic-record import is the cold-start mitigation.** A hard review gate
would normally throttle exactly the early adoption the site needs. Because one
upload from a fourth-year student unlocks their whole transcript's worth of
reviewable courses, the gate becomes a one-time onboarding step with a large
payoff instead of a per-review tax.

### 3.1 Parse and discard

Both files are handled identically with respect to data retention:

1. Received in memory. **Never written to disk**, never persisted, never logged.
2. Parsed to extract only `(course, term)` pairs and the identity field of §5.
3. Those pairs written to `Enrollment`. The buffer is discarded.

**Never stored, in any form:** grades, GPA, academic standing, program
progression, raw student number, or the uploaded file itself.

This is a deliberate blast-radius decision: a future breach cannot leak academic
records that were never written. It also keeps UBC Flow out of the business of
custodying student academic data, which carries obligations disproportionate to
a course-review site.

---

## 4. Onboarding flow

The upload is a **step in signup**, not a later prompt. Deferring it would leave
a population of accounts that cannot do the one thing the site is for.

```
1. Sign up            email + password
2. Verify email       one-time link (typo catch + reset trust)
3. Guided upload      explicit Workday click-path, per export type
4. Parse + preview    "matched 34 of 36 courses" - unmatched rows shown
5. Confirm            account verified, reviewing unlocked
```

### 4.1 Step 3 must teach the click-path

Most students have never exported from Workday. The screen names the exact
navigation for each export and what the button looks like. A user who cannot
find the button cannot use the site at all, so this screen is load-bearing UI,
not decoration.

### 4.2 Step 4 must show unmatched rows

Parsed courses are matched against the Phase 1 catalogue by subject code and
number. Rows that do not match are **displayed to the user, not silently
dropped** - a silent drop hides catalogue gaps (a course we failed to scrape, a
code that changed) and leaves the user wrongly blocked from reviewing a course
they took, with no visible cause.

Unmatched rows do not block completion; they are reported.

---

## 5. One student, one account

A `.xlsx` is a file. It can be forwarded. Without a defence, one genuine export
could verify fifty accounts and manufacture a bot army with real-looking
enrollment - defeating the entire purpose of the gate.

**Binding rule:** extract a stable identity field from the export, compute
`HMAC-SHA256(identity, SERVER_SECRET)`, store only that digest in
`User.studentIdHash` under a unique constraint. An upload whose digest already
belongs to a different account is rejected.

### 5.1 Why HMAC and not a plain hash

A bare `SHA-256` of a student number is **not** protective. UBC student numbers
occupy roughly an eight-digit space; an attacker with the digest column can
enumerate the entire space in seconds and recover every student number. Keying
the hash with a server-side secret makes the digests useless without that
secret.

`SERVER_SECRET` lives in the environment, never in the repo. Rotating it
invalidates all bindings, so it is rotated only deliberately.

### 5.2 The identity field - confirmed

**Resolved by inspecting real exports (2026-08-19).** Both exports carry the
student number in column `A` of every data row, formatted:

```
Ryan Giang (12345678) - Faculty of Science
```

The number is extracted with `/\((\d{6,10})\)/`, HMAC'd, and the raw value
discarded immediately. No weaker composite-key fallback is needed; the earlier
contingency for a missing student number is withdrawn.

Because the field repeats on every row, the parser asserts all rows in a file
agree on one student number and rejects the upload otherwise - a file containing
two students is not a legitimate export.

---

## 6. Architecture

Continues Phase 1's simplified TypeScript monolith. No new services.

```
Auth.js (NextAuth) v5      - sessions, CSRF, cookies, credentials flow
  └── Prisma adapter ──► existing Postgres
src/auth/                  - auth config, guards
src/upload/parse-workday.ts  - PURE: xlsx bytes -> structured rows
src/upload/jobs/…          - matching + Enrollment upserts
src/app/(auth)/…           - signup, login, verify, onboarding screens
```

**Auth.js over hand-rolling.** Auth is a security boundary; CSRF, session
fixation, timing-safe comparison and reset-token entropy are all places where a
subtle bug is expensive and invisible. Using the standard library is the correct
laziness. Its credentials provider is known to be awkward - that cost is
accepted deliberately.

**Parsers stay pure**, exactly as in Phase 1: `bytes → structured rows`, no I/O.
This is what let Phase 1's test suite run offline and fast, and it is what makes
a binary-format parser testable against fixtures at all.

---

## 7. Schema changes

All additive and nullable - no migration of existing rows.

```prisma
model User {
  // ...existing fields
  studentIdHash String?   @unique   // HMAC-SHA256, §5
  verifiedAt    DateTime?           // set when first upload parses successfully
}

// Enrollment.source values (existing column, documented here):
//   'workday_current' - from the Current Classes export
//   'workday_record'  - from the Academic Record export
```

Plus Auth.js's standard adapter tables: `Account`, `Session`,
`VerificationToken`.

`Enrollment.verified` is `true` for anything parsed from a real export. The
column exists to leave room for a future self-reported path; Phase 2 writes only
verified rows.

---

## 7A. Confirmed export structure

Verified against real exports on 2026-08-19. Both are single-sheet `.xlsx`
with **headers on row 3** (rows 1-2 are title banners) and data from row 4.

### 7A.1 Current Classes (`View My Courses`)

| Col | Header | Example | Used |
|---|---|---|---|
| A | *(unlabelled)* | `Ryan Giang (12345678) - Faculty of Science` | identity only (§5.2) |
| B | Course Listing | `CPSC_V 110 - Computation, Programs, and Programming` | **yes** |
| E | Credits | `4` | no |
| F | Grading Basis | `Graded` | no |
| G | Section | `CPSC_V 110-L1U - Computation, Programs...` | **yes** |
| H | Registration Status | `Registered` | **yes** - filter |
| I | Instructional Format | `Lecture` / `Laboratory` / `Discussion` | yes |
| J | Delivery Mode | `In Person Learning` / `Hybrid Learning` | no |
| K | Meeting Patterns | `2026-09-09 - 2026-12-04 \| Wed Fri \| 10:00 a.m. ...` | **yes** - term inference |
| L | Instructor | `Nick Bradley` | no (Phase 1 already has this) |
| M/N | Start / End Date | Excel serial (`46274`) | fallback for K |

**Course codes arrive in the `_V` wire format** (`CPSC_V 110`), identical to what
Phase 1's `parseUbcCourseCode` already parses. Reuse that function; do not write
a second course-code parser.

**No grades appear in this export.** Column F is the grading *basis*, not a mark.

### 7A.2 Academic Record (`View My Academic Record`)

| Col | Header | Example | Used |
|---|---|---|---|
| A | *(unlabelled)* | `Ryan Giang (12345678) - Faculty of Science` | identity only |
| B | Transfer Credit | `MATH_V 101 - Integral Calculus with Applications` | yes |
| C | Credits | `3.0` | no |
| D | **Grade** | `TR` | **never stored** (§3.1) |
| E | Originating Coursework | `University of Alberta (Edmonton, AB, Canada)` | **yes** - exclusion signal |

### 7A.3 There is no term column

Neither export names a term. Term is **inferred from the meeting-pattern start
date** in column K (falling back to the column M serial):

| Start month | Term |
|---|---|
| Sep-Dec (9-12) | Winter Term 1 of the academic year beginning that calendar year |
| Jan-Apr (1-4) | Winter Term 2 of the academic year beginning the *previous* calendar year |
| May-Aug (5-8) | Summer Session of that calendar year |

A single export spans multiple terms - the sample contains both 2026W1
(Sept 2026) and 2026W2 (Jan 2027) rows. The parser must not assume one term per
file. Inferred terms are matched against Phase 1's `Term` table by
`year` + `session` + `termNumber`.

## 7B. Transfer credit must not grant review rights

Transfer rows carry grade `TR` and a non-empty **Originating Coursework**
naming another institution. A student who took MATH 101 at the University of
Alberta did **not** experience UBC's MATH 101, so allowing a review of it would
produce precisely the untrustworthy review the §2.3 gate exists to prevent - and
invisibly, since the row is otherwise indistinguishable from a completed course.

**Rule: rows with grade `TR` or a non-empty Originating Coursework column are
parsed, counted, and reported to the user, but never written as review-granting
enrollment.**

This also disposes of a data-quality problem for free: transfer records contain
placeholder pseudo-courses (`PHYS_V 1ST`, `CHEM_V 1ST`, `WRCM_V 1ST`) whose
"numbers" are not real catalogue entries. Excluding transfer rows removes them
before they can appear as spurious unmatched-course noise in the §4.2 preview.

## 7C. In-progress courses do grant review rights

A course with registration status `Registered` whose term has not ended still
unlocks reviewing. Requiring completion would mean nobody can review until a
term ends, which is an unacceptable cold start; a student mid-course has genuine
signal on workload and teaching quality. This matches UW Flow's behaviour.

## 8. Remaining unknown - the completed-UBC-coursework table

§7A resolves the Current Classes export completely and the Academic Record
export **partially**. The sample record contained only a *Transfer Credit from
Coursework* table, because that student has no completed UBC terms yet.

A student with completed UBC coursework will have at least one additional table
in the same sheet - presumably carrying term and grade columns. **Its structure
is unverified.** The likely shape, by analogy with §7A.2, is a second banner row
followed by its own header row and rows whose Originating Coursework column is
empty, but this is inference, not observation.

**Handling:** the parser is written table-aware rather than assuming a single
fixed layout - it locates each table by its banner/header rows rather than by
absolute row numbers, and ignores tables it does not recognise. An unrecognised
table is reported in the §4.2 preview as unparsed rather than silently skipped,
so the gap is visible the first time a senior student uploads.

Obtaining a second sample from a student with completed UBC terms is the
cheapest way to close this and should happen before launch.

### 8.1 File handling

Real exports are gitignored (`rgschedule/`, `*.xlsx`, with an exception for
`tests/fixtures/**`). Tests run against **redacted fixtures** - real structure,
fabricated names and student numbers - committed in their place. A real export
is never committed, never written to disk by the app, and never logged.

---

## 9. Security requirements

Non-negotiable; these are the "never simplify away" items for this phase.

| Area | Requirement |
|---|---|
| Upload | Size cap; extension and MIME check; parse in memory; never write to disk |
| Passwords | Hashed via Auth.js/bcrypt. Never logged, never returned by any endpoint |
| Rate limiting | On login attempts and on uploads |
| Student identity | HMAC with server-side secret; raw value never stored |
| Academic data | No grades, GPA, or standing persisted anywhere, ever |
| CWL | Never requested, transmitted, stored, or proxied |
| Secrets | `SERVER_SECRET`, `AUTH_SECRET`, `DATABASE_URL` in env only; never committed |

**Malformed-upload handling:** a corrupt, oversized, or non-xlsx file must fail
with a clear message and no partial write. A zip bomb or malformed archive must
not crash the process - the size cap is checked before parsing, not after.

---

## 10. Out of scope for Phase 2

- Ratings, reviews, review UI - Phase 3
- Schedule planner, `.ics`, webcal subscription - Phase 4
- Grade distributions - Phase 5 (from public PAIR data, unrelated to uploads)
- Any storage of user grades - every phase, permanently
- OAuth / social login - revisit only if password friction proves real
