'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { submitReview, deleteReview } from '@/app/actions/reviews';
import { toStoredScore, toDisplayScore } from '@/reviews/aggregate';

type Instructor = { id: string; name: string };

type ExistingCourse =
  | {
      liked: boolean | null;
      useful: number | null;
      difficulty: number | null;
      workloadHours: number | null;
      text: string | null;
    }
  | null
  | undefined;

type ExistingInstructor = {
  instructorId: string;
  liked: boolean | null;
  clear: number | null;
  engaging: number | null;
  text: string | null;
};

type InstructorState = {
  liked: boolean | null;
  clear: number | null; // 1-5 display scale
  engaging: number | null; // 1-5 display scale
  text: string;
};

/**
 * What each number means, said the way a student would say it. An unlabelled
 * 1-5 leaves everyone with their own private idea of what a 3 is, and the
 * average of that is worth very little.
 */
export const SCALE_DESCRIPTIONS = {
  useful: [
    'Got nothing out of it',
    'A couple of useful lessons',
    'Some useful stuff, nothing I lean on',
    'Really useful, it comes up in other courses',
    "One of the most useful courses I've taken",
  ],
  difficulty: [
    'Easy marks, barely had to try',
    'Pretty easy if you show up',
    "Fair. Keep up and you're fine",
    'Tough, either the workload or the concepts',
    'Brutal, I was behind most of the term',
  ],
  clear: [
    'Lost me. I taught myself from other sources',
    'Often confusing, I needed outside help',
    'Mostly clear, some messy lectures',
    'Explained things well',
    'Exceptionally clear, made hard ideas feel simple',
  ],
  engaging: [
    'Hard to stay awake',
    'Pretty dry',
    'Held my attention some days',
    'Kept me interested',
    'Captivating, I looked forward to lectures',
  ],
} as const;

