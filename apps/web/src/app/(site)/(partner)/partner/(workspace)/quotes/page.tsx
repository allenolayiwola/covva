import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DemoBadge, EmptyState, PageHeader, StatCard, StatusPill, Table, Tabs, Td, Th, THead } from "@im/ui";
import { QUOTE_STATUS, formatDate, formatDateTime, formatGHS, type QuoteStatus } from "@im/core";
import { requireKind } from "../../_lib/context";
import { nowMs, DAY, getCustomers, getOrgNames, shortName } from "../../_lib/data";
import { PageSkeleton } from "@/components/partner/ui";

export const metadata: Metadata = { title: "Quotes" };

export default function QuotesPage({ searchParams }: PageProps<"/partner/quotes">) {
  return (
    <>
      <PageHeader title="Quotes" description="Every quote your team has prepared or received, with its state and validity." />
      <Suspense fallback={<PageSkeleton />}>
        <Quotes searchParams={searchParams} />
      </Suspense>
    </>
  );
}

const FILTERS: { key: string; label: string; statuses?: QuoteStatus[] }[] = [
  { key: "live", label: "Live", statuses: ["estimate", "awaiting_underwriting", "ready_to_accept"] },
  { key: "expiring", label: "Expiring soon" },
  { key: "estimate", label: "Estimates", statuses: ["estimate"] },
  { key: "awaiting_underwriting", label: "Awaiting underwriting", statuses: ["awaiting_underwriting"] },
  { key: "ready_to_accept", label: "Ready to accept", statuses: ["ready_to_accept"] },
  { key: "accepted", label: "Accepted", statuses: ["accepted"] },
  { key: "closed", label: "Expired / declined / withdrawn", statuses: ["expired", "declined", "withdrawn"] },
];

async function Quotes({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireKind("broker");
  const sp = await searchParams;
  const key = (Array.isArray(sp.status) ? sp.status[0] : sp.status) || "live";
  const filter = FILTERS.find((f) => f.key === key) ?? FILTERS[0]!;

  const { data } = await ctx.supabase
    .from("quotes")
    .select("id, status, premium, excess, valid_until, created_at, insurer_org_id, request:requests!quotes_request_id_fkey(id, reference, customer_id)")
    .eq("broker_org_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(1000);
  const all = data ?? [];
  const now = nowMs();
  const expiring = (q: (typeof all)[number]) => q.status === "ready_to_accept" && !!q.valid_until && Date.parse(q.valid_until) > now && Date.parse(q.valid_until) - now < 3 * DAY;
  const rows = filter.key === "expiring" ? all.filter(expiring) : all.filter((q) => filter.statuses!.includes(q.status));

  const reqOf = (q: (typeof all)[number]) => q.request as unknown as { id: string; reference: string; customer_id: string } | null;
  const [insurers, customers] = await Promise.all([
    getOrgNames(ctx, rows.map((q) => q.insurer_org_id)),
    getCustomers(ctx, rows.map((q) => reqOf(q)?.customer_id ?? "")),
  ]);
  const countOf = (f: (typeof FILTERS)[number]) => (f.key === "expiring" ? all.filter(expiring).length : all.filter((q) => f.statuses!.includes(q.status)).length);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Ready to accept" value={String(all.filter((q) => q.status === "ready_to_accept").length).padStart(2, "0")} />
        <StatCard label="Awaiting underwriting" value={String(all.filter((q) => q.status === "awaiting_underwriting").length).padStart(2, "0")} />
        <StatCard label="Expiring within 3 days" value={String(all.filter(expiring).length).padStart(2, "0")} tone="warn" />
      </div>
      <Tabs className="mt-6" active={filter.key} items={FILTERS.map((f) => ({ key: f.key, label: f.label, href: `/partner/quotes?status=${f.key}`, count: countOf(f) }))} />
      <div className="mt-4">
        {rows.length === 0 ? (
          <EmptyState title="No quotes here" body="Quotes are prepared from the request workspace." />
        ) : (
          <Table>
            <THead><tr><Th>Request / customer</Th><Th>Insurer</Th><Th>Status</Th><Th>Premium</Th><Th>Excess</Th><Th>Valid until</Th><Th>Prepared</Th></tr></THead>
            <tbody>
              {rows.map((q) => {
                const r = reqOf(q);
                return (
                  <tr key={q.id} className="hover:bg-mist/60">
                    <Td>{r ? <Link href={`/partner/requests/${r.id}#quotes`} className="font-semibold text-ink hover:text-brand">{r.reference} · {shortName(customers.get(r.customer_id))}</Link> : "—"}</Td>
                    <Td>{insurers.get(q.insurer_org_id) ?? "Insurer"}</Td>
                    <Td><StatusPill meta={QUOTE_STATUS[q.status]} /></Td>
                    <Td className="tabular-nums">{formatGHS(Number(q.premium))}</Td>
                    <Td className="tabular-nums">{formatGHS(q.excess != null ? Number(q.excess) : null)}</Td>
                    <Td className={expiring(q) ? "font-medium text-amber" : undefined}>{formatDate(q.valid_until)}</Td>
                    <Td className="text-xs text-muted">{formatDateTime(q.created_at)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>
      {ctx.isDemo && <DemoBadge className="mt-8" />}
    </>
  );
}
