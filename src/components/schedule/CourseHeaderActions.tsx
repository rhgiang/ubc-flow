'use client';

/**
 * The info / dock pair on a course row in the Saved and Find panels: `i`
 * opens the course in the full overlay, the second button shows it in the
 * panel beside the calendar instead.
 * Both take the course's own accent colour, so the buttons read as part of
 * the same colour code the calendar blocks use.
 *
 * These sit inside a <summary>, so every click must preventDefault — otherwise
 * it toggles the <details> open as a side effect.
 */
export default function CourseHeaderActions({
  code,
  slot,
  onInfo,
  onDock,
}: {
  code: string;
  slot: number;
  onInfo: () => void;
  onDock: () => void;
}) {
  const style = {
    borderColor: `var(--course-${slot}-accent)`,
    color: `var(--course-${slot}-accent)`,
  };

  function handler(run: () => void) {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      run();
    };
  }

  // One fixed size for both, so the pair reads as a set. The icon needs the
  // room: a 12px split-pane glyph at this stroke weight closes up into a blob.
  //
  // align-middle is load-bearing. These are inline-level boxes in the summary's
  // text flow, and an inline-flex box takes its baseline from its own text —
  // which the `i` button has and the icon button does not, so on the default
  // `baseline` they sit at visibly different heights.
  const button =
    'h-5 w-5 shrink-0 items-center justify-center rounded-full border align-middle transition-colors hover:bg-surface-muted';

  return (
    <>
      <button
        type="button"
        onClick={handler(onInfo)}
        aria-label={`Course information for ${code}`}
        style={style}
        className={`ml-2 inline-flex ${button} text-[11px] font-medium leading-none`}
      >
        i
      </button>
      {/* Docking is a desktop layout, matching the overlay's own dock button. */}
      <button
        type="button"
        onClick={handler(onDock)}
        aria-label={`Show ${code} beside the calendar`}
        title="Show beside the calendar"
        style={style}
        className={`ml-2 hidden lg:inline-flex ${button}`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3">
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M14 5v14" />
        </svg>
      </button>
    </>
  );
}
