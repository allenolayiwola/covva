import { Suspense } from "react";
import { notFound } from "next/navigation";
import { PageHeader, Pill, Table, THead, Th, Td } from "@im/ui";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { isUuid, orgMap, personName, profileMap } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { Breadcrumb, KeyValues, LoadingBlock, Panel, ReadOnlyBanner } from "@/components/ui/layout";
import { ConfirmAction } from "@/components/ui/forms";
import { RATE_TABLE_TONE } from "../../meta";
import { reviewRateTable } from "../../catalogue-actions";

export default function RateTablePage({ params }: PageProps<"/products/rate-tables/[tableId]">) {
  return (
    <Suspense fallback={<LoadingBlock label="Loading rate table…" />}>
      <RateTable params={params} />
    </Suspense>
  );
}

async function RateTable({ params }: Pick<PageProps<"/products/rate-tables/[tableId]">, "params">) {
  const staff = await requireStaff();
  const { tableId } = await params;
  if (!isUuid(tableId)) notFound();
  const supabase = await createClient();
  const { data: t } = await supabase.from("rate_tables").select("*, version:product_versions(id, version, product_id, products(name, insurer_org_id))").eq("id", tableId).maybeSingle();
  if (!t) notFound();
  const [{ data: rows }, orgs, people] = await Promise.all([
    supabase.from("rate_rows").select("id, factors, rate, rate_kind, min_premium, loadings, created_at").eq("rate_table_id", t.id).order("created_at").limit(2000),
    orgMap(supabase),
    profileMap(supabase, [t.submitted_by, t.reviewed_by]),
  ]);
  const v = t.version as unknown as { id: string; version: number; product_id: string; products: { name: string; insurer_org_id: string } | null } | null;
  const canAct = can(staff.roles, "productApproval");
  const keys = t.factor_keys ?? [];
  const proposal = !t.product_version_id;

  return (
    <>
      <Breadcrumb items={[{ label: "Products", href: "/products" }, { label: "Rate tables", href: "/products/rate-tables" }, { label: t.name }]} />
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-3">{t.name} <Pill tone={RATE_TABLE_TONE[t.status] ?? "neutral"}>{t.status.replace("_", " ")}</Pill></span>}
        description={proposal ? `Broker proposal for ${t.proposed_insurer_name} (not yet on Covva)` : `${orgs.get(v?.products?.insurer_org_id ?? "")?.name ?? ""} · ${v?.products?.name ?? ""} v${v?.version ?? ""}`}
        actions={
          t.status !== "approved" ? (
            <>
              <ConfirmAction action={reviewRateTable} fields={{ tableId: t.id, decision: "rejected" }} label="Reject" title={`Reject "${t.name}"`} confirmLabel="Reject" reasonLabel="Reason (sent to the submitter)" disabled={!canAct} />
              {!proposal && <ConfirmAction action={reviewRateTable} fields={{ tableId: t.id, decision: "approved" }} label="Approve" title={`Approve "${t.name}"`} triggerVariant="primary" variant="primary" confirmLabel="Approve for pricing" requireReason={false} reasonLabel="Note (optional)" disabled={!canAct} />}
            </>
          ) : null
        }
      />
      <ReadOnlyBanner show={!canAct} />
      <div className="space-y-6">
        <Panel title="Details">
          <KeyValues
            items={[
              { label: "Factor keys", value: keys.join(" × ") || "—" },
              { label: "Source", value: t.source },
              { label: "Currency", value: t.base_currency },
              { label: "Submitted", value: `${formatDateTime(t.created_at)} · ${personName(people.get(t.submitted_by ?? ""))} · ${orgs.get(t.submitted_by_org_id ?? "")?.name ?? ""}` },
              { label: "Reviewed", value: t.reviewed_at ? `${formatDateTime(t.reviewed_at)} · ${personName(people.get(t.reviewed_by ?? ""), "staff")}` : "—" },
              { label: "Notes", value: t.review_notes ?? "—" },
            ]}
          />
        </Panel>
        <Panel title={`Rows (${rows?.length ?? 0})`} bodyClassName="p-0">
          <Table>
            <THead><tr>{keys.map((k) => <Th key={k}>{k.replace(/_/g, " ")}</Th>)}<Th>Rate</Th><Th>Kind</Th><Th>Min premium</Th><Th>Loadings</Th></tr></THead>
            <tbody>
              {(rows ?? []).map((r) => (
                <tr key={r.id}>
                  {keys.map((k) => <Td key={k}>{String(((r.factors ?? {}) as Record<string, unknown>)[k] ?? "*")}</Td>)}
                  <Td className="font-mono">{r.rate_kind === "rate_on_value" ? `${(Number(r.rate) * 100).toFixed(3)}%` : Number(r.rate).toLocaleString("en-GH")}</Td>
                  <Td>{r.rate_kind.replace(/_/g, " ")}</Td>
                  <Td>{r.min_premium != null ? Number(r.min_premium).toLocaleString("en-GH") : "—"}</Td>
                  <Td className="text-xs text-muted">{Array.isArray(r.loadings) && r.loadings.length ? JSON.stringify(r.loadings) : "—"}</Td>
                </tr>
              ))}
              {!rows?.length && <tr><Td colSpan={keys.length + 4} className="py-8 text-center text-muted">No rows.</Td></tr>}
            </tbody>
          </Table>
        </Panel>
      </div>
    </>
  );
}
