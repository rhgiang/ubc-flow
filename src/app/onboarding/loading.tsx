/**
 * The last main route without a skeleton. It was the easiest one to miss:
 * Account sat behind a nav button that never worked, so nobody ever waited on
 * this page. With the button fixed, a tap held the previous page fully painted
 * through auth plus seven queries, which reads as a dead tap rather than a
 * load. Shaped like the real page: title, one panel, the sections inside it.
 */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10" aria-busy="true" aria-label="Loading your account">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="skeleton h-9 w-40" />
        <div className="skeleton h-10 w-32 rounded-pill" />
      </div>

      <div className="sky-panel mt-6 p-6 sm:p-8">
        <div className="skeleton h-4 w-64" />

        <div className="mt-6 rounded-card border border-border p-4">
          <div className="skeleton h-5 w-48" />
          <div className="skeleton mt-2 h-4 w-3/4" />
          <div className="mt-3 flex flex-wrap gap-2">
            <div className="skeleton h-9 w-36 rounded-pill" />
            <div className="skeleton h-9 w-28 rounded-pill" />
          </div>
        </div>

        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="mt-6">
            <div className="skeleton h-6 w-52" />
            <div className="mt-3 space-y-2">
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-5/6" />
              <div className="skeleton h-4 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
