'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { removeCourse } from '@/app/actions/account';
import ConfirmDialog from '@/components/ConfirmDialog';

/**
 * A course on the Account page, collapsible so a full timetable can be
 * skimmed without scrolling past every meeting time.
 *
 * Closed by default: a term's worth of courses is meant to be scannable at a
 * glance, and the meeting times are detail you open when you want them.
 *
 * The course link sits inside the <summary>, where a plain click would both
 * navigate AND toggle the card. preventDefault stops the toggle, so the push
 * has to be issued by hand - the same reason CourseHeaderActions intercepts
 * its clicks in the schedule panels.
 */
export default function EnrolledCourseCard({
  code,
  title,
  href,
  courseId,
  termId,
  canRemove,
  collapsible,
  children,
}: {
  code: string;
  title: string;
  href: string;
  courseId: string;
  /** Null on an academic-record course, which carries no term. */
  termId: string | null;
  /**
   * Only current and upcoming terms offer removal. Removing is for a schedule
   * change or a drop; a finished course is history, and taking it off would
   * quietly change degree progress and review eligibility with no way back
   * except re-importing the academic record.
   */
  canRemove: boolean;
  /** False when there are no meetings to hide, so the card renders inert. */
  collapsible: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      const result = await removeCourse(courseId, termId);
      if (!result.ok) {
        setError(result.error);
        setBusy(false);
        return;
      }
      setConfirming(false);
      setBusy(false);
      // The lists on this page are rendered on the server from the rows this
      // just deleted, so without a refresh the card stays on screen.
      router.refresh();
    } catch {
      setError('Could not remove that course. Try again in a moment.');
      setBusy(false);
    }
  }

  // Sits in the header so it is reachable on a card with no meetings to
  // expand. Inside a <summary> a plain click would also toggle the card, the
  // same reason the course link above intercepts its own. Absent entirely on a
  // finished term: see `canRemove`.
  const removeButton = !canRemove ? null : (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setConfirming(true);
      }}
      // Named for a screen reader, where a page of cards is otherwise a list
      // of identical "Remove" buttons.
      aria-label={`Remove ${code}`}
      className="mt-0.5 shrink-0 rounded-pill border border-border px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:border-danger-border hover:bg-danger-surface hover:text-danger"
    >
      Remove
    </button>
  );

  const dialog = !canRemove ? null : (
    <ConfirmDialog
      open={confirming}
      title={`Remove ${code}?`}
      confirmLabel="Remove course"
      destructive
      busy={busy}
      onConfirm={onConfirm}
      onCancel={() => {
        if (busy) return;
        setConfirming(false);
        setError(null);
      }}
    >
      <p>
        This takes {code} off your account, along with its meeting times, its exams, and
        any syllabus you recorded for it. Uploading a Workday export that still lists this
        course will bring the course back, but not the syllabus.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-danger">
          {error}
        </p>
      )}
    </ConfirmDialog>
  );

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
      {removeButton}
      {/*
        A card with no meetings has no chevron, but it still reserves the
        chevron's slot. Without it the Remove button slides right into that
        space and sits out of line with every other card in the list, which is
        what a course with no fixed meeting time (CRWR 200) looked like.
      */}
      {collapsible ? (
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
      ) : (
        <span aria-hidden className="mt-1 h-4 w-4 shrink-0" />
      )}
    </>
  );

  // The dialog is rendered OUTSIDE the <details> on purpose. showModal() puts
  // it in the top layer, but events still bubble along the DOM tree, so a
  // click on Cancel from inside <summary> would toggle the card underneath.
  if (!collapsible) {
    return (
      <>
        <div className="rounded-card border border-border bg-surface p-4">
          <div className="flex items-start gap-2">{header}</div>
        </div>
        {dialog}
      </>
    );
  }

  return (
    <>
      <details className="group rounded-card border border-border bg-surface">
        <summary className="flex cursor-pointer list-none items-start gap-2 p-4 [&::-webkit-details-marker]:hidden">
          {header}
        </summary>
        <div className="space-y-3 border-t border-border px-4 pb-4 pt-3">{children}</div>
      </details>
      {dialog}
    </>
  );
}
