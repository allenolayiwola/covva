/** Tiny dependency-free inline SVG charts (server-renderable). */

export function Sparkline({
  values,
  width = 120,
  height = 32,
  className,
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  label?: string;
}) {
  if (values.length < 2) return <svg width={width} height={height} aria-hidden className={className} />;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => [i * step, height - 2 - ((v - min) / span) * (height - 4)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${d} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} role="img" aria-label={label ?? `Trend: ${values.join(", ")}`}>
      <path d={area} fill="currentColor" opacity={0.1} />
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1]![0]} cy={pts[pts.length - 1]![1]} r={2.5} fill="currentColor" />
    </svg>
  );
}

export function Bars({
  data,
  height = 120,
  className,
  format = (n: number) => String(n),
}: {
  data: { label: string; value: number; hint?: string }[];
  height?: number;
  className?: string;
  format?: (n: number) => string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className={className}>
      <div className="flex items-end gap-[3px]" style={{ height }} role="img" aria-label={data.map((d) => `${d.label}: ${format(d.value)}`).join("; ")}>
        {data.map((d, i) => (
          <div key={i} className="group relative flex h-full flex-1 items-end">
            <div
              className="w-full rounded-t-[3px] bg-brand/80 transition-colors group-hover:bg-brand"
              style={{ height: `${Math.max(d.value ? 3 : 1, (d.value / max) * 100)}%`, opacity: d.value ? 1 : 0.25 }}
            />
            <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-1.5 py-0.5 text-[11px] text-white group-hover:block">
              {d.label}: {format(d.value)}
            </span>
          </div>
        ))}
      </div>
      {data.length > 1 && (
        <div className="mt-1.5 flex justify-between text-[11px] text-subtle">
          <span>{data[0]!.label}</span>
          <span>{data[data.length - 1]!.label}</span>
        </div>
      )}
    </div>
  );
}

/** Horizontal labelled bars for breakdowns (e.g. by category or feature). */
export function HBars({ data, format = (n: number) => String(n) }: { data: { label: string; value: number }[]; format?: (n: number) => string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ul className="space-y-2">
      {data.map((d) => (
        <li key={d.label} className="text-sm">
          <div className="flex justify-between gap-2">
            <span className="truncate text-ink-2">{d.label}</span>
            <span className="shrink-0 font-medium tabular-nums text-ink">{format(d.value)}</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-mist">
            <div className="h-1.5 rounded-full bg-brand" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Meter({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className={className} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
      <div className="h-1.5 rounded-full bg-mist">
        <div className="h-1.5 rounded-full bg-brand" style={{ width: `${pct * 100}%` }} />
      </div>
    </div>
  );
}
