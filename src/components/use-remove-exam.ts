'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
 */
export function useRemoveExam(onDone?: () => void) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(rows: ExamListItem[]) {
    if (rows.length === 0) return;
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

  return { remove, removing, error };
}
