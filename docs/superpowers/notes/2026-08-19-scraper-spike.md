# Scraper spike: course/section row extraction from courses.students.ubc.ca

Date: 2026-08-19
Task: 3 (spike, phase-1-foundation)

## TL;DR / decision

- **Method that produced the committed fixtures: Playwright** (headless Chromium), per the
  explicit instruction for this task to skip the DevTools-capture steps and go straight to
  the Playwright path. It works and is documented below with exact selectors.
- **But: a plain, unauthenticated HTTP GET is enough for course-level data, and a plain,
  unauthenticated JSON:API GET is enough for section-level data.** Neither needs a browser.
  This was discovered *while* running the Playwright script (by logging its XHR/fetch
  requests) and then independently verified with bare `curl`, no cookies, no session.
  **This should be the real fetch mechanism for Task 7**, not full-page Playwright rendering.
  Details and exact URLs in "Recommended production approach" below.

## What was already known going in (do not repeat)

- `GET /course-search` (no query string) → 200, full form + dropdowns, **and** (newly
  observed) a server-rendered default result set (see below).
- `GET /course-search?campus=1&academic_period=1449&subject_code=CPSC` → 200, ~75KB, zero
  course rows.
- `POST /views/ajax` (Drupal Views AJAX, `view_name=new_course_search`) → 200, but the
  `insert` command payload contains only the re-rendered filter form, no results.

## Correction to the "zero rows" finding

The zero-rows result for `subject_code=CPSC` is **not** evidence that results require
JS/AJAX rendering. It is specific to the free-text `subject_code` filter, which appears to
not match anything server-side (0 of 0 courses, confirmed again in this spike, same ~75KB
response size). The numeric `subject` id filter works perfectly on a plain GET:

```
curl -A "UBCFlow/0.1 (course review site; +https://github.com/ryangiang/ubc-flow)" \
  "https://courses.students.ubc.ca/course-search?campus=1&academic_period=1453&subject=1810"
```

returns HTTP 200 with `Displaying 1 - 10 of 64 courses` and 10 fully server-rendered course
cards (title, course code, campus, subject, credits, description) in the raw HTML - no
Playwright needed for this part at all. This also worked against the older term 1449 (67
courses). **Task 7 should filter by the numeric `subject` id, exactly as the task brief
already mandates for the cold-database reason - and that turns out to be the form of the
request that actually works via plain HTTP, which is a nice coincidence.**

What plain HTTP GET does *not* give you: individual section rows. Each course card ships a
placeholder:

```html
<div class="course-sections-root" data-course-id="9d8da05f-cb17-4748-9de0-7bb78a7b9313" data-base-url="">
  <div class="text-center pt-leading text-grey-500"><p>Loading sections component...</p></div>
</div>
```

This placeholder is filled in by a client-side "sections component" (React-ish, mounted
against `data-course-id`), and - critically - the sections table itself is further gated
behind a **"Show section details" button per course card**. The button must be clicked
before the table appears in the DOM at all. This is the part that genuinely needs either a
real browser or (better, see below) a direct call to the API the button ends up calling.

## Recommended production approach (for Task 7)

Two plain, unauthenticated HTTP GETs. No cookies, no Playwright, no headless browser:

**1. Course list** - plain HTML GET + cheerio, exactly as Task 6/7 already plan:

```
GET https://courses.students.ubc.ca/course-search?campus=1&academic_period=<TERM_ID>&subject=<SUBJECT_ID>&page=<N>
```

Each course card (`li.my-6 article.ubc-card`) carries the course UUID needed for step 2 in
`div.course-sections-root[data-course-id]`.

**2. Sections for one course** - Drupal JSON:API, discovered by watching Playwright's
network log when it clicked "Show section details":

