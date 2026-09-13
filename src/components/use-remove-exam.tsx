'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import ConfirmDialog from '@/components/ConfirmDialog';
import type { ExamListItem } from '@/schedule/exams';

/**
 * Removing an exam, shared by every control that offers it: the detail
 * overlay, the hover x on a list card, and the hover x on a calendar chip.
 *
 * It lives here rather than in the overlay because three callers doing this
 * by hand is three chances for one of them to forget that a group is ONE
 * exam. A final UBC splits across four rooms by surname is four rows and one
 * exam, so removing it removes every row of it.
 *
 * What "remove" means depends on where the row came from, and the route
 * decides: a student's own row is deleted, a scraped UBC row is hidden for
 * this student only, because that row is global and deleting it would take
 * the exam off every other student's schedule too.
 *
 * Only the delete asks first. The x is always visible on touch, and a
 * student's own row is gone for good after one tap; a hidden scraped row is
 * one click away in the hidden list, so it stays one click to hide. The
 * dialog is returned ready to render so the overlay and both x buttons ask
 * the same question.
 */
export function useRemoveExam(onDone?: () => void) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ExamListItem[] | null>(null);

  async function send(rows: ExamListItem[]) {
    setRemoving(true);
    setError(null);
    try {
      const ids = rows.map((r) => r.id).join(',');
      const res = await fetch(`/api/exams?source=${rows[0].source}&ids=${encodeURIComponent(ids)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? 'Could not remove that exam.');
        return;
      }
      onDone?.();
      router.refresh();
    } catch {
      setError('Could not remove that exam. Check your connection and try again.');
    } finally {
      setRemoving(false);
    }
  }

  function remove(rows: ExamListItem[]) {
    if (rows.length === 0) return;
    if (rows[0].source === 'syllabus') setPending(rows);
    else void send(rows);
  }

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      title={`Remove ${pending?.[0].courseLabel ?? 'this'} ${pending?.[0].kind === 'final' ? 'final' : 'midterm'}?`}
      confirmLabel="Remove"
      destructive
      busy={removing}
      onConfirm={() => {
        if (!pending) return;
        const rows = pending;
        setPending(null);
        void send(rows);
      }}
      onCancel={() => setPending(null)}
    >
      This one is yours, so removing it deletes it. There is no hidden list to
      get it back from; you would have to add it again.
    </ConfirmDialog>
  );

  return { remove, removing, error, dialog };
}
