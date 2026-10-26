import type { Row } from "@im/db";
import { cn } from "@im/ui";

type Version = Pick<
  Row<"product_versions">,
  "coverage" | "limits" | "excesses" | "exclusions" | "key_exclusion" | "waiting_period_days" | "optional_benefits" | "conditions" | "claims_process" | "rating" | "wording_url" | "effective_from"
>;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const show = (v: unknown) => (v === undefined || v === null || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

function Cell({ value, changed, side }: { value: React.ReactNode; changed: boolean; side: "old" | "new" }) {
  return (
    <td className={cn("border-t border-line px-3 py-2 align-top text-sm", changed && (side === "old" ? "bg-danger-bg/40 text-danger" : "bg-mint/60 text-brand-deep"))}>{value}</td>
  );
}

function KVRows({ title, a, b }: { title: string; a: Record<string, unknown>; b: Record<string, unknown> }) {
  const keys = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])];
  return (
    <>
      <tr><th colSpan={3} className="bg-mist px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-muted">{title}</th></tr>
      {keys.map((k) => {
        const changed = !same(a?.[k], b?.[k]);
        return (
          <tr key={`${title}-${k}`}>
            <td className="border-t border-line px-3 py-2 font-mono text-xs text-ink">{k}</td>
            <Cell value={show(a?.[k])} changed={changed} side="old" />
            <Cell value={show(b?.[k])} changed={changed} side="new" />
          </tr>
        );
      })}
      {!keys.length && <tr><td colSpan={3} className="border-t border-line px-3 py-2 text-sm text-muted">None</td></tr>}
    </>
  );
}

function toMap(list: unknown): Record<string, unknown> {
  if (!Array.isArray(list)) return {};
  const out: Record<string, unknown> = {};
  for (const item of list as { key?: string; label?: string; included?: boolean; premium?: number; detail?: string }[]) {
    const k = item.key ?? item.label ?? JSON.stringify(item);
    out[k] = item.included !== undefined ? `${item.included ? "✓" : "✗"} ${item.label ?? ""}${item.detail ? ` — ${item.detail}` : ""}` : `${item.label ?? ""}${item.premium !== undefined ? ` (GH₵ ${item.premium})` : ""}`;
  }
  return out;
}

/** Side-by-side diff of a proposed product version against the current version. */
export function VersionDiff({ current, proposed }: { current: Version | null; proposed: Version }) {
  const c = current ?? ({} as Partial<Version>);
  const exA = new Set(c.exclusions ?? []);
  const exB = new Set(proposed.exclusions);
  const scalar: [string, unknown, unknown][] = [
    ["Key exclusion", c.key_exclusion, proposed.key_exclusion],
    ["Waiting period (days)", c.waiting_period_days, proposed.waiting_period_days],
    ["Effective from", c.effective_from, proposed.effective_from],
    ["Wording URL", c.wording_url, proposed.wording_url],
    ["Conditions", c.conditions, proposed.conditions],
    ["Claims process", c.claims_process, proposed.claims_process],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left">
        <thead>
          <tr className="text-xs font-semibold uppercase tracking-wider text-muted">
            <th className="w-48 px-3 py-2">Field</th>
            <th className="px-3 py-2">Current {current ? "" : "(none)"}</th>
            <th className="px-3 py-2">Proposed</th>
          </tr>
        </thead>
        <tbody>
          <KVRows title="Coverage" a={toMap(c.coverage)} b={toMap(proposed.coverage)} />
          <KVRows title="Limits" a={(c.limits as Record<string, unknown>) ?? {}} b={(proposed.limits as Record<string, unknown>) ?? {}} />
          <KVRows title="Excesses" a={(c.excesses as Record<string, unknown>) ?? {}} b={(proposed.excesses as Record<string, unknown>) ?? {}} />
          <tr><th colSpan={3} className="bg-mist px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-muted">Exclusions</th></tr>
          {[...new Set([...exA, ...exB])].map((e) => (
            <tr key={e}>
              <td className="border-t border-line px-3 py-2 text-xs text-muted">{exA.has(e) && exB.has(e) ? "unchanged" : exB.has(e) ? "added" : "removed"}</td>
              <Cell value={exA.has(e) ? e : "—"} changed={!exB.has(e)} side="old" />
              <Cell value={exB.has(e) ? e : "—"} changed={!exA.has(e)} side="new" />
            </tr>
          ))}
          <KVRows title="Optional benefits" a={toMap(c.optional_benefits)} b={toMap(proposed.optional_benefits)} />
          <tr><th colSpan={3} className="bg-mist px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-muted">Terms</th></tr>
          {scalar.map(([label, a, b]) => (
            <tr key={label}>
              <td className="border-t border-line px-3 py-2 text-xs text-ink">{label}</td>
              <Cell value={show(a)} changed={!same(a ?? null, b ?? null)} side="old" />
              <Cell value={show(b)} changed={!same(a ?? null, b ?? null)} side="new" />
            </tr>
          ))}
          <tr><th colSpan={3} className="bg-mist px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wider text-muted">Rating rules {same(c.rating, proposed.rating) ? "(unchanged)" : "(changed)"}</th></tr>
          <tr>
            <td className="border-t border-line px-3 py-2 text-xs text-muted">rating JSON</td>
            <td className="border-t border-line p-2 align-top"><pre className="max-h-80 overflow-auto rounded-lg bg-mist p-2 text-[11px]">{JSON.stringify(c.rating ?? null, null, 2)}</pre></td>
            <td className="border-t border-line p-2 align-top"><pre className={cn("max-h-80 overflow-auto rounded-lg p-2 text-[11px]", same(c.rating, proposed.rating) ? "bg-mist" : "bg-mint/60")}>{JSON.stringify(proposed.rating, null, 2)}</pre></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
