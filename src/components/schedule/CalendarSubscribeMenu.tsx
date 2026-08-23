'use client';

import { useEffect, useRef, useState } from 'react';
import { getSubscribeUrl } from '@/app/actions/schedule';

export default function CalendarSubscribeMenu({ scheduleId }: { scheduleId: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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
    if (next && url === null) {
      const result = await getSubscribeUrl(scheduleId);
      if (result.ok) setUrl(`${window.location.origin}/api/calendar/${result.token}`);
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
        className="rounded-pill border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-muted"
      >
        Add to calendar ▾
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-card border border-border bg-surface shadow-lg">
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
          <p className="border-t border-border px-3 py-2 text-[11px] text-text-tertiary">
            These subscribe to a live feed — your calendar keeps updating as you edit.
          </p>
        </div>
      )}
    </div>
  );
}
