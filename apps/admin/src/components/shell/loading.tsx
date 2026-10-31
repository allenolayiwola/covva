/** Neutral shell shown until the server has verified staff membership and MFA. */
export function AdminSkeleton() {
  return (
    <div role="status" aria-label="Loading admin console" className="min-h-dvh bg-canvas p-6 sm:p-10">
      <span className="sr-only">Loading admin console…</span>
      <div aria-hidden className="mx-auto max-w-6xl space-y-6 motion-safe:animate-pulse">
        <div className="h-10 w-48 rounded-field bg-line" />
        <div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((n) => <div key={n} className="h-28 rounded-card bg-mist" />)}</div>
        <div className="h-72 rounded-card border border-line bg-white" />
      </div>
    </div>
  );
}
