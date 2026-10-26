import { Field, Input, Select } from "@im/ui";
import { GHANA_REGIONS, type RiskField } from "@im/core";

/** Renders a category's risk_schema as form inputs named `risk.<key>`. */
export function RiskFields({ fields, values = {}, requiredOff = false, idPrefix = "risk", onChange }: { fields: RiskField[]; values?: Record<string, unknown>; requiredOff?: boolean; idPrefix?: string; onChange?: (key: string, value: string) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((f) => {
        const id = `${idPrefix}-${f.key}`;
        const name = `risk.${f.key}`;
        const v = values[f.key];
        const def = v === undefined || v === null ? "" : String(v);
        const req = !requiredOff && !!f.required;
        const change = onChange ? (e: { currentTarget: { value: string } }) => onChange(f.key, e.currentTarget.value) : undefined;
        if (f.type === "select" || f.type === "region" || f.type === "boolean") {
          const opts = f.type === "region"
            ? GHANA_REGIONS.map((r) => ({ value: r, label: r }))
            : f.type === "boolean"
              ? [{ value: "true", label: "Yes" }, { value: "false", label: "No" }]
              : (f.options ?? []);
          return (
            <Field key={f.key} label={f.label} htmlFor={id} hint={f.help}>
              <Select id={id} name={name} defaultValue={def} required={req} onChange={change} className="h-10 text-sm">
                <option value="">Choose…</option>
                {opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </Field>
          );
        }
        return (
          <Field key={f.key} label={f.label} htmlFor={id} hint={f.help}>
            <Input
              id={id}
              name={name}
              type={f.type === "number" || f.type === "currency" ? "number" : f.type === "date" ? "date" : "text"}
              min={f.min}
              max={f.max}
              placeholder={f.placeholder}
              defaultValue={def}
              required={req}
              onChange={change}
              className="h-10 text-sm"
            />
          </Field>
        );
      })}
    </div>
  );
}

/** Pulls `risk.*` fields out of FormData, coercing numbers and booleans by schema type. */
export function riskFromForm(formData: FormData, fields: RiskField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = formData.get(`risk.${f.key}`);
    if (raw === null || raw === "") continue;
    const s = String(raw);
    if (f.type === "number" || f.type === "currency") {
      const n = Number(s);
      if (!Number.isNaN(n)) out[f.key] = n;
    } else if (f.type === "boolean") out[f.key] = s === "true";
    else out[f.key] = s;
  }
  return out;
}

/** Display value for a risk answer using the schema's option labels. */
export function riskDisplay(f: RiskField, v: unknown): string {
  if (v === undefined || v === null || v === "") return "—";
  if (f.type === "boolean") return v === true || v === "true" ? "Yes" : "No";
  if (f.type === "select") return f.options?.find((o) => o.value === String(v))?.label ?? String(v);
  if (f.type === "currency") return `GH₵ ${Number(v).toLocaleString("en-GH")}`;
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}
