const MAX_TEXT = 5000;
const MAX_WORKLOAD_HOURS = 100;

export type CourseRatingInput = {
  liked: boolean | null;
  useful: number | null;
  difficulty: number | null;
  workloadHours: number | null;
  text: string | null;
};

export type InstructorRatingInput = {
  liked: boolean | null;
  clear: number | null;
  engaging: number | null;
  text: string | null;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Scores are STORED 0-4. A 5 arriving here means a 1-5 display value leaked through. */
function badScore(v: number | null): boolean {
  if (v === null) return false;
  return !Number.isInteger(v) || v < 0 || v > 4;
}

function cleanText(text: string | null): string | null {
  if (text === null || text === undefined) return null;
  const trimmed = String(text).trim();
  return trimmed.length ? trimmed : null;
}

function textTooLong(text: string | null): boolean {
  return text !== null && text.length > MAX_TEXT;
}

export function validateCourseRating(input: CourseRatingInput): Result<CourseRatingInput> {
  if (badScore(input.useful)) return { ok: false, error: 'Usefulness must be a whole number from 1 to 5.' };
  if (badScore(input.difficulty)) return { ok: false, error: 'Difficulty must be a whole number from 1 to 5.' };

  const w = input.workloadHours;
  if (w !== null && (!Number.isInteger(w) || w < 0 || w > MAX_WORKLOAD_HOURS)) {
    return { ok: false, error: `Workload must be between 0 and ${MAX_WORKLOAD_HOURS} hours.` };
  }

  const text = cleanText(input.text);
  if (textTooLong(text)) return { ok: false, error: `Review must be under ${MAX_TEXT} characters.` };

  return { ok: true, value: { ...input, text } };
}

export function validateInstructorRating(
  input: InstructorRatingInput,
): Result<InstructorRatingInput> {
  if (badScore(input.clear)) return { ok: false, error: 'Clarity must be a whole number from 1 to 5.' };
  if (badScore(input.engaging)) return { ok: false, error: 'Engagement must be a whole number from 1 to 5.' };

  const text = cleanText(input.text);
  if (textTooLong(text)) return { ok: false, error: `Review must be under ${MAX_TEXT} characters.` };

  return { ok: true, value: { ...input, text } };
}
