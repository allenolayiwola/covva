import { Suspense } from "react";
import Link from "next/link";
import { Pill } from "@im/ui";
import { PageHeader, Table, THead, Th, Td } from "@/components/ui/page";
import { requireStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { sp, type SearchParams } from "@/lib/query";
import { daysUntil, formatDate, formatGHS } from "@/lib/format";
import { FilterBar, FilterSelect, Kpi, LoadingBlock } from "@/components/ui/layout";

const TONE = { active: "ok", trialing: "info", past_due: "danger", cancelled: "neutral" } as const;

export default function SubscriptionsPage({ searchParams }: PageProps<"/subscriptions">) {
  return (
    <>
      <PageHeader title="Subscriptions" description="Each partner organisation's plan, status and trial. Change a plan from the organisation's Subscription tab." />
      <Suspense fallback={<LoadingBlock label="Loading subscriptions…" />}>
        <Subs searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Subs({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireStaff();
  const params = await searchParams;
  const supabase = await createClient();
  const status = sp(params, "status");
  const type = sp(params, "type");
  const [{ data: orgs }, { data: subs }, { data: plans }] = await Promise.all([
    supabase.from("organizations").select("id, name, type, status").neq("type", "platform").neq("status", "offboarded").order("name"),
    supabase.from("subscriptions").select("*").order("created_at", { ascending: false }),
    supabase.from("plans").select("id, name, monthly_fee"),
  ]);
  const planById = new Map((plans ?? []).map((p) => [p.id, p]));
  const liveByOrg = new Map<string, NonNullable<typeof subs>[number]>();
  for (const s of subs ?? []) if (["trialing", "active", "past_due"].includes(s.status) && !liveByOrg.has(s.org_id)) liveByOrg.set(s.org_id, s);

  let rows = (orgs ?? []).map((o) => ({ org: o, sub: liveByOrg.get(o.id) }));
  if (type) rows = rows.filter((r) => r.org.type === type);
  if (status === "none") rows = rows.filter((r) => !r.sub);
  else if (status) rows = rows.filter((r) => r.sub?.status === status);

  const live = [...liveByOrg.values()];
  const mrr = live.filter((s) => s.status === "active" || s.status === "past_due").reduce((t, s) => t + Number(planById.get(s.plan_id)?.monthly_fee ?? 0), 0);
  const trialsEnding = live.filter((s) => s.status === "trialing" && (daysUntil(s.trial_ends_on) ?? 999) <= 14).length;

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <Kpi label="Subscription MRR" value={formatGHS(mrr)} hint="Active + past due" />
        <Kpi label="Active" value={live.filter((s) => s.status === "active").length} />
        <Kpi label="On trial" value={live.filter((s) => s.status === "trialing").length} hint={`${trialsEnding} ending within 14 days`} tone={trialsEnding ? "warn" : "default"} />
        <Kpi label="Past due" value={live.filter((s) => s.status === "past_due").length} tone={live.some((s) => s.status === "past_due") ? "danger" : "default"} />
      </div>
      <FilterBar action="/subscriptions">
        <FilterSelect name="status" label="Status" value={status} options={[{ value: "active", label: "Active" }, { value: "trialing", label: "Trialing" }, { value: "past_due", label: "Past due" }, { value: "none", label: "No subscription" }]} />
        <FilterSelect name="type" label="Organisation type" value={type} options={[{ value: "broker", label: "Broker" }, { value: "insurer", label: "Insurer" }, { value: "enterprise", label: "Enterprise" }]} />
      </FilterBar>
      <Table>
        <THead><tr><Th>Organisation</Th><Th>Plan</Th><Th>Status</Th><Th>Trial ends</Th><Th>Current period</Th><Th>Monthly</Th><Th /></tr></THead>
        <tbody>
          {rows.map(({ org, sub }) => {
            const plan = sub ? planById.get(sub.plan_id) : undefined;
            const trialDays = sub?.status === "trialing" ? daysUntil(sub.trial_ends_on) : null;
            return (
              <tr key={org.id}>
                <Td><Link href={`/organisations/${org.id}?tab=subscription`} className="font-semibold text-ink hover:text-brand">{org.name}</Link><p className="text-xs capitalize text-muted">{org.type} · {org.status}</p></Td>
                <Td>{plan?.name ?? <span className="text-muted">—</span>}</Td>
                <Td>{sub ? <Pill tone={TONE[sub.status]}>{sub.status.replace("_", " ")}</Pill> : <Pill tone="wait">None</Pill>}{sub?.cancel_at_period_end && <Pill tone="neutral" className="ml-1">Cancels at period end</Pill>}</Td>
                <Td>{sub?.trial_ends_on ? <span className={trialDays !== null && trialDays <= 14 ? "text-amber" : ""}>{formatDate(sub.trial_ends_on)}{trialDays !== null ? ` (${trialDays}d)` : ""}</span> : "—"}</Td>
                <Td className="text-xs">{sub ? `${formatDate(sub.current_period_start)} – ${formatDate(sub.current_period_end)}` : "—"}</Td>
                <Td className="tabular-nums">{plan ? formatGHS(Number(plan.monthly_fee)) : "—"}</Td>
                <Td><Link href={`/organisations/${org.id}?tab=subscription`} className="text-sm text-brand hover:underline">Manage</Link></Td>
              </tr>
            );
          })}
          {!rows.length && <tr><Td colSpan={7} className="py-8 text-center text-muted">Nothing matches.</Td></tr>}
        </tbody>
      </Table>
    </>
  );
}
