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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-6 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <AuthPanel
        initialMode={mode}
        onSuccess={() => {
          onSuccess?.();
          close();
        }}
        onClose={close}
      />
    </div>
  );
}
