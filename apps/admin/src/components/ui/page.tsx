import Link from "next/link";
import { cn } from "@im/ui";
import type { StatusMeta, Tone } from "@im/core";

/*
 * Shared admin page pieces ("Ledger" layout, "Brand rail" colours): page header, summary counts, status pills,
 * chips, initials and the data table. Server-safe (no client state); the drawer lives in ./drawer.tsx.
 */

/** Page title with a one-line description on the left and the primary action(s) top-right. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-0.5 text-[13px] text-muted">{eyebrow}</p>}
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-ink sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 max-w-[90ch] text-sm leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export type Stat = { label: string; value: number | string; href?: string; current?: boolean; tone?: "default" | "wait" | "danger" };

/**
 * A row of summary counts ("24 Approved · 3 Awaiting review · …"). Items with an href act as quick filters.
 * Pass "divider" between items to separate groups of counts.
 */
export function StatRow({ items, label = "Summary", className }: { items: (Stat | "divider")[]; label?: string; className?: string }) {
  return (
    <ul aria-label={label} className={cn("-mx-3 mb-5 flex items-stretch gap-x-1 gap-y-2 overflow-x-auto sm:mx-0 sm:flex-wrap sm:overflow-visible", className)}>
      {items.map((it, i) =>
        it === "divider" ? (
          <li key={`d${i}`} aria-hidden className="mx-3 hidden w-px self-stretch bg-line sm:block" />
        ) : (
          <li key={it.label}>
            <StatBody stat={it} />
          </li>
        ),
      )}
    </ul>
  );
}

function StatBody({ stat }: { stat: Stat }) {
  const zero = stat.value === 0 || stat.value === "0";
  const inner = (
    <>
      <span
        className={cn(
          "block text-xl font-semibold leading-tight tabular-nums",
          zero ? "text-subtle" : stat.tone === "wait" ? "text-status-wait" : stat.tone === "danger" ? "text-status-danger" : "text-ink",
        )}
      >
        {typeof stat.value === "number" ? stat.value.toLocaleString("en-GB") : stat.value}
      </span>
      <span className="block text-[13px] text-muted">{stat.label}</span>
    </>
  );
  const box = "block min-w-24 rounded-sm px-3 py-1.5";
  if (!stat.href) return <div className={box}>{inner}</div>;
  return (
    <Link
      href={stat.href}
      scroll={false}
      prefetch={false}
      aria-current={stat.current ? "true" : undefined}
      className={cn(
        box,
        "transition-colors hover:bg-head focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
        stat.current && "bg-head shadow-[inset_0_-2px_0_var(--color-brand-deep)]",
      )}
    >
      {inner}
    </Link>
  );
}

export type StatusTone = "ok" | "wait" | "off" | "danger" | "info";

const STATUS_CLASS: Record<StatusTone, { pill: string; dot: string }> = {
  ok: { pill: "bg-status-ok-bg text-status-ok", dot: "bg-status-ok-dot" },
  wait: { pill: "bg-status-wait-bg text-status-wait", dot: "bg-status-wait-dot" },
  off: { pill: "bg-status-off-bg text-status-off", dot: "bg-status-off-dot" },
  danger: { pill: "bg-status-danger-bg text-status-danger", dot: "bg-status-danger-dot" },
  info: { pill: "bg-status-info-bg text-status-info", dot: "bg-status-info-dot" },
};

/** Maps the shared @im/core status tones onto the admin pill tones ("neutral" reads as off). */
export function adminTone(tone: Tone): StatusTone {
  return tone === "neutral" ? "off" : tone;
}

/** Status pill straight from a @im/core status record (REQUEST_STATUS, CLAIM_STATUS…). */
export function MetaPill({ meta, fallback }: { meta: StatusMeta | undefined; fallback?: string }) {
  return <StatusPill tone={meta ? adminTone(meta.tone) : "off"}>{meta?.label ?? fallback ?? "Unknown"}</StatusPill>;
}

/** Squared status pill with a leading dot (approved / awaiting review / suspended …). */
export function StatusPill({ tone, children, className }: { tone: StatusTone; children: React.ReactNode; className?: string }) {
  const c = STATUS_CLASS[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm px-2 py-0.5 text-xs font-semibold", c.pill, className)}>
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", c.dot)} />
      {children}
    </span>
  );
}

/** Small outlined chip (insurer names, services, tags). */
export function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-sm border border-line bg-white px-1.5 py-px text-xs text-ink-2", className)}>{children}</span>;
}

/** Initials tile in the brand-rail colours (decorative; the name is always printed next to it). */
export function Initials({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  const text = name
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className={cn("inline-grid shrink-0 place-items-center rounded-sm bg-rail font-semibold text-highlight", className)}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.4)) }}
    >
      {text || "?"}
    </span>
  );
}

/* ----------------------------------------------------------------------------
 * Data table: full width, light header fill, thin teal-grey rules.
 * Same API as the @im/ui table so pages can swap the import.
 * ------------------------------------------------------------------------- */
export function Table({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("overflow-x-auto rounded-card border border-line bg-white", className)}>
      <table className="w-full min-w-[640px] text-left text-sm">{children}</table>
    </div>
  );
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="bg-head text-xs font-semibold text-muted">{children}</thead>;
}

export function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <th className={cn("border-b border-line px-4 py-2.5 font-semibold", className)}>{children}</th>;
}

export function Td({ children, className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("border-t border-line px-4 py-3 align-middle text-ink-2 [tr:first-child>&]:border-t-0", className)} {...props}>
      {children}
    </td>
  );
}

/**
 * Primary link of a table row that opens the row's drawer. It stretches over the whole row (the <tr> needs
 * `relative`), so a click anywhere on the row opens it; `id` lets the drawer hand focus back on close.
 */
export function RowLink({ id, href, current, children, className }: { id: string; href: string; current?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <Link
      id={id}
      href={href}
      scroll={false}
      prefetch={false}
      aria-current={current ? "true" : undefined}
      className={cn(
        "font-semibold text-ink after:absolute after:inset-0 after:content-[''] hover:text-brand focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-brand",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Small heading + list block used inside drawers ("Recent activity", "Status history"). */
export function DrawerSection({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  const id = `ds-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className={className}>
      <h3 id={id} className="mb-2 text-xs font-semibold text-muted">{title}</h3>
      {children}
    </section>
  );
}
