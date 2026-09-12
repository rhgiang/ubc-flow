export const MAX_SYLLABUS_BYTES = 10 * 1024 * 1024;

/**
 * Every check a syllabus upload must pass BEFORE any blob write — pure, so
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
    return 'That file is too large (max 10 MB).';
  }
  return null;
}
