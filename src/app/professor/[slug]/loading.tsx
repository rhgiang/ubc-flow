/** No `revalidate` here either — same cold-render cost as the course page. */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-10" aria-busy="true" aria-label="Loading professor">
      <div className="skeleton h-8 w-64" />
      <div className="skeleton mt-3 h-5 w-40" />

      <div className="sky-panel mt-6 p-5">
        <div className="skeleton h-4 w-28" />
        <div className="skeleton mt-4 h-40 w-full" />
      </div>

      <div className="sky-panel mt-4 divide-y divide-border">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="p-4">
            <div className="skeleton h-4 w-32" />
            <div className="skeleton mt-2 h-4 w-full" />
            <div className="skeleton mt-2 h-4 w-2/3" />
          </div>
        ))}
      </div>
    </main>
  );
}
