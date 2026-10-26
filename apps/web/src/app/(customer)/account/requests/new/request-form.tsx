"use client";
import * as React from "react";
import { useActionState } from "react";
import { ArrowLeft, Check, ChevronDown, CloudOff, Save, Search } from "lucide-react";
import { CATEGORY_AVAILABILITY, GHANA_REGIONS, normaliseRegistration, prefillFromLookup, quickQuoteFields, riskSchemaToZod, type RiskField, type VehicleData } from "@im/core";
import { Button, Checkbox, Field, Input, Notice, Pill, Select, Textarea, cn } from "@im/ui";
import { CategoryIcon } from "@/components/customer/category-icon";
import { FormMessage, SubmitButton } from "@/components/customer/form-bits";
import { initialActionState } from "@/components/customer/utils";
import { submitRequest } from "./actions";

export interface CategoryOption {
  slug: string;
  name: string;
  icon: string | null;
  short_description: string | null;
  availability: "integrated" | "broker_assisted" | "planned";
  segment: string;
  regulatory_note: string | null;
  risk_schema: RiskField[];
}

type Value = string | string[];
type Values = Record<string, Value>;
type RequestType = "new_cover" | "renewal" | "switch" | "endorsement";

const TYPE_COPY: Record<RequestType, { title: string; body?: string; noteLabel?: string }> = {
  new_cover: { title: "Tell us what you need" },
  renewal: {
    title: "Renewal details",
    body: "Check your details are still right. Your broker will prepare renewal options; your current cover continues until it ends.",
    noteLabel: "Anything that has changed since last year?",
  },
  switch: {
    title: "Switch insurer",
    body: "This starts a review with your broker. Your existing cover is not cancelled until the replacement is accepted by the new insurer, the start date is agreed and payment is confirmed.",
    noteLabel: "Why do you want to switch? (optional)",
  },
  endorsement: {
    title: "Request a change to your policy",
    body: "Tell your broker what you'd like to change. Changes take effect only when the insurer confirms them and issues an endorsement.",
    noteLabel: "What would you like to change?",
  },
};

function draftKey(slug: string, type: RequestType, policy?: string) {
  return `im:request-draft:v1:${type}:${slug}${policy ? `:${policy}` : ""}`;
}

function toFormValue(f: RiskField, v: unknown): Value {
  if (f.type === "multiselect") return Array.isArray(v) ? v.map(String) : v ? [String(v)] : [];
  if (f.type === "boolean") return v === true || v === "true" ? "true" : v === false || v === "false" ? "false" : "";
  return v === undefined || v === null ? "" : String(v);
}

export interface BeneficiaryOption {
  id: string;
  full_name: string;
  relationship: string;
  consent_status: string;
  region: string | null;
}

export function RequestForm({
  categories,
  initialSlug,
  type,
  policyId,
  policyLabel,
  initialRisk,
  defaultRegion,
  beneficiaries = [],
  initialBeneficiaryId,
  bundle,
}: {
  categories: CategoryOption[];
  initialSlug?: string;
  type: RequestType;
  policyId?: string;
  policyLabel?: string;
  initialRisk?: Record<string, unknown>;
  defaultRegion?: string;
  /** Diaspora: family members in Ghana the sponsor can request cover for. */
  beneficiaries?: BeneficiaryOption[];
  initialBeneficiaryId?: string;
  /** Product bundle slug (diaspora packs): the pack's other items are saved as drafts on submit. */
  bundle?: string;
}) {
  const [slug, setSlug] = React.useState<string | undefined>(
    initialSlug && categories.some((c) => c.slug === initialSlug && c.availability !== "planned") ? initialSlug : undefined,
  );
  const category = categories.find((c) => c.slug === slug);

  if (!category) {
    return <CategoryPicker categories={categories} onPick={setSlug} />;
  }
  return (
    <RiskForm
      key={category.slug}
      category={category}
      type={type}
      policyId={policyId}
      policyLabel={policyLabel}
      initialRisk={initialRisk}
      defaultRegion={defaultRegion}
      beneficiaries={beneficiaries}
      initialBeneficiaryId={initialBeneficiaryId}
      bundle={bundle}
      onBack={policyId ? undefined : () => setSlug(undefined)}
    />
  );
}

