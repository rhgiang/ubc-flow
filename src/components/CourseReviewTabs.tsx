'use client';

import { useState } from 'react';
import Link from 'next/link';
import ReviewCard, { type TaughtBy } from '@/components/ReviewCard';

export type ReviewItem = {
  id: string;
  text: string | null;
  tags: { label: string; value: string }[];
  when: string;
  taughtBy?: TaughtBy[];
};

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

function List({ reviews }: { reviews: ReviewItem[] }) {
  return (
    <ul className="space-y-4">
      {reviews.map((r) => (
        <li key={r.id}>
          <ReviewCard
            id={r.id}
            text={r.text}
            tags={r.tags}
            attribution="A student"
            when={r.when}
            taughtBy={r.taughtBy}
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
}: {
  courseReviews: ReviewItem[];
  professorGroups: ProfessorGroup[];
}) {
  const [tab, setTab] = useState<'course' | 'professor'>('course');
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

      <div className="mt-4">
        {tab === 'course' ? (
          courseReviews.length === 0 ? (
            <p className="text-sm text-text-secondary">No course reviews yet.</p>
          ) : (
            <List reviews={courseReviews} />
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
                  <List reviews={g.reviews} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
