export const FEED_HOST = 'canvas.ubc.ca';
export const FEED_PATH_PREFIX = '/feeds/calendars/';
const MAX_LEN = 512;

/**
 * The whole defence against server-side request forgery. This is why fetching
 * a student-supplied URL is acceptable here when it was refused for syllabus
 * links: after this check a request can only ever reach Canvas's feed path.
 * Applied at connect time AND again in the job after decrypting, so a key or
 * data problem cannot turn into a request to an arbitrary host.
 */
export function normalizeFeedUrl(input: string): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = input.trim().replace(/^webcal:\/\//i, 'https://');
  if (trimmed.length === 0 || trimmed.length > MAX_LEN) {
    return { ok: false, error: 'Paste the Calendar Feed link from Canvas.' };
  }
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, error: 'That is not a link.' };
  }
  if (u.protocol !== 'https:' || u.hostname !== FEED_HOST || !u.pathname.startsWith(FEED_PATH_PREFIX)) {
    return {
      ok: false,
      error: 'That is not a canvas.ubc.ca Calendar Feed link. In Canvas, open Calendar and click Calendar Feed.',
    };
  }
  return { ok: true, url: u.toString() };
}
