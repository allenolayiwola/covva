import { Suspense } from "react";
import Link from "next/link";
import { Pill, Tabs } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { requireStaff } from "@/lib/auth";
import { can } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { orgMap, personName, profileMap, sp, type SearchParams } from "@/lib/query";
import { formatDateTime } from "@/lib/format";
import { FilterBar, FilterSelect, LoadingBlock, ReadOnlyBanner } from "@/components/ui/layout";
import { ConfirmAction } from "@/components/ui/forms";
import { CATALOGUE_TABS, RATE_TABLE_TONE } from "../meta";
import { reviewRateTable } from "../catalogue-actions";

export default function RateTablesPage({ searchParams }: PageProps<"/products/rate-tables">) {
  return (
    <>
      <PageHeader title="Rate tables" description="Insurer rate tables awaiting review, and broker proposals for insurers not yet on Covva (pending until the insurer confirms). Approving a table makes it usable for live pricing." />
      <Suspense fallback={<LoadingBlock label="Loading rate tables…" />}>
        <RateTables searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const STATUSES = ["pending_review", "draft", "approved", "rejected"];

async function RateTables({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const staff = await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const status = sp(params, "status") || "pending_review";
  const [orgs, { data: tables }] = await Promise.all([
    orgMap(supabase),
    supabase
      .from("rate_tables")
      .select("id, name, status, factor_keys, source, proposed_insurer_name, product_version_id, submitted_by, submitted_by_org_id, review_notes, created_at, version:product_versions(id, version, product_id, products(name, insurer_org_id))")
      .eq("status", STATUSES.includes(status) ? status : "pending_review")
      .order("created_at")
      .limit(200),
  ]);
  const ids = (tables ?? []).map((t) => t.id);
  const { data: counts } = ids.length ? await supabase.from("rate_rows").select("rate_table_id").in("rate_table_id", ids) : { data: [] };
  const rowCount = new Map<string, number>();
  for (const r of counts ?? []) rowCount.set(r.rate_table_id, (rowCount.get(r.rate_table_id) ?? 0) + 1);
  const people = await profileMap(supabase, (tables ?? []).map((t) => t.submitted_by));
  const canAct = can(staff.roles, "productApproval");
  const { count: pendingCount } = await supabase.from("rate_tables").select("id", { count: "exact", head: true }).eq("status", "pending_review");

  return (
    <>
      <Tabs className="mb-4 w-fit" active="rate-tables" items={CATALOGUE_TABS({ rateTables: pendingCount ?? 0 })} />
      <ReadOnlyBanner show={!canAct} />
      <FilterBar action="/products/rate-tables">
        <FilterSelect name="status" label="Status" value={status} options={STATUSES.map((s) => ({ value: s, label: s.replace("_", " ") }))} />
      </FilterBar>
      <Table>
        <THead><tr><Th>Table</Th><Th>Insurer / product</Th><Th>Factors</Th><Th>Rows</Th><Th>Submitted by</Th><Th>Status</Th><Th /></tr></THead>
        <tbody>
          {(tables ?? []).map((t) => {
            const v = t.version as unknown as { id: string; version: number; product_id: string; products: { name: string; insurer_org_id: string } | null } | null;
            const proposal = !t.product_version_id;
            return (
              <tr key={t.id} className="align-top">
                <Td>
                  <Link href={`/products/rate-tables/${t.id}`} className="font-semibold text-ink hover:text-brand">{t.name}</Link>
                  <p className="text-xs text-muted">{t.source} · {formatDateTime(t.created_at)}</p>
                  {t.review_notes && <p className="mt-1 max-w-xs text-xs text-ink-2">{t.review_notes}</p>}
                </Td>
                <Td>
                  {proposal ? (
                    <><Pill tone="info">Broker proposal</Pill><p className="mt-1 text-sm text-ink">{t.proposed_insurer_name}</p><p className="text-xs text-muted">not yet on Covva</p></>
                  ) : (
                    <>{orgs.get(v?.products?.insurer_org_id ?? "")?.name}<p className="text-xs text-muted">{v?.products?.name} v{v?.version}</p></>
                  )}
                </Td>
                <Td className="text-xs">{(t.factor_keys ?? []).join(" × ")}</Td>
                <Td>{rowCount.get(t.id) ?? 0}</Td>
                <Td className="text-xs text-muted">{personName(people.get(t.submitted_by ?? ""))}<br />{orgs.get(t.submitted_by_org_id ?? "")?.name}</Td>
                <Td><Pill tone={RATE_TABLE_TONE[t.status] ?? "neutral"}>{t.status.replace("_", " ")}</Pill></Td>
                <Td>
                  {t.status !== "approved" && (
                    <div className="flex flex-wrap gap-2">
                      <ConfirmAction action={reviewRateTable} fields={{ tableId: t.id, decision: "rejected" }} label="Reject" title={`Reject "${t.name}"`} confirmLabel="Reject" reasonLabel="Reason (sent to the submitter)" disabled={!canAct} />
                      {!proposal && (
                        <ConfirmAction action={reviewRateTable} fields={{ tableId: t.id, decision: "approved" }} label="Approve" title={`Approve "${t.name}"`} triggerVariant="primary" variant="primary" confirmLabel="Approve for pricing" requireReason={false} reasonLabel="Note (optional)" disabled={!canAct} body="Versions that reference this table can then be published and will price from it." />
                      )}
                    </div>
                  )}
                </Td>
              </tr>
            );
          })}
          {!tables?.length && <tr><Td colSpan={7} className="py-10 text-center text-muted">No rate tables with this status.</Td></tr>}
        </tbody>
      </Table>
    </>
  );
}
