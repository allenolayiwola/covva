import Link from "next/link";
import { CLAIM_STATUS, formatDate, formatGHS, humanize, type ClaimStatus } from "@im/core";
import { Pill, Table, Tabs, Td, Th, THead, buttonClass } from "@im/ui";
import { BarChart, KpiTile, LineChart, RateMeter, dayLabel } from "@/components/partner/charts";
import { Bars, Empty, KV, Section } from "@/components/partner/ui";
import { DASHBOARD_RANGES, loadDashboard, rangeDates, type AnalyticsClient, type DashboardRange, type PartnerDashboard } from "@/server/partner-analytics";

/**
 * Analytics panels for the partner overview pages (insurer dashboard, broker web dashboard).
 * Numbers come from the membership-checked analytics functions (see `@/server/partner-analytics`);
 * the caller's RLS client is used, so a member only ever sees their own organisation.
 */
interface Scope {
  supabase: AnalyticsClient;
  orgId: string;
  kind: "broker" | "insurer";
  /** Owners, admins and finance may see money. */
  canSeeMoney: boolean;
}

const ghs = (n: number) => formatGHS(n);
const pct = (n: number | null | undefined) => (n == null ? "—" : `${Math.round(Number(n))}%`);

export function RangeTabs({ days, basePath, param = "days" }: { days: DashboardRange; basePath: string; param?: string }) {
  return <Tabs active={String(days)} items={DASHBOARD_RANGES.map((d) => ({ key: String(d), label: `Last ${d} days`, href: `${basePath}?${param}=${d}` }))} className="w-fit" />;
}

interface PanelProps { scope: Scope; days: DashboardRange; /** Where the range tabs link to (default the overview). */ basePath?: string; rangeParam?: string }

function series(dash: PartnerDashboard, key: "requests" | "quotes" | "conversions" | "policies_issued" | "premium" | "broker_commission" | "platform_fee") {
  return dash.series.map((d) => ({ label: dayLabel(d.day), value: Number(d[key] ?? 0) }));
}

