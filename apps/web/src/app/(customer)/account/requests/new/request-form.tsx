"use client";
import * as React from "react";
import { useActionState } from "react";
import { ArrowLeft, Check, CloudOff, Save } from "lucide-react";
import { CATEGORY_AVAILABILITY, GHANA_REGIONS, riskSchemaToZod, type RiskField } from "@im/core";
import { Field, Input, Notice, Pill, Select, Textarea, cn } from "@im/ui";
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

export function RequestForm({
  categories,
  initialSlug,
  type,
  policyId,
  policyLabel,
  initialRisk,
  defaultRegion,
}: {
  categories: CategoryOption[];
  initialSlug?: string;
  type: RequestType;
  policyId?: string;
  policyLabel?: string;
  initialRisk?: Record<string, unknown>;
  defaultRegion?: string;
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
  onBack,
}: {
  category: CategoryOption;
  type: RequestType;
  policyId?: string;
  policyLabel?: string;
  initialRisk?: Record<string, unknown>;
  defaultRegion?: string;
  onBack?: () => void;
}) {
  const fields = category.risk_schema;
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

  // Restore a saved draft (resumable forms for low-bandwidth / interrupted sessions).
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const draft = JSON.parse(raw) as { values?: Values; note?: string };
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
    if (errors[k]) setErrors(({ [k]: _, ...rest }) => rest);
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
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = fields.find((f) => errs[f.key])?.key ?? (errs.__note ? "note" : undefined);
      if (first) document.getElementById(`f-${first}`)?.focus();
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

      <div className="grid gap-5 sm:grid-cols-2">
        {fields.map((f) => (
          <RiskInput key={f.key} field={f} value={values[f.key] ?? ""} error={errors[f.key] ?? state.fieldErrors?.[f.key]} onChange={(v) => set(f.key, v)} />
        ))}
      </div>

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
