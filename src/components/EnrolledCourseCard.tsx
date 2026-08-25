'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * A course on the Account page, collapsible so a full timetable can be
 * skimmed without scrolling past every meeting time.
 *
 * Open by default: the meeting details are the reason the card exists, and a
 * student who has just uploaded an export wants to see what landed.
 *
 * The course link sits inside the <summary>, where a plain click would both
 * navigate AND toggle the card. preventDefault stops the toggle, so the push
 * has to be issued by hand — the same reason CourseHeaderActions intercepts
 * its clicks in the schedule panels.
 */
export default function EnrolledCourseCard({
  code,
  title,
  href,
  collapsible,
  children,
}: {
  code: string;
  title: string;
  href: string;
  /** False when there are no meetings to hide, so the card renders inert. */
  collapsible: boolean;
  children: ReactNode;
}) {
  const router = useRouter();

  const header = (
    <>
      <span className="min-w-0 flex-1">
        <a
          href={href}
          onClick={(e) => {
            e.preventDefault();
            router.push(href);
          }}
          className="font-medium text-brand-accent hover:underline"
        >
          {code}
        </a>
        <span className="ml-2 text-sm text-text-secondary">{title}</span>
      </span>
      {collapsible && (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          aria-hidden
          className="mt-1 h-4 w-4 shrink-0 text-text-tertiary transition-transform group-open:rotate-180"
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </>
  );

  if (!collapsible) {
    return (
      <div className="rounded-card border border-border bg-surface p-4">
        <div className="flex items-start gap-2">{header}</div>
      </div>
    );
  }

  return (
    <details open className="group rounded-card border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-start gap-2 p-4 [&::-webkit-details-marker]:hidden">
        {header}
      </summary>
      <div className="space-y-3 border-t border-border px-4 pb-4 pt-3">{children}</div>
    </details>
  );
}
