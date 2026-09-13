'use client';

import { useEffect, useState } from 'react';

/**
 * Whether the visitor has a session, resolved in the browser rather than in
 * the server render: an `auth()` read up there forced the WHOLE site into
 * per-request rendering, so no page could be served from the CDN.
 *
 * The catch is that signing in does not remount the components showing that
 * answer, and `router.refresh()` re-renders the server tree without re-running
 * a mounted effect. So a mount-only read stayed "signed out" for as long as
 * the tab stayed open: the nav went on offering the login form, and the home
 * hero went on showing the login card, which is what made a perfectly good
 * sign-in look like nothing had happened at all.
 *
 * Sign-in announces itself instead, and every reader re-reads. A plain window
 * event rather than a context, because the two readers sit in different parts
 * of the tree and neither owns the other.
 */
const SESSION_CHANGED = 'ubcflow:session-changed';

/** One-shot read. Also used where a cached answer would be too stale to trust. */
export async function readSignedIn(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/session');
    const session = await res.json();
    return Boolean(session?.user);
  } catch {
    return false;
  }
}

/** Call after a successful sign-in so every `useSignedIn()` re-reads. */
export function announceSignIn(): void {
  window.dispatchEvent(new Event(SESSION_CHANGED));
}

/** null while the first read is in flight - not yet known, as opposed to no. */
export function useSignedIn(): boolean | null {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    const read = () => {
      void readSignedIn().then((v) => {
        if (alive) setSignedIn(v);
      });
    };
    read();
    window.addEventListener(SESSION_CHANGED, read);
    return () => {
      alive = false;
      window.removeEventListener(SESSION_CHANGED, read);
    };
  }, []);

  return signedIn;
}
