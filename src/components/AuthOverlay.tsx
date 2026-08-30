'use client';

import { useEffect } from 'react';
import { useAuthOverlay } from '@/components/AuthOverlayContext';
import AuthPanel from '@/components/AuthPanel';

export default function AuthOverlay() {
  const { mode, onSuccess, close } = useAuthOverlay();

  useEffect(() => {
    if (mode === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    // Lock background scroll while the overlay covers the page.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [mode, close]);

  if (mode === null) return null;

  return (
    <div
      // overflow-y-auto + m-auto on the panel: centred while it fits, and
      // scrollable once the phone keyboard leaves less height than the
      // sign-up form needs — items-center alone clips both ends unreachably.
      className="fixed inset-0 z-[60] flex overflow-y-auto bg-black/50 px-6 py-10 backdrop-blur-sm"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="m-auto w-full max-w-sm">
        <AuthPanel
          initialMode={mode}
          onSuccess={() => {
            onSuccess?.();
            close();
          }}
          onClose={close}
        />
      </div>
    </div>
  );
}
