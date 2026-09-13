/** The one main page that had no skeleton - auth plus six queries with a blank stare. */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10" aria-busy="true" aria-label="Loading schedules">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="skeleton h-9 w-56" />
        <div className="flex gap-2">
          <div className="skeleton h-10 w-36 rounded-pill" />
          <div className="skeleton h-10 w-44 rounded-pill" />
        </div>
      </div>

      <div className="sky-panel mt-6 p-6 sm:p-8">
        <div className="flex gap-6 border-b border-border pb-2">
          <div className="skeleton h-5 w-44" />
          <div className="skeleton h-5 w-36" />
          <div className="skeleton h-5 w-28" />
        </div>

        <div className="mt-6 space-y-6">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i}>
              <div className="skeleton h-4 w-52" />
              <div className="mt-2 rounded-card border border-border p-4">
                <div className="skeleton h-4 w-32" />
                <div className="skeleton mt-3 h-4 w-3/4" />
                <div className="skeleton mt-2 h-4 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
