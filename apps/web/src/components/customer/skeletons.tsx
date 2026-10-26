import { cn } from "@im/ui";

export function SkeletonBlock({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-xl bg-mist", className)} />;
}

/** Generic page skeleton: heading + a few rows. */
export function PageSkeleton({ rows = 4, hero = false }: { rows?: number; hero?: boolean }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-6">
      <div className="space-y-2">
        <SkeletonBlock className="h-4 w-32" />
        <SkeletonBlock className="h-9 w-72 max-w-full" />
      </div>
      {hero && (
        <div className="grid gap-4 lg:grid-cols-3">
          <SkeletonBlock className="h-44 lg:col-span-1" />
          <SkeletonBlock className="h-44" />
          <SkeletonBlock className="h-44" />
        </div>
      )}
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonBlock key={i} className="h-16" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading" className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonBlock key={i} className="h-16" />
      ))}
    </div>
  );
}
