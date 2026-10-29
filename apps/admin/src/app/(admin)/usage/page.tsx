import { Suspense } from "react";
import Link from "next/link";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid, orgMap, sp, type SearchParams } from "@/lib/query";
import { fmtNum, formatGHS } from "@/lib/format";
import { FilterBar, FilterInput, FilterSelect, LoadingBlock, Panel } from "@/components/ui/layout";
import { Bars } from "@/components/ui/charts";
import { monthRange } from "@/lib/billing";

export default function UsagePage({ searchParams }: PageProps<"/usage">) {
  return (
    <>
      <PageHeader title="Usage" description="Metered events (requests processed, active policies, AI tokens, SMS, API calls) aggregated by organisation and month. Feeds invoices." />
      <Suspense fallback={<LoadingBlock label="Aggregating usage…" />}>
        <Usage searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Usage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const period = sp(params, "period") ?? new Date().toISOString().slice(0, 7);
  const org = sp(params, "org");
  const metric = sp(params, "metric");
  const { start, end, endExclusive } = monthRange(period);

  let query = supabase.from("usage_events").select("org_id, metric, quantity, occurred_at").gte("occurred_at", `${start}T00:00:00Z`).lt("occurred_at", `${endExclusive}T00:00:00Z`).limit(50000);
  if (isUuid(org)) query = query.eq("org_id", org);
  if (metric) query = query.eq("metric", metric);
  const [{ data: events }, orgs, { data: subs }] = await Promise.all([
    query,
    orgMap(supabase),
    supabase.from("subscriptions").select("org_id, status, plan:plans(name, included_requests, per_request_fee, per_active_policy_fee)").in("status", ["trialing", "active", "past_due"]),
  ]);

  const metrics = [...new Set((events ?? []).map((e) => e.metric))].sort();
  const byOrg = new Map<string, Record<string, number>>();
  const days = Number(end.slice(8, 10));
  const daily = Array.from({ length: days }, () => 0);
  for (const e of events ?? []) {
    const m = byOrg.get(e.org_id) ?? {};
    m[e.metric] = (m[e.metric] ?? 0) + Number(e.quantity);
    byOrg.set(e.org_id, m);
    const d = Number(e.occurred_at.slice(8, 10)) - 1;
    if (d >= 0 && d < days) daily[d]! += Number(e.quantity);
  }
  type Plan = { name: string; included_requests: number | null; per_request_fee: number; per_active_policy_fee: number };
  const planByOrg = new Map((subs ?? []).map((s) => [s.org_id, { status: s.status, plan: s.plan as unknown as Plan | null }]));

  return (
    <div className="space-y-6">
      <FilterBar action="/usage">
        <FilterInput name="period" label="Month" type="month" value={period} />
        <FilterSelect name="org" label="Organisation" value={org} options={[...orgs.values()].filter((o) => o.type !== "platform").map((o) => ({ value: o.id, label: o.name }))} />
        <FilterSelect name="metric" label="Metric" value={metric} options={["request_processed", "policy_active", "ai_tokens", "sms_sent", "api_call"].map((m) => ({ value: m, label: m.replace(/_/g, " ") }))} />
      </FilterBar>
      <Panel title={`Daily volume · ${period}`} description={metric ? metric.replace(/_/g, " ") : "All metrics (quantities summed)"}>
        <Bars data={daily.map((v, i) => ({ label: `${period}-${String(i + 1).padStart(2, "0")}`, value: v }))} height={110} format={(n) => fmtNum(n)} />
      </Panel>
      <Table>
        <THead>
          <tr>
            <Th>Organisation</Th>
            <Th>Plan</Th>
            {metrics.map((m) => <Th key={m}>{m.replace(/_/g, " ")}</Th>)}
            <Th>Est. usage fees</Th>
          </tr>
        </THead>
        <tbody>
          {[...byOrg.entries()].map(([orgId, m]) => {
            const sub = planByOrg.get(orgId);
            const plan = sub?.plan;
            const over = plan ? Math.max(0, (m.request_processed ?? 0) - (plan.included_requests ?? Infinity)) : 0;
            const fees = plan && sub?.status !== "trialing" ? over * Number(plan.per_request_fee) + (m.policy_active ?? 0) * Number(plan.per_active_policy_fee) : 0;
            return (
              <tr key={orgId}>
                <Td><Link href={`/organisations/${orgId}?tab=subscription`} className="font-medium text-ink hover:text-brand">{orgs.get(orgId)?.name ?? orgId.slice(0, 8)}</Link></Td>
                <Td className="text-xs">{plan?.name ?? "—"}{sub?.status === "trialing" && " (trial)"}</Td>
                {metrics.map((k) => <Td key={k} className="tabular-nums">{fmtNum(m[k] ?? 0)}</Td>)}
                <Td className="tabular-nums">{formatGHS(fees, { decimals: true })}</Td>
              </tr>
            );
          })}
          {!byOrg.size && <tr><Td colSpan={metrics.length + 3} className="py-10 text-center text-muted">No usage recorded for {period}.</Td></tr>}
        </tbody>
      </Table>
      <p className="text-xs text-subtle">Request overage = requests processed above the plan allowance × per-request fee. Trials are not charged. Final amounts are set when an invoice is generated.</p>
    </div>
  );
}
