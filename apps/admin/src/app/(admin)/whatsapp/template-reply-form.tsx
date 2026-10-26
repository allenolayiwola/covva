"use client";
import { useState } from "react";
import { renderTemplatePreview } from "@im/core";
import { Field, Input, Select } from "@im/ui";
import { ActionForm, type ServerAction } from "@/components/ui/forms";

export interface TemplateOption { name: string; status: string; body: string; variables: string[]; description: string | null }

/** Pick a registered template and fill its variables; previews the rendered body. */
export function TemplateReplyForm({ action, conversationId, templates, readOnly }: { action: ServerAction; conversationId: string; templates: TemplateOption[]; readOnly?: boolean }) {
  const [name, setName] = useState(templates[0]?.name ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const t = templates.find((x) => x.name === name);
  if (!templates.length) return <p className="text-sm text-muted">No templates registered yet.</p>;
  return (
    <ActionForm action={action} submitLabel="Send template" readOnly={readOnly} audited={false}>
      <input type="hidden" name="conversationId" value={conversationId} />
      <Field label="Template" htmlFor="tpl-name" hint={t?.description ?? undefined}>
        <Select id="tpl-name" name="template" value={name} onChange={(e) => { setName(e.target.value); setValues({}); }}>
          {templates.map((x) => (
            <option key={x.name} value={x.name}>{x.name} ({x.status})</option>
          ))}
        </Select>
      </Field>
      {t?.variables.map((v, i) => (
        <Field key={v} label={`{{${i + 1}}} ${v}`} htmlFor={`var-${v}`}>
          <Input id={`var-${v}`} name={`var_${v}`} value={values[v] ?? ""} onChange={(e) => setValues((s) => ({ ...s, [v]: e.target.value }))} maxLength={1024} />
        </Field>
      ))}
      {t && (
        <p className="rounded-lg bg-mist px-3 py-2 text-xs text-ink-2" data-testid="template-preview">
          {renderTemplatePreview({ body: t.body, variables: t.variables }, values)}
        </p>
      )}
      {t && t.status !== "approved" && <p className="text-xs text-amber">This template is {t.status}. Meta only delivers approved templates; with the log provider it is only logged.</p>}
    </ActionForm>
  );
}
