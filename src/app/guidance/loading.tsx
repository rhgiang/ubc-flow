/**
 * Shaped like the picker, because that is what /guidance resolves to when no
 * program is chosen - four degree panels of cards. A roadmap request lands
 * here too and the shapes are close enough that it does not read as wrong.
 */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-14" aria-busy="true" aria-label="Loading programs">
      <div className="skeleton h-10 w-56" />
      <div className="skeleton mt-4 h-5 w-full max-w-xl" />
      <div className="skeleton mt-2 h-5 w-72" />

      <div className="mt-10 space-y-6">
        {[5, 10, 4].map((cards, panel) => (
          <section key={panel} className="sky-panel p-6">
            <div className="flex items-baseline gap-3">
              <div className="skeleton h-6 w-16" />
              <div className="skeleton h-4 w-40" />
            </div>
            <div className="skeleton mt-2 h-4 w-80 max-w-full" />
            <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: cards }).map((_, i) => (
                <li key={i} className="rounded-card border border-border p-4">
                  <div className="skeleton h-3 w-12" />
                  <div className="skeleton mt-2 h-4 w-full" />
                  <div className="skeleton mt-3 h-3 w-28" />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
