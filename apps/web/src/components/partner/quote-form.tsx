"use client";
import { useActionState, useMemo, useState } from "react";
import { Button, Field, Input, Notice, Select, Textarea } from "@im/ui";
import { formatGHS, ratePremium, type RatingResult, type RatingRule } from "@im/core";
import { FormMessage, SubmitButton, type FormAction } from "./action-form";

export interface VersionOption {
  id: string;
  insurerId: string;
  label: string;
  rating: unknown;
  excesses: Record<string, unknown>;
  keyExclusion: string | null;
}

/**
 * "Prepare quote" (broker) / "Respond with quote" (insurer). Estimates can be pre-filled
 * from the insurer's approved rating rules with the shared rating engine — it never
 * creates a binding price on its own: the user chooses the quote status.
 */
export function QuoteForm({
  action,
  hidden,
  insurers,
  versions,
  risk,
  defaults,
  submitLabel = "Save quote",
  lockInsurer,
}: {
  action: FormAction;
  hidden: Record<string, string>;
  insurers: { id: string; name: string }[];
  versions: VersionOption[];
  risk: Record<string, unknown>;
  defaults?: { insurerId?: string; versionId?: string; status?: string; premium?: number | null; excess?: number | null; sumInsured?: number | null; keyExclusion?: string | null; validUntil?: string | null; note?: string | null };
  submitLabel?: string;
  lockInsurer?: boolean;
}) {
  const [state, formAction] = useActionState(action, { ok: false });
  const [insurerId, setInsurerId] = useState(defaults?.insurerId ?? insurers[0]?.id ?? "");
  const options = useMemo(() => versions.filter((v) => v.insurerId === insurerId), [versions, insurerId]);
  const [versionId, setVersionId] = useState(defaults?.versionId ?? options[0]?.id ?? "");
  const [premium, setPremium] = useState(defaults?.premium != null ? String(defaults.premium) : "");
  const [excess, setExcess] = useState(defaults?.excess != null ? String(defaults.excess) : "");
  const [sumInsured, setSumInsured] = useState(defaults?.sumInsured != null ? String(defaults.sumInsured) : "");
  const [keyExclusion, setKeyExclusion] = useState(defaults?.keyExclusion ?? "");
  const [rated, setRated] = useState<RatingResult | null>(null);

  function priceFromRates() {
    const v = versions.find((x) => x.id === versionId);
    if (!v) return;
    const r = ratePremium(v.rating as RatingRule, risk);
    setRated(r);
    if (r.premium > 0) setPremium(String(r.premium));
    if (r.sumInsured) setSumInsured(String(r.sumInsured));
    const firstExcess = Object.values(v.excesses ?? {}).find((x) => typeof x === "number") as number | undefined;
    if (firstExcess !== undefined) setExcess(String(firstExcess));
    if (v.keyExclusion) setKeyExclusion(v.keyExclusion);
  }

  return (
    <form action={formAction} className="space-y-4">
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Insurer" htmlFor="qf-insurer">
          {lockInsurer ? (
            <>
              <input type="hidden" name="insurerOrgId" value={insurerId} />
              <Input id="qf-insurer" value={insurers.find((i) => i.id === insurerId)?.name ?? ""} disabled className="h-10 text-sm" />
            </>
          ) : (
            <Select id="qf-insurer" name="insurerOrgId" value={insurerId} onChange={(e) => { setInsurerId(e.currentTarget.value); setVersionId(versions.find((v) => v.insurerId === e.currentTarget.value)?.id ?? ""); setRated(null); }} className="h-10 text-sm" required>
              {insurers.length === 0 && <option value="">No appointed insurers for this category</option>}
              {insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Product version" htmlFor="qf-version" hint={options.length ? undefined : "No approved product data — enter terms manually."}>
          <Select id="qf-version" name="productVersionId" value={versionId} onChange={(e) => { setVersionId(e.currentTarget.value); setRated(null); }} className="h-10 text-sm">
            <option value="">Manual (no product version)</option>
            {options.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </Select>
        </Field>
      </div>

      {versionId && (
        <div className="rounded-xl bg-mist p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-2">Pre-fill an <span className="font-semibold">estimate</span> from the insurer’s approved rates and the customer’s risk answers.</p>
            <Button type="button" variant="secondary" size="sm" onClick={priceFromRates}>Price from approved rates</Button>
          </div>
          {rated && (
            <div className="mt-3 text-sm">
              {!rated.ok && <Notice tone="wait" className="mb-2">Missing risk answers: {rated.missingFields.join(", ")}. The price may be incomplete.</Notice>}
              <ul className="space-y-0.5 text-muted">
                {rated.lines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-3"><span>{l.label}</span><span className="tabular-nums">{l.amount != null ? formatGHS(l.amount) : `× ${l.factor}`}</span></li>
                ))}
              </ul>
              <p className="mt-1 font-semibold text-ink">Indicative premium {formatGHS(rated.premium)}</p>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Premium (GH₵ / year)" htmlFor="qf-premium">
          <Input id="qf-premium" name="premium" type="number" min={0} step="0.01" required value={premium} onChange={(e) => setPremium(e.currentTarget.value)} className="h-10 text-sm" />
        </Field>
        <Field label="Excess (GH₵)" htmlFor="qf-excess">
          <Input id="qf-excess" name="excess" type="number" min={0} step="0.01" value={excess} onChange={(e) => setExcess(e.currentTarget.value)} className="h-10 text-sm" />
        </Field>
        <Field label="Sum insured (GH₵)" htmlFor="qf-sum">
          <Input id="qf-sum" name="sumInsured" type="number" min={0} step="0.01" value={sumInsured} onChange={(e) => setSumInsured(e.currentTarget.value)} className="h-10 text-sm" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Key exclusion" htmlFor="qf-excl" className="sm:col-span-2">
          <Input id="qf-excl" name="keyExclusion" value={keyExclusion} onChange={(e) => setKeyExclusion(e.currentTarget.value)} className="h-10 text-sm" />
        </Field>
        <Field label="Valid until" htmlFor="qf-valid" hint="Ready to accept defaults to 14 days">
          <Input id="qf-valid" name="validUntil" type="date" defaultValue={defaults?.validUntil?.slice(0, 10) ?? ""} className="h-10 text-sm" />
        </Field>
      </div>
      <Field label="Quote status" htmlFor="qf-status" hint="Only “Ready to accept” is a binding offer the customer can apply for.">
        <Select id="qf-status" name="status" defaultValue={defaults?.status ?? "estimate"} className="h-10 text-sm">
          <option value="estimate">Estimate — indicative, from approved rates</option>
          <option value="awaiting_underwriting">Awaiting underwriting — insurer reviewing</option>
          <option value="ready_to_accept">Ready to accept — binding offer</option>
        </Select>
      </Field>
      <Field label="Note to customer" htmlFor="qf-note">
        <Textarea id="qf-note" name="brokerNote" rows={2} defaultValue={defaults?.note ?? ""} className="min-h-16 text-sm" placeholder="What's included, what to check, any conditions." />
      </Field>
      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
