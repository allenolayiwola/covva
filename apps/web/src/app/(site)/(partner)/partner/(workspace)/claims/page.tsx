import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DemoBadge, EmptyState, PageHeader, StatusPill, Table, Tabs, Td, Th, THead } from "@im/ui";
import { CLAIM_STATUS, formatDate, formatGHS, type ClaimStatus } from "@im/core";
import { requireKind } from "../../_lib/context";
import { getCustomers, getOrgNames, shortName } from "../../_lib/data";
import { RealtimeRefresh } from "@/components/partner/realtime-refresh";
import { PageSkeleton } from "@/components/partner/ui";

export const metadata: Metadata = { title: "Claims" };

const VIEWS: { key: string; label: string; statuses: ClaimStatus[] }[] = [
  { key: "new", label: "New", statuses: ["reported", "delivered_to_insurer"] },
  { key: "assessing", label: "In assessment", statuses: ["acknowledged", "under_assessment", "info_requested"] },
  { key: "decided", label: "Decided — to pay", statuses: ["approved", "partially_approved"] },
  { key: "closed", label: "Paid / closed", statuses: ["paid", "rejected", "closed", "withdrawn"] },
];

export default function ClaimsPage({ searchParams }: PageProps<"/partner/claims">) {
  return (
    <>
      <PageHeader title="Claims" description="You assess and decide claims. Reporting a claim is not approval — record every decision here with a written reason." />
      <Suspense fallback={<PageSkeleton stats={0} />}>
        <Claims searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Claims({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireKind("insurer");
  const sp = await searchParams;
  const key = (Array.isArray(sp.view) ? sp.view[0] : sp.view) || "new";
  const view = VIEWS.find((v) => v.key === key) ?? VIEWS[0]!;
  const { data } = await ctx.supabase
    .from("claims")
    .select("id, reference, status, customer_id, broker_org_id, incident_type, incident_at, amount_claimed, decision_amount, reported_at, delivered_to_insurer_at, created_at")
    .eq("insurer_org_id", ctx.orgId)
    .neq("status", "draft")
    .order("created_at", { ascending: false })
    .limit(1000);
  const all = data ?? [];
  const rows = all.filter((c) => view.statuses.includes(c.status));
  const [customers, brokers] = await Promise.all([getCustomers(ctx, rows.map((c) => c.customer_id)), getOrgNames(ctx, rows.map((c) => c.broker_org_id))]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs active={view.key} items={VIEWS.map((v) => ({ key: v.key, label: v.label, href: `/partner/claims?view=${v.key}`, count: all.filter((c) => v.statuses.includes(c.status)).length }))} />
        <RealtimeRefresh table="claims" filter={`insurer_org_id=eq.${ctx.orgId}`} channel={`iclaims-${ctx.orgId}`} />
      </div>
      <div className="mt-4">
        {rows.length === 0 ? <EmptyState title="No claims here" /> : (
          <Table>
            <THead><tr><Th>Claim / customer</Th><Th>Incident</Th><Th>Broker</Th><Th>Status</Th><Th>Claimed</Th><Th>Decision</Th><Th>Reported</Th></tr></THead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-mist/60">
                  <Td><Link href={`/partner/claims/${c.id}`} className="font-semibold text-ink hover:text-brand">{c.reference} · {shortName(customers.get(c.customer_id))}</Link></Td>
                  <Td>{c.incident_type}<p className="text-xs text-muted">{formatDate(c.incident_at)}</p></Td>
                  <Td>{brokers.get(c.broker_org_id ?? "") ?? "—"}</Td>
                  <Td><StatusPill meta={CLAIM_STATUS[c.status]} /></Td>
                  <Td className="tabular-nums">{formatGHS(c.amount_claimed != null ? Number(c.amount_claimed) : null)}</Td>
                  <Td className="tabular-nums">{formatGHS(c.decision_amount != null ? Number(c.decision_amount) : null)}</Td>
                  <Td>{formatDate(c.reported_at ?? c.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
