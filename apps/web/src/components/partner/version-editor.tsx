"use client";
import { useActionState, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Notice, Textarea } from "@im/ui";
import { formatGHS, ratePremium, type RatingRule, type RiskField } from "@im/core";
import { FormMessage, SubmitButton, type FormAction } from "./action-form";
import { RiskFields } from "./risk-fields";

export interface VersionDraft {
  coverage: { key: string; label: string; included: boolean; detail?: string }[];
  limits: { key: string; value: string }[];
  excesses: { key: string; value: string }[];
  exclusions: string;
  keyExclusion: string;
  waitingPeriodDays: number;
  optionalBenefits: { key: string; label: string; premium: string }[];
  conditions: string;
  claimsProcess: string;
  rating: string;
  effectiveFrom: string;
  wordingUrl: string;
}

const slug = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

function KeyValueRows({ legend, rows, onChange, numeric }: { legend: string; rows: { key: string; value: string }[]; onChange: (r: { key: string; value: string }[]) => void; numeric?: boolean }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-semibold text-ink">{legend}</legend>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <Input aria-label={`${legend} name`} value={r.key} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, key: e.currentTarget.value } : x)))} placeholder="e.g. third_party_property" className="h-9 text-sm" />
          <Input aria-label={`${legend} value`} value={r.value} inputMode={numeric ? "decimal" : undefined} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, value: e.currentTarget.value } : x)))} placeholder={numeric ? "1000" : "40000 or text"} className="h-9 text-sm" />
          <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="rounded-lg p-2 text-muted hover:bg-mist" aria-label="Remove row"><Trash2 className="size-4" /></button>
        </div>
      ))}
      <Button type="button" size="sm" variant="ghost" onClick={() => onChange([...rows, { key: "", value: "" }])}><Plus className="size-4" /> Add</Button>
    </fieldset>
  );
}

/**
 * Product version editor with a live "test price" panel. Submitting creates a NEW version
 * with status pending_approval — the platform approves it before it is used for quoting.
 */