export async function BrokerAnalytics({ scope, days, basePath = "/partner", rangeParam = "days" }: PanelProps) {
  const sb = scope.supabase;
  const [dash, offers, statements] = await Promise.all([
    loadDashboard(sb, scope.orgId, { days, includeCommission: scope.canSeeMoney }),
    sb.from("order_offers").select("status, offered_at").eq("broker_org_id", scope.orgId).gte("offered_at", `${rangeDates(days).from}T00:00:00Z`).limit(5000),
    scope.canSeeMoney ? sb.from("settlement_statements").select("id, period_start, period_end, status, net_due, commission, currency").eq("org_id", scope.orgId).order("period_start", { ascending: false }).limit(3) : Promise.resolve({ data: [] as { id: string; period_start: string; period_end: string; status: string; net_due: number; commission: number; currency: string }[] }),
  ]);
  const off = offers.data ?? [];
  const responded = off.filter((o) => o.status === "accepted" || o.status === "declined").length;
  const accepted = off.filter((o) => o.status === "accepted").length;
  const t = dash.totals;
  const convRate = t.quotes ? Math.round((t.conversions / t.quotes) * 100) : null;
  const sla = dash.sla;

  return (
    <div className="space-y-6" data-testid="broker-analytics">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-ink">Performance</h2>
        <RangeTabs days={days} basePath={basePath} param={rangeParam} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiTile label="Leads received" value={off.length} hint={`${accepted} accepted · ${responded ? Math.round((accepted / responded) * 100) : 0}% accept rate`} href="/partner/offers" />
        <KpiTile label="Requests" value={t.requests} change={dash.change.requests} points={series(dash, "requests")} href="/partner/requests" />
        <KpiTile label="Quotes sent" value={t.quotes} change={dash.change.quotes} points={series(dash, "quotes")} href="/partner/quotes" />
        <KpiTile label="Conversions" value={t.conversions} hint={convRate == null ? "Applications accepted" : `${convRate}% of quotes`} change={dash.change.conversions} points={series(dash, "conversions")} />
        <KpiTile label="Policies issued" value={t.policiesIssued} hint={scope.canSeeMoney ? `${ghs(t.premium)} premium` : undefined} change={dash.change.policiesIssued} points={series(dash, "policies_issued")} href="/partner/policies" />
        <KpiTile label="Renewals due (30 days)" value={dash.renewals.count} hint={`${dash.renewals.next.filter((r) => r.renewal_request_id).length} already started`} href="/partner/policies?view=renewals" />
        <KpiTile label="Lapses (90 days)" value={dash.lapses.lapsed + dash.lapses.cancelled + dash.lapses.expired} hint={`${dash.lapses.renewed} renewed · ${pct(dash.lapses.lapse_rate)} lapse rate`} tone={dash.lapses.lapsed + dash.lapses.cancelled > 0 ? "warn" : "default"} />
        <KpiTile label="Claims in progress" value={dash.claims.open} hint={dash.claims.avgDaysToDecision != null ? `${dash.claims.avgDaysToDecision} days to decision` : "No decisions yet"} href="/partner/service#claims" />
        <KpiTile label="Response targets met" value={pct(sla.on_time_rate)} hint={`${sla.requests_on_time} of ${sla.requests_measured} requests on time`} tone={sla.requests_open_overdue > 0 ? "warn" : "default"} />
        {scope.canSeeMoney && (
          <KpiTile label="Commission this month" value={dash.commission ? ghs(dash.commission.earned) : "—"} hint={dash.commission ? `${ghs(dash.commission.outstanding)} outstanding` : "Owners, admins and finance"} points={series(dash, "broker_commission")} format={ghs} href="/partner/settlements" />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Section title="Sales funnel" description={`Requests, quotes and conversions per day, ${dayLabel(dash.from)} – ${dayLabel(dash.to)}`}>
          <LineChart
            title="Requests, quotes and conversions per day"
            labels={dash.series.map((d) => dayLabel(d.day))}
            series={[
              { name: "Requests", values: dash.series.map((d) => d.requests), tone: "ink" },
              { name: "Quotes", values: dash.series.map((d) => d.quotes), tone: "brand" },
              { name: "Conversions", values: dash.series.map((d) => d.conversions), tone: "amber" },
            ]}
          />
        </Section>
        <div className="space-y-6">
          <Section title="Policies issued per day">
            <BarChart title="Policies issued per day" points={series(dash, "policies_issued")} unit="Policies" />
          </Section>
          <Section title="Service levels">
            <RateMeter label="Requests answered within target" ratio={sla.requests_measured ? sla.requests_on_time / sla.requests_measured : null} detail={`${sla.requests_breached} breached · ${sla.requests_open_overdue} open and overdue`} />
            <RateMeter className="mt-3" label="Insurer responses on time" ratio={sla.submissions_measured ? sla.submissions_on_time / sla.submissions_measured : null} detail={`${sla.submissions_late} late · ${sla.submissions_open_overdue} awaiting past the target`} />
          </Section>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <RenewalsPanel dash={dash} kind="broker" />
        {scope.canSeeMoney ? (
          <Section title="Commission and settlements" description="Earned from the ledger; paid and outstanding from settlement statements." actions={<Link href="/partner/settlements" className={buttonClass("secondary", "sm")}>Statements</Link>}>
            {dash.commission ? (
              <>
                <KV label={`Earned (${dash.commission.period})`}>{ghs(dash.commission.earned)}</KV>
                <KV label="Paid on statements">{ghs(dash.commission.paid)}</KV>
                <KV label="Outstanding">{ghs(dash.commission.outstanding)}</KV>
                {dash.commission.revenue_share > 0 && <KV label="Revenue share to Covva">{ghs(dash.commission.revenue_share)}</KV>}
                <KV label="Statement">{dash.commission.statement_status ? <Pill tone={dash.commission.statement_status === "paid" ? "ok" : "wait"}>{humanize(dash.commission.statement_status)}</Pill> : "Not yet built"}</KV>
              </>
            ) : (
              <Empty>No commission recorded yet. Statements are built monthly from the ledger.</Empty>
            )}
            {(statements.data ?? []).length > 0 && (
              <ul className="mt-4 divide-y divide-line text-sm">
                {(statements.data ?? []).map((s) => (
                  <li key={s.id} className="flex items-center justify-between py-2">
                    <Link href={`/partner/settlements?statement=${s.id}`} className="font-medium text-ink hover:text-brand">{formatDate(s.period_start)} – {formatDate(s.period_end)}</Link>
                    <span className="tabular-nums text-muted">{ghs(Number(s.net_due))} · {humanize(s.status)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ) : (
          <ClaimsPanel dash={dash} href="/partner/service#claims" />
        )}
      </div>
    </div>
  );
}

export async function InsurerAnalytics({ scope, days, basePath = "/partner", rangeParam = "days" }: PanelProps) {
  const sb = scope.supabase;
  const [dash, statements] = await Promise.all([
    loadDashboard(sb, scope.orgId, { days, includeCommission: scope.canSeeMoney }),
    scope.canSeeMoney ? sb.from("settlement_statements").select("id, period_start, period_end, status, net_due, gross_premium, commission, platform_fee, currency").eq("org_id", scope.orgId).order("period_start", { ascending: false }).limit(3) : Promise.resolve({ data: [] as { id: string; period_start: string; period_end: string; status: string; net_due: number; gross_premium: number; commission: number; platform_fee: number; currency: string }[] }),
  ]);
  const t = dash.totals;
  const sla = dash.sla;
  const convRate = t.quotes ? Math.round((t.conversions / t.quotes) * 100) : null;
  const latest = statements.data?.[0];

  return (
    <div className="space-y-6" data-testid="insurer-analytics">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-ink">Dashboard</h2>
        <RangeTabs days={days} basePath={basePath} param={rangeParam} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiTile label="Sales (premium)" value={scope.canSeeMoney ? ghs(t.premium) : t.policiesIssued} hint={scope.canSeeMoney ? `${t.policiesIssued} policies issued` : "Policies issued"} change={dash.change.premium} points={series(dash, scope.canSeeMoney ? "premium" : "policies_issued")} format={scope.canSeeMoney ? ghs : undefined} />
        <KpiTile label="Submissions received" value={t.requests} change={dash.change.requests} points={series(dash, "requests")} href="/partner/submissions" />
        <KpiTile label="Quotes" value={t.quotes} change={dash.change.quotes} points={series(dash, "quotes")} href="/partner/submissions?view=quotes" />
        <KpiTile label="Conversions" value={t.conversions} hint={convRate == null ? "Applications accepted" : `${convRate}% of quotes`} change={dash.change.conversions} points={series(dash, "conversions")} />
        <KpiTile label="Policies issued" value={t.policiesIssued} change={dash.change.policiesIssued} points={series(dash, "policies_issued")} href="/partner/issuance" />
        <KpiTile label="Renewals due (30 days)" value={dash.renewals.count} hint={`${dash.renewals.next.filter((r) => r.renewal_request_id).length} renewal requests started`} />
        <KpiTile label="Lapses (90 days)" value={dash.lapses.lapsed + dash.lapses.cancelled + dash.lapses.expired} hint={`${dash.lapses.renewed} renewed · ${pct(dash.lapses.lapse_rate)} lapse rate`} tone={dash.lapses.lapsed + dash.lapses.cancelled > 0 ? "warn" : "default"} />
        <KpiTile label="Claims in progress" value={dash.claims.open} hint={dash.claims.avgDaysToDecision != null ? `${dash.claims.avgDaysToDecision} days to decision` : "No decisions yet"} tone={dash.claims.staleOpen > 0 ? "warn" : "default"} href="/partner/claims" />
        <KpiTile label="SLA performance" value={pct(sla.on_time_rate)} hint={`${sla.submissions_on_time} of ${sla.submissions_measured} responses on time`} tone={sla.submissions_open_overdue > 0 ? "warn" : "default"} href="/partner/submissions" />
        {scope.canSeeMoney && (
          <KpiTile label="Settlements" value={latest ? ghs(Number(latest.net_due)) : "—"} hint={latest ? `${formatDate(latest.period_start)} – ${formatDate(latest.period_end)} · ${humanize(latest.status)}` : "No statements yet"} href="/partner/settlements" />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Section title="Sales funnel" description={`Submissions, quotes and conversions per day, ${dayLabel(dash.from)} – ${dayLabel(dash.to)}`}>
          <LineChart
            title="Submissions, quotes and conversions per day"
            labels={dash.series.map((d) => dayLabel(d.day))}
            series={[
              { name: "Submissions", values: dash.series.map((d) => d.requests), tone: "ink" },
              { name: "Quotes", values: dash.series.map((d) => d.quotes), tone: "brand" },
              { name: "Conversions", values: dash.series.map((d) => d.conversions), tone: "amber" },
            ]}
          />
        </Section>
        <div className="space-y-6">
          <Section title={scope.canSeeMoney ? "Premium issued per day" : "Policies issued per day"}>
            {scope.canSeeMoney ? <BarChart title="Premium issued per day" points={series(dash, "premium")} format={ghs} unit="Premium (GHS)" /> : <BarChart title="Policies issued per day" points={series(dash, "policies_issued")} unit="Policies" />}
          </Section>
          <Section title="Service levels">
            <RateMeter label="Submissions answered within target" ratio={sla.submissions_measured ? sla.submissions_on_time / sla.submissions_measured : null} detail={`${sla.submissions_late} late · ${sla.submissions_open_overdue} open past the target`} />
            {dash.claims.openSlaBreaches != null && <p className="mt-3 text-sm text-muted">Open claim SLA breaches: <span className="font-semibold text-ink">{dash.claims.openSlaBreaches}</span></p>}
          </Section>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <RenewalsPanel dash={dash} kind="insurer" />
        <ClaimsPanel dash={dash} href="/partner/claims" />
      </div>
    </div>
  );
}

function RenewalsPanel({ dash, kind }: { dash: PartnerDashboard; kind: "broker" | "insurer" }) {
  return (
    <Section title="Renewals due" description={`Active policies ending in the next ${dash.renewals.windowDays} days${kind === "insurer" ? " · customer names shortened" : ""}`} actions={kind === "broker" ? <Link href="/partner/policies?view=renewals" className={buttonClass("secondary", "sm")}>All renewals</Link> : undefined}>
      {dash.renewals.next.length === 0 ? (
        <Empty>No policies are due for renewal in this window.</Empty>
      ) : (
        <Table>
          <THead><tr><Th>Policy</Th><Th>Customer</Th><Th>Ends</Th><Th>Status</Th></tr></THead>
          <tbody>
            {dash.renewals.next.map((r) => (
              <tr key={r.policy_id} className="hover:bg-mist/60">
                <Td>
                  <span className="font-semibold text-ink">{r.policy_number ?? r.internal_reference}</span>
                  <p className="text-xs text-muted">{r.category_name}</p>
                </Td>
                <Td>
                  {r.customer_name}
                  {kind === "broker" && !r.contact_allowed && <p className="text-xs text-amber">No contact consent</p>}
                </Td>
                <Td>{formatDate(r.cover_end)}<p className="text-xs text-subtle">{r.days_left} days</p></Td>
                <Td>{r.renewal_request_id ? <Pill tone="info">Renewal started</Pill> : <Pill tone="wait">{r.reminders_sent > 0 ? `${r.reminders_sent} reminder${r.reminders_sent === 1 ? "" : "s"}` : "Not started"}</Pill>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Section>
  );
}

function ClaimsPanel({ dash, href }: { dash: PartnerDashboard; href: string }) {
  const entries = Object.entries(dash.claims.byStatus) as [ClaimStatus, number][];
  return (
    <Section title="Claims" description="By status. Reporting a claim is not approval; only the insurer decides." actions={<Link href={href} className={buttonClass("secondary", "sm")}>Claims desk</Link>}>
      {entries.length === 0 ? (
        <Empty>No claims yet.</Empty>
      ) : (
        <Bars items={entries.map(([k, v]) => ({ label: CLAIM_STATUS[k]?.label ?? humanize(k), value: v, tone: CLAIM_STATUS[k]?.tone === "wait" ? "amber" : "brand" }))} />
      )}
      <p className="mt-3 text-xs text-subtle">
        {dash.claims.decided} decided · average {dash.claims.avgDaysToDecision ?? "—"} days to decision · {dash.claims.staleOpen} open for more than 14 days
      </p>
    </Section>
  );
}
