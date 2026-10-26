import Link from "next/link";
import { ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { Card, Spinner, cn } from "@im/ui";
import { PAGE_SIZE, withParams, type SearchParams } from "@/lib/query";

export function Panel({
  id,
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  id?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card as="section" id={id} className={cn("overflow-hidden", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("p-5", bodyClassName)}>{children}</div>
    </Card>
  );
}

export function Kpi({
  label,
  value,
  hint,
  trend,
  tone = "default",
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  trend?: React.ReactNode;
  tone?: "default" | "warn" | "danger" | "ok";
  href?: string;
}) {
  const body = (
    <Card className={cn("flex h-full flex-col justify-between p-4", href && "transition-colors hover:border-brand/40")}>
      <p className="text-[13px] text-muted">{label}</p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <p
          className={cn(
            "text-2xl font-bold tracking-tight tabular-nums",
            tone === "warn" ? "text-amber" : tone === "danger" ? "text-danger" : tone === "ok" ? "text-brand" : "text-ink",
          )}
        >
          {value}
        </p>
        {trend && <div className="text-brand">{trend}</div>}
      </div>
      {hint && <p className="mt-1 text-xs text-subtle">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

export function Pagination({ base, params, page, total }: { base: string; params: SearchParams; page: number; total: number | null }) {
  const pages = total == null ? null : Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasNext = pages == null ? true : page < pages;
  const link = (p: number) => withParams(base, params, { page: p > 1 ? String(p) : undefined });
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm text-muted">
      <span>
        {total == null ? `Page ${page}` : `${total.toLocaleString("en-GB")} result${total === 1 ? "" : "s"} · page ${page} of ${pages}`}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={link(page - 1)} className="inline-flex h-9 items-center gap-1 rounded-[10px] border border-line bg-white px-3 hover:bg-mist">
            <ChevronLeft className="size-4" /> Previous
          </Link>
        ) : null}
        {hasNext ? (
          <Link href={link(page + 1)} className="inline-flex h-9 items-center gap-1 rounded-[10px] border border-line bg-white px-3 hover:bg-mist">
            Next <ChevronRight className="size-4" />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}

/** GET form for list filters — works without JavaScript; keeps URLs shareable. */
export function FilterBar({ action, children, resetHref }: { action: string; children: React.ReactNode; resetHref?: string }) {
  return (
    <form action={action} method="get" className="mb-4 flex flex-wrap items-end gap-2 rounded-card border border-line bg-white p-3">
      {children}
      <button type="submit" className="h-9 rounded-[10px] bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark">
        Apply
      </button>
      <Link href={resetHref ?? action} className="h-9 content-center rounded-[10px] px-3 text-sm text-muted hover:bg-mist">
        Reset
      </Link>
    </form>
  );
}

const ctl = "h-9 rounded-[10px] border border-line bg-white px-2.5 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";

export function FilterSelect({
  name,
  label,
  value,
  options,
  allLabel = "All",
}: {
  name: string;
  label: string;
  value?: string;
  options: { value: string; label: string }[];
  allLabel?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
      {label}
      <select name={name} defaultValue={value ?? ""} className={cn(ctl, "min-w-36")}>
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

export function FilterInput({ name, label, value, placeholder, type = "text" }: { name: string; label: string; value?: string; placeholder?: string; type?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted">
      {label}
      <input name={name} type={type} defaultValue={value ?? ""} placeholder={placeholder} className={cn(ctl, type === "text" ? "w-56" : "w-40")} />
    </label>
  );
}

export function FilterCheck({ name, label, checked }: { name: string; label: string; checked?: boolean }) {
  return (
    <label className="flex h-9 items-center gap-2 rounded-[10px] border border-line bg-white px-3 text-sm text-ink-2">
      <input type="checkbox" name={name} value="1" defaultChecked={checked} className="size-4 accent-brand" />
      {label}
    </label>
  );
}

export function LoadingBlock({ label = "Loading…", rows = 6 }: { label?: string; rows?: number }) {
  return (
    <div className="rounded-card border border-line bg-white p-5" aria-busy="true">
      <p className="mb-4 flex items-center gap-2 text-sm text-muted"><Spinner className="size-4 text-brand" />{label}</p>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-4 animate-pulse rounded bg-mist" style={{ width: `${90 - (i % 3) * 15}%` }} />
        ))}
      </div>
    </div>
  );
}

export function ReadOnlyBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <p className="mb-4 flex items-center gap-2 rounded-xl bg-info-bg px-4 py-2.5 text-sm text-info">
      <Eye className="size-4" aria-hidden /> You have read-only access to this area. Actions are disabled for your role.
    </p>
  );
}

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2 text-sm text-muted">
      {items.map((it, i) => (
        <span key={i}>
          {i > 0 && <span className="mx-1.5 text-subtle">/</span>}
          {it.href ? <Link href={it.href} className="hover:text-brand">{it.label}</Link> : <span className="text-ink-2">{it.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function KeyValues({ items, cols = 2 }: { items: { label: React.ReactNode; value: React.ReactNode }[]; cols?: 2 | 3 }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3 text-sm", cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-muted">{it.label}</dt>
          <dd className="mt-0.5 break-words font-medium text-ink">{it.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function JsonView({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre className={cn("max-h-96 overflow-auto rounded-xl bg-[#0F2A31] p-4 font-mono text-xs leading-relaxed text-[#D5ECE3]", className)}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** Renders audit `changes` objects: { field: { from, to } }. */
export function ChangesDiff({ changes }: { changes: Record<string, { from: unknown; to: unknown }> }) {
  const entries = Object.entries(changes);
  if (!entries.length) return <p className="text-sm text-muted">No field changes.</p>;
  return (
    <table className="w-full text-left text-xs">
      <thead className="text-muted">
        <tr><th className="py-1 pr-3 font-semibold">Field</th><th className="py-1 pr-3 font-semibold">From</th><th className="py-1 font-semibold">To</th></tr>
      </thead>
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k} className="border-t border-line align-top">
            <td className="py-1.5 pr-3 font-mono text-ink">{k}</td>
            <td className="py-1.5 pr-3"><code className="whitespace-pre-wrap break-all rounded bg-danger-bg/60 px-1 text-danger">{fmtJson(v?.from)}</code></td>
            <td className="py-1.5"><code className="whitespace-pre-wrap break-all rounded bg-mint/70 px-1 text-brand-deep">{fmtJson(v?.to)}</code></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function fmtJson(v: unknown): string {
  if (v === undefined) return "∅";
  if (typeof v === "string") return v;
  return JSON.stringify(v, null, 1);
}

export function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <h2 className={cn("mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-muted", className)}>{children}</h2>;
}
