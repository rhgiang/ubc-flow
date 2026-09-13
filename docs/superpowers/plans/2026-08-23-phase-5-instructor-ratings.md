# Phase 5 (revised) - Instructor Ratings in the Course Overlay

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put instructor quality next to each section in the course overlay - using our own verified-enrolment reviews, with a link out to RateMyProfessors for anyone who wants that too.

**Architecture:** `loadCourseDetail` already returns each section's instructors. It gains a rating summary per instructor, computed with the existing `aggregateInstructorReviews` over `InstructorReview` rows. The overlay renders that inline under the instructor's name, plus an RMP search link built from the name - **no request is ever made to RateMyProfessors**.

**Tech Stack:** Next.js 16 (App Router), Prisma 7 + PostgreSQL, Tailwind v4 theme tokens, Vitest.

**Spec:** Revises `docs/superpowers/specs/2026-08-22-schedule-builder-redesign-design.md` §9.

## Why §9 changed

§9 originally specified an `InstructorRating` model fed by a nightly RateMyProfessors ingest, gated behind a spike. The spike ran - see `docs/superpowers/notes/2026-08-23-ratemyprofessors-spike.md`. Every technical question came back positive (unauthenticated GraphQL, 5,372 UBC professors, 85.7% name match with zero ambiguity), but `ratemyprofessors.com/robots.txt` is `User-agent: * / Disallow: /` with carve-outs only for named search crawlers, and separately blocks AI bots by name.

So §9's ingest is **struck**. This is §9.4's link-out, plus the thing that actually compounds: our own review data, which is UBC-specific and gated behind verified enrolment.

## Global Constraints

- **Make no request to RateMyProfessors.** No `fetch`, no server action, no build step. The link is a URL string built from the instructor's name; the student's browser follows it if they choose. If you find yourself writing a network call to RMP, stop.
- **No new rating model.** `InstructorReview` already exists. Do not add `InstructorRating`, and do not add an ingest job.
- Reuse `aggregateInstructorReviews` from `src/reviews/aggregate.ts` - do not re-derive means. Note its convention: storage is 0-4, display is 1-5, and it already converts.
- **Theme tokens only.** `foreground`, `background`, `text-secondary`, `text-tertiary`, `surface`, `surface-muted`, `border`, `border-hairline`, `brand`, `brand-accent`, `brand-foreground`, `danger`, and the `rounded-pill`/`rounded-card`/`rounded-input` radii. No raw `slate-*`/`blue-*`/`red-*`. **`brand` as a foreground is forbidden** - invisible in dark mode.
- An instructor with **no reviews** must render cleanly - name and RMP link only, no empty rating furniture, no "0%".
- `ScheduleSection.sectionId` and `InstructorReview.courseId` are raw FKs with no Prisma relation. Resolve with a second query keyed on collected ids, never a nested include.
- Commit after every task. `npx tsc --noEmit` and `npx vitest run` clean before each commit (baseline: **331 tests passing**).

---

### Task 1: Return an instructor rating summary from `loadCourseDetail`

**Files:**
- Modify: `src/lib/course-detail.ts`
- Modify: `tests/course-detail.test.ts`

**Interfaces:**
- Produces: a new exported type, and `CourseSectionDetail.instructors[]` entries gain `rating`:

```ts
export type InstructorRatingSummary = {
  count: number;
  likedPercent: number | null;
  clear: number | null;
  engaging: number | null;
};
```

- [ ] **Step 1: Write the failing tests**

Append to `tests/course-detail.test.ts`:

