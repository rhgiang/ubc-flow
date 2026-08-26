import Link from 'next/link';

const AVATAR_COLORS = ['#002145', '#04316b', '#5c6770', '#7a8791', '#3a5a78', '#1f4e79'];

/** Same review id -> same color, every render — not Math.random(). */
function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function Avatar({ id }: { id: string }) {
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white"
      style={{ backgroundColor: colorFor(id) }}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    </div>
  );
}

export type TaughtBy = { name: string; slug: string };

export default function ReviewCard({
  id,
  text,
  tags,
  attribution,
  when,
  taughtBy = [],
}: {
  id: string;
  text: string | null;
  tags: { label: string; value: string }[];
  attribution: string;
  /** Already-formatted age, e.g. "3 days ago". Omitted where it isn't known. */
  when?: string | null;
  /** Who taught the reviewer — the instructors they reviewed alongside this. */
  taughtBy?: TaughtBy[];
}) {
  return (
    <div className="flex gap-3 rounded-card border border-border p-4">
      <Avatar id={id} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
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
        <p className="mt-2 text-xs italic text-text-tertiary">
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
      </div>
    </div>
  );
}
