import Link from "next/link";
import { Notice, PageHeader, Pill, StatCard, Table, Td, Th, THead, buttonClass } from "@im/ui";
import { EMBED_DISCLOSURE, formatDate, formatGHS, humanize } from "@im/core";
import { can, ROLES, type PartnerContext } from "@/app/(partner)/partner/_lib/context";
import { nowMs } from "@/app/(partner)/partner/_lib/data";
import { Empty, Section } from "./ui";

/** Distributor dashboard: referrals, conversions and revenue share earned (masked customer details). */
export async function DistributorOverview({ ctx, days }: { ctx: PartnerContext; days: number }) {
  const from = new Date(nowMs() - days * 86_400_000).toISOString().slice(0, 10);
  const [{ data: partner }, { data: report, error }] = await Promise.all([
    ctx.supabase.from("distribution_partners").select("status, revenue_share_pct").eq("org_id", ctx.orgId).maybeSingle(),
    ctx.supabase.rpc("partner_referral_report", { p_org_id: ctx.orgId, p_from: from }),
  ]);
  const rows = report ?? [];
  const conversions = rows.filter((r) => r.converted_at).length;
  const earned = rows.reduce((s, r) => s + Number(r.revenue_share ?? 0), 0);
  const money = can(ctx, ROLES.billing);
  return (
    <>
      <PageHeader
        title="Overview"
        description={`Customers you referred to Covva in the last ${days} days.`}
        actions={
          <div className="flex gap-2">
            {[7, 30, 90].map((d) => (
              <Link key={d} href={`/partner?days=${d}`} className={buttonClass(d === days ? "primary" : "secondary", "sm")}>{`${d} days`}</Link>
            ))}
          </div>
        }
      />
      {!partner && <Notice tone="info" className="mb-6">Your distribution partnership is being set up by Covva. Referral links and the widget appear once it is ready.</Notice>}
      {partner && partner.status !== "active" && <Notice tone="wait" className="mb-6">Your partnership is {partner.status}. The widget and API go live when Covva activates it.</Notice>}
      {error && <Notice tone="danger" className="mb-6">We couldn&apos;t load your referral report.</Notice>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Referrals" value={rows.length} />
        <StatCard label="Policies active" value={conversions} />
        <StatCard label="Conversion" value={rows.length ? `${Math.round((conversions / rows.length) * 100)}%` : "—"} />
        <StatCard label="Revenue share earned" value={money ? formatGHS(earned, { decimals: true }) : "—"} hint={money ? `${Number(partner?.revenue_share_pct ?? 0)}% of Covva's platform fee` : "Visible to owners, admins and finance"} />
      </div>
      <Section title="Recent referrals" className="mt-6" description="First name and masked phone only — Covva and the customer's broker handle everything else." actions={<Link href="/partner/links" className={buttonClass("secondary", "sm")}>Referral links</Link>}>
        {rows.length === 0 ? (
          <Empty>No referrals yet. Add the widget to your site or share a campaign link.</Empty>
        ) : (
          <Table>
            <THead><tr><Th>Date</Th><Th>Customer</Th><Th>Cover</Th><Th>Source</Th><Th>Status</Th>{money && <Th className="text-right">Revenue share</Th>}</tr></THead>
            <tbody>
              {rows.slice(0, 50).map((r) => (
                <tr key={r.attribution_id}>
                  <Td className="text-xs">{formatDate(r.created_at)}</Td>
                  <Td>{r.customer_first_name ?? "—"}<p className="font-mono text-xs text-muted">{r.customer_phone_masked ?? ""}</p></Td>
                  <Td>{r.category_slug ? humanize(r.category_slug) : "—"}<p className="text-xs text-muted">{r.request_reference ?? "Lead"}</p></Td>
                  <Td className="text-xs">{humanize(r.source)}{r.campaign ? ` · ${r.campaign}` : ""}</Td>
                  <Td>{r.converted_at ? <Pill tone="ok">Policy active</Pill> : r.request_status ? <Pill tone="wait">{humanize(r.request_status)}</Pill> : <Pill>Lead</Pill>}</Td>
                  {money && <Td className="text-right tabular-nums">{formatGHS(Number(r.revenue_share ?? 0), { decimals: true })}</Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Section>
      <p className="mt-6 text-xs text-muted">{EMBED_DISCLOSURE} As a distribution partner you introduce customers; you do not advise on or arrange cover.</p>
    </>
  );
}