```ts
describe('loadCourseDetail instructor ratings', () => {
  it('attaches a rating summary slot to every instructor', async () => {
    const detail = await loadCourseDetail(courseId, termId);
    const withInstructors = detail!.sections.filter((s) => s.instructors.length > 0);
    // Some catalogue sections legitimately list no instructor yet.
    if (withInstructors.length === 0) return;

    for (const s of withInstructors) {
      for (const i of s.instructors) {
        expect(typeof i.name).toBe('string');
        expect(typeof i.slug).toBe('string');
        // Present as a key on every instructor - null when unrated.
        expect(i).toHaveProperty('rating');
      }
    }
  });

  it('reports null for an instructor with no reviews', async () => {
    const detail = await loadCourseDetail(courseId, termId);
    const all = detail!.sections.flatMap((s) => s.instructors);
    if (all.length === 0) return;

    const slugs = all.map((i) => i.slug);
    const rated = await db.instructorReview.findMany({
      where: { instructor: { slug: { in: slugs } } },
      select: { instructorId: true },
    });
    if (rated.length > 0) return; // this fixture course has reviews; covered below

    expect(all.every((i) => i.rating === null)).toBe(true);
  });

  it('summarises real reviews when they exist', async () => {
    // Find any instructor who actually has reviews, and a course they teach.
    const review = await db.instructorReview.findFirst({
      select: { instructorId: true, courseId: true },
    });
    if (!review) return; // no review data in this database

    const section = await db.section.findFirst({
      where: { courseId: review.courseId, instructors: { some: { instructorId: review.instructorId } } },
      select: { termId: true },
    });
    if (!section) return;

    const detail = await loadCourseDetail(review.courseId, section.termId);
    const instructor = await db.instructor.findUniqueOrThrow({
      where: { id: review.instructorId },
      select: { slug: true },
    });

    const found = detail!.sections
      .flatMap((s) => s.instructors)
      .find((i) => i.slug === instructor.slug);
    expect(found).toBeDefined();
    expect(found!.rating).not.toBeNull();
    expect(found!.rating!.count).toBeGreaterThan(0);
  });
});
```

Run: `npx vitest run tests/course-detail.test.ts` → FAIL (`rating` is not a property).

- [ ] **Step 2: Implement it**

In `src/lib/course-detail.ts`:

Add the import:

```ts
import { aggregateInstructorReviews } from '@/reviews/aggregate';
```

Add the exported type next to `CourseSectionDetail`:

```ts
/** Our own verified-enrolment reviews for one instructor, across all their
 *  courses - the same basis the professor page uses. Null when unrated. */
export type InstructorRatingSummary = {
  count: number;
  likedPercent: number | null;
  clear: number | null;
  engaging: number | null;
};
```

Widen the instructor entry in `CourseSectionDetail`:

```ts
  instructors: { name: string; slug: string; rating: InstructorRatingSummary | null }[];
```

Inside `loadCourseDetail`, AFTER `sectionRows` is available and BEFORE the return, collect the instructor ids and summarise their reviews in one query:

```ts
  // Ratings are keyed on instructor, not on (instructor, course) - the data is
  // sparse enough that a per-course split would almost always be empty, and
  // this matches what the professor page already shows.
  const instructorIds = [
    ...new Set(sectionRows.flatMap((s) => s.instructors.map((si) => si.instructorId))),
  ];
  const reviewRows = instructorIds.length
    ? await db.instructorReview.findMany({
        where: { instructorId: { in: instructorIds } },
        select: { instructorId: true, liked: true, clear: true, engaging: true },
      })
    : [];

  const reviewsByInstructor = new Map<string, typeof reviewRows>();
  for (const r of reviewRows) {
    const list = reviewsByInstructor.get(r.instructorId) ?? [];
    list.push(r);
    reviewsByInstructor.set(r.instructorId, list);
  }

  const ratingFor = (instructorId: string): InstructorRatingSummary | null => {
    const rows = reviewsByInstructor.get(instructorId);
    if (!rows || rows.length === 0) return null;
    const agg = aggregateInstructorReviews(rows);
    return {
      count: agg.count,
      likedPercent: agg.likedPercent,
      clear: agg.clear,
      engaging: agg.engaging,
    };
  };
```

Then in the `sections` mapping, extend the instructors projection:

```ts
      instructors: s.instructors.map((si) => ({
        name: si.instructor.name,
        slug: si.instructor.slug,
        rating: ratingFor(si.instructorId),
      })),
```

