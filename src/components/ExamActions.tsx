'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatDate } from '@/components/ExamList';
import { groupExams, type ExamListItem } from '@/schedule/exams';

export type ExamCourse = { id: string; label: string };

/**
 * Add an exam, and get back one that was hidden. Both sit outside the List and
 * Calendar switch rather than inside either, so neither view is the only way
 * to reach them.
 *
 * Adding costs nothing and needs no syllabus: the student is typing what they
 * already know, so there is no quote to check and no extraction to pay for.
 */
export function AddExamButton({ termId, courses }: { termId: string; courses: ExamCourse[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (courses.length === 0) return null;

  async function submit(form: FormData) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          termId,
          courseId: form.get('courseId'),
          kind: form.get('kind'),
          // Empty strings are what an untouched optional input posts; the
          // route wants a value or nothing.
          date: form.get('date') || null,
          startTime: form.get('startTime') || null,
          location: form.get('location') || null,
          weight: form.get('weight') ? Number(form.get('weight')) : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? 'Could not add that exam.');
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError('Could not add that exam. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-sm font-medium text-brand-accent hover:underline"
        >
          Add exam
        </button>
      </div>
    );
  }

  const field = 'w-full rounded-input border border-border bg-surface px-2 py-1.5 text-sm text-foreground';

  return (
    <form action={submit} className="rounded-card border border-border bg-surface p-4">
      <p className="text-sm font-medium text-foreground">Add an exam</p>
      <p className="mt-1 text-xs text-text-tertiary">
        For a midterm no syllabus mentioned, or an exam UBC has not published. Only the
        course, the kind and the date are needed.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs text-text-tertiary">Course</span>
          <select name="courseId" required className={field} defaultValue={courses[0].id}>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs text-text-tertiary">Kind</span>
          <select name="kind" required className={field} defaultValue="midterm">
            <option value="midterm">Midterm</option>
            <option value="final">Final exam</option>
          </select>
        </label>

        {/* Native date and time inputs: the browser already knows this
            student's locale and gives them a picker for free. */}
        <label className="block">
          <span className="text-xs text-text-tertiary">Date</span>
          <input type="date" name="date" className={field} />
        </label>

        <label className="block">
          <span className="text-xs text-text-tertiary">Start time (optional)</span>
          <input type="time" name="startTime" className={field} />
        </label>

        <label className="block">
          <span className="text-xs text-text-tertiary">Where (optional)</span>
          <input type="text" name="location" maxLength={120} className={field} />
        </label>

        <label className="block">
          <span className="text-xs text-text-tertiary">Worth % (optional)</span>
          <input type="number" name="weight" min={0} max={100} step="any" className={field} />
        </label>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-pill bg-brand px-4 py-2 text-sm font-medium text-brand-foreground disabled:opacity-50"
        >
          {saving ? 'Adding…' : 'Add exam'}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm font-medium text-text-secondary hover:underline"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * What this student has hidden, and the way back.
 *
 * The point of the list: a hidden exam that could not be found again would be
 * a missed final, so nothing is ever removed without somewhere to see it. A
 * cancelled row shows struck through here too - it is still not an exam to sit.
 */
export function HiddenExams({ items }: { items: ExamListItem[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (items.length === 0) return null;

  // One exam, however many rooms it was published in - the same grouping the
  // list and the calendar use, so Restore brings back the exam a student
  // hid, not one room of it.
  const groups = groupExams(items);

  async function restore(group: ExamListItem[]) {
    setBusyId(group[0].id);
    try {
      const ids = group.map((r) => r.id).join(',');
      await fetch(`/api/exams?ids=${encodeURIComponent(ids)}`, { method: 'PATCH' });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <details className="mt-4 rounded-card border border-border bg-surface-muted px-3 py-2">
      <summary className="cursor-pointer text-xs text-text-secondary">
        {groups.length} hidden exam{groups.length === 1 ? '' : 's'}
      </summary>
      <ul className="mt-2 space-y-2">
        {groups.map((group) => {
          const item = group[0];
          return (
            <li key={item.id} className="flex items-center justify-between gap-3">
              <span className={`text-sm text-text-secondary ${item.cancelled ? 'line-through' : ''}`}>
                <span className="font-medium text-foreground">{item.courseLabel}</span>
                {' · '}
                {item.date ? formatDate(item.date) : 'Date TBA'}
                {item.startTime ? ` · ${item.startTime}` : ''}
                {group.length === 1 && item.location ? ` · ${item.location}` : ''}
              </span>
              <button
                type="button"
                disabled={busyId === item.id}
                onClick={() => restore(group)}
                className="shrink-0 text-sm font-medium text-brand-accent hover:underline disabled:opacity-50"
              >
                {busyId === item.id ? 'Restoring…' : 'Restore'}
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
