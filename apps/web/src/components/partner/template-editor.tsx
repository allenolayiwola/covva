"use client";
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Field, Input, Notice, Select, Textarea } from "@im/ui";
import { TEMPLATE_KINDS, defaultTemplate, renderTemplate, validateTemplate, type StructuredTemplate, type TemplateField, type TemplateKind } from "@im/core";
import { ActionForm, type FormAction } from "./action-form";

export const SAMPLE_CONTEXT = {
  kind: "schedule",
  policy: { policy_number: "CG-2027-000123", cover_start: "2027-01-01", cover_end: "2027-12-31", premium: 1850 },
  customer: { full_name: "Ama Mensah", phone: "+233 24 000 0000", ghana_card: "GHA-000000000-0" },
  insurer: { name: "Your insurer", nic_licence_number: "NIC/XX/000" },
  broker: { name: "Broker of record" },
  product: { name: "Product name" },
  risk: { vehicle_registration: "GR 1234-26", vehicle_make: "Toyota", vehicle_model: "Corolla", sum_insured: 120000 },
};

const FORMATS: TemplateField["format"][] = ["text", "money", "date"];

/**
 * Document template editor: kind + name, a fields table (key, label, data path, format),
 * the layout blocks as JSON (headings, paragraphs, field groups, tables, signature) and
 * a live preview rendered by the same @im/core function the issuance pipeline uses.
 */
