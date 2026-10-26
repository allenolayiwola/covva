import { Suspense } from "react";
import Link from "next/link";
import { Checkbox, PageHeader, Pill, Table, THead, Th, Td, Tabs } from "@im/ui";
import { issuanceLabel } from "@im/core";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { categoryMap, orgMap, personName, profileMap } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { LoadingBlock, ReadOnlyBanner } from "@/components/ui/layout";
import { ActionForm, ConfirmAction } from "@/components/ui/forms";
import { CATALOGUE_TABS, COMPLIANCE_TONE } from "../meta";
import { publishVersion, returnVersion, startComplianceReview } from "../catalogue-actions";

export default function CompliancePage() {
  return (
    <>
      <PageHeader title="Compliance review" description="Product versions submitted by insurers (Draft → Submitted → Covva compliance review → Published). Publish makes the version current — or, for a scheduled price change, live at its effective time. Return sends it back with comments." />
      <Suspense fallback={<LoadingBlock label="Loading queue…" />}>
        <Queue />
      </Suspense>
    </>
  );
}

async function Queue() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const [orgs, cats, { data: rows }] = await Promise.all([
    orgMap(supabase),
    categoryMap(supabase),
    supabase
      .from("product_versions")
      .select("id, product_id, version, status, compliance_status, compliance_notes, change_summary, scheduled_effective_from, issuance_type, sla_hours, rating, insurer_approved_at, submitted_by, created_at, products!inner(name, insurer_org_id, category_id)")
      .in("compliance_status", ["submitted", "in_review"])
      .order("created_at"),
  ]);
  const people = await profileMap(supabase, (rows ?? []).map((r) => r.submitted_by));
  const canAct = can(staff.roles, "productApproval");
  const tableIds = (rows ?? []).map((r) => (r.rating as { rate_table_id?: string } | null)?.rate_table_id).filter((x): x is string => !!x);
  const { data: tables } = tableIds.length ? await supabase.from("rate_tables").select("id, name, status").in("id", tableIds) : { data: [] };
  const tmap = new Map((tables ?? []).map((t) => [t.id, t]));

  return (
    <>
      <Tabs className="mb-4 w-fit" active="compliance" items={CATALOGUE_TABS({ compliance: rows?.length ?? 0 })} />
      <ReadOnlyBanner show={!canAct} />
      <Table>
        <THead><tr><Th>Product</Th><Th>Insurer</Th><Th>Version</Th><Th>Pricing</Th><Th>Issuance</Th><Th>Submitted</Th><Th>Status</Th><Th /></tr></THead>
        <tbody>
          {(rows ?? []).map((v) => {
            const p = v.products as unknown as { name: string; insurer_org_id: string; category_id: string };
            const rating = (v.rating ?? {}) as { model?: string; rate_table_id?: string };
            const table = rating.rate_table_id ? tmap.get(rating.rate_table_id) : null;
            const scheduled = v.scheduled_effective_from && new Date(v.scheduled_effective_from).getTime() > Date.now();
            return (
              <tr key={v.id} className="align-top">
                <Td>
                  <Link href={`/products/review/${v.id}`} className="font-semibold text-ink hover:text-brand">{p.name}</Link>
                  <p className="text-xs text-muted">{cats.get(p.category_id)?.name}</p>
                  {v.change_summary && <p className="mt-1 max-w-xs text-xs text-ink-2">{v.change_summary}</p>}
                </Td>
                <Td>{orgs.get(p.insurer_org_id)?.name}</Td>
                <Td>v{v.version}{scheduled && <p className="text-xs text-muted">scheduled {formatDateTime(v.scheduled_effective_from)}</p>}</Td>
                <Td className="text-xs">
                  {rating.model?.replace(/_/g, " ") ?? "—"}
                  {rating.model === "rate_table" && (table ? <p><Pill tone={table.status === "approved" ? "ok" : "wait"}>{table.name}: {table.status.replace("_", " ")}</Pill></p> : <p><Pill tone="danger">no table linked</Pill></p>)}
                </Td>
                <Td className="text-xs">{issuanceLabel(v.issuance_type, v.sla_hours)}</Td>
                <Td className="text-xs text-muted">{formatDateTime(v.created_at)}<br />{v.submitted_by ? personName(people.get(v.submitted_by)) : ""}{v.insurer_approved_at ? "" : <Pill tone="wait" className="mt-1">No insurer sign-off</Pill>}</Td>
                <Td><Pill tone={COMPLIANCE_TONE[v.compliance_status] ?? "neutral"}>{v.compliance_status.replace("_", " ")}</Pill></Td>
                <Td>
                  <div className="flex flex-wrap gap-2">
                    <Link href={`/products/review/${v.id}`} className="self-center text-sm font-semibold text-brand hover:underline">Diff &amp; test →</Link>
                    {v.compliance_status === "submitted" && (
                      <ActionForm action={startComplianceReview} submitLabel="Start review" submitVariant="outline" inline audited={false} readOnly={!canAct}>
                        <input type="hidden" name="versionId" value={v.id} />
                      </ActionForm>
                    )}
                    <ConfirmAction action={returnVersion} fields={{ versionId: v.id }} label="Return" title={`Return ${p.name} v${v.version}`} confirmLabel="Return with comments" reasonLabel="Comments for the insurer (what needs to change)" disabled={!canAct} />
                    <ConfirmAction
                      action={publishVersion}
                      fields={{ versionId: v.id }}
                      label="Publish"
                      title={`Publish ${p.name} v${v.version}`}
                      triggerVariant="primary"
                      variant="primary"
                      confirmLabel={scheduled ? "Publish (goes live on schedule)" : "Publish and make current"}
                      requireReason={false}
                      reasonLabel="Compliance note (optional, shown to the insurer)"
                      disabled={!canAct}
                      body={scheduled ? `This version goes live automatically at ${formatDateTime(v.scheduled_effective_from)}. Existing quotes and policies keep their version.` : "Customers see this version immediately. The previous version is end-dated and kept for existing policies."}
                    >
                      {!v.insurer_approved_at && <Checkbox name="insurerConfirmed" label="I confirm we hold the insurer's written approval of this wording and rating." />}
                    </ConfirmAction>
                  </div>
                </Td>
              </tr>
            );
          })}
          {!rows?.length && <tr><Td colSpan={8} className="py-10 text-center text-muted">Nothing waiting for compliance review.</Td></tr>}
        </tbody>
      </Table>
    </>
  );
}