```
GET https://courses.students.ubc.ca/jsonapi/node/section
  ?filter[field_course.id]=<COURSE_UUID>
  &filter[field_academic_term.meta.drupal_internal__target_id]=<TERM_ID>
  &filter[field_is_visible]=1
  &sort=field_section_number
  &fields[node--section]=title,field_section_number,field_start_date,field_end_date,field_start_time,field_end_time,field_days,field_instructors,field_credits,field_delivery_mode,field_instructional_method,field_status
  &include=field_delivery_mode,field_instructional_method,field_status
```

Verified with plain `curl` (this exact endpoint, no session/cookie) → HTTP 200, valid
JSON:API payload. Example section object:

```json
{
  "type": "node--section",
  "id": "ddf70cb6-a47e-4763-acd8-b662f2e31bae",
  "attributes": {
    "title": "Computational Thinking :: 2026 :: Sec 101",
    "field_days": ["m", "w", "f"],
    "field_end_date": "2026-12-07",
    "field_end_time": 54000,
    "field_section_number": "101",
    "field_start_date": "2026-09-09",
    "field_start_time": 50400,
    "field_credits": "3.00",
    "field_instructors": ["Parsa Rajabi"]
  },
  "relationships": {
    "field_delivery_mode": { "data": { "type": "taxonomy_term--delivery_mode", "meta": { "drupal_internal__target_id": 86 } } },
    "field_instructional_method": { "data": { "type": "taxonomy_term--instructional_method", "meta": { "drupal_internal__target_id": 79 } } },
    "field_status": { "data": { "type": "taxonomy_term--status", "meta": { "drupal_internal__target_id": 1954 } } }
  }
}
```

Taxonomy term ids resolve via the `included` array in the same response (or a follow-up
lookup) to human names, e.g. delivery_mode 86 = "In person", instructional_method 79 =
"Lecture", status 1954 = "Waitlist", status 90 = "Open".

`field_start_time`/`field_end_time` are seconds-since-midnight integers (e.g. `50400` /
3600 = `14`, matching the `14:00` shown in the rendered UI for this same section). Verify
timezone handling (local vs. UTC) when Task 7 implements this - not conclusively determined
in this spike.

**Gotcha for whoever implements this:** JSON:API's `fields[node--section]` parameter
restricts *both* attributes and relationships for that resource type. If you omit
`field_delivery_mode`/`field_instructional_method`/`field_status` from `fields[...]`, their
relationship data silently disappears from the response even if you still pass them in
`include=`. Always list every relationship you want in `fields[node--section]` too.

**This means Task 7 does not need Playwright in production at all** - two chained,
rate-limited `fetch()` calls (course list page(s), then one JSON:API call per course UUID)
cover everything the rendered UI shows, plus instructor name and status, which the rendered
UI actually *hides* (see below). Playwright is still useful as a one-time verification tool
(this spike) but should not be the runtime scraping mechanism.

## Playwright path (what actually produced the committed fixtures)

Working selectors, verified against the live site on 2026-08-19:

```ts
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({
  userAgent: 'UBCFlow/0.1 (course review site; +https://github.com/ryangiang/ubc-flow)',
});
await page.goto('https://courses.students.ubc.ca/course-search', { waitUntil: 'load' });
await page.check('#edit-campus-1');                    // Vancouver radio (already checked by default)
await page.selectOption('#edit-academic-period', '1453'); // term id, see below
await page.selectOption('#edit-subject', '1810');      // numeric subject id, NOT #edit-subject-code
await page.click('#edit-submit-new-course-search');

await page.waitForLoadState('networkidle', { timeout: 15000 });
await page.waitForFunction(
  () => !document.body.innerText.includes('Loading sections component'),
  { timeout: 20000 }
);
// At this point each course card has a "Show section details" button, but the section
// table is NOT yet in the DOM. Sections stay collapsed until the button is clicked.

let remaining = await page.locator('button:has-text("Show section details")').count();
while (remaining > 0) {
  // Must re-query each time: the click detaches/replaces the button element.
  await page.locator('button:has-text("Show section details")').first().click({ timeout: 5000 });
  await page.waitForTimeout(800);
  remaining = await page.locator('button:has-text("Show section details")').count();
}
await page.waitForTimeout(1500); // settle any lagging fetches

const html = await page.content();
```

