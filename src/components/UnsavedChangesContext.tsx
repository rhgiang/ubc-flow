'use client';

import { createContext, useCallback, useContext, useRef, type ReactNode } from 'react';

type UnsavedChangesState = {
  /** Called by whichever editor currently holds unsaved work. */
  setDirty: (dirty: boolean) => void;
  /** Returns true if it is safe to navigate away. Prompts when it is not. */
  confirmLeave: () => boolean;
};

const Ctx = createContext<UnsavedChangesState | null>(null);

/**
 * Lets a nav link ask an unrelated editor whether it is safe to leave.
 *
 * The builder buffers edits in memory (spec §3.1), and `beforeunload` only
 * covers tab close and reload — an App Router <Link> click is a client-side
 * navigation the browser never hears about. Without this, one click on
 * "Explore" silently discards a whole imported timetable.
 *
 * A ref, not state: nothing renders from this, and re-rendering the whole app
 * on every keystroke in the schedule-name field would be a real cost for no
 * benefit.
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirty = useRef(false);

  const setDirty = useCallback((next: boolean) => {
    dirty.current = next;
  }, []);

  const confirmLeave = useCallback(() => {
    if (!dirty.current) return true;
    return window.confirm('You have unsaved changes to this schedule. Leave without saving?');
  }, []);

  return <Ctx.Provider value={{ setDirty, confirmLeave }}>{children}</Ctx.Provider>;
}

export function useUnsavedChanges(): UnsavedChangesState {
  const ctx = useContext(Ctx);
  // A no-op default keeps this usable from components rendered outside the
  // provider (and in tests) without a crash.
  return ctx ?? { setDirty: () => {}, confirmLeave: () => true };
}
