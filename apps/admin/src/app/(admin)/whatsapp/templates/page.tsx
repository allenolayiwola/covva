import { Suspense } from "react";
import { Input, Label, Pill, Select, Textarea } from "@im/ui";
import { PageHeader } from "@/components/ui/page";
import { renderTemplatePreview } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { ActionForm } from "@/components/ui/forms";
import { LoadingBlock, Panel } from "@/components/ui/layout";
import { saveTemplate, setTemplateStatus } from "../actions";
import { SubNav } from "../sub-nav";
import { CopyForMeta } from "./copy-button";

export default function TemplatesPage() {
  return (
    <>
      <PageHeader title="WhatsApp templates" description="The message templates Covva sends outside the 24-hour window. Each one must be submitted to Meta (Business Manager → WhatsApp → Message templates) and approved before the live provider can send it." actions={<SubNav active="templates" />} />
      <Suspense fallback={<LoadingBlock label="Loading templates…" />}>
        <Templates />
      </Suspense>
    </>
  );
}

const TONE = { draft: "neutral", submitted: "wait", approved: "ok", rejected: "danger" } as const;

function submissionText(t: { name: string; language: string; category: string; body: string; variables: string[]; buttons: unknown }): string {
  const samples = t.variables.map((v, i) => `{{${i + 1}}} = ${v}`).join("\n");
  const buttons = Array.isArray(t.buttons) && t.buttons.length ? `\nButtons: ${(t.buttons as { type: string; text: string }[]).map((b) => `${b.type}: ${b.text}`).join(", ")}` : "";
  return `Name: ${t.name}\nCategory: ${t.category.toUpperCase()}\nLanguage: ${t.language}\n\nBody:\n${t.body}\n\nSample values:\n${samples}${buttons}\n\nSample message:\n${renderTemplatePreview({ body: t.body, variables: t.variables }, t.variables.map((v) => `[${v}]`))}`;
}

async function Templates() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const writer = can(staff.roles, "whatsappTemplates");
  const { data, error } = await supabase.from("wa_templates").select("*").order("name");
  const rows = data ?? [];
  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-danger">{error.message}</p>}
      <div className="grid gap-4 lg:grid-cols-2" data-testid="wa-templates">
        {rows.map((t) => (
          <Panel
            key={t.id}
            title={<span className="font-mono text-sm">{t.name}</span>}
            description={t.description ?? undefined}
            actions={
              <>
                <Pill tone={TONE[t.status as keyof typeof TONE] ?? "neutral"}>{t.status}</Pill>
                <Pill>{t.category}</Pill>
                <Pill>{t.language}</Pill>
                <CopyForMeta text={submissionText(t)} />
              </>
            }
          >
            <p className="whitespace-pre-wrap rounded-lg bg-mist px-3 py-2 text-sm text-ink">{t.body}</p>
            <p className="mt-2 text-xs text-muted">Variables: {t.variables.map((v, i) => `{{${i + 1}}} ${v}`).join(" · ") || "none"}{Array.isArray(t.buttons) && t.buttons.length ? ` · Buttons: ${(t.buttons as { text: string }[]).map((b) => b.text).join(", ")}` : ""}</p>
            {t.meta_template_id && <p className="text-xs text-subtle">Meta template id: {t.meta_template_id}</p>}
            {t.rejection_reason && <p className="text-xs text-danger">Rejected: {t.rejection_reason}</p>}
            <p className="mt-1 text-xs text-subtle">Updated {formatDateTime(t.updated_at)}</p>
            <ActionForm action={setTemplateStatus} inline submitLabel="Update status" submitVariant="outline" readOnly={!writer} audited={false} className="mt-3">
              <input type="hidden" name="templateId" value={t.id} />
              <Select name="status" defaultValue={t.status} aria-label="Status" className="h-9 w-36">
                <option value="draft">draft</option>
                <option value="submitted">submitted</option>
                <option value="approved">approved</option>
                <option value="rejected">rejected</option>
              </Select>
              <Input name="metaTemplateId" defaultValue={t.meta_template_id ?? ""} placeholder="Meta template id" aria-label="Meta template id" className="h-9 w-44" />
              <Input name="reason" placeholder="Rejection reason" aria-label="Rejection reason" className="h-9 w-44" />
            </ActionForm>
          </Panel>
        ))}
        {!rows.length && <p className="text-sm text-muted">No templates registered. Apply the whatsapp migration to seed them.</p>}
      </div>

      <Panel title="Add or edit a template" description="Use {{1}}, {{2}}… in the body and list the variable names in that order. Editing an approved template puts it back to draft (Meta must approve the new wording).">
        <ActionForm action={saveTemplate} submitLabel="Save template" readOnly={!writer} audited={false}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="tpl-name">Name</Label>
              <Input id="tpl-name" name="name" required pattern="[a-z0-9_]{3,80}" placeholder="renewal_reminder" />
            </div>
            <div>
              <Label htmlFor="tpl-category">Category</Label>
              <Select id="tpl-category" name="category" defaultValue="utility">
                <option value="utility">utility</option>
                <option value="marketing">marketing</option>
                <option value="authentication">authentication</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="tpl-lang">Language</Label>
              <Input id="tpl-lang" name="language" defaultValue="en" required />
            </div>
          </div>
          <Label htmlFor="tpl-body">Body</Label>
          <Textarea id="tpl-body" name="body" required maxLength={1024} className="min-h-24" placeholder="Hello {{1}}, your {{2}} policy {{3}} expires on {{4}}. Renew here: {{5}}" />
          <Label htmlFor="tpl-vars">Variable names (in order, comma separated)</Label>
          <Input id="tpl-vars" name="variables" placeholder="name, category, reference, expiry_date, link" />
          <Label htmlFor="tpl-desc">Description</Label>
          <Input id="tpl-desc" name="description" maxLength={500} />
        </ActionForm>
      </Panel>
    </div>
  );
}
