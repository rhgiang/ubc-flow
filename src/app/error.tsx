'use client';

/**
 * The last backstop. Without this, a throw during render hands the visitor
 * Next's own error screen — a stack trace in development and a blank
 * "Application error" in production, neither of which belongs to this site
 * or offers a way out.
 *
 * `reset()` re-runs the failed render, which is genuinely worth offering:
 * most of what reaches here is a transient database or network fault rather
 * than a broken page.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-24 text-center">
      <h1 className="sky-hero text-3xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="sky-hero mx-auto mt-3 max-w-md text-sm opacity-80">
        This page didn&rsquo;t load. It&rsquo;s usually temporary — trying again often works.
      </p>

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-pill bg-brand px-5 py-2.5 text-sm font-medium text-brand-foreground hover:bg-brand-hover"
        >
          Try again
        </button>
        {/*
          A real navigation, not <Link>. This boundary catches failures that
          may have left the client router itself in a bad state, and routing
          out through the thing that just broke is how you get a second error
          screen. A full page load always works.
        */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="rounded-pill border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-surface-muted"
        >
          Go home
        </a>
      </div>

      {/*
        The digest, not the message. Production error messages are stripped by
        Next anyway, and the digest is the value that matches this failure to
        a server log line — the only part that helps anyone.
      */}
      {error.digest && (
        <p className="sky-hero mt-6 font-mono text-xs opacity-50">Reference: {error.digest}</p>
      )}
    </main>
  );
}
