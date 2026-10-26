"use client";
import { useMemo, useState } from "react";
import { formatGHS, GHANA_REGIONS, ratePremium, type RatingRule, type RiskField } from "@im/core";
import { cn } from "@im/ui";

type Risk = Record<string, unknown>;

function sample(fields: RiskField[], level: "low" | "typical" | "high"): Risk {
  const r: Risk = {};
  const pick = <T,>(arr: T[]) => (level === "low" ? arr[0] : level === "high" ? arr[arr.length - 1] : arr[Math.floor(arr.length / 2)]);
  for (const f of fields) {
    switch (f.type) {
      case "number": {
        const min = f.min ?? 0;
        const max = f.max ?? Math.max(min * 4, 10);
        r[f.key] = Math.round(level === "low" ? min : level === "high" ? max : min + (max - min) / 3);
        break;
      }
      case "currency": {
        const min = f.min ?? 1000;
        const base = Math.max(min, 50_000);
        r[f.key] = level === "low" ? min : level === "high" ? (f.max ?? base * 6) : (f.max ? Math.min(base, f.max) : base);
        break;
      }
      case "select":
        r[f.key] = pick(f.options?.map((o) => o.value) ?? [""]);
        break;
      case "multiselect":
        r[f.key] = level === "high" ? [] : (f.options?.map((o) => o.value) ?? []).slice(0, 2);
        break;
      case "boolean":
        r[f.key] = level === "high";
        break;
      case "region":
        r[f.key] = "Greater Accra";
        break;
      case "date":
        r[f.key] = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
        break;
      default:
        r[f.key] = "Sample";
    }
  }
  return r;
}

/**
 * Test pricing: runs @im/core ratePremium for the current and proposed rating rules
 * against sample risks generated from the category's risk schema (editable).
 */
export function TestPricePanel({ fields, current, proposed }: { fields: RiskField[]; current: RatingRule | null; proposed: RatingRule | null }) {
  const presets = useMemo(() => ({ low: sample(fields, "low"), typical: sample(fields, "typical"), high: sample(fields, "high") }), [fields]);
  const [risk, setRisk] = useState<Risk>(presets.typical);
  const [preset, setPreset] = useState<"low" | "typical" | "high" | "custom">("typical");

  const run = (rule: RatingRule | null) => {
    if (!rule || !("model" in rule)) return null;
    try {
      return ratePremium(rule, risk);
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Rating failed" } as const;
    }
  };
  const a = run(current);
  const b = run(proposed);
  const delta = a && b && !("error" in a) && !("error" in b) && a.premium ? (b.premium - a.premium) / a.premium : null;
  const ctl = "h-9 w-full rounded-[10px] border border-line bg-white px-2 text-sm";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {(["low", "typical", "high"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => { setRisk(presets[p]); setPreset(p); }}
            className={cn("rounded-lg px-3 py-1 text-sm capitalize", preset === p ? "bg-mint font-semibold text-brand-deep" : "text-muted hover:bg-mist")}
          >
            {p === "low" ? "Low risk" : p === "high" ? "High risk" : "Typical"}
          </button>
        ))}
        {preset === "custom" && <span className="rounded-lg px-3 py-1 text-sm text-ink">Custom</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((f) => (
          <label key={f.key} className="text-xs font-medium text-muted">
            {f.label}
            {f.type === "select" ? (
              <select className={ctl} value={String(risk[f.key] ?? "")} onChange={(e) => { setRisk({ ...risk, [f.key]: e.target.value }); setPreset("custom"); }}>
                {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : f.type === "region" ? (
              <select className={ctl} value={String(risk[f.key] ?? "")} onChange={(e) => { setRisk({ ...risk, [f.key]: e.target.value }); setPreset("custom"); }}>
                {GHANA_REGIONS.map((r) => <option key={r}>{r}</option>)}
              </select>
            ) : f.type === "boolean" ? (
              <select className={ctl} value={risk[f.key] ? "true" : "false"} onChange={(e) => { setRisk({ ...risk, [f.key]: e.target.value === "true" }); setPreset("custom"); }}>
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            ) : f.type === "multiselect" ? (
              <input className={ctl} value={(risk[f.key] as string[] | undefined)?.join(", ") ?? ""} onChange={(e) => { setRisk({ ...risk, [f.key]: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }); setPreset("custom"); }} />
            ) : (
              <input
                className={ctl}
                type={f.type === "number" || f.type === "currency" ? "number" : f.type === "date" ? "date" : "text"}
                value={String(risk[f.key] ?? "")}
                onChange={(e) => { setRisk({ ...risk, [f.key]: f.type === "number" || f.type === "currency" ? Number(e.target.value) : e.target.value }); setPreset("custom"); }}
              />
            )}
          </label>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {([["Current version", a], ["Proposed version", b]] as const).map(([label, res]) => (
          <div key={label} className="rounded-xl border border-line p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
            {!res ? (
              <p className="mt-2 text-sm text-muted">No rating rule.</p>
            ) : "error" in res ? (
              <p className="mt-2 text-sm text-danger">{res.error}</p>
            ) : (
              <>
                <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{formatGHS(res.premium)}</p>
                {!res.ok && <p className="text-xs text-amber">Missing: {res.missingFields.join(", ")}</p>}
                <ul className="mt-2 space-y-0.5 text-xs text-muted">
                  {res.lines.map((l, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span>{l.label}</span>
                      <span className="tabular-nums">{l.amount !== undefined ? formatGHS(l.amount) : `× ${l.factor}`}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ))}
      </div>
      {delta !== null && (
        <p className={cn("text-sm font-medium", Math.abs(delta) > 0.15 ? "text-amber" : "text-ink-2")}>
          Proposed premium is {delta >= 0 ? "+" : ""}{(delta * 100).toFixed(1)}% vs current for this risk{Math.abs(delta) > 0.15 ? " — a large change; confirm with the insurer." : "."}
        </p>
      )}
      <p className="text-xs text-subtle">Estimates only — engine output is indicative and never binding.</p>
    </div>
  );
}
