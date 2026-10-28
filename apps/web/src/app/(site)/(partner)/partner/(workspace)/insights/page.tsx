import type { Metadata } from "next";
import { Suspense } from "react";
import { DemoBadge, PageHeader, Pill, Table, Td, Th, THead, buttonClass, cn } from "@im/ui";
import { formatGHS } from "@im/core";
import { requireKind } from "../../_lib/context";
import { Empty, PageSkeleton, Section, TitleSkeleton } from "@/components/partner/ui";
import { PRICE_POSITION_LABEL, cell, currentMonth, insurerInsightReport, isMonth, pctCell, previousMonthOf } from "@/server/analytics";

export const metadata: Metadata = { title: "Market insight" };

export default function InsightsPage({ searchParams }: PageProps<"/partner/insights">) {
  return (
    <Suspense fallback={<><TitleSkeleton /><PageSkeleton stats={0} rows={6} /></>}>
      <Insights searchParams={searchParams} />
    </Suspense>
  );
}

async function Insights({ searchParams }: Pick<PageProps<"/partner/insights">, "searchParams">) {
  const [ctx, sp] = await Promise.all([requireKind("insurer"), searchParams]);
  const month = isMonth(typeof sp.month === "string" ? sp.month : null) ? (sp.month as string) : previousMonthOf(currentMonth());
  const report = await insurerInsightReport(ctx.supabase, ctx.orgId, month);
  const months = Array.from({ length: 6 }, (_, i) => {
    let m = currentMonth();
    for (let k = 0; k < i; k++) m = previousMonthOf(m);
    return m;
  });
  const n = (v: number | null) => cell(v, (x) => x.toLocaleString("en-GB"));

  return (
    <>
      <PageHeader
        title="Market insight"
        description={`${ctx.orgName} · Your share of quotes and policies won per category, your price position against the market, renewal retention and claims timing. Anonymised: no broker or customer is identified and any count under ${report.suppression_threshold} is hidden.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <a href={`/partner/insights/export?month=${month}&format=csv`} className={buttonClass("secondary", "md")}>Export CSV</a>
            <a href={`/partner/insights/export?month=${month}&format=pdf`} className={buttonClass("primary", "md")}>Download PDF</a>
          </div>
        }
      />
      <form method="get" action="/partner/insights" className="mb-6 flex flex-wrap items-center gap-2">
        <label htmlFor="month" className="text-sm text-muted">Month</label>
        <select id="month" name="month" defaultValue={month} className="h-10 rounded-[10px] border border-line bg-white px-3 text-sm text-ink">
          {months.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <button type="submit" className={buttonClass("outline", "sm")}>Show</button>
      </form>

      {report.categories.length === 0 ? (
        <Empty>No market activity recorded for {month} yet. Facts are rolled up nightly; the previous month is complete from the 2nd.</Empty>
      ) : (
        <>
          <Section title="Share of the market" description="Your quotes and policies won against every participating insurer, per category. '<5' means the count is hidden to protect small cells.">
            <Table>
              <THead><tr><Th>Category</Th><Th>Quotes (you / market)</Th><Th>Quote share</Th><Th>Policies won (you / market)</Th><Th>Win share</Th></tr></THead>
              <tbody>
                {report.categories.map((c) => (
                  <tr key={c.category_id}>
                    <Td className="font-semibold text-ink">{c.category_name}</Td>
                    <Td className="tabular-nums">{n(c.quotes.mine)} / {n(c.quotes.market)}</Td>
                    <Td className="tabular-nums">{pctCell(c.quotes.share)}</Td>
                    <Td className="tabular-nums">{n(c.wins.mine)} / {n(c.wins.market)}</Td>
                    <Td className="tabular-nums">{pctCell(c.wins.share)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Section>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Section title="Price position" description="Your median binding quote against the market median (within ±10 % counts as in line).">
              <Table>
                <THead><tr><Th>Category</Th><Th>You</Th><Th>Market</Th><Th>Position</Th></tr></THead>
                <tbody>
                  {report.categories.map((c) => (
                    <tr key={c.category_id}>
                      <Td className="font-medium text-ink">{c.category_name}</Td>
                      <Td className="tabular-nums">{c.price.my_median == null ? "<5" : formatGHS(c.price.my_median)}</Td>
                      <Td className="tabular-nums">{c.price.market_median == null ? "<5" : formatGHS(c.price.market_median)}</Td>
                      <Td>{c.price.position ? <Pill tone={c.price.position === "above" ? "wait" : c.price.position === "below" ? "info" : "ok"}>{PRICE_POSITION_LABEL[c.price.position]}</Pill> : <span className="text-muted">—</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Section>
            <Section title="Renewal retention" description="Policies due in the month that were renewed, you against the market.">
              <Table>
                <THead><tr><Th>Category</Th><Th>Due</Th><Th>Renewed</Th><Th>You</Th><Th>Market</Th></tr></THead>
                <tbody>
                  {report.categories.map((c) => (
                    <tr key={c.category_id}>
                      <Td className="font-medium text-ink">{c.category_name}</Td>
                      <Td className="tabular-nums">{n(c.renewals.due)}</Td>
                      <Td className="tabular-nums">{n(c.renewals.renewed)}</Td>
                      <Td className={cn("tabular-nums", c.renewals.retention != null && c.renewals.market_retention != null && c.renewals.retention < c.renewals.market_retention && "text-amber")}>{pctCell(c.renewals.retention)}</Td>
                      <Td className="tabular-nums">{pctCell(c.renewals.market_retention)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Section>
          </div>

          <Section title="Claims timing" description="Claims opened and settled in the month, and the median days from report to payment." className="mt-6">
            <Table>
              <THead><tr><Th>Category</Th><Th>Opened</Th><Th>Settled</Th><Th>Market opened</Th><Th>Days to settle (you)</Th><Th>Days to settle (market)</Th></tr></THead>
              <tbody>
                {report.categories.map((c) => (
                  <tr key={c.category_id}>
                    <Td className="font-medium text-ink">{c.category_name}</Td>
                    <Td className="tabular-nums">{n(c.claims.opened)}</Td>
                    <Td className="tabular-nums">{n(c.claims.settled)}</Td>
                    <Td className="tabular-nums">{n(c.claims.market_opened)}</Td>
                    <Td className="tabular-nums">{c.claims.median_days_to_settle ?? "<5"}</Td>
                    <Td className="tabular-nums">{c.claims.market_median_days_to_settle ?? "<5"}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Section>
        </>
      )}
      <p className="mt-6 text-xs text-subtle">Market figures include every participating insurer on Covva, not the whole Ghanaian market. Generated {report.generated_at.slice(0, 16).replace("T", " ")} UTC.</p>
      {ctx.isDemo && <DemoBadge className="mt-4" />}
    </>
  );
}