Notes on the wait strategy: `networkidle` alone is **not sufficient** - it resolves once
the initial page reload settles, but the section tables are still collapsed at that point
(zero network activity, by design, since nothing loads until you click). The real
"finished" signal is (a) the "Loading sections component..." placeholder text is gone
(sections component mounted) and (b) all "Show section details" buttons have been clicked
and their tables have appeared. `getByLabel('Vancouver')` from the brief's example did not
need to be used since campus 1 (Vancouver) is checked by default; `#edit-campus-1` is the
reliable selector if an explicit click is wanted. `#edit-subject-code` (free text) was
deliberately **not** used - `#edit-subject` (numeric select, value `1810` for Computer
Science Vancouver) was used instead, per the Task 7 cold-database requirement.

## DOM structure of one course card + its expanded section table (literal HTML)

Course: CPSC_V 100 "Computational Thinking", pulled from the committed fixture
`tests/fixtures/course-search-cpsc.html` after Playwright expanded its sections:

```html
<li class="my-6">
<article class="relative shadow ubc-card ubc-card--vert hover--shadow-lg">
  <div class="flex flex-col self-center flex-1 w-full h-full p-6">
    <div class="py-2 ubc-card__content first-child--mt-0">
        <h3 class="font-normal h4"><span class="field field--name-title field--type-string field--label-hidden">Computational Thinking</span>
</h3>
                 <div>
                            Course Code: CPSC_V 100
                    </div>
                <div class="gap-4 my-2 sm--grid sm--grid-cols-3">
                            <div class="flex gap-2">
                    <h4 class="text-sm">Campus</h4>
                    <p class="mt-0 text-sm">Vancouver</p>
                </div>
                                        <div class="flex gap-2">
                    <h4 class="text-sm">Subject</h4>
                    <p class="mt-0 text-sm">Computer Science (Vancouver)</p>
                </div>
                                        <div class="flex gap-2 sm--justify-self-end">
                    <h4 class="text-sm">Credits</h4>
                    <p class="mt-0 text-sm">3.00</p>
                </div>
                    </div>
        <p>Meaning and impact of computational thinking. Solving problems using computational thinking, testing, debugging. How computers work. No prior computing experience required. Not for students with existing credit for or exemption from CPSC 107, CPSC 110 or APSC 160. [3-1-0]</p>
        <div class="course-sections-root" data-course-id="9d8da05f-cb17-4748-9de0-7bb78a7b9313" data-base-url="" data-course-sections-initialized="true">
          <div class="course-sections-wrapper">
            <button class="... unit-button unit-button--light mt-leading">Hide section details</button>
            <div class="course-sections-content mt-leading">
              <div class="... filters"> <!-- delivery-mode / instructional-format filter dropdowns, not data --> </div>
              <div class="overflow-x-auto">
                <table class="min-w-full text-sm table--striped table--hover">
                  <thead>
                    <tr>
                      <th>Section</th><th>Delivery</th><th>Instructional format</th>
                      <th>Start Date</th><th>End Date</th><th>Start Time</th><th>End Time</th><th>Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td><a href="/courses/computational-thinking/computational-thinking-2026-sec-101" class="no-underline hover--underline">101</a></td>
                      <td>In person</td>
                      <td>Lecture</td>
                      <td>Sep 8, 2026</td>
                      <td>Dec 6, 2026</td>
                      <td>14:00</td>
                      <td>15:00</td>
                      <td class="capitalize">m, w, f</td>
                    </tr>
                    <!-- more <tr> rows, one per section (L1A, L1B, L1C, L1D, L1E for this course) -->
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
</article>
</li>
```

