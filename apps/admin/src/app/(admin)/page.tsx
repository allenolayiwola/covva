import { Suspense } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ShieldAlert, XCircle } from "lucide-react";
import { Pill } from "@im/ui";
import { PageHeader } from "@/components/ui/page";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { computeAlerts, computeMetrics } from "@/lib/metrics";
import { categoryMap, nowMs } from "@/lib/query";
import { fmtHours, fmtNum, fmtPct, fmtUSD, formatDate, formatDateTime, formatGHS } from "@/lib/format";
import { Kpi, LoadingBlock, Panel } from "@/components/ui/layout";
import { Bars, HBars, Sparkline } from "@/components/ui/charts";
import { InsightsPanel } from "./ai/InsightsPanel";
import { can } from "@/lib/roles";

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        eyebrow="Platform administration"
        title="Overview"
        description="Unit economics and service health across brokers, insurers and customers. Last 30 days unless stated."
      />
      <Suspense fallback={<LoadingBlock label="Computing platform metrics…" rows={10} />}>
        <Dashboard />
      </Suspense>
    </>
  );
}

async function Dashboard() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const [m, alerts, cats] = await Promise.all([computeMetrics(supabase), computeAlerts(supabase), categoryMap(supabase)]);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

  return (
    <div className="space-y-6">
      <section aria-label="Demand and quoting">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi label="Requests today" value={fmtNum(m.requests.today)} hint={`${fmtNum(m.requests.d7)} in 7 days · ${fmtNum(m.requests.d30)} in 30 days`} trend={<Sparkline values={m.requests.daily} />} href="/requests" />
          <Kpi label="Quote coverage" value={m.quotes.avgPerRequest == null ? "—" : m.quotes.avgPerRequest.toFixed(1)} hint={`Avg quotes per request · ${fmtPct(m.quotes.pctWith3Plus)} with ≥ 3 quotes`} />
          <Kpi label="Median quote response" value={fmtHours(m.quotes.medianResponseHours)} hint="Submission → first prepared quote" />
          <Kpi label="Quote → purchase" value={fmtPct(m.conversion.quoteToPurchase, 1)} hint={`${fmtNum(m.conversion.purchased)} of ${fmtNum(m.quotes.requestsWithQuotes)} quoted requests`} />
        </div>
      </section>

      <section aria-label="Fulfilment" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Policies issued" value={fmtNum(m.policies.issued30d)} hint={`${fmtNum(m.policies.active)} active policies`} trend={<Sparkline values={m.policies.dailyIssued} />} href="/policies" />
        <Kpi label="Median issuance time" value={fmtHours(m.policies.medianIssuanceHours)} hint="Payment confirmed → insurer issues" />
        <Kpi label="Reconciliation exceptions" value={fmtNum(m.payments.exceptions)} tone={m.payments.exceptions ? "warn" : "ok"} hint={`${fmtNum(m.payments.failed7d)} failed payments in 7 days`} href="/payments?view=exceptions" />
        <Kpi label="Open complaints" value={fmtNum(m.complaints.open)} tone={m.complaints.slaBreached ? "danger" : "default"} hint={`${fmtNum(m.complaints.slaBreached)} past SLA · ${fmtNum(m.complaints.escalatedNic)} escalated to NIC`} href="/complaints" />
      </section>

      <section aria-label="Customers and network" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Request SLA breaches" value={fmtNum(m.sla.breached)} tone={m.sla.breached ? "danger" : "ok"} hint={`${fmtNum(m.sla.openRequests)} open · ${fmtNum(m.sla.unassigned)} without broker`} href="/requests?breached=1" />
        <Kpi label="Renewal rate" value={fmtPct(m.renewal.rate)} hint={`Policies ending in last 90 days (${fmtNum(m.renewal.dueWindow)})`} />
        <Kpi label="Active customers" value={fmtNum(m.customers.active)} hint="Active policy or request in 30 days" href="/users" />
        <Kpi
          label="Active partners"
          value={
            <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span>
                {fmtNum(m.network.activeBrokers)} <span className="text-sm font-medium text-muted">brokers</span>
              </span>
              <span>
                {fmtNum(m.network.activeInsurers)} <span className="text-sm font-medium text-muted">insurers</span>
              </span>
            </span>
          }
          hint={`${fmtNum(m.network.pendingOrgs)} pending onboarding`}
          href="/organisations"
        />
      </section>

      <section aria-label="Money" className="grid gap-3 md:grid-cols-3">
        <Kpi label="Premium arranged (GWP via platform)" value={formatGHS(m.gwp.activePremium)} hint="Premium arranged, not platform revenue — premiums settle directly to insurers." />
        <Kpi label="Platform revenue (monthly run-rate)" value={formatGHS(m.revenue.mrr + m.revenue.usageFeesMonth)} hint={`${formatGHS(m.revenue.mrr)} subscriptions + ${formatGHS(m.revenue.usageFeesMonth)} usage fees this month · ${m.revenue.trialing} on trial`} href="/subscriptions" />
        <Kpi label="AI usage (30 days)" value={fmtUSD(m.ai.cost30d)} hint={`${fmtNum(m.ai.calls30d)} calls · ${fmtNum(m.ai.tokens30d)} tokens · ${fmtPct(m.ai.successRate)} success`} trend={<Sparkline values={m.ai.dailyCost} />} href="/ai" />
      </section>

      <div className="grid gap-6 xl:grid-cols-3">
        <Panel title="Requests per day" description={`${sum(m.requests.daily)} in the last 30 days`} className="xl:col-span-2">
          <Bars data={m.requests.daily.map((v, i) => ({ label: formatDate(new Date(nowMs() - (29 - i) * 86_400_000)), value: v }))} height={140} />
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">By category</p>
              <HBars data={Object.entries(m.requests.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id, v]) => ({ label: cats.get(id)?.name ?? "Unknown", value: v }))} />
              {!Object.keys(m.requests.byCategory).length && <p className="text-sm text-muted">No requests yet.</p>}
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">By channel</p>
              <HBars data={Object.entries(m.requests.bySource).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k.replace(/_/g, " "), value: v }))} />
              {!Object.keys(m.requests.bySource).length && <p className="text-sm text-muted">No requests yet.</p>}
            </div>
          </div>
        </Panel>

        <Panel title="Alerts" description="Things that need a human today">
          <ul className="space-y-4 text-sm">
            <li className="flex gap-2.5">
              {alerts.audit?.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />}
              <div>
                <p className="font-medium text-ink">Audit chain {alerts.audit ? (alerts.audit.ok ? "intact" : "BROKEN") : "unavailable"}</p>
                <p className="text-xs text-muted">
                  {alerts.audit ? (alerts.audit.ok ? `${fmtNum(alerts.audit.checked)} events verified` : `First bad event #${alerts.audit.firstBadId}`) : "Could not run verification"} ·{" "}
                  <Link href="/audit" className="text-brand hover:underline">Audit log</Link>
                </p>
              </div>
            </li>
            <AlertGroup icon={<ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber" />} title={`Licences & PI cover (${alerts.licences.length})`} empty="All partner licences verified and in date.">
              {alerts.licences.slice(0, 6).map((l, i) => (
                <li key={`${l.id}-${i}`}>
                  <Link href={`/organisations/${l.id}`} className="font-medium text-ink hover:text-brand">{l.name}</Link>{" "}
                  <span className="text-muted">— {l.issue}{l.due ? ` (${formatDate(l.due)})` : ""}</span>
                </li>
              ))}
            </AlertGroup>
            <AlertGroup icon={<AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />} title={`SLA breaches (${alerts.slaBreaches.length}${alerts.slaBreaches.length === 8 ? "+" : ""})`} empty="No open requests past due.">
              {alerts.slaBreaches.map((r) => (
                <li key={r.id}>
                  <Link href={`/requests/${r.id}`} className="font-medium text-ink hover:text-brand">{r.reference}</Link>{" "}
                  <span className="text-muted">due {formatDateTime(r.due_at)}{r.broker_org_id ? "" : " · no broker"}</span>
                </li>
              ))}
            </AlertGroup>
            <AlertGroup icon={<XCircle className="mt-0.5 size-4 shrink-0 text-danger" />} title={`Failed payments, 7 days (${alerts.failedPayments.length})`} empty="No unreconciled failed payments.">
              {alerts.failedPayments.map((p) => (
                <li key={p.id}>
                  <Link href={`/payments?q=${p.provider_reference ?? p.id}`} className="font-medium text-ink hover:text-brand">{formatGHS(p.amount, { decimals: true })}</Link>{" "}
                  <span className="text-muted">{p.failure_reason ?? p.provider_reference ?? ""} · {formatDateTime(p.created_at)}</span>
                </li>
              ))}
            </AlertGroup>
          </ul>
        </Panel>
      </div>

      <InsightsPanel enabled={can(staff.roles, "insights")} />

      <p className="text-xs text-subtle">
        Generated {formatDateTime(m.generatedAt)}. <Pill tone="neutral">Platform = technology provider</Pill> Metrics are operational indicators,
        not financial statements.
      </p>
    </div>
  );
}

function AlertGroup({ icon, title, empty, children }: { icon: React.ReactNode; title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <li className="flex gap-2.5">
      {icon}
      <div className="min-w-0">
        <p className="font-medium text-ink">{title}</p>
        {children.length ? <ul className="mt-1 space-y-1 text-xs">{children}</ul> : <p className="text-xs text-muted">{empty}</p>}
      </div>
    </li>
  );
}
