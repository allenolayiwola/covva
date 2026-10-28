import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Card, DemoBadge, PageHeader, Tabs, buttonClass, cn } from "@im/ui";
import { can, getPartnerContext, ROLES } from "../../_lib/context";
import { getCategoryMap, getOrgNames } from "../../_lib/data";
import { buildReport } from "../../_lib/reports";
import { Bars, Columns, PageSkeleton, Section } from "@/components/partner/ui";
import { BrokerAnalytics, InsurerAnalytics } from "@/components/partner/analytics-panels";
import { EXPORT_TYPES, parseRange } from "@/server/partner-analytics";

const EXPORT_LABEL: Record<(typeof EXPORT_TYPES)[number], string> = { sales: "Sales by day", renewals: "Renewals due", claims: "Claims", commission: "Commission (finance)" };

export const metadata: Metadata = { title: "Reports" };

const PERIODS = [30, 90, 180];

export default function ReportsPage({ searchParams }: PageProps<"/partner/reports">) {
  return (
    <Suspense fallback={<><PageHeader title="Reports" description="Pilot scorecard: service, conversion and conduct." /><PageSkeleton stats={3} /></>}>
      <Reports searchParams={searchParams} />
    </Suspense>
  );
}

async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getPartnerContext();
  if (ctx.kind === "distributor") redirect("/partner"); // distributors: referral reporting is on the dashboard
  const sp = await searchParams;
  const days = PERIODS.includes(Number(sp.days)) ? Number(sp.days) : 90;
  const analyticsDays = parseRange(sp.range, 30);
  const canSeeMoney = can(ctx, ROLES.billing);
  const scope = { supabase: ctx.supabase, orgId: ctx.orgId, kind: ctx.kind, canSeeMoney };
  const cats = await getCategoryMap();
  const categories = new Map([...cats.values()].map((c) => [c.id, c.name]));
  let orgs: Map<string, string> | undefined;
  if (ctx.kind === "insurer") {
    const { data } = await ctx.supabase.from("insurer_submissions").select("broker_org_id").eq("insurer_org_id", ctx.orgId).limit(1000);
    orgs = await getOrgNames(ctx, (data ?? []).map((d) => d.broker_org_id));
  }
  const report = await buildReport({ supabase: ctx.supabase, orgId: ctx.orgId, kind: ctx.kind, days }, { categories, orgs });
  const datasets = Object.keys(report.datasets);

  return (
    <>
      <PageHeader
        title="Reports"
        description={ctx.kind === "broker" ? "Pilot scorecard: quote coverage, response times, conversion, issuance, conduct and retention." : "Partner scorecard: responsiveness, binding, issuance and claims."}
        actions={
          <details className="relative">
            <summary className={cn(buttonClass("secondary", "md"), "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>Export CSV</summary>
            <div className="absolute right-0 z-20 mt-2 w-64 rounded-card border border-line bg-white p-2 shadow-float">
              <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-subtle">Scorecard</p>
              {datasets.map((d) => (
                <a key={d} href={`/partner/reports/export?dataset=${d}&days=${days}`} className="block rounded-lg px-3 py-2 text-sm capitalize text-ink-2 hover:bg-mist">{d}</a>
              ))}
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-subtle">Analytics (last {analyticsDays} days)</p>
              {EXPORT_TYPES.filter((t) => t !== "commission" || canSeeMoney).map((t) => (
                <a key={t} href={`/partner/reports/export?type=${t}&days=${analyticsDays}`} className="block rounded-lg px-3 py-2 text-sm text-ink-2 hover:bg-mist" data-testid={`export-${t}`}>{EXPORT_LABEL[t]}</a>
              ))}
            </div>
          </details>
        }
      />
      <Tabs active={String(days)} items={PERIODS.map((p) => ({ key: String(p), label: `Last ${p} days`, href: `/partner/reports?days=${p}` }))} className="mb-6 w-fit" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {report.metrics.map((m) => (
          <Card key={m.key} className="p-5">
            <p className="text-sm text-muted">{m.label}{m.placeholder && <span className="ml-2 rounded bg-mist px-1.5 py-0.5 text-[11px]">Placeholder</span>}</p>
            <p className={cn("mt-2 text-3xl font-bold tracking-tight", m.warn ? "text-amber" : "text-ink")}>{m.value}</p>
            {m.ratio != null && (
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-mist" aria-hidden>
                <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, Math.round(m.ratio * 100))}%` }} />
              </div>
            )}
            {m.detail && <p className="mt-2 text-xs text-subtle">{m.detail}</p>}
          </Card>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Section title={ctx.kind === "broker" ? "Requests per week" : "Submissions per week"} description="Last 12 weeks">
          <Columns items={report.weekly} label="Weekly volume" />
        </Section>
        <div className="space-y-6">
          {report.breakdowns.map((b) => (
            <Section key={b.title} title={b.title}>
              {b.items.length === 0 ? <p className="text-sm text-muted">No data in this period.</p> : <Bars items={b.items.slice(0, 8)} />}
            </Section>
          ))}
        </div>
      </div>
      <p className="mt-6 text-xs text-subtle">Figures are computed from records visible to your organisation. Indicative pilot measures — definitions to be agreed with partners.</p>

      <div className="mt-10">
        <Suspense fallback={<PageSkeleton stats={5} rows={3} />}>
          {ctx.kind === "insurer" ? <InsurerAnalytics scope={scope} days={analyticsDays} basePath="/partner/reports" rangeParam="range" /> : <BrokerAnalytics scope={scope} days={analyticsDays} basePath="/partner/reports" rangeParam="range" />}
        </Suspense>
      </div>
      {ctx.isDemo && <DemoBadge className="mt-4" />}
    </>
  );
}
