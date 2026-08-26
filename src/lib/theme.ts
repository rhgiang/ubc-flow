/**
 * The set of sky/theme modes, shared by everything that has to agree on it:
 * the client toggle, the server action that persists a signed-in user's
 * choice, and the pre-paint init script in the layout.
 *
 * It lives here rather than in ThemeToggle because the server action must
 * validate what it writes to the database, and importing a type from a
 * 'use client' component to do that invites the two lists drifting apart.
 */

export type Mode = 'day' | 'night' | 'weather' | 'light' | 'dark';

export const MODES: Mode[] = ['day', 'night', 'weather', 'light', 'dark'];

/**
 * What a visitor gets before they have ever chosen: the campus sky. A first
 * load should show what it is actually doing at UBC rather than mirroring
 * the operating system's light/dark setting.
 */
export const DEFAULT_MODE: Mode = 'weather';

export function isMode(v: unknown): v is Mode {
  return typeof v === 'string' && (MODES as string[]).includes(v);
}