Run: `npx vitest run tests/course-detail.test.ts` → PASS.

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run
git add src/lib/course-detail.ts tests/course-detail.test.ts
git commit -m "feat: return instructor rating summaries with course detail"
```

Expect 334 tests (331 + 3).

---

### Task 2: Render ratings and the RMP link in the overlay

**Files:**
- Modify: `src/components/schedule/course-info/CourseInfoContent.tsx`

- [ ] **Step 1: Add the link builder and the instructor line**

At the top of the file, next to the other helpers (`pct`, `locationLabel`), add:

```tsx
/**
 * A SEARCH link on RateMyProfessors, scoped to UBC (school 1413). Built from
 * the name - this app makes no request to RMP. Their robots.txt disallows
 * automated clients, so their ratings are not ingested; a student who wants
 * one follows this link and reads it in RMP's own context.
 */
function rmpSearchHref(name: string): string {
  return `https://www.ratemyprofessors.com/search/professors/1413?q=${encodeURIComponent(name)}`;
}

function ratingLine(r: InstructorRatingSummary): string {
  const parts: string[] = [];
  if (r.likedPercent !== null) parts.push(`${r.likedPercent}% liked`);
  if (r.clear !== null) parts.push(`clear ${r.clear.toFixed(1)}/5`);
  if (r.engaging !== null) parts.push(`engaging ${r.engaging.toFixed(1)}/5`);
  parts.push(`${r.count} review${r.count === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
```

Import the type: add `InstructorRatingSummary` to the existing `import type { CourseDetail, CourseSectionDetail } from '@/lib/course-detail';` line.

- [ ] **Step 2: Replace the instructor list markup**

The section row currently renders instructors as a single comma-joined `<p>` of links. Replace that block with one line per instructor, so each can carry its own rating and link:

```tsx
                          {s.instructors.length > 0 && (
                            <ul className="mt-0.5 space-y-0.5">
                              {s.instructors.map((i) => (
                                <li key={i.slug} className="text-xs">
                                  <Link
                                    href={`/professor/${i.slug}`}
                                    className="text-brand-accent hover:underline"
                                  >
                                    {i.name}
                                  </Link>
                                  <a
                                    href={rmpSearchHref(i.name)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    aria-label={`Look up ${i.name} on RateMyProfessors`}
                                    title="Look up on RateMyProfessors"
                                    className="ml-1.5 text-text-tertiary hover:text-foreground"
                                  >
                                    ↗
                                  </a>
                                  {i.rating ? (
                                    <span className="ml-1.5 text-text-secondary">
                                      {ratingLine(i.rating)}
                                    </span>
                                  ) : (
                                    <span className="ml-1.5 text-text-tertiary">No reviews yet</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
```

Keep everything else in the section row - section code, activity, meetings, location, seats, add/remove - exactly as it is.

- [ ] **Step 3: Verify and commit**

```bash
npx tsc --noEmit
npx vitest run
grep -nE "slate-[0-9]|blue-[0-9]|red-[0-9]" src/components/schedule/course-info/CourseInfoContent.tsx
```

The grep must print nothing. Also confirm no request is made to RMP:

```bash
grep -rniE "fetch\(.*ratemyprof|ratemyprofessors.com/graphql" src/
```

Must print nothing - only the search-href string may mention the domain.

```bash
git add src/components/schedule/course-info/CourseInfoContent.tsx
git commit -m "feat: show our instructor ratings and an RMP link in the course overlay"
```

---

### Task 3: Verify in a real browser

**Files:**
- Create (temporary, NOT committed): `_smoke_ratings.mjs`

- [ ] **Step 1: Confirm the dev server**

```bash
curl -sf http://localhost:3000 >/dev/null && echo UP
```

A dev server is already running - do NOT start a second.

- [ ] **Step 2: Write the smoke script**

Create `_smoke_ratings.mjs`. It seeds a review so the rated path is actually exercised, then cleans up.

```js
import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const email = `ratings-${Date.now()}@example.com`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

let seededUserId = null;
try {
  // A section that has an instructor, so the instructor line renders at all.
  const section = await prisma.section.findFirstOrThrow({
    where: { instructors: { some: {} }, meetingTimes: { some: { startTime: { not: null } } } },
    include: { course: { include: { subject: true } }, instructors: { include: { instructor: true } } },
  });
  const code = `${section.course.subject.code} ${section.course.number}`;
  const instructor = section.instructors[0].instructor;

  // Seed one review so the rated branch is exercised, not just the empty one.
  const u = await prisma.user.create({ data: { email } });
  seededUserId = u.id;
  await prisma.instructorReview.create({
    data: {
      userId: u.id,
      instructorId: instructor.id,
      courseId: section.courseId,
      liked: true,
      clear: 4,      // storage is 0-4; displays as 5
      engaging: 3,   // displays as 4
    },
  });

  await page.goto(`http://localhost:3000/schedule/new?termId=${encodeURIComponent(section.termId)}`);
  await page.click('button:text-is("Find Courses")');
  await page.fill('input[aria-label="Search courses"]', code);
  await page.waitForSelector(`summary:has-text("${code}")`, { timeout: 8000 });
  await page.click(`button[aria-label="Course information for ${code}"]`);
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
  await page.waitForSelector('text=Sections this term');

  const dialog = await page.locator('[role="dialog"]').innerText();
  console.log('INSTRUCTOR NAME SHOWN:', dialog.includes(instructor.name));
  console.log('RATING SHOWN:', /\d+ review/.test(dialog));
  console.log('LIKED SHOWN:', dialog.includes('% liked'));

  const rmp = page.locator(`a[aria-label="Look up ${instructor.name} on RateMyProfessors"]`);
  console.log('RMP LINK PRESENT:', (await rmp.count()) > 0);
  const href = await rmp.first().getAttribute('href');
  console.log('RMP HREF:', href);
  console.log('RMP HREF IS A SEARCH URL, SCHOOL 1413:', href.includes('/search/professors/1413?q='));

  await page.screenshot({ path: 'ratings-light.png' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'ratings-dark.png' });

  console.log('CONSOLE ERRORS:', JSON.stringify(errors));
} finally {
  if (seededUserId) {
    await prisma.instructorReview.deleteMany({ where: { userId: seededUserId } });
    await prisma.user.delete({ where: { id: seededUserId } }).catch(() => {});
  }
  await browser.close();
  await prisma.$disconnect();
}
```

- [ ] **Step 3: Run it**

Run: `node --env-file=.env _smoke_ratings.mjs`
Expected: every check `true`, the href a `/search/professors/1413?q=…` URL, and `CONSOLE ERRORS: []`.

**Also confirm no network request went to RMP.** The page must not call them - the link is inert until clicked. If you want belt-and-braces, add a `page.on('request', …)` that records any URL containing `ratemyprofessors` and assert it stayed empty.

- [ ] **Step 4: Look at both screenshots**

Confirm by eye:
1. Each instructor is on its own line, name linked, with the ↗ RMP link beside it.
2. The seeded instructor shows a rating summary; any unrated instructor shows "No reviews yet" with no empty furniture.
3. The section row is still readable - code, activity, times, location, seats, add/remove all intact and not crowded out.
4. Readable in BOTH themes; no navy-on-charcoal.

- [ ] **Step 5: Clean up**

```bash
rm -f _smoke_ratings.mjs ratings-light.png ratings-dark.png
git status --short
```

Expected: clean tree. Nothing to commit.

---

## Phase 5 done when

- Every instructor in the course overlay shows their name, an RMP search link, and either our rating summary or "No reviews yet".
- The app makes **zero** requests to RateMyProfessors.
- No `InstructorRating` model and no ingest job exist.
- An unrated instructor renders cleanly.
- `npx vitest run` and `npx tsc --noEmit` clean.

## Deliberately not in this phase

- **Ingesting RateMyProfessors data.** See the spike note; their robots.txt disallows it. Revisit only via a licensed feed.
- Per-course instructor ratings (rating scoped to this course rather than overall). The data is far too sparse today; revisit when review volume supports it.
- Showing instructor ratings anywhere other than the course overlay - the professor page already has its own `RatingsBox`.