function CategoryPicker({ categories, onPick }: { categories: CategoryOption[]; onPick: (slug: string) => void }) {
  const groups = [
    { key: "personal", label: "For you and your family" },
    { key: "business", label: "For your business" },
    { key: "specialist", label: "Specialist" },
  ];
  return (
    <div className="space-y-8">
      {groups.map((g) => {
        const list = categories.filter((c) => (c.segment || "personal") === g.key);
        if (!list.length) return null;
        return (
          <section key={g.key} aria-label={g.label}>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.1em] text-muted">{g.label}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {list.map((c) => {
                const planned = c.availability === "planned";
                return (
                  <button
                    key={c.slug}
                    type="button"
                    disabled={planned}
                    onClick={() => onPick(c.slug)}
                    aria-describedby={`cat-${c.slug}-desc`}
                    className={cn(
                      "flex items-start gap-3 rounded-card border border-line bg-white p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                      planned ? "cursor-not-allowed opacity-60" : "hover:border-brand hover:bg-mint-2/40",
                    )}
                  >
                    <CategoryIcon icon={c.icon} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-ink">{c.name}</span>
                        {c.availability !== "integrated" && <Pill tone={CATEGORY_AVAILABILITY[c.availability].tone}>{CATEGORY_AVAILABILITY[c.availability].label}</Pill>}
                      </span>
                      <span id={`cat-${c.slug}-desc`} className="mt-0.5 block text-sm text-muted">
                        {planned ? CATEGORY_AVAILABILITY.planned.promise : c.short_description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function RiskForm({
  category,
  type,
  policyId,
  policyLabel,
  initialRisk,
  defaultRegion,
  beneficiaries = [],
  initialBeneficiaryId,
  onBack,
  bundle,
}: {
  category: CategoryOption;
  type: RequestType;
  policyId?: string;
  policyLabel?: string;
  initialRisk?: Record<string, unknown>;
  defaultRegion?: string;
  beneficiaries?: BeneficiaryOption[];
  initialBeneficiaryId?: string;
  onBack?: () => void;
  bundle?: string;
}) {
  const fields = category.risk_schema;
  // "Motor quote in under 2 minutes": registration + use + value first; the rest is prefilled from a
  // registration lookup (DVLA / cache) and collapsed under "Check details" when the lookup succeeds.
  const { quick, rest } = quickQuoteFields(fields);
  const hasQuick = quick.length > 0;
  const key = draftKey(category.slug, type, policyId);
  const [state, formAction] = useActionState(submitRequest, initialActionState);
  const [values, setValues] = React.useState<Values>(() => {
    const v: Values = {};
    for (const f of fields) v[f.key] = toFormValue(f, initialRisk?.[f.key] ?? (f.type === "region" ? defaultRegion : undefined));
    return v;
  });
  const [note, setNote] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saved, setSaved] = React.useState<"idle" | "saved" | "restored" | "unavailable">("idle");
  const hydrated = React.useRef(false);
  const dirty = React.useRef(false);
  const copy = TYPE_COPY[type];
  const [detailsOpen, setDetailsOpen] = React.useState(true);
  const [lookup, setLookup] = React.useState<{ state: "idle" | "searching" | "found" | "none" | "error"; data?: VehicleData }>({ state: "idle" });
  // "Who is this cover for?" — myself, or a family member in Ghana (diaspora sponsor).
  const [coverFor, setCoverFor] = React.useState<"self" | "family">(initialBeneficiaryId ? "family" : "self");
  const [beneficiaryId, setBeneficiaryId] = React.useState(initialBeneficiaryId ?? "");
  const beneficiary = beneficiaries.find((b) => b.id === beneficiaryId);
  const showCoverFor = type === "new_cover" && !policyId;

  async function findVehicle() {
    const reg = normaliseRegistration(typeof values.registration_number === "string" ? values.registration_number : "");
    if (reg.length < 4) {
      setErrors((prev) => ({ ...prev, registration_number: "Enter the registration number, e.g. GR 1234-23" }));
      document.getElementById("f-registration_number")?.focus();
      return;
    }
    setLookup({ state: "searching" });
    try {
      const res = await fetch("/api/v1/lookups/vehicle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ registration: reg }) });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; data?: { found?: boolean; data?: VehicleData; registration?: string } } | null;
      if (!res.ok || !json?.ok) throw new Error("lookup failed");
      dirty.current = true;
      if (json.data?.found && json.data.data) {
        const data = json.data.data;
        setValues((prev) => prefillFromLookup({ ...prev, registration_number: json.data?.registration ?? reg }, data));
        setLookup({ state: "found", data });
        setDetailsOpen(false);
      } else {
        setValues((prev) => ({ ...prev, registration_number: json.data?.registration ?? reg }));
        setLookup({ state: "none" });
        setDetailsOpen(true);
      }
    } catch {
      setLookup({ state: "error" });
      setDetailsOpen(true);
    }
  }

  // Restore a saved draft (resumable forms for low-bandwidth / interrupted sessions).
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const draft = JSON.parse(raw) as { values?: Values; note?: string };
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring from localStorage (external store) after hydration
        if (draft.values) setValues((prev) => ({ ...prev, ...draft.values }));
        if (draft.note) setNote(draft.note);
        setSaved("restored");
      }
    } catch {
      setSaved("unavailable");
    }
    hydrated.current = true;
  }, [key]);

  // Autosave (debounced).
  React.useEffect(() => {
    if (!hydrated.current || !dirty.current) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify({ values, note, savedAt: Date.now() }));
        setSaved("saved");
      } catch {
        setSaved("unavailable");
      }
    }, 500);
    return () => clearTimeout(t);
  }, [values, note, key]);

  React.useEffect(() => {
    if (!state.error) return;
    try {
      localStorage.setItem(key, JSON.stringify({ values, note, savedAt: Date.now() }));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const set = (k: string, v: Value) => {
    dirty.current = true;
    setValues((prev) => ({ ...prev, [k]: v }));
    if (errors[k])
      setErrors((prev) => {
        const next = { ...prev };
        delete next[k];
        return next;
      });
  };

  function riskPayload() {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      const v = values[f.key];
      if (f.type === "boolean") out[f.key] = v === "true";
      else if (f.type === "multiselect") out[f.key] = v;
      else if (v !== "" && v !== undefined) out[f.key] = v;
    }
    return out;
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    for (const f of fields) if (f.type === "boolean" && f.required && values[f.key] === "") errs[f.key] = "Choose yes or no";
    const res = riskSchemaToZod(fields).safeParse(riskPayload());
    if (!res.success) for (const i of res.error.issues) errs[String(i.path[0])] ??= i.message;
    if (type === "endorsement" && note.trim().length < 5) errs.__note = "Tell your broker what you'd like to change";
    if (showCoverFor && coverFor === "family") {
      if (!beneficiaryId) errs.__beneficiary = "Choose the family member this cover is for";
      else if (beneficiary && beneficiary.consent_status !== "granted") errs.__beneficiary = `${beneficiary.full_name} hasn't given consent yet`;
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = fields.find((f) => errs[f.key])?.key ?? (errs.__note ? "note" : errs.__beneficiary ? "beneficiary" : undefined);
      setDetailsOpen(true); // collapsed "Check details" fields must be visible to fix
      if (first) setTimeout(() => document.getElementById(`f-${first}`)?.focus(), 0);
      return false;
    }
    return true;
  }

  const availability = CATEGORY_AVAILABILITY[category.availability];

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!validate()) {
          e.preventDefault();
          return;
        }
        // Submitted: forget the draft. If the server rejects it we save it again below.
        try {
          localStorage.removeItem(key);
        } catch {}
      }}
      noValidate
      className="space-y-6"
    >
      <input type="hidden" name="category" value={category.slug} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="policy" value={policyId ?? ""} />
      <input type="hidden" name="risk" value={JSON.stringify(riskPayload())} />
      <input type="hidden" name="beneficiary" value={showCoverFor && coverFor === "family" ? beneficiaryId : ""} />
      <input type="hidden" name="bundle" value={bundle ?? ""} />

      <div className="flex flex-wrap items-center gap-3">
        {onBack && (
          <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
            <ArrowLeft aria-hidden className="size-4" /> Change cover type
          </button>
        )}
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-subtle" aria-live="polite">
          {saved === "unavailable" ? (
            <><CloudOff aria-hidden className="size-3.5" /> Drafts can&apos;t be saved on this device</>
          ) : saved === "restored" ? (
            <><Save aria-hidden className="size-3.5" /> We restored your saved answers</>
          ) : saved === "saved" ? (
            <><Check aria-hidden className="size-3.5" /> Draft saved on this device</>
          ) : null}
        </span>
      </div>

      <div className="flex items-start gap-3">
        <CategoryIcon icon={category.icon} />
        <div>
          <h2 className="text-xl font-semibold text-ink">{category.name} · {copy.title}</h2>
          {policyLabel && <p className="text-sm text-muted">For {policyLabel}</p>}
        </div>
      </div>

      {copy.body && <Notice tone={type === "switch" ? "wait" : "info"}>{copy.body}</Notice>}
      {type === "new_cover" && (
        <Notice tone={category.availability === "integrated" ? "ok" : "info"} title={category.availability === "integrated" ? "Compare and buy" : "Broker assisted"}>
          {availability.promise}
        </Notice>
      )}
      {category.regulatory_note && <Notice tone="wait">{category.regulatory_note}</Notice>}

      {showCoverFor && (
        <fieldset className="rounded-card border border-line p-4 sm:p-5" aria-describedby="cover-for-hint">
          <legend className="px-1 font-semibold text-ink">Who is this cover for?</legend>
          <p id="cover-for-hint" className="mb-3 text-sm text-muted">Living abroad? You can arrange and pay for cover for family in Ghana. They are named on the policy; you are the payer.</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Who is this cover for?">
            {(
              [
                { v: "self", l: "Myself" },
                { v: "family", l: "A family member in Ghana" },
              ] as const
            ).map((o) => (
              <label
                key={o.v}
                className={cn(
                  "inline-flex cursor-pointer items-center rounded-xl border px-4 py-2.5 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand",
                  coverFor === o.v ? "border-brand bg-mint-2 text-brand-deep" : "border-line text-ink-2 hover:bg-mist",
                )}
              >
                <input type="radio" name="ui-cover-for" value={o.v} checked={coverFor === o.v} onChange={() => { setCoverFor(o.v); setErrors((prev) => { const n = { ...prev }; delete n.__beneficiary; return n; }); }} className="sr-only" />
                {o.l}
              </label>
            ))}
          </div>
          {coverFor === "family" && (
            <div className="mt-4">
              {beneficiaries.length ? (
                <Field label="Family member" htmlFor="f-beneficiary" error={errors.__beneficiary} hint="Only family members who have given consent can be covered.">
                  <Select id="f-beneficiary" value={beneficiaryId} onChange={(e) => { setBeneficiaryId(e.target.value); setErrors((prev) => { const n = { ...prev }; delete n.__beneficiary; return n; }); }} aria-invalid={!!errors.__beneficiary}>
                    <option value="">Choose…</option>
                    {beneficiaries.map((b) => (
                      <option key={b.id} value={b.id} disabled={b.consent_status !== "granted"}>
                        {b.full_name} · {b.relationship.replace(/^\w/, (c) => c.toUpperCase())}{b.consent_status !== "granted" ? " (awaiting consent)" : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <p className="text-sm text-muted" id="f-beneficiary">
                  You haven&apos;t added any family members yet.{" "}
                  <a href={`/account/family/beneficiaries/new?next=${encodeURIComponent(`/account/requests/new?category=${category.slug}`)}`} className="font-medium text-brand hover:underline">Add a family member</a> — they confirm by SMS code, then you can request cover for them.
                </p>
              )}
              {errors.__beneficiary && !beneficiaries.length && <p className="mt-1.5 text-xs text-danger">{errors.__beneficiary}</p>}
            </div>
          )}
        </fieldset>
      )}

      {hasQuick ? (
        <>
          <section aria-labelledby="quick-start" className="rounded-card border border-brand/30 bg-mint-2/30 p-4 sm:p-5">
            <h3 id="quick-start" className="font-semibold text-ink">Start with three details</h3>
            <p className="mt-0.5 text-sm text-muted">Registration, use and value. We look up the make, model and year for you — a motor quote in under two minutes.</p>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              {quick.map((f) => (
                <RiskInput key={f.key} field={f} value={values[f.key] ?? ""} error={errors[f.key] ?? state.fieldErrors?.[f.key]} onChange={(v) => set(f.key, v)} />
              ))}
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <Button type="button" variant="secondary" size="sm" loading={lookup.state === "searching"} onClick={findVehicle}>
                  <Search aria-hidden className="size-4" /> Find my vehicle
                </Button>
                <p aria-live="polite" className="text-sm text-muted">
                  {lookup.state === "found"
                    ? `Found: ${[lookup.data?.make, lookup.data?.model, lookup.data?.year].filter(Boolean).join(" ")}. Check the details below.`
                    : lookup.state === "none"
                      ? "We couldn't find that registration — no problem, fill in the details below."
                      : lookup.state === "error"
                        ? "Lookup isn't available right now. Fill in the details below."
                        : "Optional. Skip it and fill in the details yourself."}
                </p>
              </div>
            </div>
          </section>

          <section aria-labelledby="check-details">
            <button
              type="button"
              id="check-details"
              onClick={() => setDetailsOpen((v) => !v)}
              aria-expanded={detailsOpen}
              aria-controls="check-details-panel"
              className="flex w-full items-center justify-between rounded-xl border border-line px-4 py-3 text-left font-semibold text-ink hover:bg-mist"
            >
              <span>
                Check details
                {!detailsOpen && lookup.state === "found" && (
                  <span className="ml-2 font-normal text-muted">{[values.vehicle_make, values.vehicle_model, values.vehicle_year].filter(Boolean).join(" ")} · prefilled from the registration</span>
                )}
              </span>
              <ChevronDown aria-hidden className={cn("size-4 transition-transform", detailsOpen && "rotate-180")} />
            </button>
            <div id="check-details-panel" hidden={!detailsOpen} className="mt-4 grid gap-5 sm:grid-cols-2">
              {rest.map((f) => (
                <RiskInput key={f.key} field={f} value={values[f.key] ?? ""} error={errors[f.key] ?? state.fieldErrors?.[f.key]} onChange={(v) => set(f.key, v)} />
              ))}
            </div>
          </section>
        </>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          {fields.map((f) => (
            <RiskInput key={f.key} field={f} value={values[f.key] ?? ""} error={errors[f.key] ?? state.fieldErrors?.[f.key]} onChange={(v) => set(f.key, v)} />
          ))}
        </div>
      )}

      {type !== "endorsement" && (
        <Checkbox
          name="talk_to_expert"
          label={
            <span>
              <span className="font-medium text-ink">Talk to an expert first</span>
              <span className="block text-sm text-muted">A licensed broker calls you before any quote is prepared — useful if you&apos;re not sure what cover you need. It doesn&apos;t cost you anything.</span>
            </span>
          }
        />
      )}

      {(copy.noteLabel || type === "new_cover") && (
        <Field
          label={copy.noteLabel ?? <>Anything else your broker should know? <span className="font-normal text-subtle">(optional)</span></>}
          htmlFor="f-note"
          error={errors.__note}
        >
          <Textarea id="f-note" name="note" value={note} onChange={(e) => {
              dirty.current = true;
              setNote(e.target.value);
            }} maxLength={4000} aria-invalid={!!errors.__note} />
        </Field>
      )}

      <FormMessage state={state} />
      <div className="flex flex-col-reverse gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-subtle">
          Your request goes to a named, licensed broker of record. You&apos;ll see who before you apply. No cover starts until an insurer accepts it.
        </p>
        <SubmitButton size="lg" pendingText="Sending…" className="shrink-0">
          {type === "renewal" ? "Request renewal options" : type === "switch" ? "Start switch review" : type === "endorsement" ? "Send change request" : "Send request"}
        </SubmitButton>
      </div>
    </form>
  );
}

function RiskInput({ field: f, value, error, onChange }: { field: RiskField; value: Value; error?: string; onChange: (v: Value) => void }) {
  const id = `f-${f.key}`;
  const label = (
    <>
      {f.label}
      {!f.required && f.type !== "boolean" && <span className="font-normal text-subtle"> (optional)</span>}
    </>
  );
  const common = { id, "aria-invalid": !!error, "aria-describedby": error ? `${id}-err` : undefined };
  const wide = f.type === "multiselect" || f.type === "boolean";

  if (f.type === "boolean") {
    return (
      <fieldset className={cn(wide && "sm:col-span-2")}>
        <legend className="mb-1.5 text-sm font-medium text-ink-2">{f.label}</legend>
        <div className="flex gap-2" role="radiogroup">
          {[
            { v: "true", l: "Yes" },
            { v: "false", l: "No" },
          ].map((o, i) => (
            <label
              key={o.v}
              className={cn(
                "inline-flex cursor-pointer items-center rounded-xl border px-5 py-2.5 text-sm font-medium has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand",
                value === o.v ? "border-brand bg-mint-2 text-brand-deep" : "border-line text-ink-2 hover:bg-mist",
              )}
            >
              <input
                type="radio"
                id={i === 0 ? id : undefined}
                name={`ui-${f.key}`}
                value={o.v}
                checked={value === o.v}
                onChange={() => onChange(o.v)}
                className="sr-only"
              />
              {o.l}
            </label>
          ))}
        </div>
        {f.help && <p className="mt-1.5 text-xs text-subtle">{f.help}</p>}
        {error && <p id={`${id}-err`} className="mt-1.5 text-xs text-danger">{error}</p>}
      </fieldset>
    );
  }

  if (f.type === "multiselect") {
    const arr = Array.isArray(value) ? value : [];
    return (
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-sm font-medium text-ink-2">{label}</legend>
        <div className="flex flex-wrap gap-2">
          {(f.options ?? []).map((o, i) => {
            const on = arr.includes(o.value);
            return (
              <label
                key={o.value}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3.5 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand",
                  on ? "border-brand bg-mint-2 text-brand-deep" : "border-line text-ink-2 hover:bg-mist",
                )}
              >
                <input
                  type="checkbox"
                  id={i === 0 ? id : undefined}
                  checked={on}
                  onChange={() => onChange(on ? arr.filter((x) => x !== o.value) : [...arr, o.value])}
                  className="size-4 accent-brand"
                />
                {o.label}
              </label>
            );
          })}
        </div>
        {error && <p id={`${id}-err`} className="mt-1.5 text-xs text-danger">{error}</p>}
      </fieldset>
    );
  }

  const v = typeof value === "string" ? value : "";
  let control: React.ReactNode;
  switch (f.type) {
    case "select":
      control = (
        <Select {...common} value={v} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      );
      break;
    case "region":
      control = (
        <Select {...common} value={v} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose a region…</option>
          {GHANA_REGIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </Select>
      );
      break;
    case "currency":
      control = (
        <div className="flex">
          <span className="inline-flex items-center rounded-l-field border border-r-0 border-line bg-mist px-3 text-sm text-muted">GH₵</span>
          <Input {...common} className="rounded-l-none" type="number" inputMode="decimal" min={f.min} max={f.max} step="any" value={v} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
      break;
    case "number":
      control = <Input {...common} type="number" inputMode="numeric" min={f.min} max={f.max} value={v} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "date":
      control = <Input {...common} type="date" value={v} onChange={(e) => onChange(e.target.value)} />;
      break;
    default:
      control = <Input {...common} type="text" value={v} placeholder={f.placeholder} maxLength={500} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <Field label={label} htmlFor={id} hint={f.help} error={error ? <span id={`${id}-err`}>{error}</span> : undefined}>
      {control}
    </Field>
  );
}
