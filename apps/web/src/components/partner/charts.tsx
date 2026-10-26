import * as React from "react";
import { Card, cn } from "@im/ui";

/**
 * Small, dependency-free charts for the partner dashboards: inline SVG in brand teal with a
 * `<title>` for assistive tech and a visually hidden data table as the fallback. Everything is a
 * Server Component (no hooks), so pages stay streamable under cacheComponents.
 */
export interface Point { label: string; value: number }

const fmtDefault = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function DataTable({ title, points, format, unit }: { title: string; points: Point[]; format: (n: number) => string; unit?: string }) {
  return (
    <table className="sr-only">
      <caption>{title}</caption>
      <thead><tr><th scope="col">Period</th><th scope="col">{unit ?? "Value"}</th></tr></thead>
      <tbody>
        {points.map((p) => (
          <tr key={p.label}><td>{p.label}</td><td>{format(p.value)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

/** Tiny line chart (sparkline) for KPI tiles. */
export function Sparkline({ points, title, format = fmtDefault, width = 160, height = 40, className, tone = "brand" }: { points: Point[]; title: string; format?: (n: number) => string; width?: number; height?: number; className?: string; tone?: "brand" | "amber" }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const min = Math.min(0, ...points.map((p) => p.value));
  const span = max - min || 1;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const coords = points.map((p, i) => [i * step, height - 2 - ((p.value - min) / span) * (height - 4)] as const);
  const path = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = coords.length ? `${path} L${coords[coords.length - 1]![0].toFixed(1)},${height} L0,${height} Z` : "";
  const last = coords[coords.length - 1];
  const stroke = tone === "amber" ? "stroke-gold" : "stroke-brand";
  return (
    <figure className={cn("w-full", className)}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="h-10 w-full" role="img" aria-label={title}>
        <title>{title}</title>
        {points.length > 1 && <path d={area} className={tone === "amber" ? "fill-gold/15" : "fill-brand/10"} />}
        {points.length > 1 ? <path d={path} fill="none" strokeWidth="1.5" className={stroke} vectorEffect="non-scaling-stroke" /> : null}
        {last && <circle cx={last[0]} cy={last[1]} r="2" className={tone === "amber" ? "fill-gold" : "fill-brand"} />}
      </svg>
      <DataTable title={title} points={points} format={format} />
    </figure>
  );
}

/** Vertical bars with axis labels (first/last) and hover titles per bar. */
export function BarChart({ points, title, format = fmtDefault, height = 120, className, unit }: { points: Point[]; title: string; format?: (n: number) => string; height?: number; className?: string; unit?: string }) {
  const max = Math.max(1, ...points.map((p) => p.value));
  const n = Math.max(1, points.length);
  const w = 100 / n;
  const every = points.length > 14 ? Math.ceil(points.length / 7) : 1;
  return (
    <figure className={cn("w-full", className)}>
      <svg viewBox={`0 0 100 ${height / 2}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={title}>
        <title>{title}</title>
        <line x1="0" x2="100" y1={height / 2 - 0.5} y2={height / 2 - 0.5} className="stroke-line" strokeWidth="0.5" />
        {points.map((p, i) => {
          const h = (p.value / max) * (height / 2 - 6);
          return (
            <rect key={p.label} x={i * w + w * 0.2} y={height / 2 - 1 - h} width={w * 0.6} height={Math.max(h, 0.5)} rx="0.6" className={p.value > 0 ? "fill-brand" : "fill-line"}>
              <title>{`${p.label}: ${format(p.value)}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex justify-between text-[11px] text-subtle" aria-hidden>
        {points.filter((_, i) => i % every === 0 || i === points.length - 1).map((p) => <span key={p.label}>{p.label}</span>)}
      </figcaption>
      <DataTable title={title} points={points} format={format} unit={unit} />
    </figure>
  );
}

/** Line chart with up to three series on a shared axis. */
export function LineChart({ series, labels, title, format = fmtDefault, height = 140, className }: { series: { name: string; values: number[]; tone?: "brand" | "amber" | "ink" }[]; labels: string[]; title: string; format?: (n: number) => string; height?: number; className?: string }) {
  const width = 300;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const n = Math.max(1, labels.length);
  const step = n > 1 ? width / (n - 1) : width;
  const tones = { brand: "stroke-brand", amber: "stroke-gold", ink: "stroke-ink-2" };
  const dots = { brand: "bg-brand", amber: "bg-gold", ink: "bg-ink-2" };
  return (
    <figure className={cn("w-full", className)}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={title}>
        <title>{title}</title>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={width} y1={height - 4 - f * (height - 8)} y2={height - 4 - f * (height - 8)} className="stroke-line" strokeWidth="0.5" strokeDasharray="2 3" />)}
        {series.map((s) => {
          const d = s.values.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - 4 - (v / max) * (height - 8)).toFixed(1)}`).join(" ");
          return <path key={s.name} d={d} fill="none" strokeWidth="2" className={tones[s.tone ?? "brand"]} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />;
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-subtle">
        <span aria-hidden>{labels[0]} – {labels[labels.length - 1]}</span>
        <ul className="flex flex-wrap gap-3">
          {series.map((s) => (
            <li key={s.name} className="flex items-center gap-1.5"><span aria-hidden className={cn("inline-block size-2 rounded-full", dots[s.tone ?? "brand"])} />{s.name}</li>
          ))}
        </ul>
      </figcaption>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th scope="col">Period</th>{series.map((s) => <th key={s.name} scope="col">{s.name}</th>)}</tr></thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={l}><td>{l}</td>{series.map((s) => <td key={s.name}>{format(s.values[i] ?? 0)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** A KPI tile: value, optional change vs the previous period and a sparkline. */
export function KpiTile({ label, value, hint, change, points, href, tone, format, className }: { label: string; value: React.ReactNode; hint?: React.ReactNode; change?: number | null; points?: Point[]; href?: string; tone?: "default" | "warn"; format?: (n: number) => string; className?: string }) {
  const body = (
    <Card className={cn("flex h-full flex-col p-4 transition-colors", href && "hover:border-brand/40", className)}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted">{label}</p>
        {change != null && (
          <span className={cn("rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", change > 0 ? "bg-mint text-brand-deep" : change < 0 ? "bg-gold/15 text-amber" : "bg-mist text-muted")}>
            <span className="sr-only">Change versus the previous period: </span>
            {change > 0 ? "▲" : change < 0 ? "▼" : "•"} {Math.abs(change)}%
          </span>
        )}
      </div>
      <p className={cn("mt-1 text-2xl font-bold tracking-tight tabular-nums", tone === "warn" ? "text-amber" : "text-ink")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-subtle">{hint}</p>}
      {points && points.length > 1 && <Sparkline points={points} title={`${label} by day`} format={format} className="mt-auto pt-2" tone={tone === "warn" ? "amber" : "brand"} />}
    </Card>
  );
  return href ? <a href={href} className="block rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">{body}</a> : body;
}

/** Compact day label ("3 Oct") for axis captions. */
export function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Rate pill ("92% on time") with an accessible meter. */
export function RateMeter({ label, ratio, detail, className }: { label: string; ratio: number | null; detail?: React.ReactNode; className?: string }) {
  const pct = ratio == null ? null : Math.round(Math.min(1, Math.max(0, ratio)) * 100);
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted">{label}</span>
        <span className="font-semibold tabular-nums text-ink">{pct == null ? "—" : `${pct}%`}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-mist" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? 0} aria-valuetext={pct == null ? "No data yet" : `${pct}%`}>
        <div className={cn("h-full rounded-full", pct != null && pct < 70 ? "bg-gold" : "bg-brand")} style={{ width: `${pct ?? 0}%` }} />
      </div>
      {detail && <p className="mt-1 text-xs text-subtle">{detail}</p>}
    </div>
  );
}
