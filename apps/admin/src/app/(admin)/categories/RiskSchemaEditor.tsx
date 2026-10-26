"use client";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { GHANA_REGIONS, type RiskField } from "@im/core";
import { Button, Checkbox, Input, Label, Select, Textarea, cn } from "@im/ui";

const TYPES: RiskField["type"][] = ["text", "number", "currency", "select", "multiselect", "boolean", "date", "region"];
const small = "h-9 text-sm";

function optionsToText(o?: { value: string; label: string }[]) {
  return (o ?? []).map((x) => (x.value === x.label ? x.value : `${x.value} | ${x.label}`)).join("\n");
}
function textToOptions(t: string) {
  return t
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [v, ...rest] = l.split("|");
      const value = v!.trim();
      return { value, label: rest.join("|").trim() || value };
    });
}
function clean(f: RiskField): RiskField {
  // Always emit `required` explicitly so saving an unchanged schema is a no-op.
  const out: RiskField = { key: f.key, label: f.label, type: f.type, required: !!f.required };
  if (f.min !== undefined && !Number.isNaN(f.min)) out.min = f.min;
  if (f.max !== undefined && !Number.isNaN(f.max)) out.max = f.max;
  if (f.placeholder) out.placeholder = f.placeholder;
  if (f.help) out.help = f.help;
  if ((f.type === "select" || f.type === "multiselect") && f.options?.length) out.options = f.options;
  return out;
}

/**
 * Visual editor for product_categories.risk_schema: list of fields with
 * type/options/required, live preview of the customer form, and a JSON view.
 * Emits the JSON in a hidden `risk_schema` input; the server validates it.
 */
type EditableField = RiskField & { _id: string };
let seq = 0;
const withId = (f: RiskField): EditableField => ({ ...f, _id: `f${++seq}` });

