'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getViewerState } from '@/app/actions/viewer';

/**
 * The viewer's personal state (votes, review rights, schedules) fetched
 * client-side, so the page around it can be a cached static render.
 *
 * `loaded: false` is the safe default everywhere: components fall back to
 * their anonymous appearance, which is also exactly what crawlers and
 * signed-out students should see.
 */
type ViewerContextValue = {
  loaded: boolean;
  signedIn: boolean;
  votedReviewIds: Set<string>;
  reviewableCourseIds: Set<string>;
  mayReview: boolean;
  hasMyReview: boolean;
  mySchedules: { id: string; name: string; termId: string }[];
};

const EMPTY: ViewerContextValue = {
  loaded: false,
  signedIn: false,
  votedReviewIds: new Set(),
  reviewableCourseIds: new Set(),
  mayReview: false,
  hasMyReview: false,
  mySchedules: [],
};

const ViewerCtx = createContext<ViewerContextValue>(EMPTY);

export const useViewer = () => useContext(ViewerCtx);

export function ViewerProvider({
  reviewIds,
  courseId,
  wantSchedules = false,
  children,
}: {
  reviewIds?: string[];
  courseId?: string;
  wantSchedules?: boolean;
  children: ReactNode;
}) {
  const [state, setState] = useState<ViewerContextValue>(EMPTY);

  // Serialized so the effect doesn't refire on every render's fresh array.
  const idsKey = (reviewIds ?? []).join(',');

  useEffect(() => {
    let cancelled = false;
    void getViewerState({
      reviewIds: idsKey ? idsKey.split(',') : [],
      courseId,
      wantSchedules,
    })
      .then((v) => {
        if (cancelled) return;
        setState({
          loaded: true,
          signedIn: v.signedIn,
          votedReviewIds: new Set(v.votedReviewIds),
          reviewableCourseIds: new Set(v.reviewableCourseIds),
          mayReview: v.mayReview,
          hasMyReview: v.hasMyReview,
          mySchedules: v.mySchedules,
        });
      })
      // A failed fetch leaves the anonymous view, which still works.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [idsKey, courseId, wantSchedules]);

  const value = useMemo(() => state, [state]);
  return <ViewerCtx.Provider value={value}>{children}</ViewerCtx.Provider>;
}
