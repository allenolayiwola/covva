import * as React from "react";
import { Card, cn } from "@im/ui";
import { relativeDue } from "@im/core";

/** Card section with a heading row, used throughout the workspace. */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id,
  tone = "white",
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
  tone?: "white" | "mist";
}) {
  return (
    <section id={id} className={cn("scroll-mt-24 rounded-card border border-line", tone === "mist" ? "border-transparent bg-mist" : "bg-white", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      <div className={cn("px-5 pb-5 pt-3", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-lg bg-mist", className)} />;
}

export function PageSkeleton({ rows = 5, stats = 3 }: { rows?: number; stats?: number }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading">
      {stats > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: stats }).map((_, i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="mt-3 h-8 w-14" />
            </Card>
          ))}
        </div>
      )}
      <Card className="overflow-hidden">
        <Skeleton className="h-11 rounded-none" />
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-6 border-t border-line px-4 py-4">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/6" />
            <Skeleton className="h-4 w-1/5" />
            <Skeleton className="h-4 w-1/6" />
          </div>
        ))}
      </Card>
    </div>
  );
}

export function TitleSkeleton() {
  return (
    <div className="mb-6 space-y-2">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
    </div>
  );
}

/** "Today, 16:00 / At risk" cell from the mockup. */
export function DueCell({ dueAt, hint }: { dueAt: string | null; hint?: string }) {
  const due = relativeDue(dueAt);
  return (
    <div>
      <p className={cn("font-semibold", due.overdue ? "text-danger" : "text-ink")}>{due.label}</p>
      {due.atRisk ? (
        <p className="text-xs font-medium text-amber">{due.overdue ? "Response target missed" : "At risk"}</p>
      ) : hint ? (
        <p className="text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

/** Horizontal bars with plain CSS (no chart library). */
export function Bars({ items, format = (n: number) => String(n), className }: { items: { label: string; value: number; tone?: "brand" | "amber" | "muted" }[]; format?: (n: number) => string; className?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className={cn("space-y-2.5", className)}>
      {items.map((it) => (
        <li key={it.label} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-muted">{it.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-mist" aria-hidden>
            <span
              className={cn("block h-full rounded-full", it.tone === "amber" ? "bg-gold" : it.tone === "muted" ? "bg-subtle" : "bg-brand")}
              style={{ width: `${(it.value / max) * 100}%` }}
            />
          </span>
          <span className="tabular-nums font-medium text-ink">{format(it.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Vertical column chart as inline SVG (weekly volumes). */
export function Columns({ items, height = 140, label }: { items: { label: string; value: number }[]; height?: number; label: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const w = 100 / Math.max(1, items.length);
  return (
    <figure>
      <svg viewBox={`0 0 100 ${height / 2}`} preserveAspectRatio="none" className="h-36 w-full" role="img" aria-label={label}>
        {items.map((it, i) => {
          const h = (it.value / max) * (height / 2 - 4);
          return (
            <rect key={it.label} x={i * w + w * 0.18} y={height / 2 - h} width={w * 0.64} height={Math.max(h, 0.6)} rx="0.8" className="fill-brand">
              <title>{`${it.label}: ${it.value}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] text-subtle">
        <span>{items[0]?.label}</span>
        <span>{items[items.length - 1]?.label}</span>
      </figcaption>
    </figure>
  );
}

export function KV({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2 text-sm last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-ink">{children}</span>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line bg-mist/50 px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

/** Chip-style link used by queue filters (mockup: "All open · 21"). */
export function Chip({ href, active, children }: { href: string; active?: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex h-9 items-center rounded-[10px] border px-3.5 text-sm transition-colors",
        active ? "border-transparent bg-mint font-medium text-brand-deep" : "border-line bg-white text-muted hover:text-ink",
      )}
    >
      {children}
    </a>
  );
}

export const chipSelectClass =
  "h-9 rounded-[10px] border border-line bg-white px-3 pr-8 text-sm text-muted hover:text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function slaDaysLeft(dueAt: string | null) {
  if (!dueAt) return null;
  return Math.ceil((new Date(dueAt).getTime() - Date.now()) / 86_400_000);
}