function ScoreGroup({
  label,
  hint,
  descriptions,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  descriptions: readonly string[];
  value: number | null;
  onChange: (v: number) => void;
}) {
  // Hovering describes a number before you commit to it; the chosen one takes
  // over the moment the pointer leaves.
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = hovered ?? value;

  return (
    <div>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="mt-2 flex gap-2" onMouseLeave={() => setHovered(null)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            onMouseEnter={() => setHovered(n)}
            onFocus={() => setHovered(n)}
            onBlur={() => setHovered(null)}
            aria-label={`${n} — ${descriptions[n - 1]}`}
            aria-pressed={value === n}
            className={`h-9 w-9 rounded-lg border text-sm transition-transform duration-150 ease-out hover:scale-110 active:scale-100 ${
              value !== null && n <= value
                ? 'border-brand bg-brand text-brand-foreground'
                : 'border-border text-foreground'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
      {/* Fixed height: the line changes on hover, and a jumping form is worse
          than a blank line. */}
      <p className="mt-2 min-h-[1.25rem] text-xs text-text-secondary">
        {shown === null ? hint : `${shown} — ${descriptions[shown - 1]}`}
      </p>
    </div>
  );
}

function LikedToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-foreground">{label}</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={`rounded-lg border px-4 py-1.5 text-sm transition-transform duration-150 ease-out hover:scale-[1.03] active:scale-100 ${
            value === true
              ? 'border-brand bg-brand text-brand-foreground'
              : 'border-border text-foreground'
          }`}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={`rounded-lg border px-4 py-1.5 text-sm transition-transform duration-150 ease-out hover:scale-[1.03] active:scale-100 ${
            value === false
              ? 'border-brand bg-brand text-brand-foreground'
              : 'border-border text-foreground'
          }`}
        >
          No
        </button>
      </div>
    </div>
  );
}

export function ReviewForm({
  courseId,
  courseCode,
  courseLabel,
  courseTitle,
  instructors,
  existing,
  existingInstructors,
}: {
  courseId: string;
  courseCode: string;
  courseLabel: string;
  courseTitle: string;
  instructors: Instructor[];
  existing: ExistingCourse;
  existingInstructors: ExistingInstructor[];
}) {
  const router = useRouter();

  const [liked, setLiked] = useState<boolean | null>(existing?.liked ?? null);
  const [useful, setUseful] = useState<number | null>(toDisplayScore(existing?.useful ?? null));
  const [difficulty, setDifficulty] = useState<number | null>(
    toDisplayScore(existing?.difficulty ?? null),
  );
  const [workloadHours, setWorkloadHours] = useState<string>(
    existing?.workloadHours != null ? String(existing.workloadHours) : '',
  );
  const [text, setText] = useState(existing?.text ?? '');

  // Existing per-instructor reviews, keyed for pre-checking + pre-filling on selection.
  const [existingByInstructor] = useState(
    () => new Map(existingInstructors.map((r) => [r.instructorId, r])),
  );
  const [selected, setSelected] = useState<Map<string, InstructorState>>(
    () =>
      new Map(
        existingInstructors.map((r) => [
          r.instructorId,
          {
            liked: r.liked,
            clear: toDisplayScore(r.clear),
            engaging: toDisplayScore(r.engaging),
            text: r.text ?? '',
          },
        ]),
      ),
  );

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleInstructor(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (checked) {
        const entry = existingByInstructor.get(id);
        next.set(id, {
          liked: entry?.liked ?? null,
          clear: toDisplayScore(entry?.clear ?? null),
          engaging: toDisplayScore(entry?.engaging ?? null),
          text: entry?.text ?? '',
        });
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function updateInstructor(id: string, patch: Partial<InstructorState>) {
    setSelected((prev) => {
      const current = prev.get(id);
      if (!current) return prev;
      const next = new Map(prev);
      next.set(id, { ...current, ...patch });
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const result = await submitReview(
        courseId,
        courseCode,
        {
          liked,
          useful: toStoredScore(useful),
          difficulty: toStoredScore(difficulty),
          workloadHours: workloadHours.trim() === '' ? null : Number(workloadHours),
          text: text.trim() === '' ? null : text,
        },
        [...selected.entries()].map(([instructorId, s]) => ({
          instructorId,
          liked: s.liked,
          clear: toStoredScore(s.clear),
          engaging: toStoredScore(s.engaging),
          text: s.text.trim() === '' ? null : s.text,
        })),
      );

      if (!result.ok) {
        setError(result.error);
        setBusy(false);
        return;
      }

      // Deliberately still busy: the push is on its way and re-enabling the
      // button here invites a second submit, which is a second review.
      router.push(`/course/${courseCode}`);
    } catch {
      // The costliest stuck button in the app — everything the user typed is
      // still in the form, and leaving it disabled means they cannot resubmit
      // it or, on most browsers, get it back after a reload.
      setError('Could not post your review. It is still here — try again.');
      setBusy(false);
    }
  }

  async function onDelete() {
    setBusy(true);
    setError(null);
    try {
      const result = await deleteReview(courseId, courseCode);
      if (!result.ok) {
        setError(result.error);
        setBusy(false);
        return;
      }
      router.push(`/course/${courseCode}`);
    } catch {
      setError('Could not delete your review just now. Try again in a moment.');
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      {/* Course identity on the sky, the form itself on one solid panel — the
          same arrangement as the course and professor pages. */}
      <div className="sky-hero">
        <p className="text-sm text-text-tertiary">{courseLabel}</p>
        <h1 className="text-3xl font-semibold">{courseTitle}</h1>
        <p className="mt-1 text-text-secondary">Write a review</p>
      </div>

      <form onSubmit={onSubmit} className="sky-panel mt-6 space-y-8 p-6 sm:p-8">
        <section className="space-y-7">
          <h2 className="text-lg font-semibold">Course</h2>
          <LikedToggle label="Did you enjoy the course?" value={liked} onChange={setLiked} />
          <ScoreGroup
            label="Usefulness"
            hint="How much did you actually get out of it?"
            descriptions={SCALE_DESCRIPTIONS.useful}
            value={useful}
            onChange={setUseful}
          />
          <ScoreGroup
            label="Difficulty"
            hint="How hard was it to do well?"
            descriptions={SCALE_DESCRIPTIONS.difficulty}
            value={difficulty}
            onChange={setDifficulty}
          />
          <div>
            <label
              className="block text-sm font-medium text-foreground"
              htmlFor="workloadHours"
            >
              Workload (hours/week)
            </label>
            <p className="text-xs text-text-secondary">
              Roughly how long the readings, assignments and studying took each week.
            </p>
            <input
              id="workloadHours"
              type="number"
              min={0}
              max={100}
              value={workloadHours}
              onChange={(e) => setWorkloadHours(e.target.value)}
              className="mt-2 w-28 rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-foreground focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground" htmlFor="courseText">
              Comments
            </label>
            <p className="text-xs text-text-secondary">
              What would you tell someone deciding whether to take it?
            </p>
            <textarea
              id="courseText"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              className="mt-2 w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-foreground focus:outline-none"
            />
          </div>
        </section>

        <section className="space-y-4 border-t border-border pt-8">
          <h2 className="text-lg font-semibold">Instructors</h2>
          {instructors.length === 0 && (
            <p className="text-sm text-text-tertiary">No instructors on record for this course.</p>
          )}
          {instructors.map((i) => {
            const state = selected.get(i.id);
            const checked = state !== undefined;
            return (
              <div key={i.id} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
                <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleInstructor(i.id, e.target.checked)}
                  />
                  {i.name}
                </label>

                {checked && state && (
                  <div className="mt-3 space-y-4 pl-6">
                    <LikedToggle
                      label="Did you like this instructor?"
                      value={state.liked}
                      onChange={(v) => updateInstructor(i.id, { liked: v })}
                    />
                    <ScoreGroup
                      label="Clarity"
                      hint="How well did they explain things?"
                      descriptions={SCALE_DESCRIPTIONS.clear}
                      value={state.clear}
                      onChange={(v) => updateInstructor(i.id, { clear: v })}
                    />
                    <ScoreGroup
                      label="Engagement"
                      hint="Were the lectures worth showing up for?"
                      descriptions={SCALE_DESCRIPTIONS.engaging}
                      value={state.engaging}
                      onChange={(v) => updateInstructor(i.id, { engaging: v })}
                    />
                    <textarea
                      value={state.text}
                      onChange={(e) => updateInstructor(i.id, { text: e.target.value })}
                      rows={3}
                      placeholder="Comments about this instructor"
                      className="w-full rounded-input border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-foreground focus:outline-none"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {error && <p role="alert" className="text-sm text-danger">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-pill bg-brand px-5 py-2 text-sm font-medium text-brand-foreground transition-transform duration-150 ease-out hover:scale-[1.02] active:scale-100 disabled:opacity-50 disabled:hover:scale-100"
          >
            {busy ? 'Saving…' : existing ? 'Update review' : 'Submit review'}
          </button>
          {existing && (
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="rounded-pill border border-border px-5 py-2 text-sm font-medium text-foreground transition-transform duration-150 ease-out hover:scale-[1.02] hover:border-danger-border hover:bg-danger-surface hover:text-danger active:scale-100 disabled:opacity-50 disabled:hover:scale-100"
            >
              Delete review
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