Selectors for Task 6's cheerio parser (once sections are expanded, e.g. from a saved
Playwright-rendered page, or reconstructed from the JSON:API):
- Course card: `li.my-6 article.ubc-card`
- Course code: text of the `<div>` immediately after `<h3>`, format is `"Course Code: CPSC_V 100"` (note the `_V` campus suffix embedded in the code - not `"CPSC 100"`)
- Course title: `h3 .field--name-title`
- Course UUID (for JSON:API lookups): `.course-sections-root` `data-course-id` attribute
- Section rows: `.course-sections-content table tbody tr`, columns in order: section code, delivery mode, instructional format ("activity"), start date, end date, start time, end time, days

## Fields present vs. NOT available

| Field | Present? | Where |
|---|---|---|
| Course code | Yes | Course card text, e.g. `CPSC_V 100` (campus-qualified, not `CPSC 100`) |
| Course title | Yes | Course card `<h3>` |
| Section code | Yes | Section table `Section` column (e.g. `101`, `L1A`) |
| Activity (instructional format) | Yes | Section table `Instructional format` column (`Lecture`, `Laboratory`, ...) |
| Delivery mode | Yes | Section table `Delivery` column (`In person`, ...) |
| Meeting day(s) | Yes | Section table `Days` column (`m, w, f`) |
| Meeting start/end time | Yes | Section table `Start Time`/`End Time` columns (`14:00`) |
| **Status (Open/Full/Waitlisted)** | **NOT shown in the rendered UI table** | Available only via the JSON:API (`field_status` relationship), not visible anywhere in the HTML |
| **Instructor name** | **NOT shown in the rendered UI table** | Available only via the JSON:API (`field_instructors` array), not visible anywhere in the HTML |
| **Building / room** | **Not available anywhere** | Confirmed absent from both the rendered HTML and the full unfiltered JSON:API section resource (checked every attribute/relationship on a section node - no location/building/room field exists) |

This means the results page UI is strictly less informative than the underlying API: it
hides instructor and enrollment status, and the source data has no room/building info at
all (UBC evidently doesn't publish that for this system, or it lives in a different system
entirely).

## Pagination

Confirmed on subject Computer Science (Vancouver), term 1453 (2026-27 Winter Term 1): 64
courses, 10 per page, standard Drupal pager:

```html
<nav class="flex justify-center pager" role="navigation" aria-labelledby="pagination-heading--...">
  <ul class="... pager__items ...">
    <li class="pager__item is-active"><a href="?campus=1&academic_period=1453&subject=1810&page=0" ...>1</a></li>
    <li class="pager__item"><a href="?campus=1&academic_period=1453&subject=1810&page=1" ...>2</a></li>
    <li class="pager__item"><a href="?campus=1&academic_period=1453&subject=1810&page=2" ...>3</a></li>
    <!-- ... 7 pages total for this subject -->
  </ul>
</nav>
```

`page` is 0-indexed. This pager is present in the plain server-rendered HTML (works with
`GET ...&page=N`, no JS needed) since it's part of the same SSR'd Views output as the course
cards. The JSON:API section endpoint also supports its own `page[limit]`/`page[offset]`
pagination independently, though in practice a single course rarely has more than ~10-15
sections so this is unlikely to matter.

## Term and subject ids used

- Term: `1453` = "2026-27 Winter Term 1 (UBC-V)". Tried first per instructions since today
  is 2026-08-19; it had data (64 CPSC courses), so no fallback to 1449/1450 was needed.
- Subject: `1810` = "Computer Science (Vancouver)", selected via `#edit-subject` (numeric),
  not `#edit-subject-code` (free text) - per the Task 7 cold-database requirement, and
  because the free-text filter appears broken/non-matching server-side anyway (see
  correction above).
- Campus: `1` = Vancouver.

## Fixtures produced

- `tests/fixtures/course-search-form.html` - plain `curl` GET of `/course-search`, 95,428
  bytes. Contains `edit-academic-period` and `edit-subject`.
- `tests/fixtures/course-search-cpsc.html` - Playwright-rendered `/course-search` for
  campus 1, term 1453, subject 1810, with all 10 course cards on page 1 expanded (all
  "Show section details" buttons clicked), 198,188 bytes. Contains `CPSC_V 221` and
  multiple distinct section codes across the 10 expanded courses.
