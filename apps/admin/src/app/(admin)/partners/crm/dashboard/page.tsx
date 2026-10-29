import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page";
import { CRM_STAGES, pipelineSummary, type CrmStage } from "@im/core";
import { requireCrm, staffDirectory, type CrmAccount } from "@/lib/crm";
import { fmtNum, formatGHS } from "@/lib/format";
import { Kpi, LoadingBlock, Panel } from "@/components/ui/layout";
import { Bars, HBars } from "@/components/ui/charts";
import { CRM_BASE, STAGE_LABEL, accountHref } from "../meta";

export default function CrmDashboardPage() {
  return (
    <>
      <PageHeader eyebrow="Partnerships" title="Partnerships dashboard" description="Pipeline by stage, time to go-live, partners live and platform revenue by partner and by rep." />
      <Suspense fallback={<LoadingBlock label="Computing pipeline metrics…" rows={8} />}>
        <Dashboard />
      </Suspense>
    </>
  );
}

async function Dashboard() {
  const { actor, supabase } = await requireCrm();
  const [{ data: accountsData }, { data: viewRows }, staff] = await Promise.all([
    supabase.from("crm_accounts").select("*").limit(2000),
    supabase.from("crm_pipeline_summary").select("*"),
    staffDirectory(supabase, actor.staff.orgId),
  ]);
  const accounts = (accountsData ?? []) as CrmAccount[];
  const s = pipelineSummary(accounts);
  const staffName = (id: string | null) => (id ? (staff.find((m) => m.userId === id)?.name ?? "Staff") : "Unassigned");

  // Stage counts/value from the SQL view (same numbers as the pure aggregation; keeps the view exercised).
  const stageRows = (viewRows ?? []).filter((r) => r.metric === "stage");
  const stageData = CRM_STAGES.filter((st) => st.key !== "lost").map((st) => {
    const r = stageRows.find((x) => x.key === st.key);
    return { label: st.label, value: Number(r?.count ?? 0), hint: formatGHS(Number(r?.estimated_value ?? 0)) };
  });
  const ttl = (viewRows ?? []).find((r) => r.metric === "time_to_live");
  const avgDays = ttl?.avg_days != null ? Number(ttl.avg_days) : s.avgDaysToLive;

  // Platform revenue (platform_fee + revenue_share) per live partner organisation, joined through crm_accounts.org_id.
  const live = accounts.filter((a) => a.stage === "live" && a.org_id);
  const orgIds = [...new Set(live.map((a) => a.org_id!))];
  const { data: ledger } = orgIds.length
    ? await supabase.from("ledger_entries").select("counterparty_org_id, entry_type, amount").in("entry_type", ["platform_fee", "revenue_share"]).in("counterparty_org_id", orgIds).limit(5000)
    : { data: [] as { counterparty_org_id: string | null; entry_type: string; amount: number }[] };
  const revenueByOrg = new Map<string, number>();
  for (const e of ledger ?? []) if (e.counterparty_org_id) revenueByOrg.set(e.counterparty_org_id, (revenueByOrg.get(e.counterparty_org_id) ?? 0) + Number(e.amount));
  const byPartner = live.map((a) => ({ account: a, value: revenueByOrg.get(a.org_id!) ?? 0 })).sort((x, y) => y.value - x.value);
  const byRep = new Map<string | null, number>();
  for (const p of byPartner) byRep.set(p.account.owner_user_id, (byRep.get(p.account.owner_user_id) ?? 0) + p.value);
  const totalRevenue = byPartner.reduce((x, p) => x + p.value, 0);

  const openByOwner = s.byOwner.map((o) => ({ label: staffName(o.ownerId), value: o.count }));
  const liveByOwner = [...new Set(live.map((a) => a.owner_user_id))].map((id) => ({ label: staffName(id), value: live.filter((a) => a.owner_user_id === id).length })).sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-6">
      <section aria-label="Pipeline" className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <Kpi label="Open accounts" value={fmtNum(s.open)} hint={`${fmtNum(s.total)} in total`} href={CRM_BASE} />
        <Kpi label="Pipeline value" value={formatGHS(s.byStage.filter((x) => x.stage !== "live" && x.stage !== "lost").reduce((a, x) => a + x.value, 0))} hint="Estimated annual value, open accounts" />
        <Kpi label="Partners live" value={fmtNum(s.live)} tone="ok" hint={s.winRate == null ? "No decided accounts yet" : `${Math.round(s.winRate * 100)}% of decided accounts`} />
        <Kpi label="Time to go-live" value={avgDays == null ? "—" : `${avgDays.toFixed(avgDays < 10 ? 1 : 0)} d`} hint="Average, agreement signed → live" />
        <Kpi label="Platform revenue" value={formatGHS(totalRevenue)} hint="Platform fee + revenue share from live partners" />
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Pipeline by stage" description="Accounts per stage (hover for estimated value).">
          <Bars data={stageData} height={140} />
        </Panel>
        <Panel title="Open accounts by rep">
          {openByOwner.length ? <HBars data={openByOwner} /> : <p className="text-sm text-muted">No open accounts.</p>}
        </Panel>
        <Panel title="Revenue by partner" description="Ledger entries of type platform_fee and revenue_share where the partner is the counterparty.">
          {byPartner.length ? (
            <ul className="space-y-2">
              {byPartner.map((p) => (
                <li key={p.account.id} className="text-sm">
                  <div className="flex justify-between gap-2">
                    <Link href={accountHref(p.account.id)} className="truncate text-brand hover:underline">{p.account.name}</Link>
                    <span className="shrink-0 font-medium tabular-nums text-ink">{formatGHS(p.value)}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-mist"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${totalRevenue ? (p.value / totalRevenue) * 100 : 0}%` }} /></div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No live partners linked to an organisation yet.</p>
          )}
        </Panel>
        <Panel title="Revenue and live partners by rep">
          {live.length ? (
            <div className="space-y-5">
              <HBars data={[...byRep.entries()].map(([id, v]) => ({ label: staffName(id), value: v })).sort((a, b) => b.value - a.value)} format={(n) => formatGHS(n)} />
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Partners live</p>
                <HBars data={liveByOwner} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted">No live partners yet.</p>
          )}
        </Panel>
      </div>

      <Panel title="Lost reasons" description="Why accounts were lost, most recent first.">
        {s.lost ? (
          <ul className="space-y-1.5 text-sm">
            {accounts.filter((a) => a.stage === "lost").slice(0, 20).map((a) => (
              <li key={a.id}><Link href={accountHref(a.id)} className="font-medium text-brand hover:underline">{a.name}</Link> <span className="text-muted">— {a.lost_reason ?? "no reason recorded"}</span></li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No lost accounts.</p>
        )}
      </Panel>
      <p className="text-xs text-subtle">Stages: {CRM_STAGES.map((st) => STAGE_LABEL[st.key as CrmStage]).join(" → ")}.</p>
    </div>
  );
}
