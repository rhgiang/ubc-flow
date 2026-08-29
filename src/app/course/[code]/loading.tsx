/** No `revalidate` on this route, so a cold request is the ~560ms case. */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10" aria-busy="true" aria-label="Loading course">
      <div className="skeleton h-8 w-40" />
      <div className="skeleton mt-3 h-6 w-2/3" />

      <div className="sky-panel mt-6 p-5">
        <div className="flex gap-3">
          <div className="skeleton h-16 w-24" />
          <div className="skeleton h-16 w-24" />
          <div className="skeleton h-16 w-24" />
        </div>
        <div className="skeleton mt-5 h-4 w-full" />
        <div className="skeleton mt-2 h-4 w-full" />
        <div className="skeleton mt-2 h-4 w-4/5" />
      </div>

      <div className="sky-panel mt-4 p-5">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton mt-4 h-40 w-full" />
      </div>
    </main>
  );
}
