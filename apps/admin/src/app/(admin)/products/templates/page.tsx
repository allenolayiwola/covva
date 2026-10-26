import { Suspense } from "react";
import { PageHeader, Pill, Table, THead, Th, Td, Tabs } from "@im/ui";
import { renderTemplate, validateTemplate, type DocumentTemplate } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { orgMap } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { LoadingBlock, ReadOnlyBanner } from "@/components/ui/layout";
import { ConfirmAction } from "@/components/ui/forms";
import { CATALOGUE_TABS } from "../meta";
import { approveTemplate } from "../catalogue-actions";

export default function TemplatesPage() {
  return (
    <>
      <PageHeader title="Document templates" description="Schedule, certificate, sticker and receipt templates submitted by insurers. Approved templates are used for issued documents on that product version." />
      <Suspense fallback={<LoadingBlock label="Loading templates…" />}>
        <Templates />
      </Suspense>
    </>
  );
}

const SAMPLE = {
  kind: "schedule",
  policy: { policy_number: "XX-2027-000001", cover_start: "2027-01-01", cover_end: "2027-12-31", premium: 1850 },
  customer: { full_name: "Sample Customer" },
  insurer: { name: "Sample Insurer" },
  broker: { name: "Sample Broker" },
  product: { name: "Sample Product" },
  risk: { vehicle_registration: "GR 0000-27", sum_insured: 100000 },
};

async function Templates() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const [orgs, { data: drafts }] = await Promise.all([
    orgMap(supabase),
    supabase.from("document_templates").select("id, kind, name, status, template, version, created_at, product_version:product_versions(version, products(name, insurer_org_id))").eq("status", "draft").order("created_at").limit(200),
  ]);
  const canAct = can(staff.roles, "productApproval");

  return (
    <>
      <Tabs className="mb-4 w-fit" active="templates" items={CATALOGUE_TABS({ templates: drafts?.length ?? 0 })} />
      <ReadOnlyBanner show={!canAct} />
      <Table>
        <THead><tr><Th>Template</Th><Th>Insurer / product</Th><Th>Kind</Th><Th>Valid</Th><Th>Submitted</Th><Th /></tr></THead>
        <tbody>
          {(drafts ?? []).map((t) => {
            const pv = t.product_version as unknown as { version: number; products: { name: string; insurer_org_id: string } | null } | null;
            const check = validateTemplate(t.template);
            const html = check.ok ? renderTemplate(t.template as unknown as DocumentTemplate, SAMPLE) : "";
            return (
              <tr key={t.id} className="align-top">
                <Td>
                  <p className="font-semibold text-ink">{t.name} <span className="text-xs text-muted">template v{t.version}</span></p>
                  {html && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer font-medium text-brand">Preview (sample data)</summary>
                      <div className="mt-2 max-w-xl rounded-lg border border-line bg-white p-4 text-sm [&_dl]:grid [&_dl]:grid-cols-2 [&_dl]:gap-2 [&_dt]:text-xs [&_dt]:text-muted [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mt-3 [&_h2]:font-semibold [&_hr]:my-3 [&_p]:mt-2" dangerouslySetInnerHTML={{ __html: html }} />
                    </details>
                  )}
                </Td>
                <Td>{orgs.get(pv?.products?.insurer_org_id ?? "")?.name}<p className="text-xs text-muted">{pv?.products?.name} v{pv?.version}</p></Td>
                <Td><Pill tone="neutral">{t.kind}</Pill></Td>
                <Td>{check.ok ? <Pill tone="ok">Valid</Pill> : <Pill tone="danger" >{check.errors[0]}</Pill>}</Td>
                <Td className="text-xs text-muted">{formatDateTime(t.created_at)}</Td>
                <Td>
                  <ConfirmAction action={approveTemplate} fields={{ templateId: t.id }} label="Approve" title={`Approve ${t.kind} template "${t.name}"`} triggerVariant="primary" variant="primary" confirmLabel="Approve template" requireReason={false} reasonLabel="Note (optional)" disabled={!canAct || !check.ok} body="Issued documents on this product version will use this template." />
                </Td>
              </tr>
            );
          })}
          {!drafts?.length && <tr><Td colSpan={6} className="py-10 text-center text-muted">No templates awaiting approval.</Td></tr>}
        </tbody>
      </Table>
    </>
  );
}
