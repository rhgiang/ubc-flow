'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { connectCanvasFeed, disconnectCanvasFeed } from '@/app/actions/canvas';
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
export default function CanvasConnect({
  connectedAt,
  lastFetchedAt,
  broken,
  failing = false,
}: {
  connectedAt: string | null;
  lastFetchedAt: string | null;
  broken: boolean;
  failing?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await connectCanvasFeed(value);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setValue('');
    router.refresh();
  }

  async function disconnect() {
    setBusy(true);
    const r = await disconnectCanvasFeed();
    setBusy(false);
    setConfirming(false);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  if (connectedAt && !broken) {
    return (
      <div className="space-y-2 text-sm text-text-secondary">
        <p>
          Connected {new Date(connectedAt).toLocaleDateString('en-CA')}
          {lastFetchedAt ? `, last read ${new Date(lastFetchedAt).toLocaleString('en-CA')}` : ', not read yet'}.
        </p>
        {failing && (
          <p className="text-sm text-danger">
            The last read of your Canvas feed failed, so your deadlines may be out of date. We keep trying.
          </p>
        )}
        <button type="button" onClick={() => setConfirming(true)} className="text-sm font-medium text-danger hover:underline">
          Disconnect Canvas
        </button>
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
      <p className="text-sm text-text-secondary">
        In Canvas, open Calendar, click Calendar Feed at the bottom right, and copy the link.
      </p>
      <input
        type="url"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="https://canvas.ubc.ca/feeds/calendars/..."
        aria-label="Canvas Calendar Feed link"
        className="block w-full rounded-input border border-border bg-surface px-2 py-1 text-sm text-foreground"
      />
      <div className="flex items-center gap-3">
        <button disabled={busy || !value} className="rounded-pill bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground disabled:opacity-50">
          {busy ? 'Checking...' : 'Connect Canvas'}
        </button>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </form>
  );
}
