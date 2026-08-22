'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

type AuthMode = 'login' | 'signup';
type AuthOverlayState = {
  mode: AuthMode | null;
  onSuccess?: () => void;
  open: (mode: AuthMode, onSuccess?: () => void) => void;
  close: () => void;
};

const AuthOverlayCtx = createContext<AuthOverlayState | null>(null);

// Lets a nav click on ANY page (Account, or Schedules while logged out) show
// the login/signup panel on top of wherever the visitor already is, instead
// of navigating away — the overlay renders once at the root and any client
// component can trigger it via useAuthOverlay(). The optional onSuccess lets
// a caller (e.g. the guest schedule builder) resume its own action right
// after the panel reports a successful login/signup.
export function AuthOverlayProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [onSuccess, setOnSuccess] = useState<(() => void) | undefined>(undefined);
  return (
    <AuthOverlayCtx.Provider
      value={{
        mode,
        onSuccess,
        open: (m, cb) => {
          setMode(m);
          setOnSuccess(() => cb);
        },
        close: () => {
          setMode(null);
          setOnSuccess(undefined);
        },
      }}
    >
      {children}
    </AuthOverlayCtx.Provider>
  );
}

export function useAuthOverlay() {
  const ctx = useContext(AuthOverlayCtx);
  if (!ctx) throw new Error('useAuthOverlay must be used within AuthOverlayProvider');
  return ctx;
}
