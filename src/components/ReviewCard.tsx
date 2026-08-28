import Link from 'next/link';
import { GLYPHS } from './avatar-glyphs';
import ReviewHelpfulButton from '@/components/ReviewHelpfulButton';
import type { VoteKind } from '@/app/actions/review-votes';

// The two slate tones used to run lighter (#5c6770 / #7a8791). The old avatar
// was one big solid figure and carried it; these glyphs have hairlines, and
// they turned to mush against a mid-grey.
const AVATAR_COLORS = ['#002145', '#04316b', '#41505c', '#55636e', '#3a5a78', '#1f4e79'];

/**
 * Same review id -> same avatar, every render — not Math.random(), which would
 * differ between the server pass and hydration.
 *
 * Note the id is the *review* id, never the reviewer's. Keying on a user would
 * give one person the same icon on every review they ever left, which is all
 * anyone would need to thread them together across courses and instructors —
 * on a site whose whole premise is that reviews are anonymous.
 */
function hash(id: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function avatarFor(id: string) {
  // Two seeds, so the glyph and the colour vary independently. One hash driving
  // both would tie each glyph to a fixed subset of the colours.
  return {
    color: AVATAR_COLORS[hash(id, 0) % AVATAR_COLORS.length],
    glyph: GLYPHS[hash(id, 0x9e37) % GLYPHS.length],
  };
}

function Avatar({ id }: { id: string }) {
  const { color, glyph } = avatarFor(id);
  return (
    <div
      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-white"
      style={{ backgroundColor: color }}
      aria-hidden
    >
      {/* Filled, not stroked: the glyphs are traced silhouettes whose cutouts are
          real holes, so the circle shows through them on its own. */}
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-9 w-9">
        {glyph.art}
      </svg>
    </div>
  );
}

export type TaughtBy = { name: string; slug: string };

/**
 * Both thumbs, with the one they picked coloured and the other left grey —
 * UW Flow's ThumbsRatings. Showing only the chosen thumb leaves the reader
 * deciding whether a lone grey thumb means "no" or "did not answer"; showing
 * the pair makes the answer obvious at a glance.
 */
function ThumbIcon({ down }: { down?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={`block h-5 w-5 ${down ? 'rotate-180' : ''}`}
    >
      <path d="M7 22V10l5-8a2.5 2.5 0 0 1 2.4 3.1L13.5 9H19a2 2 0 0 1 2 2.3l-1.2 8A2 2 0 0 1 17.8 21H7Z" />
      <path d="M6 10H3.6a.6.6 0 0 0-.6.6v10.8c0 .3.3.6.6.6H6V10Z" />
    </svg>
  );
}

function LikedThumbs({ liked }: { liked: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 leading-none">
      <span className="text-xs leading-none text-text-secondary">Liked:</span>
      <span
        className={`inline-flex items-center leading-none ${
          liked ? 'text-brand-accent' : 'text-text-tertiary/40'
        }`}
      >
        <ThumbIcon />
      </span>
      <span
        className={`inline-flex items-center leading-none ${
          liked ? 'text-text-tertiary/40' : 'text-danger'
        }`}
      >
        <ThumbIcon down />
      </span>
      <span className="sr-only">{liked ? 'Enjoyed it' : 'Did not enjoy it'}</span>
    </span>
  );
}

export default function ReviewCard({
  id,
  text,
  tags,
  liked,
  attribution,
  when,
  taughtBy = [],
  vote,
}: {
  id: string;
  text: string | null;
  tags: { label: string; value: string }[];
  /** Rendered as a thumb rather than "Liked: Yes"; null means unanswered. */
  liked?: boolean | null;
  attribution: string;
  /** Already-formatted age, e.g. "3 days ago". Omitted where it isn't known. */
  when?: string | null;
  /** Who taught the reviewer — the instructors they reviewed alongside this. */
  taughtBy?: TaughtBy[];
  /** Omit to hide the helpful button entirely (the professor page's own list). */
  vote?: { kind: VoteKind; votes: number; voted: boolean; signedIn: boolean };
}) {
  return (
    <div className="flex gap-4 rounded-card border border-border p-4">
      <Avatar id={id} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
          {liked !== null && liked !== undefined && <LikedThumbs liked={liked} />}
          {tags.map((t) => (
            <span key={t.label}>
              {t.label}: {t.value}
            </span>
          ))}
        </div>
        {text && <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{text}</p>}
        {/* One line, the way every review site signs off: who, when, and under
            whom. The professor is a link because it is the next thing a reader
            wants after "was this course any good under them". */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs italic text-text-tertiary">
          — {attribution}
          {when ? ` ${when}` : ''}
          {taughtBy.length > 0 && (
            <>
              , taught by{' '}
              {taughtBy.map((p, i) => (
                <span key={p.slug}>
                  {i > 0 && ' and '}
                  <Link
                    href={`/professor/${p.slug}`}
                    className="not-italic text-brand-accent hover:underline"
                  >
                    {p.name}
                  </Link>
                </span>
              ))}
            </>
          )}
        </p>
        {vote && (
          <ReviewHelpfulButton
            reviewId={id}
            kind={vote.kind}
            votes={vote.votes}
            voted={vote.voted}
            signedIn={vote.signedIn}
          />
        )}
        </div>
      </div>
    </div>
  );
}