export function VersionEditor({ action, productId, initial, riskSchema }: { action: FormAction; productId: string; initial: VersionDraft; riskSchema: RiskField[] }) {
  const [state, formAction] = useActionState(action, { ok: false });
  const [d, setD] = useState<VersionDraft>(initial);
  const [risk, setRisk] = useState<Record<string, unknown>>({});
  const set = <K extends keyof VersionDraft>(k: K, v: VersionDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  const test = useMemo(() => {
    let rule: RatingRule;
    try {
      rule = JSON.parse(d.rating) as RatingRule;
    } catch (e) {
      return { error: `Rating JSON is invalid: ${(e as Error).message}` };
    }
    if (!rule || typeof rule !== "object" || !("model" in rule)) return { error: "Rating rule needs a “model” (rate_on_value, per_day, per_person, age_banded or flat)." };
    try {
      return { result: ratePremium(rule, risk) };
    } catch (e) {
      return { error: `Rating rule failed: ${(e as Error).message}` };
    }
  }, [d.rating, risk]);

  const payload = JSON.stringify({
    productId,
    coverage: d.coverage.filter((c) => c.label.trim()).map((c) => ({ ...c, key: c.key || slug(c.label) })),
    limits: Object.fromEntries(d.limits.filter((r) => r.key.trim()).map((r) => [slug(r.key), r.value !== "" && !Number.isNaN(Number(r.value)) ? Number(r.value) : r.value])),
    excesses: Object.fromEntries(d.excesses.filter((r) => r.key.trim()).map((r) => [slug(r.key), r.value !== "" && !Number.isNaN(Number(r.value)) ? Number(r.value) : r.value])),
    exclusions: d.exclusions.split("\n").map((s) => s.trim()).filter(Boolean),
    keyExclusion: d.keyExclusion,
    waitingPeriodDays: d.waitingPeriodDays,
    optionalBenefits: d.optionalBenefits.filter((b) => b.label.trim()).map((b) => ({ key: b.key || slug(b.label), label: b.label, premium: b.premium === "" ? undefined : Number(b.premium) })),
    conditions: d.conditions,
    claimsProcess: d.claimsProcess,
    rating: d.rating,
    effectiveFrom: d.effectiveFrom,
    wordingUrl: d.wordingUrl,
  });

  return (
    <form action={formAction} className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <input type="hidden" name="payload" value={payload} />
      <div className="min-w-0 space-y-6">
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">Coverage items</legend>
          {d.coverage.map((c, i) => (
            <div key={i} className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-2">
              <input type="checkbox" aria-label="Included" checked={c.included} onChange={(e) => set("coverage", d.coverage.map((x, j) => (j === i ? { ...x, included: e.currentTarget.checked } : x)))} className="size-4 accent-brand" />
              <Input aria-label="Cover item" value={c.label} onChange={(e) => set("coverage", d.coverage.map((x, j) => (j === i ? { ...x, label: e.currentTarget.value } : x)))} placeholder="Windscreen" className="h-9 text-sm" />
              <Input aria-label="Detail" value={c.detail ?? ""} onChange={(e) => set("coverage", d.coverage.map((x, j) => (j === i ? { ...x, detail: e.currentTarget.value } : x)))} placeholder="Detail (optional)" className="h-9 text-sm" />
              <button type="button" onClick={() => set("coverage", d.coverage.filter((_, j) => j !== i))} className="rounded-lg p-2 text-muted hover:bg-mist" aria-label="Remove cover item"><Trash2 className="size-4" /></button>
            </div>
          ))}
          <Button type="button" size="sm" variant="ghost" onClick={() => set("coverage", [...d.coverage, { key: "", label: "", included: true }])}><Plus className="size-4" /> Add cover item</Button>
          <p className="text-xs text-muted">Unticked items are shown to customers as “not included”.</p>
        </fieldset>

        <div className="grid gap-6 md:grid-cols-2">
          <KeyValueRows legend="Limits" rows={d.limits} onChange={(r) => set("limits", r)} />
          <KeyValueRows legend="Excesses (GH₵)" rows={d.excesses} onChange={(r) => set("excesses", r)} numeric />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Exclusions (one per line)" htmlFor="ve-excl">
            <Textarea id="ve-excl" value={d.exclusions} onChange={(e) => set("exclusions", e.currentTarget.value)} rows={5} className="text-sm" />
          </Field>
          <div className="space-y-4">
            <Field label="Key exclusion (shown on comparison)" htmlFor="ve-key">
              <Input id="ve-key" value={d.keyExclusion} onChange={(e) => set("keyExclusion", e.currentTarget.value)} className="h-10 text-sm" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Waiting period (days)" htmlFor="ve-wait">
                <Input id="ve-wait" type="number" min={0} value={d.waitingPeriodDays} onChange={(e) => set("waitingPeriodDays", Number(e.currentTarget.value || 0))} className="h-10 text-sm" />
              </Field>
              <Field label="Effective from" htmlFor="ve-eff">
                <Input id="ve-eff" type="date" value={d.effectiveFrom} onChange={(e) => set("effectiveFrom", e.currentTarget.value)} className="h-10 text-sm" />
              </Field>
            </div>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">Optional benefits</legend>
          {d.optionalBenefits.map((b, i) => (
            <div key={i} className="grid grid-cols-[1fr_140px_auto] gap-2">
              <Input aria-label="Benefit" value={b.label} onChange={(e) => set("optionalBenefits", d.optionalBenefits.map((x, j) => (j === i ? { ...x, label: e.currentTarget.value } : x)))} placeholder="Excess protector" className="h-9 text-sm" />
              <Input aria-label="Annual premium" type="number" min={0} value={b.premium} onChange={(e) => set("optionalBenefits", d.optionalBenefits.map((x, j) => (j === i ? { ...x, premium: e.currentTarget.value } : x)))} placeholder="GH₵ / year" className="h-9 text-sm" />
              <button type="button" onClick={() => set("optionalBenefits", d.optionalBenefits.filter((_, j) => j !== i))} className="rounded-lg p-2 text-muted hover:bg-mist" aria-label="Remove benefit"><Trash2 className="size-4" /></button>
            </div>
          ))}
          <Button type="button" size="sm" variant="ghost" onClick={() => set("optionalBenefits", [...d.optionalBenefits, { key: "", label: "", premium: "" }])}><Plus className="size-4" /> Add benefit</Button>
        </fieldset>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Conditions" htmlFor="ve-cond">
            <Textarea id="ve-cond" value={d.conditions} onChange={(e) => set("conditions", e.currentTarget.value)} rows={4} className="text-sm" />
          </Field>
          <Field label="Claims process" htmlFor="ve-claims">
            <Textarea id="ve-claims" value={d.claimsProcess} onChange={(e) => set("claimsProcess", e.currentTarget.value)} rows={4} className="text-sm" />
          </Field>
        </div>
        <Field label="Policy wording URL (approved wording)" htmlFor="ve-wording">
          <Input id="ve-wording" type="url" value={d.wordingUrl} onChange={(e) => set("wordingUrl", e.currentTarget.value)} placeholder="https://…" className="h-10 text-sm" />
        </Field>
        <Field label="Rating rule (JSON)" htmlFor="ve-rating" hint="Models: rate_on_value, per_day, per_person, age_banded, flat — with optional variants, loadings and min_premium.">
          <Textarea id="ve-rating" value={d.rating} onChange={(e) => set("rating", e.currentTarget.value)} rows={12} spellCheck={false} className="font-mono text-xs" />
        </Field>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel="Submitting…" disabled={"error" in test}>Submit version for approval</SubmitButton>
          <p className="text-xs text-muted">Creates a new version with status “Pending approval”. The current approved version stays live until the platform approves this one.</p>
        </div>
        <FormMessage state={state} />
      </div>

      <aside className="h-fit space-y-3 rounded-card bg-mist p-4 xl:sticky xl:top-24">
        <h3 className="font-semibold text-ink">Test price</h3>
        <p className="text-xs text-muted">Enter sample risk answers to see what the rating rule produces. Nothing is saved.</p>
        <RiskFields fields={riskSchema} requiredOff idPrefix="tp" onChange={(k, v) => setRisk((r) => ({ ...r, [k]: v === "" ? undefined : riskSchema.find((f) => f.key === k)?.type === "number" || riskSchema.find((f) => f.key === k)?.type === "currency" ? Number(v) : v === "true" ? true : v === "false" ? false : v }))} />
        {"error" in test ? (
          <Notice tone="danger">{test.error}</Notice>
        ) : (
          <div className="rounded-xl bg-white p-3 text-sm">
            {!test.result.ok && <p className="mb-1 text-xs text-amber">Missing: {test.result.missingFields.join(", ")}</p>}
            <ul className="space-y-0.5 text-muted">
              {test.result.lines.map((l, i) => (
                <li key={i} className="flex justify-between gap-3"><span>{l.label}</span><span className="tabular-nums">{l.amount != null ? formatGHS(l.amount) : `× ${l.factor}`}</span></li>
              ))}
            </ul>
            <p className="mt-2 text-lg font-semibold text-ink">{formatGHS(test.result.premium)} <span className="text-xs font-normal text-muted">/ year (estimate)</span></p>
          </div>
        )}
      </aside>
    </form>
  );
}
