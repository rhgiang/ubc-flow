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

function ScoreGroup({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <p className="text-xs text-slate-500">{hint}</p>
      <div className="mt-2 flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`h-9 w-9 rounded-lg border text-sm transition-transform duration-150 ease-out hover:scale-110 active:scale-100 ${
              value !== null && n <= value ? 'bg-blue-700 text-white' : 'text-slate-700'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
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
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={`rounded-lg border px-4 py-1.5 text-sm transition-transform duration-150 ease-out hover:scale-[1.03] active:scale-100 ${
            value === true ? 'bg-blue-700 text-white' : 'text-slate-700'
          }`}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={`rounded-lg border px-4 py-1.5 text-sm transition-transform duration-150 ease-out hover:scale-[1.03] active:scale-100 ${
            value === false ? 'bg-blue-700 text-white' : 'text-slate-700'
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

    router.push(`/course/${courseCode}`);
  }

  async function onDelete() {
    setBusy(true);
    setError(null);
    const result = await deleteReview(courseId, courseCode);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    router.push(`/course/${courseCode}`);
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <p className="text-sm text-slate-500">{courseLabel}</p>
      <h1 className="text-3xl font-semibold">{courseTitle}</h1>
      <p className="mt-1 text-slate-600">Write a review</p>

      <form onSubmit={onSubmit} className="mt-8 space-y-8">
        <section className="space-y-5 rounded-lg border p-5">
          <h2 className="text-lg font-semibold">Course</h2>
          <LikedToggle label="Did you like it?" value={liked} onChange={setLiked} />
          <ScoreGroup
            label="Usefulness"
            hint="1 = not useful, 5 = very useful"
            value={useful}
            onChange={setUseful}
          />
          <ScoreGroup
            label="Difficulty"
            hint="1 = very easy, 5 = very hard"
            value={difficulty}
            onChange={setDifficulty}
          />
          <div>
            <label className="text-sm font-medium text-slate-700" htmlFor="workloadHours">
              Workload (hours/week)
            </label>
            <input
              id="workloadHours"
              type="number"
              min={0}
              max={100}
              value={workloadHours}
              onChange={(e) => setWorkloadHours(e.target.value)}
              className="mt-2 w-32 rounded-lg border px-3 py-1.5"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700" htmlFor="courseText">
              Comments
            </label>
            <textarea
              id="courseText"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              className="mt-2 w-full rounded-lg border px-3 py-2"
            />
          </div>
        </section>

        <section className="space-y-4 rounded-lg border p-5">
          <h2 className="text-lg font-semibold">Instructors</h2>
          {instructors.length === 0 && (
            <p className="text-sm text-slate-500">No instructors on record for this course.</p>
          )}
          {instructors.map((i) => {
            const state = selected.get(i.id);
            const checked = state !== undefined;
            return (
              <div key={i.id} className="border-t pt-4 first:border-t-0 first:pt-0">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
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
                      hint="1 = very unclear, 5 = very clear"
                      value={state.clear}
                      onChange={(v) => updateInstructor(i.id, { clear: v })}
                    />
                    <ScoreGroup
                      label="Engagement"
                      hint="1 = not engaging, 5 = very engaging"
                      value={state.engaging}
                      onChange={(v) => updateInstructor(i.id, { engaging: v })}
                    />
                    <textarea
                      value={state.text}
                      onChange={(e) => updateInstructor(i.id, { text: e.target.value })}
                      rows={3}
                      placeholder="Comments about this instructor"
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {error && <p className="text-sm text-red-700">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-blue-700 px-5 py-2 text-white transition-transform duration-150 ease-out hover:scale-[1.02] active:scale-100 disabled:opacity-50"
          >
            {busy ? 'Saving…' : existing ? 'Update review' : 'Submit review'}
          </button>
          {existing && (
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="rounded-lg border px-5 py-2 text-slate-700 transition-transform duration-150 ease-out hover:scale-[1.02] active:scale-100 disabled:opacity-50"
            >
              Delete review
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