export function RiskSchemaEditor({ initial, disabled }: { initial: RiskField[]; disabled?: boolean }) {
  const [fields, setFields] = useState<EditableField[]>(() => initial.map(withId));
  const [view, setView] = useState<"fields" | "preview" | "json">("fields");
  const [jsonDraft, setJsonDraft] = useState<string | null>(null);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const json = useMemo(() => JSON.stringify(fields.map(clean), null, 2), [fields]);

  const update = (i: number, patch: Partial<RiskField>) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) =>
    setFields((fs) => {
      const j = i + d;
      if (j < 0 || j >= fs.length) return fs;
      const copy = [...fs];
      [copy[i], copy[j]] = [copy[j]!, copy[i]!];
      return copy;
    });
  const keys = fields.map((f) => f.key);
  const dupes = new Set(keys.filter((k, i) => keys.indexOf(k) !== i));

  return (
    <div className="rounded-xl border border-line">
      <input type="hidden" name="risk_schema" value={json} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-mist/50 px-3 py-2">
        <div className="flex gap-1">
          {(["fields", "preview", "json"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn("rounded-lg px-3 py-1 text-sm font-medium", view === v ? "bg-white text-brand-deep shadow-card" : "text-muted hover:text-ink")}
            >
              {v === "fields" ? `Fields (${fields.length})` : v === "preview" ? "Live preview" : "JSON"}
            </button>
          ))}
        </div>
        {view === "fields" && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => setFields((fs) => [...fs, withId({ key: `field_${fs.length + 1}`, label: "New field", type: "text", required: false })])}
          >
            <Plus className="size-4" /> Add field
          </Button>
        )}
      </div>

      {view === "fields" && (
        <ol className="divide-y divide-line">
          {fields.map((f, i) => (
            <li key={f._id} className="grid gap-3 p-3 md:grid-cols-12">
              <div className="md:col-span-3">
                <Label htmlFor={`rk-${i}`} className="text-xs">Key</Label>
                <Input id={`rk-${i}`} value={f.key} disabled={disabled} onChange={(e) => update(i, { key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} className={cn(small, "font-mono", dupes.has(f.key) && "border-danger")} />
                {dupes.has(f.key) && <p className="mt-1 text-xs text-danger">Duplicate key</p>}
              </div>
              <div className="md:col-span-4">
                <Label htmlFor={`rl-${i}`} className="text-xs">Label</Label>
                <Input id={`rl-${i}`} value={f.label} disabled={disabled} onChange={(e) => update(i, { label: e.target.value })} className={small} />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor={`rt-${i}`} className="text-xs">Type</Label>
                <Select id={`rt-${i}`} value={f.type} disabled={disabled} onChange={(e) => update(i, { type: e.target.value as RiskField["type"] })} className={small}>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </Select>
              </div>
              <div className="flex items-end gap-1 md:col-span-3">
                <Checkbox label="Required" checked={!!f.required} disabled={disabled} onChange={(e) => update(i, { required: e.target.checked })} className="mb-2 mr-auto" />
                <Button type="button" size="sm" variant="ghost" aria-label="Move up" disabled={disabled || i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
                <Button type="button" size="sm" variant="ghost" aria-label="Move down" disabled={disabled || i === fields.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
                <Button type="button" size="sm" variant="ghost" aria-label="Remove field" disabled={disabled} onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))}><Trash2 className="size-4 text-danger" /></Button>
              </div>
              {(f.type === "number" || f.type === "currency") && (
                <>
                  <div className="md:col-span-2">
                    <Label htmlFor={`rmin-${i}`} className="text-xs">Min</Label>
                    <Input id={`rmin-${i}`} type="number" value={f.min ?? ""} disabled={disabled} onChange={(e) => update(i, { min: e.target.value === "" ? undefined : Number(e.target.value) })} className={small} />
                  </div>
                  <div className="md:col-span-2">
                    <Label htmlFor={`rmax-${i}`} className="text-xs">Max</Label>
                    <Input id={`rmax-${i}`} type="number" value={f.max ?? ""} disabled={disabled} onChange={(e) => update(i, { max: e.target.value === "" ? undefined : Number(e.target.value) })} className={small} />
                  </div>
                </>
              )}
              {(f.type === "select" || f.type === "multiselect") && (
                <div className="md:col-span-6">
                  <Label htmlFor={`ro-${i}`} className="text-xs">Options — one per line, <code>value | Label</code></Label>
                  <Textarea id={`ro-${i}`} defaultValue={optionsToText(f.options)} disabled={disabled} onBlur={(e) => update(i, { options: textToOptions(e.target.value) })} className="min-h-20 font-mono text-xs" />
                </div>
              )}
              <div className="md:col-span-3">
                <Label htmlFor={`rp-${i}`} className="text-xs">Placeholder</Label>
                <Input id={`rp-${i}`} value={f.placeholder ?? ""} disabled={disabled} onChange={(e) => update(i, { placeholder: e.target.value || undefined })} className={small} />
              </div>
              <div className="md:col-span-3">
                <Label htmlFor={`rh-${i}`} className="text-xs">Help text</Label>
                <Input id={`rh-${i}`} value={f.help ?? ""} disabled={disabled} onChange={(e) => update(i, { help: e.target.value || undefined })} className={small} />
              </div>
            </li>
          ))}
          {!fields.length && <li className="p-6 text-center text-sm text-muted">No fields. Customers will only be asked for contact details.</li>}
        </ol>
      )}

      {view === "preview" && (
        <div className="grid gap-4 p-4 sm:grid-cols-2" aria-label="Form preview">
          {fields.map((f, i) => (
            <div key={i} className={f.type === "multiselect" ? "sm:col-span-2" : undefined}>
              <p className="mb-1.5 text-sm font-medium text-ink-2">{f.label}{f.required && <span className="text-danger"> *</span>}</p>
              {f.type === "select" ? (
                <Select disabled><option>{f.placeholder ?? "Choose…"}</option>{f.options?.map((o) => <option key={o.value}>{o.label}</option>)}</Select>
              ) : f.type === "region" ? (
                <Select disabled><option>Choose a region</option>{GHANA_REGIONS.map((r) => <option key={r}>{r}</option>)}</Select>
              ) : f.type === "multiselect" ? (
                <div className="flex flex-wrap gap-2">{f.options?.map((o) => <span key={o.value} className="rounded-full border border-line px-3 py-1 text-sm text-ink-2">{o.label}</span>)}</div>
              ) : f.type === "boolean" ? (
                <div className="flex gap-2"><span className="rounded-lg border border-line px-4 py-2 text-sm">Yes</span><span className="rounded-lg border border-line px-4 py-2 text-sm">No</span></div>
              ) : (
                <Input disabled type={f.type === "date" ? "date" : f.type === "text" ? "text" : "number"} placeholder={f.type === "currency" ? `GH₵ ${f.placeholder ?? ""}` : f.placeholder} />
              )}
              {(f.help || f.min !== undefined || f.max !== undefined) && (
                <p className="mt-1 text-xs text-subtle">{f.help}{f.min !== undefined || f.max !== undefined ? ` Range ${f.min ?? "–"} to ${f.max ?? "–"}.` : ""}</p>
              )}
            </div>
          ))}
          {!fields.length && <p className="text-sm text-muted">Nothing to preview.</p>}
        </div>
      )}

      {view === "json" && (
        <div className="space-y-2 p-3">
          <Textarea
            aria-label="Risk schema JSON"
            value={jsonDraft ?? json}
            disabled={disabled}
            onChange={(e) => setJsonDraft(e.target.value)}
            className="min-h-80 font-mono text-xs"
          />
          {jsonError && <p className="text-xs text-danger">{jsonError}</p>}
          {jsonDraft !== null && (
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  try {
                    const parsed = JSON.parse(jsonDraft) as RiskField[];
                    if (!Array.isArray(parsed)) throw new Error("The schema must be a JSON array of fields");
                    setFields(parsed.map(withId));
                    setJsonDraft(null);
                    setJsonError(null);
                  } catch (e) {
                    setJsonError(e instanceof Error ? e.message : "Invalid JSON");
                  }
                }}
              >
                Apply JSON
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setJsonDraft(null); setJsonError(null); }}>Discard</Button>
            </div>
          )}
          <p className="text-xs text-subtle">Shared with the web and mobile apps (<code>RiskField</code> in @im/core). Validated on save.</p>
        </div>
      )}
    </div>
  );
}

