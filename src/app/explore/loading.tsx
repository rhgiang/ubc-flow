/** The slowest route in the app (~320ms warm, and it queries on every filter). */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10" aria-busy="true" aria-label="Loading courses">
      <div className="skeleton h-9 w-40" />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <div className="skeleton h-11 w-full" />
          <div className="mt-4 flex gap-2">
            <div className="skeleton h-8 w-28" />
            <div className="skeleton h-8 w-28" />
            <div className="skeleton h-8 w-20" />
          </div>
          <div className="sky-panel mt-4 divide-y divide-border">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="p-4">
                <div className="skeleton h-4 w-24" />
                <div className="skeleton mt-2 h-4 w-3/4" />
                <div className="skeleton mt-2 h-3 w-20" />
              </div>
            ))}
          </div>
        </div>
        <aside className="sky-panel hidden h-fit p-5 lg:block">
          <div className="skeleton h-4 w-20" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton mt-3 h-8 w-full" />
          ))}
        </aside>
      </div>
    </main>
  );
}
