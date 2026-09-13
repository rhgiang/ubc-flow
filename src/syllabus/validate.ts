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

/**
 * Strips everything but word chars, dots, and hyphens from a filename before
 * it's used in a blob key or an HTTP header value - a CR/LF or quote in an
 * uploaded file's name would otherwise land unescaped in the
 * Content-Disposition header (header injection) or the blob pathname.
 */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^\w.-]/g, '_');
}
