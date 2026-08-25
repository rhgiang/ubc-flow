'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import ConfirmDialog from '@/components/ConfirmDialog';

type UnsavedChangesState = {
  /** Called by whichever editor currently holds unsaved work. */
  setDirty: (dirty: boolean) => void;
  /**
   * Returns true if it is safe to navigate now. When it is not, shows the
   * site's own dialog and runs `proceed` only if the student chooses to leave
   * — so callers must preventDefault on false and hand navigation over.
   */
  confirmLeave: (proceed: () => void) => boolean;
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
 * The dirty flag is a ref, not state: nothing renders from it, and
 * re-rendering the whole app on every keystroke in the schedule-name field
 * would be a real cost for no benefit. Only the pending-dialog state renders.
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const dirty = useRef(false);
  const [pending, setPending] = useState<(() => void) | null>(null);

  const setDirty = useCallback((next: boolean) => {
    dirty.current = next;
  }, []);

  const confirmLeave = useCallback((proceed: () => void) => {
    if (!dirty.current) return true;
    setPending(() => proceed);
    return false;
  }, []);

  return (
    <Ctx.Provider value={{ setDirty, confirmLeave }}>
      {children}
      {pending && (
        <ConfirmDialog
          title="Leave the schedule builder?"
          body="Your schedule has changes that aren't saved yet — sections you've added or imported will be discarded. You can save it from the builder first."
          confirmLabel="Discard and leave"
          cancelLabel="Keep editing"
          danger
          onConfirm={() => {
            dirty.current = false;
            setPending(null);
            pending();
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </Ctx.Provider>
  );
}

export function useUnsavedChanges(): UnsavedChangesState {
  const ctx = useContext(Ctx);
  // A no-op default keeps this usable from components rendered outside the
  // provider (and in tests) without a crash.
  return ctx ?? { setDirty: () => {}, confirmLeave: () => true };
}
