'use client';

import { useEffect, useState } from 'react';
import AuthPanel from '@/components/AuthPanel';
import SearchBar from '@/components/SearchBar';

/**
 * The home hero, with the signed-in check moved to the browser so the page
 * itself can be served statically (auth() in the server render made the
 * front door SSR on every hit). Until the session answer arrives the panel
 * is simply absent — which is also the signed-in layout, so a returning
 * student sees no flash; a signed-out visitor gets the panel a beat after
 * the hero paints.
 */
export default function HomeHero() {
  // null = unknown (fetch in flight); the panel renders only on a known
  // signed-out answer.
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((session) => {
        if (alive) setLoggedIn(Boolean(session?.user));
      })
      .catch(() => {
        if (alive) setLoggedIn(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    // zoom, not a pile of one-off sizes: the hero, the field and the
    // explore row all come up 10% together and keep their proportions.
    // Percentage widths resolve against the zoomed space, so w-full still
    // fits its column on a phone.
    <div
      className={`mx-auto w-full max-w-2xl text-center [zoom:1.1] ${
        // Signed in, the search field IS the page, so it should sit dead
        // centre — but centring the BLOCK does not centre the field, because
        // the four-line heading above it carries the block's midpoint well
        // above the field's. Left alone the field lands at 61% down the
        // viewport; a bottom margin lifts the block until the FIELD is
        // centred, measured at 424px against a 422px midline. The previous
        // mb-48 overshot the other way, to 39%.
        //
        // Signed out, the sign-in panel hangs below and the stack is taller
        // than a phone screen, so nothing can be centred; without a nudge
        // the heading starts hard against the nav bar. Push it down instead.
        //
        // Both nudges shrink on phones (smaller lift signed in, bigger push
        // signed out): dead-centre reads as too high on a phone screen.
        //
        // While the session is unknown the signed-in spacing stands: it is
        // the layout with nothing below the field, so the panel appearing is
        // the only shift a signed-out visitor sees.
        loggedIn === false ? 'mt-24 sm:mt-6' : 'mb-16 sm:mb-40'
      }`}
    >
      {/* text-2xl on phones: at 30px the headline ran four lines and owned
          most of the first screen, reading oversized next to other apps. */}
      <h1 className="sky-hero text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
        Search and explore course and professor reviews from UBC students
      </h1>

      <SearchBar defaultValue="" />

      {loggedIn === false && (
        <div className="mt-10 flex justify-center">
          <AuthPanel initialMode="login" />
        </div>
      )}
    </div>
  );
}
