// The file is posted through a Vercel Function via req.formData(), which caps
// request bodies at ~4.5MB - anything larger is rejected by the platform
// with a 413 before this code ever runs, surfacing as a generic error. `next
// dev` has no such limit, so this is invisible locally. Same reasoning as
// the 2MB cap in src/app/api/upload/route.ts.
export const MAX_SYLLABUS_BYTES = 4 * 1024 * 1024;

/**
 * Every check a syllabus upload must pass BEFORE any blob write - pure, so
 * both the upload route and its tests can run it with no network or disk.
 */
export function validateSyllabusFile(file: { type: string; size: number; name: string }): string | null {
  if (file.type !== 'application/pdf') {
    return 'Only PDF files are accepted.';
  }
  if (file.size === 0) {
    return 'That file is empty.';
  }
  if (file.size > MAX_SYLLABUS_BYTES) {
    return 'That file is too large (max 4 MB).';
  }
  return null;
}

// Pasted syllabus text is sent to Claude as input tokens, so its length is
// capped BEFORE the paid call can ever be made (see extract.ts, which refuses
// to send more than this). 100k characters is roughly 25k tokens: several
// times a long UBC syllabus (a 10-page PDF runs 10-15k tokens) and still only
// about 12 cents of input at $5/MTok. An uncapped paste is an unbounded bill.
export const MAX_SYLLABUS_TEXT_CHARS = 100_000;

// Long enough for a real Canvas deep link with query parameters, short enough
// that nobody can park a document in this column.
export const MAX_SYLLABUS_URL_CHARS = 2048;

/**
 * A syllabus link is a bookmark: it is stored, shown, and opened by the
 * student, and NEVER fetched server-side. It still has to be a real web link,
 * because it ends up in an href: `javascript:` and `data:` are the reason
 * this parses the URL rather than testing for a prefix.
 */
export function validateSyllabusUrl(url: string): string | null {
  if (url.trim() === '') {
    return 'Paste a link first.';
  }
  if (url.length > MAX_SYLLABUS_URL_CHARS) {
    return 'That link is too long.';
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "That doesn't look like a link. It should start with https://";
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Only http:// and https:// links are accepted.';
  }
  return null;
}

/** Same shape as the file and url checks, run before anything is stored. */
export function validateSyllabusText(text: string): string | null {
  if (text.trim() === '') {
    return 'Paste the syllabus text first.';
  }
  if (text.length > MAX_SYLLABUS_TEXT_CHARS) {
    return `That's too long to read (max ${MAX_SYLLABUS_TEXT_CHARS.toLocaleString()} characters). `
      + 'Paste just the syllabus, not the whole course site.';
  }
  return null;
}

/**
 * Strips everything but word chars, dots, and hyphens from a filename before
 * it's used in a blob key or an HTTP header value - a CR/LF or quote in an
 * uploaded file's name would otherwise land unescaped in the
 * Content-Disposition header (header injection) or the blob pathname.
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.-]/g, '_');
}
