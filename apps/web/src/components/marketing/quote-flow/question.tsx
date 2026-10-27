"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { GHANA_REGIONS, type RiskField } from "@im/core";
import { Field, Input, Select, cn } from "@im/ui";
import type { Value, Values } from "./model";

const YES_NO = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

/**
 * One question screen (mockup 03): big tappable cards for choices, large inputs for the rest.
 * Choice cards are real radio/checkbox inputs, so they work with a keyboard and a screen reader.
 */
export function QuestionScreen({
  fields,
  values,
  errors,
  onChange,
  autoFocus,
}: {
  fields: RiskField[];
  values: Values;
  errors: Record<string, string>;
  onChange: (key: string, v: Value) => void;
  autoFocus?: boolean;
}) {
  return (
    <div className="grid gap-6">
      {fields.map((f, i) => (
        <FieldControl key={f.key} field={f} value={values[f.key] ?? ""} error={errors[f.key]} onChange={(v) => onChange(f.key, v)} autoFocus={autoFocus && i === 0} multi={fields.length > 1} />
      ))}
    </div>
  );
}

function FieldControl({ field: f, value, error, onChange, autoFocus, multi }: { field: RiskField; value: Value; error?: string; onChange: (v: Value) => void; autoFocus?: boolean; multi: boolean }) {
  const id = `q-${f.key}`;
  const errId = `${id}-err`;
  const optional = !f.required && f.type !== "boolean";

  if (f.type === "boolean" || (f.type === "select" && (f.options?.length ?? 0) <= 6)) {
    const options = f.type === "boolean" ? YES_NO : (f.options ?? []);
    const name = `q-${f.key}`;
    return (
      <fieldset aria-describedby={error ? errId : undefined}>
        <legend className={cn("mb-3 text-ink", multi ? "text-[17px] font-semibold" : "sr-only")}>{f.label}</legend>
        <div className={cn("grid gap-3", options.length <= 2 ? "grid-cols-2" : "sm:grid-cols-2")} role="radiogroup" aria-label={f.label}>
          {options.map((o) => {
            const on = value === o.value;
            return (
              <label
                key={o.value}
                className={cn(
                  "flex min-h-16 cursor-pointer items-center justify-between gap-3 rounded-card border bg-white px-5 py-4 text-left text-[16px] font-medium transition-colors",
                  on ? "border-brand bg-mint/50 text-brand-deep" : "border-line text-ink hover:border-brand/40 hover:bg-mist",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand has-[:focus-visible]:ring-offset-2",
                )}
              >
                <input type="radio" name={name} value={o.value} checked={on} onChange={() => onChange(o.value)} className="sr-only" />
                <span>{o.label}</span>
                <span aria-hidden className={cn("grid size-6 shrink-0 place-items-center rounded-full border", on ? "border-brand bg-brand text-white" : "border-line bg-white")}>
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
              </label>
            );
          })}
        </div>
        {f.help && <p className="mt-3 text-sm text-muted">{f.help}</p>}
        {error && <p id={errId} role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      </fieldset>
    );
  }

  if (f.type === "multiselect") {
    const arr = Array.isArray(value) ? value : [];
    return (
      <fieldset aria-describedby={error ? errId : undefined}>
        <legend className={cn("mb-3 text-ink", multi ? "text-[17px] font-semibold" : "sr-only")}>{f.label}</legend>
        <p className="mb-3 text-sm text-muted">Choose all that apply.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(f.options ?? []).map((o) => {
            const on = arr.includes(o.value);
            return (
              <label
                key={o.value}
                className={cn(
                  "flex min-h-16 cursor-pointer items-center justify-between gap-3 rounded-card border bg-white px-5 py-4 text-[16px] font-medium transition-colors",
                  on ? "border-brand bg-mint/50 text-brand-deep" : "border-line text-ink hover:border-brand/40 hover:bg-mist",
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand has-[:focus-visible]:ring-offset-2",
                )}
              >
                <input type="checkbox" checked={on} onChange={() => onChange(on ? arr.filter((x) => x !== o.value) : [...arr, o.value])} className="sr-only" />
                <span>{o.label}</span>
                <span aria-hidden className={cn("grid size-6 shrink-0 place-items-center rounded-md border", on ? "border-brand bg-brand text-white" : "border-line bg-white")}>
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
              </label>
            );
          })}
        </div>
        {error && <p id={errId} role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      </fieldset>
    );
  }

  const v = typeof value === "string" ? value : "";
  const common = { id, "aria-invalid": !!error, "aria-describedby": error ? errId : undefined, autoFocus };
  // On a single-input screen the heading already asks the question: keep the label for assistive tech only.
  const label = (
    <span className={multi ? "text-[16px]" : "sr-only"}>
      {f.label}
      {optional && <span className="font-normal text-subtle"> (optional)</span>}
    </span>
  );
  let control: React.ReactNode;
  switch (f.type) {
    case "select":
      control = (
        <Select {...common} value={v} onChange={(e) => onChange(e.target.value)} className="h-14 text-[16px]">
          <option value="">Choose…</option>
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </Select>
      );
      break;
    case "region":
      control = (
        <Select {...common} value={v} onChange={(e) => onChange(e.target.value)} className="h-14 text-[16px]">
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
          <span className="inline-flex items-center rounded-l-field border border-r-0 border-line bg-mist px-4 text-[15px] text-muted">GH₵</span>
          <Input {...common} className="h-14 rounded-l-none text-[16px]" type="number" inputMode="decimal" min={f.min} max={f.max} step="any" value={v} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
      break;
    case "number":
      control = <Input {...common} className="h-14 text-[16px]" type="number" inputMode="numeric" min={f.min} max={f.max} value={v} placeholder={f.placeholder} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "date":
      control = <Input {...common} className="h-14 text-[16px]" type="date" value={v} onChange={(e) => onChange(e.target.value)} />;
      break;
    default:
      control = <Input {...common} className="h-14 text-[16px]" type="text" value={v} placeholder={f.placeholder} maxLength={500} onChange={(e) => onChange(e.target.value)} autoComplete="off" />;
  }
  return (
    <Field label={label} htmlFor={id} hint={f.help} error={error ? <span id={errId} role="alert">{error}</span> : undefined}>
      {control}
    </Field>
  );
}
