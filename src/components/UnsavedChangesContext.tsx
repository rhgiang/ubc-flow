'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';

type UnsavedChangesState = {
  /** Called by whichever editor currently holds unsaved work. */
  setDirty: (dirty: boolean) => void;
  /** True while an editor holds unsaved work. */
  isDirty: () => boolean;
  /** Asks, then runs `proceed` only if the student chooses to leave. */
  askToLeave: (proceed: () => void) => void;
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
 * `isDirty` is a ref, not state: nothing renders from it, and re-rendering the
 * whole app on every keystroke in the schedule-name field would be a real cost
 * for no benefit. Only the pending navigation is state, and only while the
 * question is on screen.
 *
 * This used to be one synchronous `confirmLeave(): boolean` backed by
 * window.confirm. An in-page dialog cannot answer synchronously, so the caller
 * hands over what it wanted to do instead of asking whether it may.
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirty = useRef(false);
  const [pending, setPending] = useState<(() => void) | null>(null);

  const setDirty = useCallback((next: boolean) => {
    dirty.current = next;
  }, []);

  const isDirty = useCallback(() => dirty.current, []);

  const askToLeave = useCallback((proceed: () => void) => {
    if (!dirty.current) {
      proceed();
      return;
    }
    // Wrapped, because a bare function passed to a setter is treated as an
    // updater and would be called instead of stored.
    setPending(() => proceed);
  }, []);

  const cancel = useCallback(() => setPending(null), []);

  // Read, clear, then run. Calling it inside the state updater would fire the
  // navigation twice under StrictMode, which double-invokes updaters.
  const leave = useCallback(() => {
    const proceed = pending;
    setPending(null);
    proceed?.();
  }, [pending]);

  return (
    <Ctx.Provider value={{ setDirty, isDirty, askToLeave }}>
      {children}
      <ConfirmDialog
        open={pending !== null}
        title="Leave without saving?"
        confirmLabel="Leave"
        cancelLabel="Stay on this page"
        destructive
        onConfirm={leave}
        onCancel={cancel}
      >
        This schedule has changes you haven&apos;t saved. Leaving now discards them.
      </ConfirmDialog>
    </Ctx.Provider>
  );
}

export function useUnsavedChanges(): UnsavedChangesState {
  const ctx = useContext(Ctx);
  // A no-op default keeps this usable from components rendered outside the
  // provider (and in tests) without a crash.
  return (
    ctx ?? {
      setDirty: () => {},
      isDirty: () => false,
      askToLeave: (proceed: () => void) => proceed(),
    }
  );
}
