# Phase 5 Spike - RateMyProfessors ingest feasibility

**Date:** 2026-08-23
**Spec:** `docs/superpowers/specs/2026-08-22-schedule-builder-redesign-design.md` §9
**Conclusion:** Technically viable. **Blocked on policy - recommend NOT building the ingest.**

The spec (§9.1) gated Phase 5 behind this spike and allowed it to conclude "not viable". It
resolves in an unusual way: every technical question came back positive, and the blocker is
one the spike was also meant to surface.

---

## 1. Technical findings - all positive

Endpoint: `POST https://www.ratemyprofessors.com/graphql`

| Question | Answer |
|---|---|
| Reachable server-side? | Yes. HTTP 200, 70-330 ms. |
| Authorization required? | **No.** An unauthenticated POST returns data. The `Basic dGVzdDp0ZXN0` header embedded in their web client is not needed. |
| Is UBC resolvable? | Yes. Relay node id = base64 of `School-1413` → `University of British Columbia`, Vancouver, BC. |
| Can teachers be enumerated? | Yes, via `newSearch.teachers(query: {schoolID}, first, after)`. **5,372 UBC professors**, cursor pagination, `hasNextPage`/`endCursor` both work. |
| Are the fields we need present? | Yes: `firstName`, `lastName`, `department`, `avgRating`, `avgDifficulty`, `numRatings`, `wouldTakeAgainPercent`, `legacyId` (builds the profile URL). |
| Schema introspection? | Enabled. Root fields: `newSearch`, `node`, `oauthURL`, `spammedTeachers`, `teacherTags`, `user`. |

### Name matching is better than the spec feared

§9.3 worried that matching RMP names to our `Instructor` rows would be lossy, and specified
refusing ambiguous matches. Measured over a **300-professor sample** against our 4,176 UBC-V
instructors, normalising both sides (lowercase, strip accents/punctuation, first + last):

- **257 (85.7%)** matched exactly one of ours
- **0** ambiguous (matched more than one)
- 43 no match - expected, these are professors rated on RMP who are not currently teaching a
  scraped section
- 296 of 300 had at least one rating

Zero ambiguity in 300 samples means §9.3's refuse-to-guess rule would almost never fire. The
data quality is good.

---

## 2. The blocker

`https://www.ratemyprofessors.com/robots.txt` contains:

```
User-agent: *
Disallow: /
Allow: /ads.txt
```

A blanket disallow for every agent except a handful of named search-engine crawlers
(Googlebot and friends get explicit carve-outs above it). The same file separately enumerates
and blocks AI crawlers by name, including `anthropic-ai`, `ClaudeBot` and `Claude-Web`.

`/graphql` is not mentioned anywhere in the file, so it is covered by the wildcard `Disallow: /`
like everything else.

This is the site operator stating, in the standard machine-readable way, that automated
clients should not crawl them. The endpoint being unauthenticated is not permission - it is
their web app's own backend, and the absence of a lock is not an invitation.

A nightly job pulling 5,372 professor records and re-serving their ratings inside another
product is squarely what that file asks us not to do. It would also republish content RMP
hosts, which is a separate question from crawling and one this project has no licence for.

**This spike itself made ~7 requests** - enough to characterise the endpoint and size the
match rate, and no more. That is proportionate for evaluating feasibility. A recurring bulk
ingest is a different act, not a larger version of the same one.

---

## 3. Recommendation

**Do not build the ingest.** Do not add the `InstructorRating` model or `npm run ingest:rmp`.

Fall back to what the spec already anticipates in §9.4: the course overlay shows each
instructor's name (it already does, linking to our own professor pages) plus a **link out** to
their RateMyProfessors page. Students who want the rating get it from RMP directly, in RMP's
own context, with RMP's own caveats attached.

That is ~10 lines in `CourseInfoContent.tsx`, needs no model, no job, no schema change, and
no ongoing dependency on an endpoint that can change without notice.

The link can be built from the professor's name without any request to RMP:
`https://www.ratemyprofessors.com/search/professors/1413?q=<name>`

### If ratings inside the product matter enough

Three routes that do not rest on scraping:

1. **Ask RMP.** They have a partnerships contact. A licensed feed is the clean version of this.
2. **Use our own review data.** The app already has `InstructorReview` with clear/engaging/liked
   plus `RatingsBox` to display it. Sparse today, but it is ours, it is UBC-specific, and every
   review is gated behind verified enrolment - arguably better signal than RMP for this audience.
3. **Let students link their own.** A professor page could accept a student-submitted RMP URL.
   Manual, but it is a person choosing to reference a public page, not a crawler.

Route 2 is the one that compounds - it makes the product's own data more valuable rather than
renting someone else's.

---

## 4. What this means for the spec

§9 as written (model, ingest job, `matchQuality`, nightly run) should be struck, and §7's
"Instructor ratings" row rescoped from "RMP score inline" to "link out to RMP, plus our own
instructor ratings where we have them".

Phases 1-4b are unaffected. The overlay's instructor list is already built and already links
to our professor pages; this only changes what sits beside those names.
