'use client';

import { useEffect, useState } from 'react';
import { getCourseDetail } from '@/app/actions/course';
import type { CourseDetail } from '@/lib/course-detail';

/**
 * Module scope, not a ref: the modal and the docked panel are two different
 * components, so a per-component cache would refetch every time a student
 * pops the panel out or back in. Keyed on course AND term because the section
 * list is term-scoped.
 */
const cache = new Map<string, CourseDetail>();

export function useCourseDetail(
  courseId: string | null,
  termId: string,
): { detail: CourseDetail | null; loading: boolean } {
  const [detail, setDetail] = useState<CourseDetail | null>(null);
  const [loading, setLoading] = useState(courseId !== null);

  useEffect(() => {
    if (!courseId) {
      setDetail(null);
      setLoading(false);
      return;
    }
    const key = `${courseId}:${termId}`;
    const cached = cache.get(key);
    if (cached) {
      setDetail(cached);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setDetail(null);
    (async () => {
      const result = await getCourseDetail(courseId, termId);
      // Cache regardless of cancellation — a response is still valid data even
      // if this component no longer wants to render it.
      if (result) cache.set(key, result);
      // A slower earlier request must never overwrite a newer one.
      if (cancelled) return;
      setDetail(result);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, termId]);

  return { detail, loading };
}
