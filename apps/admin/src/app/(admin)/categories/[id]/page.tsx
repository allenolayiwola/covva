import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CheckCircle2, Circle } from "lucide-react";
import { Checkbox, Field, Input, Notice, Select, StatusPill, Textarea } from "@im/ui";
import { PageHeader } from "@/components/ui/page";
import { CATEGORY_AVAILABILITY, type RiskField } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/query";
import { DOCUMENT_KINDS, LAUNCH_CHECKLIST } from "@/lib/catalogue";
import { Breadcrumb, LoadingBlock, Panel, ReadOnlyBanner } from "@/components/ui/layout";
import { ActionForm } from "@/components/ui/forms";
import { RiskSchemaEditor } from "../RiskSchemaEditor";
import { saveCategory } from "../actions";

export default function CategoryPage({ params }: PageProps<"/categories/[id]">) {
  return (
    <Suspense fallback={<LoadingBlock label="Loading category…" />}>
      <CategoryEditor params={params} />
    </Suspense>
  );
}

async function CategoryEditor({ params }: Pick<PageProps<"/categories/[id]">, "params">) {
  const staff = await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const supabase = await createClient();
  const { data: c } = await supabase.from("product_categories").select("*").eq("id", id).maybeSingle();
  if (!c) notFound();
  const canAct = can(staff.roles, "catalogue");
  const lc = (c.launch_checklist as Record<string, boolean> | null) ?? {};
  const missing = LAUNCH_CHECKLIST.filter((i) => !lc[i.key]);
  const schema = (Array.isArray(c.risk_schema) ? c.risk_schema : []) as unknown as RiskField[];

  return (
    <>
      <Breadcrumb items={[{ label: "Categories", href: "/categories" }, { label: c.name }]} />
      <PageHeader title={<span className="flex items-center gap-3">{c.name} <StatusPill meta={CATEGORY_AVAILABILITY[c.availability]} /></span>} description={`/${c.slug} · ${c.segment}`} />
      <ReadOnlyBanner show={!canAct} />
      <ActionForm action={saveCategory} submitLabel="Save category" readOnly={!canAct}>
        <input type="hidden" name="categoryId" value={c.id} />
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <Panel title="Description">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" htmlFor="name"><Input id="name" name="name" defaultValue={c.name} required /></Field>
                <Field label="Icon (lucide name)" htmlFor="icon"><Input id="icon" name="icon" defaultValue={c.icon ?? ""} /></Field>
                <Field label="Short description" htmlFor="short_description" className="sm:col-span-2"><Input id="short_description" name="short_description" defaultValue={c.short_description ?? ""} /></Field>
                <Field label="Description" htmlFor="description" className="sm:col-span-2"><Textarea id="description" name="description" defaultValue={c.description ?? ""} /></Field>
                <Field label="Segment" htmlFor="segment">
                  <Select id="segment" name="segment" defaultValue={c.segment}>
                    <option value="personal">Personal</option>
                    <option value="business">Business</option>
                    <option value="specialist">Specialist</option>
                  </Select>
                </Field>
                <Field label="Sort order" htmlFor="sort_order"><Input id="sort_order" name="sort_order" type="number" defaultValue={c.sort_order} /></Field>
                <Field label="Default SLA (hours)" htmlFor="default_sla_hours" hint="Sets request due dates when submitted"><Input id="default_sla_hours" name="default_sla_hours" type="number" min={1} defaultValue={c.default_sla_hours} /></Field>
                <Field label="Regulatory note" htmlFor="regulatory_note" hint="Shown to customers on the category page" className="sm:col-span-2"><Textarea id="regulatory_note" name="regulatory_note" defaultValue={c.regulatory_note ?? ""} className="min-h-20" /></Field>
              </div>
            </Panel>

            <Panel title="Risk schema" description="Fields customers complete to request quotes (web and mobile render the same schema).">
              <RiskSchemaEditor initial={schema} disabled={!canAct} />
            </Panel>
          </div>

          <div className="space-y-6">
            <Panel title="Availability & launch gate">
              <Field label="Availability" htmlFor="availability">
                <Select id="availability" name="availability" defaultValue={c.availability}>
                  <option value="integrated">Integrated — compare & pay</option>
                  <option value="broker_assisted">Broker assisted — structured request, named adviser</option>
                  <option value="planned">Planned — labelled, not sold</option>
                </Select>
              </Field>
              <p className="mt-2 text-xs text-muted">{CATEGORY_AVAILABILITY[c.availability].promise}</p>
              <div className="mt-5 space-y-2">
                <p className="text-sm font-semibold text-ink">Launch checklist</p>
                {LAUNCH_CHECKLIST.map((i) => (
                  <Checkbox
                    key={i.key}
                    name={`lc_${i.key}`}
                    defaultChecked={!!lc[i.key]}
                    className="rounded-xl border border-line p-3"
                    label={
                      <span>
                        <span className="flex items-center gap-1.5 font-medium text-ink">
                          {lc[i.key] ? <CheckCircle2 className="size-3.5 text-brand" /> : <Circle className="size-3.5 text-subtle" />}
                          {i.label}
                        </span>
                        <span className="block text-xs text-muted">{i.help}</span>
                      </span>
                    }
                  />
                ))}
              </div>
              {missing.length > 0 ? (
                <Notice tone="wait" className="mt-4" title="Not ready to integrate">
                  “A category becomes available only after approval.” Saving as <strong>integrated</strong> is blocked until all seven items are ticked. Missing: {missing.map((m) => m.label).join(", ")}.
                </Notice>
              ) : (
                <Notice tone="ok" className="mt-4">All seven launch items are recorded.</Notice>
              )}
            </Panel>

            <Panel title="Required documents">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
                {DOCUMENT_KINDS.map((k) => (
                  <Checkbox key={k} name="required_documents" value={k} defaultChecked={c.required_documents.includes(k)} label={k.replace(/_/g, " ")} />
                ))}
              </div>
            </Panel>
            <Notice tone="info">Saving refreshes the catalogue cache here and asks the public site to refresh too.</Notice>
          </div>
        </div>
      </ActionForm>
    </>
  );
}
