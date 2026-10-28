import type { Metadata } from "next";
import { Suspense } from "react";
import { Notice, PageHeader, StatCard, Table, Td, Th, THead } from "@im/ui";
import { formatDate, formatGHS, humanize } from "@im/core";
import { can, ROLES } from "../../_lib/context";
import { getDistributorContext } from "../../_lib/distribution";
import { Empty, PageSkeleton, Section } from "@/components/partner/ui";

export const metadata: Metadata = { title: "Statements" };

/**
 * Distributor revenue share accruals (reward_ledger, RLS: owners, admins, finance). A share of Covva's
 * platform fee on converted policies — never of the premium, which always settles to the insurer.
 */
export default function RevenueSharePage() {
  return (
    <>
      <PageHeader title="Statements" description="Revenue share accrued on converted referrals, by month. Paid by Covva from its platform fee under your agreement." />
      <Suspense fallback={<PageSkeleton stats={2} />}>
        <Statements />
      </Suspense>
    </>
  );
}

async function Statements() {
  const { ctx, partner } = await getDistributorContext();
  if (!can(ctx, ROLES.billing)) return <Notice tone="info">Statements are visible to owners, admins and finance.</Notice>;
  const { data } = await ctx.supabase
    .from("reward_ledger")
    .select("id, kind, amount, memo, reference, related_policy_id, created_at")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(500);
  const rows = data ?? [];
  const months = new Map<string, number>();
  for (const r of rows) months.set(r.created_at.slice(0, 7), (months.get(r.created_at.slice(0, 7)) ?? 0) + Number(r.amount));
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Revenue share accrued" value={formatGHS(total, { decimals: true })} />
        <StatCard label="Your share" value={`${Number(partner?.revenue_share_pct ?? 0)}% of Covva's fee`} />
        <StatCard label="Contract" value={partner?.contract_ref ?? "—"} />
      </div>
      <Section title="By month">
        {months.size === 0 ? (
          <Empty>Nothing accrued yet. Revenue share is posted 14 days after a referred customer&apos;s policy becomes active.</Empty>
        ) : (
          <Table>
            <THead><tr><Th>Month</Th><Th className="text-right">Accrued</Th></tr></THead>
            <tbody>{[...months].map(([m, v]) => <tr key={m}><Td>{m}</Td><Td className="text-right tabular-nums">{formatGHS(v, { decimals: true })}</Td></tr>)}</tbody>
          </Table>
        )}
      </Section>
      {rows.length > 0 && (
        <Section title="Entries">
          <Table>
            <THead><tr><Th>Date</Th><Th>Type</Th><Th>Detail</Th><Th className="text-right">Amount</Th></tr></THead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <Td className="text-xs">{formatDate(r.created_at)}</Td>
                  <Td>{humanize(r.kind)}</Td>
                  <Td className="text-xs text-muted">{r.memo ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{formatGHS(Number(r.amount), { decimals: true })}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}
      <Notice tone="info">Covva never holds client money. Premiums are paid straight to the insurer; your revenue share comes out of Covva&apos;s own platform fee and is paid by statement.</Notice>
    </div>
  );
}
