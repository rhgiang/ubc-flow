'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { settled } from '@/lib/action-result';
import { connectCanvasFeed, disconnectCanvasFeed, refreshCanvasFeed } from '@/app/actions/canvas';
import ConfirmDialog from '@/components/ConfirmDialog';

/**
 * The URL is a credential. Once stored it is never shown again, not even
 * masked: the block shows only when it was connected and when it was last
 * read, and offers Disconnect.
 *
 * `failing` is a feed whose last read failed but which has not yet run out of
 * retries. Said plainly here, because lastFetchedAt is the last SUCCESSFUL
 * read and would otherwise sit there looking fine next to stale deadlines.
 */
/** The step number beside each instruction. */
function Step({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-muted text-xs font-semibold text-text-secondary"
    >
      {n}
    </span>
  );
}

export default function CanvasConnect({
  connectedLabel,
  lastReadLabel,
  broken,
  failing = false,
}: {
  /** Formatted for Vancouver on the server, not an ISO string. Formatting a
   *  date in here would use the browser's own tzdata, which disagrees with
   *  Node's about America/Vancouver after November 2026: the same instant
   *  renders an hour apart on the server and in the browser, which React
   *  reports as a hydration mismatch. See toRow in src/app/deadlines/page.tsx. */
  connectedLabel: string | null;
  lastReadLabel: string | null;
  broken: boolean;
  failing?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [refreshed, setRefreshed] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await settled(connectCanvasFeed(value));
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setValue('');
    router.refresh();
  }

  async function refresh() {
    setBusy(true);
    setError(null);
    setRefreshed(false);
    const r = await settled(refreshCanvasFeed());
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setRefreshed(true);
    router.refresh();
  }

  async function disconnect() {
    setBusy(true);
    const r = await settled(disconnectCanvasFeed());
    setBusy(false);
    setConfirming(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  if (connectedLabel && !broken) {
    return (
      <div className="space-y-2 text-sm text-text-secondary">
        <p>
          {/* No period after the read time: en-CA renders it as "4:56 p.m.",
              which already ends in one. */}
          Connected {connectedLabel}. {lastReadLabel ? `Last read ${lastReadLabel}` : 'Not read yet.'}
        </p>
        {failing && (
          <p className="text-sm text-danger">
            The last read of your Canvas feed failed, so your deadlines may be out of date. We keep trying.
          </p>
        )}
        {refreshed && (
          <p className="text-sm text-text-secondary">Read Canvas just now. Anything new is below.</p>
        )}

        <div className="flex flex-wrap items-center gap-4 pt-1">
          {/* Refreshing used to mean disconnect and reconnect, which throws
              away every stored deadline and re-sends the whole welcome
              email. This just re-reads the feed. */}
          <button
            type="button"
            onClick={refresh}
            disabled={busy}
            className="rounded-pill border border-border px-3 py-1.5 text-sm font-medium text-foreground transition hover:bg-surface-muted disabled:opacity-50"
          >
            {busy ? 'Reading...' : 'Refresh now'}
          </button>
          <button type="button" onClick={() => setConfirming(true)} className="text-sm font-medium text-danger hover:underline">
            Disconnect Canvas
          </button>
        </div>
        <ConfirmDialog open={confirming} title="Disconnect Canvas?" confirmLabel="Disconnect" destructive busy={busy}
          onConfirm={disconnect} onCancel={() => setConfirming(false)}>
          <p>This forgets your feed link and every deadline read from it. Reminders stop. You can reconnect any time.</p>
        </ConfirmDialog>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      {broken && (
        <p className="text-sm text-danger">
          Your Canvas feed stopped answering. Paste a fresh Calendar Feed link to reconnect.
        </p>
      )}
      {/* Three steps in another app, so they are numbered and the first one
          is a link rather than a description of where to go. The old copy
          said all of this in one sentence. */}
      <ol className="space-y-2 text-sm text-text-secondary">
        <li className="flex gap-2">
          <Step n={1} />
          <span>
            Open{' '}
            <a
              href="https://canvas.ubc.ca/calendar"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand-accent hover:underline"
            >
              your Canvas calendar
            </a>{' '}
            in a new tab, or click{' '}
            <strong className="font-medium text-foreground">Calendar</strong> in Canvas&apos;s left
            sidebar.
          </span>
        </li>
        <li className="flex gap-2">
          <Step n={2} />
          <span>
            On that page, click{' '}
            <strong className="font-medium text-foreground">Calendar Feed</strong> on the right.
          </span>
        </li>
        <li className="flex gap-2">
          <Step n={3} />
          <span>Copy the link it shows you and paste it below.</span>
        </li>
      </ol>

      <label htmlFor="canvas-feed-url" className="block pt-1 text-xs font-medium text-text-secondary">
        Calendar Feed link
      </label>
      <input
        id="canvas-feed-url"
        type="url"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="https://canvas.ubc.ca/feeds/calendars/..."
        className="block w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-text-tertiary focus:border-foreground focus:outline-none"
      />
      <p className="text-xs text-text-tertiary">
        Treat this link like a password: anyone holding it can read your Canvas calendar. We store it
        encrypted, never show it again, and you can disconnect at any time.
      </p>
      <div className="flex items-center gap-3">
        <button disabled={busy || !value} className="rounded-pill bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground disabled:opacity-50">
          {busy ? 'Checking...' : 'Connect Canvas'}
        </button>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </form>
  );
}
