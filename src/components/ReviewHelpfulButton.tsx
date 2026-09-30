'use client';

import { useEffect, useState, useTransition } from 'react';
import { toggleReviewVote, type VoteKind } from '@/app/actions/review-votes';
import { useAuthOverlay } from '@/components/AuthOverlayContext';
import { useViewer } from '@/components/ViewerContext';
import { settled } from '@/lib/action-result';

/**
 * "Helpful" on someone else's review - UW Flow's upvote, under a name that
 * says what it means. Anonymous in the same sense the reviews are: the server
 * records who voted so it can be taken back and counted once, and only the
 * total is ever rendered.
 *
 * The count moves before the round trip. A vote is cheap and reversible, and
 * waiting on the server to redraw a number makes it feel broken.
 */
export default function ReviewHelpfulButton({
  reviewId,
  kind,
  votes,
  voted,
  signedIn,
}: {
  reviewId: string;
  kind: VoteKind;
  votes: number;
  voted: boolean;
  signedIn: boolean;
}) {
  const [state, setState] = useState({ votes, voted });
  const [pending, startTransition] = useTransition();
  const { open } = useAuthOverlay();
  // On a statically served page the props arrive in their anonymous shape
  // (voted false, signedIn false); the viewer's real state loads client-side
  // and is applied once here. Pages without a ViewerProvider never load, so
  // their server-provided props stand untouched.
  const viewer = useViewer();
  useEffect(() => {
    if (!viewer.loaded) return;
    setState((s) => ({ ...s, voted: viewer.votedReviewIds.has(reviewId) }));
    // Once: applying again after a local toggle would undo the user's click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer.loaded]);
  const effectiveSignedIn = signedIn || viewer.signedIn;

  function onClick() {
    if (!effectiveSignedIn) {
      open('login');
      return;
    }
    const next = { voted: !state.voted, votes: state.votes + (state.voted ? -1 : 1) };
    const previous = state;
    setState(next);
    startTransition(async () => {
      const result = await settled(toggleReviewVote(reviewId, kind));
      // Server disagrees, refuses, or was never reached: take the optimistic
      // change back rather than leaving a number nobody else can see. The
      // third case is why this goes through settled - a dropped request used
      // to throw past this line, leaving the vote looking counted.
      if (!result.ok) setState(previous);
      else setState({ voted: result.voted, votes: result.votes });
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={state.voted}
      aria-label={state.voted ? 'Remove helpful' : 'Mark this review helpful'}
      className={`inline-flex items-center gap-1.5 rounded-pill border px-3 py-1 text-xs font-medium transition duration-150 ease-out hover:scale-[1.03] active:scale-100 disabled:opacity-60 max-sm:min-h-8 max-sm:px-3.5 ${
        state.voted
          ? 'border-brand bg-brand text-brand-foreground'
          : 'border-border text-text-secondary hover:text-foreground'
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        fill={state.voted ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={1.75}
        aria-hidden
        className="h-3.5 w-3.5"
      >
        <path
          d="M7 22V10l5-8a2.5 2.5 0 0 1 2.4 3.1L13.5 9H19a2 2 0 0 1 2 2.3l-1.2 8A2 2 0 0 1 17.8 21H7Z"
          strokeLinejoin="round"
        />
        <path d="M7 10H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" strokeLinejoin="round" />
      </svg>
      Helpful
      {state.votes > 0 && <span className="tabular-nums">{state.votes}</span>}
    </button>
  );
}
