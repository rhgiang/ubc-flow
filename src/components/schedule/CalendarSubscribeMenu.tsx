'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The "Add to calendar" menu for any ICS feed — a saved schedule or a term's
 * imported enrollment. The caller mints its own token and hands back the feed
 * URL; everything downstream (webcal, Google, copy, download) is identical.
 */
export default function CalendarSubscribeMenu({
  getUrl,
  align = 'right',
}: {
  /** Called the first time the menu opens. Null when the token can't be minted. */
  getUrl: () => Promise<string | null>;
  /** Which edge the panel hangs from — it is wider than the button either way. */
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    // Minting the token is a DB write the first time, so it waits until a
    // student actually opens the menu.
    // A rejected action used to leave every item silently inert — the menu
    // opened, nothing was clickable, and nothing said why.
    if (next && url === null) {
      const minted = await getUrl().catch(() => null);
      setUrl(minted);
      setFailed(minted === null);
    }
  }

  // webcal:// makes iOS/macOS/Outlook offer a real subscription rather than a
  // one-off download, so the feed keeps updating — the whole point of it.
  const webcalUrl = url?.replace(/^https?:\/\//, 'webcal://') ?? null;
  // Google Calendar ignores webcal:// and needs its own deep link.
  const googleUrl = webcalUrl
    ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`
    : null;

  const itemClass = 'block w-full px-3 py-2 text-left text-xs hover:bg-surface-muted';

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        title="Add to calendar"
        aria-label="Add to calendar"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-foreground transition duration-150 ease-out hover:scale-[1.05] hover:bg-surface-muted active:scale-100"
      >
        {/* A calendar with a plus: what the button does, not where it sends you. */}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden className="h-4 w-4">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4M12 14v4M10 16h4" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} top-full z-30 mt-1 w-56 overflow-hidden rounded-card border border-border bg-surface shadow-lg`}
        >
          <a
            href={webcalUrl ?? undefined}
            aria-disabled={!webcalUrl}
            className={`${itemClass} ${webcalUrl ? 'text-foreground' : 'pointer-events-none text-text-tertiary'}`}
          >
            Apple / Outlook
          </a>
          <a
            href={googleUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!googleUrl}
            className={`${itemClass} ${googleUrl ? 'text-foreground' : 'pointer-events-none text-text-tertiary'}`}
          >
            Google Calendar
          </a>
          <button
            type="button"
            disabled={!url}
            onClick={async () => {
              if (!url) return;
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className={`${itemClass} border-t border-border ${url ? 'text-foreground' : 'text-text-tertiary'}`}
          >
            {copied ? 'Copied' : 'Copy subscription URL'}
          </button>
          <a
            href={url ? `${url}?download=1` : undefined}
            download
            aria-disabled={!url}
            className={`${itemClass} border-t border-border ${
              url ? 'text-foreground' : 'pointer-events-none text-text-tertiary'
            }`}
          >
            Download .ics file
          </a>
          {failed && (
            <p className="border-t border-border px-3 py-2 text-[11px] text-danger">
              Couldn&apos;t create the calendar link. Reload the page and try again.
            </p>
          )}
          <p className="border-t border-border px-3 py-2 text-[11px] text-text-tertiary">
            Subscribing keeps your calendar updating on its own. The download is a
            one-off snapshot of it as it stands now.
          </p>
        </div>
      )}
    </div>
  );
}
