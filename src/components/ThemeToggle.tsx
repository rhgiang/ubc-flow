'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

// Both icons render always; CSS (driven by the `data-theme` attribute the
// layout's inline script already set before paint) decides which one shows.
// This avoids a client-state hydration mismatch entirely — no flash, no
// useEffect needed just to know which icon to draw.
function toggleTheme() {
  const root = document.documentElement;
  const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}

const KEY = 'theme-toggle-corner';

// The four resting spots, 24px in from each edge (the old bottom-6 left-6).
const INSET = 24;
const CORNERS = {
  tl: { top: INSET, left: INSET },
  tr: { top: INSET, right: INSET },
  bl: { bottom: INSET, left: INSET },
  br: { bottom: INSET, right: INSET },
} as const;
type Corner = keyof typeof CORNERS;

export default function ThemeToggle() {
  // Read through useSyncExternalStore rather than an effect: the server (and
  // the hydration pass) get 'bl', the client swaps in the saved corner right
  // after. Nothing ever writes to the store, so subscribe is a no-op.
  const saved = useSyncExternalStore(
    () => () => {},
    () => localStorage.getItem(KEY) ?? 'bl',
    () => 'bl',
  );
  const [moved, setMoved] = useState<Corner | null>(null);
  const corner = moved ?? (saved in CORNERS ? (saved as Corner) : 'bl');

  // The button stays anchored to its corner; dragging only translates it from
  // there. That way the snap-back is a plain transform transition — nothing
  // animates to `auto`, which is what a left/top swap would have asked for.
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [snapping, setSnapping] = useState(false);
  const dragged = useRef(false);

  function onPointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const start = { x: e.clientX, y: e.clientY };
    let d = { x: 0, y: 0 };
    dragged.current = false;
    setSnapping(false);
    el.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      d = { x: ev.clientX - start.x, y: ev.clientY - start.y };
      // 4px of slop so a slightly shaky click still toggles the theme.
      if (!dragged.current && Math.hypot(d.x, d.y) > 4) {
        dragged.current = true;
        setDragging(true);
      }
      if (dragged.current) setOff(d);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDragging(false);
      if (!dragged.current) return;

      const end = { x: rect.left + d.x, y: rect.top + d.y };
      const next: Corner = `${end.y + rect.height / 2 < window.innerHeight / 2 ? 't' : 'b'}${
        end.x + rect.width / 2 < window.innerWidth / 2 ? 'l' : 'r'
      }`;
      const home = {
        x: next.endsWith('l') ? INSET : window.innerWidth - INSET - rect.width,
        y: next.startsWith('t') ? INSET : window.innerHeight - INSET - rect.height,
      };
      // Re-anchor to the new corner and re-express the current position as an
      // offset from it — same pixels on screen, no jump — then let the next
      // frame ease that offset to zero.
      setMoved(next);
      localStorage.setItem(KEY, next);
      setOff({ x: end.x - home.x, y: end.y - home.y });
      // Two frames: one to let the re-anchored position actually paint, the
      // next to start the transition from it. One frame and the browser
      // collapses both into a single style pass — no animation at all.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          setSnapping(true);
          setOff({ x: 0, y: 0 });
        }),
      );
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  return (
    <button
      type="button"
      onPointerDown={onPointerDown}
      onClick={() => {
        if (dragged.current) {
          dragged.current = false;
          return;
        }
        toggleTheme();
      }}
      aria-label="Toggle dark mode"
      title="Toggle dark mode — drag to a corner to move"
      className={`fixed z-50 flex h-10 w-10 touch-none cursor-grab items-center justify-center rounded-full border border-border bg-surface text-foreground shadow-sm transition-colors duration-150 ease-out hover:bg-surface-muted active:cursor-grabbing motion-reduce:transition-none ${
        snapping
          ? // easeOutBack: overshoots the corner slightly, then settles.
            'transition-[transform,background-color] duration-500 ease-[cubic-bezier(0.34,1.5,0.5,1)]'
          : ''
      }`}
      style={{
        ...CORNERS[corner],
        transform: `translate3d(${off.x}px, ${off.y}px, 0) scale(${dragging ? 1.08 : 1})`,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        className="h-5 w-5 [html[data-theme=dark]_&]:hidden"
      >
        {/* Moon — shown in light mode, click to go dark */}
        <path
          d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        className="hidden h-5 w-5 [html[data-theme=dark]_&]:block"
      >
        {/* Sun — shown in dark mode, click to go light */}
        <circle cx="12" cy="12" r="4.5" />
        <path
          d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