export function TemplateEditor({ action, versionId, template, kind: initialKind, name: initialName, templateId }: { action: FormAction; versionId: string; template?: StructuredTemplate | { html: string }; kind?: TemplateKind; name?: string; templateId?: string }) {
  const [kind, setKind] = useState<TemplateKind>(initialKind ?? "schedule");
  const start = (template && "blocks" in template ? template : defaultTemplate(kind)) as StructuredTemplate;
  const [title, setTitle] = useState(start.title ?? "");
  const [footer, setFooter] = useState(start.footer ?? "");
  const [fields, setFields] = useState<TemplateField[]>(start.fields ?? []);
  const [blocks, setBlocks] = useState(JSON.stringify(start.blocks ?? [], null, 2));

  const built = useMemo(() => {
    try {
      const parsed = JSON.parse(blocks) as StructuredTemplate["blocks"];
      return { template: { title, footer, fields, blocks: parsed } as StructuredTemplate, error: null as string | null };
    } catch (e) {
      return { template: null, error: `Blocks JSON is invalid: ${(e as Error).message}` };
    }
  }, [blocks, title, footer, fields]);
  const check = built.template ? validateTemplate(built.template) : null;
  const html = built.template && check?.ok ? renderTemplate(built.template, { ...SAMPLE_CONTEXT, kind }) : "";
  const json = built.template ? JSON.stringify(built.template) : "";
  const setField = (i: number, patch: Partial<TemplateField>) => setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ActionForm action={action} submitLabel={templateId ? "Save template" : "Create template"} className="space-y-4">
        <input type="hidden" name="versionId" value={versionId} />
        {templateId && <input type="hidden" name="templateId" value={templateId} />}
        <input type="hidden" name="template" value={json} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Document kind" htmlFor="tk">
            <Select
              id="tk"
              name="kind"
              value={kind}
              onChange={(e) => {
                const k = e.currentTarget.value as TemplateKind;
                setKind(k);
                if (!template) {
                  const d = defaultTemplate(k);
                  setTitle(d.title ?? "");
                  setFooter(d.footer ?? "");
                  setFields(d.fields);
                  setBlocks(JSON.stringify(d.blocks, null, 2));
                }
              }}
              className="h-10 text-sm"
            >
              {TEMPLATE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </Select>
          </Field>
          <Field label="Template name" htmlFor="tn"><Input id="tn" name="name" defaultValue={initialName ?? ""} required placeholder="Motor schedule (A4)" className="h-10 text-sm" /></Field>
          <Field label="Title" htmlFor="tt" hint="Supports {{placeholders}}"><Input id="tt" value={title} onChange={(e) => setTitle(e.currentTarget.value)} className="h-10 text-sm" /></Field>
          <Field label="Footer" htmlFor="tf"><Input id="tf" value={footer} onChange={(e) => setFooter(e.currentTarget.value)} className="h-10 text-sm" /></Field>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-ink">Fields</legend>
          <p className="text-xs text-muted">Each field reads a value from the issued policy (policy.*, customer.*, insurer.*, broker.*, product.*, risk.*). Reference a field by key in a “fields” block.</p>
          {fields.map((f, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-2">
              <Input aria-label="Field key" value={f.key} onChange={(e) => setField(i, { key: e.currentTarget.value })} placeholder="policy_number" className="h-9 text-sm" />
              <Input aria-label="Field label" value={f.label} onChange={(e) => setField(i, { label: e.currentTarget.value })} placeholder="Policy number" className="h-9 text-sm" />
              <Input aria-label="Data path" value={f.path} onChange={(e) => setField(i, { path: e.currentTarget.value })} placeholder="policy.policy_number" className="h-9 text-sm" />
              <Select aria-label="Format" value={f.format ?? "text"} onChange={(e) => setField(i, { format: e.currentTarget.value as TemplateField["format"] })} className="h-9 text-sm">
                {FORMATS.map((x) => <option key={x} value={x}>{x}</option>)}
              </Select>
              <button type="button" onClick={() => setFields((fs) => fs.filter((_, j) => j !== i))} className="rounded-lg p-2 text-muted hover:bg-mist" aria-label="Remove field"><Trash2 className="size-4" /></button>
            </div>
          ))}
          <Button type="button" size="sm" variant="ghost" onClick={() => setFields((fs) => [...fs, { key: "", label: "", path: "" }])}><Plus className="size-4" /> Add field</Button>
        </fieldset>

        <Field label="Layout blocks (JSON)" htmlFor="tb" hint='Block types: heading, paragraph, fields, table, divider, signature. Text supports {{path}} placeholders.'>
          <Textarea id="tb" value={blocks} onChange={(e) => setBlocks(e.currentTarget.value)} rows={14} className="font-mono text-xs" />
        </Field>
        {built.error && <Notice tone="danger">{built.error}</Notice>}
        {check && !check.ok && <Notice tone="danger">{check.errors.slice(0, 5).join(" ")}</Notice>}
      </ActionForm>

      <div>
        <p className="text-sm font-semibold text-ink">Preview (sample data)</p>
        <p className="mb-2 text-xs text-muted">Rendered with the same function the issuance pipeline uses, on illustrative data.</p>
        <div className="doc-preview rounded-card border border-line bg-white p-6 text-sm text-ink [&_.doc-title]:text-xl [&_.doc-title]:font-bold [&_.doc-heading]:mt-4 [&_.doc-heading]:font-semibold [&_.doc-paragraph]:mt-2 [&_.doc-fields]:mt-3 [&_.doc-fields]:grid [&_.doc-fields]:gap-2 [&_.doc-cols-2]:grid-cols-2 [&_.doc-cols-3]:grid-cols-3 [&_dt]:text-xs [&_dt]:uppercase [&_dt]:text-muted [&_dd]:font-medium [&_.doc-table]:mt-3 [&_.doc-table]:w-full [&_th]:py-1 [&_th]:pr-3 [&_th]:text-left [&_th]:font-medium [&_th]:text-muted [&_.doc-divider]:my-4 [&_.doc-signature]:mt-6 [&_.doc-signature]:flex [&_.doc-signature]:flex-col [&_.doc-signature-line]:mb-1 [&_.doc-signature-line]:block [&_.doc-signature-line]:w-48 [&_.doc-signature-line]:border-b [&_.doc-signature-line]:border-ink [&_.doc-footer]:mt-6 [&_.doc-footer]:text-xs [&_.doc-footer]:text-muted">
          {html ? <div dangerouslySetInnerHTML={{ __html: html }} /> : <p className="text-muted">Fix the errors to see a preview.</p>}
        </div>
      </div>
    </div>
  );
}
