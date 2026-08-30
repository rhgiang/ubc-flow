'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A yes/no question, asked inside the page.
 *
 * window.confirm() is stamped with "www.ubcflow.com says" by every browser —
 * deliberately, so a page cannot forge a system dialog — which means the most
 * alarming sentences on the site (delete this, lose your edits) were the two
 * that looked least like it.
 *
 * Built on <dialog> rather than a positioned div: showModal() gives the focus
 * trap, the Escape key, inerting of the page behind, and top-layer stacking
 * for free. The hand-rolled overlay in UnsavedWorkDialog predates this and has
 * none of them.
 */
export default function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Styles the confirm button as the dangerous choice and keeps focus off it. */
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Escape fires 'cancel' and the browser closes the dialog itself. Without
    // telling the parent, `open` would stay true and the dialog could never be
    // reopened.
    const onNativeCancel = (e: Event) => {
      e.preventDefault();
      onCancel();
    };
    el.addEventListener('cancel', onNativeCancel);
    return () => el.removeEventListener('cancel', onNativeCancel);
  }, [onCancel]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-dialog-title"
      // ::backdrop is not an element, so a click on it lands on the <dialog>
      // itself; anything inside targets a child instead.
      onPointerDown={(e) => {
        if (e.target === ref.current) onCancel();
      }}
      className="m-auto w-full max-w-md rounded-card border border-border-hairline bg-surface p-6 text-foreground shadow-lg backdrop:bg-black/50 backdrop:backdrop-blur-sm"
    >
      <h2 id="confirm-dialog-title" className="text-base font-semibold text-foreground">
        {title}
      </h2>
      <div className="mt-2 text-sm text-text-secondary">{children}</div>

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          // autoFocus on the safe choice: <dialog> otherwise focuses the first
          // tabbable element, which would put a delete one Enter away.
          autoFocus
          // Bordered like every other secondary button on the site. As bare
          // text it read as a link next to a real button, which is backwards:
          // this is the one being recommended.
          className="rounded-pill border border-border px-4 py-2 text-sm font-medium text-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-surface-muted active:scale-100 disabled:opacity-50 disabled:hover:scale-100"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={
            destructive
              ? 'rounded-pill border border-danger-border px-4 py-2 text-sm font-medium text-danger transition duration-150 ease-out hover:scale-[1.02] hover:bg-danger-surface active:scale-100 disabled:opacity-50 disabled:hover:scale-100'
              : 'rounded-pill bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition duration-150 ease-out hover:scale-[1.02] hover:bg-brand-hover active:scale-100 disabled:opacity-50 disabled:hover:scale-100'
          }
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
