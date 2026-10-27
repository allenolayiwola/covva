"use client";
import * as React from "react";
import { ArrowUpRight } from "lucide-react";
import { Field, Input, Select, cn } from "@im/ui";
import { formatGHS, type RiskField } from "@im/core";
import { estimateAction, type EstimateState } from "./actions";

export interface EmbedCategory { slug: string; name: string; fields: RiskField[] }

/** Map the widget answers onto the quick-start params the Covva quote flow understands. */
function continueHref(siteUrl: string, partner: string, slug: string, risk: Record<string, string>) {
  const p = new URLSearchParams({ category: slug, ref: partner, src: "widget" });
  const value = risk.vehicle_value || risk.building_value || risk.contents_value || risk.sum_insured || risk.premises_value;
  if (value) p.set("value", value);
  const people = risk.travellers || risk.members;
  if (people) p.set("people", people);
  if (risk.trip_days) p.set("days", risk.trip_days);
  return `${siteUrl.replace(/\/$/, "")}/get-started?${p.toString()}`;
}

/**
 * Compact quote flow: cover type → 3–5 rating fields → indicative estimates → "Continue on Covva"
 * (new tab, with the partner's referral code). No sign-in, no personal data, no payment in the iframe.
 */
export function EmbedQuote({ partner, categories, initial, colour, siteUrl }: { partner: string; categories: EmbedCategory[]; initial: string; colour: string; siteUrl: string }) {
  const [slug, setSlug] = React.useState(initial);
  const [risk, setRisk] = React.useState<Record<string, string>>({});
  const [state, setState] = React.useState<EstimateState>(null);
  const [pending, startTransition] = React.useTransition();
  const uid = React.useId();
  const category = categories.find((c) => c.slug === slug) ?? categories[0]!;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => setState(await estimateAction({ partner, category: category.slug, risk })));
  };

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-line p-4">
        <h1 className="text-base font-semibold text-ink">Get an instant estimate</h1>
        {categories.length > 1 && (
          <Field label="Cover" htmlFor={`${uid}-cat`}>
            <Select id={`${uid}-cat`} value={slug} onChange={(e) => { setSlug(e.target.value); setRisk({}); setState(null); }}>
              {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </Select>
          </Field>
        )}
        {category.fields.map((f) => {
          const id = `${uid}-${f.key}`;
          const value = risk[f.key] ?? "";
          const set = (v: string) => setRisk((r) => ({ ...r, [f.key]: v }));
          return (
            <Field key={f.key} label={f.label} htmlFor={id} hint={f.help}>
              {f.type === "select" && f.options?.length ? (
                <Select id={id} value={value} onChange={(e) => set(e.target.value)}>
                  <option value="">Choose…</option>
                  {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </Select>
              ) : f.type === "boolean" ? (
                <Select id={id} value={value} onChange={(e) => set(e.target.value)}>
                  <option value="">Choose…</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </Select>
              ) : (
                <Input id={id} value={value} onChange={(e) => set(e.target.value)} inputMode={f.type === "number" || f.type === "currency" ? "numeric" : undefined} type={f.type === "number" || f.type === "currency" ? "number" : f.type === "date" ? "date" : "text"} min={f.min} max={f.max} placeholder={f.placeholder} />
              )}
            </Field>
          );
        })}
        <button type="submit" disabled={pending} className="inline-flex h-11 w-full items-center justify-center rounded-xl px-4 text-sm font-semibold text-white disabled:opacity-60" style={{ background: colour }}>
          {pending ? "Checking insurers…" : "See estimates"}
        </button>
      </form>

      {state && !state.ok && <p role="alert" className="rounded-xl bg-danger-bg px-3 py-2 text-sm text-danger">{state.error}</p>}
      {state?.ok && (
        <section aria-live="polite" className="space-y-3 rounded-2xl border border-line p-4">
          {state.result.estimates.length ? (
            <>
              <p className="text-sm text-ink">
                <span className="font-semibold">{state.result.insurersCompared} insurer{state.result.insurersCompared === 1 ? "" : "s"}</span> · from{" "}
                <span className="font-semibold">{formatGHS(state.result.range!.min)}</span> a year
              </p>
              <ul className="divide-y divide-line">
                {state.result.estimates.map((e, i) => (
                  <li key={`${e.insurerName}-${e.productName}-${i}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="min-w-0"><span className="block truncate font-medium text-ink">{e.insurerName}</span><span className="block truncate text-xs text-muted">{e.productName}</span></span>
                    <span className="shrink-0 tabular-nums text-ink">{formatGHS(e.premium)}<span className="text-xs text-muted">/yr</span></span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted">We need a few more details to price this. Continue on Covva and a licensed broker will help.</p>
          )}
          <p className="text-[11px] leading-snug text-muted">{state.result.note}</p>
        </section>
      )}

      <a
        href={continueHref(siteUrl, partner, category.slug, risk)}
        target="_blank"
        rel="noopener"
        className={cn("inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border-2 px-4 text-sm font-semibold")}
        style={{ borderColor: colour, color: colour }}
      >
        Continue on Covva <ArrowUpRight className="size-4" aria-hidden />
      </a>
      <p className="text-center text-[11px] text-muted">Opens covva.com.gh in a new tab to sign up and get binding quotes. You never pay inside this widget.</p>
    </div>
  );
}
