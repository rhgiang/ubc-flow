/**
 * A SEARCH link into RateMyProfessors for UBC Vancouver (school id 1413),
 * pre-filled with the name — this app makes no request to RMP. Their
 * robots.txt disallows automated clients, so their ratings are never
 * ingested; a student who wants one follows this link and reads it in RMP's
 * own context.
 *
 * ponytail: a search URL, not a resolved profile URL. Deep-linking to the
 * exact professor would mean querying RMP's API for their id — the thing
 * their robots.txt rules out.
 */
export function rmpSearchHref(name: string): string {
  return `https://www.ratemyprofessors.com/search/professors/1413?q=${encodeURIComponent(name)}`;
}
