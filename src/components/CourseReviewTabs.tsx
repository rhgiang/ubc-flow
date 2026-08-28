'use client';

import { useState } from 'react';
import Link from 'next/link';
import ReviewCard, { type TaughtBy } from '@/components/ReviewCard';
import type { VoteKind } from '@/app/actions/review-votes';

export type ReviewItem = {
  id: string;
  text: string | null;
  tags: { label: string; value: string }[];
  liked: boolean | null;
  when: string;
  /** Sorted on, never shown — the displayed age is `when`. */
  createdAt: number;
  votes: number;
  voted: boolean;
  taughtBy?: TaughtBy[];
};

type Sort = 'recent' | 'helpful';

/**
 * UW Flow offers exactly two orders — most recent and most helpful — and falls
 * back to the other when the first ties, which is what keeps a wall of
 * zero-vote reviews in a sensible order under "most helpful".
 */
function sortReviews(reviews: ReviewItem[], sort: Sort): ReviewItem[] {
  return [...reviews].sort((a, b) =>
    sort === 'recent'
      ? b.createdAt - a.createdAt || b.votes - a.votes
      : b.votes - a.votes || b.createdAt - a.createdAt,
  );
}

function SortControl({ value, onChange }: { value: Sort; onChange: (s: Sort) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-text-secondary">
      Sort by
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as Sort)}
        className="rounded-input border border-border bg-background px-2 py-1 text-xs text-foreground focus:border-foreground focus:outline-none"
      >
        <option value="recent">Most recent</option>
        <option value="helpful">Most helpful</option>
      </select>
    </label>
  );
}

export type ProfessorGroup = {
  instructorId: string;
  name: string;
  slug: string;
  reviews: ReviewItem[];
};

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-selected={active}
      role="tab"
      className={`flex-1 px-4 py-3.5 text-center text-sm font-semibold ${
        active
          ? 'bg-surface text-foreground'
          : 'bg-surface-muted text-text-secondary hover:bg-surface hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function List({
  reviews,
  kind,
  signedIn,
}: {
  reviews: ReviewItem[];
  kind: VoteKind;
  signedIn: boolean;
}) {
  return (
    <ul className="space-y-4">
      {reviews.map((r) => (
        <li key={r.id}>
          <ReviewCard
            id={r.id}
            text={r.text}
            tags={r.tags}
            liked={r.liked}
            attribution="A student"
            when={r.when}
            taughtBy={r.taughtBy}
            vote={{ kind, votes: r.votes, voted: r.voted, signedIn }}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * Course reviews and professor reviews as two tabs rather than two stacked
 * lists, following UW Flow: they answer different questions, and the professor
 * half is only useful once it is grouped under the professor it is about —
 * which the flat list never said at all.
 */
export default function CourseReviewTabs({
  courseReviews,
  professorGroups,
  signedIn = false,
}: {
  courseReviews: ReviewItem[];
  professorGroups: ProfessorGroup[];
  signedIn?: boolean;
}) {
  const [tab, setTab] = useState<'course' | 'professor'>('course');
  const [sort, setSort] = useState<Sort>('recent');
  const professorCount = professorGroups.reduce((n, g) => n + g.reviews.length, 0);

  return (
    <div>
      <div className="sky-panel flex overflow-hidden" role="tablist">
        <Tab active={tab === 'course'} onClick={() => setTab('course')}>
          {`Course reviews (${courseReviews.length})`}
        </Tab>
        <Tab active={tab === 'professor'} onClick={() => setTab('professor')}>
          {`Professor reviews (${professorCount})`}
        </Tab>
      </div>

      {(tab === 'course' ? courseReviews.length : professorCount) > 0 && (
        <div className="mt-4 flex justify-end">
          <SortControl value={sort} onChange={setSort} />
        </div>
      )}

      <div className="mt-4">
        {tab === 'course' ? (
          courseReviews.length === 0 ? (
            <p className="text-sm text-text-secondary">No course reviews yet.</p>
          ) : (
            <List reviews={sortReviews(courseReviews, sort)} kind="course" signedIn={signedIn} />
          )
        ) : professorCount === 0 ? (
          <p className="text-sm text-text-secondary">No professor reviews yet.</p>
        ) : (
          <div className="space-y-8">
            {professorGroups.map((g) => (
              <div key={g.instructorId}>
                <div className="flex items-baseline gap-2">
                  <Link
                    href={`/professor/${g.slug}`}
                    className="text-base font-semibold text-brand-accent hover:underline"
                  >
                    {g.name}
                  </Link>
                  <span className="text-xs text-text-tertiary">
                    {g.reviews.length} review{g.reviews.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="mt-3">
                  <List
                    reviews={sortReviews(g.reviews, sort)}
                    kind="instructor"
                    signedIn={signedIn}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
